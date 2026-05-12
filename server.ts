import express from 'express';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { rateLimit } from 'express-rate-limit';
import nodemailer from 'nodemailer';
import { createGlpiTicket }   from './agents/shared/glpi.js';
import { sendTelegramMessage } from './agents/shared/telegram.js';
import { firewallBlockIp, firewallTestConnection, type FirewallType } from './agents/shared/firewall.js';
import { setLocalLLMBaseUrl } from './agents/shared/client.js';
import {
  AGENT_METADATA,
  AGENT_PHASES,
  DEFAULT_AGENT_MODELS,
  OPENROUTER_FREE_MODELS,
  OPENROUTER_MODEL_LABELS,
  isAgentPhase,
  runOrchestration,
  runPhase,
  runFpScan,
  runInvestigation,
  type ModelAssignments,
} from './agents.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'black-box-soc-secret-2026';

// --- Ingest rate-limiter (in-memory, resets each minute) -------------------
const ingestRateMap = new Map<string, { count: number; window: number }>();
function checkIngestRateLimit(maxPerMin: number): boolean {
  if (maxPerMin <= 0) return true;
  const now   = Math.floor(Date.now() / 60000);
  const entry = ingestRateMap.get('ingest') ?? { count: 0, window: now };
  if (entry.window !== now) { entry.count = 0; entry.window = now; }
  if (entry.count >= maxPerMin) return false;
  entry.count++;
  ingestRateMap.set('ingest', entry);
  return true;
}

// --- Email helper -----------------------------------------------------------
// Config comes from DB (configurable in UI). Falls back to env vars for bootstrapping.
async function sendIncidentAlert(subject: string, body: string, emailCfg?: Record<string, string>) {
  const cfg  = emailCfg || {};
  const host = cfg.smtp_host || process.env.SMTP_HOST;
  const port = Number(cfg.smtp_port || process.env.SMTP_PORT || 587);
  const user = cfg.smtp_user || process.env.SMTP_USER;
  const pass = cfg.smtp_pass || process.env.SMTP_PASS;
  const to   = cfg.to   || process.env.ALERT_EMAIL_TO;
  const from = cfg.from || user;

  if (!host || !user || !pass || !to) {
    console.warn('[Email] Not configured — skipping');
    return;
  }

  const transport = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass },
  });

  await transport.sendMail({
    from, to,
    subject: `[BBS AISOC] ${subject}`,
    text:    body,
  });
  console.log(`[Email] Sent: ${subject} → ${to}`);
}

// --- Slack helper ------------------------------------------------------------
async function sendSlackWebhook(webhookUrl: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message };
  }
}

// --- Database Setup ---------------------------------------------------------
let db: Database.Database;
try {
  db = new Database('soc.db');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      email TEXT,
      role TEXT DEFAULT 'ANALYST'
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      rule_id TEXT,
      description TEXT,
      severity INTEGER,
      source_ip TEXT,
      dest_ip TEXT,
      user TEXT,
      hostname TEXT,
      agent_name TEXT,
      full_log TEXT,
      status TEXT DEFAULT 'NEW',
      ai_analysis TEXT,
      mitre_attack TEXT,
      remediation_steps TEXT,
      email_sent BOOLEAN DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      title TEXT,
      severity TEXT,
      status TEXT DEFAULT 'OPEN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      assigned_to INTEGER,
      analysis TEXT,
      action_plan TEXT,
      FOREIGN KEY(assigned_to) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS incident_alerts (
      incident_id TEXT,
      alert_id TEXT,
      PRIMARY KEY(incident_id, alert_id),
      FOREIGN KEY(incident_id) REFERENCES incidents(id),
      FOREIGN KEY(alert_id) REFERENCES alerts(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER,
      action TEXT,
      details TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS agent_settings (
      phase TEXT PRIMARY KEY,
      model TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id TEXT NOT NULL,
      run_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ai_analysis TEXT,
      mitre_attack TEXT,
      remediation_steps TEXT,
      status TEXT,
      FOREIGN KEY(alert_id) REFERENCES alerts(id)
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id TEXT,
      phase TEXT,
      user_id INTEGER,
      is_accurate BOOLEAN,
      comment TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(alert_id) REFERENCES alerts(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS integrations (
      name TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      config TEXT DEFAULT '{}',
      auto_send_threshold TEXT DEFAULT 'NEVER',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id TEXT,
      integration TEXT NOT NULL,
      action TEXT,
      status TEXT,
      payload TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(alert_id) REFERENCES alerts(id)
    );

    CREATE INDEX IF NOT EXISTS idx_action_logs_created     ON action_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_action_logs_integration ON action_logs(integration);

    CREATE TABLE IF NOT EXISTS firewalls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      enabled INTEGER DEFAULT 0,
      config TEXT DEFAULT '{}',
      auto_block INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS firewall_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firewall_id INTEGER NOT NULL,
      ip TEXT NOT NULL,
      alert_id TEXT,
      reason TEXT,
      status TEXT DEFAULT 'blocked',
      blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      unblocked_at DATETIME,
      FOREIGN KEY(firewall_id) REFERENCES firewalls(id),
      FOREIGN KEY(alert_id) REFERENCES alerts(id)
    );

    CREATE INDEX IF NOT EXISTS idx_fw_blocks_ip ON firewall_blocks(ip);
    CREATE INDEX IF NOT EXISTS idx_fw_blocks_status ON firewall_blocks(status);

    CREATE TABLE IF NOT EXISTS local_llm_config (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS playbooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tactic TEXT NOT NULL,
      title TEXT NOT NULL,
      steps TEXT NOT NULL,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by) REFERENCES users(id)
    );

    -- ── Memory tiers (hub-and-swarm architecture) ──────────────────────────

    CREATE TABLE IF NOT EXISTS working_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id TEXT,
      trace_id TEXT,
      step INTEGER,
      thought TEXT,
      action TEXT,
      result_summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(alert_id) REFERENCES alerts(id)
    );
    CREATE INDEX IF NOT EXISTS idx_working_alert ON working_memory(alert_id);
    CREATE INDEX IF NOT EXISTS idx_working_trace ON working_memory(trace_id);

    CREATE TABLE IF NOT EXISTS ioc_memory (
      value TEXT PRIMARY KEY,
      type TEXT,
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen  DATETIME DEFAULT CURRENT_TIMESTAMP,
      alert_count INTEGER DEFAULT 1,
      threat_level TEXT,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ioc_last_seen ON ioc_memory(last_seen);
    CREATE INDEX IF NOT EXISTS idx_ioc_type      ON ioc_memory(type);

    CREATE TABLE IF NOT EXISTS incident_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id TEXT,
      idempotency_key TEXT UNIQUE,
      summary TEXT,
      attack_pattern TEXT,
      threat_actor TEXT,
      outcome TEXT,
      ttp_tags TEXT,
      embedding BLOB,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(alert_id) REFERENCES alerts(id)
    );
    CREATE INDEX IF NOT EXISTS idx_insights_created ON incident_insights(created_at);

    CREATE TABLE IF NOT EXISTS asset_context (
      value         TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      role          TEXT NOT NULL,
      description   TEXT,
      fp_default    INTEGER DEFAULT 0,
      source        TEXT DEFAULT 'manual',
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_asset_value ON asset_context(value);
    CREATE INDEX IF NOT EXISTS idx_asset_type  ON asset_context(type);

    -- ── Suppression rules (pattern-based FP auto-dismiss) ──────────────────
    CREATE TABLE IF NOT EXISTS suppression_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source_ip_pattern TEXT,
      agent_name_pattern TEXT,
      rule_id_pattern TEXT,
      description_pattern TEXT,
      min_severity INTEGER DEFAULT 0,
      max_severity INTEGER DEFAULT 15,
      reason TEXT NOT NULL,
      hit_count INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT DEFAULT 'system'
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME,
      revoked INTEGER DEFAULT 0
    );

    -- Performance indexes
    CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp);
    CREATE INDEX IF NOT EXISTS idx_alerts_status    ON alerts(status);
  `);

  // ── Idempotent migrations for memory FP tracking ──────────────────────────
  const safeAlter = (sql: string) => {
    try { db.exec(sql); } catch (err: any) {
      if (!String(err?.message || '').toLowerCase().includes('duplicate column')) {
        console.warn('[Migration] failed:', err?.message);
      }
    }
  };
  safeAlter('ALTER TABLE ioc_memory          ADD COLUMN fp_count     INTEGER DEFAULT 0');
  safeAlter('ALTER TABLE ioc_memory          ADD COLUMN tp_count     INTEGER DEFAULT 0');
  safeAlter('ALTER TABLE incident_insights   ADD COLUMN triggered_by TEXT DEFAULT \'triage\'');
  safeAlter('ALTER TABLE api_keys            ADD COLUMN paused               INTEGER DEFAULT 0');
  safeAlter('ALTER TABLE api_keys            ADD COLUMN min_severity_override INTEGER');

  // ── Seed known-asset entries (idempotent — won't overwrite manual changes) ──
  const seedAsset = db.prepare(`
    INSERT OR IGNORE INTO asset_context (value, type, role, description, fp_default, source)
    VALUES (?, ?, ?, ?, ?, 'system_seed')
  `);
  seedAsset.run('172.10.9.10', 'ip',   'scanner',    'OpenVAS vulnerability scanner — authorized daily scans 02:00–04:00', 1);
  seedAsset.run('10.0.0.50',  'ip',   'scanner',    'Nessus vulnerability scanner — authorized weekly scans', 1);
  seedAsset.run('10.0.0.30',  'ip',   'monitoring', 'Internal monitoring host — Zabbix/healthcheck probes', 1);
  seedAsset.run('10.0.0.20',  'ip',   'backup',     'Backup service host — nightly backup jobs run as root', 1);
  seedAsset.run('10.0.0.99',  'ip',   'monitoring', 'QA test bench — automated smoke tests', 1);
  seedAsset.run('backup-svc', 'user', 'backup',     'Backup service account — runs tar/rsync under sudo', 1);
  seedAsset.run('monitoring', 'user', 'monitoring', 'Monitoring service account — healthcheck SSH probes', 1);

  // ── Pipeline redesign migrations ──────────────────────────────────────────
  safeAlter("ALTER TABLE alerts ADD COLUMN fp_method       TEXT");           // suppression | memory | triage | null
  safeAlter("ALTER TABLE alerts ADD COLUMN fp_confidence   REAL DEFAULT 0");
  safeAlter("ALTER TABLE alerts ADD COLUMN fp_reason       TEXT");
  safeAlter("ALTER TABLE alerts ADD COLUMN fp_details      TEXT");           // JSON
  safeAlter("ALTER TABLE alerts ADD COLUMN triage_data     TEXT");           // JSON — cached triage from FP scan
  safeAlter("ALTER TABLE alerts ADD COLUMN filtered_at     DATETIME");
  safeAlter("ALTER TABLE alerts ADD COLUMN investigated_at DATETIME");
  safeAlter("ALTER TABLE alerts ADD COLUMN escalated_at    DATETIME");
  safeAlter("ALTER TABLE alerts ADD COLUMN closed_at       DATETIME");

  // ── Incident management migrations ────────────────────────────────────────
  safeAlter("ALTER TABLE incidents ADD COLUMN phase TEXT DEFAULT 'analysis'");
  safeAlter("ALTER TABLE incidents ADD COLUMN escalated_by INTEGER");
  safeAlter("ALTER TABLE incidents ADD COLUMN escalated_at DATETIME");
  safeAlter("ALTER TABLE incidents ADD COLUMN closed_by INTEGER");
  safeAlter("ALTER TABLE incidents ADD COLUMN closed_at DATETIME");
  safeAlter("ALTER TABLE incidents ADD COLUMN glpi_ticket_id TEXT");
  safeAlter("ALTER TABLE incidents ADD COLUMN reason TEXT");
  safeAlter("ALTER TABLE incidents ADD COLUMN report_body TEXT");
  safeAlter("ALTER TABLE incident_actions ADD COLUMN order_index INTEGER DEFAULT 0");

  // One-time correction: align existing incidents with the new status rule
  // (unassigned + early-phase → OPEN, not IN_PROGRESS).
  try {
    const fixed = db.prepare(`
      UPDATE incidents
      SET status = 'OPEN'
      WHERE status = 'IN_PROGRESS'
        AND assigned_to IS NULL
        AND phase IN ('detection', 'analysis', 'containment')
    `).run();
    if (fixed.changes > 0) console.log(`[Backfill] Reverted ${fixed.changes} unassigned incident(s) to OPEN status`);
  } catch (err: any) {
    console.warn('[Backfill] Status correction failed:', err?.message);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS incident_timeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      phase_from TEXT,
      phase_to TEXT,
      status_from TEXT,
      status_to TEXT,
      user_id INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_incident_timeline_incident ON incident_timeline(incident_id);

    CREATE TABLE IF NOT EXISTS incident_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id TEXT NOT NULL,
      action_type TEXT NOT NULL,        -- block_ip | isolate_host | disable_user | reset_password | collect_forensics | firewall_rule | escalate | other
      target TEXT,                       -- IP / host / user / file
      priority TEXT DEFAULT 'MEDIUM',    -- CRITICAL | HIGH | MEDIUM | LOW
      status TEXT DEFAULT 'pending',     -- pending | approved | executed | failed | skipped
      source TEXT DEFAULT 'ai',          -- ai | analyst | playbook
      description TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      executed_at DATETIME,
      executed_by INTEGER,
      FOREIGN KEY(incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
      FOREIGN KEY(created_by) REFERENCES users(id),
      FOREIGN KEY(executed_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_incident_actions_incident ON incident_actions(incident_id);
  `);

  // Backfill: any existing ESCALATED alerts with no incident record → create one
  try {
    const orphans = db.prepare(`
      SELECT a.id, a.description, a.severity, a.ai_analysis, a.escalated_at
      FROM alerts a
      LEFT JOIN incident_alerts ia ON ia.alert_id = a.id
      WHERE a.status = 'ESCALATED' AND ia.alert_id IS NULL
    `).all() as any[];
    if (orphans.length > 0) {
      const insIncident = db.prepare(
        `INSERT INTO incidents (id, title, severity, status, phase, escalated_at, analysis, action_plan, reason)
         VALUES (?, ?, ?, 'OPEN', 'analysis', COALESCE(?, datetime('now')), ?, ?, 'Backfilled from existing escalated alert')`
      );
      const linkAlert = db.prepare('INSERT OR IGNORE INTO incident_alerts (incident_id, alert_id) VALUES (?, ?)');
      const insTimeline = db.prepare(
        `INSERT INTO incident_timeline (incident_id, event_type, phase_to, status_to, note)
         VALUES (?, 'created', 'analysis', 'OPEN', 'Backfilled from existing escalated alert')`
      );
      for (const a of orphans) {
        let priority = 'HIGH';
        let actionPlan: string | null = null;
        try {
          const j = JSON.parse(a.ai_analysis || '{}');
          priority = j?.ticket?.priority || j?.phaseData?.ticket?.priority || 'HIGH';
          actionPlan = j?.response?.actions ? JSON.stringify(j.response.actions) : null;
        } catch {}
        const incId = `INC-${a.id.slice(0, 8).toUpperCase()}`;
        try {
          insIncident.run(incId, (a.description || 'Untitled').slice(0, 200), priority, a.escalated_at, a.ai_analysis || null, actionPlan);
          linkAlert.run(incId, a.id);
          insTimeline.run(incId);
        } catch { /* already exists */ }
      }
      console.log(`[Backfill] Created ${orphans.length} incident records for existing escalated alerts`);
    }
  } catch (err: any) {
    console.warn('[Backfill] Incident creation failed:', err?.message);
  }

  // Backfill: populate report_body + incident_actions for incidents that pre-existed the schema
  try {
    const incidentsNoActions = db.prepare(`
      SELECT i.id, i.title, i.severity, i.analysis, i.report_body
      FROM incidents i
      LEFT JOIN incident_actions a ON a.incident_id = i.id
      WHERE a.id IS NULL
      GROUP BY i.id
    `).all() as any[];

    const setReport = db.prepare('UPDATE incidents SET report_body = ? WHERE id = ? AND (report_body IS NULL OR report_body = \'\')');
    const insAction = db.prepare(
      `INSERT INTO incident_actions (incident_id, action_type, target, priority, status, source, description, order_index)
       VALUES (?, ?, ?, ?, 'pending', 'ai', ?, ?)`
    );
    const getLinkedAlertSrc = db.prepare(
      `SELECT a.source_ip, a.dest_ip, a.user, a.agent_name, a.description
       FROM alerts a INNER JOIN incident_alerts ia ON ia.alert_id = a.id
       WHERE ia.incident_id = ? LIMIT 1`
    );

    // Heuristic action sets keyed on title patterns
    function defaultActionsForTitle(title: string, severity: string, alertCtx: any): { type: string; target: string | null; priority: string; desc: string }[] {
      const t = (title || '').toLowerCase();
      const ip   = alertCtx?.source_ip || null;
      const user = alertCtx?.user || null;
      const host = alertCtx?.agent_name || null;
      const sev  = severity || 'MEDIUM';

      const out: { type: string; target: string | null; priority: string; desc: string }[] = [];

      if (/exfil|data.*transfer|outbound/.test(t)) {
        if (ip)   out.push({ type: 'block_ip',          target: ip,   priority: 'CRITICAL', desc: `Block outbound traffic to suspicious destination (${ip})` });
        if (host) out.push({ type: 'isolate_host',      target: host, priority: 'CRITICAL', desc: `Isolate ${host} from the network to stop ongoing exfiltration` });
                  out.push({ type: 'collect_forensics', target: host, priority: 'HIGH',     desc: 'Capture memory dump and disk image of the affected host' });
                  out.push({ type: 'firewall_rule',     target: ip,   priority: 'HIGH',     desc: 'Add permanent egress block for the destination IP at the perimeter firewall' });
                  out.push({ type: 'escalate',          target: null, priority: 'HIGH',     desc: 'Notify incident lead — possible data breach' });
      } else if (/lateral|pass.?the.?hash|smb/.test(t)) {
        if (ip)   out.push({ type: 'block_ip',          target: ip,   priority: 'CRITICAL', desc: `Block lateral source IP ${ip} at internal firewall` });
        if (host) out.push({ type: 'isolate_host',      target: host, priority: 'CRITICAL', desc: `Quarantine ${host} pending containment` });
        if (user) out.push({ type: 'disable_user',      target: user, priority: 'HIGH',     desc: `Disable potentially compromised account ${user}` });
        if (user) out.push({ type: 'reset_password',    target: user, priority: 'HIGH',     desc: `Force password reset and revoke active sessions for ${user}` });
                  out.push({ type: 'collect_forensics', target: host, priority: 'HIGH',     desc: 'Capture memory + Windows event logs for credential theft analysis' });
      } else if (/privilege.*escalation|sudo|uac.*bypass|kerberoast/.test(t)) {
        if (user) out.push({ type: 'disable_user',      target: user, priority: 'CRITICAL', desc: `Disable account ${user} immediately` });
        if (host) out.push({ type: 'isolate_host',      target: host, priority: 'HIGH',     desc: `Isolate ${host} for forensic analysis` });
                  out.push({ type: 'collect_forensics', target: host, priority: 'HIGH',     desc: 'Capture sudoers/auth logs and memory dump' });
                  out.push({ type: 'reset_password',    target: user, priority: 'HIGH',     desc: 'Reset password and rotate any service-account credentials touched by the user' });
      } else if (/c2|beacon|command.*control/.test(t)) {
        if (ip)   out.push({ type: 'block_ip',          target: ip,   priority: 'CRITICAL', desc: `Block C2 destination ${ip} at perimeter` });
        if (host) out.push({ type: 'isolate_host',      target: host, priority: 'CRITICAL', desc: `Isolate beaconing host ${host}` });
                  out.push({ type: 'firewall_rule',     target: ip,   priority: 'HIGH',     desc: 'Add IDS signature for the C2 indicator and propagate to all egress points' });
                  out.push({ type: 'collect_forensics', target: host, priority: 'HIGH',     desc: 'Pull DNS and process logs to identify the implant' });
      } else if (/ransomware|encrypt/.test(t)) {
        if (host) out.push({ type: 'isolate_host',      target: host, priority: 'CRITICAL', desc: `Immediately isolate ${host} from network and shared storage` });
                  out.push({ type: 'collect_forensics', target: host, priority: 'CRITICAL', desc: 'Memory dump + suspend running processes for malware analysis' });
                  out.push({ type: 'escalate',          target: null, priority: 'CRITICAL', desc: 'Activate ransomware response runbook — notify CISO + legal' });
                  out.push({ type: 'firewall_rule',     target: null, priority: 'HIGH',     desc: 'Block known ransomware family C2 patterns at perimeter' });
      } else if (/webshell|backdoor|web.*upload/.test(t)) {
        if (host) out.push({ type: 'isolate_host',      target: host, priority: 'CRITICAL', desc: `Take ${host} offline pending malware analysis` });
                  out.push({ type: 'collect_forensics', target: host, priority: 'HIGH',     desc: 'Snapshot the webshell file and surrounding directory contents' });
        if (ip)   out.push({ type: 'block_ip',          target: ip,   priority: 'HIGH',     desc: `Block source IP ${ip} that uploaded the artifact` });
                  out.push({ type: 'firewall_rule',     target: null, priority: 'MEDIUM',   desc: 'Add WAF rule blocking PHP/JSP uploads to public directories' });
      } else if (/brute.?force|failed.*login|authentication/.test(t)) {
        if (ip)   out.push({ type: 'block_ip',          target: ip,   priority: 'HIGH',     desc: `Block source IP ${ip} at perimeter — brute-force origin` });
        if (user) out.push({ type: 'reset_password',    target: user, priority: 'HIGH',     desc: `Force password reset for ${user} and enforce MFA` });
                  out.push({ type: 'firewall_rule',     target: ip,   priority: 'MEDIUM',   desc: 'Lower auth-failure threshold and add geofencing if applicable' });
      } else if (/dns|domain/.test(t)) {
        if (host) out.push({ type: 'isolate_host',      target: host, priority: 'HIGH',     desc: `Isolate ${host} pending malware scan` });
                  out.push({ type: 'firewall_rule',     target: null, priority: 'HIGH',     desc: 'Sinkhole the suspicious DNS domain at the resolver' });
                  out.push({ type: 'collect_forensics', target: host, priority: 'MEDIUM',   desc: 'Capture DNS query history and process tree from the host' });
      } else if (/scan|port|recon/.test(t)) {
        if (ip)   out.push({ type: 'block_ip',          target: ip,   priority: 'MEDIUM', desc: `Block scanning source ${ip}` });
                  out.push({ type: 'firewall_rule',     target: ip,   priority: 'MEDIUM', desc: 'Add reconnaissance pattern to IDS signatures' });
      } else {
        // Generic fallback
                  out.push({ type: 'collect_forensics', target: host, priority: sev,        desc: 'Capture relevant logs and artifacts from the affected system' });
        if (ip)   out.push({ type: 'block_ip',          target: ip,   priority: sev,        desc: `Review and block source ${ip} if confirmed malicious` });
                  out.push({ type: 'escalate',          target: null, priority: sev,        desc: 'Engage incident lead for assessment and containment plan' });
      }
      return out;
    }

    function fallbackReport(title: string, severity: string, alertCtx: any): string {
      const ip   = alertCtx?.source_ip ? ` from source IP \`${alertCtx.source_ip}\`` : '';
      const host = alertCtx?.agent_name ? ` on host \`${alertCtx.agent_name}\`` : '';
      return `**${title}**\n\nSeverity: ${severity}${ip}${host}\n\n` +
             `Initial detection raised this incident from the alerts queue. ` +
             `Recommended response actions are listed below — execute, mark each one as completed in the Response Actions panel, and update this report with the outcome of each step.\n\n` +
             `## Investigation\n_To be completed by the assigned analyst._\n\n` +
             `## Containment\n_Document containment steps taken and their effectiveness._\n\n` +
             `## Remediation\n_Document permanent fixes and any policy changes._\n\n` +
             `## Lessons Learned\n_Post-incident review notes._\n`;
    }

    let totalActions = 0;
    let reportsBackfilled = 0;
    for (const inc of incidentsNoActions) {
      try {
        let usedSource = 'fallback';
        let order = 0;
        let createdAny = false;

        // Try analysis JSON first
        try {
          const j = JSON.parse(inc.analysis || '{}');
          const reportBody = j?.ticket?.report_body || j?.phaseData?.ticket?.report_body || null;
          if (reportBody) { setReport.run(reportBody, inc.id); reportsBackfilled++; }

          const planActions: any[] = j?.response?.actions || j?.phaseData?.response?.actions || [];
          for (const a of (Array.isArray(planActions) ? planActions : [])) {
            const text = typeof a === 'string' ? a : (a?.action || a?.description || a?.title || JSON.stringify(a));
            const lower = String(text || '').toLowerCase();
            let actionType = 'other';
            if      (/block.*ip|firewall block/.test(lower))             actionType = 'block_ip';
            else if (/isolate|quarantine|disconnect/.test(lower))        actionType = 'isolate_host';
            else if (/disable.*user|disable.*account/.test(lower))       actionType = 'disable_user';
            else if (/reset password|password reset/.test(lower))        actionType = 'reset_password';
            else if (/forensic|memory dump|capture|collect/.test(lower)) actionType = 'collect_forensics';
            else if (/firewall rule|acl|policy/.test(lower))             actionType = 'firewall_rule';
            else if (/escalate|notify lead/.test(lower))                 actionType = 'escalate';
            const target = a?.target || a?.ip || a?.user || a?.host || null;
            const priority = a?.priority || inc.severity || 'MEDIUM';
            const desc = String(text || '').slice(0, 500);
            insAction.run(inc.id, actionType, target, priority, desc, order++);
            totalActions++;
            createdAny = true;
            usedSource = 'analysis';
          }
        } catch { /* malformed analysis JSON */ }

        // Heuristic fallback: derive from title + linked alert context
        if (!createdAny) {
          const alertCtx = getLinkedAlertSrc.get(inc.id) as any;
          const heuristic = defaultActionsForTitle(inc.title || '', inc.severity || 'MEDIUM', alertCtx);
          for (const a of heuristic) {
            insAction.run(inc.id, a.type, a.target, a.priority, a.desc, order++);
            totalActions++;
          }
          // Also generate a default report body if missing
          if (!inc.report_body) {
            setReport.run(fallbackReport(inc.title || 'Incident', inc.severity || 'MEDIUM', alertCtx), inc.id);
            reportsBackfilled++;
          }
        }
      } catch { /* skip on error */ }
    }
    if (totalActions > 0 || reportsBackfilled > 0) {
      console.log(`[Backfill] Seeded ${totalActions} action(s) + ${reportsBackfilled} report_body across ${incidentsNoActions.length} pre-existing incident(s)`);
    }
  } catch (err: any) {
    console.warn('[Backfill] Action/report backfill failed:', err?.message);
  }

  // ── One-time backfill: bring existing alerts under the new FP-archive rules ──
  // Idempotent — only touches rows that don't already have an FP classification.
  try {
    const lowPriorityResult = db.prepare(`
      UPDATE alerts
      SET status = 'FALSE_POSITIVE',
          fp_method = 'noise_priority',
          fp_reason = 'Triaged as ' || COALESCE(
            json_extract(ai_analysis, '$.ticket.priority'),
            json_extract(ai_analysis, '$.phaseData.ticket.priority'),
            'LOW/MEDIUM'
          ) || ' priority — auto-archived (only HIGH+ reach analysts) [backfilled]',
          fp_confidence = 0.6,
          filtered_at = COALESCE(filtered_at, datetime('now'))
      WHERE status IN ('TRIAGED', 'CLOSED')
        AND ai_analysis IS NOT NULL
        AND (
          json_extract(ai_analysis, '$.ticket.priority') IN ('LOW', 'MEDIUM')
          OR json_extract(ai_analysis, '$.phaseData.ticket.priority') IN ('LOW', 'MEDIUM')
        )
    `).run();
    if (lowPriorityResult.changes > 0) {
      console.log(`[Backfill] Reclassified ${lowPriorityResult.changes} LOW/MEDIUM-priority alerts → FP archive`);
    }

    // Backfill: alerts that the agents already flagged as FP but where fp_method is missing
    // (legacy rows where we wrote status only). Tag them as 'triage' so the badge renders.
    const fpMissingMethod = db.prepare(`
      UPDATE alerts
      SET fp_method = 'triage',
          fp_reason = COALESCE(fp_reason, 'Agent classified as false positive'),
          fp_confidence = COALESCE(NULLIF(fp_confidence, 0), 0.75),
          filtered_at = COALESCE(filtered_at, datetime('now'))
      WHERE status = 'FALSE_POSITIVE'
        AND fp_method IS NULL
        AND ai_analysis IS NOT NULL
    `).run();
    if (fpMissingMethod.changes > 0) {
      console.log(`[Backfill] Tagged ${fpMissingMethod.changes} legacy FP rows with fp_method='triage'`);
    }

    // Backfill: manually-confirmed FPs (FP_CONFIRMED) get fp_method='analyst' so the badge
    // doesn't show '?' for the ones the user clicked "Confirm FP" on.
    const confirmedMissingMethod = db.prepare(`
      UPDATE alerts
      SET fp_method = 'analyst',
          fp_reason = COALESCE(fp_reason, 'Confirmed as false positive by analyst'),
          fp_confidence = COALESCE(NULLIF(fp_confidence, 0), 1.0),
          filtered_at = COALESCE(filtered_at, datetime('now'))
      WHERE status = 'FP_CONFIRMED'
        AND fp_method IS NULL
    `).run();
    if (confirmedMissingMethod.changes > 0) {
      console.log(`[Backfill] Tagged ${confirmedMissingMethod.changes} analyst-confirmed FPs with fp_method='analyst'`);
    }

    // Backfill: legacy FILTERED alerts (from the old two-step FP-scan path) → FALSE_POSITIVE.
    // These are alerts that the legacy FP-scan deemed not-FP-but-not-yet-investigated.
    // With the new auto-investigate flow, FILTERED is obsolete as a resting state — they belong in the archive.
    const legacyFiltered = db.prepare(`
      UPDATE alerts
      SET status = 'FALSE_POSITIVE',
          fp_method = COALESCE(fp_method, 'legacy_filter'),
          fp_reason = COALESCE(fp_reason, 'Legacy FP-scan filter — auto-archived'),
          fp_confidence = COALESCE(NULLIF(fp_confidence, 0), 0.7),
          filtered_at = COALESCE(filtered_at, datetime('now'))
      WHERE status = 'FILTERED'
    `).run();
    if (legacyFiltered.changes > 0) {
      console.log(`[Backfill] Moved ${legacyFiltered.changes} legacy FILTERED alerts → FP archive`);
    }
  } catch (err: any) {
    console.warn('[Backfill] FP archive reclassification failed:', err?.message);
  }

  // Seed admin user if not exists
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)')
      .run('admin', hashedPassword, 'admin@aisoc.local', 'ADMIN');
  }

  // Seed default playbooks if none exist
  const playbookCount = (db.prepare('SELECT COUNT(*) as c FROM playbooks').get() as any).c;
  if (playbookCount === 0) {
    const seedPlaybooks = [
      { tactic: 'CREDENTIAL_ACCESS', title: 'Brute Force Response', steps: '1. Block source IP at firewall\n2. Lock affected account temporarily\n3. Notify account owner\n4. Review auth logs for past 24h\n5. Enable MFA if not already active' },
      { tactic: 'COMMAND_AND_CONTROL', title: 'C2 Beacon Containment', steps: '1. Isolate affected host from network\n2. Block destination IP/domain at perimeter\n3. Capture memory image for forensics\n4. Scan all hosts for same beacon signature\n5. Rotate credentials on affected system' },
      { tactic: 'LATERAL_MOVEMENT', title: 'Lateral Movement Containment', steps: '1. Identify all systems accessed by compromised account\n2. Reset credentials for affected accounts\n3. Enable network segmentation between affected segments\n4. Review and revoke excessive privileges\n5. Deploy EDR hunting for lateral movement artifacts' },
      { tactic: 'EXFILTRATION', title: 'Data Exfiltration Response', steps: '1. Immediately block outbound traffic to destination\n2. Preserve network traffic logs\n3. Identify what data was transferred\n4. Notify DPO/legal team if PII involved\n5. Review DLP policy and tighten egress rules' },
      { tactic: 'PRIVILEGE_ESCALATION', title: 'Privilege Escalation Remediation', steps: '1. Revoke elevated privileges immediately\n2. Review sudoers/admin group membership\n3. Audit all commands run with elevated privileges\n4. Patch the exploited vulnerability if applicable\n5. Review and harden privilege management policies' },
      { tactic: 'EXECUTION', title: 'Malicious Execution Response', steps: '1. Kill malicious process immediately\n2. Quarantine affected file to sandbox\n3. Scan all hosts for same file hash\n4. Review process tree for parent process origin\n5. Reimage host if persistence is confirmed' },
    ];
    const ins = db.prepare('INSERT INTO playbooks (tactic, title, steps) VALUES (?, ?, ?)');
    for (const pb of seedPlaybooks) ins.run(pb.tactic, pb.title, pb.steps);
    console.log('[DB] Seeded 6 default playbooks');
  }

  // Seed demo campaign alerts — always refresh timestamps so they stay in the 72-hour correlation window
  {
    const tsAgo = (h: number) =>
      new Date(Date.now() - h * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);

    const demoAlerts: Array<{
      id: string; hoursAgo: number; rule_id: string; description: string;
      severity: number; source_ip: string; dest_ip: string; user: string;
      hostname: string; agent_name: string; full_log: string;
    }> = [
      // g — newest (shown first in queue)
      {
        id: 'demo-exfil-001', hoursAgo: 2,
        rule_id: '92100',
        description: 'Data exfiltration: 2.3 GB transferred from DB-SERVER-02 to 185.220.101.45 over encrypted channel',
        severity: 15,
        source_ip: '10.0.1.20', dest_ip: '185.220.101.45',
        user: 'root', hostname: 'DB-SERVER-02', agent_name: 'DB-SERVER-02',
        full_log: JSON.stringify({ timestamp: tsAgo(2), rule: { id: '92100', description: 'Large outbound data transfer to suspicious IP', level: 15 }, data: { srcip: '10.0.1.20', dstip: '185.220.101.45', dstport: 443, bytes_out: 2469606400, proto: 'TCP', duration_seconds: 1847 }, agent: { name: 'DB-SERVER-02' } }),
      },
      // f
      {
        id: 'demo-privesc-001', hoursAgo: 8,
        rule_id: '5501',
        description: 'Privilege escalation: User svc_backup added to sudoers group on DB-SERVER-02',
        severity: 13,
        source_ip: '10.0.1.20', dest_ip: '',
        user: 'svc_backup', hostname: 'DB-SERVER-02', agent_name: 'DB-SERVER-02',
        full_log: JSON.stringify({ timestamp: tsAgo(8), rule: { id: '5501', description: 'User added to privileged group', level: 13 }, data: { user: 'svc_backup', group: 'sudo', command: 'usermod -aG sudo svc_backup', srcip: '10.0.1.20' }, agent: { name: 'DB-SERVER-02' } }),
      },
      // e
      {
        id: 'demo-lateral-001', hoursAgo: 14,
        rule_id: '60122',
        description: 'Lateral movement: Pass-the-hash attack from WEB-SERVER-01 to DB-SERVER-02 using stolen NTLM hash',
        severity: 14,
        source_ip: '10.0.1.10', dest_ip: '10.0.1.20',
        user: 'svc_backup', hostname: 'DB-SERVER-02', agent_name: 'DB-SERVER-02',
        full_log: JSON.stringify({ timestamp: tsAgo(14), rule: { id: '60122', description: 'Pass-the-hash attack detected', level: 14 }, data: { srcip: '10.0.1.10', dstip: '10.0.1.20', user: 'svc_backup', auth_type: 'NTLM', logon_type: 3, hash: 'aad3b435b51404eeaad3b435b51404ee' }, agent: { name: 'DB-SERVER-02' } }),
      },
      // d
      {
        id: 'demo-c2-beacon-001', hoursAgo: 20,
        rule_id: '87702',
        description: 'C2 beacon detected: WEB-SERVER-01 making periodic HTTPS requests to 77.91.68.45:8443',
        severity: 12,
        source_ip: '10.0.1.10', dest_ip: '77.91.68.45',
        user: 'www-data', hostname: 'WEB-SERVER-01', agent_name: 'WEB-SERVER-01',
        full_log: JSON.stringify({ timestamp: tsAgo(20), rule: { id: '87702', description: 'Known C2 framework beacon pattern', level: 12 }, data: { srcip: '10.0.1.10', dstip: '77.91.68.45', dstport: 8443, proto: 'HTTPS', interval_seconds: 60, user_agent: 'Mozilla/5.0' }, agent: { name: 'WEB-SERVER-01' } }),
      },
      // c
      {
        id: 'demo-webshell-001', hoursAgo: 28,
        rule_id: '31108',
        description: 'Webshell upload detected: PHP backdoor written to /var/www/html/uploads/ on WEB-SERVER-01',
        severity: 13,
        source_ip: '185.220.101.45', dest_ip: '10.0.1.10',
        user: 'www-data', hostname: 'WEB-SERVER-01', agent_name: 'WEB-SERVER-01',
        full_log: JSON.stringify({ timestamp: tsAgo(28), rule: { id: '31108', description: 'Web shell upload detected', level: 13 }, data: { srcip: '185.220.101.45', file: '/var/www/html/uploads/img_cache.php', md5: 'e3b0c44298fc1c149afb', content_type: 'application/x-php' }, agent: { name: 'WEB-SERVER-01' } }),
      },
      // b
      {
        id: 'demo-ssh-brute-001', hoursAgo: 36,
        rule_id: '5712',
        description: 'SSH brute-force attack: 185.220.101.45 made 347 failed login attempts on WEB-SERVER-01',
        severity: 10,
        source_ip: '185.220.101.45', dest_ip: '10.0.1.10',
        user: 'root', hostname: 'WEB-SERVER-01', agent_name: 'WEB-SERVER-01',
        full_log: JSON.stringify({ timestamp: tsAgo(36), rule: { id: '5712', description: 'SSHD brute force trying to get access to the system', level: 10 }, data: { srcip: '185.220.101.45', dstip: '10.0.1.10', user: 'root', attempts: 347 }, agent: { name: 'WEB-SERVER-01' } }),
      },
      // a — oldest (shown last in queue)
      {
        id: 'demo-recon-001', hoursAgo: 48,
        rule_id: '40101',
        description: 'Nmap SYN port scan: 185.220.101.45 scanned 1024 ports on GATEWAY-01',
        severity: 5,
        source_ip: '185.220.101.45', dest_ip: '10.0.1.1',
        user: '', hostname: 'GATEWAY-01', agent_name: 'GATEWAY-01',
        full_log: JSON.stringify({ timestamp: tsAgo(48), rule: { id: '40101', description: 'Nmap port scan detected', level: 5 }, data: { srcip: '185.220.101.45', dstip: '10.0.1.1', proto: 'TCP', flags: 'SYN', dstports: '22,80,443,3306,8080,8443' }, agent: { name: 'GATEWAY-01' } }),
      },

      // --- MISP IOC alerts (real malicious infrastructure) ---

      // MISP-1: DNS beacon to anhei.gotdns.com (known C2, resolves to 103.226.132.7)
      {
        id: 'demo-misp-dns-001', hoursAgo: 0.5,
        rule_id: '5300',
        description: 'DNS C2 beacon: WORKSTATION-12 queried known malicious domain anhei.gotdns.com (resolves to 103.226.132.7) — 47 queries in 10 minutes indicating periodic beaconing',
        severity: 14,
        source_ip: '10.0.2.15', dest_ip: '103.226.132.7',
        user: 'jsmith', hostname: 'WORKSTATION-12', agent_name: 'WORKSTATION-12',
        full_log: JSON.stringify({
          timestamp: tsAgo(0.5),
          rule: { id: '5300', description: 'DNS query to known C2 domain', level: 14 },
          data: {
            srcip: '10.0.2.15',
            dstip: '103.226.132.7',
            dstport: 53,
            proto: 'UDP',
            program_name: 'dns',
            dns: {
              question: { name: 'anhei.gotdns.com', type: 'A' },
              answers:  [{ name: 'anhei.gotdns.com', type: 'A', data: '103.226.132.7' }],
              query_count: 47,
              interval_seconds: 13,
            },
          },
          agent: { name: 'WORKSTATION-12', ip: '10.0.2.15' },
        }),
      },

      // MISP-2: Direct TCP connection to 103.226.132.7:8443 (known APT C2 node)
      {
        id: 'demo-misp-conn-001', hoursAgo: 1,
        rule_id: '87703',
        description: 'Outbound connection to known APT C2 server 103.226.132.7:8443 from WORKSTATION-22 (10.0.2.22) — TLS session with suspicious JA3 fingerprint matching Cobalt Strike',
        severity: 15,
        source_ip: '10.0.2.22', dest_ip: '103.226.132.7',
        user: 'mlopez', hostname: 'WORKSTATION-22', agent_name: 'WORKSTATION-22',
        full_log: JSON.stringify({
          timestamp: tsAgo(1),
          rule: { id: '87703', description: 'Outbound connection to known malicious IP', level: 15 },
          data: {
            srcip: '10.0.2.22',
            dstip: '103.226.132.7',
            dstport: 8443,
            proto: 'TCP',
            bytes_out: 18432,
            bytes_in: 4096,
            duration_seconds: 3600,
            tls: {
              ja3: '72a7c9feebf2d402c7053b2cc0ced61e',
              sni: '103.226.132.7',
              version: 'TLSv1.2',
            },
          },
          agent: { name: 'WORKSTATION-22', ip: '10.0.2.22' },
        }),
      },

      // MISP-3: DNS beaconing to apperu.gnway.cc (DGA-style C2 domain)
      {
        id: 'demo-misp-dga-001', hoursAgo: 1.5,
        rule_id: '5301',
        description: 'DGA-pattern C2 beacon: WORKSTATION-12 queried apperu.gnway.cc — domain exhibits DGA characteristics (random subdomain prefix, .cc TLD, dynamic DNS provider gnway), consistent with Emotet/Trickbot loader activity',
        severity: 13,
        source_ip: '10.0.2.15', dest_ip: '',
        user: 'jsmith', hostname: 'WORKSTATION-12', agent_name: 'WORKSTATION-12',
        full_log: JSON.stringify({
          timestamp: tsAgo(1.5),
          rule: { id: '5301', description: 'DGA-pattern DNS query to suspected C2 domain', level: 13 },
          data: {
            srcip: '10.0.2.15',
            dstport: 53,
            proto: 'UDP',
            program_name: 'dns',
            dns: {
              question: { name: 'apperu.gnway.cc', type: 'A' },
              query_count: 23,
              interval_seconds: 26,
            },
          },
          agent: { name: 'WORKSTATION-12', ip: '10.0.2.15' },
        }),
      },
    ];

    // Upsert: insert first time; on conflict refresh timestamp only if older than 70 hours (keeps alerts in 72h correlation window)
    const upsertAlert = db.prepare(`
      INSERT INTO alerts (id, timestamp, rule_id, description, severity, source_ip, dest_ip, user, hostname, agent_name, full_log, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW')
      ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp
      WHERE timestamp < datetime('now', '-70 hours')
    `);

    for (const a of demoAlerts) {
      upsertAlert.run(a.id, tsAgo(a.hoursAgo), a.rule_id, a.description, a.severity,
        a.source_ip, a.dest_ip, a.user, a.hostname, a.agent_name, a.full_log);
    }
    console.log('[DB] Seeded 7 demo campaign alerts (Operation Midnight APT)');
  }

  // ── Seed FP-candidate alerts (always reset to NEW so Noise Filter always has demos) ──
  {
    const tsAgo = (h: number) =>
      new Date(Date.now() - h * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);

    const fpCandidates = [
      // ── OpenVAS scanner (172.10.9.10) — asset_context fp_default=1 ──────────
      {
        id: 'fp-cand-openvas-xss-001',
        hoursAgo: 0.1,
        rule_id: '31103',
        description: 'Web attack: XSS attempt detected — <script>alert(document.cookie)</script> in POST /api/login body',
        severity: 8,
        source_ip: '172.10.9.10',
        dest_ip: '10.0.1.100',
        agent_name: 'web-app-01',
        full_log: JSON.stringify({
          rule: { id: '31103', description: 'Web attack: XSS (Cross-Site Scripting) attempt detected', level: 8 },
          data: {
            srcip: '172.10.9.10', dstip: '10.0.1.100', dstport: 443,
            url: '/api/login', method: 'POST', program_name: 'nginx',
            http: { request_body: '<script>alert(document.cookie)</script>', status: 403 },
            openvas: { scan_id: 'ov-scan-20240115', plugin_id: '10848', plugin_name: 'XSS injection test' },
          },
          agent: { name: 'web-app-01', ip: '10.0.1.100' },
        }),
      },
      {
        id: 'fp-cand-openvas-sqli-001',
        hoursAgo: 0.15,
        rule_id: '31106',
        description: "Web attack: SQL injection — ' UNION SELECT null,null,version()-- in GET /search?q=",
        severity: 9,
        source_ip: '172.10.9.10',
        dest_ip: '10.0.1.100',
        agent_name: 'web-app-01',
        full_log: JSON.stringify({
          rule: { id: '31106', description: 'SQL Injection attempt detected in URL parameter', level: 9 },
          data: {
            srcip: '172.10.9.10', dstip: '10.0.1.100', dstport: 443,
            url: "/search?q=' UNION SELECT null,null,version()--", method: 'GET', program_name: 'nginx',
            http: { status: 400 },
            openvas: { scan_id: 'ov-scan-20240115', plugin_id: '10913', plugin_name: 'SQL injection test' },
          },
          agent: { name: 'web-app-01', ip: '10.0.1.100' },
        }),
      },
      {
        id: 'fp-cand-openvas-traversal-001',
        hoursAgo: 0.2,
        rule_id: '31120',
        description: 'Web attack: Path traversal — ../../../../etc/passwd in GET /download?file=',
        severity: 8,
        source_ip: '172.10.9.10',
        dest_ip: '10.0.1.100',
        agent_name: 'web-app-01',
        full_log: JSON.stringify({
          rule: { id: '31120', description: 'Path traversal attack detected', level: 8 },
          data: {
            srcip: '172.10.9.10', dstip: '10.0.1.100', dstport: 443,
            url: '/download?file=../../../../etc/passwd', method: 'GET', program_name: 'nginx',
            http: { status: 403 },
            openvas: { scan_id: 'ov-scan-20240115', plugin_id: '10386', plugin_name: 'Path traversal test' },
          },
          agent: { name: 'web-app-01', ip: '10.0.1.100' },
        }),
      },
      {
        id: 'fp-cand-openvas-scan-001',
        hoursAgo: 0.3,
        rule_id: '40101',
        description: 'Port scan: OpenVAS host discovery — TCP SYN sweep across /24 subnet 10.0.1.0',
        severity: 7,
        source_ip: '172.10.9.10',
        dest_ip: '10.0.1.0',
        agent_name: 'firewall-01',
        full_log: JSON.stringify({
          rule: { id: '40101', description: 'Multiple ports scanned — possible port scan', level: 7 },
          data: {
            srcip: '172.10.9.10', dstip: '10.0.1.0', proto: 'TCP', program_name: 'iptables',
            ports_scanned: 1024, scan_type: 'SYN', rate: '500pps',
            openvas: { scan_id: 'ov-scan-20240115', type: 'host_discovery' },
          },
          agent: { name: 'firewall-01', ip: '10.0.1.1' },
        }),
      },
      // ── Nessus scanner (10.0.0.50) — asset_context fp_default=1 ─────────────
      {
        id: 'fp-cand-nessus-bruteforce-001',
        hoursAgo: 0.5,
        rule_id: '5712',
        description: 'SSH brute-force: 523 failed login attempts from 10.0.0.50 in 2 minutes',
        severity: 10,
        source_ip: '10.0.0.50',
        dest_ip: '10.0.1.50',
        agent_name: 'ssh-server-01',
        full_log: JSON.stringify({
          rule: { id: '5712', description: 'SSHD brute force trying to get access to the system', level: 10 },
          data: {
            srcip: '10.0.0.50', dstip: '10.0.1.50', dstport: 22, program_name: 'sshd',
            failed_attempts: 523, interval_seconds: 120,
            nessus: { scan_id: 'nessus-weekly-001', plugin_id: '10205', plugin_name: 'SSH Server Default Credentials' },
          },
          agent: { name: 'ssh-server-01', ip: '10.0.1.50' },
        }),
      },
      {
        id: 'fp-cand-nessus-vuln-001',
        hoursAgo: 0.6,
        rule_id: '40305',
        description: 'Vulnerability scan: Nessus probing SMB/445 for MS17-010 EternalBlue',
        severity: 9,
        source_ip: '10.0.0.50',
        dest_ip: '10.0.1.80',
        agent_name: 'win-server-01',
        full_log: JSON.stringify({
          rule: { id: '40305', description: 'SMB exploit attempt: EternalBlue probe detected', level: 9 },
          data: {
            srcip: '10.0.0.50', dstip: '10.0.1.80', dstport: 445, proto: 'TCP', program_name: 'snort',
            cve: 'CVE-2017-0144', exploit: 'EternalBlue',
            nessus: { scan_id: 'nessus-weekly-001', plugin_id: '97833', plugin_name: 'MS17-010 Check' },
          },
          agent: { name: 'win-server-01', ip: '10.0.1.80' },
        }),
      },
      // ── Backup service (10.0.0.20) — asset_context fp_default=1 ─────────────
      {
        id: 'fp-cand-backup-sudo-001',
        hoursAgo: 0.8,
        rule_id: '5402',
        description: 'Privilege escalation: backup-svc ran rsync as root — /var/backups/full-20240115.tar.gz',
        severity: 8,
        source_ip: '10.0.0.20',
        dest_ip: '',
        agent_name: 'backup-host-01',
        full_log: JSON.stringify({
          rule: { id: '5402', description: 'Sudo command run by user', level: 8 },
          data: {
            srcip: '10.0.0.20', program_name: 'sudo',
            srcuser: 'backup-svc', run_as: 'root',
            command: '/usr/bin/rsync -avz /data/ /mnt/backup/full-20240115/',
            cwd: '/home/backup-svc',
          },
          agent: { name: 'backup-host-01', ip: '10.0.0.20' },
        }),
      },
      {
        id: 'fp-cand-backup-cron-001',
        hoursAgo: 1.0,
        rule_id: '2930',
        description: 'Suspicious file access: logrotate compressed /var/log/auth.log during scheduled rotation',
        severity: 4,
        source_ip: '10.0.0.10',
        dest_ip: '',
        agent_name: 'siem-server-01',
        full_log: JSON.stringify({
          rule: { id: '2930', description: 'Log file modified or rotated', level: 4 },
          data: {
            srcip: '10.0.0.10', program_name: 'logrotate',
            file: '/var/log/auth.log', action: 'compress',
            triggered_by: 'cron', user: 'root', schedule: '0 4 * * *',
          },
          agent: { name: 'siem-server-01', ip: '10.0.0.10' },
        }),
      },
      // ── Monitoring host (10.0.0.30) — asset_context fp_default=1 ─────────────
      {
        id: 'fp-cand-monitor-ssh-001',
        hoursAgo: 1.2,
        rule_id: '5760',
        description: 'Multiple failed SSH logins: monitoring user made 48 attempts against 12 hosts (Zabbix agent check)',
        severity: 6,
        source_ip: '10.0.0.30',
        dest_ip: '10.0.1.0',
        agent_name: 'monitoring-01',
        full_log: JSON.stringify({
          rule: { id: '5760', description: 'Multiple SSH authentication failures from same source', level: 6 },
          data: {
            srcip: '10.0.0.30', dstport: 22, program_name: 'sshd',
            srcuser: 'monitoring', failed_attempts: 48, unique_hosts: 12,
            zabbix: { check_type: 'ssh_agent_reachability', interval: 60 },
          },
          agent: { name: 'monitoring-01', ip: '10.0.0.30' },
        }),
      },
      {
        id: 'fp-cand-monitor-http-001',
        hoursAgo: 1.4,
        rule_id: '31101',
        description: 'Automated web probe: 240 GET /health requests/hr from Zabbix monitoring — HTTP 200',
        severity: 3,
        source_ip: '10.0.0.30',
        dest_ip: '10.0.1.100',
        agent_name: 'web-app-01',
        full_log: JSON.stringify({
          rule: { id: '31101', description: 'Repetitive web requests from same source', level: 3 },
          data: {
            srcip: '10.0.0.30', dstip: '10.0.1.100', dstport: 80,
            url: '/health', method: 'GET', program_name: 'nginx',
            user_agent: 'Zabbix HTTP check/6.0', request_count: 240, interval_seconds: 15, http_status: 200,
          },
          agent: { name: 'web-app-01', ip: '10.0.1.100' },
        }),
      },
      // ── Test bench (10.0.0.99) — asset_context fp_default=1 ─────────────────
      {
        id: 'fp-cand-test-pentest-001',
        hoursAgo: 1.6,
        rule_id: '99001',
        description: 'Penetration test: OWASP ZAP active scan — automated security test suite initiated',
        severity: 8,
        source_ip: '10.0.0.99',
        dest_ip: '10.0.1.100',
        agent_name: 'test-bench',
        full_log: JSON.stringify({
          rule: { id: '99001', description: 'Multiple web attack signatures detected — possible pentest', level: 8 },
          data: {
            srcip: '10.0.0.99', dstip: '10.0.1.100', dstport: 443,
            program_name: 'nginx', user_agent: 'Mozilla/5.0 (compatible; OWASP ZAP/2.14.0)',
            attack_types: ['xss', 'sqli', 'path_traversal', 'cmdi'],
            test_run_id: 'zap-scan-ci-20240115-0900',
          },
          agent: { name: 'test-bench', ip: '10.0.0.99' },
        }),
      },
      // ── False-positive-by-pattern (triage LLM rules) ──────────────────────────
      {
        id: 'fp-cand-nmap-internal-001',
        hoursAgo: 1.8,
        rule_id: '40100',
        description: 'Nmap scan: internal network discovery — nmap -sV -p 1-65535 10.0.0.0/16 by sysadmin',
        severity: 6,
        source_ip: '10.0.1.200',
        dest_ip: '10.0.0.0',
        agent_name: 'sysadmin-ws',
        full_log: JSON.stringify({
          rule: { id: '40100', description: 'Nmap port scanner detected', level: 6 },
          data: {
            srcip: '10.0.1.200', dstip: '10.0.0.0', proto: 'TCP', program_name: 'snort',
            tool: 'nmap', flags: '-sV -p 1-65535', target: '10.0.0.0/16', user: 'sysadmin',
          },
          agent: { name: 'sysadmin-ws', ip: '10.0.1.200' },
        }),
      },
    ];

    // Always reset these to NEW so Noise Filter always has alerts to demo
    const upsertFpCandidate = db.prepare(`
      INSERT INTO alerts (id, timestamp, rule_id, description, severity, source_ip, dest_ip, agent_name, full_log, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW')
      ON CONFLICT(id) DO UPDATE SET
        timestamp  = excluded.timestamp,
        status     = 'NEW',
        fp_method  = NULL,
        fp_confidence = NULL,
        fp_reason  = NULL,
        fp_details = NULL,
        triage_data = NULL,
        filtered_at = NULL,
        ai_analysis = NULL
    `);

    for (const a of fpCandidates) {
      upsertFpCandidate.run(a.id, tsAgo(a.hoursAgo), a.rule_id, a.description,
        a.severity, a.source_ip, a.dest_ip || null, a.agent_name, a.full_log);
    }
    console.log(`[DB] Seeded ${fpCandidates.length} FP-candidate alerts (status=NEW) for Noise Filter demo`);
  }

  // ── Seed default suppression rules (INSERT OR IGNORE — won't overwrite user edits) ──
  {
    const suppTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='suppression_rules'").get();
    if (suppTable) {
      const seedRule = db.prepare(`
        INSERT OR IGNORE INTO suppression_rules
          (name, source_ip_pattern, description_pattern, min_severity, max_severity, reason, enabled, created_by)
        VALUES (?, ?, ?, ?, ?, ?, 1, 'system_seed')
      `);
      seedRule.run('OpenVAS Scanner Traffic',  '172.10.9.10',   null,                   0, 15, 'Authorized OpenVAS vulnerability scanner — all traffic from this IP is expected');
      seedRule.run('Nessus Scanner Traffic',   '10.0.0.50',     null,                   0, 15, 'Authorized Nessus vulnerability scanner — all traffic from this IP is expected');
      seedRule.run('Nmap Internal Scan',       null,            'nmap',                 0, 8,  'Internal nmap scans by sysadmin are authorized and scheduled');
      seedRule.run('Test/Smoke Alerts',        null,            'test|smoke|pentest',   0, 9,  'Automated test and pentest alerts from CI/CD or QA bench');
      seedRule.run('Logrotate/Cron Activity',  null,            'logrotate|cron',       0, 6,  'Scheduled log rotation and cron activity is expected system maintenance');
    }
  }

  // Seed integration rows if not already present (INSERT OR IGNORE preserves user config)
  const seedIntegration = db.prepare(
    'INSERT OR IGNORE INTO integrations (name, enabled, config, auto_send_threshold) VALUES (?, ?, ?, ?)'
  );
  const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  seedIntegration.run('email', smtpConfigured ? 1 : 0,
    JSON.stringify({
      smtp_host: process.env.SMTP_HOST || '',
      smtp_port: process.env.SMTP_PORT || '587',
      smtp_user: process.env.SMTP_USER || '',
      smtp_pass: process.env.SMTP_PASS || '',
      from:      process.env.SMTP_USER || '',
      to:        process.env.ALERT_EMAIL_TO || '',
    }), 'HIGH');
  seedIntegration.run('glpi', 0,
    JSON.stringify({ url: process.env.GLPI_URL || '', app_token: process.env.GLPI_APP_TOKEN || '', user_token: process.env.GLPI_USER_TOKEN || '' }), 'CRITICAL');
  seedIntegration.run('telegram', 0,
    JSON.stringify({ bot_token: process.env.TELEGRAM_BOT_TOKEN || '', chat_id: process.env.TELEGRAM_CHAT_ID || '' }), 'MEDIUM');
  seedIntegration.run('slack', 0,
    JSON.stringify({ webhook_url: '' }), 'HIGH');

  // Wazuh ingest filter config — INSERT OR IGNORE preserves user changes across restarts
  seedIntegration.run('wazuh', 1,
    JSON.stringify({
      min_severity:         '7',
      dedup_window_minutes: '5',
      max_alerts_per_min:   '60',
      time_window_start:    '',
      time_window_end:      '',
      auto_orchestrate:     'true',
    }), 'NEVER');

  // Seed local LLM defaults
  const seedLocalCfg = db.prepare('INSERT OR IGNORE INTO local_llm_config (key, value) VALUES (?, ?)');
  seedLocalCfg.run('url',     'http://localhost:11434');
  seedLocalCfg.run('enabled', '0');
  // Apply stored URL to the LLM client module
  const storedLocalUrl = (db.prepare("SELECT value FROM local_llm_config WHERE key='url'").get() as any)?.value;
  if (storedLocalUrl) setLocalLLMBaseUrl(storedLocalUrl);

  // Seed model assignments only if a phase has no entry yet — preserves user overrides across restarts
  const seedAgentSetting = db.prepare(
    'INSERT OR IGNORE INTO agent_settings (phase, model) VALUES (?, ?)'
  );
  for (const phase of AGENT_PHASES) {
    seedAgentSetting.run(phase, DEFAULT_AGENT_MODELS[phase]);
  }
} catch (err) {
  console.error('Database initialization failed:', err);
  process.exit(1);
}

// --- JSON helpers -----------------------------------------------------------
function safeParseJsonArray(s: any): any[] {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

// --- Audit helper -----------------------------------------------------------
function writeAudit(userId: number | null, action: string, details: string) {
  try {
    const id = Math.random().toString(36).slice(2, 11);
    db.prepare('INSERT INTO audit_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)').run(id, userId, action, details);
  } catch (err: any) {
    console.warn('[Audit] write failed:', err?.message);
  }
}

// --- Integration dispatch helper -------------------------------------------
const PRIORITY_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, NEVER: 0 };

async function dispatchActions(params: {
  alertId: string;
  ticket:  any;
  db:      Database.Database;
  io:      Server;
}) {
  const { alertId, ticket, db: database, io: socketIo } = params;
  if (!ticket?.priority) return;

  // Fetch alert context for richer notifications
  const alertRow = database.prepare(
    'SELECT source_ip, dest_ip, agent_name, mitre_attack FROM alerts WHERE id = ?'
  ).get(alertId) as any;
  const sourceIp  = alertRow?.source_ip  || 'n/a';
  const destIp    = alertRow?.dest_ip    || 'n/a';
  const agentName = alertRow?.agent_name || 'unknown';
  let mitreTags: string[] = [];
  try { const m = JSON.parse(alertRow?.mitre_attack || '[]'); if (Array.isArray(m)) mitreTags = m; } catch {}

  const integrations = database.prepare("SELECT * FROM integrations WHERE enabled = 1").all() as any[];
  const logAction = database.prepare(
    'INSERT INTO action_logs (alert_id, integration, action, status, payload, error) VALUES (?, ?, ?, ?, ?, ?)'
  );

  for (const intg of integrations) {
    const threshold = intg.auto_send_threshold || 'NEVER';
    if (threshold === 'NEVER') continue;
    if ((PRIORITY_RANK[ticket.priority] || 0) < (PRIORITY_RANK[threshold] || 99)) continue;

    let cfg: Record<string, string> = {};
    try { cfg = JSON.parse(intg.config || '{}'); } catch {}

    if (intg.name === 'email') {
      try {
        const subject = ticket.title || `Alert ${alertId}`;
        const body    = ticket.report_body || `Alert ${alertId}: ${ticket.title}`;
        await sendIncidentAlert(subject, body, cfg);
        logAction.run(alertId, 'email', 'send_email', 'success', subject.slice(0, 120), null);
      } catch (err: any) {
        logAction.run(alertId, 'email', 'send_email', 'failed', ticket.title?.slice(0, 120) || '', err?.message?.slice(0, 200));
      }
    }

    if (intg.name === 'slack' && cfg.webhook_url) {
      const text = `🚨 *[BBS AISOC]* ${ticket.priority} Alert\n\n*${ticket.title}*\n\n${(ticket.report_body || '').slice(0, 300)}`;
      const result = await sendSlackWebhook(cfg.webhook_url, text);
      logAction.run(alertId, 'slack', 'send_message', result.ok ? 'success' : 'failed',
        ticket.title?.slice(0, 120) || '', result.error || null);
    }

    if (intg.name === 'telegram' && cfg.bot_token && cfg.chat_id) {
      const conf = ticket.confidence != null ? Math.round(ticket.confidence * (ticket.confidence <= 1 ? 100 : 1)) : null;
      const mitreLine = mitreTags.length ? mitreTags.slice(0, 5).join(', ') : '—';
      const escape = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const text =
        `🚨 <b>[BBS AISOC]</b> ${escape(ticket.priority)} INCIDENT\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<b>${escape(ticket.title || 'Untitled')}</b>\n\n` +
        `🆔 Alert: <code>${escape(alertId.slice(0, 8).toUpperCase())}</code>\n` +
        `🌐 Source: <code>${escape(sourceIp)}</code> → <code>${escape(destIp)}</code>\n` +
        `🖥 Host: <code>${escape(agentName)}</code>\n` +
        `🎯 MITRE: ${escape(mitreLine)}\n` +
        (conf != null ? `📊 Confidence: ${conf}%\n` : '') +
        `\n${escape((ticket.report_body || '').slice(0, 600))}`;
      const result = await sendTelegramMessage({ botToken: cfg.bot_token, chatId: cfg.chat_id }, text);
      logAction.run(alertId, 'telegram', 'send_message', result.ok ? 'success' : 'failed',
        ticket.title?.slice(0, 120) || '', result.error || null);
    }

    if (intg.name === 'glpi' && cfg.url && cfg.app_token && cfg.user_token) {
      const urgencyMap: Record<string, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2 };
      const result = await createGlpiTicket(
        { url: cfg.url, appToken: cfg.app_token, userToken: cfg.user_token },
        { title: ticket.title || `Alert ${alertId}`, content: ticket.report_body || '', urgency: urgencyMap[ticket.priority] || 3 }
      );
      logAction.run(alertId, 'glpi', 'create_ticket', result.ok ? 'success' : 'failed',
        result.ok ? `Ticket #${result.ticketId}` : ticket.title?.slice(0, 120) || '', result.error || null);
    }
  }

  // Auto-block IPs from response agent actions on enabled firewalls
  try {
    const alert: any = database.prepare('SELECT ai_analysis FROM alerts WHERE id = ?').get(alertId);
    if (alert?.ai_analysis) {
      const ai       = JSON.parse(alert.ai_analysis);
      const actions  = ai?.response?.actions || ai?.phaseData?.response?.actions || [];
      const blockIps = actions.filter((a: any) => a.type === 'BLOCK_IP' && a.target).map((a: any) => a.target as string);
      if (blockIps.length > 0) {
        const fws = database.prepare('SELECT * FROM firewalls WHERE enabled=1 AND auto_block=1').all() as any[];
        for (const fw of fws) {
          let cfg: Record<string, string> = {};
          try { cfg = JSON.parse(fw.config || '{}'); } catch {}
          for (const ip of blockIps) {
            const result = await firewallBlockIp(fw.type as FirewallType, cfg, ip, 'block');
            database.prepare(
              'INSERT INTO firewall_blocks (firewall_id, ip, alert_id, reason, status) VALUES (?, ?, ?, ?, ?)'
            ).run(fw.id, ip, alertId, 'Auto-blocked by BLOCK_IP response action', result.ok ? 'blocked' : 'failed');
            database.prepare(
              'INSERT INTO action_logs (alert_id, integration, action, status, payload, error) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(alertId, `fw_${fw.name}`, 'block_ip', result.ok ? 'success' : 'failed', `Block ${ip}`, result.error || null);
            console.log(`[Firewall][${fw.name}] ${result.ok ? '✓' : '✗'} block ${ip}: ${result.detail || result.error}`);
          }
        }
      }
    }
  } catch (fwErr: any) {
    console.warn('[Firewall] Auto-block error:', fwErr?.message);
  }

  socketIo.emit('action_logged', { alert_id: alertId });
}

// --- Ollama HTTP helper -------------------------------------------------------
async function ollamaFetch(baseUrl: string, path: string): Promise<{ ok: boolean; data?: any; error?: string }> {
  const { default: http }  = await import('node:http');
  const { default: https } = await import('node:https');
  const fullUrl = `${baseUrl.replace(/\/$/, '')}${path}`;
  return new Promise((resolve) => {
    const mod = fullUrl.startsWith('https') ? https : http;
    const req = mod.get(fullUrl, { rejectUnauthorized: false, timeout: 5000 } as any, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch  { resolve({ ok: false, error: 'Invalid JSON from Ollama' }); }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Connection timed out' }); });
  });
}

const getAgentModelAssignments = (): ModelAssignments => {
  const rows: Array<{ phase: string; model: string }> = db
    .prepare('SELECT phase, model FROM agent_settings')
    .all() as Array<{ phase: string; model: string }>;

  const assignments: ModelAssignments = {};
  for (const phase of AGENT_PHASES) {
    assignments[phase] = DEFAULT_AGENT_MODELS[phase];
  }
  for (const row of rows) {
    if (isAgentPhase(row.phase)) assignments[row.phase] = row.model;
  }
  return assignments;
};

// --- SLA window map (minutes) -----------------------------------------------
const SLA_MINUTES: Record<string, number> = {
  CRITICAL: 15,
  HIGH:     60,
  MEDIUM:   240,
  LOW:      1440,
};

function getSeverityLabel(level: number): string {
  if (level >= 13) return 'CRITICAL';
  if (level >= 10) return 'HIGH';
  if (level >= 7)  return 'MEDIUM';
  return 'LOW';
}

// --- Server Setup -----------------------------------------------------------
async function startServer() {
  const app = express();

  const certPath = process.env.TLS_CERT || path.join(__dirname, 'certs', 'cert.pem');
  const keyPath  = process.env.TLS_KEY  || path.join(__dirname, 'certs', 'key.pem');
  const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);

  const httpServer = hasCerts
    ? createHttpsServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app)
    : createHttpServer(app);

  if (hasCerts) console.log('[TLS] HTTPS enabled using', certPath);
  else          console.warn('[TLS] No certs found — running HTTP (dev only)');

  const io = new Server(httpServer, { cors: { origin: '*' } });

  app.use(cors());
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json());

  // Global rate limiter — 200 req/min per IP
  app.use(rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false }));

  // Auth Middleware
  const authenticate = (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  const requireAdmin = (req: any, res: any, next: any) => {
    if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
    next();
  };

  // ── Auth ──────────────────────────────────────────────────────────────────
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user: any = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    writeAudit(user.id, 'LOGIN', `User ${username} logged in`);
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  });

  app.get('/api/auth/me', authenticate, (req: any, res) => {
    res.json(req.user);
  });

  // ── Alerts ────────────────────────────────────────────────────────────────
  app.get('/api/alerts', authenticate, (req: any, res) => {
    const { status, severity } = req.query;
    const page     = Math.max(1, parseInt(String(req.query.page  || '1')));
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '25'))));
    const offset   = (page - 1) * pageSize;

    const conditions: string[] = [];
    const params: any[]        = [];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (severity) {
      const severityMap: Record<string, string> = {
        CRITICAL: 'severity >= 13',
        HIGH:     'severity >= 10 AND severity < 13',
        MEDIUM:   'severity >= 7 AND severity < 10',
        LOW:      'severity < 7',
      };
      const clause = severityMap[String(severity).toUpperCase()];
      if (clause) conditions.push(clause);
    }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const alerts = db.prepare(`SELECT * FROM alerts ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    const total  = (db.prepare(`SELECT COUNT(*) as c FROM alerts ${where}`).get(...params) as any).c;

    res.json({ alerts, total, page, pageSize });
  });

  app.patch('/api/alerts/:id', authenticate, (req: any, res) => {
    const { id } = req.params;
    const { status, ai_analysis, mitre_attack, remediation_steps, email_sent } = req.body;
    try {
      const updates: string[] = [];
      const values: any[]     = [];
      if (status !== undefined)           { updates.push('status = ?');            values.push(status); }
      if (ai_analysis !== undefined)      { updates.push('ai_analysis = ?');       values.push(ai_analysis); }
      if (mitre_attack !== undefined)     { updates.push('mitre_attack = ?');      values.push(mitre_attack); }
      if (remediation_steps !== undefined){ updates.push('remediation_steps = ?'); values.push(remediation_steps); }
      if (email_sent !== undefined)       { updates.push('email_sent = ?');        values.push(email_sent); }
      if (updates.length > 0) {
        values.push(id);
        db.prepare(`UPDATE alerts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        if (status) writeAudit(req.user?.id, 'ALERT_STATUS_CHANGE', `Alert ${id} → ${status}`);
        io.emit('alert_updated', { id, ...req.body });
      }
      res.json({ status: 'ok' });
    } catch (err) {
      console.error('Update error:', err);
      res.status(500).json({ error: 'Failed to update alert' });
    }
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  app.get('/api/stats', authenticate, (_req, res) => {
    const activeRow: any  = db.prepare("SELECT COUNT(*) as count FROM alerts WHERE status IN ('NEW', 'ANALYZING', 'ESCALATED')").get();
    const mttrRow: any    = db.prepare(`SELECT AVG((strftime('%s','now') - strftime('%s', timestamp))) as avg_seconds FROM alerts WHERE status IN ('TRIAGED', 'CLOSED') AND ai_analysis IS NOT NULL`).get();
    const totalRow: any   = db.prepare("SELECT COUNT(*) as count FROM alerts").get();
    const analyzedRow: any= db.prepare("SELECT COUNT(*) as count FROM alerts WHERE ai_analysis IS NOT NULL").get();
    const fpRow: any      = db.prepare("SELECT COUNT(*) as count FROM alerts WHERE status = 'FALSE_POSITIVE'").get();

    const total          = totalRow?.count ?? 0;
    const analyzed       = analyzedRow?.count ?? 0;
    const fp             = fpRow?.count ?? 0;
    const avgSeconds     = mttrRow?.avg_seconds ?? 0;
    const mttrMinutes    = avgSeconds > 0 ? (avgSeconds / 60).toFixed(1) : '0.0';
    const automationRate = total > 0 ? Math.round((analyzed / total) * 100) : 0;
    const fpRate         = total > 0 ? Math.round((fp / total) * 100) : 0;

    res.json({
      activeIncidents: activeRow?.count ?? 0,
      mttr:            `${mttrMinutes}m`,
      automationRate:  `${automationRate}%`,
      totalAlerts:     total,
      analyzedAlerts:  analyzed,
      fpRate:          `${fpRate}%`,
    });
  });

  app.get('/api/stats/trends', authenticate, (_req, res) => {
    const rows = db.prepare(`
      SELECT date(timestamp) as day, COUNT(*) as count
      FROM alerts
      WHERE timestamp >= datetime('now', '-7 days')
      GROUP BY date(timestamp)
      ORDER BY day ASC
    `).all() as Array<{ day: string; count: number }>;

    // Fill in missing days with 0
    const result: Array<{ day: string; count: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d   = new Date();
      d.setDate(d.getDate() - i);
      const day = d.toISOString().split('T')[0];
      const found = rows.find(r => r.day === day);
      result.push({ day, count: found?.count ?? 0 });
    }
    res.json(result);
  });

  // ── Incidents — see canonical routes lower in this file (Incident Management section)
  // The legacy GET/POST/PATCH /api/incidents handlers were removed because they returned
  // a flat array (incompatible with the new {rows, total} shape used by IncidentsTab).

  // ── Users ─────────────────────────────────────────────────────────────────
  app.get('/api/users', authenticate, requireAdmin, (_req, res) => {
    res.json(db.prepare('SELECT id, username, email, role FROM users').all());
  });

  // Users available for incident assignment — visible to all authenticated users
  app.get('/api/users/analysts', authenticate, (_req, res) => {
    const rows = db.prepare(
      `SELECT id, username, role FROM users
       WHERE role IN ('ADMIN', 'TIER2', 'INCIDENT_LEAD')
       ORDER BY role DESC, username ASC`
    ).all();
    res.json(rows);
  });

  app.post('/api/users', authenticate, requireAdmin, (req: any, res) => {
    const { username, password, email, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    try {
      const hashed   = bcrypt.hashSync(password, 10);
      const result: any = db.prepare('INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)').run(username, hashed, email || null, role || 'ANALYST');
      writeAudit(req.user?.id, 'USER_CREATED', `Created user ${username} (${role || 'ANALYST'})`);
      res.json({ id: result.lastInsertRowid, username, email: email || null, role: role || 'ANALYST' });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Username already exists' });
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  app.patch('/api/users/me/password', authenticate, (req: any, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 6)
      return res.status(400).json({ message: 'Invalid input — new password must be at least 6 characters.' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as any;
    if (!bcrypt.compareSync(currentPassword, user.password))
      return res.status(401).json({ message: 'Current password is incorrect.' });
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
    writeAudit(req.user.id, 'PASSWORD_CHANGED', `User ${user.username} changed password`);
    res.json({ message: 'Password updated.' });
  });

  // ── Admin ─────────────────────────────────────────────────────────────────
  app.post('/api/admin/reset-alerts', authenticate, requireAdmin, (req: any, res) => {
    const result = db.prepare(`UPDATE alerts SET status='NEW', ai_analysis=NULL, mitre_attack=NULL, remediation_steps=NULL, email_sent=0`).run();
    writeAudit(req.user?.id, 'ALERTS_RESET', `Reset ${result.changes} alerts to NEW`);
    res.json({ reset: result.changes });
  });

  // Helper: delete alerts and ALL FK-related child rows. SQLite enforces foreign keys
  // (incident_responses, agent_runs, feedback, action_logs, blocks all reference alerts.id).
  function deleteAlertsAndChildren(idList: string[]): number {
    if (idList.length === 0) return 0;
    const inPlaceholders = idList.map(() => '?').join(',');
    const tx = db.transaction(() => {
      // Children with FK on alerts.id — order doesn't matter, but delete all before parent.
      for (const tbl of ['incident_responses', 'agent_runs', 'feedback', 'action_logs', 'blocks', 'working_memory']) {
        try {
          db.prepare(`DELETE FROM ${tbl} WHERE alert_id IN (${inPlaceholders})`).run(...idList);
        } catch { /* table may not exist on older schemas */ }
      }
      const r = db.prepare(`DELETE FROM alerts WHERE id IN (${inPlaceholders})`).run(...idList);
      return r.changes;
    });
    return tx();
  }

  // Wipe everything currently visible in the Incidents tab (TRIAGED / ESCALATED / CLOSED / ANALYZING).
  // FP archive entries (FALSE_POSITIVE / FP_CONFIRMED) are preserved.
  app.post('/api/admin/clear-investigation', authenticate, requireAdmin, (req: any, res) => {
    const STATUSES = ['TRIAGED', 'ESCALATED', 'CLOSED', 'ANALYZING'];
    const placeholders = STATUSES.map(() => '?').join(',');
    const ids = db.prepare(`SELECT id FROM alerts WHERE status IN (${placeholders})`).all(...STATUSES) as any[];
    const idList = ids.map(r => r.id);

    try {
      const deleted = deleteAlertsAndChildren(idList);
      writeAudit(req.user?.id, 'INVESTIGATION_CLEARED', `Deleted ${deleted} alerts from Incidents queue`);
      io.emit('alerts_cleared', { ids: idList });
      res.json({ ok: true, deleted });
    } catch (err: any) {
      console.error('[Clear Incidents] Error:', err?.message);
      res.status(500).json({ error: err?.message || 'Failed to clear Incidents' });
    }
  });

  // Wipe the FP Archive (FALSE_POSITIVE + FP_CONFIRMED). Incidents queue is preserved.
  app.post('/api/admin/clear-fp-archive', authenticate, requireAdmin, (req: any, res) => {
    const STATUSES = ['FALSE_POSITIVE', 'FP_CONFIRMED'];
    const placeholders = STATUSES.map(() => '?').join(',');
    const ids = db.prepare(`SELECT id FROM alerts WHERE status IN (${placeholders})`).all(...STATUSES) as any[];
    const idList = ids.map(r => r.id);

    try {
      const deleted = deleteAlertsAndChildren(idList);
      writeAudit(req.user?.id, 'FP_ARCHIVE_CLEARED', `Deleted ${deleted} alerts from FP archive`);
      io.emit('alerts_cleared', { ids: idList });
      res.json({ ok: true, deleted });
    } catch (err: any) {
      console.error('[Clear FP Archive] Error:', err?.message);
      res.status(500).json({ error: err?.message || 'Failed to clear FP archive' });
    }
  });

  app.get('/api/audit-logs', authenticate, requireAdmin, (_req, res) => {
    res.json(db.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 100').all());
  });

  // ── Ingest ────────────────────────────────────────────────────────────────

  // Helper: fire-and-forget orchestration on a freshly-ingested alert
  async function triggerOrchestration(alertId: string) {
    try {
      const alert: any = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
      if (!alert) return;
      const recentAlerts = db.prepare(
        `SELECT * FROM alerts WHERE id != ? AND timestamp >= datetime('now', '-3 days') ORDER BY timestamp DESC LIMIT 50`
      ).all(alertId);
      db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('ANALYZING', alertId);
      io.emit('alert_updated', { id: alertId, status: 'ANALYZING' });
      const update = await runOrchestration(alert, recentAlerts, { modelAssignments: getAgentModelAssignments() });
      if (update.status === 'FALSE_POSITIVE' && update.fp_method) {
        db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=?, fp_method=?, fp_reason=?, fp_confidence=?, filtered_at=datetime('now') WHERE id=?`)
          .run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, update.fp_method, update.fp_reason, update.fp_confidence ?? 0, alertId);
      } else {
        db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=? WHERE id=?`)
          .run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, alertId);
      }
      db.prepare('INSERT INTO agent_runs (alert_id, ai_analysis, mitre_attack, remediation_steps, status) VALUES (?, ?, ?, ?, ?)')
        .run(alertId, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.status);
      try {
        const parsed = JSON.parse(update.ai_analysis || '{}');
        const ticket = parsed?.ticket || parsed?.phaseData?.ticket;
        if (ticket && update.status !== 'FALSE_POSITIVE') await dispatchActions({ alertId, ticket, db, io });
      } catch {}
      io.emit('alert_updated', { id: alertId, ...update });
    } catch (err: any) {
      console.error('[Auto-Orchestrate]', err?.message);
      db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('NEW', alertId);
      io.emit('alert_updated', { id: alertId, status: 'NEW' });
    }
  }

  app.post('/api/ingest', (req, res) => {
    try {
      // Load Wazuh filter config (independent of auth)
      const wRow = db.prepare("SELECT config FROM integrations WHERE name='wazuh'").get() as any;
      const wcfg = JSON.parse(wRow?.config || '{}');

      // API key auth — check X-Api-Key or Authorization: Bearer header against api_keys table
      const authHeader  = (req.headers['authorization'] as string) || '';
      const apiKeyHeader = (req.headers['x-api-key'] as string) || '';
      const provided     = apiKeyHeader || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '');

      if (!provided) {
        return res.status(401).json({ error: 'API key required. Set X-Api-Key or Authorization: Bearer header.' });
      }
      const keyHash = crypto.createHash('sha256').update(provided).digest('hex');
      const keyRow  = db.prepare("SELECT id, name, paused, min_severity_override FROM api_keys WHERE key_hash=? AND revoked=0 LIMIT 1").get(keyHash) as any;
      if (!keyRow) {
        return res.status(401).json({ error: 'Invalid or revoked API key.' });
      }
      if (keyRow.paused) {
        return res.status(403).json({ status: 'paused', error: 'Alert ingestion is paused for this API key.' });
      }
      if (wcfg.ingest_enabled === 'false') {
        return res.status(503).json({ status: 'paused', error: 'Global alert ingestion is currently paused.' });
      }
      db.prepare("UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?").run(keyRow.id);

      // Support Wazuh 4.x native format (_source wrapper) and flat integration format
      const raw   = req.body;
      const alert = (raw._source && typeof raw._source === 'object') ? raw._source : raw;

      const id       = alert.id || crypto.randomBytes(6).toString('hex');
      const ruleId   = alert.rule?.id   || 'unknown';
      const sourceIp = alert.data?.srcip || alert.data?.src_ip || null;
      const severity = Number(alert.rule?.level ?? 0);

      // Rate limit (cheap reject — no DB write)
      const maxPerMin = Number(wcfg.max_alerts_per_min ?? 0);
      if (!checkIngestRateLimit(maxPerMin)) {
        return res.status(429).json({ status: 'rate_limited', error: `Exceeded ${maxPerMin} alerts/min` });
      }

      // Configurable dedup window (cheap reject — duplicate of an existing alert)
      const dedupMin = Number(wcfg.dedup_window_minutes ?? 5);
      const dup = db.prepare(
        `SELECT id FROM alerts WHERE rule_id = ? AND source_ip = ? AND timestamp >= datetime('now', '-${dedupMin} minutes') LIMIT 1`
      ).get(ruleId, sourceIp);
      if (dup) return res.json({ status: 'deduplicated', original_id: (dup as any).id });

      // Min severity filter — per-key override takes precedence over global setting.
      // Below-threshold alerts are inserted as FALSE_POSITIVE so they're auditable in the FP Archive,
      // but skip the AI pipeline (cheap noise — no agent run, no Telegram).
      const minSev = keyRow.min_severity_override != null
        ? Number(keyRow.min_severity_override)
        : Number(wcfg.min_severity ?? 0);
      const belowMinSeverity = severity < minSev;

      // Time window filter (HH:MM 24h) — same treatment: archive instead of drop.
      let outsideTimeWindow = false;
      if (wcfg.time_window_start && wcfg.time_window_end) {
        const now  = new Date();
        const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (hhmm < wcfg.time_window_start || hhmm > wcfg.time_window_end) outsideTimeWindow = true;
      }

      const autoFp = belowMinSeverity || outsideTimeWindow;
      const fpMethod = belowMinSeverity ? 'severity_filter' : outsideTimeWindow ? 'time_window' : null;
      const fpReason = belowMinSeverity
        ? `Severity ${severity} below threshold ${minSev}`
        : outsideTimeWindow
          ? `Outside active hours (${wcfg.time_window_start}–${wcfg.time_window_end})`
          : null;

      db.prepare(`INSERT INTO alerts (id, rule_id, description, severity, source_ip, dest_ip, user, hostname, agent_name, full_log) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          id,
          ruleId,
          alert.rule?.description || 'No description',
          severity,
          sourceIp,
          alert.data?.dstip  || alert.data?.dst_ip  || null,
          alert.data?.dstuser || (alert.data?.win?.system?.subjectUserName) || null,
          alert.agent?.name  || 'unknown',
          alert.agent?.name  || 'unknown',
          JSON.stringify(alert),
        );

      if (autoFp) {
        db.prepare(
          `UPDATE alerts SET status='FALSE_POSITIVE', fp_method=?, fp_reason=?, fp_confidence=1.0, filtered_at=datetime('now') WHERE id=?`
        ).run(fpMethod, fpReason, id);
      }

      io.emit('new_alert', { id });

      // Auto-orchestrate (fire-and-forget) — but skip for auto-FP'd noise
      if (!autoFp && wcfg.auto_orchestrate !== 'false') {
        setImmediate(() => triggerOrchestration(id));
      }

      res.json({ status: autoFp ? 'archived_fp' : 'ok', id, fp_reason: fpReason });
    } catch (err) {
      console.error('Ingestion error:', err);
      res.status(500).json({ error: 'Failed to ingest alert' });
    }
  });

  // ── API Key management ───────────────────────────────────────────────────
  app.get('/api/api-keys', authenticate, requireAdmin, (_req, res) => {
    const rows = db.prepare(
      'SELECT id, name, key_prefix, created_at, last_used_at, revoked, paused, min_severity_override FROM api_keys ORDER BY created_at DESC'
    ).all();
    res.json(rows);
  });

  app.post('/api/api-keys', authenticate, requireAdmin, (req: any, res) => {
    const { name } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const raw     = 'sk_aisoc_' + crypto.randomBytes(24).toString('hex');
    const keyHash = crypto.createHash('sha256').update(raw).digest('hex');
    const prefix  = raw.slice(0, 17) + '…';
    db.prepare('INSERT INTO api_keys (name, key_hash, key_prefix, created_by) VALUES (?, ?, ?, ?)')
      .run(name.trim(), keyHash, prefix, req.user.id);
    writeAudit(req.user.id, 'API_KEY_CREATED', `API key "${name}" created`);
    res.json({ ok: true, key: raw, prefix });
  });

  app.delete('/api/api-keys/:id', authenticate, requireAdmin, (req: any, res) => {
    const { id } = req.params;
    db.prepare('UPDATE api_keys SET revoked=1 WHERE id=?').run(id);
    writeAudit(req.user.id, 'API_KEY_REVOKED', `API key id=${id} revoked`);
    res.json({ ok: true });
  });

  app.patch('/api/api-keys/:id', authenticate, requireAdmin, (req: any, res) => {
    const { id } = req.params;
    const { paused, min_severity_override } = req.body || {};
    if (paused !== undefined)
      db.prepare('UPDATE api_keys SET paused=? WHERE id=?').run(paused ? 1 : 0, id);
    if (min_severity_override !== undefined)
      db.prepare('UPDATE api_keys SET min_severity_override=? WHERE id=?').run(
        min_severity_override === null ? null : Number(min_severity_override), id
      );
    writeAudit(req.user.id, 'API_KEY_UPDATED', `API key id=${id} config updated`);
    res.json({ ok: true });
  });

  // ── AI model settings ─────────────────────────────────────────────────────
  app.get('/api/ai/models', authenticate, async (_req, res) => {
    const assignments  = getAgentModelAssignments();
    const localUrl     = (db.prepare("SELECT value FROM local_llm_config WHERE key='url'").get() as any)?.value || 'http://localhost:11434';
    const localEnabled = (db.prepare("SELECT value FROM local_llm_config WHERE key='enabled'").get() as any)?.value === '1';

    let localModels: Array<{ name: string; size: number; modified_at: string }> = [];
    if (localEnabled) {
      try {
        const tagsRes = await ollamaFetch(localUrl, '/api/tags');
        if (tagsRes.ok) localModels = (tagsRes.data?.models || []).map((m: any) => ({ name: m.name, size: m.size || 0, modified_at: m.modified_at || '' }));
      } catch {}
    }

    res.json({
      agents:          AGENT_PHASES.map(phase => ({ phase, ...AGENT_METADATA[phase] })),
      defaults:        DEFAULT_AGENT_MODELS,
      assignments,
      availableModels: OPENROUTER_FREE_MODELS,
      modelLabels:     OPENROUTER_MODEL_LABELS,
      localConfig:     { url: localUrl, enabled: localEnabled },
      localModels,
    });
  });

  app.patch('/api/ai/models/:phase', authenticate, requireAdmin, (req, res) => {
    const { phase } = req.params;
    const { model } = req.body || {};
    if (!isAgentPhase(phase)) return res.status(400).json({ error: 'Invalid phase' });
    const isOpenRouter = typeof model === 'string' && OPENROUTER_FREE_MODELS.includes(model as any);
    const isLocal      = typeof model === 'string' && model.startsWith('local::');
    if (!isOpenRouter && !isLocal)
      return res.status(400).json({ error: 'Invalid model selection' });
    db.prepare(`INSERT INTO agent_settings (phase, model) VALUES (?, ?) ON CONFLICT(phase) DO UPDATE SET model=excluded.model`).run(phase, model);
    res.json({ phase, model, assignments: getAgentModelAssignments() });
  });

  // ── Local LLM (Ollama) config ────────────────────────────────────────────
  app.get('/api/local-llm/config', authenticate, (_req, res) => {
    const url     = (db.prepare("SELECT value FROM local_llm_config WHERE key='url'").get() as any)?.value || 'http://localhost:11434';
    const enabled = (db.prepare("SELECT value FROM local_llm_config WHERE key='enabled'").get() as any)?.value === '1';
    res.json({ url, enabled });
  });

  app.patch('/api/local-llm/config', authenticate, requireAdmin, (req: any, res) => {
    const { url, enabled } = req.body;
    const upd = db.prepare('INSERT INTO local_llm_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    if (url     !== undefined) { upd.run('url',     String(url)); setLocalLLMBaseUrl(String(url)); }
    if (enabled !== undefined) { upd.run('enabled', enabled ? '1' : '0'); }
    writeAudit(req.user?.id, 'LOCAL_LLM_CONFIG', `Local LLM config updated`);
    res.json({ ok: true });
  });

  app.get('/api/local-llm/models', authenticate, async (_req, res) => {
    const url = (db.prepare("SELECT value FROM local_llm_config WHERE key='url'").get() as any)?.value || 'http://localhost:11434';
    const result = await ollamaFetch(url, '/api/tags');
    if (!result.ok) return res.json({ models: [], error: result.error });
    const models = (result.data?.models || []).map((m: any) => ({ name: m.name, size: m.size || 0, modified_at: m.modified_at || '' }));
    res.json({ models });
  });

  app.post('/api/local-llm/test', authenticate, requireAdmin, async (_req, res) => {
    const url    = (db.prepare("SELECT value FROM local_llm_config WHERE key='url'").get() as any)?.value || 'http://localhost:11434';
    const result = await ollamaFetch(url, '/api/tags');
    if (!result.ok) return res.json({ ok: false, error: result.error });
    const count = result.data?.models?.length ?? 0;
    res.json({ ok: true, model_count: count, message: `Connected — ${count} model${count === 1 ? '' : 's'} available` });
  });

  // ── Agent statistics ───────────────────────────────────────────────────────
  app.get('/api/ai/agent-stats', authenticate, (_req, res) => {
    const phases = ['analysis','intel','knowledge','correlation','recall','ioc_check','ticketing','response','validation'];

    // Pull last 500 agent runs with AI data
    const runs = db.prepare("SELECT ai_analysis FROM agent_runs WHERE ai_analysis IS NOT NULL ORDER BY run_at DESC LIMIT 500").all() as any[];

    // Per-phase accumulators
    const acc: Record<string, { runs: number; fallbacks: number; confidences: number[] }> = {};
    for (const p of phases) acc[p] = { runs: 0, fallbacks: 0, confidences: [] };

    for (const row of runs) {
      let ai: any = {};
      try { ai = JSON.parse(row.ai_analysis); } catch { continue; }
      const fallbackSet = new Set<string>(Array.isArray(ai.fallback_phases) ? ai.fallback_phases : []);
      const phaseData   = ai.phaseData || {};

      for (const p of phases) {
        // A run "counts" for a phase if it either has phaseData for it or listed it as fallback
        const hasData  = !!phaseData[p === 'ticketing' ? 'ticket' : p];
        const isFallback = fallbackSet.has(p);
        if (!hasData && !isFallback) continue;
        acc[p].runs++;
        if (isFallback) { acc[p].fallbacks++; continue; }
        const conf = p === 'ticketing' ? phaseData.ticket?.confidence : phaseData[p]?.confidence;
        if (typeof conf === 'number' && !isNaN(conf)) acc[p].confidences.push(conf);
      }
    }

    // Per-phase feedback from feedback table
    const feedbackRows = db.prepare(
      "SELECT phase, SUM(CASE WHEN is_accurate=1 THEN 1 ELSE 0 END) as accurate, COUNT(*) as total FROM feedback GROUP BY phase"
    ).all() as Array<{ phase: string; accurate: number; total: number }>;
    const feedbackMap: Record<string, { accurate: number; total: number }> = {};
    for (const f of feedbackRows) feedbackMap[f.phase] = { accurate: f.accurate, total: f.total };

    const result = phases.map(p => {
      const a = acc[p];
      const fb = feedbackMap[p] || { accurate: 0, total: 0 };
      const avgConf = a.confidences.length > 0
        ? Math.round(a.confidences.reduce((s, c) => s + c, 0) / a.confidences.length * 100)
        : null;
      return {
        phase:             p,
        total_runs:        a.runs,
        fallback_count:    a.fallbacks,
        avg_confidence:    avgConf,
        feedback_accurate: fb.accurate,
        feedback_total:    fb.total,
      };
    });

    res.json(result);
  });

  // ── Memory APIs (hub-and-swarm) ──────────────────────────────────────────

  // Look up an IOC value (analyst-facing): returns prior observations.
  app.get('/api/memory/iocs', authenticate, (req: any, res) => {
    const value = String(req.query.value || '').trim();
    if (!value) return res.status(400).json({ error: 'value query param required' });
    const row = db.prepare(
      `SELECT value, type, first_seen, last_seen, alert_count, threat_level, notes FROM ioc_memory WHERE value = ?`
    ).get(value) as any;
    res.json(row ?? null);
  });

  // Recent IOC observations across all alerts (paged).
  app.get('/api/memory/iocs/recent', authenticate, (req: any, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows  = db.prepare(
      `SELECT value, type, first_seen, last_seen, alert_count, threat_level FROM ioc_memory ORDER BY last_seen DESC LIMIT ?`
    ).all(limit);
    res.json(rows);
  });

  // Recent insights (semantic memory rows) — for the analyst memory UI.
  app.get('/api/memory/insights/recent', authenticate, (req: any, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const rows  = db.prepare(
      `SELECT alert_id, summary, attack_pattern, threat_actor, outcome, ttp_tags, created_at
       FROM incident_insights ORDER BY created_at DESC LIMIT ?`
    ).all(limit);
    // Parse ttp_tags JSON for the client
    const parsed = (rows as any[]).map(r => ({ ...r, ttp_tags: safeParseJsonArray(r.ttp_tags) }));
    res.json(parsed);
  });

  // Browse all insights with search/filter/pagination (Knowledge Base).
  app.get('/api/memory/insights', authenticate, (req: any, res) => {
    const q       = String(req.query.q || '').trim();
    const outcome = String(req.query.outcome || '').trim();
    const limit   = Math.min(Number(req.query.limit) || 50, 200);
    const offset  = Math.max(0, Number(req.query.offset) || 0);

    const where: string[] = [];
    const params: any[]   = [];
    if (q) {
      where.push('(summary LIKE ? OR attack_pattern LIKE ? OR threat_actor LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    if (outcome) { where.push('outcome = ?'); params.push(outcome); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (db.prepare(`SELECT COUNT(*) as c FROM incident_insights ${whereSql}`).get(...params) as any).c;
    const rows  = db.prepare(
      `SELECT alert_id, summary, attack_pattern, threat_actor, outcome, ttp_tags, triggered_by, created_at
       FROM incident_insights ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    const parsed = (rows as any[]).map(r => ({ ...r, ttp_tags: safeParseJsonArray(r.ttp_tags) }));
    res.json({ rows: parsed, total });
  });

  // Browse all IOCs with search/filter/pagination (Knowledge Base).
  app.get('/api/memory/iocs/all', authenticate, (req: any, res) => {
    const q      = String(req.query.q || '').trim();
    const type   = String(req.query.type || '').trim();
    const limit  = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where: string[] = [];
    const params: any[]   = [];
    if (q)    { where.push('(value LIKE ? OR notes LIKE ?)'); const like = `%${q}%`; params.push(like, like); }
    if (type) { where.push('type = ?'); params.push(type); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (db.prepare(`SELECT COUNT(*) as c FROM ioc_memory ${whereSql}`).get(...params) as any).c;
    const rows  = db.prepare(
      `SELECT value, type, first_seen, last_seen, alert_count, threat_level, notes, fp_count, tp_count
       FROM ioc_memory ${whereSql} ORDER BY alert_count DESC, last_seen DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    const enriched = (rows as any[]).map(r => {
      const total = (r.fp_count || 0) + (r.tp_count || 0);
      const fp_ratio = total > 0 ? r.fp_count / total : null;
      return { ...r, fp_ratio };
    });
    res.json({ rows: enriched, total });
  });

  // Working-memory trail (planner's scratchpad) for a given alert — debug view.
  app.get('/api/memory/working/:alertId', authenticate, (req: any, res) => {
    const rows = db.prepare(
      `SELECT step, trace_id, thought, action, result_summary, created_at
       FROM working_memory WHERE alert_id = ? ORDER BY created_at DESC, step DESC LIMIT 50`
    ).all(req.params.alertId);
    res.json(rows);
  });

  // ── Asset Context CRUD ─────────────────────────────────────────────────────

  app.get('/api/assets', authenticate, (_req, res) => {
    const rows = db.prepare(
      `SELECT value, type, role, description, fp_default, source, created_at, updated_at
       FROM asset_context ORDER BY updated_at DESC LIMIT 200`
    ).all();
    res.json(rows);
  });

  app.post('/api/assets', authenticate, requireAdmin, (req: any, res) => {
    const { value, type, role, description, fp_default } = req.body;
    if (!value || !type || !role) return res.status(400).json({ error: 'value, type, and role are required' });
    db.prepare(`
      INSERT INTO asset_context (value, type, role, description, fp_default, source, updated_at)
      VALUES (?, ?, ?, ?, ?, 'manual', CURRENT_TIMESTAMP)
      ON CONFLICT(value) DO UPDATE SET
        type = excluded.type, role = excluded.role, description = excluded.description,
        fp_default = excluded.fp_default, source = excluded.source, updated_at = CURRENT_TIMESTAMP
    `).run(value.trim(), type, role, description || null, fp_default ? 1 : 0);
    writeAudit(req.user.id, 'ASSET_UPSERT', `Asset ${value} (${type}/${role}) fp_default=${fp_default ? 1 : 0}`);
    res.json({ ok: true });
  });

  app.delete('/api/assets/:value', authenticate, requireAdmin, (req: any, res) => {
    const r = db.prepare(`DELETE FROM asset_context WHERE value = ?`).run(req.params.value);
    if (r.changes > 0) writeAudit(req.user.id, 'ASSET_DELETE', `Asset ${req.params.value} removed`);
    res.json({ ok: true, deleted: r.changes > 0 });
  });

  // ── Suppression Rules CRUD ────────────────────────────────────────────────

  app.get('/api/suppression-rules', authenticate, (_req, res) => {
    const rows = db.prepare(
      `SELECT * FROM suppression_rules ORDER BY hit_count DESC, created_at DESC`
    ).all();
    res.json(rows);
  });

  app.post('/api/suppression-rules', authenticate, requireAdmin, (req: any, res) => {
    const { name, source_ip_pattern, agent_name_pattern, rule_id_pattern, description_pattern,
            min_severity, max_severity, reason, enabled } = req.body;
    if (!name || !reason) return res.status(400).json({ error: 'name and reason are required' });
    const result = db.prepare(`
      INSERT INTO suppression_rules
        (name, source_ip_pattern, agent_name_pattern, rule_id_pattern, description_pattern,
         min_severity, max_severity, reason, enabled, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, source_ip_pattern || null, agent_name_pattern || null,
           rule_id_pattern || null, description_pattern || null,
           min_severity ?? 0, max_severity ?? 15, reason,
           enabled !== false ? 1 : 0, req.user.username || 'admin');
    writeAudit(req.user.id, 'SUPPRESSION_CREATE', `Rule "${name}": ${reason}`);
    res.json({ ok: true, id: result.lastInsertRowid });
  });

  app.patch('/api/suppression-rules/:id', authenticate, requireAdmin, (req: any, res) => {
    const rule = db.prepare(`SELECT * FROM suppression_rules WHERE id = ?`).get(Number(req.params.id)) as any;
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    const u = req.body;
    db.prepare(`
      UPDATE suppression_rules SET
        name = ?, source_ip_pattern = ?, agent_name_pattern = ?, rule_id_pattern = ?,
        description_pattern = ?, min_severity = ?, max_severity = ?, reason = ?, enabled = ?
      WHERE id = ?
    `).run(
      u.name ?? rule.name, u.source_ip_pattern !== undefined ? u.source_ip_pattern : rule.source_ip_pattern,
      u.agent_name_pattern !== undefined ? u.agent_name_pattern : rule.agent_name_pattern,
      u.rule_id_pattern !== undefined ? u.rule_id_pattern : rule.rule_id_pattern,
      u.description_pattern !== undefined ? u.description_pattern : rule.description_pattern,
      u.min_severity ?? rule.min_severity, u.max_severity ?? rule.max_severity,
      u.reason ?? rule.reason, u.enabled !== undefined ? (u.enabled ? 1 : 0) : rule.enabled,
      Number(req.params.id),
    );
    writeAudit(req.user.id, 'SUPPRESSION_UPDATE', `Rule #${req.params.id} updated`);
    res.json({ ok: true });
  });

  app.delete('/api/suppression-rules/:id', authenticate, requireAdmin, (req: any, res) => {
    const r = db.prepare(`DELETE FROM suppression_rules WHERE id = ?`).run(Number(req.params.id));
    if (r.changes > 0) writeAudit(req.user.id, 'SUPPRESSION_DELETE', `Rule #${req.params.id} deleted`);
    res.json({ ok: true, deleted: r.changes > 0 });
  });

  // ── Analytics: FP Reduction ───────────────────────────────────────────────

  app.get('/api/analytics/fp-reduction', authenticate, (_req, res) => {
    const total = (db.prepare(`SELECT COUNT(*) as c FROM alerts`).get() as any).c;
    const analyzed = (db.prepare(
      `SELECT COUNT(*) as c FROM alerts WHERE status IN ('TRIAGED','FALSE_POSITIVE','ESCALATED','CLOSED')`
    ).get() as any).c;
    const totalFp = (db.prepare(
      `SELECT COUNT(*) as c FROM alerts WHERE status = 'FALSE_POSITIVE'`
    ).get() as any).c;

    // Break down FPs by triggered_by from incident_insights
    const fpByTrigger = db.prepare(`
      SELECT triggered_by, COUNT(*) as c FROM incident_insights
      WHERE outcome = 'FALSE_POSITIVE' GROUP BY triggered_by
    `).all() as Array<{ triggered_by: string; c: number }>;

    const triggerMap: Record<string, number> = {};
    for (const r of fpByTrigger) triggerMap[r.triggered_by || 'triage'] = r.c;

    const memoryFp      = triggerMap['memoryFP'] || 0;
    const triageFp      = triggerMap['triage'] || 0;
    const suppressionFp = triggerMap['suppression'] || 0;
    const composerFp    = triggerMap['composer'] || 0;

    // Avg FP confidence from ai_analysis
    const fpAlerts = db.prepare(
      `SELECT ai_analysis FROM alerts WHERE status = 'FALSE_POSITIVE' AND ai_analysis IS NOT NULL`
    ).all() as Array<{ ai_analysis: string }>;
    let fpConfSum = 0; let fpConfCount = 0;
    for (const a of fpAlerts) {
      try {
        const ai = JSON.parse(a.ai_analysis);
        const conf = ai?.phaseData?.analysis?.false_positive_confidence;
        if (typeof conf === 'number') { fpConfSum += conf; fpConfCount++; }
      } catch {}
    }

    // Suppression rule stats
    const suppressionStats = db.prepare(
      `SELECT name, hit_count, created_at FROM suppression_rules WHERE enabled = 1 ORDER BY hit_count DESC`
    ).all();

    res.json({
      total_alerts: total,
      analyzed_alerts: analyzed,
      total_fp: totalFp,
      fp_rate: analyzed > 0 ? Number((totalFp / analyzed).toFixed(3)) : 0,
      memory_driven_fp: memoryFp,
      triage_driven_fp: triageFp,
      suppression_driven_fp: suppressionFp,
      composer_driven_fp: composerFp,
      fp_by_trigger: triggerMap,
      avg_fp_confidence: fpConfCount > 0 ? Number((fpConfSum / fpConfCount).toFixed(3)) : null,
      time_saved_minutes: totalFp * 15,  // ~15 min per manual FP triage
      suppression_rules: suppressionStats,
    });
  });

  app.get('/api/analytics/fp-over-time', authenticate, (_req, res) => {
    // FPs per day for last 30 days, broken down by trigger
    const rows = db.prepare(`
      SELECT
        DATE(created_at) as day,
        COUNT(*) as total_fp,
        SUM(CASE WHEN triggered_by = 'memoryFP' THEN 1 ELSE 0 END) as memory_fp,
        SUM(CASE WHEN triggered_by = 'triage' THEN 1 ELSE 0 END) as triage_fp,
        SUM(CASE WHEN triggered_by = 'suppression' THEN 1 ELSE 0 END) as suppression_fp,
        SUM(CASE WHEN triggered_by = 'composer' THEN 1 ELSE 0 END) as composer_fp
      FROM incident_insights
      WHERE outcome = 'FALSE_POSITIVE'
        AND created_at >= DATE('now', '-30 days')
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `).all();

    // Also get total alerts per day
    const alertRows = db.prepare(`
      SELECT DATE(timestamp) as day, COUNT(*) as total
      FROM alerts
      WHERE timestamp >= DATE('now', '-30 days')
      GROUP BY DATE(timestamp)
      ORDER BY day ASC
    `).all() as Array<{ day: string; total: number }>;
    const alertMap: Record<string, number> = {};
    for (const r of alertRows) alertMap[r.day] = r.total;

    const result = (rows as any[]).map(r => ({
      ...r,
      total_alerts: alertMap[r.day] || 0,
    }));
    res.json(result);
  });

  app.get('/api/analytics/noisy-sources', authenticate, (_req, res) => {
    // Top IPs/agents by FP count
    const ipRows = db.prepare(`
      SELECT source_ip as source, 'ip' as source_type,
             COUNT(*) as total_alerts,
             SUM(CASE WHEN status = 'FALSE_POSITIVE' THEN 1 ELSE 0 END) as fp_count
      FROM alerts
      WHERE source_ip IS NOT NULL AND source_ip != ''
      GROUP BY source_ip
      HAVING total_alerts >= 2
      ORDER BY fp_count DESC
      LIMIT 20
    `).all() as Array<{ source: string; source_type: string; total_alerts: number; fp_count: number }>;

    const agentRows = db.prepare(`
      SELECT agent_name as source, 'agent' as source_type,
             COUNT(*) as total_alerts,
             SUM(CASE WHEN status = 'FALSE_POSITIVE' THEN 1 ELSE 0 END) as fp_count
      FROM alerts
      WHERE agent_name IS NOT NULL AND agent_name != ''
      GROUP BY agent_name
      HAVING total_alerts >= 2
      ORDER BY fp_count DESC
      LIMIT 20
    `).all() as Array<{ source: string; source_type: string; total_alerts: number; fp_count: number }>;

    // Lookup asset_context for role info
    const enriched = [...ipRows, ...agentRows].map(r => {
      const asset = db.prepare(
        `SELECT role, fp_default FROM asset_context WHERE value = ?`
      ).get(r.source) as any;
      return {
        ...r,
        fp_rate: r.total_alerts > 0 ? Number((r.fp_count / r.total_alerts).toFixed(3)) : 0,
        role: asset?.role || null,
        is_registered: !!asset,
        fp_default: asset?.fp_default === 1,
      };
    }).sort((a, b) => b.fp_count - a.fp_count);

    res.json(enriched);
  });

  // ── Auto-Learning ─────────────────────────────────────────────────────────

  app.get('/api/analytics/fp-suggestions', authenticate, (_req, res) => {
    // Find IOCs that are overwhelmingly FP
    const rows = db.prepare(`
      SELECT value, type,
             COALESCE(fp_count, 0) as fp_count,
             COALESCE(tp_count, 0) as tp_count
      FROM ioc_memory
      WHERE COALESCE(fp_count, 0) + COALESCE(tp_count, 0) >= 5
    `).all() as Array<{ value: string; type: string; fp_count: number; tp_count: number }>;

    const suggestions = rows.map(r => {
      const total = r.fp_count + r.tp_count;
      const fp_ratio = total > 0 ? r.fp_count / total : 0;
      if (fp_ratio < 0.85) return null;
      const existing = db.prepare(`SELECT value FROM asset_context WHERE value = ?`).get(r.value);
      return {
        value: r.value,
        type: r.type,
        fp_count: r.fp_count,
        tp_count: r.tp_count,
        fp_ratio: Number(fp_ratio.toFixed(3)),
        total,
        suggestion: fp_ratio >= 0.95 && total >= 10 ? 'auto_register' : 'suggest',
        already_registered: !!existing,
      };
    }).filter(Boolean).sort((a: any, b: any) => b.fp_ratio - a.fp_ratio);

    res.json(suggestions);
  });

  app.post('/api/analytics/accept-suggestion', authenticate, requireAdmin, (req: any, res) => {
    const { value, type } = req.body;
    if (!value) return res.status(400).json({ error: 'value is required' });
    db.prepare(`
      INSERT INTO asset_context (value, type, role, description, fp_default, source, updated_at)
      VALUES (?, ?, 'production', 'Accepted from FP suggestion', 1, 'auto-learned', CURRENT_TIMESTAMP)
      ON CONFLICT(value) DO UPDATE SET
        fp_default = 1, source = 'auto-learned', updated_at = CURRENT_TIMESTAMP
    `).run(value.trim(), type || 'ip');
    writeAudit(req.user.id, 'AUTO_LEARN_ACCEPT', `Accepted FP suggestion for ${value}`);
    res.json({ ok: true });
  });

  // ── FP Scan: lightweight Steps 0-3 only ──────────────────────────────────
  app.post('/api/ai/fp-scan', authenticate, async (req: any, res) => {
    const { alertId } = req.body;
    if (!alertId) return res.status(400).json({ error: 'alertId is required' });
    try {
      const alert: any = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
      if (!alert) return res.status(404).json({ error: 'Alert not found' });

      const recentAlerts = db.prepare(
        `SELECT * FROM alerts WHERE id != ? AND timestamp >= datetime('now', '-3 days') ORDER BY timestamp DESC LIMIT 50`
      ).all(alertId);

      db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('ANALYZING', alertId);
      io.emit('alert_updated', { id: alertId, status: 'ANALYZING' });

      const result = await runFpScan(alert, recentAlerts, { modelAssignments: getAgentModelAssignments() });

      // Update alert with FP scan results
      db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, fp_method=?, fp_confidence=?, fp_reason=?, fp_details=?, triage_data=?, filtered_at=datetime('now') WHERE id=?`)
        .run(result.status, result.ai_analysis,
          result.fp_method, result.fp_confidence, result.fp_reason,
          result.fp_details ? JSON.stringify(result.fp_details) : null,
          result.triage ? JSON.stringify(result.triage) : null,
          alertId);

      writeAudit(req.user?.id, 'FP_SCAN', `Alert ${alertId} scanned → ${result.status} (method=${result.fp_method || 'none'})`);
      io.emit('alert_updated', { id: alertId, status: result.status, fp_method: result.fp_method });
      res.json({ id: alertId, ...result });
    } catch (err: any) {
      console.error('[FP Scan Error]', err?.message);
      db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('NEW', alertId);
      io.emit('alert_updated', { id: alertId, status: 'NEW' });
      res.status(500).json({ error: err?.message || 'FP scan failed' });
    }
  });

  // ── FP Scan Batch: scan all NEW alerts ──────────────────────────────────
  // "Scan All" — runs the FULL defense-in-depth pipeline on every NEW alert.
  // Each alert exits this loop with a final verdict: FALSE_POSITIVE → FP archive
  // OR TRIAGED/ESCALATED → Investigation tab (with notifications dispatched).
  app.post('/api/ai/fp-scan-batch', authenticate, async (req: any, res) => {
    try {
      const newAlerts = db.prepare("SELECT * FROM alerts WHERE status = 'NEW' ORDER BY timestamp DESC LIMIT 50").all() as any[];
      if (newAlerts.length === 0) return res.json({ scanned: 0, results: [] });

      const recentAlerts = db.prepare(
        `SELECT * FROM alerts WHERE timestamp >= datetime('now', '-3 days') ORDER BY timestamp DESC LIMIT 50`
      ).all();

      const results: any[] = [];
      for (const alert of newAlerts) {
        try {
          db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('ANALYZING', alert.id);
          io.emit('alert_updated', { id: alert.id, status: 'ANALYZING' });

          const update = await runOrchestration(alert, recentAlerts.filter((a: any) => a.id !== alert.id), { modelAssignments: getAgentModelAssignments() });

          if (update.status === 'FALSE_POSITIVE' && update.fp_method) {
            db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=?, fp_method=?, fp_reason=?, fp_confidence=?, filtered_at=datetime('now') WHERE id=?`)
              .run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, update.fp_method, update.fp_reason, update.fp_confidence ?? 0, alert.id);
          } else {
            db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=? WHERE id=?`)
              .run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, alert.id);
          }
          db.prepare('INSERT INTO agent_runs (alert_id, ai_analysis, mitre_attack, remediation_steps, status) VALUES (?, ?, ?, ?, ?)')
            .run(alert.id, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.status);

          // Dispatch Telegram/Slack/email/GLPI for non-FP outcomes only
          try {
            const parsed = JSON.parse(update.ai_analysis || '{}');
            const ticket = parsed?.ticket || parsed?.phaseData?.ticket;
            if (ticket && update.status !== 'FALSE_POSITIVE') await dispatchActions({ alertId: alert.id, ticket, db, io });
          } catch {}

          io.emit('alert_updated', { id: alert.id, ...update });
          results.push({ id: alert.id, status: update.status, fp_method: update.fp_method ?? null, fp_reason: update.fp_reason ?? null });
        } catch (err: any) {
          db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('NEW', alert.id);
          io.emit('alert_updated', { id: alert.id, status: 'NEW' });
          results.push({ id: alert.id, error: err?.message });
        }
      }

      const fpCount  = results.filter(r => r.status === 'FALSE_POSITIVE').length;
      const incCount = results.filter(r => r.status === 'TRIAGED' || r.status === 'ESCALATED').length;
      writeAudit(req.user?.id, 'SCAN_ALL', `Full pipeline scan: ${newAlerts.length} alerts → ${fpCount} FP, ${incCount} incidents`);
      res.json({ scanned: newAlerts.length, fp: fpCount, incidents: incCount, results });
    } catch (err: any) {
      console.error('[Scan All Error]', err?.message);
      res.status(500).json({ error: err?.message || 'Scan all failed' });
    }
  });

  // ── Investigation: run Steps 4-7 on a FILTERED alert ─────────────────────
  app.post('/api/ai/investigate', authenticate, async (req: any, res) => {
    const { alertId } = req.body;
    if (!alertId) return res.status(400).json({ error: 'alertId is required' });
    try {
      const alert: any = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
      if (!alert) return res.status(404).json({ error: 'Alert not found' });

      // Parse existing triage data from FP scan
      let triage: any = null;
      if (alert.triage_data) {
        try { triage = JSON.parse(alert.triage_data); } catch {}
      }
      if (!triage && alert.ai_analysis) {
        try { triage = JSON.parse(alert.ai_analysis)?.phaseData?.analysis; } catch {}
      }

      const recentAlerts = db.prepare(
        `SELECT * FROM alerts WHERE id != ? AND timestamp >= datetime('now', '-3 days') ORDER BY timestamp DESC LIMIT 50`
      ).all(alertId);

      db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('ANALYZING', alertId);
      io.emit('alert_updated', { id: alertId, status: 'ANALYZING' });

      let update;
      if (triage) {
        // Use the split investigation path (skips triage)
        update = await runInvestigation(alert, triage, recentAlerts, { modelAssignments: getAgentModelAssignments() });
      } else {
        // No triage data — fall back to full orchestration
        update = await runOrchestration(alert, recentAlerts, { modelAssignments: getAgentModelAssignments() });
      }

      if (update.status === 'FALSE_POSITIVE' && update.fp_method) {
        db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=?, fp_method=?, fp_reason=?, fp_confidence=?, filtered_at=datetime('now'), investigated_at=datetime('now') WHERE id=?`)
          .run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, update.fp_method, update.fp_reason, update.fp_confidence ?? 0, alertId);
      } else {
        db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=?, investigated_at=datetime('now') WHERE id=?`)
          .run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, alertId);
      }

      db.prepare('INSERT INTO agent_runs (alert_id, ai_analysis, mitre_attack, remediation_steps, status) VALUES (?, ?, ?, ?, ?)')
        .run(alertId, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.status);

      // Dispatch integrations only for non-FP outcomes
      try {
        const parsed = JSON.parse(update.ai_analysis || '{}');
        const ticket = parsed?.ticket || parsed?.phaseData?.ticket;
        if (ticket && update.status !== 'FALSE_POSITIVE') await dispatchActions({ alertId, ticket, db, io });
      } catch (dispatchErr: any) { console.warn('[Dispatch] Error:', dispatchErr?.message); }

      writeAudit(req.user?.id, 'INVESTIGATION_RUN', `Alert ${alertId} investigated → ${update.status}`);
      io.emit('alert_updated', { id: alertId, ...update });
      res.json({ id: alertId, ...update });
    } catch (err: any) {
      console.error('[Investigation Error]', err?.message);
      db.prepare("UPDATE alerts SET status = 'FILTERED' WHERE id = ?").run(alertId);
      io.emit('alert_updated', { id: alertId, status: 'FILTERED' });
      res.status(500).json({ error: err?.message || 'Investigation failed' });
    }
  });

  // ── FP Archive: paginated FP alerts with enriched data ───────────────────
  app.get('/api/alerts/fp-archive', authenticate, (req: any, res) => {
    const page     = Math.max(1, parseInt(String(req.query.page     || '1')));
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '25'))));
    const method   = req.query.method as string | undefined;   // suppression | memory | triage
    const source   = req.query.source as string | undefined;
    const offset   = (page - 1) * pageSize;

    const where: string[] = ["status IN ('FALSE_POSITIVE', 'FP_CONFIRMED')"];
    const params: any[] = [];
    if (method) { where.push('fp_method = ?'); params.push(method); }
    if (source) { where.push('source_ip = ?'); params.push(source); }
    const whereClause = where.join(' AND ');

    const total = (db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE ${whereClause}`).get(...params) as any).c;
    const rows  = db.prepare(
      `SELECT id, timestamp, description, severity, source_ip, dest_ip, agent_name, rule_id,
              status, fp_method, fp_confidence, fp_reason, fp_details, filtered_at
       FROM alerts WHERE ${whereClause}
       ORDER BY filtered_at DESC, timestamp DESC LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset) as any[];

    const enriched = rows.map(r => ({
      ...r,
      fp_details: r.fp_details ? (() => { try { return JSON.parse(r.fp_details); } catch { return null; } })() : null,
    }));

    res.json({ alerts: enriched, total, page, pageSize });
  });

  // ── Incident management ───────────────────────────────────────────────────
  const INCIDENT_PHASES = ['detection', 'analysis', 'containment', 'eradication', 'recovery', 'post_incident'];
  const PHASE_TO_STATUS: Record<string, string> = {
    detection:     'OPEN',
    analysis:      'OPEN',
    containment:   'IN_PROGRESS',
    eradication:   'IN_PROGRESS',
    recovery:      'CONTAINED',
    post_incident: 'RESOLVED',
  };

  // Compute status from phase + assignee. Rule:
  //   - phase past analysis → status follows phase
  //   - phase = detection or analysis:
  //       - assigned → IN_PROGRESS (an analyst is on it)
  //       - unassigned → OPEN (waiting for owner)
  //   - sticky terminal states (CLOSED / RECLASSIFIED_FP) are never auto-changed
  function computeIncidentStatus(phase: string, assignedTo: number | null, currentStatus?: string | null): string {
    if (currentStatus === 'CLOSED' || currentStatus === 'RECLASSIFIED_FP') return currentStatus;
    if (phase === 'post_incident') return 'RESOLVED';
    if (phase === 'recovery')      return 'CONTAINED';
    if (phase === 'containment' || phase === 'eradication') return 'IN_PROGRESS';
    return assignedTo ? 'IN_PROGRESS' : 'OPEN';
  }

  async function createIncidentFromAlert(args: {
    alertId:     string;
    title?:      string;
    severity?:   string;
    assigned_to: number | null;
    phase?:      string;
    note?:       string;
    create_glpi?: boolean;
    user_id:     number | null;
  }): Promise<{ id: string; glpi_ticket_id: string | null }> {
    const alert: any = db.prepare('SELECT * FROM alerts WHERE id = ?').get(args.alertId);
    if (!alert) throw new Error('Alert not found');

    let priority = args.severity;
    let actionPlan: string | null = null;
    let analysis: string | null = alert.ai_analysis || null;
    let ticket: any = null;
    try {
      const parsed = JSON.parse(alert.ai_analysis || '{}');
      ticket = parsed?.ticket || parsed?.phaseData?.ticket || null;
      if (!priority) priority = ticket?.priority || 'HIGH';
      actionPlan = parsed?.response?.actions ? JSON.stringify(parsed.response.actions) : null;
    } catch {}

    const phase  = args.phase && INCIDENT_PHASES.includes(args.phase) ? args.phase : 'analysis';
    const status = computeIncidentStatus(phase, args.assigned_to ?? null);
    const incId  = `INC-${args.alertId.slice(0, 8).toUpperCase()}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const title  = (args.title || ticket?.title || alert.description || 'Untitled').slice(0, 200);

    const reportBody = ticket?.report_body || null;
    db.prepare(
      `INSERT INTO incidents (id, title, severity, status, phase, assigned_to, escalated_by, escalated_at, analysis, action_plan, reason, report_body)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)`
    ).run(incId, title, priority || 'HIGH', status, phase, args.assigned_to ?? null, args.user_id ?? null, analysis, actionPlan, args.note || null, reportBody);

    db.prepare('INSERT OR IGNORE INTO incident_alerts (incident_id, alert_id) VALUES (?, ?)').run(incId, args.alertId);
    db.prepare("UPDATE alerts SET status = 'ESCALATED', escalated_at = datetime('now') WHERE id = ?").run(args.alertId);

    // Seed incident_actions from the agent's response.actions (best-effort)
    try {
      const parsed = JSON.parse(alert.ai_analysis || '{}');
      const planActions: any[] = parsed?.response?.actions || parsed?.phaseData?.response?.actions || [];
      const insAction = db.prepare(
        `INSERT INTO incident_actions (incident_id, action_type, target, priority, status, source, description, order_index)
         VALUES (?, ?, ?, ?, 'pending', 'ai', ?, ?)`
      );
      let orderIdx = 0;
      for (const a of (Array.isArray(planActions) ? planActions : [])) {
        const text = typeof a === 'string' ? a : (a?.action || a?.description || a?.title || JSON.stringify(a));
        const lower = String(text || '').toLowerCase();
        let actionType = 'other';
        if (/block.*ip|firewall block/.test(lower))           actionType = 'block_ip';
        else if (/isolate|quarantine|disconnect/.test(lower)) actionType = 'isolate_host';
        else if (/disable.*user|disable.*account/.test(lower))actionType = 'disable_user';
        else if (/reset password|password reset/.test(lower)) actionType = 'reset_password';
        else if (/forensic|memory dump|capture|collect/.test(lower)) actionType = 'collect_forensics';
        else if (/firewall rule|acl|policy/.test(lower))      actionType = 'firewall_rule';
        else if (/escalate|notify lead/.test(lower))          actionType = 'escalate';
        const target = a?.target || a?.ip || a?.user || a?.host || null;
        const actionPriority = a?.priority || priority || 'MEDIUM';
        insAction.run(incId, actionType, target, actionPriority, String(text || '').slice(0, 500), orderIdx++);
      }
    } catch { /* malformed action_plan — skip seeding */ }

    db.prepare(
      `INSERT INTO incident_timeline (incident_id, event_type, phase_to, status_to, user_id, note)
       VALUES (?, 'created', ?, ?, ?, ?)`
    ).run(incId, phase, status, args.user_id ?? null, args.note || null);

    if (args.assigned_to) {
      db.prepare(
        `INSERT INTO incident_timeline (incident_id, event_type, user_id, note)
         VALUES (?, 'assigned', ?, ?)`
      ).run(incId, args.user_id ?? null, `Assigned to user #${args.assigned_to}`);
    }

    let glpiTicketId: string | null = null;
    if (args.create_glpi && ticket) {
      try {
        ticket.priority = priority || 'HIGH';
        const before = (db.prepare(`SELECT MAX(id) as m FROM action_logs WHERE alert_id=? AND integration='glpi'`).get(args.alertId) as any)?.m ?? 0;
        await dispatchActions({ alertId: args.alertId, ticket, db, io });
        const newRow = db.prepare(`SELECT payload, status FROM action_logs WHERE alert_id=? AND integration='glpi' AND id > ? ORDER BY id DESC LIMIT 1`).get(args.alertId, before) as any;
        if (newRow?.status === 'success' && typeof newRow.payload === 'string') {
          const m = newRow.payload.match(/Ticket\s*#?(\d+)/i);
          if (m) glpiTicketId = m[1];
        }
        if (glpiTicketId) {
          db.prepare('UPDATE incidents SET glpi_ticket_id = ? WHERE id = ?').run(glpiTicketId, incId);
        }
      } catch (err: any) { console.warn('[Incident GLPI dispatch] Error:', err?.message); }
    }

    io.emit('alert_updated', { id: args.alertId, status: 'ESCALATED' });
    io.emit('incident_created', { id: incId });
    return { id: incId, glpi_ticket_id: glpiTicketId };
  }

  app.post('/api/incidents', authenticate, async (req: any, res) => {
    const { alert_id, title, severity, assigned_to, phase, note, create_glpi } = req.body || {};
    if (!alert_id) return res.status(400).json({ error: 'alert_id required' });
    try {
      const r = await createIncidentFromAlert({
        alertId:     alert_id,
        title, severity,
        assigned_to: typeof assigned_to === 'number' ? assigned_to : null,
        phase, note,
        create_glpi: !!create_glpi,
        user_id:     req.user?.id ?? null,
      });
      writeAudit(req.user?.id, 'INCIDENT_CREATED', `Incident ${r.id} from alert ${alert_id}`);
      res.json({ ok: true, id: r.id, glpi_ticket_id: r.glpi_ticket_id });
    } catch (err: any) {
      console.error('[Incident create] Error:', err?.message);
      res.status(500).json({ error: err?.message || 'Failed to create incident' });
    }
  });

  app.get('/api/incidents', authenticate, (req: any, res) => {
    const phase       = String(req.query.phase || '').trim();
    const status      = String(req.query.status || '').trim();
    const assignedTo  = req.query.assigned_to ? Number(req.query.assigned_to) : null;
    const q           = String(req.query.q || '').trim();
    const limit       = Math.min(Number(req.query.limit) || 50, 200);
    const offset      = Math.max(0, Number(req.query.offset) || 0);

    const where: string[] = [];
    const params: any[]   = [];
    if (phase)              { where.push('i.phase = ?');       params.push(phase); }
    if (status)             { where.push('i.status = ?');      params.push(status); }
    if (assignedTo != null) { where.push('i.assigned_to = ?'); params.push(assignedTo); }
    if (q)                  { where.push('(i.title LIKE ? OR i.id LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (db.prepare(`SELECT COUNT(*) as c FROM incidents i ${whereSql}`).get(...params) as any).c;
    const rows  = db.prepare(`
      SELECT i.*,
             u.username AS assigned_to_username,
             eu.username AS escalated_by_username,
             (SELECT COUNT(*) FROM incident_alerts WHERE incident_id = i.id) AS alert_count,
             (SELECT COUNT(*) FROM incident_actions WHERE incident_id = i.id) AS action_count,
             (SELECT COUNT(*) FROM incident_actions WHERE incident_id = i.id AND status = 'pending') AS pending_actions,
             (SELECT COUNT(*) FROM incident_actions WHERE incident_id = i.id AND status = 'executed') AS executed_actions,
             (SELECT t.event_type || '|' || COALESCE(t.note, '') || '|' || t.created_at
              FROM incident_timeline t WHERE t.incident_id = i.id
              ORDER BY t.created_at DESC, t.id DESC LIMIT 1) AS last_event_raw
      FROM incidents i
      LEFT JOIN users u  ON u.id  = i.assigned_to
      LEFT JOIN users eu ON eu.id = i.escalated_by
      ${whereSql}
      ORDER BY i.escalated_at DESC, i.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset).map((r: any) => {
      let last_event_type = null, last_event_note = null, last_event_at = null;
      if (r.last_event_raw) {
        const [t, n, at] = String(r.last_event_raw).split('|');
        last_event_type = t || null;
        last_event_note = n || null;
        last_event_at   = at || null;
      }
      const { last_event_raw, ...rest } = r;
      return { ...rest, last_event_type, last_event_note, last_event_at };
    });

    // Status counts (for the dashboard cards) — independent of filters
    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as c FROM incidents GROUP BY status
    `).all() as any[];
    const counts = { OPEN: 0, IN_PROGRESS: 0, CONTAINED: 0, RESOLVED: 0, CLOSED: 0, RECLASSIFIED_FP: 0 };
    for (const r of statusCounts) {
      if ((counts as any)[r.status] !== undefined) (counts as any)[r.status] = r.c;
    }
    res.json({ rows, total, counts });
  });

  app.get('/api/incidents/:id', authenticate, (req: any, res) => {
    const { id } = req.params;
    const inc: any = db.prepare(`
      SELECT i.*, u.username AS assigned_to_username, eu.username AS escalated_by_username
      FROM incidents i
      LEFT JOIN users u  ON u.id  = i.assigned_to
      LEFT JOIN users eu ON eu.id = i.escalated_by
      WHERE i.id = ?
    `).get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });

    inc.alerts = db.prepare(`
      SELECT a.id, a.timestamp, a.rule_id, a.description, a.severity, a.source_ip, a.dest_ip, a.agent_name, a.status, a.ai_analysis
      FROM alerts a
      INNER JOIN incident_alerts ia ON ia.alert_id = a.id
      WHERE ia.incident_id = ?
      ORDER BY a.timestamp DESC
    `).all(id);

    inc.timeline = db.prepare(`
      SELECT t.*, u.username
      FROM incident_timeline t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.incident_id = ?
      ORDER BY t.created_at ASC, t.id ASC
    `).all(id);

    inc.actions = db.prepare(`
      SELECT a.*, c.username AS created_by_username, e.username AS executed_by_username
      FROM incident_actions a
      LEFT JOIN users c ON c.id = a.created_by
      LEFT JOIN users e ON e.id = a.executed_by
      WHERE a.incident_id = ?
      ORDER BY a.order_index ASC, a.created_at ASC, a.id ASC
    `).all(id);

    res.json(inc);
  });

  // Action lifecycle (recommend → approve → execute)
  app.post('/api/incidents/:id/actions', authenticate, (req: any, res) => {
    const { id } = req.params;
    const { action_type, target, priority, description, source } = req.body || {};
    if (!action_type || !description) return res.status(400).json({ error: 'action_type and description required' });
    const inc = db.prepare('SELECT id FROM incidents WHERE id = ?').get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });
    const r = db.prepare(
      `INSERT INTO incident_actions (incident_id, action_type, target, priority, status, source, description, created_by)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`
    ).run(id, action_type, target || null, priority || 'MEDIUM', source || 'analyst', description, req.user?.id ?? null);
    res.json({ ok: true, id: r.lastInsertRowid });
  });

  app.patch('/api/incidents/:id/actions/:actionId', authenticate, (req: any, res) => {
    const { id, actionId } = req.params;
    const { status: newStatus, notes, description, target, priority, action_type } = req.body || {};
    const validStatuses = ['pending', 'approved', 'executed', 'failed', 'skipped'];
    if (newStatus && !validStatuses.includes(newStatus)) return res.status(400).json({ error: `status must be one of ${validStatuses.join(', ')}` });
    const action: any = db.prepare('SELECT * FROM incident_actions WHERE id = ? AND incident_id = ?').get(actionId, id);
    if (!action) return res.status(404).json({ error: 'Action not found' });
    const sets: string[] = [];
    const params: any[]  = [];
    if (newStatus) {
      sets.push('status = ?'); params.push(newStatus);
      if (newStatus === 'executed' || newStatus === 'failed') {
        sets.push('executed_at = datetime(\'now\')');
        sets.push('executed_by = ?'); params.push(req.user?.id ?? null);
      }
    }
    if (notes       !== undefined) { sets.push('notes = ?');       params.push(notes); }
    if (description !== undefined) { sets.push('description = ?'); params.push(description); }
    if (target      !== undefined) { sets.push('target = ?');      params.push(target); }
    if (priority    !== undefined) { sets.push('priority = ?');    params.push(priority); }
    if (action_type !== undefined) { sets.push('action_type = ?'); params.push(action_type); }
    if (sets.length === 0) return res.status(400).json({ error: 'no fields to update' });
    params.push(actionId);
    db.prepare(`UPDATE incident_actions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    if (newStatus) {
      db.prepare(
        `INSERT INTO incident_timeline (incident_id, event_type, user_id, note)
         VALUES (?, 'note', ?, ?)`
      ).run(id, req.user?.id ?? null, `Action "${action.description?.slice(0, 80) || action.action_type}" → ${newStatus}`);
    }
    res.json({ ok: true });
  });

  app.delete('/api/incidents/:id/actions/:actionId', authenticate, (req: any, res) => {
    const { id, actionId } = req.params;
    const action: any = db.prepare('SELECT description, action_type FROM incident_actions WHERE id = ? AND incident_id = ?').get(actionId, id);
    if (!action) return res.status(404).json({ error: 'Action not found' });
    db.prepare('DELETE FROM incident_actions WHERE id = ? AND incident_id = ?').run(actionId, id);
    db.prepare(
      `INSERT INTO incident_timeline (incident_id, event_type, user_id, note)
       VALUES (?, 'note', ?, ?)`
    ).run(id, req.user?.id ?? null, `Removed action "${(action.description || action.action_type).slice(0, 80)}"`);
    res.json({ ok: true });
  });

  app.post('/api/incidents/:id/actions/reorder', authenticate, (req: any, res) => {
    const { id } = req.params;
    const { ordered_ids } = req.body || {};
    if (!Array.isArray(ordered_ids)) return res.status(400).json({ error: 'ordered_ids (array) required' });
    const upd = db.prepare('UPDATE incident_actions SET order_index = ? WHERE id = ? AND incident_id = ?');
    const tx = db.transaction(() => {
      ordered_ids.forEach((aid: number, idx: number) => upd.run(idx, aid, id));
    });
    tx();
    res.json({ ok: true });
  });

  // Update incident metadata (report_body, title, severity, status)
  app.patch('/api/incidents/:id', authenticate, (req: any, res) => {
    const { id } = req.params;
    const { report_body, title, severity, status: newStatus } = req.body || {};
    const validStatuses = ['OPEN', 'IN_PROGRESS', 'CONTAINED', 'RESOLVED', 'CLOSED', 'RECLASSIFIED_FP'];

    const inc: any = db.prepare('SELECT status, assigned_to FROM incidents WHERE id = ?').get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });

    const requesterRole = req.user?.role;
    const isOwner = inc.assigned_to === req.user?.id;
    const canEdit = ['ADMIN', 'INCIDENT_LEAD'].includes(requesterRole) || (requesterRole === 'TIER2' && isOwner);
    if (!canEdit) return res.status(403).json({ error: 'Not allowed to edit this incident' });

    const sets: string[] = ['updated_at = datetime(\'now\')'];
    const params: any[]  = [];
    if (report_body !== undefined) { sets.push('report_body = ?'); params.push(report_body); }
    if (title       !== undefined) { sets.push('title = ?');       params.push(title.slice(0, 200)); }
    if (severity    !== undefined) { sets.push('severity = ?');    params.push(severity); }
    if (newStatus   !== undefined) {
      if (!validStatuses.includes(newStatus)) return res.status(400).json({ error: `status must be one of ${validStatuses.join(', ')}` });
      sets.push('status = ?'); params.push(newStatus);
      db.prepare(
        `INSERT INTO incident_timeline (incident_id, event_type, status_from, status_to, user_id)
         VALUES (?, 'status_change', ?, ?, ?)`
      ).run(id, inc.status, newStatus, req.user?.id ?? null);
    }
    if (sets.length === 1) return res.status(400).json({ error: 'no fields to update' });
    params.push(id);
    db.prepare(`UPDATE incidents SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    if (newStatus) writeAudit(req.user?.id, 'INCIDENT_STATUS', `Incident ${id} status ${inc.status} → ${newStatus}`);
    io.emit('incident_updated', { id });
    res.json({ ok: true });
  });

  // Reclassify as False Positive
  app.post('/api/incidents/:id/reclassify-fp', authenticate, (req: any, res) => {
    const { id } = req.params;
    const { note } = req.body || {};
    const inc: any = db.prepare('SELECT status, assigned_to FROM incidents WHERE id = ?').get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });

    const requesterRole = req.user?.role;
    const isOwner = inc.assigned_to === req.user?.id;
    if (!['ADMIN', 'INCIDENT_LEAD'].includes(requesterRole) && !(requesterRole === 'TIER2' && isOwner)) {
      return res.status(403).json({ error: 'Only ADMIN, INCIDENT_LEAD, or assigned TIER2 can reclassify' });
    }

    db.prepare(
      `UPDATE incidents SET status = 'RECLASSIFIED_FP', closed_by = ?, closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).run(req.user?.id ?? null, id);

    // Push linked alerts back to the FP archive
    const linked = db.prepare('SELECT alert_id FROM incident_alerts WHERE incident_id = ?').all(id) as any[];
    for (const r of linked) {
      db.prepare(
        `UPDATE alerts SET status = 'FALSE_POSITIVE', fp_method = 'analyst',
           fp_reason = COALESCE(fp_reason, 'Reclassified by analyst from incident ' || ?),
           fp_confidence = COALESCE(NULLIF(fp_confidence, 0), 1.0),
           filtered_at = datetime('now')
         WHERE id = ?`
      ).run(id, r.alert_id);
    }

    db.prepare(
      `INSERT INTO incident_timeline (incident_id, event_type, status_from, status_to, user_id, note)
       VALUES (?, 'reclassified_fp', ?, 'RECLASSIFIED_FP', ?, ?)`
    ).run(id, inc.status, req.user?.id ?? null, note || null);

    writeAudit(req.user?.id, 'INCIDENT_RECLASSIFIED_FP', `Incident ${id} reclassified as FP (${linked.length} alert(s) returned to archive)`);
    io.emit('incident_updated', { id });
    res.json({ ok: true, status: 'RECLASSIFIED_FP', alerts_returned_to_archive: linked.length });
  });

  app.patch('/api/incidents/:id/assign', authenticate, (req: any, res) => {
    const { id } = req.params;
    const { user_id, note } = req.body || {};
    // null/undefined user_id → unassign
    const targetUserId: number | null = (typeof user_id === 'number') ? user_id : (user_id === null ? null : NaN);
    if (Number.isNaN(targetUserId)) return res.status(400).json({ error: 'user_id (number or null) required' });

    const inc: any = db.prepare('SELECT assigned_to, phase, status FROM incidents WHERE id = ?').get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });

    const requesterRole = req.user?.role;
    const requesterId   = req.user?.id;
    const isReassign    = inc.assigned_to !== null && targetUserId !== inc.assigned_to;
    const isClaim       = inc.assigned_to === null && targetUserId !== null;
    const isSelfClaim   = isClaim && targetUserId === requesterId;
    const isUnassign    = inc.assigned_to !== null && targetUserId === null;

    // Authorization rules:
    //  - Anyone in ADMIN/INCIDENT_LEAD can assign/reassign/unassign freely
    //  - TIER2 / ADMIN can claim an UNASSIGNED incident (self-assign or claim for self)
    if (isReassign || isUnassign) {
      if (!['ADMIN', 'INCIDENT_LEAD'].includes(requesterRole)) {
        return res.status(403).json({ error: 'Only ADMIN or INCIDENT_LEAD can reassign or unassign' });
      }
    } else if (isClaim && !isSelfClaim) {
      if (!['ADMIN', 'INCIDENT_LEAD'].includes(requesterRole)) {
        return res.status(403).json({ error: 'Only ADMIN or INCIDENT_LEAD can assign others' });
      }
    } else if (isSelfClaim) {
      if (!['ADMIN', 'INCIDENT_LEAD', 'TIER2'].includes(requesterRole)) {
        return res.status(403).json({ error: 'Only TIER2+ users can claim an incident' });
      }
    }

    // Compute auto-status (OPEN ↔ IN_PROGRESS based on assignment, when phase ≤ analysis)
    const newStatus = computeIncidentStatus(inc.phase, targetUserId, inc.status);
    const statusChanged = newStatus !== inc.status;

    db.prepare(`UPDATE incidents SET assigned_to = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(targetUserId, newStatus, id);

    db.prepare(
      `INSERT INTO incident_timeline (incident_id, event_type, user_id, note)
       VALUES (?, 'assigned', ?, ?)`
    ).run(
      id, requesterId ?? null,
      note || (isUnassign  ? `Unassigned (was user #${inc.assigned_to})` :
               isSelfClaim ? `Claimed by ${req.user?.username || ('user #' + requesterId)}` :
               isClaim     ? `Assigned to user #${targetUserId}` :
                             `Reassigned (was user #${inc.assigned_to ?? 'unassigned'} → user #${targetUserId})`)
    );

    if (statusChanged) {
      db.prepare(
        `INSERT INTO incident_timeline (incident_id, event_type, status_from, status_to, user_id, note)
         VALUES (?, 'status_change', ?, ?, ?, ?)`
      ).run(id, inc.status, newStatus, requesterId ?? null,
        targetUserId ? 'Auto-promoted to Investigating on assignment'
                     : 'Auto-reverted to Open on unassignment');
    }

    writeAudit(req.user?.id, 'INCIDENT_ASSIGNED',
      isUnassign ? `Incident ${id} unassigned (was user #${inc.assigned_to})` :
                   `Incident ${id} assigned to user #${targetUserId}`);
    io.emit('incident_updated', { id });
    res.json({ ok: true, status: newStatus });
  });

  // Self-claim shortcut — any TIER2+ user can claim an unassigned incident
  app.post('/api/incidents/:id/take', authenticate, (req: any, res) => {
    const { id } = req.params;
    const requesterRole = req.user?.role;
    const requesterId   = req.user?.id;
    if (!['ADMIN', 'INCIDENT_LEAD', 'TIER2'].includes(requesterRole)) {
      return res.status(403).json({ error: 'Only TIER2+ users can claim an incident' });
    }
    const inc: any = db.prepare('SELECT assigned_to, phase, status FROM incidents WHERE id = ?').get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });
    if (inc.assigned_to && inc.assigned_to !== requesterId) {
      return res.status(409).json({ error: 'Incident is already assigned to someone else' });
    }
    const newStatus = computeIncidentStatus(inc.phase, requesterId, inc.status);
    db.prepare(`UPDATE incidents SET assigned_to = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(requesterId, newStatus, id);
    db.prepare(
      `INSERT INTO incident_timeline (incident_id, event_type, user_id, note)
       VALUES (?, 'assigned', ?, ?)`
    ).run(id, requesterId, `Claimed by ${req.user?.username}`);
    if (newStatus !== inc.status) {
      db.prepare(
        `INSERT INTO incident_timeline (incident_id, event_type, status_from, status_to, user_id, note)
         VALUES (?, 'status_change', ?, ?, ?, 'Auto-promoted to Investigating on claim')`
      ).run(id, inc.status, newStatus, requesterId);
    }
    writeAudit(requesterId, 'INCIDENT_CLAIMED', `Incident ${id} self-claimed`);
    io.emit('incident_updated', { id });
    res.json({ ok: true, status: newStatus, assigned_to: requesterId });
  });

  app.patch('/api/incidents/:id/phase', authenticate, (req: any, res) => {
    const { id } = req.params;
    const { phase, note } = req.body || {};
    if (!INCIDENT_PHASES.includes(phase)) return res.status(400).json({ error: `phase must be one of: ${INCIDENT_PHASES.join(', ')}` });

    const inc: any = db.prepare('SELECT phase, status, assigned_to FROM incidents WHERE id = ?').get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });

    const requesterRole = req.user?.role;
    const isOwner = inc.assigned_to === req.user?.id;
    if (!['ADMIN', 'INCIDENT_LEAD'].includes(requesterRole) && !(requesterRole === 'TIER2' && isOwner)) {
      return res.status(403).json({ error: 'Only ADMIN, INCIDENT_LEAD, or assigned TIER2 can move phase' });
    }

    const newStatus = computeIncidentStatus(phase, inc.assigned_to, inc.status);
    db.prepare(`UPDATE incidents SET phase = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(phase, newStatus, id);
    db.prepare(
      `INSERT INTO incident_timeline (incident_id, event_type, phase_from, phase_to, status_from, status_to, user_id, note)
       VALUES (?, 'phase_change', ?, ?, ?, ?, ?, ?)`
    ).run(id, inc.phase, phase, inc.status, newStatus, req.user?.id ?? null, note || null);
    writeAudit(req.user?.id, 'INCIDENT_PHASE', `Incident ${id} phase ${inc.phase} → ${phase}`);
    io.emit('incident_updated', { id });
    res.json({ ok: true, phase, status: newStatus });
  });

  app.post('/api/incidents/:id/close', authenticate, (req: any, res) => {
    const { id } = req.params;
    const { note } = req.body || {};

    const inc: any = db.prepare('SELECT status, assigned_to FROM incidents WHERE id = ?').get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });
    if (inc.status === 'CLOSED') return res.json({ ok: true, status: 'CLOSED' });

    const requesterRole = req.user?.role;
    const isOwner = inc.assigned_to === req.user?.id;
    if (!['ADMIN', 'INCIDENT_LEAD'].includes(requesterRole) && !(requesterRole === 'TIER2' && isOwner)) {
      return res.status(403).json({ error: 'Only ADMIN, INCIDENT_LEAD, or assigned TIER2 can close' });
    }

    db.prepare(
      `UPDATE incidents SET status = 'CLOSED', closed_by = ?, closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).run(req.user?.id ?? null, id);
    db.prepare(
      `INSERT INTO incident_timeline (incident_id, event_type, status_from, status_to, user_id, note)
       VALUES (?, 'closed', ?, 'CLOSED', ?, ?)`
    ).run(id, inc.status, req.user?.id ?? null, note || null);
    writeAudit(req.user?.id, 'INCIDENT_CLOSED', `Incident ${id} closed`);
    io.emit('incident_updated', { id });
    res.json({ ok: true, status: 'CLOSED' });
  });

  app.post('/api/incidents/:id/timeline', authenticate, (req: any, res) => {
    const { id } = req.params;
    const { note } = req.body || {};
    if (!note || typeof note !== 'string' || note.trim().length === 0) return res.status(400).json({ error: 'note required' });

    const inc: any = db.prepare('SELECT id FROM incidents WHERE id = ?').get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });

    db.prepare(
      `INSERT INTO incident_timeline (incident_id, event_type, user_id, note)
       VALUES (?, 'note', ?, ?)`
    ).run(id, req.user?.id ?? null, note.slice(0, 2000));
    io.emit('incident_updated', { id });
    res.json({ ok: true });
  });

  // ── Escalate alert: legacy endpoint, delegates to incident creation ────────
  app.post('/api/alerts/:id/escalate', authenticate, async (req: any, res) => {
    const { id } = req.params;
    try {
      const r = await createIncidentFromAlert({
        alertId:     id,
        assigned_to: null,
        create_glpi: true,
        user_id:     req.user?.id ?? null,
      });
      writeAudit(req.user?.id, 'ALERT_ESCALATED', `Alert ${id} escalated → incident ${r.id} (legacy)`);
      res.json({ ok: true, status: 'ESCALATED', incident_id: r.id });
    } catch (err: any) {
      console.error('[Legacy escalate] Error:', err?.message);
      res.status(500).json({ error: err?.message || 'Escalation failed' });
    }
  });

  // ── Confirm FP (analyst confirms FP verdict) ──────────────────────────────
  app.post('/api/alerts/:id/confirm-fp', authenticate, (req: any, res) => {
    const { id } = req.params;
    db.prepare(
      `UPDATE alerts SET status = 'FP_CONFIRMED', closed_at = datetime('now'),
         fp_method = COALESCE(fp_method, 'analyst'),
         fp_reason = COALESCE(fp_reason, 'Confirmed as false positive by analyst'),
         fp_confidence = COALESCE(NULLIF(fp_confidence, 0), 1.0),
         filtered_at = COALESCE(filtered_at, datetime('now'))
       WHERE id = ?`
    ).run(id);
    writeAudit(req.user?.id, 'FP_CONFIRMED', `Alert ${id} FP confirmed by analyst`);
    io.emit('alert_updated', { id, status: 'FP_CONFIRMED' });
    res.json({ ok: true, status: 'FP_CONFIRMED' });
  });

  // ── Override FP (analyst overrides, sends back to investigation) ───────────
  app.post('/api/alerts/:id/override-fp', authenticate, (req: any, res) => {
    const { id } = req.params;
    db.prepare("UPDATE alerts SET status = 'FILTERED', fp_method = NULL, fp_reason = NULL, fp_confidence = 0 WHERE id = ?").run(id);
    writeAudit(req.user?.id, 'FP_OVERRIDDEN', `Alert ${id} FP overridden — sent to investigation`);
    io.emit('alert_updated', { id, status: 'FILTERED' });
    res.json({ ok: true, status: 'FILTERED' });
  });

  // ── Pipeline Funnel Analytics ─────────────────────────────────────────────
  app.get('/api/analytics/pipeline-funnel', authenticate, (_req, res) => {
    const ingested     = (db.prepare("SELECT COUNT(*) as c FROM alerts").get() as any).c;
    const newAlerts    = (db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status = 'NEW'").get() as any).c;
    const fpFiltered   = (db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status IN ('FALSE_POSITIVE','FP_CONFIRMED')").get() as any).c;
    const filtered     = (db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status = 'FILTERED'").get() as any).c;
    const investigated = (db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status IN ('TRIAGED','ESCALATED','CLOSED') AND investigated_at IS NOT NULL").get() as any).c;
    const escalated    = (db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status = 'ESCALATED'").get() as any).c;
    const closed       = (db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status = 'CLOSED'").get() as any).c;

    // Timing metrics
    const timingRow = db.prepare(`
      SELECT
        AVG(CASE WHEN filtered_at IS NOT NULL THEN (strftime('%s', filtered_at) - strftime('%s', timestamp)) END) as avg_filter_sec,
        AVG(CASE WHEN investigated_at IS NOT NULL THEN (strftime('%s', investigated_at) - strftime('%s', filtered_at)) END) as avg_investigate_sec,
        AVG(CASE WHEN closed_at IS NOT NULL THEN (strftime('%s', closed_at) - strftime('%s', timestamp)) END) as avg_close_sec
      FROM alerts
    `).get() as any;

    res.json({
      ingested, new: newAlerts, fp_filtered: fpFiltered, awaiting_investigation: filtered,
      investigated, escalated, closed,
      avg_time_to_filter_sec:      timingRow?.avg_filter_sec ? Math.round(timingRow.avg_filter_sec) : null,
      avg_time_to_investigate_sec: timingRow?.avg_investigate_sec ? Math.round(timingRow.avg_investigate_sec) : null,
      avg_time_to_close_sec:       timingRow?.avg_close_sec ? Math.round(timingRow.avg_close_sec) : null,
    });
  });

  // ── Detection Method Effectiveness ────────────────────────────────────────
  app.get('/api/analytics/detection-effectiveness', authenticate, (_req, res) => {
    const methods = ['suppression', 'memory', 'triage'];
    const result: any = {};
    for (const m of methods) {
      const total    = (db.prepare("SELECT COUNT(*) as c FROM alerts WHERE fp_method = ?").get(m) as any).c;
      const confirmed = (db.prepare("SELECT COUNT(*) as c FROM alerts WHERE fp_method = ? AND status = 'FP_CONFIRMED'").get(m) as any).c;
      const overridden = (db.prepare("SELECT COUNT(*) as c FROM alerts WHERE fp_method = ? AND status = 'FILTERED'").get(m) as any).c;
      result[m] = {
        total_caught: total,
        analyst_confirmed: confirmed,
        analyst_overridden: overridden,
        accuracy: total > 0 ? Number(((total - overridden) / total).toFixed(3)) : 1,
      };
    }
    const totalAll = Object.values(result).reduce((s: number, m: any) => s + (m.total_caught || 0), 0) as number;
    const overAll  = Object.values(result).reduce((s: number, m: any) => s + (m.analyst_overridden || 0), 0) as number;
    result.overall = {
      total_caught: totalAll,
      analyst_overridden: overAll,
      accuracy: totalAll > 0 ? Number(((totalAll - overAll) / totalAll).toFixed(3)) : 1,
    };
    res.json(result);
  });

  // ── Source Distribution Analytics ─────────────────────────────────────────
  app.get('/api/analytics/source-distribution', authenticate, (_req, res) => {
    const byAgent = db.prepare(`
      SELECT agent_name as name, COUNT(*) as count
      FROM alerts WHERE agent_name IS NOT NULL AND agent_name != ''
      GROUP BY agent_name ORDER BY count DESC LIMIT 15
    `).all();
    const byRule = db.prepare(`
      SELECT rule_id, description, COUNT(*) as count
      FROM alerts WHERE rule_id IS NOT NULL
      GROUP BY rule_id ORDER BY count DESC LIMIT 15
    `).all();
    res.json({ by_agent: byAgent, by_rule: byRule });
  });

  // ── AI: run a single agent phase ──────────────────────────────────────────
  app.post('/api/ai/agent', authenticate, async (req: any, res) => {
    const { phase, state } = req.body;
    if (!phase || !state)  return res.status(400).json({ error: 'phase and state are required' });
    if (!isAgentPhase(phase)) return res.status(400).json({ error: 'Invalid phase' });
    try {
      const result = await runPhase(phase, state, { modelAssignments: getAgentModelAssignments() });
      res.json(result);
    } catch (err: any) {
      console.error('[AI Agent Error]', err?.message);
      res.status(500).json({ error: err?.message || 'Agent failed' });
    }
  });

  // ── AI: run full swarm — rate limited to 10/15 min per IP ──────────────────
  const orchestrateLimit = rateLimit({
    windowMs:       15 * 60_000,
    max:            10,
    standardHeaders:true,
    legacyHeaders:  false,
    message:        { error: 'Too many orchestration requests. Please wait before running agents again.' },
  });

  app.post('/api/ai/orchestrate', authenticate, orchestrateLimit, async (req: any, res) => {
    const { alertId, force } = req.body;
    if (!alertId) return res.status(400).json({ error: 'alertId is required' });
    try {
      const alert: any = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
      if (!alert) return res.status(404).json({ error: 'Alert not found' });

      // Skip-replay: if a successful agent_runs row exists in the last 5 minutes, return it
      // unless the caller forces a re-run. Prevents re-orchestrating on every UI refresh.
      if (!force) {
        const recent = db.prepare(`
          SELECT ai_analysis, mitre_attack, remediation_steps, status
          FROM agent_runs
          WHERE alert_id = ? AND ai_analysis IS NOT NULL
            AND run_at >= datetime('now', '-5 minutes')
          ORDER BY run_at DESC LIMIT 1
        `).get(alertId) as any;
        if (recent) {
          return res.json({ id: alertId, ...recent, replayed: true });
        }
      }

      const recentAlerts = db.prepare(
        `SELECT * FROM alerts WHERE id != ? AND timestamp >= datetime('now', '-3 days') ORDER BY timestamp DESC LIMIT 50`
      ).all(alertId);

      db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('ANALYZING', alertId);
      io.emit('alert_updated', { id: alertId, status: 'ANALYZING' });

      const update = await runOrchestration(alert, recentAlerts, { modelAssignments: getAgentModelAssignments() });

      db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=? WHERE id=?`)
        .run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, alertId);

      db.prepare('INSERT INTO agent_runs (alert_id, ai_analysis, mitre_attack, remediation_steps, status) VALUES (?, ?, ?, ?, ?)')
        .run(alertId, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.status);

      // Dispatch to all enabled integrations (email, GLPI, Telegram) based on ticket priority
      try {
        const parsed = JSON.parse(update.ai_analysis || '{}');
        const ticket = parsed?.ticket || parsed?.phaseData?.ticket;
        if (ticket) {
          await dispatchActions({ alertId, ticket, db, io });
        }
      } catch (dispatchErr: any) {
        console.warn('[Dispatch] Error:', dispatchErr?.message);
      }

      writeAudit(req.user?.id, 'ORCHESTRATION_RUN', `Alert ${alertId} orchestrated → ${update.status}`);
      io.emit('alert_updated', { id: alertId, ...update });
      res.json({ id: alertId, ...update });
    } catch (err: any) {
      console.error('[Orchestration Error]', err?.message);
      db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('NEW', alertId);
      io.emit('alert_updated', { id: alertId, status: 'NEW' });
      res.status(500).json({ error: err?.message || 'Orchestration failed' });
    }
  });

  // ── Agent run history & feedback ──────────────────────────────────────────
  app.get('/api/alerts/:alertId/runs', authenticate, (req, res) => {
    const { alertId } = req.params;
    res.json(db.prepare('SELECT * FROM agent_runs WHERE alert_id = ? ORDER BY run_at DESC LIMIT 20').all(alertId));
  });

  app.post('/api/feedback', authenticate, (req: any, res) => {
    const { alert_id, phase, is_accurate, comment } = req.body;
    if (!alert_id || !phase) return res.status(400).json({ error: 'alert_id and phase are required' });
    try {
      db.prepare('INSERT INTO feedback (alert_id, phase, user_id, is_accurate, comment) VALUES (?, ?, ?, ?, ?)').run(alert_id, phase, req.user.id, is_accurate ? 1 : 0, comment || null);
      res.json({ status: 'ok' });
    } catch (err) {
      console.error('Feedback error:', err);
      res.status(500).json({ error: 'Failed to save feedback' });
    }
  });

  app.post('/api/alerts/:alertId/runs', authenticate, (req: any, res) => {
    const { alertId } = req.params;
    const { ai_analysis, mitre_attack, remediation_steps, status } = req.body || {};
    const result = db.prepare('INSERT INTO agent_runs (alert_id, ai_analysis, mitre_attack, remediation_steps, status) VALUES (?, ?, ?, ?, ?)')
      .run(alertId, ai_analysis || null, mitre_attack || null, remediation_steps || null, status || 'TRIAGED');
    res.json({ id: result.lastInsertRowid, run_at: new Date().toISOString() });
  });

  // ── Playbooks ─────────────────────────────────────────────────────────────
  app.get('/api/playbooks', authenticate, (_req, res) => {
    res.json(db.prepare('SELECT * FROM playbooks ORDER BY tactic, title').all());
  });

  app.post('/api/playbooks', authenticate, requireAdmin, (req: any, res) => {
    const { tactic, title, steps } = req.body;
    if (!tactic || !title || !steps) return res.status(400).json({ error: 'tactic, title and steps are required' });
    try {
      const result = db.prepare('INSERT INTO playbooks (tactic, title, steps, created_by) VALUES (?, ?, ?, ?)').run(tactic, title, steps, req.user?.id || null);
      writeAudit(req.user?.id, 'PLAYBOOK_CREATED', `Playbook "${title}" for tactic ${tactic}`);
      res.json({ id: result.lastInsertRowid, tactic, title, steps });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create playbook' });
    }
  });

  app.delete('/api/playbooks/:id', authenticate, requireAdmin, (req: any, res) => {
    db.prepare('DELETE FROM playbooks WHERE id = ?').run(req.params.id);
    writeAudit(req.user?.id, 'PLAYBOOK_DELETED', `Playbook #${req.params.id} deleted`);
    res.json({ status: 'ok' });
  });

  app.patch('/api/playbooks/:id', authenticate, requireAdmin, (req: any, res) => {
    const { tactic, title, steps } = req.body || {};
    const updates: string[] = [];
    const values: any[]     = [];
    if (tactic !== undefined) { updates.push('tactic = ?'); values.push(tactic); }
    if (title  !== undefined) { updates.push('title = ?');  values.push(title); }
    if (steps  !== undefined) { updates.push('steps = ?');  values.push(steps); }
    if (updates.length === 0) return res.status(400).json({ error: 'no fields to update' });
    values.push(req.params.id);
    db.prepare(`UPDATE playbooks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    writeAudit(req.user?.id, 'PLAYBOOK_UPDATED', `Playbook #${req.params.id} updated`);
    res.json({ ok: true });
  });

  // ── Integrations ─────────────────────────────────────────────────────────
  app.get('/api/integrations', authenticate, (_req, res) => {
    const rows = db.prepare('SELECT * FROM integrations').all() as any[];
    const result = rows.filter(r => r.name !== 'wazuh').map(r => {
      let cfg: any = {};
      try { cfg = JSON.parse(r.config || '{}'); } catch {}
      const stats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN status='failed'  THEN 1 ELSE 0 END) as failed
        FROM action_logs
        WHERE integration=? AND created_at >= datetime('now', '-1 day')
      `).get(r.name) as any;
      return {
        name:                r.name,
        enabled:             r.enabled === 1,
        config:              cfg,
        auto_send_threshold: r.auto_send_threshold,
        updated_at:          r.updated_at,
        stats_24h:           { total: stats?.total || 0, success: stats?.success || 0, failed: stats?.failed || 0 },
      };
    });
    res.json(result);
  });

  app.patch('/api/integrations/:name', authenticate, requireAdmin, (req: any, res) => {
    const { name } = req.params;
    const { enabled, config, auto_send_threshold } = req.body;
    const updates: string[] = ["updated_at = datetime('now')"];
    const values: any[]     = [];
    if (enabled !== undefined)             { updates.push('enabled = ?');             values.push(enabled ? 1 : 0); }
    if (config  !== undefined)             { updates.push('config = ?');              values.push(JSON.stringify(config)); }
    if (auto_send_threshold !== undefined) { updates.push('auto_send_threshold = ?'); values.push(auto_send_threshold); }
    values.push(name);
    db.prepare(`UPDATE integrations SET ${updates.join(', ')} WHERE name = ?`).run(...values);
    writeAudit(req.user?.id, 'INTEGRATION_UPDATED', `Integration ${name} updated`);
    res.json({ ok: true });
  });

  app.post('/api/integrations/:name/test', authenticate, requireAdmin, async (req: any, res) => {
    const { name } = req.params;
    const row = db.prepare("SELECT * FROM integrations WHERE name=?").get(name) as any;
    if (!row) return res.status(404).json({ ok: false, error: 'Integration not found' });
    let cfg: any = {};
    try { cfg = JSON.parse(row.config || '{}'); } catch {}

    const logAction = db.prepare('INSERT INTO action_logs (alert_id, integration, action, status, payload, error) VALUES (?, ?, ?, ?, ?, ?)');

    if (name === 'email') {
      try {
        await sendIncidentAlert('Test from BBS AISOC', 'This is a test notification from the BBS AISOC platform. If you received this, email integration is working correctly.', cfg);
        logAction.run(null, 'email', 'test', 'success', 'Test email', null);
        return res.json({ ok: true });
      } catch (err: any) {
        logAction.run(null, 'email', 'test', 'failed', 'Test email', err?.message);
        return res.json({ ok: false, error: err?.message });
      }
    }
    if (name === 'slack') {
      if (!cfg.webhook_url) return res.json({ ok: false, error: 'Webhook URL is required' });
      const result = await sendSlackWebhook(cfg.webhook_url, '🔔 *[BBS AISOC]* Test message — Slack integration is working correctly!');
      logAction.run(null, 'slack', 'test', result.ok ? 'success' : 'failed', 'Test message', result.error || null);
      return res.json(result);
    }
    if (name === 'telegram') {
      if (!cfg.bot_token || !cfg.chat_id) return res.json({ ok: false, error: 'Bot token and chat ID are required' });
      const result = await sendTelegramMessage({ botToken: cfg.bot_token, chatId: cfg.chat_id }, '🔔 <b>[BBS AISOC]</b> Test message — integration is working correctly!');
      logAction.run(null, 'telegram', 'test', result.ok ? 'success' : 'failed', 'Test message', result.error || null);
      return res.json(result);
    }
    if (name === 'glpi') {
      if (!cfg.url || !cfg.app_token || !cfg.user_token) return res.json({ ok: false, error: 'URL, App Token and User Token are required' });
      const result = await createGlpiTicket(
        { url: cfg.url, appToken: cfg.app_token, userToken: cfg.user_token },
        { title: 'BBS AISOC — Integration Test', content: 'This ticket was created to verify the GLPI integration is working correctly.', urgency: 1 }
      );
      logAction.run(null, 'glpi', 'test', result.ok ? 'success' : 'failed', result.ok ? `Ticket #${result.ticketId}` : 'Test ticket', result.error || null);
      return res.json(result);
    }
    return res.json({ ok: false, error: 'Unknown integration' });
  });

  app.get('/api/action-logs', authenticate, (req: any, res) => {
    const limit       = Math.min(200, parseInt(String(req.query.limit  || '50')));
    const integration = req.query.integration as string | undefined;
    const status      = req.query.status as string | undefined;
    const where: string[] = [];
    const params: any[] = [];
    if (integration) { where.push('integration = ?'); params.push(integration); }
    if (status)      { where.push('status = ?');      params.push(status); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const logs = db.prepare(`SELECT * FROM action_logs ${whereClause} ORDER BY created_at DESC LIMIT ?`).all(...params, limit);
    res.json(logs);
  });

  app.get('/api/action-stats', authenticate, (_req, res) => {
    const total    = (db.prepare("SELECT COUNT(*) as c FROM action_logs").get() as any).c;
    const today    = (db.prepare("SELECT COUNT(*) as c FROM action_logs WHERE created_at >= date('now')").get() as any).c;
    const success  = (db.prepare("SELECT COUNT(*) as c FROM action_logs WHERE status='success'").get() as any).c;
    const perInteg = db.prepare(`
      SELECT integration,
        COUNT(*) as total,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success,
        MAX(created_at) as last_at
      FROM action_logs GROUP BY integration
    `).all();
    res.json({ total, today, success_rate: total > 0 ? Math.round((success / total) * 100) : 0, per_integration: perInteg });
  });

  // ── Reports ───────────────────────────────────────────────────────────────
  app.get('/api/reports/summary', authenticate, (_req, res) => {
    const total      = (db.prepare("SELECT COUNT(*) as c FROM agent_runs").get() as any).c;
    const last7      = (db.prepare("SELECT COUNT(*) as c FROM agent_runs WHERE run_at >= datetime('now','-7 days')").get() as any).c;
    const emailSent  = (db.prepare("SELECT COUNT(*) as c FROM alerts WHERE email_sent=1").get() as any).c;
    const totalAlerts= (db.prepare("SELECT COUNT(*) as c FROM alerts").get() as any).c;

    const daily = db.prepare(`
      SELECT date(run_at) as day, COUNT(*) as count
      FROM agent_runs WHERE run_at >= datetime('now','-7 days')
      GROUP BY date(run_at) ORDER BY day ASC
    `).all() as Array<{ day: string; count: number }>;
    const dailyFilled: Array<{ day: string; count: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d   = new Date(); d.setDate(d.getDate() - i);
      const day = d.toISOString().split('T')[0];
      dailyFilled.push({ day, count: daily.find(r => r.day === day)?.count ?? 0 });
    }

    res.json({
      total,
      last_7_days:          last7,
      email_sent_pct:       totalAlerts > 0 ? Math.round((emailSent / totalAlerts) * 100) : 0,
      daily_volume:         dailyFilled,
    });
  });

  app.get('/api/reports', authenticate, (req: any, res) => {
    const page     = Math.max(1, parseInt(String(req.query.page     || '1')));
    const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize || '20'))));
    const offset   = (page - 1) * pageSize;
    const priority = req.query.priority as string | undefined;

    const rows = db.prepare(`
      SELECT ar.id, ar.alert_id, ar.run_at, ar.status, ar.ai_analysis,
             a.description, a.severity, a.source_ip, a.email_sent
      FROM agent_runs ar
      JOIN alerts a ON a.id = ar.alert_id
      ORDER BY ar.run_at DESC
      LIMIT ? OFFSET ?
    `).all(pageSize * 5, offset * 5) as any[]; // fetch extra for priority filter

    const totalRow = (db.prepare("SELECT COUNT(*) as c FROM agent_runs").get() as any).c;

    const reports = rows.map(r => {
      let ticket: any = null;
      try {
        const ai = JSON.parse(r.ai_analysis || '{}');
        ticket = ai?.ticket || ai?.phaseData?.ticket;
      } catch {}

      const actionLogs = db.prepare("SELECT integration FROM action_logs WHERE alert_id=? AND status='success'").all(r.alert_id) as any[];

      return {
        id:                  r.id,
        alert_id:            r.alert_id,
        run_at:              r.run_at,
        status:              r.status,
        severity:            r.severity,
        description:         r.description,
        source_ip:           r.source_ip,
        email_sent:          r.email_sent,
        title:               ticket?.title   || null,
        priority:            ticket?.priority || null,
        confidence:          typeof ticket?.confidence === 'number' ? Math.round(ticket.confidence * 100) : null,
        report_body:         ticket?.report_body || null,
        actions_dispatched:  actionLogs.map(l => l.integration),
      };
    }).filter(r => !priority || r.priority === priority).slice(0, pageSize);

    res.json({ reports, total: totalRow, page, pageSize });
  });

  // ── Firewalls ─────────────────────────────────────────────────────────────
  app.get('/api/firewalls', authenticate, (_req, res) => {
    const rows = db.prepare('SELECT * FROM firewalls ORDER BY created_at DESC').all() as any[];
    const result = rows.map(fw => {
      let cfg: any = {};
      try { cfg = JSON.parse(fw.config || '{}'); } catch {}
      const blocks = db.prepare("SELECT COUNT(*) as c FROM firewall_blocks WHERE firewall_id=? AND status='blocked'").get(fw.id) as any;
      return { ...fw, config: cfg, enabled: fw.enabled === 1, auto_block: fw.auto_block === 1, active_blocks: blocks?.c || 0 };
    });
    res.json(result);
  });

  app.post('/api/firewalls', authenticate, requireAdmin, (req: any, res) => {
    const { name, type, config, enabled, auto_block } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
    if (!['fortigate','pfsense','sophos'].includes(type)) return res.status(400).json({ error: 'type must be fortigate, pfsense, or sophos' });
    try {
      const result = db.prepare(
        'INSERT INTO firewalls (name, type, enabled, config, auto_block) VALUES (?, ?, ?, ?, ?)'
      ).run(name, type, enabled ? 1 : 0, JSON.stringify(config || {}), auto_block ? 1 : 0);
      writeAudit(req.user?.id, 'FIREWALL_CREATED', `Firewall ${name} (${type}) added`);
      res.json({ id: result.lastInsertRowid, name, type });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Firewall name already exists' });
      res.status(500).json({ error: 'Failed to create firewall' });
    }
  });

  app.patch('/api/firewalls/:id', authenticate, requireAdmin, (req: any, res) => {
    const { id } = req.params;
    const { name, enabled, config, auto_block } = req.body;
    const updates = ['updated_at = datetime("now")'];
    const values: any[] = [];
    if (name      !== undefined) { updates.push('name = ?');       values.push(name); }
    if (enabled   !== undefined) { updates.push('enabled = ?');    values.push(enabled ? 1 : 0); }
    if (config    !== undefined) { updates.push('config = ?');     values.push(JSON.stringify(config)); }
    if (auto_block!== undefined) { updates.push('auto_block = ?'); values.push(auto_block ? 1 : 0); }
    values.push(id);
    db.prepare(`UPDATE firewalls SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    writeAudit(req.user?.id, 'FIREWALL_UPDATED', `Firewall #${id} updated`);
    res.json({ ok: true });
  });

  app.delete('/api/firewalls/:id', authenticate, requireAdmin, (req: any, res) => {
    db.prepare('DELETE FROM firewalls WHERE id = ?').run(req.params.id);
    writeAudit(req.user?.id, 'FIREWALL_DELETED', `Firewall #${req.params.id} deleted`);
    res.json({ ok: true });
  });

  app.post('/api/firewalls/:id/test', authenticate, requireAdmin, async (req: any, res) => {
    const fw = db.prepare('SELECT * FROM firewalls WHERE id = ?').get(req.params.id) as any;
    if (!fw) return res.status(404).json({ ok: false, error: 'Firewall not found' });
    let cfg: Record<string, string> = {};
    try { cfg = JSON.parse(fw.config || '{}'); } catch {}
    const result = await firewallTestConnection(fw.type as FirewallType, cfg);
    db.prepare('INSERT INTO action_logs (alert_id, integration, action, status, payload, error) VALUES (?, ?, ?, ?, ?, ?)')
      .run(null, `fw_${fw.name}`, 'test', result.ok ? 'success' : 'failed', 'Connection test', result.error || null);
    res.json(result);
  });

  app.post('/api/firewalls/:id/block', authenticate, async (req: any, res) => {
    const { ip, alert_id, reason } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip is required' });
    const fw = db.prepare('SELECT * FROM firewalls WHERE id = ?').get(req.params.id) as any;
    if (!fw) return res.status(404).json({ ok: false, error: 'Firewall not found' });
    let cfg: Record<string, string> = {};
    try { cfg = JSON.parse(fw.config || '{}'); } catch {}
    const result = await firewallBlockIp(fw.type as FirewallType, cfg, ip, 'block');
    db.prepare('INSERT INTO firewall_blocks (firewall_id, ip, alert_id, reason, status) VALUES (?, ?, ?, ?, ?)')
      .run(fw.id, ip, alert_id || null, reason || 'Manual block', result.ok ? 'blocked' : 'failed');
    db.prepare('INSERT INTO action_logs (alert_id, integration, action, status, payload, error) VALUES (?, ?, ?, ?, ?, ?)')
      .run(alert_id || null, `fw_${fw.name}`, 'block_ip', result.ok ? 'success' : 'failed', `Block ${ip}`, result.error || null);
    writeAudit(req.user?.id, 'FIREWALL_BLOCK', `${ip} blocked on ${fw.name}`);
    io.emit('action_logged', { firewall_id: fw.id });
    res.json(result);
  });

  app.post('/api/firewalls/:id/unblock', authenticate, requireAdmin, async (req: any, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip is required' });
    const fw = db.prepare('SELECT * FROM firewalls WHERE id = ?').get(req.params.id) as any;
    if (!fw) return res.status(404).json({ ok: false, error: 'Firewall not found' });
    let cfg: Record<string, string> = {};
    try { cfg = JSON.parse(fw.config || '{}'); } catch {}
    const result = await firewallBlockIp(fw.type as FirewallType, cfg, ip, 'unblock');
    db.prepare('UPDATE firewall_blocks SET status=?, unblocked_at=datetime("now") WHERE firewall_id=? AND ip=? AND status="blocked"')
      .run('unblocked', fw.id, ip);
    db.prepare('INSERT INTO action_logs (alert_id, integration, action, status, payload, error) VALUES (?, ?, ?, ?, ?, ?)')
      .run(null, `fw_${fw.name}`, 'unblock_ip', result.ok ? 'success' : 'failed', `Unblock ${ip}`, result.error || null);
    writeAudit(req.user?.id, 'FIREWALL_UNBLOCK', `${ip} unblocked on ${fw.name}`);
    io.emit('action_logged', { firewall_id: fw.id });
    res.json(result);
  });

  app.get('/api/firewalls/:id/blocks', authenticate, (_req, res) => {
    const blocks = db.prepare(
      "SELECT * FROM firewall_blocks WHERE firewall_id=? ORDER BY blocked_at DESC LIMIT 100"
    ).all(_req.params.id);
    res.json(blocks);
  });

  // ── Frontend serving ──────────────────────────────────────────────────────
  if (process.env.USE_VITE_MIDDLEWARE === 'true') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, allowedHosts: true as true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distIndex = path.join(__dirname, 'dist', 'index.html');
    if (!fs.existsSync(distIndex)) {
      throw new Error('dist/index.html not found. Run `npm run build` before starting the server.');
    }
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
  }

  const PORT = Number(process.env.PORT) || 3000;
  function listen(port: number) {
    httpServer.listen(port, '0.0.0.0', () => {
      console.log(`SOC Server running on http://localhost:${port}`);
    }).on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') { console.log(`Port ${port} is busy, trying ${port + 1}...`); listen(port + 1); }
      else { console.error('Server error:', err); }
    });
  }
  listen(PORT);

  // ── SLA monitoring background job (runs every 5 minutes) ─────────────────
  setInterval(() => {
    try {
      const stale = db.prepare(`
        SELECT id, severity, timestamp FROM alerts
        WHERE status IN ('NEW', 'ANALYZING')
        AND timestamp IS NOT NULL
      `).all() as Array<{ id: string; severity: number; timestamp: string }>;

      for (const alert of stale) {
        const label      = getSeverityLabel(alert.severity);
        const windowMin  = SLA_MINUTES[label] ?? 240;
        const ageMin     = Math.round((Date.now() - new Date(alert.timestamp).getTime()) / 60000);
        if (ageMin > windowMin * 2) {
          db.prepare("UPDATE alerts SET status='ESCALATED' WHERE id=?").run(alert.id);
          io.emit('alert_updated', { id: alert.id, status: 'ESCALATED' });
          writeAudit(null, 'SLA_ESCALATION', `Alert ${alert.id} auto-escalated (age ${ageMin}m > SLA ${windowMin * 2}m)`);
          console.log(`[SLA] Auto-escalated alert ${alert.id} (${label}, ${ageMin}min old)`);
        }
      }
    } catch (err: any) {
      console.warn('[SLA] Background job error:', err?.message);
    }
  }, 5 * 60_000);
}

process.on('uncaughtException',    (err)           => console.error('Uncaught Exception:', err));
process.on('unhandledRejection',   (reason, promise) => console.error('Unhandled Rejection:', promise, reason));

startServer();
