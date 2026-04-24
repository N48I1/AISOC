import express from 'express';
import { createServer } from 'http';
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

    CREATE TABLE IF NOT EXISTS playbooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tactic TEXT NOT NULL,
      title TEXT NOT NULL,
      steps TEXT NOT NULL,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by) REFERENCES users(id)
    );

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

// --- Audit helper -----------------------------------------------------------
function writeAudit(userId: number | null, action: string, details: string) {
  try {
    const id = Math.random().toString(36).slice(2, 11);
    db.prepare('INSERT INTO audit_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)').run(id, userId, action, details);
  } catch (err: any) {
    console.warn('[Audit] write failed:', err?.message);
  }
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
  const app        = express();
  const httpServer = createServer(app);
  const io         = new Server(httpServer, { cors: { origin: '*' } });

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
    const activeRow: any  = db.prepare("SELECT COUNT(*) as count FROM incidents WHERE status IN ('OPEN', 'IN_PROGRESS')").get();
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
  app.get('/api/ai/models', authenticate, (_req, res) => {
    const assignments = getAgentModelAssignments();
    res.json({
      agents:          AGENT_PHASES.map(phase => ({ phase, ...AGENT_METADATA[phase] })),
      defaults:        DEFAULT_AGENT_MODELS,
      assignments,
      availableModels: OPENROUTER_FREE_MODELS,
      modelLabels:     OPENROUTER_MODEL_LABELS,
    });
  });

  app.patch('/api/ai/models/:phase', authenticate, requireAdmin, (req, res) => {
    const { phase } = req.params;
    const { model } = req.body || {};
    if (!isAgentPhase(phase)) return res.status(400).json({ error: 'Invalid phase' });
    if (typeof model !== 'string' || !OPENROUTER_FREE_MODELS.includes(model as any))
      return res.status(400).json({ error: 'Invalid model selection' });
    db.prepare(`INSERT INTO agent_settings (phase, model) VALUES (?, ?) ON CONFLICT(phase) DO UPDATE SET model=excluded.model`).run(phase, model);
    res.json({ phase, model, assignments: getAgentModelAssignments() });
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

  // ── AI: run full 7-agent swarm — rate limited to 10/15 min per IP ─────────
  const orchestrateLimit = rateLimit({
    windowMs:       15 * 60_000,
    max:            10,
    standardHeaders:true,
    legacyHeaders:  false,
    message:        { error: 'Too many orchestration requests. Please wait before running agents again.' },
  });

  app.post('/api/ai/orchestrate', authenticate, orchestrateLimit, async (req: any, res) => {
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

      const update = await runOrchestration(alert, recentAlerts, { modelAssignments: getAgentModelAssignments() });

      db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=? WHERE id=?`)
        .run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, alertId);

      db.prepare('INSERT INTO agent_runs (alert_id, ai_analysis, mitre_attack, remediation_steps, status) VALUES (?, ?, ?, ?, ?)')
        .run(alertId, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.status);

      // Send email if ticketing agent flagged it
      if (update.email_sent === 1) {
        try {
          const parsed   = JSON.parse(update.ai_analysis || '{}');
          const ticket   = parsed?.ticket || parsed?.phaseData?.ticket;
          const subject  = ticket?.title  || alert.description;
          const body     = ticket?.report_body || `Alert ${alertId}: ${alert.description}\nStatus: ${update.status}`;
          await sendIncidentAlert(subject, body);
        } catch {}
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

  // ── Frontend serving ──────────────────────────────────────────────────────
  if (process.env.USE_VITE_MIDDLEWARE === 'true') {
    const vite = await createViteServer({
      configFile: false,
      server: { middlewareMode: true, hmr: false },
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
