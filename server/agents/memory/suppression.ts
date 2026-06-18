import { memDb } from "./db.js";

export interface SuppressionRule {
  id:                  number;
  name:                string;
  source_ip_pattern:   string | null;   // exact IP, CIDR (x.x.x.0/24), or null
  agent_name_pattern:  string | null;   // exact or substring match, or null
  rule_id_pattern:     string | null;   // Wazuh rule ID, or null
  description_pattern: string | null;   // regex-style substring (pipe-delimited)
  min_severity:        number;
  max_severity:        number;
  reason:              string;
  hit_count:           number;
  enabled:             number;
  created_at:          string;
  created_by:          string;
}

export interface SuppressionHit {
  rule_id:    number;
  rule_name:  string;
  reason:     string;
  confidence: number;  // 0.78–0.93, grows with validated hit_count
}

/**
 * Confidence that scales with how many times a rule has been validated.
 * Starts at 0.78 (new, unproven rule) and grows logarithmically toward 0.93.
 * Never reaches 1.0 — even a well-known scanner IP could be compromised.
 */
function suppressionConfidence(hitCount: number): number {
  return Math.min(0.93, 0.78 + (Math.log10(hitCount + 1) * 0.075));
}

/**
 * Check all enabled suppression rules against an alert.
 * Returns the first matching rule, or null.
 * Purely deterministic — no LLM, instant.
 */
export async function checkSuppressionRules(alert: any): Promise<SuppressionHit | null> {
  const db = memDb();
  const rules = await db.prepare(
    `SELECT * FROM suppression_rules WHERE enabled = 1`
  ).all() as SuppressionRule[];

  for (const rule of rules) {
    if (matchesRule(rule, alert)) {
      // Bump hit_count
      await db.prepare(`UPDATE suppression_rules SET hit_count = hit_count + 1 WHERE id = ?`).run(rule.id);
      return {
        rule_id:    rule.id,
        rule_name:  rule.name,
        reason:     rule.reason,
        confidence: suppressionConfidence(rule.hit_count),  // hit_count before this increment
      };
    }
  }
  return null;
}

function matchesRule(rule: SuppressionRule, alert: any): boolean {
  const severity = alert.severity ?? alert.data?.rule?.level ?? 0;

  // Severity range check
  if (severity < rule.min_severity || severity > rule.max_severity) return false;

  // Source IP match (exact or CIDR /24)
  if (rule.source_ip_pattern) {
    const alertIp = alert.source_ip || alert.data?.srcip || '';
    if (!matchIp(rule.source_ip_pattern, alertIp)) return false;
  }

  // Agent name match (substring)
  if (rule.agent_name_pattern) {
    const agentName = (alert.agent_name || alert.data?.agent?.name || '').toLowerCase();
    if (!agentName.includes(rule.agent_name_pattern.toLowerCase())) return false;
  }

  // Rule ID match
  if (rule.rule_id_pattern) {
    const alertRuleId = alert.rule_id || alert.data?.rule?.id || '';
    const ruleIds = rule.rule_id_pattern.split('|').map(s => s.trim());
    if (!ruleIds.includes(String(alertRuleId))) return false;
  }

  // Description match (pipe-delimited substrings, any must match)
  if (rule.description_pattern) {
    const desc = (alert.description || alert.data?.rule?.description || '').toLowerCase();
    const patterns = rule.description_pattern.split('|').map(s => s.trim().toLowerCase());
    if (!patterns.some(p => desc.includes(p))) return false;
  }

  return true;
}

/** Match an IP against a pattern: exact match or /24 CIDR */
function matchIp(pattern: string, ip: string): boolean {
  if (!ip) return false;
  if (pattern === ip) return true;
  if (pattern.endsWith('/24')) {
    const prefix = pattern.slice(0, pattern.indexOf('/24'));
    const patternOctets = prefix.split('.').slice(0, 3).join('.');
    const ipOctets = ip.split('.').slice(0, 3).join('.');
    return patternOctets === ipOctets;
  }
  return false;
}

// ── CRUD for suppression rules ──────────────────────────────────────────────

export async function listSuppressionRules(): Promise<SuppressionRule[]> {
  return await memDb().prepare(
    `SELECT * FROM suppression_rules ORDER BY hit_count DESC, created_at DESC`
  ).all() as SuppressionRule[];
}

export async function getSuppressionRule(id: number): Promise<SuppressionRule | null> {
  return (await memDb().prepare(
    `SELECT * FROM suppression_rules WHERE id = ?`
  ).get(id) as SuppressionRule) ?? null;
}

export interface UpsertSuppressionParams {
  name:                string;
  source_ip_pattern?:  string | null;
  agent_name_pattern?: string | null;
  rule_id_pattern?:    string | null;
  description_pattern?:string | null;
  min_severity?:       number;
  max_severity?:       number;
  reason:              string;
  enabled?:            boolean;
  created_by?:         string;
}

export async function createSuppressionRule(p: UpsertSuppressionParams): Promise<number> {
  const result = await memDb().prepare(`
    INSERT INTO suppression_rules
      (name, source_ip_pattern, agent_name_pattern, rule_id_pattern, description_pattern,
       min_severity, max_severity, reason, enabled, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).run(
    p.name,
    p.source_ip_pattern ?? null,
    p.agent_name_pattern ?? null,
    p.rule_id_pattern ?? null,
    p.description_pattern ?? null,
    p.min_severity ?? 0,
    p.max_severity ?? 15,
    p.reason,
    p.enabled !== false ? 1 : 0,
    p.created_by ?? 'manual',
  );
  return result.lastInsertRowid as number;
}

export async function updateSuppressionRule(id: number, updates: Partial<UpsertSuppressionParams> & { enabled?: boolean }): Promise<boolean> {
  const rule = await getSuppressionRule(id);
  if (!rule) return false;
  await memDb().prepare(`
    UPDATE suppression_rules SET
      name = ?, source_ip_pattern = ?, agent_name_pattern = ?, rule_id_pattern = ?,
      description_pattern = ?, min_severity = ?, max_severity = ?, reason = ?, enabled = ?
    WHERE id = ?
  `).run(
    updates.name ?? rule.name,
    updates.source_ip_pattern !== undefined ? updates.source_ip_pattern : rule.source_ip_pattern,
    updates.agent_name_pattern !== undefined ? updates.agent_name_pattern : rule.agent_name_pattern,
    updates.rule_id_pattern !== undefined ? updates.rule_id_pattern : rule.rule_id_pattern,
    updates.description_pattern !== undefined ? updates.description_pattern : rule.description_pattern,
    updates.min_severity ?? rule.min_severity,
    updates.max_severity ?? rule.max_severity,
    updates.reason ?? rule.reason,
    updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : rule.enabled,
    id,
  );
  return true;
}

export async function deleteSuppressionRule(id: number): Promise<boolean> {
  const r = await memDb().prepare(`DELETE FROM suppression_rules WHERE id = ?`).run(id);
  return r.changes > 0;
}
