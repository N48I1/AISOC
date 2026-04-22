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
import {
  AGENT_METADATA,
  AGENT_PHASES,
  DEFAULT_AGENT_MODELS,
  OPENROUTER_FREE_MODELS,
  isAgentPhase,
  runOrchestration,
  runPhase,
  type ModelAssignments,
} from './agents.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'black-box-soc-secret-2026';

// --- Database Setup ---
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
  `);

  // Seed admin user if not exists
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)').run('admin', hashedPassword, 'admin@blackbox.com', 'ADMIN');
  }

  const seedAgentSetting = db.prepare('INSERT OR IGNORE INTO agent_settings (phase, model) VALUES (?, ?)');
  for (const phase of AGENT_PHASES) {
    seedAgentSetting.run(phase, DEFAULT_AGENT_MODELS[phase]);
  }
} catch (err) {
  console.error('Database initialization failed:', err);
  process.exit(1);
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

// --- Server Setup ---

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  app.use(cors());
  app.use(helmet({
    contentSecurityPolicy: false, // For development
  }));
  app.use(express.json());

  // Auth Middleware
  const authenticate = (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  // Admin-only middleware
  const requireAdmin = (req: any, res: any, next: any) => {
    if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
    next();
  };

  // Routes
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user: any = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  });

  app.get('/api/auth/me', authenticate, (req: any, res) => {
    res.json(req.user);
  });

  app.get('/api/alerts', authenticate, (req: any, res) => {
    const { status, severity } = req.query;
    const conditions: string[] = [];
    const params: any[] = [];

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
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

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const alerts = db.prepare(
      `SELECT * FROM alerts ${where} ORDER BY timestamp DESC LIMIT 100`
    ).all(...params);
    res.json(alerts);
  });

  app.patch('/api/alerts/:id', authenticate, (req, res) => {
    const { id } = req.params;
    const { status, ai_analysis, mitre_attack, remediation_steps, email_sent } = req.body;
    
    try {
      const updates: string[] = [];
      const values: any[] = [];
      
      if (status) { updates.push('status = ?'); values.push(status); }
      if (ai_analysis) { updates.push('ai_analysis = ?'); values.push(ai_analysis); }
      if (mitre_attack) { updates.push('mitre_attack = ?'); values.push(mitre_attack); }
      if (remediation_steps) { updates.push('remediation_steps = ?'); values.push(remediation_steps); }
      if (email_sent !== undefined) { updates.push('email_sent = ?'); values.push(email_sent); }
      
      if (updates.length > 0) {
        values.push(id);
        db.prepare(`UPDATE alerts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        io.emit('alert_updated', { id, ...req.body });
      }
      
      res.json({ status: 'ok' });
    } catch (err) {
      console.error('Update error:', err);
      res.status(500).json({ error: 'Failed to update alert' });
    }
  });

  // ── Stats ──────────────────────────────────────────────────────────────────
  app.get('/api/stats', authenticate, (req, res) => {
    const activeRow: any = db.prepare(
      "SELECT COUNT(*) as count FROM incidents WHERE status IN ('OPEN', 'IN_PROGRESS')"
    ).get();

    const mttrRow: any = db.prepare(`
      SELECT AVG((strftime('%s','now') - strftime('%s', timestamp))) as avg_seconds
      FROM alerts
      WHERE status IN ('TRIAGED', 'CLOSED') AND ai_analysis IS NOT NULL
    `).get();

    const totalRow: any    = db.prepare("SELECT COUNT(*) as count FROM alerts").get();
    const analyzedRow: any = db.prepare("SELECT COUNT(*) as count FROM alerts WHERE ai_analysis IS NOT NULL").get();

    const activeIncidents = activeRow?.count ?? 0;
    const avgSeconds      = mttrRow?.avg_seconds ?? 0;
    const mttrMinutes     = avgSeconds > 0 ? (avgSeconds / 60).toFixed(1) : '0.0';
    const total           = totalRow?.count ?? 0;
    const analyzed        = analyzedRow?.count ?? 0;
    const automationRate  = total > 0 ? Math.round((analyzed / total) * 100) : 0;

    res.json({ activeIncidents, mttr: `${mttrMinutes}m`, automationRate: `${automationRate}%`, totalAlerts: total, analyzedAlerts: analyzed });
  });

  // ── Incidents ───────────────────────────────────────────────────────────────
  app.get('/api/incidents', authenticate, (req, res) => {
    const incidents = db.prepare('SELECT * FROM incidents ORDER BY created_at DESC').all();
    const withAlerts = incidents.map((inc: any) => {
      const linkedAlerts = db.prepare(
        'SELECT alert_id FROM incident_alerts WHERE incident_id = ?'
      ).all(inc.id).map((r: any) => r.alert_id);
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
      db.prepare(`
        INSERT INTO incidents (id, title, severity, status, created_at, updated_at, assigned_to, analysis, action_plan)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, title, severity || 'MEDIUM', status || 'OPEN', now, now, assigned_to || null, analysis || null, action_plan || null);

      if (Array.isArray(alert_ids)) {
        const insertLink = db.prepare('INSERT OR IGNORE INTO incident_alerts (incident_id, alert_id) VALUES (?, ?)');
        for (const aid of alert_ids) insertLink.run(id, aid);
      }

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
    const values: any[]    = [new Date().toISOString()];

    if (status)      { updates.push('status = ?');      values.push(status); }
    if (analysis)    { updates.push('analysis = ?');    values.push(analysis); }
    if (action_plan) { updates.push('action_plan = ?'); values.push(action_plan); }
    if (assigned_to !== undefined) { updates.push('assigned_to = ?'); values.push(assigned_to); }

    try {
      values.push(id);
      db.prepare(`UPDATE incidents SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      io.emit('incident_updated', { id, ...req.body });
      res.json({ status: 'ok' });
    } catch (err: any) {
      console.error('Update incident error:', err);
      res.status(500).json({ error: 'Failed to update incident' });
    }
  });

  // ── Users ───────────────────────────────────────────────────────────────────
  app.get('/api/users', authenticate, requireAdmin, (req, res) => {
    const users = db.prepare('SELECT id, username, email, role FROM users').all();
    res.json(users);
  });

  app.post('/api/users', authenticate, requireAdmin, (req: any, res) => {
    const { username, password, email, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    try {
      const hashed  = bcrypt.hashSync(password, 10);
      const result: any = db.prepare(
        'INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)'
      ).run(username, hashed, email || null, role || 'ANALYST');
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
    const hashed = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.id);
    res.json({ message: 'Password updated.' });
  });

  app.post('/api/ingest', (req, res) => {
    // Wazuh Alert Ingestion Mock
    const alert = req.body;
    const id = alert.id || Math.random().toString(36).substr(2, 9);
    
    try {
      db.prepare(`
        INSERT INTO alerts (id, rule_id, description, severity, source_ip, dest_ip, user, hostname, agent_name, full_log)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        alert.rule?.id || 'unknown',
        alert.rule?.description || 'No description',
        alert.rule?.level || 0,
        alert.data?.srcip || null,
        alert.data?.dstip || null,
        alert.data?.dstuser || null,
        alert.agent?.name || 'unknown',
        alert.agent?.name || 'unknown',
        JSON.stringify(alert)
      );

      io.emit('new_alert', { id });
      res.json({ status: 'ok', id });
    } catch (err) {
      console.error('Ingestion error:', err);
      res.status(500).json({ error: 'Failed to ingest alert' });
    }
  });

  // ── AI model settings ────────────────────────────────────────────────────────
  app.get('/api/ai/models', authenticate, (req, res) => {
    const assignments = getAgentModelAssignments();
    res.json({
      agents: AGENT_PHASES.map((phase) => ({
        phase,
        ...AGENT_METADATA[phase],
      })),
      defaults: DEFAULT_AGENT_MODELS,
      assignments,
      availableModels: OPENROUTER_FREE_MODELS,
    });
  });

  app.patch('/api/ai/models/:phase', authenticate, requireAdmin, (req, res) => {
    const { phase } = req.params;
    const { model } = req.body || {};
    if (!isAgentPhase(phase)) return res.status(400).json({ error: 'Invalid phase' });
    if (typeof model !== 'string' || !OPENROUTER_FREE_MODELS.includes(model as any)) {
      return res.status(400).json({ error: 'Invalid model selection' });
    }

    db.prepare(`
      INSERT INTO agent_settings (phase, model) VALUES (?, ?)
      ON CONFLICT(phase) DO UPDATE SET model=excluded.model
    `).run(phase, model);

    res.json({ phase, model, assignments: getAgentModelAssignments() });
  });

  // ── AI: run a single agent phase ──────────────────────────────────────────
  app.post('/api/ai/agent', authenticate, async (req: any, res) => {
    const { phase, state } = req.body;
    if (!phase || !state) return res.status(400).json({ error: 'phase and state are required' });
    if (!isAgentPhase(phase)) return res.status(400).json({ error: 'Invalid phase' });
    try {
      const result = await runPhase(phase, state, { modelAssignments: getAgentModelAssignments() });
      res.json(result);
    } catch (err: any) {
      console.error('[AI Agent Error]', err?.message);
      res.status(500).json({ error: err?.message || 'Agent failed' });
    }
  });

  // ── AI: run full 7-agent swarm for an alert ────────────────────────────────
  app.post('/api/ai/orchestrate', authenticate, async (req: any, res) => {
    const { alertId } = req.body;
    if (!alertId) return res.status(400).json({ error: 'alertId is required' });
    try {
      const alert: any = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
      if (!alert) return res.status(404).json({ error: 'Alert not found' });
      const recentAlerts = db.prepare('SELECT * FROM alerts WHERE id != ? ORDER BY timestamp DESC LIMIT 50').all(alertId);

      db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('ANALYZING', alertId);
      io.emit('alert_updated', { id: alertId, status: 'ANALYZING' });

      const update = await runOrchestration(alert, recentAlerts, { modelAssignments: getAgentModelAssignments() });

      db.prepare(`
        UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=?
        WHERE id=?
      `).run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, alertId);

      db.prepare(
        'INSERT INTO agent_runs (alert_id, ai_analysis, mitre_attack, remediation_steps, status) VALUES (?, ?, ?, ?, ?)'
      ).run(alertId, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.status);

      io.emit('alert_updated', { id: alertId, ...update });
      res.json({ id: alertId, ...update });
    } catch (err: any) {
      console.error('[Orchestration Error]', err?.message);
      db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('NEW', alertId);
      io.emit('alert_updated', { id: alertId, status: 'NEW' });
      res.status(500).json({ error: err?.message || 'Orchestration failed' });
    }
  });

  // ── Agent run history ─────────────────────────────────────────────────────────
  app.get('/api/alerts/:alertId/runs', authenticate, (req, res) => {
    const { alertId } = req.params;
    const runs = db.prepare(
      'SELECT * FROM agent_runs WHERE alert_id = ? ORDER BY run_at DESC LIMIT 20'
    ).all(alertId);
    res.json(runs);
  });

  app.post('/api/alerts/:alertId/runs', authenticate, (req: any, res) => {
    const { alertId } = req.params;
    const { ai_analysis, mitre_attack, remediation_steps, status } = req.body || {};
    const result = db.prepare(
      'INSERT INTO agent_runs (alert_id, ai_analysis, mitre_attack, remediation_steps, status) VALUES (?, ?, ?, ?, ?)'
    ).run(alertId, ai_analysis || null, mitre_attack || null, remediation_steps || null, status || 'TRIAGED');
    res.json({ id: result.lastInsertRowid, run_at: new Date().toISOString() });
  });

  // Frontend serving
  // Default to static dist serving because tsx+Node18 cannot load @tailwindcss/vite reliably.
  // Set USE_VITE_MIDDLEWARE=true only when explicitly needed.
  if (process.env.USE_VITE_MIDDLEWARE === 'true') {
    const vite = await createViteServer({
      configFile: false,
      server: {
        middlewareMode: true,
        // Disable Vite HMR entirely for this app. Socket.io alert updates and
        // the Vite dev websocket can interfere and trigger full-page reloads.
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distIndex = path.join(__dirname, 'dist', 'index.html');
    if (!fs.existsSync(distIndex)) {
      throw new Error('dist/index.html not found. Run `npm run build` before starting the server.');
    }
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;

  function listen(port: number) {
    httpServer.listen(port, '0.0.0.0', () => {
      console.log(`SOC Server running on http://localhost:${port}`);
    }).on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} is busy, trying ${port + 1}...`);
        listen(port + 1);
      } else {
        console.error('Server error:', err);
      }
    });
  }

  listen(PORT);
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

startServer();
