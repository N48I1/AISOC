import express from 'express';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
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
  type ModelAssignments,
} from './agents.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'black-box-soc-secret-2026';

// --- Email helper -----------------------------------------------------------
const smtpConfigured = !!(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
);

const mailer = smtpConfigured
  ? nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

async function sendIncidentAlert(subject: string, body: string) {
  if (!mailer || !process.env.ALERT_EMAIL_TO) return;
  try {
    await mailer.sendMail({
      from:    process.env.SMTP_USER,
      to:      process.env.ALERT_EMAIL_TO,
      subject: `[BBS AISOC] ${subject}`,
      text:    body,
    });
    console.log(`[Email] Sent: ${subject}`);
  } catch (err: any) {
    console.warn(`[Email] Failed to send: ${err?.message}`);
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

    -- Performance indexes
    CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp);
    CREATE INDEX IF NOT EXISTS idx_alerts_status    ON alerts(status);
  `);

  // Seed admin user if not exists
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)')
      .run('admin', hashedPassword, 'admin@blackbox.com', 'ADMIN');
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

  // Seed integration rows if not already present (INSERT OR IGNORE preserves user config)
  const seedIntegration = db.prepare(
    'INSERT OR IGNORE INTO integrations (name, enabled, config, auto_send_threshold) VALUES (?, ?, ?, ?)'
  );
  seedIntegration.run('email',    smtpConfigured ? 1 : 0,
    JSON.stringify({ to: process.env.ALERT_EMAIL_TO || '' }), 'HIGH');
  seedIntegration.run('glpi',     0,
    JSON.stringify({ url: process.env.GLPI_URL || '', app_token: process.env.GLPI_APP_TOKEN || '', user_token: process.env.GLPI_USER_TOKEN || '' }), 'CRITICAL');
  seedIntegration.run('telegram', 0,
    JSON.stringify({ bot_token: process.env.TELEGRAM_BOT_TOKEN || '', chat_id: process.env.TELEGRAM_CHAT_ID || '' }), 'HIGH');

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
        await sendIncidentAlert(subject, body);
        logAction.run(alertId, 'email', 'send_email', 'success', subject.slice(0, 120), null);
      } catch (err: any) {
        logAction.run(alertId, 'email', 'send_email', 'failed', ticket.title?.slice(0, 120) || '', err?.message?.slice(0, 200));
      }
    }

    if (intg.name === 'telegram' && cfg.bot_token && cfg.chat_id) {
      const text = `🚨 <b>[BBS AISOC]</b> ${ticket.priority} Alert\n\n<b>${ticket.title}</b>\n\n${(ticket.report_body || '').slice(0, 300)}`;
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

  // ── Incidents ─────────────────────────────────────────────────────────────
  app.get('/api/incidents', authenticate, (_req, res) => {
    const incidents  = db.prepare('SELECT * FROM incidents ORDER BY created_at DESC').all();
    const withAlerts = incidents.map((inc: any) => {
      const linkedAlerts = db.prepare('SELECT alert_id FROM incident_alerts WHERE incident_id = ?').all(inc.id).map((r: any) => r.alert_id);
      return { ...inc, alerts: linkedAlerts };
    });
    res.json(withAlerts);
  });

  app.post('/api/incidents', authenticate, (req: any, res) => {
    const { title, severity, status, assigned_to, analysis, action_plan, alert_ids } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const id  = 'INC-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    const now = new Date().toISOString();
    try {
      db.prepare(`INSERT INTO incidents (id, title, severity, status, created_at, updated_at, assigned_to, analysis, action_plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, title, severity || 'MEDIUM', status || 'OPEN', now, now, assigned_to || null, analysis || null, action_plan || null);
      if (Array.isArray(alert_ids)) {
        const insertLink = db.prepare('INSERT OR IGNORE INTO incident_alerts (incident_id, alert_id) VALUES (?, ?)');
        for (const aid of alert_ids) insertLink.run(id, aid);
      }
      writeAudit(req.user?.id, 'INCIDENT_CREATED', `Incident ${id}: ${title}`);
      io.emit('incident_created', { id, title, severity, status });
      res.json({ id, title, severity: severity || 'MEDIUM', status: status || 'OPEN', created_at: now, updated_at: now, alerts: alert_ids || [] });
    } catch (err: any) {
      console.error('Create incident error:', err);
      res.status(500).json({ error: 'Failed to create incident' });
    }
  });

  app.patch('/api/incidents/:id', authenticate, (req: any, res) => {
    const { id } = req.params;
    const { status, analysis, action_plan, assigned_to } = req.body;
    const updates: string[] = ['updated_at = ?'];
    const values: any[]     = [new Date().toISOString()];
    if (status)      { updates.push('status = ?');      values.push(status); }
    if (analysis)    { updates.push('analysis = ?');    values.push(analysis); }
    if (action_plan) { updates.push('action_plan = ?'); values.push(action_plan); }
    if (assigned_to !== undefined) { updates.push('assigned_to = ?'); values.push(assigned_to); }
    try {
      values.push(id);
      db.prepare(`UPDATE incidents SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      writeAudit(req.user?.id, 'INCIDENT_UPDATED', `Incident ${id} updated`);
      io.emit('incident_updated', { id, ...req.body });
      res.json({ status: 'ok' });
    } catch (err: any) {
      console.error('Update incident error:', err);
      res.status(500).json({ error: 'Failed to update incident' });
    }
  });

  // ── Users ─────────────────────────────────────────────────────────────────
  app.get('/api/users', authenticate, requireAdmin, (_req, res) => {
    res.json(db.prepare('SELECT id, username, email, role FROM users').all());
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

  app.get('/api/audit-logs', authenticate, requireAdmin, (_req, res) => {
    res.json(db.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 100').all());
  });

  // ── Ingest ────────────────────────────────────────────────────────────────
  app.post('/api/ingest', (req, res) => {
    const alert = req.body;
    const id    = alert.id || Math.random().toString(36).substr(2, 9);
    const ruleId   = alert.rule?.id   || 'unknown';
    const sourceIp = alert.data?.srcip || null;
    try {
      // Deduplication: same rule_id + source_ip within last 5 minutes
      const dup = db.prepare(
        `SELECT id FROM alerts WHERE rule_id = ? AND source_ip = ? AND timestamp >= datetime('now', '-5 minutes') LIMIT 1`
      ).get(ruleId, sourceIp);
      if (dup) {
        return res.json({ status: 'deduplicated', original_id: (dup as any).id });
      }

      db.prepare(`INSERT INTO alerts (id, rule_id, description, severity, source_ip, dest_ip, user, hostname, agent_name, full_log) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          id,
          ruleId,
          alert.rule?.description || 'No description',
          alert.rule?.level       || 0,
          sourceIp,
          alert.data?.dstip       || null,
          alert.data?.dstuser     || null,
          alert.agent?.name       || 'unknown',
          alert.agent?.name       || 'unknown',
          JSON.stringify(alert),
        );
      io.emit('new_alert', { id });
      res.json({ status: 'ok', id });
    } catch (err) {
      console.error('Ingestion error:', err);
      res.status(500).json({ error: 'Failed to ingest alert' });
    }
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

  // Working-memory trail (planner's scratchpad) for a given alert — debug view.
  app.get('/api/memory/working/:alertId', authenticate, (req: any, res) => {
    const rows = db.prepare(
      `SELECT step, trace_id, thought, action, result_summary, created_at
       FROM working_memory WHERE alert_id = ? ORDER BY created_at DESC, step DESC LIMIT 50`
    ).all(req.params.alertId);
    res.json(rows);
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

  // ── Integrations ─────────────────────────────────────────────────────────
  app.get('/api/integrations', authenticate, (_req, res) => {
    const rows = db.prepare('SELECT * FROM integrations').all() as any[];
    const result = rows.map(r => {
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
    const updates: string[] = ['updated_at = datetime("now")'];
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
        await sendIncidentAlert('Test from BBS AISOC', 'This is a test notification from the BBS AISOC platform. If you received this, email integration is working correctly.');
        logAction.run(null, 'email', 'test', 'success', 'Test email', null);
        return res.json({ ok: true });
      } catch (err: any) {
        logAction.run(null, 'email', 'test', 'failed', 'Test email', err?.message);
        return res.json({ ok: false, error: err?.message });
      }
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
