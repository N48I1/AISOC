// Security policy helpers — read DB-backed config rows from `integrations`
// and validate inputs. Keeps server.ts thin and lets admins tune controls
// at runtime without redeploys. Maps to ISO 27001 A.5.17 (auth info) and
// NIST 800-63B password guidance.

import type Database from 'better-sqlite3';

export interface PasswordPolicy {
  min_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_digit: boolean;
  require_special: boolean;
  block_common_passwords: boolean;
  history_depth: number;
  max_age_days: number;
}

export interface LockoutPolicy {
  max_failed_attempts: number;
  lockout_minutes: number;
  captcha_after: number;
}

export interface AdminIpAllowlist {
  enabled: boolean;
  cidrs: string[];
}

export interface AuditRetention {
  retention_days: number;
  archive_to_file: boolean;
  archive_path: string;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  min_length: 12,
  require_uppercase: false,
  require_lowercase: false,
  require_digit: false,
  require_special: false,
  block_common_passwords: true,
  history_depth: 10,
  max_age_days: 0,
};

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = {
  max_failed_attempts: 5,
  lockout_minutes: 15,
  captcha_after: 3,
};

export const DEFAULT_ADMIN_IP_ALLOWLIST: AdminIpAllowlist = {
  enabled: false,
  cidrs: [],
};

export const DEFAULT_AUDIT_RETENTION: AuditRetention = {
  retention_days: 365,
  archive_to_file: true,
  archive_path: './audit-archive',
};

type AnyDb = Database.Database;

function readJsonConfig<T>(db: AnyDb, name: string, fallback: T): T {
  try {
    const row: any = db.prepare('SELECT config FROM integrations WHERE name = ?').get(name);
    if (!row?.config) return fallback;
    const parsed = JSON.parse(row.config);
    return { ...fallback, ...parsed } as T;
  } catch {
    return fallback;
  }
}

export function ensurePolicyRows(db: AnyDb): void {
  const seed = (name: string, cfg: object) => {
    const exists = db.prepare('SELECT 1 FROM integrations WHERE name = ?').get(name);
    if (!exists) {
      db.prepare('INSERT INTO integrations (name, enabled, config, auto_send_threshold) VALUES (?, 1, ?, ?)')
        .run(name, JSON.stringify(cfg), 'LOW');
    }
  };
  seed('password_policy',    DEFAULT_PASSWORD_POLICY);
  seed('lockout_policy',     DEFAULT_LOCKOUT_POLICY);
  seed('admin_ip_allowlist', DEFAULT_ADMIN_IP_ALLOWLIST);
  seed('audit_retention',    DEFAULT_AUDIT_RETENTION);
}

let _passwordCache: { at: number; v: PasswordPolicy } | null = null;
let _lockoutCache:  { at: number; v: LockoutPolicy } | null  = null;
let _ipCache:       { at: number; v: AdminIpAllowlist } | null = null;
let _retentionCache:{ at: number; v: AuditRetention } | null = null;

const TTL_MS = 30_000;

export function loadPasswordPolicy(db: AnyDb): PasswordPolicy {
  if (_passwordCache && Date.now() - _passwordCache.at < TTL_MS) return _passwordCache.v;
  const v = readJsonConfig(db, 'password_policy', DEFAULT_PASSWORD_POLICY);
  _passwordCache = { at: Date.now(), v };
  return v;
}

export function loadLockoutPolicy(db: AnyDb): LockoutPolicy {
  if (_lockoutCache && Date.now() - _lockoutCache.at < TTL_MS) return _lockoutCache.v;
  const v = readJsonConfig(db, 'lockout_policy', DEFAULT_LOCKOUT_POLICY);
  _lockoutCache = { at: Date.now(), v };
  return v;
}

export function loadAdminIpAllowlist(db: AnyDb): AdminIpAllowlist {
  if (_ipCache && Date.now() - _ipCache.at < TTL_MS) return _ipCache.v;
  const v = readJsonConfig(db, 'admin_ip_allowlist', DEFAULT_ADMIN_IP_ALLOWLIST);
  _ipCache = { at: Date.now(), v };
  return v;
}

export function loadAuditRetention(db: AnyDb): AuditRetention {
  if (_retentionCache && Date.now() - _retentionCache.at < TTL_MS) return _retentionCache.v;
  const v = readJsonConfig(db, 'audit_retention', DEFAULT_AUDIT_RETENTION);
  _retentionCache = { at: Date.now(), v };
  return v;
}

export function invalidatePolicyCache(): void {
  _passwordCache = null;
  _lockoutCache  = null;
  _ipCache       = null;
  _retentionCache= null;
}

// Compact common-password blocklist — covers the families auditors flag.
// Not exhaustive; serves as a smoke-test layer in front of length/strength.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssword', 'p@ssw0rd',
  '123456', '12345678', '123456789', '1234567890', 'qwerty', 'qwertyuiop',
  'letmein', 'welcome', 'welcome1', 'admin', 'administrator', 'root', 'toor',
  'iloveyou', 'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball',
  'changeme', 'changeme1', 'temp1234', 'soc', 'aisoc', 'soc2024', 'soc2025', 'soc2026',
  'azerty', 'azertyui', 'motdepasse', 'bonjour', 'soleil',
]);

export function isCommonPassword(pw: string): boolean {
  const lower = pw.toLowerCase().trim();
  if (COMMON_PASSWORDS.has(lower)) return true;
  const stripped = lower.replace(/[!@#$%^&*()_\-+=.,]/g, '');
  return COMMON_PASSWORDS.has(stripped);
}

export function validatePasswordAgainstPolicy(pw: string, policy: PasswordPolicy): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (pw.length < policy.min_length) errors.push(`At least ${policy.min_length} characters`);
  if (policy.require_uppercase && !/[A-Z]/.test(pw)) errors.push('At least one uppercase letter');
  if (policy.require_lowercase && !/[a-z]/.test(pw)) errors.push('At least one lowercase letter');
  if (policy.require_digit     && !/\d/.test(pw))    errors.push('At least one digit');
  if (policy.require_special   && !/[^A-Za-z0-9]/.test(pw)) errors.push('At least one special character');
  if (policy.block_common_passwords && isCommonPassword(pw)) errors.push('This password is too common — pick a longer passphrase');
  return { ok: errors.length === 0, errors };
}

// Permission matrix — single source of truth for the "Roles & Permissions"
// viewer. Maps a permission key to the minimum role level. ROLE_LEVEL is
// duplicated in server.ts (intentional — both must agree). When endpoints
// gain or lose protection, update this table so the matrix UI stays accurate.
export type RoleName = 'ANALYST' | 'TIER1' | 'TIER2' | 'INCIDENT_LEAD' | 'ADMIN' | 'SUPER_ADMIN';

export const ROLE_NAMES: RoleName[] = ['ANALYST', 'TIER1', 'TIER2', 'INCIDENT_LEAD', 'ADMIN', 'SUPER_ADMIN'];

export const ROLE_LEVELS: Record<RoleName, number> = {
  ANALYST:       0,
  TIER1:         1,
  TIER2:         2,
  INCIDENT_LEAD: 3,
  ADMIN:         4,
  SUPER_ADMIN:   5,
};

export interface Permission { key: string; description: string; min_level: number; area: string; }

export const PERMISSIONS: Permission[] = [
  { area: 'Alerts',    key: 'alerts.view',                description: 'View alert queue',                       min_level: ROLE_LEVELS.ANALYST },
  { area: 'Alerts',    key: 'alerts.update_status',       description: 'Confirm / override alert state',         min_level: ROLE_LEVELS.TIER1 },
  { area: 'Incidents', key: 'incidents.view',             description: 'View incidents',                         min_level: ROLE_LEVELS.ANALYST },
  { area: 'Incidents', key: 'incidents.update',           description: 'Update incident phase / status',         min_level: ROLE_LEVELS.TIER1 },
  { area: 'Incidents', key: 'incidents.close',            description: 'Close / escalate incidents',             min_level: ROLE_LEVELS.TIER2 },
  { area: 'Incidents', key: 'incidents.execute_action',   description: 'Execute response actions (block, isolate…)', min_level: ROLE_LEVELS.INCIDENT_LEAD },
  { area: 'Knowledge', key: 'knowledge.view',             description: 'Read knowledge base',                    min_level: ROLE_LEVELS.ANALYST },
  { area: 'Knowledge', key: 'knowledge.edit',             description: 'Edit knowledge base',                    min_level: ROLE_LEVELS.TIER2 },
  { area: 'Memory',    key: 'memory.view',                description: 'View IOC / asset / insight memory',      min_level: ROLE_LEVELS.TIER1 },
  { area: 'Memory',    key: 'memory.suppression.approve', description: 'Approve suppression suggestions',        min_level: ROLE_LEVELS.ADMIN },
  { area: 'Users',     key: 'users.view',                 description: 'List users',                             min_level: ROLE_LEVELS.ADMIN },
  { area: 'Users',     key: 'users.manage',               description: 'Create / edit / disable users below admin', min_level: ROLE_LEVELS.ADMIN },
  { area: 'Users',     key: 'users.reset_password',       description: 'Reset another user\'s password',         min_level: ROLE_LEVELS.ADMIN },
  { area: 'Users',     key: 'users.revoke_sessions',      description: 'Force-logout another user',              min_level: ROLE_LEVELS.ADMIN },
  { area: 'Users',     key: 'users.manage_admins',        description: 'Manage admins / assign ADMIN role',      min_level: ROLE_LEVELS.SUPER_ADMIN },
  { area: 'Settings',  key: 'settings.ai_models',         description: 'Change AI model selection (+ step-up)',  min_level: ROLE_LEVELS.ADMIN },
  { area: 'Settings',  key: 'settings.integrations',      description: 'Manage notification integrations',       min_level: ROLE_LEVELS.ADMIN },
  { area: 'Settings',  key: 'settings.password_policy',   description: 'Edit password policy',                   min_level: ROLE_LEVELS.ADMIN },
  { area: 'Settings',  key: 'settings.ip_allowlist',      description: 'Edit admin IP allowlist',                min_level: ROLE_LEVELS.SUPER_ADMIN },
  { area: 'Admin Ops', key: 'admin.reset_alerts',         description: 'Destructive: reset alerts (+ step-up)',  min_level: ROLE_LEVELS.ADMIN },
  { area: 'Admin Ops', key: 'admin.clear_investigation',  description: 'Destructive: clear incidents queue',     min_level: ROLE_LEVELS.ADMIN },
  { area: 'Admin Ops', key: 'admin.clear_fp_archive',     description: 'Destructive: clear FP archive',          min_level: ROLE_LEVELS.ADMIN },
  { area: 'Audit',     key: 'audit.view',                 description: 'View audit logs',                        min_level: ROLE_LEVELS.ADMIN },
  { area: 'Audit',     key: 'audit.export',               description: 'Export audit logs to CSV',               min_level: ROLE_LEVELS.ADMIN },
  { area: 'Reports',   key: 'reports.compliance',         description: 'Download compliance evidence reports',   min_level: ROLE_LEVELS.ADMIN },
  { area: 'Ingest',    key: 'ingest.api_keys',            description: 'Manage SIEM ingest API keys',            min_level: ROLE_LEVELS.ADMIN },
];

export function buildPermissionMatrix(): Array<Permission & { allowed: Record<RoleName, boolean> }> {
  return PERMISSIONS.map(p => ({
    ...p,
    allowed: ROLE_NAMES.reduce((acc, r) => {
      acc[r] = ROLE_LEVELS[r] >= p.min_level;
      return acc;
    }, {} as Record<RoleName, boolean>),
  }));
}
