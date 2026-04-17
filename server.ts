import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import helmet from 'helmet';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'black-box-soc-secret-2026';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Database Setup ---
const db = new Database('soc.db');
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
`);

// Seed admin user if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)').run('admin', hashedPassword, 'admin@blackbox.com', 'ADMIN');
}

// --- AI Agents Logic ---
// Moved to frontend src/services/aiService.ts per system instructions.

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

  app.get('/api/alerts', authenticate, (req, res) => {
    const alerts = db.prepare('SELECT * FROM alerts ORDER BY timestamp DESC LIMIT 100').all();
    res.json(alerts);
  });

  app.patch('/api/alerts/:id', authenticate, (req, res) => {
    const { id } = req.params;
    const { status, ai_analysis, mitre_attack, remediation_steps } = req.body;
    
    try {
      const updates: string[] = [];
      const values: any[] = [];
      
      if (status) { updates.push('status = ?'); values.push(status); }
      if (ai_analysis) { updates.push('ai_analysis = ?'); values.push(ai_analysis); }
      if (mitre_attack) { updates.push('mitre_attack = ?'); values.push(mitre_attack); }
      if (remediation_steps) { updates.push('remediation_steps = ?'); values.push(remediation_steps); }
      
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

  // Vite Integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const PORT = 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`SOC Server running on http://localhost:${PORT}`);
  });
}

startServer();
