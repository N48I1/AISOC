import express from 'express';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { dbq as db, applySchema, assertDbReady, type DbClient } from './db/pool.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { rateLimit } from 'express-rate-limit';
import nodemailer from 'nodemailer';
import { buildIncidentEmail, buildTestEmail, type EmailContent } from './email-templates.js';
import { createGlpiTicket }   from './agents/shared/glpi.js';
import { sendTelegramMessage } from './agents/shared/telegram.js';
import { findLdapUser, ldapAuthenticate, type LdapConfig } from './agents/shared/ldap.js';
import { setLocalLLMBaseUrl, setLocalLLMFallback, setProviderDb, testProvider, clearClientCache } from './agents/shared/client.js';
import {
  ensureLlmProvidersTable,
  seedProvidersFromEnv,
  listProviders,
  getProvider,
  invalidateProviderCache,
  refreshProviderCache,
  publicShape,
  PROVIDER_KIND_DEFAULTS,
  PROVIDER_MODEL_CATALOG,
  type ProviderKind,
} from './agents/shared/llm-providers.js';
import {
  ensurePolicyRows,
  loadPasswordPolicy,
  loadLockoutPolicy,
  loadAdminIpAllowlist,
  loadAuditRetention,
  invalidatePolicyCache,
  validatePasswordAgainstPolicy,
  buildPermissionMatrix,
  PERMISSIONS,
  type PasswordPolicy,
  type LockoutPolicy,
} from './agents/shared/policy.js';
import { ipInAnyCidr } from './agents/shared/cidr.js';
import zlib from 'zlib';
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
import { reinforceFeedback, processAutoLearning } from './agents/memory/learning.js';
import { listReasoningForAlert } from './agents/memory/reasoning.js';
import { extractAssetValuesFromAlert } from './agents/memory/assets.js';
import { callStructuredLLM, newRunContext } from './agents/shared/llm.js';
import { z } from 'zod';

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
function extractEmail(value?: string): string {
  if (!value) return '';
  const m = value.match(/<([^>]+)>/);
  return (m?.[1] || value).trim();
}

function isGmailAddress(value?: string): boolean {
  return /@gmail\.com$/i.test(extractEmail(value));
}

function isMicrosoftMailAddress(value?: string): boolean {
  return /@(outlook|hotmail|live|msn)\.com$/i.test(extractEmail(value));
}

function normalizeEmailProvider(value?: string): string {
  const provider = String(value || '').trim().toLowerCase();
  return ['gmail', 'office365', 'custom'].includes(provider) ? provider : '';
}

function normalizeEmailAuthMethod(value?: string, provider?: string): string {
  const method = String(value || '').trim().toLowerCase();
  if (provider !== 'office365') return 'smtp_password';
  if (['smtp_password', 'microsoft_graph'].includes(method)) return method;
  return provider === 'office365' ? 'microsoft_graph' : 'smtp_password';
}

function normalizeEmailIntegrationConfig(rawCfg: Record<string, string> = {}): Record<string, string> {
  const cfg = rawCfg || {};
  const user = extractEmail(cfg.smtp_user || cfg.from || '');
  const hostFromCfg = (cfg.smtp_host || '').trim();
  const hostLower = hostFromCfg.toLowerCase();
  const configuredProvider = normalizeEmailProvider(cfg.smtp_provider);
  const inferredProvider = hostLower === 'smtp.gmail.com' || isGmailAddress(user)
    ? 'gmail'
    : hostLower === 'smtp.office365.com' || isMicrosoftMailAddress(user)
      ? 'office365'
      : '';
  const provider = configuredProvider || inferredProvider || 'custom';
  const gmailMode = provider === 'gmail';
  const office365Mode = provider === 'office365';
  const authMethod = normalizeEmailAuthMethod(cfg.auth_method, provider);
  const pass = gmailMode ? String(cfg.smtp_pass || '').replace(/\s+/g, '') : String(cfg.smtp_pass || '');
  return {
    ...cfg,
    smtp_provider: provider,
    auth_method: authMethod,
    smtp_user: user || String(cfg.smtp_user || ''),
    smtp_pass: pass,
    smtp_host: hostFromCfg || (gmailMode ? 'smtp.gmail.com' : office365Mode ? 'smtp.office365.com' : ''),
    smtp_port: String(cfg.smtp_port || '').trim() || (gmailMode || office365Mode ? '587' : ''),
    from: String(cfg.from || '').trim() || user,
    to: String(cfg.to || '').trim(),
    ms_tenant_id: String(cfg.ms_tenant_id || '').trim(),
    ms_client_id: String(cfg.ms_client_id || '').trim(),
    ms_client_secret: String(cfg.ms_client_secret || ''),
    ms_mailbox: extractEmail(cfg.ms_mailbox || user || cfg.from || ''),
  };
}

async function getMicrosoftGraphAccessToken(cfg: Record<string, string>): Promise<string> {
  const tenantId = String(cfg.ms_tenant_id || process.env.MS365_TENANT_ID || '').trim();
  const clientId = String(cfg.ms_client_id || process.env.MS365_CLIENT_ID || '').trim();
  const clientSecret = String(cfg.ms_client_secret || process.env.MS365_CLIENT_SECRET || '');

  const missing: string[] = [];
  if (!tenantId) missing.push('ms_tenant_id');
  if (!clientId) missing.push('ms_client_id');
  if (!clientSecret) missing.push('ms_client_secret');
  if (missing.length > 0) {
    throw new Error(`Microsoft 365 Graph integration missing required fields: ${missing.join(', ')}`);
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Microsoft token request failed: ${data.error_description || data.error || res.statusText}`);
  }
  return data.access_token;
}

async function sendMicrosoftGraphMail(subject: string, content: EmailContent | { html?: string; text: string }, cfg: Record<string, string>) {
  const mailbox = extractEmail(cfg.ms_mailbox || cfg.smtp_user || cfg.from || process.env.SMTP_USER || '');
  const to = String(cfg.to || process.env.ALERT_EMAIL_TO || '').trim();
  const missing: string[] = [];
  if (!mailbox) missing.push('ms_mailbox');
  if (!to) missing.push('to');
  if (missing.length > 0) {
    throw new Error(`Microsoft 365 Graph integration missing required fields: ${missing.join(', ')}`);
  }

  const accessToken = await getMicrosoftGraphAccessToken(cfg);
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: `[BBS AISOC] ${subject}`,
        body: content.html
          ? { contentType: 'HTML', content: content.html }
          : { contentType: 'Text', content: content.text },
        toRecipients: to.split(',').map(addr => addr.trim()).filter(Boolean).map(address => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`Microsoft Graph sendMail failed (${res.status}): ${errorBody || res.statusText}`);
  }
  console.log(`[Email:MicrosoftGraph] Sent: ${subject} → ${to}`);
}

async function sendIncidentAlert(subject: string, content: EmailContent | { html?: string; text: string }, emailCfg?: Record<string, string>) {
  const cfg = normalizeEmailIntegrationConfig(emailCfg || {});

  if (cfg.smtp_provider === 'office365' && cfg.auth_method === 'microsoft_graph') {
    await sendMicrosoftGraphMail(subject, content, cfg);
    return;
  }

  const from = cfg.from || process.env.SMTP_USER || '';
  const user = extractEmail(cfg.smtp_user || process.env.SMTP_USER || from);
  const to   = cfg.to || process.env.ALERT_EMAIL_TO;
  const hostFromCfg = (cfg.smtp_host || process.env.SMTP_HOST || '').trim();
  const hostLower = hostFromCfg.toLowerCase();
  const configuredProvider = normalizeEmailProvider(cfg.smtp_provider || process.env.SMTP_PROVIDER);
  const inferredProvider = hostLower === 'smtp.gmail.com' || isGmailAddress(user) || isGmailAddress(from)
    ? 'gmail'
    : hostLower === 'smtp.office365.com' || isMicrosoftMailAddress(user) || isMicrosoftMailAddress(from)
      ? 'office365'
      : '';
  const provider = configuredProvider || inferredProvider || 'custom';
  const gmailMode = provider === 'gmail';
  const office365Mode = provider === 'office365';
  const host = hostFromCfg || (gmailMode ? 'smtp.gmail.com' : office365Mode ? 'smtp.office365.com' : '');
  const portRaw = cfg.smtp_port || process.env.SMTP_PORT || (gmailMode || office365Mode ? '587' : '587');
  const port = Number(portRaw);
  const rawPass = cfg.smtp_pass || process.env.SMTP_PASS || '';
  const pass = gmailMode ? rawPass.replace(/\s+/g, '') : rawPass;

  const missing: string[] = [];
  if (!host) missing.push('smtp_host');
  if (!user) missing.push('smtp_user');
  if (!pass) missing.push('smtp_pass');
  if (!to)   missing.push('to');
  if (missing.length > 0) {
    throw new Error(`Email integration missing required fields: ${missing.join(', ')}`);
  }

  const resolvedPort = Number.isFinite(port) && port > 0 ? port : 587;
  const transport = nodemailer.createTransport({
    host,
    port: resolvedPort,
    secure: resolvedPort === 465,
    auth: { user, pass },
  });

  await transport.sendMail({
    from: extractEmail(from) || user,
    to,
    subject: `[BBS AISOC] ${subject}`,
    text:    content.text,
    ...(content.html ? { html: content.html } : {}),
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

// --- Response action normalisation -----------------------------------------
// Single chokepoint for turning LLM-emitted response actions into clean
// incident_actions rows. Returns null when the action would render as
// "BLOCK_IP → unknown" (target-required type with no extractable target) —
// those rows are dropped rather than seeded.
const AGENT_TYPE_TO_DB_ACTION: Record<string, string> = {
  BLOCK_IP:        'block_ip',
  ISOLATE_HOST:    'isolate_host',
  DISABLE_USER:    'disable_user',
  RESET_PASSWORD:  'reset_password',
  QUARANTINE_FILE: 'other',
  NOTIFY_TEAM:     'escalate',
};
const TARGET_REQUIRED_ACTION_TYPES = new Set(['block_ip', 'isolate_host', 'disable_user', 'reset_password', 'firewall_rule']);
const PLACEHOLDER_TARGET_RE = /^(unknown|n\/a|none|null|undefined|tbd|todo|target|ip|host|user|file|the target|<.*>)$/i;

function normaliseSeedAction(
  a: any,
  alertCtx: { source_ip?: string|null; dest_ip?: string|null; user?: string|null; agent_name?: string|null } | null,
  fallbackPriority: string,
): { action_type: string; target: string | null; priority: string; description: string } | null {
  if (!a) return null;

  let actionType = '';
  const rawType = typeof a === 'object' && a?.type ? String(a.type).toUpperCase() : '';
  if (rawType && AGENT_TYPE_TO_DB_ACTION[rawType]) {
    actionType = AGENT_TYPE_TO_DB_ACTION[rawType];
  } else if (rawType && /^(BLOCK_IP|ISOLATE_HOST|DISABLE_USER|RESET_PASSWORD|COLLECT_FORENSICS|FIREWALL_RULE|ESCALATE|OTHER)$/.test(rawType)) {
    actionType = rawType.toLowerCase();
  } else {
    const text = typeof a === 'string' ? a : (a?.action || a?.description || a?.title || a?.reason || '');
    const lower = String(text || '').toLowerCase();
    if      (/block.*ip|firewall block/.test(lower))             actionType = 'block_ip';
    else if (/isolate|quarantine|disconnect/.test(lower))        actionType = 'isolate_host';
    else if (/disable.*user|disable.*account/.test(lower))       actionType = 'disable_user';
    else if (/reset password|password reset/.test(lower))        actionType = 'reset_password';
    else if (/forensic|memory dump|capture|collect/.test(lower)) actionType = 'collect_forensics';
    else if (/firewall rule|acl|policy|sinkhole|waf rule/.test(lower)) actionType = 'firewall_rule';
    else if (/escalate|notify lead|notify team/.test(lower))     actionType = 'escalate';
    else                                                          actionType = 'other';
  }

  let target: string | null = null;
  const rawTargetCandidate = typeof a === 'object'
    ? (a.target || a.ip || a.user || a.host || a.dest || a.dest_ip || null)
    : null;
  const rawTarget = rawTargetCandidate ? String(rawTargetCandidate).trim() : '';
  if (rawTarget && !PLACEHOLDER_TARGET_RE.test(rawTarget)) {
    target = rawTarget;
  } else {
    const ip   = alertCtx?.source_ip?.trim() || null;
    const dest = alertCtx?.dest_ip?.trim()   || null;
    const user = alertCtx?.user?.trim()      || null;
    const host = alertCtx?.agent_name?.trim()|| null;
    if      (actionType === 'block_ip')                                            target = ip || dest;
    else if (actionType === 'isolate_host' || actionType === 'collect_forensics') target = host;
    else if (actionType === 'disable_user' || actionType === 'reset_password')    target = user;
    else if (actionType === 'firewall_rule')                                       target = ip || dest;
  }

  if (TARGET_REQUIRED_ACTION_TYPES.has(actionType) && !target) return null;

  const rawDesc = typeof a === 'string'
    ? a
    : (a?.reason || a?.description || a?.action || '').toString().trim();
  const description = rawDesc
    || (target ? `${actionType.replace(/_/g, ' ')} ${target}` : actionType.replace(/_/g, ' '));

  const rawPriority = typeof a === 'object' ? a?.priority : null;
  const priority = (typeof rawPriority === 'string' && /^(CRITICAL|HIGH|MEDIUM|LOW)$/i.test(rawPriority))
    ? rawPriority.toUpperCase()
    : (fallbackPriority || 'MEDIUM');

  return { action_type: actionType, target, priority, description: description.slice(0, 500) };
}

// --- Database Setup ---------------------------------------------------------
async function initDatabase() {
  try {
    await assertDbReady();
    await applySchema();

    await ensurePolicyRows(db);
    await ensureLlmProvidersTable(db);
    await seedProvidersFromEnv(db);
    setProviderDb(db);
    await refreshProviderCache(db);

  // Seed default users if not exists
  const seedUser = async (username: string, password: string, email: string, role: string, displayName: string, avatarColor: string) => {
    const exists = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (!exists) {
      const hashed = bcrypt.hashSync(password, 10);
      await db.prepare(
        `INSERT INTO users (username, password, email, role, display_name, avatar_color, password_changed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, now(), now())`
      ).run(username, hashed, email, role, displayName, avatarColor);
    }
  };
  // Seed passwords come from env (.env, git-ignored). If unset, fall back to a
  // random one-time secret so no usable default credential ever ships in source.
  const seedPassword = (envVar: string) =>
    process.env[envVar] || crypto.randomBytes(18).toString('base64url');
  // The bootstrap account is the platform owner — seed it as SUPER_ADMIN so a
  // fresh install always has one account that can manage admins.
  await seedUser('admin',     seedPassword('ADMIN_SEED_PASSWORD'),   'admin@aisoc.local',      'SUPER_ADMIN', 'Administrator', '#8b5cf6');

  // Seed default playbooks if none exist
  const playbookCount = (await db.prepare('SELECT COUNT(*) as c FROM playbooks').get() as any).c;
  if (playbookCount === 0) {
    const seedPlaybooks = [
      { tactic: 'CREDENTIAL_ACCESS', title: 'Brute Force Response', steps: '1. Block source IP at firewall\n2. Lock affected account temporarily\n3. Notify account owner\n4. Review auth logs for past 24h\n5. Enable MFA if not already active' },
      { tactic: 'COMMAND_AND_CONTROL', title: 'C2 Beacon Containment', steps: '1. Isolate affected host from network\n2. Block destination IP/domain at perimeter\n3. Capture memory image for forensics\n4. Scan all hosts for same beacon signature\n5. Rotate credentials on affected system' },
      { tactic: 'LATERAL_MOVEMENT', title: 'Lateral Movement Containment', steps: '1. Identify all systems accessed by compromised account\n2. Reset credentials for affected accounts\n3. Enable network segmentation between affected segments\n4. Review and revoke excessive privileges\n5. Deploy EDR hunting for lateral movement artifacts' },
      { tactic: 'EXFILTRATION', title: 'Data Exfiltration Response', steps: '1. Immediately block outbound traffic to destination\n2. Preserve network traffic logs\n3. Identify what data was transferred\n4. Notify DPO/legal team if PII involved\n5. Review DLP policy and tighten egress rules' },
      { tactic: 'PRIVILEGE_ESCALATION', title: 'Privilege Escalation Remediation', steps: '1. Revoke elevated privileges immediately\n2. Review sudoers/admin group membership\n3. Audit all commands run with elevated privileges\n4. Patch the exploited vulnerability if applicable\n5. Review and harden privilege management policies' },
      { tactic: 'EXECUTION', title: 'Malicious Execution Response', steps: '1. Kill malicious process immediately\n2. Quarantine affected file to sandbox\n3. Scan all hosts for same file hash\n4. Review process tree for parent process origin\n5. Reimage host if persistence is confirmed' },
    ];
    const ins = await db.prepare('INSERT INTO playbooks (tactic, title, steps) VALUES (?, ?, ?)');
    for (const pb of seedPlaybooks) await ins.run(pb.tactic, pb.title, pb.steps);
    console.log('[DB] Seeded 6 default playbooks');
  }



  // Seed integration rows if not already present (INSERT OR IGNORE preserves user config)
  const seedIntegration = await db.prepare(
    'INSERT INTO integrations (name, enabled, config, auto_send_threshold) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO NOTHING'
  );
  const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  const ms365GraphConfigured = !!(
    process.env.SMTP_PROVIDER === 'office365' &&
    process.env.MS365_TENANT_ID &&
    process.env.MS365_CLIENT_ID &&
    process.env.MS365_CLIENT_SECRET &&
    (process.env.MS365_MAILBOX || process.env.SMTP_USER)
  );
  await seedIntegration.run('email', smtpConfigured || ms365GraphConfigured ? 1 : 0,
    JSON.stringify({
      smtp_host: process.env.SMTP_HOST || '',
      smtp_port: process.env.SMTP_PORT || '587',
      smtp_provider: process.env.SMTP_PROVIDER || '',
      auth_method: process.env.SMTP_PROVIDER === 'office365' ? 'microsoft_graph' : 'smtp_password',
      smtp_user: process.env.SMTP_USER || '',
      smtp_pass: process.env.SMTP_PASS || '',
      ms_tenant_id: process.env.MS365_TENANT_ID || '',
      ms_client_id: process.env.MS365_CLIENT_ID || '',
      ms_client_secret: process.env.MS365_CLIENT_SECRET || '',
      ms_mailbox: process.env.MS365_MAILBOX || process.env.SMTP_USER || '',
      from:      process.env.SMTP_USER || '',
      to:        process.env.ALERT_EMAIL_TO || '',
    }), 'HIGH');
  await seedIntegration.run('glpi', 0,
    JSON.stringify({ url: process.env.GLPI_URL || '', app_token: process.env.GLPI_APP_TOKEN || '', user_token: process.env.GLPI_USER_TOKEN || '' }), 'CRITICAL');
  await seedIntegration.run('telegram', 0,
    JSON.stringify({ bot_token: process.env.TELEGRAM_BOT_TOKEN || '', chat_id: process.env.TELEGRAM_CHAT_ID || '' }), 'MEDIUM');
  await seedIntegration.run('slack', 0,
    JSON.stringify({ webhook_url: '' }), 'HIGH');

  // LDAP / AD authentication. Disabled by default. config keys:
  //   url, bind_dn, bind_password, base_dn, user_filter (use {{username}} placeholder),
  //   username_attr, default_role, allow_local_fallback
  await seedIntegration.run('ldap', 0,
    JSON.stringify({
      url:                  '',
      bind_dn:              '',
      bind_password:        '',
      base_dn:              '',
      user_filter:          '(sAMAccountName={{username}})',
      username_attr:        'sAMAccountName',
      email_attr:           'mail',
      display_name_attr:    'displayName',
      default_role:         'ANALYST',
      allow_local_fallback: 'true',
    }), 'NEVER');

  // Wazuh ingest filter config — INSERT OR IGNORE preserves user changes across restarts
  await seedIntegration.run('wazuh', 1,
    JSON.stringify({
      min_severity:         '7',
      dedup_window_minutes: '5',
      max_alerts_per_min:   '60',
      time_window_start:    '',
      time_window_end:      '',
      auto_orchestrate:     'true',
    }), 'NEVER');

  // Seed local LLM defaults
  const seedLocalCfg = await db.prepare('INSERT INTO local_llm_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING');
  await seedLocalCfg.run('url',     'http://localhost:11434');
  await seedLocalCfg.run('enabled', '0');
  await seedLocalCfg.run('fallback_model', '');   // e.g. 'llama3.1:8b' — used when all external providers fail
  // Apply stored URL + fallback config to the LLM client module
  const storedLocalUrl = (await db.prepare("SELECT value FROM local_llm_config WHERE key='url'").get() as any)?.value;
  if (storedLocalUrl) setLocalLLMBaseUrl(storedLocalUrl);
  const storedLocalEnabled  = (await db.prepare("SELECT value FROM local_llm_config WHERE key='enabled'").get() as any)?.value === '1';
  const storedFallbackModel = (await db.prepare("SELECT value FROM local_llm_config WHERE key='fallback_model'").get() as any)?.value || '';
  setLocalLLMFallback(storedLocalEnabled, storedFallbackModel);

  // Seed model assignments only if a phase has no entry yet — preserves user overrides across restarts
  const seedAgentSetting = await db.prepare(
    'INSERT INTO agent_settings (phase, model) VALUES (?, ?) ON CONFLICT (phase) DO NOTHING'
  );
  for (const phase of AGENT_PHASES) {
    await seedAgentSetting.run(phase, DEFAULT_AGENT_MODELS[phase]);
  }

  } catch (err) {
    console.error('Database initialization failed:', err);
    process.exit(1);
  }
}

// --- JSON helpers -----------------------------------------------------------
function safeParseJsonArray(s: any): any[] {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

// --- Audit helper -----------------------------------------------------------
// Fire-and-forget: callers do not await. Errors are swallowed internally so a
// failed audit write can never reject into an un-awaited caller.
async function writeAudit(userId: number | null, action: string, details: string) {
  try {
    const id = Math.random().toString(36).slice(2, 11);
    await db.prepare('INSERT INTO audit_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)').run(id, userId, action, details);
  } catch (err: any) {
    console.warn('[Audit] write failed:', err?.message);
  }
}

// --- Feedback-loop IOC extraction -------------------------------------------
// Collect every IOC value associated with a stored alert so analyst feedback
// (confirm-FP / escalate / reclassify) can be propagated into ioc_memory.
//
// Sources, in priority order:
//   1. The cached triage_data JSON (best — already includes LLM-extracted IOCs)
//   2. The alert row's raw fields (source_ip, dest_ip, agent_name, hostname, user)
//   3. extractAssetValuesFromAlert as a last-resort fallback
async function extractIocsForFeedback(alertId: string): Promise<string[]> {
  try {
    const row: any = await db.prepare(
      'SELECT id, source_ip, dest_ip, agent_name, hostname, "user", triage_data, full_log FROM alerts WHERE id = ?'
    ).get(alertId);
    if (!row) return [];

    const set = new Set<string>();
    const add = (v: any) => {
      if (v == null) return;
      const s = String(v).trim();
      if (s && s.toLowerCase() !== 'unknown' && s.toLowerCase() !== 'n/a') set.add(s);
    };

    add(row.source_ip);
    add(row.dest_ip);
    add(row.agent_name);
    add(row.hostname);
    add(row.user);

    if (row.triage_data) {
      try {
        const triage = JSON.parse(row.triage_data);
        const iocs = triage?.iocs || {};
        for (const key of ['ips', 'users', 'hosts', 'hashes', 'files', 'domains', 'urls']) {
          const arr = iocs[key];
          if (Array.isArray(arr)) for (const v of arr) add(v);
        }
      } catch { /* non-JSON triage_data — skip */ }
    }

    // Last-resort fallback: synthesize an alert-shaped object for the helper
    if (set.size === 0) {
      try {
        const synth: any = {
          source_ip: row.source_ip, dest_ip: row.dest_ip,
          agent_name: row.agent_name, hostname: row.hostname, user: row.user,
        };
        if (row.full_log) {
          try { synth.data = JSON.parse(row.full_log).data; } catch {}
        }
        for (const v of extractAssetValuesFromAlert(synth)) add(v);
      } catch {}
    }

    return Array.from(set);
  } catch (err: any) {
    console.warn(`[Feedback] IOC extract failed for ${alertId}:`, err?.message);
    return [];
  }
}

// Apply analyst feedback to the memory layer. Verdict is what the analyst
// actually decided ('FALSE_POSITIVE' or 'TRUE_POSITIVE'). Triggers
// await processAutoLearning() so an IOC that just crossed the FP threshold can be
// auto-registered immediately rather than waiting for the next cron tick.
async function applyFeedbackToMemory(
  alertId: string,
  verdict: 'FALSE_POSITIVE' | 'TRUE_POSITIVE',
  context: string,
): Promise<{ iocs: string[]; auto_registered: number }> {
  const iocs = await extractIocsForFeedback(alertId);
  if (iocs.length === 0) {
    console.log(`[Feedback] ${verdict} for ${alertId} — no IOCs to reinforce (${context})`);
    return { iocs: [], auto_registered: 0 };
  }
  try {
    await reinforceFeedback(iocs, verdict);
    const newlyRegistered = await processAutoLearning();
    console.log(`[Feedback] ${verdict} for ${alertId}: reinforced ${iocs.length} IOC(s); auto-registered ${newlyRegistered.length} (${context})`);
    return { iocs, auto_registered: newlyRegistered.length };
  } catch (err: any) {
    console.warn(`[Feedback] reinforce failed for ${alertId}:`, err?.message);
    return { iocs, auto_registered: 0 };
  }
}

// Read the saved LDAP config from the integrations table. Returns null if the
// row is missing, disabled, or the config blob is empty/unparseable.
async function readLdapConfig(): Promise<(LdapConfig & { allow_local_fallback: boolean; default_role: string }) | null> {
  const row: any = await db.prepare("SELECT enabled, config FROM integrations WHERE name='ldap'").get();
  if (!row || !row.enabled) return null;
  let cfg: any = {};
  try { cfg = JSON.parse(row.config || '{}'); } catch { return null; }
  if (!cfg.url || !cfg.bind_dn || !cfg.base_dn) return null;
  return {
    url:                  String(cfg.url),
    bind_dn:              String(cfg.bind_dn),
    bind_password:        String(cfg.bind_password || ''),
    base_dn:              String(cfg.base_dn),
    user_filter:          String(cfg.user_filter || '(sAMAccountName={{username}})'),
    username_attr:        String(cfg.username_attr || 'sAMAccountName'),
    email_attr:           cfg.email_attr        ? String(cfg.email_attr)        : 'mail',
    display_name_attr:    cfg.display_name_attr ? String(cfg.display_name_attr) : 'displayName',
    allow_local_fallback: String(cfg.allow_local_fallback ?? 'true') === 'true',
    default_role:         String(cfg.default_role || 'ANALYST').toUpperCase(),
  };
}

// --- Integration dispatch helper -------------------------------------------
const PRIORITY_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, NEVER: 0 };

async function dispatchActions(params: {
  alertId: string;
  ticket:  any;
  db:      DbClient;
  io:      Server;
}) {
  const { alertId, ticket, db: database, io: socketIo } = params;
  if (!ticket?.priority) return;

  // Fetch alert context for richer notifications
  const alertRow = await database.prepare(
    'SELECT source_ip, dest_ip, agent_name, mitre_attack FROM alerts WHERE id = ?'
  ).get(alertId) as any;
  const sourceIp  = alertRow?.source_ip  || 'n/a';
  const destIp    = alertRow?.dest_ip    || 'n/a';
  const agentName = alertRow?.agent_name || 'unknown';
  let mitreTags: string[] = [];
  try { const m = JSON.parse(alertRow?.mitre_attack || '[]'); if (Array.isArray(m)) mitreTags = m; } catch {}

  const integrations = await database.prepare("SELECT * FROM integrations WHERE enabled = 1").all() as any[];
  const logAction = await database.prepare(
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
        const email = buildIncidentEmail({ alertId, ticket, sourceIp, destIp, agentName, mitreTags });
        await sendIncidentAlert(email.subject, { html: email.html, text: email.text }, cfg);
        await logAction.run(alertId, 'email', 'send_email', 'success', email.subject.slice(0, 120), null);
      } catch (err: any) {
        await logAction.run(alertId, 'email', 'send_email', 'failed', ticket.title?.slice(0, 120) || '', err?.message?.slice(0, 200));
      }
    }

    if (intg.name === 'slack' && cfg.webhook_url) {
      const text = `🚨 *[BBS AISOC]* ${ticket.priority} Alert\n\n*${ticket.title}*\n\n${(ticket.report_body || '').slice(0, 300)}`;
      const result = await sendSlackWebhook(cfg.webhook_url, text);
      await logAction.run(alertId, 'slack', 'send_message', result.ok ? 'success' : 'failed',
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
      await logAction.run(alertId, 'telegram', 'send_message', result.ok ? 'success' : 'failed',
        ticket.title?.slice(0, 120) || '', result.error || null);
    }

    if (intg.name === 'glpi' && cfg.url && cfg.app_token && cfg.user_token) {
      const urgencyMap: Record<string, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2 };
      const result = await createGlpiTicket(
        { url: cfg.url, appToken: cfg.app_token, userToken: cfg.user_token },
        { title: ticket.title || `Alert ${alertId}`, content: ticket.report_body || '', urgency: urgencyMap[ticket.priority] || 3 }
      );
      await logAction.run(alertId, 'glpi', 'create_ticket', result.ok ? 'success' : 'failed',
        result.ok ? `Ticket #${result.ticketId}` : ticket.title?.slice(0, 120) || '', result.error || null);
    }
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

const getAgentModelAssignments = async (): Promise<ModelAssignments> => {
  const rows: Array<{ phase: string; model: string }> = await db
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
// Password complexity is driven by the `password_policy` integrations row
// (NIST 800-63B / ISO 27001 A.5.17). await validatePassword() reads the live policy
// every call (the helper caches for 30s) so admin changes take effect quickly.
async function validatePassword(pw: string): Promise<{ ok: boolean; errors: string[] }> {
  return validatePasswordAgainstPolicy(pw, await loadPasswordPolicy(db));
}

async function recordPasswordChange(userId: number, newHash: string): Promise<void> {
  try {
    await db.prepare('INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)').run(userId, newHash);
    const policy = await loadPasswordPolicy(db);
    const keep = Math.max(1, policy.history_depth || 10);
    // Trim — keep the most recent `keep` rows for this user
    await db.prepare(`
      DELETE FROM password_history
      WHERE user_id = ?
        AND id NOT IN (
          SELECT id FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
        )
    `).run(userId, userId, keep);
  } catch (err: any) {
    console.warn('[password_history] insert failed:', err?.message);
  }
}

async function passwordMatchesHistory(userId: number, candidate: string): Promise<boolean> {
  const policy = await loadPasswordPolicy(db);
  const depth = Math.max(0, policy.history_depth || 0);
  if (depth === 0) return false;
  const rows = await db.prepare(
    'SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, depth) as Array<{ password_hash: string }>;
  return rows.some(r => bcrypt.compareSync(candidate, r.password_hash));
}

// ── Role hierarchy for RBAC (higher number = more privilege) ─────────────────
const ROLE_LEVEL: Record<string, number> = {
  ANALYST:       0,
  TIER1:         1,
  TIER2:         2,
  INCIDENT_LEAD: 3,
  ADMIN:         4,
  SUPER_ADMIN:   5,
};

// Privileged-account administration rule (NIST 800-53 AC-6, ISO 27001 A.8.2):
// an actor may only administer accounts *strictly below* their own role level,
// and may only assign roles strictly below their own. This stops admins from
// neutralizing each other (delete/disable/demote/reset a peer admin) and means
// only a SUPER_ADMIN can manage ADMIN accounts or mint new admins.
function canAdminister(actorRole: string, targetRole: string): boolean {
  return (ROLE_LEVEL[actorRole] ?? -1) > (ROLE_LEVEL[targetRole] ?? 99);
}
// Role assignment: you may assign any role strictly below your own level. A
// SUPER_ADMIN may additionally assign SUPER_ADMIN (so the owner tier can have
// more than one holder and never gets locked out / single-point-of-failure).
function canAssignRole(actorRole: string, newRole: string): boolean {
  const a = ROLE_LEVEL[actorRole] ?? -1;
  const n = ROLE_LEVEL[newRole] ?? 99;
  if (a >= ROLE_LEVEL.SUPER_ADMIN) return n <= ROLE_LEVEL.SUPER_ADMIN;
  return a > n;
}

// Lockout thresholds come from the `lockout_policy` integrations row
// (ISO 27001 A.8.5, NIST 800-53 AC-7). Hardcoded fallbacks kick in only if
// the row is missing.
async function getLockoutPolicy(): Promise<LockoutPolicy> { return await loadLockoutPolicy(db); }

async function startServer() {
  const app = express();

  const certPath = process.env.TLS_CERT || path.join(__dirname, '..', 'certs', 'cert.pem');
  const keyPath  = process.env.TLS_KEY  || path.join(__dirname, '..', 'certs', 'key.pem');
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

  // Resolve a user's effective role — base role OR (if not expired) temp role,
  // whichever has the higher privilege level. Lets us implement JIT elevation
  // (NIST 800-53 AC-6(2), ISO 27001 A.8.2) without a separate role check.
  function effectiveRole(u: any): string {
    if (!u) return 'ANALYST';
    const base = u.role || 'ANALYST';
    if (!u.temp_role || !u.temp_role_expires_at) return base;
    if (new Date(u.temp_role_expires_at).getTime() < Date.now()) return base;
    const bl = ROLE_LEVEL[base]      ?? -1;
    const tl = ROLE_LEVEL[u.temp_role] ?? -1;
    return tl > bl ? u.temp_role : base;
  }

  // Auth Middleware — verifies JWT signature, checks the embedded epoch
  // against the user's row (mismatch = revoked / forced logout), and rejects
  // disabled accounts even mid-session.
  const authenticate = async (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      const row: any = await db.prepare(
        'SELECT id, username, role, email, status, jwt_epoch, temp_role, temp_role_expires_at FROM users WHERE id = ?'
      ).get(decoded.id);
      if (!row) return res.status(401).json({ error: 'User no longer exists' });
      if (row.status === 'disabled') return res.status(403).json({ error: 'Account disabled' });
      const tokenEpoch = typeof decoded.epoch === 'number' ? decoded.epoch : 0;
      const userEpoch  = row.jwt_epoch || 0;
      if (tokenEpoch !== userEpoch) return res.status(401).json({ error: 'Session revoked' });
      req.user = { id: row.id, username: row.username, role: effectiveRole(row), email: row.email, base_role: row.role };
      next();
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  const requireAdmin = async (req: any, res: any, next: any) => {
    // Level-based so SUPER_ADMIN (5) inherits every ADMIN (4) endpoint.
    if ((ROLE_LEVEL[req.user?.role] ?? -1) < ROLE_LEVEL.ADMIN) return res.status(403).json({ error: 'Admin only' });
    // Admin IP allowlist (ISO 27001 A.5.15, NIST 800-53 AC-3 / SC-7). When
    // enabled, only requests sourced from a CIDR in the allowlist may invoke
    // admin endpoints. Blocked requests are audited so a denial-of-service
    // misconfiguration shows up in the log.
    const allow = await loadAdminIpAllowlist(db);
    if (allow.enabled && allow.cidrs.length > 0) {
      const ip = (req.ip || req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
      if (!ipInAnyCidr(ip, allow.cidrs)) {
        writeAudit(req.user?.id ?? null, 'ADMIN_IP_BLOCKED', `Admin call denied from ${ip} (${req.method} ${req.path})`);
        return res.status(403).json({ error: 'Admin access not allowed from this network' });
      }
    }
    next();
  };

  // Role-based guard: pass minimum role required
  const requireRole = (...allowedRoles: string[]) => (req: any, res: any, next: any) => {
    const userLevel = ROLE_LEVEL[req.user?.role] ?? -1;
    const minLevel  = Math.min(...allowedRoles.map(r => ROLE_LEVEL[r] ?? 99));
    if (userLevel < minLevel) return res.status(403).json({ error: `Requires role: ${allowedRoles.join(' or ')}` });
    next();
  };

  // Step-up auth: destructive / sensitive ops require a fresh password re-auth.
  // The frontend POSTs to /api/auth/verify-password to get a short-lived JWT
  // (scope='step_up', 5 min, bound to the user.id), then includes it in
  // X-Step-Up-Token on the protected call. Aligns with NIST 800-53 IA-11
  // (Re-authentication) and ISO 27001 A.5.15 / A.8.2 privileged access controls.
  const STEP_UP_TTL_SECONDS = 5 * 60;
  const requireStepUp = async (req: any, res: any, next: any) => {
    const raw = req.headers['x-step-up-token'];
    if (!raw || typeof raw !== 'string') {
      return res.status(401).json({ error: 'Re-authentication required', step_up_required: true });
    }
    try {
      const decoded: any = jwt.verify(raw, JWT_SECRET);
      if (decoded.scope !== 'step_up' || decoded.sub !== req.user?.id) {
        return res.status(401).json({ error: 'Invalid step-up token', step_up_required: true });
      }
      next();
    } catch {
      return res.status(401).json({ error: 'Step-up token expired — please confirm your password again', step_up_required: true });
    }
  };

  // ── Auth ──────────────────────────────────────────────────────────────────
  const userProfileFields = 'id, username, email, role, display_name, avatar_color, timezone, notify_email, notify_critical, notify_assignments, bio, last_login, password_changed_at, created_at, must_change_password, status, access_expires_at, temp_role, temp_role_expires_at';

  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(401).json({ error: 'Invalid credentials' });

    const issueToken = async (u: any) => {
      // Embed jwt_epoch — bumping the column kills every outstanding token
      // for this user (NIST 800-53 AC-12, ISO 27001 A.5.16).
      const fresh: any = await db.prepare('SELECT jwt_epoch FROM users WHERE id = ?').get(u.id);
      const epoch = fresh?.jwt_epoch ?? 0;
      const token = jwt.sign({ id: u.id, username: u.username, role: u.role, email: u.email, epoch }, JWT_SECRET);
      const profile = await db.prepare(`SELECT ${userProfileFields} FROM users WHERE id = ?`).get(u.id);
      return { token, user: profile };
    };

    // ── LDAP / AD path (tried first if enabled) ──────────────────────────────
    const ldapCfg = await readLdapConfig();
    if (ldapCfg) {
      const r = await ldapAuthenticate(ldapCfg, username, password);
      if (r.ok && r.user) {
        // Find or auto-provision the local mirror.
        let local: any = await db.prepare('SELECT * FROM users WHERE username = ?').get(r.user.username);
        if (!local) {
          await db.prepare(
            "INSERT INTO users (username, password, email, role, display_name, auth_source) VALUES (?, ?, ?, ?, ?, 'ldap')"
          ).run(
            r.user.username,
            bcrypt.hashSync(Math.random().toString(36) + Date.now(), 4),   // unusable local password
            r.user.email || null,
            ldapCfg.default_role,
            r.user.display_name || r.user.username,
          );
          local = await db.prepare('SELECT * FROM users WHERE username = ?').get(r.user.username);
          writeAudit(local.id, 'USER_CREATED', `Auto-provisioned from LDAP (${r.user.dn})`);
        }
        if (local.status === 'disabled') {
          writeAudit(local.id, 'LOGIN_FAILED', `Disabled account login attempt (LDAP): ${username}`);
          return res.status(403).json({ error: 'Account is disabled. Contact an administrator.' });
        }
        await db.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login = now() WHERE id = ?").run(local.id);
        writeAudit(local.id, 'LOGIN', `LDAP login (${r.user.dn})`);
        return res.json(await issueToken(local));
      }
      // If LDAP rejected the user *and* local fallback is disabled, stop here.
      if (!ldapCfg.allow_local_fallback) {
        return res.status(401).json({ error: r.error || 'LDAP authentication failed' });
      }
      // Otherwise fall through to local auth below.
    }

    // ── Local password path ──────────────────────────────────────────────────
    const user: any = await db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      writeAudit(null, 'LOGIN_FAILED', `Unknown username: ${username} from ${req.ip || 'unknown'}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // LDAP-sourced users cannot use local password unless an admin set one explicitly.
    if (user.auth_source === 'ldap' && !ldapCfg) {
      writeAudit(user.id, 'LOGIN_FAILED', `LDAP user attempted local login while LDAP disabled: ${username}`);
      return res.status(401).json({ error: 'LDAP is disabled — this account cannot log in locally.' });
    }

    if (user.status === 'disabled') {
      writeAudit(user.id, 'LOGIN_FAILED', `Disabled account login attempt: ${username}`);
      return res.status(403).json({ error: 'Account is disabled. Contact an administrator.' });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remaining = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
      writeAudit(user.id, 'LOGIN_FAILED', `Locked account login attempt: ${username} (${remaining} min remaining)`);
      return res.status(423).json({ error: `Account locked. Try again in ${remaining} min.`, locked: true });
    }

    if (!bcrypt.compareSync(password, user.password)) {
      const attempts = (user.failed_logins || 0) + 1;
      const lockout = await getLockoutPolicy();
      writeAudit(user.id, 'LOGIN_FAILED', `Bad password for ${username} from ${req.ip || 'unknown'} (attempt ${attempts}/${lockout.max_failed_attempts})`);
      if (attempts >= lockout.max_failed_attempts) {
        const lockUntil = new Date(Date.now() + lockout.lockout_minutes * 60000).toISOString();
        await db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(attempts, lockUntil, user.id);
        writeAudit(user.id, 'ACCOUNT_LOCKED', `Account locked after ${attempts} failed attempts`);
        return res.status(423).json({ error: `Too many failed attempts. Account locked for ${lockout.lockout_minutes} min.`, locked: true });
      }
      await db.prepare('UPDATE users SET failed_logins = ? WHERE id = ?').run(attempts, user.id);
      const captchaRequired = attempts >= lockout.captcha_after;
      return res.status(401).json({
        error: 'Invalid credentials',
        attemptsRemaining: lockout.max_failed_attempts - attempts,
        captchaRequired,
      });
    }

    await db.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login = now() WHERE id = ?").run(user.id);
    writeAudit(user.id, 'LOGIN', `User ${username} logged in`);
    res.json(await issueToken(user));
  });

  app.get('/api/auth/me', authenticate, async (req: any, res) => {
    const profile = await db.prepare(`SELECT ${userProfileFields} FROM users WHERE id = ?`).get(req.user.id);
    if (!profile) return res.status(404).json({ error: 'User not found' });
    res.json(profile);
  });

  // Step-up re-authentication. Confirms the caller's password and returns a
  // short-lived (5 min) token to be sent as X-Step-Up-Token on destructive ops.
  app.post('/api/auth/verify-password', authenticate, async (req: any, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password required' });
    const user: any = await db.prepare('SELECT id, username, password, auth_source FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.auth_source === 'ldap') {
      // LDAP-sourced accounts don't have a usable local password — fall back to LDAP.
      const ldapCfg = await readLdapConfig();
      if (!ldapCfg) {
        writeAudit(user.id, 'STEP_UP_FAILED', `LDAP user verify-password attempt but LDAP disabled`);
        return res.status(400).json({ error: 'Re-auth requires LDAP, which is disabled' });
      }
      // Run an LDAP bind to confirm the password
      // (the caller will await; if you wanted to keep this sync, swap for a Promise wrapper)
      return ldapAuthenticate(ldapCfg, user.username, password).then((r) => {
        if (!r.ok) {
          writeAudit(user.id, 'STEP_UP_FAILED', `Bad LDAP password during step-up`);
          return res.status(401).json({ error: 'Invalid password' });
        }
        const token = jwt.sign({ sub: user.id, scope: 'step_up' }, JWT_SECRET, { expiresIn: STEP_UP_TTL_SECONDS });
        writeAudit(user.id, 'STEP_UP_VERIFIED', `Re-authenticated for sensitive operation (LDAP)`);
        res.json({ token, expires_in: STEP_UP_TTL_SECONDS });
      });
    }
    if (!bcrypt.compareSync(password, user.password)) {
      writeAudit(user.id, 'STEP_UP_FAILED', `Bad password during step-up`);
      return res.status(401).json({ error: 'Invalid password' });
    }
    const token = jwt.sign({ sub: user.id, scope: 'step_up' }, JWT_SECRET, { expiresIn: STEP_UP_TTL_SECONDS });
    writeAudit(user.id, 'STEP_UP_VERIFIED', `Re-authenticated for sensitive operation`);
    res.json({ token, expires_in: STEP_UP_TTL_SECONDS });
  });

  // ── Alerts ────────────────────────────────────────────────────────────────
  app.get('/api/alerts', authenticate, async (req: any, res) => {
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
    const alerts = await db.prepare(`SELECT * FROM alerts ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    const total  = (await db.prepare(`SELECT COUNT(*) as c FROM alerts ${where}`).get(...params) as any).c;

    res.json({ alerts, total, page, pageSize });
  });

  app.patch('/api/alerts/:id', authenticate, async (req: any, res) => {
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
        await db.prepare(`UPDATE alerts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        if (status) writeAudit(req.user?.id, 'ALERT_STATUS_CHANGE', `Alert ${id} → ${status}`);
        io.emit('alert_updated', { id, ...req.body });
      }
      res.json({ status: 'ok' });
    } catch (err) {
      console.error('Update error:', err);
      res.status(500).json({ error: 'Failed to update alert' });
    }
  });

  // ── Ingest health ─────────────────────────────────────────────────────────
  // We don't poll Wazuh — Wazuh POSTs to us. Liveness signal priority:
  //   1. last_heartbeat_at (forwarder pings POST /api/heartbeat every 60s — definitive)
  //   2. last_used_at      (any /api/ingest call — proves the forwarder ran, may be sparse)
  //   3. last alert.timestamp (last write to the alerts table — fallback)
  app.get('/api/ingest/status', authenticate, async (_req, res) => {
    const keyRow: any = await db.prepare(
      "SELECT MAX(last_used_at) AS last_used_at, MAX(last_heartbeat_at) AS last_heartbeat_at FROM api_keys WHERE revoked=0"
    ).get();
    const alertRow: any = await db.prepare(
      "SELECT MAX(timestamp) AS last_ts FROM alerts"
    ).get();
    const alerts5m: any = await db.prepare(
      "SELECT COUNT(*) AS c FROM alerts WHERE timestamp >= now() - interval '5 minutes'"
    ).get();
    const alerts60m: any = await db.prepare(
      "SELECT COUNT(*) AS c FROM alerts WHERE timestamp >= now() - interval '1 hour'"
    ).get();
    const keys: any = await db.prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN revoked=0 AND paused=0 THEN 1 ELSE 0 END) AS active FROM api_keys"
    ).get();

    // SQLite stores CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS" (UTC, no zone).
    // The browser's Date parser treats that format as LOCAL time, which makes
    // recent timestamps look hours stale and flips the pill to red. Force ISO+Z.
    const toIso = (ts: string | null | undefined): string | null => {
      if (!ts) return null;
      if (ts.includes('T') && (ts.endsWith('Z') || /[+-]\d\d:\d\d$/.test(ts))) return ts;
      return new Date(ts.replace(' ', 'T') + 'Z').toISOString();
    };

    res.json({
      lastHeartbeatAt: toIso(keyRow?.last_heartbeat_at),
      lastIngestAt:    toIso(keyRow?.last_used_at),
      lastAlertAt:     toIso(alertRow?.last_ts),
      alertsLast5m:    alerts5m?.c ?? 0,
      alertsLastHour:  alerts60m?.c ?? 0,
      totalKeys:       keys?.total ?? 0,
      activeKeys:      keys?.active ?? 0,
    });
  });

  // ── Forwarder heartbeat ───────────────────────────────────────────────────
  // The Wazuh-side forwarder pings this every 60s to prove it's alive,
  // independent of alert volume. Mirrors /api/ingest's key validation but
  // does nothing except bump last_heartbeat_at.
  app.post('/api/heartbeat', async (req, res) => {
    const authHeader   = (req.headers['authorization'] as string) || '';
    const apiKeyHeader = (req.headers['x-api-key'] as string) || '';
    const provided     = apiKeyHeader || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '');
    if (!provided) {
      return res.status(401).json({ error: 'API key required. Set X-Api-Key or Authorization: Bearer header.' });
    }
    const keyHash = crypto.createHash('sha256').update(provided).digest('hex');
    const keyRow  = await db.prepare("SELECT id, paused FROM api_keys WHERE key_hash=? AND revoked=0 LIMIT 1").get(keyHash) as any;
    if (!keyRow) {
      return res.status(401).json({ error: 'Invalid or revoked API key.' });
    }
    await db.prepare("UPDATE api_keys SET last_heartbeat_at=CURRENT_TIMESTAMP WHERE id=?").run(keyRow.id);
    res.json({ ok: true, paused: !!keyRow.paused, at: new Date().toISOString() });
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  app.get('/api/stats', authenticate, async (_req, res) => {
    const activeRow: any  = await db.prepare("SELECT COUNT(*) as count FROM alerts WHERE status IN ('NEW', 'ANALYZING', 'ESCALATED')").get();
    const mttrRow: any    = await db.prepare(`SELECT AVG((extract(epoch from now()) - extract(epoch from timestamp))) as avg_seconds FROM alerts WHERE status IN ('TRIAGED', 'CLOSED') AND ai_analysis IS NOT NULL`).get();
    const totalRow: any   = await db.prepare("SELECT COUNT(*) as count FROM alerts").get();
    const analyzedRow: any= await db.prepare("SELECT COUNT(*) as count FROM alerts WHERE ai_analysis IS NOT NULL").get();
    const fpRow: any      = await db.prepare("SELECT COUNT(*) as count FROM alerts WHERE status = 'FALSE_POSITIVE'").get();

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

  app.get('/api/stats/trends', authenticate, async (_req, res) => {
    const rows = await db.prepare(`
      SELECT date(timestamp) as day, COUNT(*) as count
      FROM alerts
      WHERE timestamp >= now() - interval '7 days'
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

  // Risk & pipeline time series for the dashboard chart. Aggregates the FULL
  // alerts table into evenly-spaced buckets (so it reflects real history, not
  // just the page of alerts the client happens to have loaded). For each bucket
  // we reconstruct the state "as of" the bucket end from current status + the
  // resolution timestamp (COALESCE(closed_at, filtered_at)). Risk uses the same
  // severity/escalation weighting as the dashboard's live score; the AI-pressure
  // and incident-mitigation terms are omitted for history (the frontend overlays
  // the live global risk on the latest bucket).
  app.get('/api/stats/risk-series', authenticate, async (req: any, res) => {
    const GRANULARITIES: Record<string, { unit: string; count: number; label: string }> = {
      hours:  { unit: 'hour',  count: 24, label: 'HH24:00' },
      days:   { unit: 'day',   count: 30, label: 'Mon DD' },
      months: { unit: 'month', count: 12, label: 'Mon YY' },
      years:  { unit: 'year',  count: 5,  label: 'YYYY' },
    };
    const cfg = GRANULARITIES[String(req.query.granularity || 'days')];
    if (!cfg) return res.status(400).json({ error: 'Invalid granularity (hours|days|months|years)' });

    // status set treated as "resolved / no longer active"
    const RESOLVED = `('FALSE_POSITIVE','FP_CONFIRMED','FILTERED','CLOSED')`;
    // active as of a bucket end `bend`: created before it, and either not resolved
    // or resolved at/after it
    const ACTIVE = `(a.status NOT IN ${RESOLVED} OR COALESCE(a.closed_at, a.filtered_at) >= b.bend)`;

    try {
      const rows = await db.prepare(`
        WITH buckets AS (
          SELECT gs AS bstart, gs + interval '1 ${cfg.unit}' AS bend
          FROM generate_series(
            date_trunc('${cfg.unit}', now()) - interval '${cfg.count - 1} ${cfg.unit}',
            date_trunc('${cfg.unit}', now()),
            interval '1 ${cfg.unit}'
          ) gs
        )
        SELECT
          to_char(b.bstart, 'YYYY-MM-DD"T"HH24:MI:SS')                                        AS day,
          to_char(b.bstart, '${cfg.label}')                                                   AS label,
          count(a.id) FILTER (WHERE a.timestamp >= b.bstart AND a.timestamp < b.bend)          AS new_alerts,
          count(a.id) FILTER (WHERE a.severity >= 13 AND ${ACTIVE})                            AS active_crit,
          count(a.id) FILTER (WHERE a.severity >= 10 AND a.severity < 13 AND ${ACTIVE})        AS active_high,
          count(a.id) FILTER (WHERE a.severity >= 7  AND a.severity < 10 AND ${ACTIVE})        AS active_med,
          count(a.id) FILTER (WHERE a.status IN ('ESCALATED','INCIDENT') AND ${ACTIVE})        AS escalated,
          count(a.id) FILTER (WHERE a.severity >= 10 AND a.status IN ${RESOLVED}
                                    AND COALESCE(a.closed_at, a.filtered_at) < b.bend)         AS solved_hc
        FROM buckets b
        LEFT JOIN alerts a ON a.timestamp < b.bend
        GROUP BY b.bstart
        ORDER BY b.bstart ASC
      `).all() as any[];

      const points = rows.map(r => {
        const crit = Number(r.active_crit), high = Number(r.active_high), med = Number(r.active_med), esc = Number(r.escalated);
        const raw = crit * 5 + high * 2 + med + esc * 2;
        return {
          day:                r.day,
          label:              r.label,
          risk:               Math.max(0, Math.min(100, Math.round(raw))),
          activeHighCritical: crit + high,
          solvedHighCritical: Number(r.solved_hc),
          newAlerts:          Number(r.new_alerts),
        };
      });
      res.json(points);
    } catch (err: any) {
      console.error('[risk-series]', err?.message);
      res.status(500).json({ error: 'Failed to build risk series' });
    }
  });

  // ── Incidents — see canonical routes lower in this file (Incident Management section)
  // The legacy GET/POST/PATCH /api/incidents handlers were removed because they returned
  // a flat array (incompatible with the new {rows, total} shape used by IncidentsTab).

  // ── Users ─────────────────────────────────────────────────────────────────
  app.get('/api/users', authenticate, requireAdmin, async (_req, res) => {
    const adminFields = `${userProfileFields}, failed_logins, locked_until`;
    res.json(await db.prepare(`SELECT ${adminFields} FROM users ORDER BY id ASC`).all());
  });

  app.patch('/api/users/:id', authenticate, requireAdmin, async (req: any, res) => {
    const targetId = parseInt(req.params.id);
    if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });
    const target: any = await db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Privileged-account protection: you may only edit users strictly below
    // your own role (self-edits of profile fields are allowed, handled below).
    if (targetId !== req.user.id && !canAdminister(req.user.role, target.role)) {
      return res.status(403).json({ error: 'You cannot manage a user at or above your own role level' });
    }

    const allowedRoles = ['ANALYST', 'TIER1', 'TIER2', 'INCIDENT_LEAD', 'ADMIN', 'SUPER_ADMIN'];
    const allowedStatus = ['active', 'disabled'];
    const updates: string[] = [];
    const values: any[] = [];
    const auditMessages: Array<{ action: string; details: string }> = [];

    if (req.body.role !== undefined) {
      if (!allowedRoles.includes(req.body.role)) return res.status(400).json({ error: 'Invalid role' });
      if (req.body.role !== target.role) {
        // You may only assign roles strictly below your own level — so a regular
        // ADMIN can't promote anyone to ADMIN/SUPER_ADMIN, and can't elevate
        // their own privilege by proxy.
        if (!canAssignRole(req.user.role, req.body.role)) {
          return res.status(403).json({ error: 'You cannot assign a role at or above your own level' });
        }
        if (targetId === req.user.id) {
          return res.status(400).json({ error: 'Cannot change your own role' });
        }
        updates.push('role = ?');
        values.push(req.body.role);
        auditMessages.push({ action: 'USER_ROLE_CHANGED', details: `Changed ${target.username} role: ${target.role} → ${req.body.role}` });
      }
    }
    if (req.body.display_name !== undefined && req.body.display_name !== target.display_name) {
      updates.push('display_name = ?');
      values.push(req.body.display_name || null);
      auditMessages.push({ action: 'USER_PROFILE_UPDATED', details: `Changed ${target.username} display_name` });
    }
    if (req.body.email !== undefined && req.body.email !== target.email) {
      updates.push('email = ?');
      values.push(req.body.email || null);
      auditMessages.push({ action: 'USER_PROFILE_UPDATED', details: `Changed ${target.username} email → ${req.body.email || '(empty)'}` });
    }
    if (req.body.status !== undefined) {
      if (!allowedStatus.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
      if (req.body.status !== (target.status || 'active')) {
        if (targetId === req.user.id && req.body.status === 'disabled') {
          return res.status(400).json({ error: 'Cannot disable your own account' });
        }
        updates.push('status = ?');
        values.push(req.body.status);
        auditMessages.push({ action: 'USER_STATUS_CHANGED', details: `Set ${target.username} status → ${req.body.status}` });
      }
    }
    if (req.body.must_change_password !== undefined) {
      const v = req.body.must_change_password ? 1 : 0;
      if (v !== (target.must_change_password || 0)) {
        updates.push('must_change_password = ?');
        values.push(v);
        auditMessages.push({ action: 'USER_PROFILE_UPDATED', details: `Set ${target.username} must_change_password = ${v}` });
      }
    }
    if (req.body.access_expires_at !== undefined) {
      // Accept ISO-ish strings or null/empty to clear
      const v = req.body.access_expires_at ? String(req.body.access_expires_at) : null;
      if (v !== target.access_expires_at) {
        updates.push('access_expires_at = ?');
        values.push(v);
        auditMessages.push({ action: 'USER_PROFILE_UPDATED', details: `Set ${target.username} access_expires_at = ${v ?? '(cleared)'}` });
      }
    }

    if (updates.length === 0) {
      const unchanged = await db.prepare(`SELECT ${userProfileFields}, failed_logins, locked_until FROM users WHERE id = ?`).get(targetId);
      return res.json(unchanged);
    }

    values.push(targetId);
    await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    for (const a of auditMessages) writeAudit(req.user.id, a.action, a.details);
    const updated = await db.prepare(`SELECT ${userProfileFields}, failed_logins, locked_until FROM users WHERE id = ?`).get(targetId);
    res.json(updated);
  });

  // Admin reset password: generates a new temp password, sets must_change_password=1.
  app.post('/api/users/:id/reset-password', authenticate, requireAdmin, async (req: any, res) => {
    const targetId = parseInt(req.params.id);
    if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });
    const target: any = await db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canAdminister(req.user.role, target.role)) {
      return res.status(403).json({ error: 'You cannot reset the password of a user at or above your own role level' });
    }
    const tempPassword = crypto.randomBytes(12).toString('base64url');
    const hashed = bcrypt.hashSync(tempPassword, 10);
    // Bump jwt_epoch too — a forced password reset implies any active sessions
    // for that user should die immediately (NIST 800-53 AC-12).
    await db.prepare(
      "UPDATE users SET password = ?, password_changed_at = now(), must_change_password = 1, failed_logins = 0, locked_until = NULL, jwt_epoch = COALESCE(jwt_epoch, 0) + 1 WHERE id = ?"
    ).run(hashed, targetId);
    await recordPasswordChange(targetId, hashed);
    writeAudit(req.user.id, 'PASSWORD_RESET', `Reset password for ${target.username} (must change on next login; sessions revoked)`);
    res.json({ temp_password: tempPassword });
  });

  app.delete('/api/users/:id', authenticate, requireAdmin, requireStepUp, async (req: any, res) => {
    const targetId = parseInt(req.params.id);
    if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });
    if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
    const target: any = await db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canAdminister(req.user.role, target.role)) {
      return res.status(403).json({ error: 'You cannot delete a user at or above your own role level' });
    }
    await db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    writeAudit(req.user.id, 'USER_DELETED', `Deleted user ${target.username} (#${targetId})`);
    res.json({ ok: true });
  });

  // Users available for incident assignment — all roles visible for assignment
  app.get('/api/users/analysts', authenticate, async (_req, res) => {
    const rows = await db.prepare(
      `SELECT id, username, role, display_name, avatar_color FROM users
       ORDER BY CASE role WHEN 'SUPER_ADMIN' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'INCIDENT_LEAD' THEN 2 WHEN 'TIER2' THEN 3 WHEN 'TIER1' THEN 4 ELSE 5 END, username ASC`
    ).all();
    res.json(rows);
  });

  app.post('/api/users', authenticate, requireAdmin, async (req: any, res) => {
    const {
      username,
      password,
      password_confirm,
      email,
      role,
      display_name,
      generate_temp_password,
      must_change_password,
    } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    const newRole = role || 'TIER1';
    if (!(newRole in ROLE_LEVEL)) return res.status(400).json({ error: 'Invalid role' });
    // Can't create an account at or above your own level (so only a SUPER_ADMIN
    // can create ADMIN accounts, and nobody mints a peer via the API).
    if (!canAssignRole(req.user.role, newRole)) {
      return res.status(403).json({ error: 'You cannot create a user at or above your own role level' });
    }

    let effectivePassword: string | null = null;
    let tempPasswordToReturn: string | null = null;

    if (generate_temp_password) {
      // 16-char URL-safe random — strong enough that complexity rules don't apply
      tempPasswordToReturn = crypto.randomBytes(12).toString('base64url');
      effectivePassword = tempPasswordToReturn;
    } else {
      if (!password) return res.status(400).json({ error: 'password required' });
      if (password_confirm !== undefined && password !== password_confirm) {
        return res.status(400).json({ error: 'Passwords do not match' });
      }
      const pwCheck = await validatePassword(password);
      if (!pwCheck.ok) return res.status(400).json({ error: 'Password too weak', details: pwCheck.errors });
      effectivePassword = password;
    }

    // Default behaviour: when admin sets the password manually, still require change on first login
    // unless the admin explicitly opts out. When generating a temp password, always require change.
    const mustChange = generate_temp_password
      ? 1
      : (must_change_password === false ? 0 : 1);

    try {
      const hashed = bcrypt.hashSync(effectivePassword!, 10);
      const result: any = await db.prepare(
        `INSERT INTO users (username, password, email, role, display_name, password_changed_at, created_at, must_change_password, status)
         VALUES (?, ?, ?, ?, ?, now(), now(), ?, 'active') RETURNING id`
      ).run(username, hashed, email || null, newRole, display_name || null, mustChange);
      await recordPasswordChange(Number(result.lastInsertRowid), hashed);
      writeAudit(req.user?.id, 'USER_CREATED', `Created user ${username} (${newRole})${mustChange ? ' [must change pw]' : ''}`);
      const created: any = await db.prepare(`SELECT ${userProfileFields} FROM users WHERE id = ?`).get(result.lastInsertRowid);
      // Return the temp password ONCE in the response (it's never stored in plaintext anywhere else)
      if (tempPasswordToReturn) (created as any).temp_password = tempPasswordToReturn;
      (created as any).must_change_password = !!mustChange;
      res.json(created);
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Username already exists' });
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  // ── Profile endpoints ────────────────────────────────────────────────────
  app.get('/api/users/me/profile', authenticate, async (req: any, res) => {
    const profile = await db.prepare(`SELECT ${userProfileFields} FROM users WHERE id = ?`).get(req.user.id);
    if (!profile) return res.status(404).json({ error: 'Not found' });
    res.json(profile);
  });

  app.patch('/api/users/me/profile', authenticate, async (req: any, res) => {
    const allowed = ['display_name', 'email', 'avatar_color', 'timezone', 'notify_email', 'notify_critical', 'notify_assignments', 'bio'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(req.body[key]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
    values.push(req.user.id);
    await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    writeAudit(req.user.id, 'PROFILE_UPDATED', `User updated profile fields: ${updates.map(u => u.split(' ')[0]).join(', ')}`);
    const profile = await db.prepare(`SELECT ${userProfileFields} FROM users WHERE id = ?`).get(req.user.id);
    res.json(profile);
  });

  // Activity log — audit entries for this user
  app.get('/api/users/me/activity', authenticate, async (req: any, res) => {
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'))));
    const rows = await db.prepare(
      'SELECT id, timestamp, action, details FROM audit_logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(req.user.id, limit);
    res.json(rows);
  });

  // Password rules endpoint (for frontend validation hints) — sourced from
  // the live `password_policy` integrations row. Shape is preserved for
  // backwards compatibility with existing frontend code that reads camelCase.
  app.get('/api/auth/password-rules', async (_req, res) => {
    const p = await loadPasswordPolicy(db);
    res.json({
      minLength:        p.min_length,
      requireUppercase: p.require_uppercase,
      requireLowercase: p.require_lowercase,
      requireDigit:     p.require_digit,
      requireSpecial:   p.require_special,
      blockCommon:      p.block_common_passwords,
      historyDepth:     p.history_depth,
      maxAgeDays:       p.max_age_days,
    });
  });

  app.patch('/api/users/me/password', authenticate, async (req: any, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: 'Current and new password required.' });
    const pwCheck = await validatePassword(newPassword);
    if (!pwCheck.ok)
      return res.status(400).json({ message: 'Password does not meet requirements.', details: pwCheck.errors });
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as any;
    if (!bcrypt.compareSync(currentPassword, user.password))
      return res.status(401).json({ message: 'Current password is incorrect.' });
    if (await passwordMatchesHistory(req.user.id, newPassword)) {
      return res.status(400).json({ message: 'This password was used recently. Choose a new one.' });
    }
    const newHash = bcrypt.hashSync(newPassword, 10);
    await db.prepare("UPDATE users SET password = ?, password_changed_at = now(), must_change_password = 0 WHERE id = ?").run(newHash, req.user.id);
    await recordPasswordChange(req.user.id, newHash);
    writeAudit(req.user.id, 'PASSWORD_CHANGED', `User ${user.username} changed password`);
    res.json({ message: 'Password updated.' });
  });

  // Admin: test the LDAP/AD connection. Body: { username }.
  // Uses the saved integration row's config; does NOT require sending creds again.
  app.post('/api/admin/integrations/ldap/test', authenticate, requireAdmin, async (req: any, res) => {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ ok: false, error: 'username required' });
    const cfg = await readLdapConfig();
    if (!cfg) return res.status(400).json({ ok: false, error: 'LDAP integration not configured' });
    const r = await findLdapUser(cfg, String(username));
    res.json(r);
  });

  // Admin: unlock a locked account
  app.post('/api/admin/unlock-user/:id', authenticate, requireAdmin, async (req: any, res) => {
    const targetId = parseInt(req.params.id);
    if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });
    const target: any = await db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canAdminister(req.user.role, target.role)) {
      return res.status(403).json({ error: 'You cannot manage a user at or above your own role level' });
    }
    await db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(targetId);
    writeAudit(req.user.id, 'USER_UNLOCKED', `Admin unlocked user ${target.username} (#${targetId})`);
    res.json({ ok: true });
  });

  // ── Session management ───────────────────────────────────────────────────
  // Revoke-all: bump my own jwt_epoch. Every outstanding token (this browser
  // included — caller will be kicked to login on the next request). NIST
  // 800-53 AC-12 (Session Termination), ISO 27001 A.5.16.
  app.post('/api/users/me/sessions/revoke-all', authenticate, async (req: any, res) => {
    await db.prepare('UPDATE users SET jwt_epoch = COALESCE(jwt_epoch, 0) + 1 WHERE id = ?').run(req.user.id);
    writeAudit(req.user.id, 'SESSIONS_REVOKED', `User ${req.user.username} revoked all of their sessions`);
    res.json({ ok: true });
  });

  // Admin: forcibly revoke all sessions for any user
  app.post('/api/admin/users/:id/revoke-sessions', authenticate, requireAdmin, async (req: any, res) => {
    const targetId = parseInt(req.params.id);
    if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });
    const target: any = await db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (targetId !== req.user.id && !canAdminister(req.user.role, target.role)) {
      return res.status(403).json({ error: 'You cannot revoke sessions for a user at or above your own role level' });
    }
    await db.prepare('UPDATE users SET jwt_epoch = COALESCE(jwt_epoch, 0) + 1 WHERE id = ?').run(targetId);
    writeAudit(req.user.id, 'SESSIONS_REVOKED', `Admin revoked all sessions for ${target.username} (#${targetId})`);
    res.json({ ok: true });
  });

  // ── JIT temp role (Phase 3.6, NIST AC-6(2), ISO A.8.2) ───────────────────
  // Grant a user a temporary higher role for up to 4h. Step-up gated because
  // it's an elevation event. The expiry tick (below) auto-clears when the
  // window passes.
  app.post('/api/admin/users/:id/temp-role', authenticate, requireAdmin, requireStepUp, async (req: any, res) => {
    const targetId = parseInt(req.params.id);
    const { role, minutes } = req.body || {};
    if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });
    const target: any = await db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!role || !(role in ROLE_LEVEL)) return res.status(400).json({ error: 'Invalid role' });
    if (!canAdminister(req.user.role, target.role)) {
      return res.status(403).json({ error: 'You cannot manage a user at or above your own role level' });
    }
    if (!canAssignRole(req.user.role, role)) {
      return res.status(403).json({ error: 'You cannot grant a role at or above your own level' });
    }
    const dur = Math.min(240, Math.max(5, parseInt(minutes, 10) || 60));   // 5min–4h
    if ((ROLE_LEVEL[role] ?? -1) <= (ROLE_LEVEL[target.role] ?? -1)) {
      return res.status(400).json({ error: 'temp_role must be higher than base role' });
    }
    const expiresAt = new Date(Date.now() + dur * 60_000).toISOString();
    await db.prepare(
      'UPDATE users SET temp_role = ?, temp_role_expires_at = ?, temp_role_granted_by = ? WHERE id = ?'
    ).run(role, expiresAt, req.user.id, targetId);
    writeAudit(req.user.id, 'TEMP_ROLE_GRANTED', `Granted ${target.username} temp role ${role} for ${dur} min (until ${expiresAt})`);
    res.json({ ok: true, role, expires_at: expiresAt });
  });

  app.delete('/api/admin/users/:id/temp-role', authenticate, requireAdmin, async (req: any, res) => {
    const targetId = parseInt(req.params.id);
    if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });
    const target: any = await db.prepare('SELECT username, role FROM users WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canAdminister(req.user.role, target.role)) {
      return res.status(403).json({ error: 'You cannot manage a user at or above your own role level' });
    }
    await db.prepare('UPDATE users SET temp_role = NULL, temp_role_expires_at = NULL WHERE id = ?').run(targetId);
    writeAudit(req.user.id, 'TEMP_ROLE_REVOKED', `Revoked temp role for ${target.username}`);
    res.json({ ok: true });
  });

  // ── Inactive-user report (Phase 3.3, ISO A.5.18, NIST AC-2(3)) ───────────
  app.get('/api/admin/inactive-users', authenticate, requireAdmin, async (req: any, res) => {
    const days = Math.max(1, Math.min(3650, parseInt(req.query.days as string, 10) || 90));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = await db.prepare(`
      SELECT id, username, email, role, status, last_login, created_at
      FROM users
      WHERE status = 'active'
        AND (last_login IS NULL OR last_login < ?)
      ORDER BY (last_login IS NULL) DESC, last_login ASC
    `).all(cutoff);
    res.json({ days, cutoff, count: rows.length, users: rows });
  });

  // Bulk disable selected users from the inactive report
  app.post('/api/admin/inactive-users/disable', authenticate, requireAdmin, requireStepUp, async (req: any, res) => {
    const ids: any[] = Array.isArray(req.body?.user_ids) ? req.body.user_ids : [];
    const cleanIds = ids.map(x => parseInt(x, 10)).filter(n => Number.isFinite(n));
    if (cleanIds.length === 0) return res.status(400).json({ error: 'user_ids required' });
    if (cleanIds.includes(req.user.id)) return res.status(400).json({ error: 'Cannot disable your own account' });
    // Don't let a lower-privileged admin disable an admin/super-admin in bulk.
    const protectedRow: any = await db.prepare(
      `SELECT username, role FROM users WHERE id IN (${cleanIds.map(() => '?').join(',')})
       AND ${ROLE_LEVEL[req.user.role] ?? -1} <= (CASE role
         WHEN 'SUPER_ADMIN' THEN 5 WHEN 'ADMIN' THEN 4 WHEN 'INCIDENT_LEAD' THEN 3
         WHEN 'TIER2' THEN 2 WHEN 'TIER1' THEN 1 ELSE 0 END) LIMIT 1`
    ).get(...cleanIds);
    if (protectedRow) {
      return res.status(403).json({ error: `Cannot disable ${protectedRow.username} — at or above your own role level` });
    }
    const placeholders = cleanIds.map(() => '?').join(',');
    const r = await db.prepare(`UPDATE users SET status='disabled', jwt_epoch = COALESCE(jwt_epoch, 0) + 1 WHERE id IN (${placeholders})`).run(...cleanIds);
    writeAudit(req.user.id, 'BULK_USER_DISABLED', `Bulk-disabled ${r.changes} inactive user(s) [step-up verified]`);
    res.json({ disabled: r.changes });
  });

  // ── Permission matrix (Phase 3.1, ISO A.5.15 evidence) ───────────────────
  app.get('/api/admin/permissions', authenticate, requireAdmin, async (_req, res) => {
    res.json({ roles: ['ANALYST','TIER1','TIER2','INCIDENT_LEAD','ADMIN','SUPER_ADMIN'], matrix: buildPermissionMatrix() });
  });

  // ── Security policy management (read/write) ──────────────────────────────
  // Thin wrappers over the four `integrations` policy rows. Allows the admin
  // UI to load + edit them without exposing arbitrary integration writes.
  const POLICY_ROWS = ['password_policy', 'lockout_policy', 'admin_ip_allowlist', 'audit_retention'] as const;
  type PolicyName = typeof POLICY_ROWS[number];

  app.get('/api/admin/security-policies', authenticate, requireAdmin, async (_req, res) => {
    res.json({
      password_policy:    await loadPasswordPolicy(db),
      lockout_policy:     await loadLockoutPolicy(db),
      admin_ip_allowlist: await loadAdminIpAllowlist(db),
      audit_retention:    await loadAuditRetention(db),
    });
  });

  app.patch('/api/admin/security-policies/:name', authenticate, requireAdmin, requireStepUp, async (req: any, res) => {
    const name = req.params.name as PolicyName;
    if (!POLICY_ROWS.includes(name)) return res.status(400).json({ error: 'Unknown policy' });
    // The admin IP allowlist governs who can even reach admin endpoints —
    // highest blast radius, so it's reserved for SUPER_ADMIN.
    if (name === 'admin_ip_allowlist' && (ROLE_LEVEL[req.user?.role] ?? -1) < ROLE_LEVEL.SUPER_ADMIN) {
      return res.status(403).json({ error: 'Editing the admin IP allowlist requires Super Administrator' });
    }
    const config = req.body?.config;
    if (!config || typeof config !== 'object') return res.status(400).json({ error: 'config object required' });
    await db.prepare('UPDATE integrations SET config = ? WHERE name = ?').run(JSON.stringify(config), name);
    invalidatePolicyCache();
    const auditAction =
      name === 'password_policy'    ? 'PASSWORD_POLICY_CHANGED'
      : name === 'lockout_policy'   ? 'LOCKOUT_POLICY_CHANGED'
      : name === 'admin_ip_allowlist' ? 'ADMIN_IP_ALLOWLIST_CHANGED'
      : 'AUDIT_RETENTION_CHANGED';
    writeAudit(req.user.id, auditAction, `Updated ${name} → ${JSON.stringify(config)}`);
    res.json({ ok: true });
  });

  // ── Admin health card (Phase 4.3) ────────────────────────────────────────
  app.get('/api/admin/health', authenticate, requireAdmin, async (_req, res) => {
    const counts: Record<string, number> = {};
    for (const t of ['alerts','incidents','users','audit_logs','incident_actions','password_history','api_keys']) {
      try {
        const r: any = await db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get();
        counts[t] = r?.c ?? 0;
      } catch { counts[t] = -1; }
    }
    const dbPath = path.join(__dirname, '..', 'aisoc.db');
    let dbSize = 0;
    try { dbSize = fs.statSync(dbPath).size; } catch { /* ignore */ }
    const lastHb: any = await db.prepare('SELECT MAX(last_heartbeat_at) AS hb FROM api_keys').get();
    const mem = process.memoryUsage();
    res.json({
      uptime_seconds: Math.round(process.uptime()),
      node_version:   process.version,
      db_size_bytes:  dbSize,
      row_counts:     counts,
      last_ingest_heartbeat: lastHb?.hb || null,
      memory: {
        rss:        mem.rss,
        heap_used:  mem.heapUsed,
        heap_total: mem.heapTotal,
      },
    });
  });

  // ── Compliance evidence reports (Phase 4.4) ─────────────────────────────
  // CSV streamed downloads — handed to auditors as point-in-time evidence.
  function streamCsv(res: any, filename: string, header: string[], rows: any[][]) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const esc = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    res.write(header.join(',') + '\n');
    for (const r of rows) res.write(r.map(esc).join(',') + '\n');
    res.end();
  }

  app.get('/api/admin/reports/user-roster.csv', authenticate, requireAdmin, async (req: any, res) => {
    const rows = await db.prepare(`
      SELECT id, username, email, role, status, COALESCE(last_login, '') AS last_login,
             COALESCE(created_at,'') AS created_at, COALESCE(access_expires_at,'') AS access_expires_at,
             COALESCE(temp_role,'') AS temp_role
      FROM users ORDER BY username ASC
    `).all() as any[];
    streamCsv(res, `user-roster-${new Date().toISOString().split('T')[0]}.csv`,
      ['id','username','email','role','status','last_login','created_at','access_expires_at','temp_role'],
      rows.map((r: any) => [r.id, r.username, r.email, r.role, r.status, r.last_login, r.created_at, r.access_expires_at, r.temp_role]));
    writeAudit(req.user?.id, 'COMPLIANCE_REPORT_DOWNLOADED', 'user-roster.csv');
  });

  app.get('/api/admin/reports/failed-logins.csv', authenticate, requireAdmin, async (req: any, res) => {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 90));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = await db.prepare(`
      SELECT timestamp, user_id, action, details
      FROM audit_logs
      WHERE action IN ('LOGIN_FAILED', 'ACCOUNT_LOCKED') AND timestamp >= ?
      ORDER BY timestamp DESC
    `).all(cutoff) as any[];
    streamCsv(res, `failed-logins-${days}d.csv`,
      ['timestamp','user_id','action','details'],
      rows.map((r: any) => [r.timestamp, r.user_id ?? '', r.action, r.details]));
    writeAudit(req.user.id, 'COMPLIANCE_REPORT_DOWNLOADED', `failed-logins.csv (${days}d)`);
  });

  app.get('/api/admin/reports/admin-actions.csv', authenticate, requireAdmin, async (req: any, res) => {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 90));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const adminActions = [
      'USER_CREATED','USER_DELETED','USER_ROLE_CHANGED','USER_STATUS_CHANGED','USER_PROFILE_UPDATED',
      'PASSWORD_RESET','USER_UNLOCKED','SESSIONS_REVOKED','TEMP_ROLE_GRANTED','TEMP_ROLE_REVOKED',
      'PASSWORD_POLICY_CHANGED','LOCKOUT_POLICY_CHANGED','ADMIN_IP_ALLOWLIST_CHANGED','AUDIT_RETENTION_CHANGED',
      'ADMIN_IP_BLOCKED','BULK_USER_DISABLED','ALERTS_RESET','INVESTIGATION_CLEARED','FP_ARCHIVE_CLEARED',
      'ACCESS_REVIEW_STARTED','ACCESS_REVIEW_COMPLETED','AUDIT_ARCHIVED','STEP_UP_VERIFIED','STEP_UP_FAILED',
    ];
    const ph = adminActions.map(() => '?').join(',');
    const rows = await db.prepare(`
      SELECT timestamp, user_id, action, details
      FROM audit_logs
      WHERE action IN (${ph}) AND timestamp >= ?
      ORDER BY timestamp DESC
    `).all(...adminActions, cutoff) as any[];
    streamCsv(res, `admin-actions-${days}d.csv`,
      ['timestamp','user_id','action','details'],
      rows.map((r: any) => [r.timestamp, r.user_id ?? '', r.action, r.details]));
    writeAudit(req.user.id, 'COMPLIANCE_REPORT_DOWNLOADED', `admin-actions.csv (${days}d)`);
  });

  app.get('/api/admin/reports/privileged-coverage.csv', authenticate, requireAdmin, async (req: any, res) => {
    // Privileged-account hygiene snapshot: who holds privileged roles, when
    // they last logged in, whether they have a pending password change.
    const rows = await db.prepare(`
      SELECT id, username, role, COALESCE(temp_role,'') AS temp_role,
             COALESCE(last_login, '') AS last_login,
             COALESCE(password_changed_at, '') AS password_changed_at,
             COALESCE(must_change_password, 0) AS must_change_password,
             status
      FROM users
      WHERE role IN ('ADMIN','INCIDENT_LEAD') OR temp_role IN ('ADMIN','INCIDENT_LEAD')
      ORDER BY role DESC, username ASC
    `).all() as any[];
    streamCsv(res, `privileged-coverage.csv`,
      ['id','username','role','temp_role','last_login','password_changed_at','must_change_password','status'],
      rows.map((r: any) => [r.id, r.username, r.role, r.temp_role, r.last_login, r.password_changed_at, r.must_change_password, r.status]));
    writeAudit(req.user.id, 'COMPLIANCE_REPORT_DOWNLOADED', 'privileged-coverage.csv');
  });

  // ── Access reviews (Phase 3.4) ───────────────────────────────────────────
  app.post('/api/admin/access-reviews', authenticate, requireAdmin, async (req: any, res) => {
    const due = req.body?.due_at || null;
    const r: any = await db.prepare('INSERT INTO access_reviews (started_by, due_at, note) VALUES (?, ?, ?) RETURNING id').run(req.user.id, due, req.body?.note || null);
    const reviewId = Number(r.lastInsertRowid);
    const users = await db.prepare(`SELECT id, username, role FROM users WHERE status='active'`).all() as any[];
    await db.transaction(async (tx) => {
      const ins = tx.prepare(`INSERT INTO access_review_items (review_id, user_id, username_at_time, role_at_time) VALUES (?, ?, ?, ?)`);
      for (const u of users) await ins.run(reviewId, u.id, u.username, u.role);
    });
    writeAudit(req.user.id, 'ACCESS_REVIEW_STARTED', `Started review #${reviewId} with ${users.length} user(s)`);
    res.json({ id: reviewId, items: users.length });
  });

  app.get('/api/admin/access-reviews', authenticate, requireAdmin, async (_req, res) => {
    const rows = await db.prepare(`SELECT * FROM access_reviews ORDER BY started_at DESC LIMIT 50`).all();
    res.json(rows);
  });

  app.get('/api/admin/access-reviews/:id', authenticate, requireAdmin, async (req: any, res) => {
    const id = parseInt(req.params.id, 10);
    const review = await db.prepare('SELECT * FROM access_reviews WHERE id = ?').get(id);
    if (!review) return res.status(404).json({ error: 'Not found' });
    const items = await db.prepare('SELECT * FROM access_review_items WHERE review_id = ? ORDER BY id ASC').all(id);
    res.json({ review, items });
  });

  app.patch('/api/admin/access-reviews/:id/items/:itemId', authenticate, requireAdmin, async (req: any, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const { decision, notes } = req.body || {};
    if (!['keep','change_role','disable'].includes(decision)) return res.status(400).json({ error: 'Invalid decision' });
    await db.prepare(`UPDATE access_review_items SET decision = ?, decided_by = ?, decided_at = now(), notes = ? WHERE id = ?`)
      .run(decision, req.user.id, notes || null, itemId);
    res.json({ ok: true });
  });

  app.post('/api/admin/access-reviews/:id/complete', authenticate, requireAdmin, async (req: any, res) => {
    const id = parseInt(req.params.id, 10);
    const items = await db.prepare('SELECT decision, user_id, username_at_time, role_at_time FROM access_review_items WHERE review_id = ?').all(id) as any[];
    await db.prepare(`UPDATE access_reviews SET completed_at = now() WHERE id = ?`).run(id);
    writeAudit(req.user.id, 'ACCESS_REVIEW_COMPLETED', `Review #${id} completed; decisions=${JSON.stringify(items)}`);
    res.json({ ok: true });
  });

  // ── Admin ─────────────────────────────────────────────────────────────────
  app.post('/api/admin/reset-alerts', authenticate, requireAdmin, requireStepUp, async (req: any, res) => {
    const result = await db.prepare(`UPDATE alerts SET status='NEW', ai_analysis=NULL, mitre_attack=NULL, remediation_steps=NULL, email_sent=0`).run();
    writeAudit(req.user?.id, 'ALERTS_RESET', `Reset ${result.changes} alerts to NEW [step-up verified]`);
    res.json({ reset: result.changes });
  });

  // Helper: delete alerts and ALL FK-related child rows. SQLite enforces foreign keys
  // (incident_responses, agent_runs, feedback, action_logs, blocks all reference alerts.id).
  async function deleteAlertsAndChildren(idList: string[]): Promise<number> {
    if (idList.length === 0) return 0;
    const inPlaceholders = idList.map(() => '?').join(',');
    // One statement error aborts a Postgres transaction, so we only reference
    // tables guaranteed by db/schema.sql (no try/catch-per-table).
    return await db.transaction(async (tx) => {
      // Children with FK on alerts.id — order doesn't matter, but delete all before parent.
      for (const tbl of ['incident_alerts', 'agent_runs', 'feedback', 'action_logs', 'working_memory', 'incident_reasoning', 'incident_insights']) {
        await tx.prepare(`DELETE FROM ${tbl} WHERE alert_id IN (${inPlaceholders})`).run(...idList);
      }
      const r = await tx.prepare(`DELETE FROM alerts WHERE id IN (${inPlaceholders})`).run(...idList);
      return r.changes;
    });
  }

  // Wipe everything currently visible in the Incidents tab AND the Alert Queue.
  // - Alert Queue rows: alerts with status TRIAGED / ESCALATED / CLOSED / ANALYZING
  // - Incidents tab rows: every row in the `incidents` table + its FK children
  // FP archive entries (FALSE_POSITIVE / FP_CONFIRMED) are preserved.
  app.post('/api/admin/clear-investigation', authenticate, requireAdmin, requireStepUp, async (req: any, res) => {
    const STATUSES = ['TRIAGED', 'ESCALATED', 'CLOSED', 'ANALYZING'];
    const placeholders = STATUSES.map(() => '?').join(',');
    const queueIds = await db.prepare(`SELECT id FROM alerts WHERE status IN (${placeholders})`).all(...STATUSES) as any[];
    const queueIdList = queueIds.map(r => r.id);

    try {
      let deletedIncidents = 0;
      await db.transaction(async (tx) => {
        // 1. Drop incidents table contents (and all FK children referencing incidents.id)
        for (const tbl of ['incident_alerts', 'incident_timeline', 'incident_actions']) {
          await tx.prepare(`DELETE FROM ${tbl}`).run();
        }
        const r = await tx.prepare('DELETE FROM incidents').run();
        deletedIncidents = r.changes;
      });

      // 2. Drop the Alert Queue rows (alerts + their FK children)
      const deletedAlerts = await deleteAlertsAndChildren(queueIdList);

      writeAudit(req.user?.id, 'INVESTIGATION_CLEARED',
        `Cleared Incidents+Queue: ${deletedIncidents} incident(s), ${deletedAlerts} queued alert(s) [step-up verified]`);
      io.emit('alerts_cleared', { ids: queueIdList });
      io.emit('incidents_cleared', {});
      res.json({ ok: true, deleted: deletedIncidents + deletedAlerts, incidents: deletedIncidents, alerts: deletedAlerts });
    } catch (err: any) {
      console.error('[Clear Incidents] Error:', err?.message);
      res.status(500).json({ error: err?.message || 'Failed to clear Incidents' });
    }
  });

  // Wipe the FP Archive (FALSE_POSITIVE + FP_CONFIRMED). Incidents queue is preserved.
  app.post('/api/admin/clear-fp-archive', authenticate, requireAdmin, requireStepUp, async (req: any, res) => {
    const STATUSES = ['FALSE_POSITIVE', 'FP_CONFIRMED'];
    const placeholders = STATUSES.map(() => '?').join(',');
    const ids = await db.prepare(`SELECT id FROM alerts WHERE status IN (${placeholders})`).all(...STATUSES) as any[];
    const idList = ids.map(r => r.id);

    try {
      const deleted = await deleteAlertsAndChildren(idList);
      writeAudit(req.user?.id, 'FP_ARCHIVE_CLEARED', `Deleted ${deleted} alerts from FP archive [step-up verified]`);
      io.emit('alerts_cleared', { ids: idList });
      res.json({ ok: true, deleted });
    } catch (err: any) {
      console.error('[Clear FP Archive] Error:', err?.message);
      res.status(500).json({ error: err?.message || 'Failed to clear FP archive' });
    }
  });

  // Helper: build a filtered audit_logs query from the same query-string shape used by
  // the JSON and CSV endpoints. Returns { sql, params, countSql, countParams }.
  function buildAuditFilter(q: any) {
    const conditions: string[] = [];
    const params: any[] = [];
    if (q.user_id) {
      conditions.push('a.user_id = ?');
      params.push(parseInt(String(q.user_id)));
    }
    if (q.action) {
      conditions.push('a.action = ?');
      params.push(String(q.action));
    }
    if (q.from) {
      conditions.push('a.timestamp >= ?');
      params.push(String(q.from));
    }
    if (q.to) {
      conditions.push('a.timestamp <= ?');
      params.push(String(q.to));
    }
    if (q.q) {
      conditions.push('(a.details LIKE ? OR a.action LIKE ? OR u.username LIKE ?)');
      const like = `%${String(q.q)}%`;
      params.push(like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return { where, params };
  }

  app.get('/api/audit-logs', authenticate, requireAdmin, async (req: any, res) => {
    const page = Math.max(1, parseInt(String(req.query.page || '1')));
    const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize || '50'))));
    const offset = (page - 1) * pageSize;
    const { where, params } = buildAuditFilter(req.query);
    const baseSql = `FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${where}`;
    const total = (await db.prepare(`SELECT COUNT(*) AS c ${baseSql}`).get(...params) as any).c;
    const rows = await db
      .prepare(
        `SELECT a.id, a.timestamp, a.user_id, a.action, a.details, u.username
         ${baseSql}
         ORDER BY a.timestamp DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, offset);
    res.json({ rows, total, page, pageSize });
  });

  // Aggregated list of distinct audit actions — drives the "Action" filter dropdown.
  app.get('/api/audit-logs/actions', authenticate, requireAdmin, async (_req, res) => {
    const rows = await db
      .prepare('SELECT DISTINCT action FROM audit_logs WHERE action IS NOT NULL ORDER BY action ASC')
      .all() as Array<{ action: string }>;
    res.json(rows.map((r) => r.action));
  });

  app.get('/api/audit-logs/export.csv', authenticate, requireAdmin, async (req: any, res) => {
    const { where, params } = buildAuditFilter(req.query);
    const baseSql = `FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${where}`;
    const rows: any[] = await db
      .prepare(
        `SELECT a.timestamp, u.username, a.action, a.details
         ${baseSql}
         ORDER BY a.timestamp DESC
         LIMIT 50000`
      )
      .all(...params);
    const csvEscape = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = 'timestamp,username,action,details\n';
    const body = rows
      .map((r) => [r.timestamp, r.username || '', r.action, r.details].map(csvEscape).join(','))
      .join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(header + body);
  });

  // Aggregated failed-login dashboard data.
  app.get('/api/admin/failed-logins', authenticate, requireAdmin, async (req: any, res) => {
    const windowParam = String(req.query.window || '24h');
    const hours = windowParam === '7d' ? 168 : 24;
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const total = (db
      .prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'LOGIN_FAILED' AND timestamp >= ?")
      .get(since) as any).c;
    const byUser = await db
      .prepare(
        `SELECT COALESCE(u.username, 'unknown') AS username, COUNT(*) AS count
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.action = 'LOGIN_FAILED' AND a.timestamp >= ?
         GROUP BY username ORDER BY count DESC LIMIT 10`
      )
      .all(since);
    // Bucket per hour for sparkline
    const buckets: Array<{ hour: string; count: number }> = [];
    const now = new Date();
    for (let i = hours - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600 * 1000);
      buckets.push({ hour: d.toISOString().slice(0, 13), count: 0 });
    }
    const rows: any[] = await db
      .prepare(
        `SELECT substr(timestamp, 1, 13) AS hour, COUNT(*) AS count
         FROM audit_logs WHERE action = 'LOGIN_FAILED' AND timestamp >= ?
         GROUP BY hour`
      )
      .all(since);
    const map = new Map(rows.map((r) => [String(r.hour).replace(' ', 'T'), Number(r.count)]));
    for (const b of buckets) if (map.has(b.hour)) b.count = map.get(b.hour)!;
    res.json({ window: windowParam, since, total, byUser, sparkline: buckets });
  });

  // ── Ingest ────────────────────────────────────────────────────────────────

  // Helper: fire-and-forget orchestration on a freshly-ingested alert
  async function triggerOrchestration(alertId: string) {
    try {
      const alert: any = await db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
      if (!alert) return;
      const recentAlerts = await db.prepare(
        `SELECT * FROM alerts WHERE id != ? AND timestamp >= now() - interval '3 days' ORDER BY timestamp DESC LIMIT 50`
      ).all(alertId);
      await db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('ANALYZING', alertId);
      io.emit('alert_updated', { id: alertId, status: 'ANALYZING' });
      const update = await runOrchestration(alert, recentAlerts, { modelAssignments: await getAgentModelAssignments() });
      if (update.status === 'FALSE_POSITIVE' && update.fp_method) {
        await db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=?, fp_method=?, fp_reason=?, fp_confidence=?, filtered_at=now(), last_error=NULL, last_error_at=NULL WHERE id=?`)
          .run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, update.fp_method, update.fp_reason, update.fp_confidence ?? 0, alertId);
      } else {
        await db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=?, last_error=NULL, last_error_at=NULL WHERE id=?`)
          .run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, alertId);
      }
      await db.prepare('INSERT INTO agent_runs (alert_id, ai_analysis, mitre_attack, remediation_steps, status) VALUES (?, ?, ?, ?, ?)')
        .run(alertId, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.status);
      try {
        const parsed = JSON.parse(update.ai_analysis || '{}');
        const ticket = parsed?.ticket || parsed?.phaseData?.ticket;
        if (ticket && update.status !== 'FALSE_POSITIVE') await dispatchActions({ alertId, ticket, db, io });
      } catch {}
      io.emit('alert_updated', { id: alertId, ...update });
    } catch (err: any) {
      console.error('[Auto-Orchestrate]', err?.message);
      await db.prepare('UPDATE alerts SET status = ?, last_error = ?, last_error_at = now() WHERE id = ?')
        .run('NEW', (err?.message || 'Orchestration failed').slice(0, 500), alertId);
      io.emit('alert_updated', { id: alertId, status: 'NEW', last_error: (err?.message || 'Orchestration failed').slice(0, 500) });
    }
  }

  app.post('/api/ingest', async (req, res) => {
    try {
      // Load Wazuh filter config (independent of auth)
      const wRow = await db.prepare("SELECT config FROM integrations WHERE name='wazuh'").get() as any;
      const wcfg = JSON.parse(wRow?.config || '{}');

      // API key auth — check X-Api-Key or Authorization: Bearer header against api_keys table
      const authHeader  = (req.headers['authorization'] as string) || '';
      const apiKeyHeader = (req.headers['x-api-key'] as string) || '';
      const provided     = apiKeyHeader || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '');

      if (!provided) {
        return res.status(401).json({ error: 'API key required. Set X-Api-Key or Authorization: Bearer header.' });
      }
      const keyHash = crypto.createHash('sha256').update(provided).digest('hex');
      const keyRow  = await db.prepare("SELECT id, name, paused, min_severity_override FROM api_keys WHERE key_hash=? AND revoked=0 LIMIT 1").get(keyHash) as any;
      if (!keyRow) {
        return res.status(401).json({ error: 'Invalid or revoked API key.' });
      }
      if (keyRow.paused) {
        return res.status(403).json({ status: 'paused', error: 'Alert ingestion is paused for this API key.' });
      }
      if (wcfg.ingest_enabled === 'false') {
        return res.status(503).json({ status: 'paused', error: 'Global alert ingestion is currently paused.' });
      }
      await db.prepare("UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?").run(keyRow.id);

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
      const dup = await db.prepare(
        `SELECT id FROM alerts WHERE rule_id = ? AND source_ip = ? AND timestamp >= now() - interval '${dedupMin} minutes' LIMIT 1`
      ).get(ruleId, sourceIp);
      if (dup) return res.json({ status: 'deduplicated', original_id: (dup as any).id });

      // Min severity filter — per-key override takes precedence over global setting.
      // Below-threshold alerts are inserted as FALSE_POSITIVE so they're auditable in the FP Archive,
      // but skip the AI pipeline (cheap noise — no agent run, no Telegram).
      const minSev = keyRow.min_severity_override != null
        ? Number(keyRow.min_severity_override)
        : Number(wcfg.min_severity ?? 0);
      const belowMinSeverity = severity < minSev;

      // Time window (HH:MM 24h) marks ACTIVE hours. An alert arriving OUTSIDE
      // active hours is NOT archived — off-hours is a higher-risk window (classic
      // attacker tradecraft), so it's flagged after_hours and risk-elevated by the
      // pipeline (priority floor + forced notification). See orchestrator finalize.
      let outsideTimeWindow = false;
      if (wcfg.time_window_start && wcfg.time_window_end) {
        const now  = new Date();
        const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (hhmm < wcfg.time_window_start || hhmm > wcfg.time_window_end) outsideTimeWindow = true;
      }

      // Only the severity floor still auto-archives at ingest. Time-of-day never does.
      const autoFp = belowMinSeverity;
      const fpMethod = belowMinSeverity ? 'severity_filter' : null;
      const fpReason = belowMinSeverity ? `Severity ${severity} below threshold ${minSev}` : null;

      await db.prepare(`INSERT INTO alerts (id, rule_id, description, severity, source_ip, dest_ip, "user", hostname, agent_name, full_log, after_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
          outsideTimeWindow ? 1 : 0,
        );

      if (autoFp) {
        await db.prepare(
          `UPDATE alerts SET status='FALSE_POSITIVE', fp_method=?, fp_reason=?, fp_confidence=1.0, filtered_at=now() WHERE id=?`
        ).run(fpMethod, fpReason, id);
      }

      io.emit('new_alert', { id });

      // Auto-orchestrate (fire-and-forget) — runs for off-hours alerts too; only
      // severity-floored noise is skipped.
      if (!autoFp && wcfg.auto_orchestrate !== 'false') {
        setImmediate(() => triggerOrchestration(id));
      }

      res.json({ status: autoFp ? 'archived_fp' : (outsideTimeWindow ? 'ok_after_hours' : 'ok'), id, fp_reason: fpReason });
    } catch (err) {
      console.error('Ingestion error:', err);
      res.status(500).json({ error: 'Failed to ingest alert' });
    }
  });

  // ── API Key management ───────────────────────────────────────────────────
  app.get('/api/api-keys', authenticate, requireAdmin, async (_req, res) => {
    const rows = await db.prepare(
      'SELECT id, name, key_prefix, created_at, last_used_at, revoked, paused, min_severity_override FROM api_keys ORDER BY created_at DESC'
    ).all();
    res.json(rows);
  });

  app.post('/api/api-keys', authenticate, requireAdmin, async (req: any, res) => {
    const { name } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const raw     = 'sk_aisoc_' + crypto.randomBytes(24).toString('hex');
    const keyHash = crypto.createHash('sha256').update(raw).digest('hex');
    const prefix  = raw.slice(0, 17) + '…';
    await db.prepare('INSERT INTO api_keys (name, key_hash, key_prefix, created_by) VALUES (?, ?, ?, ?)')
      .run(name.trim(), keyHash, prefix, req.user.id);
    writeAudit(req.user.id, 'API_KEY_CREATED', `API key "${name}" created`);
    res.json({ ok: true, key: raw, prefix });
  });

  app.delete('/api/api-keys/:id', authenticate, requireAdmin, async (req: any, res) => {
    const { id } = req.params;
    await db.prepare('UPDATE api_keys SET revoked=1 WHERE id=?').run(id);
    writeAudit(req.user.id, 'API_KEY_REVOKED', `API key id=${id} revoked`);
    res.json({ ok: true });
  });

  app.patch('/api/api-keys/:id', authenticate, requireAdmin, async (req: any, res) => {
    const { id } = req.params;
    const { paused, min_severity_override } = req.body || {};
    if (paused !== undefined)
      await db.prepare('UPDATE api_keys SET paused=? WHERE id=?').run(paused ? 1 : 0, id);
    if (min_severity_override !== undefined)
      await db.prepare('UPDATE api_keys SET min_severity_override=? WHERE id=?').run(
        min_severity_override === null ? null : Number(min_severity_override), id
      );
    writeAudit(req.user.id, 'API_KEY_UPDATED', `API key id=${id} config updated`);
    res.json({ ok: true });
  });

  // ── AI model settings ─────────────────────────────────────────────────────
  app.get('/api/ai/models', authenticate, async (_req, res) => {
    const assignments  = await getAgentModelAssignments();
    const localUrl     = (await db.prepare("SELECT value FROM local_llm_config WHERE key='url'").get() as any)?.value || 'http://localhost:11434';
    const localEnabled = (await db.prepare("SELECT value FROM local_llm_config WHERE key='enabled'").get() as any)?.value === '1';

    let localModels: Array<{ name: string; size: number; modified_at: string }> = [];
    if (localEnabled) {
      try {
        const tagsRes = await ollamaFetch(localUrl, '/api/tags');
        if (tagsRes.ok) localModels = (tagsRes.data?.models || []).map((m: any) => ({ name: m.name, size: m.size || 0, modified_at: m.modified_at || '' }));
      } catch {}
    }

    // Expose every enabled provider's curated model list so the per-agent
    // dropdown can show options across providers. Each entry carries a
    // provider-pinned model id (e.g. "anthropic::claude-sonnet-4-6") that the
    // resolver in client.ts will route to the right kind.
    const providers = await listProviders(db, { includeDisabled: false });
    const externalGroups = providers.map(p => {
      const catalog = PROVIDER_MODEL_CATALOG[p.kind as ProviderKind] || [];
      return {
        providerId: p.id,
        providerName: p.name,
        kind: p.kind,
        models: catalog.map(m => ({ id: `${p.kind}::${m.id}`, raw: m.id, label: m.label })),
      };
    });

    res.json({
      agents:          AGENT_PHASES.map(phase => ({ phase, ...AGENT_METADATA[phase] })),
      defaults:        DEFAULT_AGENT_MODELS,
      assignments,
      // Source the OpenRouter dropdown from the editable catalog (includes paid
      // models like DeepSeek/Kimi), not just the legacy free-tier list.
      availableModels: PROVIDER_MODEL_CATALOG.openrouter.map(m => m.id),
      modelLabels:     Object.fromEntries(PROVIDER_MODEL_CATALOG.openrouter.map(m => [m.id, m.label])),
      providerGroups:  externalGroups,
      localConfig:     { url: localUrl, enabled: localEnabled },
      localModels,
    });
  });

  app.patch('/api/ai/models/:phase', authenticate, requireAdmin, requireStepUp, async (req: any, res) => {
    const { phase } = req.params;
    const { model } = req.body || {};
    if (!isAgentPhase(phase)) return res.status(400).json({ error: 'Invalid phase' });
    if (typeof model !== 'string' || model.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid model selection' });
    }

    // Accept three classes:
    //  1. local::<name>                 (Ollama)
    //  2. <providerKind>::<model>       (anthropic, openai, gemini, custom, openrouter)
    //  3. bare OpenRouter free-tier id  (legacy compat)
    const isLocal      = model.startsWith('local::');
    const isOpenRouter = OPENROUTER_FREE_MODELS.includes(model as any) || PROVIDER_MODEL_CATALOG.openrouter.some(m => m.id === model);
    const idx = model.indexOf('::');
    const validKinds = ['openrouter','openai','anthropic','gemini','custom'];
    const isPrefixed = idx > 0 && (validKinds.includes(model.slice(0, idx)) || /^\d+$/.test(model.slice(0, idx)));
    if (!isLocal && !isOpenRouter && !isPrefixed) {
      return res.status(400).json({ error: 'Invalid model id — expected local::, <provider>::<model>, or a known OpenRouter model' });
    }

    const previous: any = await db.prepare('SELECT model FROM agent_settings WHERE phase = ?').get(phase);
    await db.prepare(`INSERT INTO agent_settings (phase, model) VALUES (?, ?) ON CONFLICT(phase) DO UPDATE SET model=excluded.model`).run(phase, model);
    writeAudit(req.user?.id, 'AI_MODEL_CHANGED', `Phase '${phase}': ${previous?.model || '(default)'} → ${model} [step-up verified]`);
    res.json({ phase, model, assignments: await getAgentModelAssignments() });
  });

  // ── Local LLM (Ollama) config ────────────────────────────────────────────
  app.get('/api/local-llm/config', authenticate, async (_req, res) => {
    const url            = (await db.prepare("SELECT value FROM local_llm_config WHERE key='url'").get() as any)?.value || 'http://localhost:11434';
    const enabled        = (await db.prepare("SELECT value FROM local_llm_config WHERE key='enabled'").get() as any)?.value === '1';
    const fallback_model = (await db.prepare("SELECT value FROM local_llm_config WHERE key='fallback_model'").get() as any)?.value || '';
    res.json({ url, enabled, fallback_model });
  });

  // Operator-readable LLM health: lets any authenticated user see whether the
  // AI layer is reachable (provider up/down) before/after running agents. Reads
  // the cached registry + the last admin test result — no live LLM calls.
  app.get('/api/ai/health', authenticate, async (_req, res) => {
    const rows = await listProviders(db, { includeDisabled: true });
    const providers = rows.map(p => ({
      id:              p.id,
      name:            p.name,
      kind:            p.kind,
      enabled:         p.enabled === 1,
      last_test_ok:    p.last_test_ok,      // 1 | 0 | null (untested)
      last_test_error: p.last_test_error,
      last_test_at:    p.last_test_at,
    }));
    const enabledProviders = providers.filter(p => p.enabled);
    const localEnabled = (await db.prepare("SELECT value FROM local_llm_config WHERE key='enabled'").get() as any)?.value === '1';
    const localModel   = (await db.prepare("SELECT value FROM local_llm_config WHERE key='fallback_model'").get() as any)?.value || '';
    // Healthy if a provider tested OK (or local fallback is on). Down only when
    // every enabled provider was last tested and failed. Untested → unknown.
    const anyOk        = enabledProviders.some(p => p.last_test_ok === 1) || (localEnabled && !!localModel);
    const anyConfigured = enabledProviders.length > 0 || (localEnabled && !!localModel);
    const allTestedFailing = enabledProviders.length > 0 && enabledProviders.every(p => p.last_test_ok === 0);
    res.json({
      providers,
      local: { enabled: localEnabled, model: localModel },
      anyOk,
      anyConfigured,
      down: allTestedFailing && !anyOk,
    });
  });

  app.patch('/api/local-llm/config', authenticate, requireAdmin, requireStepUp, async (req: any, res) => {
    const { url, enabled, fallback_model } = req.body;
    const upd = await db.prepare('INSERT INTO local_llm_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    const changes: string[] = [];
    if (url             !== undefined) { await upd.run('url',             String(url));                 setLocalLLMBaseUrl(String(url)); changes.push(`url=${url}`); }
    if (enabled         !== undefined) { await upd.run('enabled',         enabled ? '1' : '0');         changes.push(`enabled=${enabled}`); }
    if (fallback_model  !== undefined) { await upd.run('fallback_model',  String(fallback_model));      changes.push(`fallback_model=${fallback_model}`); }
    // Re-push the (possibly changed) fallback config to the LLM module
    const curEnabled  = (await db.prepare("SELECT value FROM local_llm_config WHERE key='enabled'").get() as any)?.value === '1';
    const curFallback = (await db.prepare("SELECT value FROM local_llm_config WHERE key='fallback_model'").get() as any)?.value || '';
    setLocalLLMFallback(curEnabled, curFallback);
    writeAudit(req.user?.id, 'LOCAL_LLM_CONFIG', `Local LLM config updated: ${changes.join(', ')} [step-up verified]`);
    res.json({ ok: true });
  });

  app.get('/api/local-llm/models', authenticate, async (_req, res) => {
    const url = (await db.prepare("SELECT value FROM local_llm_config WHERE key='url'").get() as any)?.value || 'http://localhost:11434';
    const result = await ollamaFetch(url, '/api/tags');
    if (!result.ok) return res.json({ models: [], error: result.error });
    const models = (result.data?.models || []).map((m: any) => ({ name: m.name, size: m.size || 0, modified_at: m.modified_at || '' }));
    res.json({ models });
  });

  app.post('/api/local-llm/test', authenticate, requireAdmin, async (_req, res) => {
    const url    = (await db.prepare("SELECT value FROM local_llm_config WHERE key='url'").get() as any)?.value || 'http://localhost:11434';
    const result = await ollamaFetch(url, '/api/tags');
    if (!result.ok) return res.json({ ok: false, error: result.error });
    const count = result.data?.models?.length ?? 0;
    res.json({ ok: true, model_count: count, message: `Connected — ${count} model${count === 1 ? '' : 's'} available` });
  });

  // ── LLM provider registry (multi-provider configuration) ─────────────────
  // GET returns providers with their API keys masked. The full key is only
  // ever returned to the admin once (in the create response, if they didn't
  // supply one — currently they always supply it). All writes are audited
  // and step-up gated because a stolen key is a high-blast-radius event.
  app.get('/api/admin/llm-providers', authenticate, requireAdmin, async (_req, res) => {
    const rows = await listProviders(db, { includeDisabled: true });
    res.json({
      providers: rows.map(publicShape),
      kinds: Object.entries(PROVIDER_KIND_DEFAULTS).map(([id, v]) => ({ id, label: v.label, base_url: v.base_url })),
      catalog: PROVIDER_MODEL_CATALOG,
    });
  });

  app.post('/api/admin/llm-providers', authenticate, requireAdmin, requireStepUp, async (req: any, res) => {
    const { name, kind, base_url, api_key, priority, headers_json, enabled } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
    if (!kind || !(kind in PROVIDER_KIND_DEFAULTS)) return res.status(400).json({ error: 'Invalid kind' });
    if (!api_key || typeof api_key !== 'string') return res.status(400).json({ error: 'api_key required' });
    const url = (base_url && String(base_url).trim()) || PROVIDER_KIND_DEFAULTS[kind as ProviderKind].base_url;
    if (!url) return res.status(400).json({ error: 'base_url required for custom kind' });
    const r = await db.prepare(
      'INSERT INTO llm_providers (name, kind, base_url, api_key, enabled, priority, headers_json) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id'
    ).run(
      name.trim(),
      kind,
      url,
      api_key,
      enabled === false ? 0 : 1,
      Number.isFinite(priority) ? Number(priority) : 100,
      headers_json ? String(headers_json) : null,
    );
    await refreshProviderCache(db);
    clearClientCache();
    writeAudit(req.user.id, 'LLM_PROVIDER_CREATED', `Added ${kind} provider "${name}" (id=${r.lastInsertRowid})`);
    const created = await getProvider(db, Number(r.lastInsertRowid));
    res.json(created ? publicShape(created) : { ok: true });
  });

  app.patch('/api/admin/llm-providers/:id', authenticate, requireAdmin, requireStepUp, async (req: any, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const existing = await getProvider(db, id);
    if (!existing) return res.status(404).json({ error: 'Provider not found' });

    const updates: string[] = [];
    const values: any[] = [];
    const changes: string[] = [];

    const set = (col: string, val: any, label: string) => {
      updates.push(`${col} = ?`);
      values.push(val);
      changes.push(label);
    };

    if (typeof req.body?.name === 'string' && req.body.name.trim() !== existing.name) {
      set('name', req.body.name.trim(), `name → ${req.body.name.trim()}`);
    }
    if (typeof req.body?.kind === 'string' && req.body.kind !== existing.kind) {
      if (!(req.body.kind in PROVIDER_KIND_DEFAULTS)) return res.status(400).json({ error: 'Invalid kind' });
      set('kind', req.body.kind, `kind → ${req.body.kind}`);
    }
    if (typeof req.body?.base_url === 'string' && req.body.base_url !== existing.base_url) {
      set('base_url', req.body.base_url, `base_url updated`);
    }
    if (typeof req.body?.api_key === 'string' && req.body.api_key.length > 0 && req.body.api_key !== existing.api_key) {
      set('api_key', req.body.api_key, `api_key rotated`);
    }
    if (req.body?.enabled !== undefined) {
      const v = req.body.enabled ? 1 : 0;
      if (v !== existing.enabled) set('enabled', v, `enabled → ${v ? 'yes' : 'no'}`);
    }
    if (req.body?.priority !== undefined && Number(req.body.priority) !== existing.priority) {
      set('priority', Number(req.body.priority), `priority → ${req.body.priority}`);
    }
    if (req.body?.headers_json !== undefined && (req.body.headers_json || null) !== existing.headers_json) {
      set('headers_json', req.body.headers_json || null, `headers updated`);
    }

    if (updates.length === 0) return res.json(publicShape(existing));

    updates.push("updated_at = now()");
    values.push(id);
    await db.prepare(`UPDATE llm_providers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    await refreshProviderCache(db);
    clearClientCache();
    writeAudit(req.user.id, 'LLM_PROVIDER_UPDATED', `Updated provider #${id} "${existing.name}" — ${changes.join('; ')}`);
    const updated = await getProvider(db, id);
    res.json(updated ? publicShape(updated) : { ok: true });
  });

  app.delete('/api/admin/llm-providers/:id', authenticate, requireAdmin, requireStepUp, async (req: any, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const existing = await getProvider(db, id);
    if (!existing) return res.status(404).json({ error: 'Provider not found' });
    await db.prepare('DELETE FROM llm_providers WHERE id = ?').run(id);
    await refreshProviderCache(db);
    clearClientCache();
    writeAudit(req.user.id, 'LLM_PROVIDER_DELETED', `Deleted provider #${id} "${existing.name}" (${existing.kind})`);
    res.json({ ok: true });
  });

  app.post('/api/admin/llm-providers/:id/test', authenticate, requireAdmin, async (req: any, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const provider = await getProvider(db, id);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });
    const supplied = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    const catalog = PROVIDER_MODEL_CATALOG[provider.kind as ProviderKind] || [];
    const probeModel = supplied || catalog[0]?.id || 'gpt-4o-mini';
    const result = await testProvider(provider, probeModel);
    await db.prepare(
      `UPDATE llm_providers SET last_test_at = now(), last_test_ok = ?, last_test_error = ? WHERE id = ?`
    ).run(result.ok ? 1 : 0, result.ok ? null : (result.error || 'unknown'), id);
    await refreshProviderCache(db);
    writeAudit(req.user.id, 'LLM_PROVIDER_TESTED', `Tested #${id} "${provider.name}" with ${probeModel} → ${result.ok ? 'ok' : 'failed: ' + result.error}`);
    res.json({ ...result, model: probeModel });
  });

  // ── Agent statistics ───────────────────────────────────────────────────────
  app.get('/api/ai/agent-stats', authenticate, async (_req, res) => {
    const phases = ['analysis','intel','knowledge','correlation','recall','ioc_check','ticketing','response','validation'];

    // Pull last 500 agent runs with AI data
    const runs = await db.prepare("SELECT ai_analysis FROM agent_runs WHERE ai_analysis IS NOT NULL ORDER BY run_at DESC LIMIT 500").all() as any[];

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
    const feedbackRows = await db.prepare(
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
  app.get('/api/memory/iocs', authenticate, async (req: any, res) => {
    const value = String(req.query.value || '').trim();
    if (!value) return res.status(400).json({ error: 'value query param required' });
    const row = await db.prepare(
      `SELECT value, type, first_seen, last_seen, alert_count, threat_level, notes FROM ioc_memory WHERE value = ?`
    ).get(value) as any;
    res.json(row ?? null);
  });

  // Recent IOC observations across all alerts (paged).
  app.get('/api/memory/iocs/recent', authenticate, async (req: any, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows  = await db.prepare(
      `SELECT value, type, first_seen, last_seen, alert_count, threat_level FROM ioc_memory ORDER BY last_seen DESC LIMIT ?`
    ).all(limit);
    res.json(rows);
  });

  // Recent insights (semantic memory rows) — for the analyst memory UI.
  app.get('/api/memory/insights/recent', authenticate, async (req: any, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const rows  = await db.prepare(
      `SELECT alert_id, summary, attack_pattern, threat_actor, outcome, ttp_tags, created_at
       FROM incident_insights ORDER BY created_at DESC LIMIT ?`
    ).all(limit);
    // Parse ttp_tags JSON for the client
    const parsed = (rows as any[]).map(r => ({ ...r, ttp_tags: safeParseJsonArray(r.ttp_tags) }));
    res.json(parsed);
  });

  // Browse all insights with search/filter/pagination (Knowledge Base).
  app.get('/api/memory/insights', authenticate, async (req: any, res) => {
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

    const total = (await db.prepare(`SELECT COUNT(*) as c FROM incident_insights ${whereSql}`).get(...params) as any).c;
    const rows  = await db.prepare(
      `SELECT alert_id, summary, attack_pattern, threat_actor, outcome, ttp_tags, triggered_by, created_at
       FROM incident_insights ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    const parsed = (rows as any[]).map(r => ({ ...r, ttp_tags: safeParseJsonArray(r.ttp_tags) }));
    res.json({ rows: parsed, total });
  });

  // Browse all IOCs with search/filter/pagination (Knowledge Base).
  app.get('/api/memory/iocs/all', authenticate, async (req: any, res) => {
    const q      = String(req.query.q || '').trim();
    const type   = String(req.query.type || '').trim();
    const limit  = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where: string[] = [];
    const params: any[]   = [];
    if (q)    { where.push('(value LIKE ? OR notes LIKE ?)'); const like = `%${q}%`; params.push(like, like); }
    if (type) { where.push('type = ?'); params.push(type); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (await db.prepare(`SELECT COUNT(*) as c FROM ioc_memory ${whereSql}`).get(...params) as any).c;
    const rows  = await db.prepare(
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
  app.get('/api/memory/working/:alertId', authenticate, async (req: any, res) => {
    const rows = await db.prepare(
      `SELECT step, trace_id, thought, action, result_summary, created_at
       FROM working_memory WHERE alert_id = ? ORDER BY created_at DESC, step DESC LIMIT 50`
    ).all(req.params.alertId);
    res.json(rows);
  });

  // ── Asset Context CRUD ─────────────────────────────────────────────────────

  app.get('/api/assets', authenticate, async (_req, res) => {
    const rows = await db.prepare(
      `SELECT value, type, role, description, fp_default, source, created_at, updated_at
       FROM asset_context ORDER BY updated_at DESC LIMIT 200`
    ).all();
    res.json(rows);
  });

  app.post('/api/assets', authenticate, requireAdmin, async (req: any, res) => {
    const { value, type, role, description, fp_default } = req.body;
    if (!value || !type || !role) return res.status(400).json({ error: 'value, type, and role are required' });
    await db.prepare(`
      INSERT INTO asset_context (value, type, role, description, fp_default, source, updated_at)
      VALUES (?, ?, ?, ?, ?, 'manual', CURRENT_TIMESTAMP)
      ON CONFLICT(value) DO UPDATE SET
        type = excluded.type, role = excluded.role, description = excluded.description,
        fp_default = excluded.fp_default, source = excluded.source, updated_at = CURRENT_TIMESTAMP
    `).run(value.trim(), type, role, description || null, fp_default ? 1 : 0);
    writeAudit(req.user.id, 'ASSET_UPSERT', `Asset ${value} (${type}/${role}) fp_default=${fp_default ? 1 : 0}`);
    res.json({ ok: true });
  });

  app.delete('/api/assets/:value', authenticate, requireAdmin, async (req: any, res) => {
    const r = await db.prepare(`DELETE FROM asset_context WHERE value = ?`).run(req.params.value);
    if (r.changes > 0) writeAudit(req.user.id, 'ASSET_DELETE', `Asset ${req.params.value} removed`);
    res.json({ ok: true, deleted: r.changes > 0 });
  });

  // ── Suppression Rules CRUD ────────────────────────────────────────────────

  app.get('/api/suppression-rules', authenticate, async (_req, res) => {
    const rows = await db.prepare(
      `SELECT * FROM suppression_rules ORDER BY hit_count DESC, created_at DESC`
    ).all();
    res.json(rows);
  });

  app.post('/api/suppression-rules', authenticate, requireAdmin, async (req: any, res) => {
    const { name, source_ip_pattern, agent_name_pattern, rule_id_pattern, description_pattern,
            min_severity, max_severity, reason, enabled } = req.body;
    if (!name || !reason) return res.status(400).json({ error: 'name and reason are required' });
    const result = await db.prepare(`
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

  app.patch('/api/suppression-rules/:id', authenticate, requireAdmin, async (req: any, res) => {
    const rule = await db.prepare(`SELECT * FROM suppression_rules WHERE id = ?`).get(Number(req.params.id)) as any;
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    const u = req.body;
    await db.prepare(`
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

  app.delete('/api/suppression-rules/:id', authenticate, requireAdmin, async (req: any, res) => {
    const r = await db.prepare(`DELETE FROM suppression_rules WHERE id = ?`).run(Number(req.params.id));
    if (r.changes > 0) writeAudit(req.user.id, 'SUPPRESSION_DELETE', `Rule #${req.params.id} deleted`);
    res.json({ ok: true, deleted: r.changes > 0 });
  });

  // ── Analytics: FP Reduction ───────────────────────────────────────────────

  app.get('/api/analytics/fp-reduction', authenticate, async (_req, res) => {
    const total = (await db.prepare(`SELECT COUNT(*) as c FROM alerts`).get() as any).c;
    const analyzed = (await db.prepare(
      `SELECT COUNT(*) as c FROM alerts WHERE status IN ('TRIAGED','FALSE_POSITIVE','ESCALATED','CLOSED')`
    ).get() as any).c;
    const totalFp = (await db.prepare(
      `SELECT COUNT(*) as c FROM alerts WHERE status = 'FALSE_POSITIVE'`
    ).get() as any).c;

    // Break down FPs by triggered_by from incident_insights
    const fpByTrigger = await db.prepare(`
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
    const fpAlerts = await db.prepare(
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
    const suppressionStats = await db.prepare(
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

  app.get('/api/analytics/fp-over-time', authenticate, async (_req, res) => {
    // FPs per day for last 30 days, broken down by trigger
    const rows = await db.prepare(`
      SELECT
        DATE(created_at) as day,
        COUNT(*) as total_fp,
        SUM(CASE WHEN triggered_by = 'memoryFP' THEN 1 ELSE 0 END) as memory_fp,
        SUM(CASE WHEN triggered_by = 'triage' THEN 1 ELSE 0 END) as triage_fp,
        SUM(CASE WHEN triggered_by = 'suppression' THEN 1 ELSE 0 END) as suppression_fp,
        SUM(CASE WHEN triggered_by = 'composer' THEN 1 ELSE 0 END) as composer_fp
      FROM incident_insights
      WHERE outcome = 'FALSE_POSITIVE'
        AND created_at >= current_date - interval '30 days'
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `).all();

    // Also get total alerts per day
    const alertRows = await db.prepare(`
      SELECT DATE(timestamp) as day, COUNT(*) as total
      FROM alerts
      WHERE timestamp >= current_date - interval '30 days'
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

  app.get('/api/analytics/noisy-sources', authenticate, async (_req, res) => {
    // Top IPs/agents by FP count
    const ipRows = await db.prepare(`
      SELECT source_ip as source, 'ip' as source_type,
             COUNT(*) as total_alerts,
             SUM(CASE WHEN status = 'FALSE_POSITIVE' THEN 1 ELSE 0 END) as fp_count
      FROM alerts
      WHERE source_ip IS NOT NULL AND source_ip != ''
      GROUP BY source_ip
      HAVING COUNT(*) >= 2
      ORDER BY fp_count DESC
      LIMIT 20
    `).all() as Array<{ source: string; source_type: string; total_alerts: number; fp_count: number }>;

    const agentRows = await db.prepare(`
      SELECT agent_name as source, 'agent' as source_type,
             COUNT(*) as total_alerts,
             SUM(CASE WHEN status = 'FALSE_POSITIVE' THEN 1 ELSE 0 END) as fp_count
      FROM alerts
      WHERE agent_name IS NOT NULL AND agent_name != ''
      GROUP BY agent_name
      HAVING COUNT(*) >= 2
      ORDER BY fp_count DESC
      LIMIT 20
    `).all() as Array<{ source: string; source_type: string; total_alerts: number; fp_count: number }>;

    // Lookup asset_context for role info
    const enriched = (await Promise.all([...ipRows, ...agentRows].map(async r => {
      const asset = await db.prepare(
        `SELECT role, fp_default FROM asset_context WHERE value = ?`
      ).get(r.source) as any;
      return {
        ...r,
        fp_rate: r.total_alerts > 0 ? Number((r.fp_count / r.total_alerts).toFixed(3)) : 0,
        role: asset?.role || null,
        is_registered: !!asset,
        fp_default: asset?.fp_default === 1,
      };
    }))).sort((a, b) => b.fp_count - a.fp_count);

    res.json(enriched);
  });

  // ── Auto-Learning ─────────────────────────────────────────────────────────

  app.get('/api/analytics/fp-suggestions', authenticate, async (_req, res) => {
    // Find IOCs that are overwhelmingly FP
    const rows = await db.prepare(`
      SELECT value, type,
             COALESCE(fp_count, 0) as fp_count,
             COALESCE(tp_count, 0) as tp_count
      FROM ioc_memory
      WHERE COALESCE(fp_count, 0) + COALESCE(tp_count, 0) >= 5
    `).all() as Array<{ value: string; type: string; fp_count: number; tp_count: number }>;

    const suggestions = (await Promise.all(rows.map(async r => {
      const total = r.fp_count + r.tp_count;
      const fp_ratio = total > 0 ? r.fp_count / total : 0;
      if (fp_ratio < 0.85) return null;
      const existing = await db.prepare(`SELECT value FROM asset_context WHERE value = ?`).get(r.value);
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
    }))).filter(Boolean).sort((a: any, b: any) => b.fp_ratio - a.fp_ratio);

    res.json(suggestions);
  });

  app.post('/api/analytics/accept-suggestion', authenticate, requireAdmin, async (req: any, res) => {
    const { value, type } = req.body;
    if (!value) return res.status(400).json({ error: 'value is required' });
    await db.prepare(`
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
      const alert: any = await db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
      if (!alert) return res.status(404).json({ error: 'Alert not found' });

      const recentAlerts = await db.prepare(
        `SELECT * FROM alerts WHERE id != ? AND timestamp >= now() - interval '3 days' ORDER BY timestamp DESC LIMIT 50`
      ).all(alertId);

      await db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('ANALYZING', alertId);
      io.emit('alert_updated', { id: alertId, status: 'ANALYZING' });

      const result = await runFpScan(alert, recentAlerts, { modelAssignments: await getAgentModelAssignments() });

      // Update alert with FP scan results
      await db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, fp_method=?, fp_confidence=?, fp_reason=?, fp_details=?, triage_data=?, filtered_at=now(), last_error=NULL, last_error_at=NULL WHERE id=?`)
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
      const reason = (err?.message || 'FP scan failed').slice(0, 500);
      await db.prepare('UPDATE alerts SET status = ?, last_error = ?, last_error_at = now() WHERE id = ?').run('NEW', reason, alertId);
      io.emit('alert_updated', { id: alertId, status: 'NEW', last_error: reason });
      res.status(500).json({ error: reason });
    }
  });

  // ── FP Scan Batch: scan all NEW alerts ──────────────────────────────────
  // "Scan All" — runs the FULL defense-in-depth pipeline on every NEW alert.
  // Each alert exits this loop with a final verdict: FALSE_POSITIVE → FP archive
  // OR TRIAGED/ESCALATED → Investigation tab (with notifications dispatched).
  app.post('/api/ai/fp-scan-batch', authenticate, async (req: any, res) => {
    try {
      const newAlerts = await db.prepare("SELECT * FROM alerts WHERE status = 'NEW' ORDER BY timestamp DESC LIMIT 50").all() as any[];
      if (newAlerts.length === 0) return res.json({ scanned: 0, results: [] });

      const recentAlerts = await db.prepare(
        `SELECT * FROM alerts WHERE timestamp >= now() - interval '3 days' ORDER BY timestamp DESC LIMIT 50`
      ).all();

      const results: any[] = [];
      for (const alert of newAlerts) {
        try {
          await db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('ANALYZING', alert.id);
          io.emit('alert_updated', { id: alert.id, status: 'ANALYZING' });

          const update = await runOrchestration(alert, recentAlerts.filter((a: any) => a.id !== alert.id), { modelAssignments: await getAgentModelAssignments() });

          if (update.status === 'FALSE_POSITIVE' && update.fp_method) {
            await db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=?, fp_method=?, fp_reason=?, fp_confidence=?, filtered_at=now() WHERE id=?`)
              .run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, update.fp_method, update.fp_reason, update.fp_confidence ?? 0, alert.id);
          } else {
            await db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=? WHERE id=?`)
              .run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, alert.id);
          }
          await db.prepare('INSERT INTO agent_runs (alert_id, ai_analysis, mitre_attack, remediation_steps, status) VALUES (?, ?, ?, ?, ?)')
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
          await db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('NEW', alert.id);
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
      const alert: any = await db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
      if (!alert) return res.status(404).json({ error: 'Alert not found' });

      // Parse existing triage data from FP scan
      let triage: any = null;
      if (alert.triage_data) {
        try { triage = JSON.parse(alert.triage_data); } catch {}
      }
      if (!triage && alert.ai_analysis) {
        try { triage = JSON.parse(alert.ai_analysis)?.phaseData?.analysis; } catch {}
      }

      const recentAlerts = await db.prepare(
        `SELECT * FROM alerts WHERE id != ? AND timestamp >= now() - interval '3 days' ORDER BY timestamp DESC LIMIT 50`
      ).all(alertId);

      await db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('ANALYZING', alertId);
      io.emit('alert_updated', { id: alertId, status: 'ANALYZING' });

      let update;
      if (triage) {
        // Use the split investigation path (skips triage)
        update = await runInvestigation(alert, triage, recentAlerts, { modelAssignments: await getAgentModelAssignments() });
      } else {
        // No triage data — fall back to full orchestration
        update = await runOrchestration(alert, recentAlerts, { modelAssignments: await getAgentModelAssignments() });
      }

      if (update.status === 'FALSE_POSITIVE' && update.fp_method) {
        await db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=?, fp_method=?, fp_reason=?, fp_confidence=?, filtered_at=now(), investigated_at=now(), last_error=NULL, last_error_at=NULL WHERE id=?`)
          .run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, update.fp_method, update.fp_reason, update.fp_confidence ?? 0, alertId);
      } else {
        await db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=?, investigated_at=now(), last_error=NULL, last_error_at=NULL WHERE id=?`)
          .run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, alertId);
      }

      await db.prepare('INSERT INTO agent_runs (alert_id, ai_analysis, mitre_attack, remediation_steps, status) VALUES (?, ?, ?, ?, ?)')
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
      const reason = (err?.message || 'Investigation failed').slice(0, 500);
      await db.prepare("UPDATE alerts SET status = 'FILTERED', last_error = ?, last_error_at = now() WHERE id = ?").run(reason, alertId);
      io.emit('alert_updated', { id: alertId, status: 'FILTERED', last_error: reason });
      res.status(500).json({ error: reason });
    }
  });

  // ── FP Archive: paginated FP alerts with enriched data ───────────────────
  app.get('/api/alerts/fp-archive', authenticate, async (req: any, res) => {
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

    const total = (await db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE ${whereClause}`).get(...params) as any).c;
    const rows  = await db.prepare(
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

  // Single alert — used by the detail view's "Refresh" to re-pull persisted
  // state (status, ai_analysis, last_error) without a full page reload.
  // NOTE: registered *after* the literal /api/alerts/* routes (e.g. fp-archive)
  // so the ":id" wildcard doesn't shadow them.
  app.get('/api/alerts/:id', authenticate, async (req: any, res) => {
    const row = await db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Alert not found' });
    res.json(row);
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
    forceNew?:   boolean;   // bypass dedup and always open a fresh incident
  }): Promise<{ id: string; glpi_ticket_id: string | null; grouped?: boolean }> {
    const alert: any = await db.prepare('SELECT * FROM alerts WHERE id = ?').get(args.alertId);
    if (!alert) throw new Error('Alert not found');

    // ── Deduplication / correlation ──────────────────────────────────────────
    // A noisy detection (e.g. a bot POST-flood firing the same Wazuh rule from the
    // same source dozens of times) used to produce one incident per alert. Instead,
    // group those alerts into a single still-active "campaign" incident via the
    // incident_alerts junction (many alerts → one incident). Match on same rule +
    // same source within a recent window; resolved/closed incidents don't absorb
    // new alerts (a fresh wave after closure opens a new incident).
    // Only auto-group when there's a concrete rule + source to match on; without
    // both we open a fresh incident rather than risk merging unrelated events.
    if (!args.forceNew && alert.rule_id && alert.source_ip) {
      const dupe: any = await db.prepare(`
        SELECT i.id
        FROM incidents i
        JOIN incident_alerts ia ON ia.incident_id = i.id
        JOIN alerts a ON a.id = ia.alert_id
        WHERE i.status NOT IN ('RESOLVED', 'CLOSED', 'RECLASSIFIED_FP')
          AND a.rule_id   = ?
          AND a.source_ip = ?
          AND i.created_at >= now() - interval '24 hours'
        ORDER BY i.created_at DESC
        LIMIT 1
      `).get(alert.rule_id, alert.source_ip);
      if (dupe?.id) {
        await db.prepare('INSERT INTO incident_alerts (incident_id, alert_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(dupe.id, args.alertId);
        await db.prepare("UPDATE alerts SET status = 'ESCALATED', escalated_at = now() WHERE id = ?").run(args.alertId);
        await db.prepare('UPDATE incidents SET updated_at = now() WHERE id = ?').run(dupe.id);
        await db.prepare(
          `INSERT INTO incident_timeline (incident_id, event_type, user_id, note)
           VALUES (?, 'alert_grouped', ?, ?)`
        ).run(dupe.id, args.user_id ?? null,
          `Grouped alert ${args.alertId} (rule ${alert.rule_id ?? '—'} · source ${alert.source_ip ?? '—'}) into this incident — same campaign`);
        io.emit('alert_updated', { id: args.alertId, status: 'ESCALATED' });
        io.emit('incident_updated', { id: dupe.id });
        return { id: dupe.id, glpi_ticket_id: null, grouped: true };
      }
    }

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
    await db.prepare(
      `INSERT INTO incidents (id, title, severity, status, phase, assigned_to, escalated_by, escalated_at, analysis, action_plan, reason, report_body)
       VALUES (?, ?, ?, ?, ?, ?, ?, now(), ?, ?, ?, ?)`
    ).run(incId, title, priority || 'HIGH', status, phase, args.assigned_to ?? null, args.user_id ?? null, analysis, actionPlan, args.note || null, reportBody);

    await db.prepare('INSERT INTO incident_alerts (incident_id, alert_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(incId, args.alertId);
    await db.prepare("UPDATE alerts SET status = 'ESCALATED', escalated_at = now() WHERE id = ?").run(args.alertId);

    // Seed incident_actions from the agent's response.actions.
    // Every row is normalised + validated; actions that would render as "BLOCK_IP → unknown"
    // (target-required type with no extractable target) are dropped on the floor.
    try {
      const parsed = JSON.parse(alert.ai_analysis || '{}');
      const planActions: any[] = parsed?.response?.actions || parsed?.phaseData?.response?.actions || [];
      const insAction = await db.prepare(
        `INSERT INTO incident_actions (incident_id, action_type, target, priority, status, source, description, order_index)
         VALUES (?, ?, ?, ?, 'pending', 'ai', ?, ?)`
      );
      const alertCtx = {
        source_ip:  alert.source_ip  || null,
        dest_ip:    alert.dest_ip    || null,
        user:       alert.user       || null,
        agent_name: alert.agent_name || null,
      };
      let orderIdx = 0;
      for (const a of (Array.isArray(planActions) ? planActions : [])) {
        const row = normaliseSeedAction(a, alertCtx, priority || 'MEDIUM');
        if (!row) continue;
        insAction.run(incId, row.action_type, row.target, row.priority, row.description, orderIdx++);
      }
    } catch { /* malformed action_plan — skip seeding */ }

    await db.prepare(
      `INSERT INTO incident_timeline (incident_id, event_type, phase_to, status_to, user_id, note)
       VALUES (?, 'created', ?, ?, ?, ?)`
    ).run(incId, phase, status, args.user_id ?? null, args.note || null);

    if (args.assigned_to) {
      await db.prepare(
        `INSERT INTO incident_timeline (incident_id, event_type, user_id, note)
         VALUES (?, 'assigned', ?, ?)`
      ).run(incId, args.user_id ?? null, `Assigned to user #${args.assigned_to}`);
    }

    let glpiTicketId: string | null = null;
    if (args.create_glpi && ticket) {
      try {
        ticket.priority = priority || 'HIGH';
        const before = (await db.prepare(`SELECT MAX(id) as m FROM action_logs WHERE alert_id=? AND integration='glpi'`).get(args.alertId) as any)?.m ?? 0;
        await dispatchActions({ alertId: args.alertId, ticket, db, io });
        const newRow = await db.prepare(`SELECT payload, status FROM action_logs WHERE alert_id=? AND integration='glpi' AND id > ? ORDER BY id DESC LIMIT 1`).get(args.alertId, before) as any;
        if (newRow?.status === 'success' && typeof newRow.payload === 'string') {
          const m = newRow.payload.match(/Ticket\s*#?(\d+)/i);
          if (m) glpiTicketId = m[1];
        }
        if (glpiTicketId) {
          await db.prepare('UPDATE incidents SET glpi_ticket_id = ? WHERE id = ?').run(glpiTicketId, incId);
        }
      } catch (err: any) { console.warn('[Incident GLPI dispatch] Error:', err?.message); }
    }

    io.emit('alert_updated', { id: args.alertId, status: 'ESCALATED' });
    io.emit('incident_created', { id: incId, title, severity: priority || 'HIGH', alertId: args.alertId });
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
      writeAudit(req.user?.id, r.grouped ? 'INCIDENT_ALERT_GROUPED' : 'INCIDENT_CREATED', `${r.grouped ? 'Grouped alert into' : 'Incident'} ${r.id} from alert ${alert_id}`);
      res.json({ ok: true, id: r.id, glpi_ticket_id: r.glpi_ticket_id, grouped: !!r.grouped });
    } catch (err: any) {
      console.error('[Incident create] Error:', err?.message);
      res.status(500).json({ error: err?.message || 'Failed to create incident' });
    }
  });

  app.get('/api/incidents', authenticate, async (req: any, res) => {
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

    const total = (await db.prepare(`SELECT COUNT(*) as c FROM incidents i ${whereSql}`).get(...params) as any).c;
    const rows  = (await db.prepare(`
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
    `).all(...params, limit, offset)).map((r: any) => {
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
    const statusCounts = await db.prepare(`
      SELECT status, COUNT(*) as c FROM incidents GROUP BY status
    `).all() as any[];
    const counts = { OPEN: 0, IN_PROGRESS: 0, CONTAINED: 0, RESOLVED: 0, CLOSED: 0, RECLASSIFIED_FP: 0 };
    for (const r of statusCounts) {
      if ((counts as any)[r.status] !== undefined) (counts as any)[r.status] = r.c;
    }
    res.json({ rows, total, counts });
  });

  app.get('/api/incidents/:id', authenticate, async (req: any, res) => {
    const { id } = req.params;
    const inc: any = await db.prepare(`
      SELECT i.*, u.username AS assigned_to_username, eu.username AS escalated_by_username
      FROM incidents i
      LEFT JOIN users u  ON u.id  = i.assigned_to
      LEFT JOIN users eu ON eu.id = i.escalated_by
      WHERE i.id = ?
    `).get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });

    inc.alerts = await db.prepare(`
      SELECT a.id, a.timestamp, a.rule_id, a.description, a.severity, a.source_ip, a.dest_ip,
             a."user", a.hostname, a.agent_name, a.status, a.ai_analysis, a.mitre_attack, a.full_log,
             a.last_error, a.last_error_at
      FROM alerts a
      INNER JOIN incident_alerts ia ON ia.alert_id = a.id
      WHERE ia.incident_id = ?
      ORDER BY a.timestamp DESC
    `).all(id);

    inc.timeline = await db.prepare(`
      SELECT t.*, u.username
      FROM incident_timeline t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.incident_id = ?
      ORDER BY t.created_at ASC, t.id ASC
    `).all(id);

    inc.actions = await db.prepare(`
      SELECT a.*, c.username AS created_by_username, e.username AS executed_by_username
      FROM incident_actions a
      LEFT JOIN users c ON c.id = a.created_by
      LEFT JOIN users e ON e.id = a.executed_by
      WHERE a.incident_id = ?
      ORDER BY a.order_index ASC, a.created_at ASC, a.id ASC
    `).all(id);

    res.json(inc);
  });

  // ── Reasoning timeline (Tier 1.2) ─────────────────────────────────────────
  // Returns the structured reasoning every agent emitted for an alert.
  // Used by the UI's "Reasoning timeline" panel: each card shows what one
  // agent decided, the evidence it weighed, and the alternatives it rejected.
  app.get('/api/alerts/:id/reasoning', authenticate, async (req: any, res) => {
    const { id } = req.params;
    try {
      const rows = await listReasoningForAlert(id);
      res.json({ alert_id: id, count: rows.length, reasoning: rows });
    } catch (err: any) {
      console.warn(`[Reasoning] fetch failed for ${id}:`, err?.message);
      res.status(500).json({ error: err?.message || 'reasoning fetch failed' });
    }
  });

  // Aggregate the reasoning of every alert linked to an incident, in
  // chronological order. Lets the incident detail panel render a single
  // unified timeline across all linked alerts.
  app.get('/api/incidents/:id/reasoning', authenticate, async (req: any, res) => {
    const { id } = req.params;
    try {
      const linked = await db.prepare('SELECT alert_id FROM incident_alerts WHERE incident_id = ?').all(id) as any[];
      if (linked.length === 0) return res.json({ incident_id: id, count: 0, reasoning: [] });
      const all = (await Promise.all(linked.map((r: any) => listReasoningForAlert(r.alert_id)))).flat();
      all.sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)) || a.step - b.step);
      res.json({ incident_id: id, count: all.length, reasoning: all });
    } catch (err: any) {
      console.warn(`[Reasoning] incident fetch failed for ${id}:`, err?.message);
      res.status(500).json({ error: err?.message || 'reasoning fetch failed' });
    }
  });

  // Re-run the agent pipeline on an incident's representative alert to (re)capture
  // per-agent reasoning. Used when an incident was created by escalation/backfill
  // without ever running a full investigation, so its Reasoning timeline is empty.
  // The run records reasoning + ai_analysis; the alert is re-asserted ESCALATED so a
  // re-investigation can never silently un-escalate an alert that belongs to an incident.
  app.post('/api/incidents/:id/reinvestigate', authenticate, async (req: any, res) => {
    const { id } = req.params;
    try {
      const inc: any = await db.prepare('SELECT id FROM incidents WHERE id = ?').get(id);
      if (!inc) return res.status(404).json({ error: 'Incident not found' });
      const alert: any = await db.prepare(
        `SELECT a.* FROM incident_alerts ia JOIN alerts a ON a.id = ia.alert_id
         WHERE ia.incident_id = ? ORDER BY a.timestamp DESC LIMIT 1`
      ).get(id);
      if (!alert) return res.status(400).json({ error: 'Incident has no linked alert to investigate' });

      await triggerOrchestration(alert.id);   // runs all agents → records reasoning + ai_analysis
      await db.prepare("UPDATE alerts SET status = 'ESCALATED' WHERE id = ?").run(alert.id);

      // Sync the incident's analysis snapshot with the fresh result, so the
      // overview stops showing the stale (often fallback) analysis from creation.
      const fresh: any = await db.prepare('SELECT ai_analysis FROM alerts WHERE id = ?').get(alert.id);
      if (fresh?.ai_analysis) {
        await db.prepare('UPDATE incidents SET analysis = ? WHERE id = ?').run(fresh.ai_analysis, id);
      }

      io.emit('alert_updated', { id: alert.id, status: 'ESCALATED' });
      io.emit('incident_updated', { id });

      const steps = (await db.prepare('SELECT count(*) c FROM incident_reasoning WHERE alert_id = ?').get(alert.id) as any).c;
      writeAudit(req.user?.id, 'INCIDENT_REINVESTIGATED', `Re-ran agents on alert ${alert.id} for incident ${id} (${steps} reasoning step(s))`);
      res.json({ ok: true, alert_id: alert.id, reasoning_steps: Number(steps) });
    } catch (err: any) {
      console.error('[Reinvestigate] Error:', err?.message);
      res.status(500).json({ error: err?.message || 'Re-investigation failed' });
    }
  });

  // Generate a formal incident report (Markdown) from the incident context via
  // the LLM, and save it to report_body. Powers the "Generate Report" button.
  app.post('/api/incidents/:id/generate-report', authenticate, async (req: any, res) => {
    const { id } = req.params;
    try {
      const inc: any = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
      if (!inc) return res.status(404).json({ error: 'Incident not found' });
      const alert: any = await db.prepare(
        `SELECT a.* FROM incident_alerts ia JOIN alerts a ON a.id = ia.alert_id
         WHERE ia.incident_id = ? ORDER BY a.timestamp DESC LIMIT 1`
      ).get(id);

      // Pull the existing AI analysis (incident snapshot, else the latest alert).
      let analysisSummary = '';
      try {
        const j = JSON.parse(inc.analysis || alert?.ai_analysis || '{}');
        analysisSummary = j?.phaseData?.analysis?.analysis_summary || j?.summary || '';
      } catch { /* ignore */ }

      const actions  = await db.prepare('SELECT action_type, target, status, description FROM incident_actions WHERE incident_id = ? ORDER BY order_index, id').all(id);
      const timeline = await db.prepare('SELECT event_type, note, created_at FROM incident_timeline WHERE incident_id = ? ORDER BY created_at, id').all(id);

      const assignments = await getAgentModelAssignments();
      const model = (assignments as any).ticketing || (assignments as any).analysis || OPENROUTER_FREE_MODELS[0];
      const ctx = newRunContext(`report-${id}`);

      const result = await callStructuredLLM({
        phase: 'report',
        model,
        schema: z.object({ report_body: z.string() }),
        systemPrompt: `You are a senior SOC analyst writing the official incident report. Respond ONLY with valid JSON: {"report_body":"<markdown>"}. The "report_body" must be a complete, professional incident report in GitHub-Flavored MARKDOWN with these sections (omit one only if truly not applicable):\n\n## Summary\nWhat happened, on which asset, severity, and whether it is a security incident or operational failure.\n\n## Affected Assets\nA Markdown table (Host | IP | Component/Service | Detail).\n\n## Technical Details\nQuote EXACT artifacts from the raw event — process/service names, file paths, software versions, error/event codes, URLs.\n\n## Root Cause\nThe precise cause.\n\n## Impact\nBusiness/operational impact.\n\n## Timeline\nKey events with timestamps (from the provided timeline).\n\n## Response Actions\nWhat was done / recommended (from the provided actions).\n\n## Recommendations\nNumbered, specific, actionable next steps (exact versions/paths/URLs where relevant).\n\nBe specific and useful like an expert analyst. Escape newlines and quotes so the JSON stays valid.`,
        userPrompt: `INCIDENT: ${inc.title}\nSeverity: ${inc.severity} | Status: ${inc.status} | Phase: ${inc.phase}\n\nAI ANALYSIS:\n${analysisSummary || '(none)'}\n\nRAW EVENT LOG:\n${(alert?.full_log || '').slice(0, 4000)}\n\nRESPONSE ACTIONS:\n${JSON.stringify(actions)}\n\nTIMELINE:\n${JSON.stringify(timeline)}`,
        fallback: { report_body: '' },
        ctx,
      });

      const reportBody = (result?.report_body || '').trim();
      if (!reportBody) {
        return res.status(502).json({ error: 'Report generation failed — the AI did not return a report. Check the LLM provider / model.' });
      }
      await db.prepare('UPDATE incidents SET report_body = ? WHERE id = ?').run(reportBody, id);
      writeAudit(req.user?.id, 'INCIDENT_REPORT_GENERATED', `Generated AI incident report for ${id} (${reportBody.length} chars)`);
      io.emit('incident_updated', { id });
      res.json({ ok: true, report_body: reportBody });
    } catch (err: any) {
      console.error('[Generate Report] Error:', err?.message);
      res.status(500).json({ error: err?.message || 'Report generation failed' });
    }
  });

  // Action lifecycle (recommend → approve → execute)
  app.post('/api/incidents/:id/actions', authenticate, async (req: any, res) => {
    const { id } = req.params;
    const { action_type, target, priority, description, source } = req.body || {};
    if (!action_type || !description) return res.status(400).json({ error: 'action_type and description required' });
    const inc = await db.prepare('SELECT id FROM incidents WHERE id = ?').get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });
    const r = await db.prepare(
      `INSERT INTO incident_actions (incident_id, action_type, target, priority, status, source, description, created_by)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?) RETURNING id`
    ).run(id, action_type, target || null, priority || 'MEDIUM', source || 'analyst', description, req.user?.id ?? null);
    res.json({ ok: true, id: r.lastInsertRowid });
  });

  app.patch('/api/incidents/:id/actions/:actionId', authenticate, async (req: any, res) => {
    const { id, actionId } = req.params;
    const { status: newStatus, notes, description, target, priority, action_type } = req.body || {};
    const validStatuses = ['pending', 'approved', 'executed', 'failed', 'skipped'];
    if (newStatus && !validStatuses.includes(newStatus)) return res.status(400).json({ error: `status must be one of ${validStatuses.join(', ')}` });
    const action: any = await db.prepare('SELECT * FROM incident_actions WHERE id = ? AND incident_id = ?').get(actionId, id);
    if (!action) return res.status(404).json({ error: 'Action not found' });
    const sets: string[] = [];
    const params: any[]  = [];
    if (newStatus) {
      sets.push('status = ?'); params.push(newStatus);
      if (newStatus === 'executed' || newStatus === 'failed') {
        sets.push('executed_at = now()');
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
    await db.prepare(`UPDATE incident_actions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    if (newStatus) {
      await db.prepare(
        `INSERT INTO incident_timeline (incident_id, event_type, user_id, note)
         VALUES (?, 'note', ?, ?)`
      ).run(id, req.user?.id ?? null, `Action "${action.description?.slice(0, 80) || action.action_type}" → ${newStatus}`);
    }
    res.json({ ok: true });
  });

  app.delete('/api/incidents/:id/actions/:actionId', authenticate, async (req: any, res) => {
    const { id, actionId } = req.params;
    const action: any = await db.prepare('SELECT description, action_type FROM incident_actions WHERE id = ? AND incident_id = ?').get(actionId, id);
    if (!action) return res.status(404).json({ error: 'Action not found' });
    await db.prepare('DELETE FROM incident_actions WHERE id = ? AND incident_id = ?').run(actionId, id);
    await db.prepare(
      `INSERT INTO incident_timeline (incident_id, event_type, user_id, note)
       VALUES (?, 'note', ?, ?)`
    ).run(id, req.user?.id ?? null, `Removed action "${(action.description || action.action_type).slice(0, 80)}"`);
    res.json({ ok: true });
  });

  app.post('/api/incidents/:id/actions/reorder', authenticate, async (req: any, res) => {
    const { id } = req.params;
    const { ordered_ids } = req.body || {};
    if (!Array.isArray(ordered_ids)) return res.status(400).json({ error: 'ordered_ids (array) required' });
    await db.transaction(async (tx) => {
      const upd = tx.prepare('UPDATE incident_actions SET order_index = ? WHERE id = ? AND incident_id = ?');
      for (let idx = 0; idx < ordered_ids.length; idx++) {
        await upd.run(idx, ordered_ids[idx], id);
      }
    });
    res.json({ ok: true });
  });

  // Aggregated view: every incident_action joined with its incident, for the
  // Response Actions page. Avoids N+1 fetches.
  app.get('/api/response-actions', authenticate, async (_req, res) => {
    const rows = await db.prepare(`
      SELECT
        a.id, a.incident_id, a.action_type, a.target, a.priority, a.status,
        a.source, a.description, a.notes, a.order_index,
        a.created_at, a.executed_at,
        cu.username AS created_by_username,
        eu.username AS executed_by_username,
        i.title           AS incident_title,
        i.severity        AS incident_severity,
        i.phase           AS incident_phase,
        i.status          AS incident_status,
        i.assigned_to     AS incident_assigned_to,
        au.username       AS incident_assigned_to_username,
        i.escalated_at    AS incident_escalated_at,
        i.created_at      AS incident_created_at
      FROM incident_actions a
      INNER JOIN incidents i ON i.id = a.incident_id
      LEFT JOIN users cu ON cu.id = a.created_by
      LEFT JOIN users eu ON eu.id = a.executed_by
      LEFT JOIN users au ON au.id = i.assigned_to
      ORDER BY i.escalated_at DESC, i.id ASC, a.order_index ASC, a.created_at ASC, a.id ASC
    `).all() as any[];

    const totals = {
      total:    rows.length,
      pending:  rows.filter(r => r.status === 'pending').length,
      approved: rows.filter(r => r.status === 'approved').length,
      executed: rows.filter(r => r.status === 'executed').length,
      failed:   rows.filter(r => r.status === 'failed').length,
      skipped:  rows.filter(r => r.status === 'skipped').length,
      incidents: new Set(rows.map(r => r.incident_id)).size,
    };

    res.json({ actions: rows, totals });
  });

  // Update incident metadata (report_body, title, severity, status)
  app.patch('/api/incidents/:id', authenticate, async (req: any, res) => {
    const { id } = req.params;
    const { report_body, title, severity, status: newStatus } = req.body || {};
    const validStatuses = ['OPEN', 'IN_PROGRESS', 'CONTAINED', 'RESOLVED', 'CLOSED', 'RECLASSIFIED_FP'];

    const inc: any = await db.prepare('SELECT status, assigned_to FROM incidents WHERE id = ?').get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });

    const requesterRole = req.user?.role;
    const isOwner = inc.assigned_to === req.user?.id;
    const canEdit = ['ADMIN', 'INCIDENT_LEAD'].includes(requesterRole) || (requesterRole === 'TIER2' && isOwner);
    if (!canEdit) return res.status(403).json({ error: 'Not allowed to edit this incident' });

    const sets: string[] = ['updated_at = now()'];
    const params: any[]  = [];
    if (report_body !== undefined) { sets.push('report_body = ?'); params.push(report_body); }
    if (title       !== undefined) { sets.push('title = ?');       params.push(title.slice(0, 200)); }
    if (severity    !== undefined) { sets.push('severity = ?');    params.push(severity); }
    if (newStatus   !== undefined) {
      if (!validStatuses.includes(newStatus)) return res.status(400).json({ error: `status must be one of ${validStatuses.join(', ')}` });
      sets.push('status = ?'); params.push(newStatus);
      await db.prepare(
        `INSERT INTO incident_timeline (incident_id, event_type, status_from, status_to, user_id)
         VALUES (?, 'status_change', ?, ?, ?)`
      ).run(id, inc.status, newStatus, req.user?.id ?? null);
    }
    if (sets.length === 1) return res.status(400).json({ error: 'no fields to update' });
    params.push(id);
    await db.prepare(`UPDATE incidents SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    if (newStatus) writeAudit(req.user?.id, 'INCIDENT_STATUS', `Incident ${id} status ${inc.status} → ${newStatus}`);
    io.emit('incident_updated', { id });
    res.json({ ok: true });
  });

  // Reclassify as False Positive
  app.post('/api/incidents/:id/reclassify-fp', authenticate, async (req: any, res) => {
    const { id } = req.params;
    const { note } = req.body || {};
    const inc: any = await db.prepare('SELECT status, assigned_to FROM incidents WHERE id = ?').get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });

    const requesterRole = req.user?.role;
    const isOwner = inc.assigned_to === req.user?.id;
    if (!['ADMIN', 'INCIDENT_LEAD'].includes(requesterRole) && !(requesterRole === 'TIER2' && isOwner)) {
      return res.status(403).json({ error: 'Only ADMIN, INCIDENT_LEAD, or assigned TIER2 can reclassify' });
    }

    await db.prepare(
      `UPDATE incidents SET status = 'RECLASSIFIED_FP', closed_by = ?, closed_at = now(), updated_at = now() WHERE id = ?`
    ).run(req.user?.id ?? null, id);

    // Push linked alerts back to the FP archive
    const linked = await db.prepare('SELECT alert_id FROM incident_alerts WHERE incident_id = ?').all(id) as any[];
    for (const r of linked) {
      await db.prepare(
        `UPDATE alerts SET status = 'FALSE_POSITIVE', fp_method = 'analyst',
           fp_reason = COALESCE(fp_reason, 'Reclassified by analyst from incident ' || ?),
           fp_confidence = COALESCE(NULLIF(fp_confidence, 0), 1.0),
           filtered_at = now()
         WHERE id = ?`
      ).run(id, r.alert_id);
    }

    await db.prepare(
      `INSERT INTO incident_timeline (incident_id, event_type, status_from, status_to, user_id, note)
       VALUES (?, 'reclassified_fp', ?, 'RECLASSIFIED_FP', ?, ?)`
    ).run(id, inc.status, req.user?.id ?? null, note || null);

    // Reclassification means a prior escalation was wrong. We append an FP
    // signal (fp_count++) to every IOC in the affected alerts. We deliberately
    // do NOT decrement the prior tp_count: at the time of escalation the
    // analyst genuinely thought it was real — that's a signal in itself, and
    // erasing it would distort the calibration tracking we'll add later. The
    // empirical fp_ratio rebalances on its own as both counters coexist.
    let totalIocs = 0;
    let totalRegistered = 0;
    for (const r of linked) {
      const iocs = await extractIocsForFeedback(r.alert_id);
      if (iocs.length === 0) continue;
      try {
        await reinforceFeedback(iocs, 'FALSE_POSITIVE');
        totalIocs += iocs.length;
      } catch (err: any) {
        console.warn(`[Feedback] reclassify reinforce failed for ${r.alert_id}:`, err?.message);
      }
    }
    try {
      const newly = await processAutoLearning();
      totalRegistered = newly.length;
    } catch {}

    writeAudit(
      req.user?.id, 'INCIDENT_RECLASSIFIED_FP',
      `Incident ${id} reclassified as FP — ${linked.length} alert(s) returned, ${totalIocs} IOC(s) reinforced as FP, ${totalRegistered} auto-registered`,
    );
    io.emit('incident_updated', { id });
    res.json({
      ok: true,
      status: 'RECLASSIFIED_FP',
      alerts_returned_to_archive: linked.length,
      feedback: { iocs_reinforced: totalIocs, auto_registered: totalRegistered },
    });
  });

  app.patch('/api/incidents/:id/assign', authenticate, async (req: any, res) => {
    const { id } = req.params;
    const { user_id, note } = req.body || {};
    // null/undefined user_id → unassign
    const targetUserId: number | null = (typeof user_id === 'number') ? user_id : (user_id === null ? null : NaN);
    if (Number.isNaN(targetUserId)) return res.status(400).json({ error: 'user_id (number or null) required' });

    const inc: any = await db.prepare('SELECT assigned_to, phase, status FROM incidents WHERE id = ?').get(id);
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

    await db.prepare(`UPDATE incidents SET assigned_to = ?, status = ?, updated_at = now() WHERE id = ?`)
      .run(targetUserId, newStatus, id);

    await db.prepare(
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
      await db.prepare(
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
  app.post('/api/incidents/:id/take', authenticate, async (req: any, res) => {
    const { id } = req.params;
    const requesterRole = req.user?.role;
    const requesterId   = req.user?.id;
    if (!['ADMIN', 'INCIDENT_LEAD', 'TIER2'].includes(requesterRole)) {
      return res.status(403).json({ error: 'Only TIER2+ users can claim an incident' });
    }
    const inc: any = await db.prepare('SELECT assigned_to, phase, status FROM incidents WHERE id = ?').get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });
    if (inc.assigned_to && inc.assigned_to !== requesterId) {
      return res.status(409).json({ error: 'Incident is already assigned to someone else' });
    }
    const newStatus = computeIncidentStatus(inc.phase, requesterId, inc.status);
    await db.prepare(`UPDATE incidents SET assigned_to = ?, status = ?, updated_at = now() WHERE id = ?`)
      .run(requesterId, newStatus, id);
    await db.prepare(
      `INSERT INTO incident_timeline (incident_id, event_type, user_id, note)
       VALUES (?, 'assigned', ?, ?)`
    ).run(id, requesterId, `Claimed by ${req.user?.username}`);
    if (newStatus !== inc.status) {
      await db.prepare(
        `INSERT INTO incident_timeline (incident_id, event_type, status_from, status_to, user_id, note)
         VALUES (?, 'status_change', ?, ?, ?, 'Auto-promoted to Investigating on claim')`
      ).run(id, inc.status, newStatus, requesterId);
    }
    writeAudit(requesterId, 'INCIDENT_CLAIMED', `Incident ${id} self-claimed`);
    io.emit('incident_updated', { id });
    res.json({ ok: true, status: newStatus, assigned_to: requesterId });
  });

  app.patch('/api/incidents/:id/phase', authenticate, async (req: any, res) => {
    const { id } = req.params;
    const { phase, note } = req.body || {};
    if (!INCIDENT_PHASES.includes(phase)) return res.status(400).json({ error: `phase must be one of: ${INCIDENT_PHASES.join(', ')}` });

    const inc: any = await db.prepare('SELECT phase, status, assigned_to FROM incidents WHERE id = ?').get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });

    const requesterRole = req.user?.role;
    const isOwner = inc.assigned_to === req.user?.id;
    if (!['ADMIN', 'INCIDENT_LEAD'].includes(requesterRole) && !(requesterRole === 'TIER2' && isOwner)) {
      return res.status(403).json({ error: 'Only ADMIN, INCIDENT_LEAD, or assigned TIER2 can move phase' });
    }

    const newStatus = computeIncidentStatus(phase, inc.assigned_to, inc.status);
    await db.prepare(`UPDATE incidents SET phase = ?, status = ?, updated_at = now() WHERE id = ?`).run(phase, newStatus, id);
    await db.prepare(
      `INSERT INTO incident_timeline (incident_id, event_type, phase_from, phase_to, status_from, status_to, user_id, note)
       VALUES (?, 'phase_change', ?, ?, ?, ?, ?, ?)`
    ).run(id, inc.phase, phase, inc.status, newStatus, req.user?.id ?? null, note || null);
    writeAudit(req.user?.id, 'INCIDENT_PHASE', `Incident ${id} phase ${inc.phase} → ${phase}`);
    io.emit('incident_updated', { id });
    res.json({ ok: true, phase, status: newStatus });
  });

  app.post('/api/incidents/:id/close', authenticate, async (req: any, res) => {
    const { id } = req.params;
    const { note } = req.body || {};

    const inc: any = await db.prepare('SELECT status, assigned_to FROM incidents WHERE id = ?').get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });
    if (inc.status === 'CLOSED') return res.json({ ok: true, status: 'CLOSED' });

    const requesterRole = req.user?.role;
    const isOwner = inc.assigned_to === req.user?.id;
    if (!['ADMIN', 'INCIDENT_LEAD'].includes(requesterRole) && !(requesterRole === 'TIER2' && isOwner)) {
      return res.status(403).json({ error: 'Only ADMIN, INCIDENT_LEAD, or assigned TIER2 can close' });
    }

    await db.prepare(
      `UPDATE incidents SET status = 'CLOSED', closed_by = ?, closed_at = now(), updated_at = now() WHERE id = ?`
    ).run(req.user?.id ?? null, id);
    await db.prepare(
      `INSERT INTO incident_timeline (incident_id, event_type, status_from, status_to, user_id, note)
       VALUES (?, 'closed', ?, 'CLOSED', ?, ?)`
    ).run(id, inc.status, req.user?.id ?? null, note || null);
    writeAudit(req.user?.id, 'INCIDENT_CLOSED', `Incident ${id} closed`);
    io.emit('incident_updated', { id });
    res.json({ ok: true, status: 'CLOSED' });
  });

  app.post('/api/incidents/:id/timeline', authenticate, async (req: any, res) => {
    const { id } = req.params;
    const { note } = req.body || {};
    if (!note || typeof note !== 'string' || note.trim().length === 0) return res.status(400).json({ error: 'note required' });

    const inc: any = await db.prepare('SELECT id FROM incidents WHERE id = ?').get(id);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });

    await db.prepare(
      `INSERT INTO incident_timeline (incident_id, event_type, user_id, note)
       VALUES (?, 'note', ?, ?)`
    ).run(id, req.user?.id ?? null, note.slice(0, 2000));
    io.emit('incident_updated', { id });
    res.json({ ok: true });
  });

  // ── Escalate alert: legacy endpoint, delegates to incident creation ────────
  // Escalation is the strongest "this is real" signal an analyst can give —
  // reinforce as TRUE_POSITIVE so the IOCs in this alert get tp_count++.
  app.post('/api/alerts/:id/escalate', authenticate, async (req: any, res) => {
    const { id } = req.params;
    try {
      const r = await createIncidentFromAlert({
        alertId:     id,
        assigned_to: null,
        create_glpi: true,
        user_id:     req.user?.id ?? null,
      });
      const fb = await applyFeedbackToMemory(id, 'TRUE_POSITIVE', 'alert-escalate');
      writeAudit(
        req.user?.id, 'ALERT_ESCALATED',
        `Alert ${id} escalated → ${r.grouped ? 'grouped into existing incident' : 'incident'} ${r.id} — reinforced ${fb.iocs.length} IOC(s) as TP`,
      );
      res.json({ ok: true, status: 'ESCALATED', incident_id: r.id, grouped: !!r.grouped, feedback: fb });
    } catch (err: any) {
      console.error('[Legacy escalate] Error:', err?.message);
      res.status(500).json({ error: err?.message || 'Escalation failed' });
    }
  });

  // ── Confirm FP (analyst confirms FP verdict) ──────────────────────────────
  // Wires the analyst's verdict into ioc_memory: every IOC seen in this alert
  // gets fp_count++ via reinforceFeedback. await processAutoLearning() then promotes
  // any IOC that crossed the auto-register threshold into asset_context as
  // fp_default=1, so the next alert with the same IOC can short-circuit.
  app.post('/api/alerts/:id/confirm-fp', authenticate, async (req: any, res) => {
    const { id } = req.params;
    await db.prepare(
      `UPDATE alerts SET status = 'FP_CONFIRMED', closed_at = now(),
         fp_method = COALESCE(fp_method, 'analyst'),
         fp_reason = COALESCE(fp_reason, 'Confirmed as false positive by analyst'),
         fp_confidence = COALESCE(NULLIF(fp_confidence, 0), 1.0),
         filtered_at = COALESCE(filtered_at, now())
       WHERE id = ?`
    ).run(id);

    const fb = await applyFeedbackToMemory(id, 'FALSE_POSITIVE', 'confirm-fp');
    writeAudit(
      req.user?.id, 'FP_CONFIRMED',
      `Alert ${id} FP confirmed — reinforced ${fb.iocs.length} IOC(s), auto-registered ${fb.auto_registered}`,
    );
    io.emit('alert_updated', { id, status: 'FP_CONFIRMED' });
    res.json({ ok: true, status: 'FP_CONFIRMED', feedback: fb });
  });

  // ── Override FP (analyst rejects FP verdict — alert was real) ─────────────
  // The analyst is telling the system this WAS a true positive. We:
  //   1. Clear the FP markers on the alert
  //   2. Promote it into an incident (so it shows up on the Incidents tab)
  //   3. Reinforce TP signal in ioc_memory so similar alerts won't be auto-FP'd
  app.post('/api/alerts/:id/override-fp', authenticate, async (req: any, res) => {
    const { id } = req.params;
    try {
      await db.prepare("UPDATE alerts SET fp_method = NULL, fp_reason = NULL, fp_confidence = 0 WHERE id = ?").run(id);

      const inc = await createIncidentFromAlert({
        alertId:     id,
        assigned_to: null,
        create_glpi: true,
        note:        'Promoted from FP archive — analyst overrode the FP verdict',
        user_id:     req.user?.id ?? null,
      });

      const fb = await applyFeedbackToMemory(id, 'TRUE_POSITIVE', 'override-fp');
      writeAudit(
        req.user?.id, 'FP_OVERRIDDEN',
        `Alert ${id} FP overridden → incident ${inc.id} — reinforced ${fb.iocs.length} IOC(s) as TP, auto-registered ${fb.auto_registered}`,
      );
      io.emit('alert_updated', { id, status: 'ESCALATED' });
      res.json({ ok: true, status: 'ESCALATED', incident_id: inc.id, grouped: !!inc.grouped, feedback: fb });
    } catch (err: any) {
      console.error('[Override FP] Error:', err?.message);
      res.status(500).json({ error: err?.message || 'Override failed' });
    }
  });

  // ── Pipeline Funnel Analytics ─────────────────────────────────────────────
  app.get('/api/analytics/pipeline-funnel', authenticate, async (_req, res) => {
    const ingested     = (await db.prepare("SELECT COUNT(*) as c FROM alerts").get() as any).c;
    const newAlerts    = (await db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status = 'NEW'").get() as any).c;
    const fpFiltered   = (await db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status IN ('FALSE_POSITIVE','FP_CONFIRMED')").get() as any).c;
    const filtered     = (await db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status = 'FILTERED'").get() as any).c;
    const investigated = (await db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status IN ('TRIAGED','ESCALATED','CLOSED') AND investigated_at IS NOT NULL").get() as any).c;
    const escalated    = (await db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status = 'ESCALATED'").get() as any).c;
    const closed       = (await db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status = 'CLOSED'").get() as any).c;

    // Timing metrics
    const timingRow = await db.prepare(`
      SELECT
        AVG(CASE WHEN filtered_at IS NOT NULL THEN (extract(epoch from filtered_at) - extract(epoch from timestamp)) END) as avg_filter_sec,
        AVG(CASE WHEN investigated_at IS NOT NULL THEN (extract(epoch from investigated_at) - extract(epoch from filtered_at)) END) as avg_investigate_sec,
        AVG(CASE WHEN closed_at IS NOT NULL THEN (extract(epoch from closed_at) - extract(epoch from timestamp)) END) as avg_close_sec
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
  app.get('/api/analytics/detection-effectiveness', authenticate, async (_req, res) => {
    const methods = ['suppression', 'memory', 'triage'];
    const result: any = {};
    for (const m of methods) {
      const total    = (await db.prepare("SELECT COUNT(*) as c FROM alerts WHERE fp_method = ?").get(m) as any).c;
      const confirmed = (await db.prepare("SELECT COUNT(*) as c FROM alerts WHERE fp_method = ? AND status = 'FP_CONFIRMED'").get(m) as any).c;
      const overridden = (await db.prepare("SELECT COUNT(*) as c FROM alerts WHERE fp_method = ? AND status = 'FILTERED'").get(m) as any).c;
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
  app.get('/api/analytics/source-distribution', authenticate, async (_req, res) => {
    const byAgent = await db.prepare(`
      SELECT agent_name as name, COUNT(*) as count
      FROM alerts WHERE agent_name IS NOT NULL AND agent_name != ''
      GROUP BY agent_name ORDER BY count DESC LIMIT 15
    `).all();
    const byRule = await db.prepare(`
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
      const result = await runPhase(phase, state, { modelAssignments: await getAgentModelAssignments() });
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
      const alert: any = await db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
      if (!alert) return res.status(404).json({ error: 'Alert not found' });

      // Skip-replay: if a successful agent_runs row exists in the last 5 minutes, return it
      // unless the caller forces a re-run. Prevents re-orchestrating on every UI refresh.
      if (!force) {
        const recent = await db.prepare(`
          SELECT ai_analysis, mitre_attack, remediation_steps, status
          FROM agent_runs
          WHERE alert_id = ? AND ai_analysis IS NOT NULL
            AND run_at >= now() - interval '5 minutes'
          ORDER BY run_at DESC LIMIT 1
        `).get(alertId) as any;
        if (recent) {
          return res.json({ id: alertId, ...recent, replayed: true });
        }
      }

      const recentAlerts = await db.prepare(
        `SELECT * FROM alerts WHERE id != ? AND timestamp >= now() - interval '3 days' ORDER BY timestamp DESC LIMIT 50`
      ).all(alertId);

      await db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('ANALYZING', alertId);
      io.emit('alert_updated', { id: alertId, status: 'ANALYZING' });

      const update = await runOrchestration(alert, recentAlerts, { modelAssignments: await getAgentModelAssignments() });

      await db.prepare(`UPDATE alerts SET status=?, ai_analysis=?, mitre_attack=?, remediation_steps=?, email_sent=?, last_error=NULL, last_error_at=NULL WHERE id=?`)
        .run(update.status, update.ai_analysis, update.mitre_attack, update.remediation_steps, update.email_sent, alertId);

      await db.prepare('INSERT INTO agent_runs (alert_id, ai_analysis, mitre_attack, remediation_steps, status) VALUES (?, ?, ?, ?, ?)')
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
      const reason = (err?.message || 'Orchestration failed').slice(0, 500);
      await db.prepare('UPDATE alerts SET status = ?, last_error = ?, last_error_at = now() WHERE id = ?').run('NEW', reason, alertId);
      io.emit('alert_updated', { id: alertId, status: 'NEW', last_error: reason });
      res.status(500).json({ error: reason });
    }
  });

  // ── Agent run history & feedback ──────────────────────────────────────────
  app.get('/api/alerts/:alertId/runs', authenticate, async (req, res) => {
    const { alertId } = req.params;
    res.json(await db.prepare('SELECT * FROM agent_runs WHERE alert_id = ? ORDER BY run_at DESC LIMIT 20').all(alertId));
  });

  app.post('/api/feedback', authenticate, async (req: any, res) => {
    const { alert_id, phase, is_accurate, comment } = req.body;
    if (!alert_id || !phase) return res.status(400).json({ error: 'alert_id and phase are required' });
    try {
      await db.prepare('INSERT INTO feedback (alert_id, phase, user_id, is_accurate, comment) VALUES (?, ?, ?, ?, ?)').run(alert_id, phase, req.user.id, is_accurate ? 1 : 0, comment || null);
      res.json({ status: 'ok' });
    } catch (err) {
      console.error('Feedback error:', err);
      res.status(500).json({ error: 'Failed to save feedback' });
    }
  });

  app.post('/api/alerts/:alertId/runs', authenticate, async (req: any, res) => {
    const { alertId } = req.params;
    const { ai_analysis, mitre_attack, remediation_steps, status } = req.body || {};
    const result = await db.prepare('INSERT INTO agent_runs (alert_id, ai_analysis, mitre_attack, remediation_steps, status) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .run(alertId, ai_analysis || null, mitre_attack || null, remediation_steps || null, status || 'TRIAGED');
    res.json({ id: result.lastInsertRowid, run_at: new Date().toISOString() });
  });

  // ── Playbooks ─────────────────────────────────────────────────────────────
  app.get('/api/playbooks', authenticate, async (_req, res) => {
    res.json(await db.prepare('SELECT * FROM playbooks ORDER BY tactic, title').all());
  });

  app.post('/api/playbooks', authenticate, requireAdmin, async (req: any, res) => {
    const { tactic, title, steps } = req.body;
    if (!tactic || !title || !steps) return res.status(400).json({ error: 'tactic, title and steps are required' });
    try {
      const result = await db.prepare('INSERT INTO playbooks (tactic, title, steps, created_by) VALUES (?, ?, ?, ?) RETURNING id').run(tactic, title, steps, req.user?.id || null);
      writeAudit(req.user?.id, 'PLAYBOOK_CREATED', `Playbook "${title}" for tactic ${tactic}`);
      res.json({ id: result.lastInsertRowid, tactic, title, steps });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create playbook' });
    }
  });

  app.delete('/api/playbooks/:id', authenticate, requireAdmin, async (req: any, res) => {
    await db.prepare('DELETE FROM playbooks WHERE id = ?').run(req.params.id);
    writeAudit(req.user?.id, 'PLAYBOOK_DELETED', `Playbook #${req.params.id} deleted`);
    res.json({ status: 'ok' });
  });

  app.patch('/api/playbooks/:id', authenticate, requireAdmin, async (req: any, res) => {
    const { tactic, title, steps } = req.body || {};
    const updates: string[] = [];
    const values: any[]     = [];
    if (tactic !== undefined) { updates.push('tactic = ?'); values.push(tactic); }
    if (title  !== undefined) { updates.push('title = ?');  values.push(title); }
    if (steps  !== undefined) { updates.push('steps = ?');  values.push(steps); }
    if (updates.length === 0) return res.status(400).json({ error: 'no fields to update' });
    values.push(req.params.id);
    await db.prepare(`UPDATE playbooks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    writeAudit(req.user?.id, 'PLAYBOOK_UPDATED', `Playbook #${req.params.id} updated`);
    res.json({ ok: true });
  });

  // ── Integrations ─────────────────────────────────────────────────────────
  // Non-notification integrations (ingest config, auth backends) are managed in
  // their own dedicated sub-tabs and must not appear in the notification grid.
  const NON_NOTIFICATION = new Set(['wazuh', 'ldap']);

  app.get('/api/integrations', authenticate, async (_req, res) => {
    const rows = await db.prepare('SELECT * FROM integrations').all() as any[];
    const result = await Promise.all(rows.filter(r => !NON_NOTIFICATION.has(r.name)).map(async r => {
      let cfg: any = {};
      try { cfg = JSON.parse(r.config || '{}'); } catch {}
      const stats = await db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN status='failed'  THEN 1 ELSE 0 END) as failed
        FROM action_logs
        WHERE integration=? AND created_at >= now() - interval '1 day'
      `).get(r.name) as any;
      return {
        name:                r.name,
        enabled:             r.enabled === 1,
        config:              cfg,
        auto_send_threshold: r.auto_send_threshold,
        updated_at:          r.updated_at,
        stats_24h:           { total: stats?.total || 0, success: stats?.success || 0, failed: stats?.failed || 0 },
      };
    }));
    res.json(result);
  });

  // Single-row read by name. Bypasses the notification-filter so the dedicated
  // LDAP / Wazuh sub-tabs can still hydrate themselves.
  app.get('/api/integrations/:name', authenticate, async (req: any, res) => {
    const row: any = await db.prepare('SELECT * FROM integrations WHERE name = ?').get(req.params.name);
    if (!row) return res.status(404).json({ error: 'Integration not found' });
    let cfg: any = {};
    try { cfg = JSON.parse(row.config || '{}'); } catch {}
    // Hide bind_password for non-admins on the LDAP row.
    if (row.name === 'ldap' && req.user?.role !== 'ADMIN') cfg.bind_password = '';
    res.json({ name: row.name, enabled: !!row.enabled, config: cfg, auto_send_threshold: row.auto_send_threshold });
  });

  app.patch('/api/integrations/:name', authenticate, requireAdmin, async (req: any, res) => {
    const { name } = req.params;
    const { enabled, config, auto_send_threshold } = req.body;
    const updates: string[] = ["updated_at = now()"];
    const values: any[]     = [];
    if (enabled !== undefined)             { updates.push('enabled = ?');             values.push(enabled ? 1 : 0); }
    if (config  !== undefined) {
      const nextConfig = name === 'email' ? normalizeEmailIntegrationConfig(config) : config;
      updates.push('config = ?');
      values.push(JSON.stringify(nextConfig));
    }
    if (auto_send_threshold !== undefined) { updates.push('auto_send_threshold = ?'); values.push(auto_send_threshold); }
    values.push(name);
    await db.prepare(`UPDATE integrations SET ${updates.join(', ')} WHERE name = ?`).run(...values);
    writeAudit(req.user?.id, 'INTEGRATION_UPDATED', `Integration ${name} updated`);
    res.json({ ok: true });
  });

  app.post('/api/integrations/:name/test', authenticate, requireAdmin, async (req: any, res) => {
    const { name } = req.params;
    const row = await db.prepare("SELECT * FROM integrations WHERE name=?").get(name) as any;
    if (!row) return res.status(404).json({ ok: false, error: 'Integration not found' });
    let cfg: any = {};
    try { cfg = JSON.parse(row.config || '{}'); } catch {}

    const logAction = await db.prepare('INSERT INTO action_logs (alert_id, integration, action, status, payload, error) VALUES (?, ?, ?, ?, ?, ?)');

    if (name === 'email') {
      try {
        const testEmail = buildTestEmail();
        await sendIncidentAlert(testEmail.subject, { html: testEmail.html, text: testEmail.text }, cfg);
        await logAction.run(null, 'email', 'test', 'success', 'Test email', null);
        return res.json({ ok: true });
      } catch (err: any) {
        await logAction.run(null, 'email', 'test', 'failed', 'Test email', err?.message);
        return res.json({ ok: false, error: err?.message });
      }
    }
    if (name === 'slack') {
      if (!cfg.webhook_url) return res.json({ ok: false, error: 'Webhook URL is required' });
      const result = await sendSlackWebhook(cfg.webhook_url, '🔔 *[BBS AISOC]* Test message — Slack integration is working correctly!');
      await logAction.run(null, 'slack', 'test', result.ok ? 'success' : 'failed', 'Test message', result.error || null);
      return res.json(result);
    }
    if (name === 'telegram') {
      if (!cfg.bot_token || !cfg.chat_id) return res.json({ ok: false, error: 'Bot token and chat ID are required' });
      const result = await sendTelegramMessage({ botToken: cfg.bot_token, chatId: cfg.chat_id }, '🔔 <b>[BBS AISOC]</b> Test message — integration is working correctly!');
      await logAction.run(null, 'telegram', 'test', result.ok ? 'success' : 'failed', 'Test message', result.error || null);
      return res.json(result);
    }
    if (name === 'glpi') {
      if (!cfg.url || !cfg.app_token || !cfg.user_token) return res.json({ ok: false, error: 'URL, App Token and User Token are required' });
      const result = await createGlpiTicket(
        { url: cfg.url, appToken: cfg.app_token, userToken: cfg.user_token },
        { title: 'BBS AISOC — Integration Test', content: 'This ticket was created to verify the GLPI integration is working correctly.', urgency: 1 }
      );
      await logAction.run(null, 'glpi', 'test', result.ok ? 'success' : 'failed', result.ok ? `Ticket #${result.ticketId}` : 'Test ticket', result.error || null);
      return res.json(result);
    }
    return res.json({ ok: false, error: 'Unknown integration' });
  });

  app.get('/api/action-logs', authenticate, async (req: any, res) => {
    const limit       = Math.min(200, parseInt(String(req.query.limit  || '50')));
    const integration = req.query.integration as string | undefined;
    const status      = req.query.status as string | undefined;
    const where: string[] = [];
    const params: any[] = [];
    if (integration) { where.push('integration = ?'); params.push(integration); }
    if (status)      { where.push('status = ?');      params.push(status); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const logs = await db.prepare(`SELECT * FROM action_logs ${whereClause} ORDER BY created_at DESC LIMIT ?`).all(...params, limit);
    res.json(logs);
  });

  app.get('/api/action-stats', authenticate, async (_req, res) => {
    const total    = (await db.prepare("SELECT COUNT(*) as c FROM action_logs").get() as any).c;
    const today    = (await db.prepare("SELECT COUNT(*) as c FROM action_logs WHERE created_at >= current_date").get() as any).c;
    const success  = (await db.prepare("SELECT COUNT(*) as c FROM action_logs WHERE status='success'").get() as any).c;
    const perInteg = await db.prepare(`
      SELECT integration,
        COUNT(*) as total,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success,
        MAX(created_at) as last_at
      FROM action_logs GROUP BY integration
    `).all();
    res.json({ total, today, success_rate: total > 0 ? Math.round((success / total) * 100) : 0, per_integration: perInteg });
  });

  // ── Reports ───────────────────────────────────────────────────────────────
  app.get('/api/reports/summary', authenticate, async (_req, res) => {
    const total      = (await db.prepare("SELECT COUNT(*) as c FROM agent_runs").get() as any).c;
    const last7      = (await db.prepare("SELECT COUNT(*) as c FROM agent_runs WHERE run_at >= now() - interval '7 days'").get() as any).c;
    const emailSent  = (await db.prepare("SELECT COUNT(*) as c FROM alerts WHERE email_sent=1").get() as any).c;
    const totalAlerts= (await db.prepare("SELECT COUNT(*) as c FROM alerts").get() as any).c;

    const daily = await db.prepare(`
      SELECT date(run_at) as day, COUNT(*) as count
      FROM agent_runs WHERE run_at >= now() - interval '7 days'
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

  app.get('/api/reports', authenticate, async (req: any, res) => {
    const page     = Math.max(1, parseInt(String(req.query.page     || '1')));
    const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize || '20'))));
    const offset   = (page - 1) * pageSize;
    const priority = req.query.priority as string | undefined;

    const rows = await db.prepare(`
      SELECT ar.id, ar.alert_id, ar.run_at, ar.status, ar.ai_analysis,
             a.description, a.severity, a.source_ip, a.email_sent
      FROM agent_runs ar
      JOIN alerts a ON a.id = ar.alert_id
      ORDER BY ar.run_at DESC
      LIMIT ? OFFSET ?
    `).all(pageSize * 5, offset * 5) as any[]; // fetch extra for priority filter

    const totalRow = (await db.prepare("SELECT COUNT(*) as c FROM agent_runs").get() as any).c;

    const reports = (await Promise.all(rows.map(async r => {
      let ticket: any = null;
      try {
        const ai = JSON.parse(r.ai_analysis || '{}');
        ticket = ai?.ticket || ai?.phaseData?.ticket;
      } catch {}

      const actionLogs = await db.prepare("SELECT integration FROM action_logs WHERE alert_id=? AND status='success'").all(r.alert_id) as any[];

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
    }))).filter(r => !priority || r.priority === priority).slice(0, pageSize);

    res.json({ reports, total: totalRow, page, pageSize });
  });

  // ── Frontend serving ──────────────────────────────────────────────────────
  if (process.env.USE_VITE_MIDDLEWARE === 'true') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, allowedHosts: true as true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distIndex = path.join(__dirname, '..', 'dist', 'index.html');
    if (!fs.existsSync(distIndex)) {
      throw new Error('dist/index.html not found. Run `npm run build` before starting the server.');
    }
    app.use(express.static(path.join(__dirname, '..', 'dist')));
    app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'dist', 'index.html')));
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
  setInterval(async () => {
    try {
      const stale = await db.prepare(`
        SELECT id, severity, timestamp FROM alerts
        WHERE status IN ('NEW', 'ANALYZING')
        AND timestamp IS NOT NULL
      `).all() as Array<{ id: string; severity: number; timestamp: string }>;

      for (const alert of stale) {
        const label      = getSeverityLabel(alert.severity);
        const windowMin  = SLA_MINUTES[label] ?? 240;
        const ageMin     = Math.round((Date.now() - new Date(alert.timestamp).getTime()) / 60000);
        if (ageMin > windowMin * 2) {
          await db.prepare("UPDATE alerts SET status='ESCALATED' WHERE id=?").run(alert.id);
          io.emit('alert_updated', { id: alert.id, status: 'ESCALATED' });
          writeAudit(null, 'SLA_ESCALATION', `Alert ${alert.id} auto-escalated (age ${ageMin}m > SLA ${windowMin * 2}m)`);
          console.log(`[SLA] Auto-escalated alert ${alert.id} (${label}, ${ageMin}min old)`);
        }
      }
    } catch (err: any) {
      console.warn('[SLA] Background job error:', err?.message);
    }
  }, 5 * 60_000);

  // ── Account-lifecycle tick (every 5 min) ─────────────────────────────────
  // - Disables users whose access_expires_at has passed (ISO A.5.18 / NIST AC-2(2))
  // - Clears temp_role grants that have expired (NIST AC-6(2))
  setInterval(async () => {
    try {
      const expired = await db.prepare(
        "SELECT id, username FROM users WHERE status='active' AND access_expires_at IS NOT NULL AND access_expires_at <> '' AND access_expires_at < now()"
      ).all() as Array<{ id: number; username: string }>;
      for (const u of expired) {
        await db.prepare(`UPDATE users SET status='disabled', jwt_epoch = COALESCE(jwt_epoch,0) + 1 WHERE id = ?`).run(u.id);
        writeAudit(null, 'USER_ACCESS_EXPIRED', `Auto-disabled ${u.username} (#${u.id}); access window elapsed`);
      }
      const tempExpired = await db.prepare(
        "SELECT id, username, temp_role FROM users WHERE temp_role IS NOT NULL AND temp_role_expires_at IS NOT NULL AND temp_role_expires_at < now()"
      ).all() as Array<{ id: number; username: string; temp_role: string }>;
      for (const u of tempExpired) {
        await db.prepare(`UPDATE users SET temp_role = NULL, temp_role_expires_at = NULL WHERE id = ?`).run(u.id);
        writeAudit(null, 'TEMP_ROLE_EXPIRED', `Temp role ${u.temp_role} expired for ${u.username} (#${u.id})`);
      }
    } catch (err: any) {
      console.warn('[Lifecycle] tick error:', err?.message);
    }
  }, 5 * 60_000);

  // ── Audit retention tick (Phase 4.1, ISO A.8.15, NIST AU-11) ─────────────
  // Runs every hour; rows older than retention_days are streamed to
  // YYYY-MM-DD.jsonl.gz and deleted. Idempotent — the same day's archive
  // appends. archive_to_file=false skips writing (rows still deleted, with
  // an audit row for accountability).
  async function runAuditRetentionOnce() {
    const cfg = await loadAuditRetention(db);
    const days = Math.max(7, cfg.retention_days || 365);   // floor at 7d
    const cutoffIso = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = await db.prepare('SELECT id, timestamp, user_id, action, details FROM audit_logs WHERE timestamp < ?').all(cutoffIso) as any[];
    if (rows.length === 0) return;

    if (cfg.archive_to_file) {
      try {
        const dir = path.resolve(cfg.archive_path || './audit-archive');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `audit-${new Date().toISOString().split('T')[0]}.jsonl.gz`);
        const payload = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
        const gz = zlib.gzipSync(Buffer.from(payload, 'utf8'));
        fs.appendFileSync(file, gz);
      } catch (err: any) {
        console.warn('[Audit retention] archive failed; aborting delete:', err?.message);
        return;
      }
    }

    const ids = rows.map(r => r.id);
    const chunk = 500;
    let total = 0;
    for (let i = 0; i < ids.length; i += chunk) {
      const slice = ids.slice(i, i + chunk);
      const ph = slice.map(() => '?').join(',');
      const r = await db.prepare(`DELETE FROM audit_logs WHERE id IN (${ph})`).run(...slice);
      total += r.changes;
    }
    writeAudit(null, 'AUDIT_ARCHIVED', `Archived + deleted ${total} audit row(s) older than ${days}d`);
  }

  setInterval(async () => { runAuditRetentionOnce().catch(err => console.warn('[Audit retention] error:', err?.message)); }, 60 * 60_000);
  // Kick off once at boot (after a short delay to let the rest of startup settle)
  setTimeout(() => { runAuditRetentionOnce().catch(() => {}); }, 30_000);

  // ── Auto-learning tick (every 5 min) ──────────────────────────────────────
  // Periodically scan ioc_memory for indicators that crossed the FP threshold
  // (>= 95% FP across >= 10 observations) and promote them to asset_context
  // with fp_default=1. Each per-feedback call also runs this immediately, so
  // this tick is a safety net for events that didn't go through the analyst
  // endpoints (e.g. agent commits during ingest).
  setInterval(async () => {
    try {
      const newly = await processAutoLearning();
      if (newly.length > 0) {
        writeAudit(null, 'AUTO_LEARN_TICK', `Auto-learned ${newly.length} new FP-default asset(s): ${newly.map(n => n.value).join(', ')}`);
      }
    } catch (err: any) {
      console.warn('[AutoLearn tick] error:', err?.message);
    }
  }, 5 * 60_000);
}

process.on('uncaughtException',    (err)           => console.error('Uncaught Exception:', err));
process.on('unhandledRejection',   (reason, promise) => console.error('Unhandled Rejection:', promise, reason));

initDatabase().then(startServer).catch((e) => { console.error('Fatal startup error:', e); process.exit(1); });
