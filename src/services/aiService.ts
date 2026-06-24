/**
 * aiService.ts — frontend AI service layer
 */

const API = "/api/ai";

export type AgentPhase =
  | "analysis"
  | "intel"
  | "knowledge"
  | "correlation"
  | "ticketing"
  | "response"
  | "validation"
  | "recall"
  | "ioc_check";

export interface LocalModel {
  name:        string;
  size:        number;
  modified_at: string;
}

export interface ProviderGroup {
  providerId:   number;
  providerName: string;
  kind:         string;
  models:       Array<{ id: string; raw: string; label: string }>;
}

export interface AgentModelConfig {
  agents:          Array<{ phase: AgentPhase; name: string; desc: string }>;
  defaults:        Record<AgentPhase, string>;
  assignments:     Record<AgentPhase, string>;
  availableModels: string[];
  modelLabels?:    Record<string, string>;
  providerGroups?: ProviderGroup[];
  localConfig?:    { url: string; enabled: boolean };
  localModels?:    LocalModel[];
}

export interface LlmProviderRow {
  id: number;
  name: string;
  kind: string;
  base_url: string;
  enabled: number;
  priority: number;
  headers_json: string | null;
  created_at: string;
  updated_at: string;
  last_test_at: string | null;
  last_test_ok: number | null;
  last_test_error: string | null;
  api_key_mask: string;
  api_key_set: boolean;
}

export interface LlmProvidersResponse {
  providers: LlmProviderRow[];
  kinds: Array<{ id: string; label: string; base_url: string }>;
  catalog: Record<string, Array<{ id: string; label: string }>>;
}

export interface AgentStat {
  phase:             AgentPhase;
  total_runs:        number;
  fallback_count:    number;
  avg_confidence:    number | null;
  feedback_accurate: number;
  feedback_total:    number;
}

function getToken(): string {
  return localStorage.getItem("soc_token") || "";
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization:  `Bearer ${getToken()}`,
  };
}

// ─── Agent phases ────────────────────────────────────────────────────────────
export async function runAgentPhase(phase: string, state: any): Promise<any> {
  const res = await fetch(`${API}/agent`, {
    method:  "POST",
    headers: authHeaders(),
    body:    JSON.stringify({ phase, state }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Agent request failed (${res.status})`);
  }
  return res.json();
}

export async function orchestrateAnalysis(
  alert: any,
  _recentAlerts: any[],
  onUpdate: (data: any) => void
): Promise<any> {
  onUpdate({ status: "ANALYZING" });
  try {
    const res = await fetch(`${API}/orchestrate`, {
      method:  "POST",
      headers: authHeaders(),
      body:    JSON.stringify({ alertId: alert.id }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Orchestration failed (${res.status})`);
    }
    const data = await res.json();
    onUpdate(data);
    return data;
  } catch (err: any) {
    // Surface the failure instead of swallowing it: reset the optimistic status,
    // then re-throw so the caller can show the reason and offer a retry.
    console.error("[orchestrateAnalysis]", err?.message);
    onUpdate({ status: "NEW" });
    throw err instanceof Error ? err : new Error(err?.message || "Orchestration failed");
  }
}

export interface AiHealthProvider {
  id: number;
  name: string;
  kind: string;
  enabled: boolean;
  last_test_ok: number | null;    // 1 ok | 0 failed | null untested
  last_test_error: string | null;
  last_test_at: string | null;
}
export interface AiHealth {
  providers: AiHealthProvider[];
  local: { enabled: boolean; model: string };
  anyOk: boolean;
  anyConfigured: boolean;
  down: boolean;
}

export async function getAiHealth(): Promise<AiHealth> {
  const res = await fetch(`/api/ai/health`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Health check failed (${res.status})`);
  return res.json();
}

export async function getAlertRuns(alertId: string): Promise<any[]> {
  const res = await fetch(`/api/alerts/${alertId}/runs`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function getAlert(alertId: string): Promise<any> {
  const res = await fetch(`/api/alerts/${alertId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to load alert (${res.status})`);
  return res.json();
}

export async function saveAlertRun(alertId: string, data: {
  ai_analysis?:      string;
  mitre_attack?:     string;
  remediation_steps?:string;
  status?:           string;
}): Promise<{ id: number; run_at: string }> {
  const res = await fetch(`/api/alerts/${alertId}/runs`, {
    method:  "POST",
    headers: authHeaders(),
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save run snapshot");
  return res.json();
}

export async function getAgentModelConfig(): Promise<AgentModelConfig> {
  const res = await fetch(`${API}/models`, { headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to load agent models (${res.status})`);
  }
  return res.json();
}

export async function updateAgentModel(phase: AgentPhase, model: string, stepUpToken?: string): Promise<AgentModelConfig> {
  const headers: Record<string, string> = { ...authHeaders() };
  if (stepUpToken) headers['X-Step-Up-Token'] = stepUpToken;
  const res = await fetch(`${API}/models/${phase}`, {
    method:  "PATCH",
    headers,
    body:    JSON.stringify({ model }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err.step_up_required) { const e: any = new Error(err.error || 'Re-authentication required'); e.step_up_required = true; throw e; }
    throw new Error(err.error || `Failed to update model (${res.status})`);
  }
  const data = await res.json();
  const cfg  = await getAgentModelConfig();
  return { ...cfg, assignments: data.assignments || cfg.assignments };
}

// ─── Local LLM ───────────────────────────────────────────────────────────────
export async function getLocalLLMConfig(): Promise<{ url: string; enabled: boolean }> {
  const res = await fetch('/api/local-llm/config', { headers: authHeaders() });
  if (!res.ok) return { url: 'http://localhost:11434', enabled: false };
  return res.json();
}

export async function updateLocalLLMConfig(payload: { url?: string; enabled?: boolean }, stepUpToken?: string): Promise<void> {
  const headers: Record<string, string> = { ...authHeaders() };
  if (stepUpToken) headers['X-Step-Up-Token'] = stepUpToken;
  const res = await fetch('/api/local-llm/config', { method: 'PATCH', headers, body: JSON.stringify(payload) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err.step_up_required) { const e: any = new Error(err.error || 'Re-authentication required'); e.step_up_required = true; throw e; }
    throw new Error(err.error || 'Failed to update Local LLM config');
  }
}

export async function testLocalLLM(): Promise<{ ok: boolean; model_count?: number; message?: string; error?: string }> {
  const res = await fetch('/api/local-llm/test', { method: 'POST', headers: authHeaders() });
  return res.json();
}

export async function getLocalLLMModels(): Promise<{ models: LocalModel[]; error?: string }> {
  const res = await fetch('/api/local-llm/models', { headers: authHeaders() });
  if (!res.ok) return { models: [] };
  return res.json();
}

export async function getAgentStats(): Promise<AgentStat[]> {
  const res = await fetch('/api/ai/agent-stats', { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function getRiskSeries(granularity: 'hours' | 'days' | 'months' | 'years'): Promise<Array<{
  day: string; label: string; risk: number; activeHighCritical: number; solvedHighCritical: number; newAlerts: number;
}>> {
  const res = await fetch(`/api/stats/risk-series?granularity=${granularity}`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

// ─── LLM provider registry ───────────────────────────────────────────────────
export async function getLlmProviders(): Promise<LlmProvidersResponse> {
  const res = await fetch('/api/admin/llm-providers', { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load providers');
  return res.json();
}

export async function createLlmProvider(payload: {
  name: string;
  kind: string;
  base_url?: string;
  api_key: string;
  priority?: number;
  headers_json?: string;
  enabled?: boolean;
}, stepUpToken: string): Promise<LlmProviderRow> {
  const res = await fetch('/api/admin/llm-providers', {
    method: 'POST',
    headers: { ...authHeaders(), 'X-Step-Up-Token': stepUpToken },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err.step_up_required) { const e: any = new Error(err.error || 'Re-authentication required'); e.step_up_required = true; throw e; }
    throw new Error(err.error || 'Failed to create provider');
  }
  return res.json();
}

export async function updateLlmProvider(id: number, payload: Partial<{
  name: string; kind: string; base_url: string; api_key: string;
  priority: number; headers_json: string | null; enabled: boolean;
}>, stepUpToken: string): Promise<LlmProviderRow> {
  const res = await fetch(`/api/admin/llm-providers/${id}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'X-Step-Up-Token': stepUpToken },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err.step_up_required) { const e: any = new Error(err.error || 'Re-authentication required'); e.step_up_required = true; throw e; }
    throw new Error(err.error || 'Failed to update provider');
  }
  return res.json();
}

export async function deleteLlmProvider(id: number, stepUpToken: string): Promise<void> {
  const res = await fetch(`/api/admin/llm-providers/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders(), 'X-Step-Up-Token': stepUpToken },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err.step_up_required) { const e: any = new Error(err.error || 'Re-authentication required'); e.step_up_required = true; throw e; }
    throw new Error(err.error || 'Failed to delete provider');
  }
}

export async function testLlmProvider(id: number, model?: string): Promise<{ ok: boolean; error?: string; latency_ms?: number; model: string }> {
  const res = await fetch(`/api/admin/llm-providers/${id}/test`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ model: model || '' }),
  });
  return res.json();
}

// ─── Integrations ────────────────────────────────────────────────────────────
export async function getIntegrations(): Promise<any[]> {
  const res = await fetch("/api/integrations", { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function updateIntegration(name: string, payload: {
  enabled?: boolean;
  config?:  Record<string, string>;
  auto_send_threshold?: string;
}): Promise<any> {
  const res = await fetch(`/api/integrations/${name}`, {
    method:  "PATCH",
    headers: authHeaders(),
    body:    JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update integration");
  }
  return res.json();
}

export async function getIntegration(name: string): Promise<{ name: string; enabled: boolean; config: Record<string, string>; auto_send_threshold?: string } | null> {
  const res = await fetch(`/api/integrations/${name}`, { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}

export async function testLdapConnection(username: string): Promise<{ ok: boolean; user?: any; error?: string }> {
  const res = await fetch('/api/admin/integrations/ldap/test', {
    method:  'POST',
    headers: authHeaders(),
    body:    JSON.stringify({ username }),
  });
  return res.json();
}

// ── Step-up re-authentication ─────────────────────────────────────────────
// Exchange the user's password for a short-lived step-up token. The caller
// then includes the token in X-Step-Up-Token on any destructive admin op.
export async function verifyPassword(password: string): Promise<{ token: string; expires_in: number }> {
  const res = await fetch('/api/auth/verify-password', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Password verification failed');
  return data;
}

// ── Admin: user management ─────────────────────────────────────────────────
export interface CreateUserPayload {
  username: string;
  password?: string;
  password_confirm?: string;
  email?: string;
  role?: string;
  display_name?: string;
  generate_temp_password?: boolean;
  must_change_password?: boolean;
}
export async function createUser(payload: CreateUserPayload): Promise<any> {
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to create user');
  return data;
}

export interface UpdateUserPayload {
  role?: string;
  display_name?: string;
  email?: string;
  status?: 'active' | 'disabled';
  must_change_password?: boolean;
  access_expires_at?: string | null;
}
export async function updateUser(id: number, payload: UpdateUserPayload): Promise<any> {
  const res = await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to update user');
  return data;
}

export async function adminResetPassword(id: number): Promise<{ temp_password: string }> {
  const res = await fetch(`/api/users/${id}/reset-password`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to reset password');
  return data;
}

// ── Admin: audit logs ─────────────────────────────────────────────────────
export interface AuditLogQuery {
  user_id?: number | string;
  action?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}
export async function getAuditLogs(query: AuditLogQuery = {}): Promise<{
  rows: Array<{ id: string; timestamp: string; user_id: number | null; username: string | null; action: string; details: string }>;
  total: number;
  page: number;
  pageSize: number;
}> {
  const qs = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
  const res = await fetch(`/api/audit-logs?${qs}`, { headers: authHeaders() });
  return res.json();
}

export async function getAuditLogActions(): Promise<string[]> {
  const res = await fetch('/api/audit-logs/actions', { headers: authHeaders() });
  return res.json();
}

export function auditLogsExportUrl(query: AuditLogQuery): string {
  const qs = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
  return `/api/audit-logs/export.csv?${qs}`;
}

// ── Admin: failed-login dashboard ────────────────────────────────────────
export async function getFailedLogins(window: '24h' | '7d' = '24h'): Promise<{
  window: string;
  since: string;
  total: number;
  byUser: Array<{ username: string; count: number }>;
  sparkline: Array<{ hour: string; count: number }>;
}> {
  const res = await fetch(`/api/admin/failed-logins?window=${window}`, { headers: authHeaders() });
  return res.json();
}

// ── Lightweight password strength estimator (used in admin Add-User modal).
// Returns 0-4 where 4 is "very strong". Pure entropy heuristic — no zxcvbn dep.
export function estimatePasswordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; bits: number; label: string } {
  if (!pw) return { score: 0, bits: 0, label: 'empty' };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 32;
  if (pool === 0) pool = 26;
  const rawBits = Math.log2(pool) * pw.length;
  // Penalize repeats and common sequences
  const repeats = (pw.match(/(.)\1{2,}/g) || []).length;
  const sequences = /(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/i.test(pw) ? 1 : 0;
  const bits = Math.max(0, rawBits - repeats * 6 - sequences * 8);
  let score: 0 | 1 | 2 | 3 | 4 = 0;
  if (bits >= 28) score = 1;
  if (bits >= 40) score = 2;
  if (bits >= 60) score = 3;
  if (bits >= 80) score = 4;
  const labels = ['very weak', 'weak', 'fair', 'good', 'strong'] as const;
  return { score, bits: Math.round(bits), label: labels[score] };
}

export async function testIntegration(name: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/integrations/${name}/test`, {
    method:  "POST",
    headers: authHeaders(),
  });
  return res.json();
}

export async function getActionLogs(params?: {
  limit?:       number;
  integration?: string;
  status?:      string;
}): Promise<any[]> {
  const q = new URLSearchParams();
  if (params?.limit)       q.set("limit",       String(params.limit));
  if (params?.integration) q.set("integration", params.integration);
  if (params?.status)      q.set("status",      params.status);
  const res = await fetch(`/api/action-logs?${q}`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

// ─── Reports ─────────────────────────────────────────────────────────────────
export async function getReports(params?: {
  page?:     number;
  pageSize?: number;
  priority?: string;
}): Promise<{ reports: any[]; total: number; page: number; pageSize: number }> {
  const q = new URLSearchParams();
  if (params?.page)     q.set("page",     String(params.page));
  if (params?.pageSize) q.set("pageSize", String(params.pageSize));
  if (params?.priority) q.set("priority", params.priority);
  const res = await fetch(`/api/reports?${q}`, { headers: authHeaders() });
  if (!res.ok) return { reports: [], total: 0, page: 1, pageSize: 20 };
  return res.json();
}

export async function getReportSummary(): Promise<any> {
  const res = await fetch("/api/reports/summary", { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}

// ─── Asset Context ──────────────────────────────────────────────────────────

export async function getAssets(): Promise<any[]> {
  const res = await fetch("/api/assets", { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function upsertAsset(asset: {
  value: string; type: string; role: string; description?: string; fp_default?: boolean;
}): Promise<{ ok: boolean }> {
  const res = await fetch("/api/assets", {
    method: "POST", headers: authHeaders(), body: JSON.stringify(asset),
  });
  return res.json();
}

export async function deleteAsset(value: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/assets/${encodeURIComponent(value)}`, {
    method: "DELETE", headers: authHeaders(),
  });
  return res.json();
}

// ─── Suppression Rules ──────────────────────────────────────────────────────

export async function getSuppressionRules(): Promise<any[]> {
  const res = await fetch("/api/suppression-rules", { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function createSuppressionRule(rule: {
  name: string; reason: string; source_ip_pattern?: string; agent_name_pattern?: string;
  rule_id_pattern?: string; description_pattern?: string;
  min_severity?: number; max_severity?: number; enabled?: boolean;
}): Promise<{ ok: boolean; id?: number }> {
  const res = await fetch("/api/suppression-rules", {
    method: "POST", headers: authHeaders(), body: JSON.stringify(rule),
  });
  return res.json();
}

export async function updateSuppressionRule(id: number, updates: any): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/suppression-rules/${id}`, {
    method: "PATCH", headers: authHeaders(), body: JSON.stringify(updates),
  });
  return res.json();
}

export async function deleteSuppressionRule(id: number): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/suppression-rules/${id}`, {
    method: "DELETE", headers: authHeaders(),
  });
  return res.json();
}

// ─── Analytics ──────────────────────────────────────────────────────────────

export async function getFpReduction(): Promise<any> {
  const res = await fetch("/api/analytics/fp-reduction", { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}

export async function getFpOverTime(period?: string): Promise<any[]> {
  const res = await fetch(`/api/analytics/fp-over-time${(period && period !== 'all') ? `?period=${period}` : ''}`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function getNoisySources(): Promise<any[]> {
  const res = await fetch("/api/analytics/noisy-sources", { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function getFpSuggestions(): Promise<any[]> {
  const res = await fetch("/api/analytics/fp-suggestions", { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function acceptFpSuggestion(value: string, type: string): Promise<{ ok: boolean }> {
  const res = await fetch("/api/analytics/accept-suggestion", {
    method: "POST", headers: authHeaders(), body: JSON.stringify({ value, type }),
  });
  return res.json();
}

// ─── Incident Management ─────────────────────────────────────────────────────
import type { Incident, IncidentAction, IncidentActionStatus } from '../types';

export interface IncidentListResponse {
  rows:   Incident[];
  total:  number;
  counts: Record<string, number>;
}

export async function listAnalysts(): Promise<{ id: number; username: string; role: string }[]> {
  const res = await fetch('/api/users/analysts', { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function getIncidents(opts: { phase?: string; status?: string; assigned_to?: number; q?: string; limit?: number; offset?: number } = {}): Promise<IncidentListResponse> {
  const q = new URLSearchParams();
  if (opts.phase)            q.set('phase',       opts.phase);
  if (opts.status)           q.set('status',      opts.status);
  if (opts.assigned_to)      q.set('assigned_to', String(opts.assigned_to));
  if (opts.q)                q.set('q',           opts.q);
  if (opts.limit)            q.set('limit',       String(opts.limit));
  if (opts.offset)           q.set('offset',      String(opts.offset));
  const res = await fetch(`/api/incidents?${q}`, { headers: authHeaders() });
  if (!res.ok) return { rows: [], total: 0, counts: {} };
  return res.json();
}

export async function reclassifyIncidentFp(id: string, note?: string): Promise<{ ok: boolean; alerts_returned_to_archive?: number; error?: string }> {
  const res = await fetch(`/api/incidents/${id}/reclassify-fp`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ note }) });
  return res.json();
}

export async function addIncidentAction(id: string, payload: { action_type: string; target?: string; priority?: string; description: string; source?: string }): Promise<{ ok: boolean; id?: number; error?: string }> {
  const res = await fetch(`/api/incidents/${id}/actions`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  return res.json();
}

export async function updateIncidentAction(incidentId: string, actionId: number, payload: { status?: IncidentActionStatus; notes?: string; description?: string; target?: string; priority?: string; action_type?: string }): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/incidents/${incidentId}/actions/${actionId}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
  return res.json();
}

export async function deleteIncidentAction(incidentId: string, actionId: number): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/incidents/${incidentId}/actions/${actionId}`, { method: 'DELETE', headers: authHeaders() });
  return res.json();
}

export async function reorderIncidentActions(incidentId: string, ordered_ids: number[]): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/incidents/${incidentId}/actions/reorder`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ ordered_ids }) });
  return res.json();
}

export type ResponseActionRow = {
  id: number;
  incident_id: string;
  action_type: string;
  target: string | null;
  priority: string | null;
  status: IncidentActionStatus;
  source: string | null;
  description: string | null;
  notes: string | null;
  order_index: number;
  created_at: string;
  executed_at: string | null;
  created_by_username: string | null;
  executed_by_username: string | null;
  incident_title: string | null;
  incident_severity: string | null;
  incident_phase: string | null;
  incident_status: string | null;
  incident_assigned_to: number | null;
  incident_assigned_to_username: string | null;
  incident_escalated_at: string | null;
  incident_created_at: string;
};

export type ResponseActionsResponse = {
  actions: ResponseActionRow[];
  totals: {
    total: number;
    pending: number;
    approved: number;
    executed: number;
    failed: number;
    skipped: number;
    incidents: number;
  };
};

export async function getResponseActions(): Promise<ResponseActionsResponse> {
  const res = await fetch('/api/response-actions', { headers: authHeaders() });
  if (!res.ok) return { actions: [], totals: { total: 0, pending: 0, approved: 0, executed: 0, failed: 0, skipped: 0, incidents: 0 } };
  return res.json();
}

export async function updateIncident(id: string, payload: { report_body?: string; title?: string; severity?: string; status?: string }): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/incidents/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
  return res.json();
}

export async function getIncident(id: string): Promise<Incident | null> {
  const res = await fetch(`/api/incidents/${id}`, { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}

// ─── Reasoning timeline (Tier 1.2) ───────────────────────────────────────────
// Each row is what one agent decided, with the evidence it weighed and the
// alternatives it rejected. Arrays come back as JSON-parsed string arrays.
export interface ReasoningRow {
  id:                  number;
  alert_id:            string;
  trace_id:            string;
  agent:               string;
  step:                number;
  decision:            string;
  evidence_for:        string[];
  evidence_against:    string[];
  rejected_hypotheses: string[];
  confidence:          number;
  created_at:          string;
}

export async function getIncidentReasoning(incidentId: string): Promise<{
  incident_id: string;
  count:       number;
  reasoning:   ReasoningRow[];
}> {
  const res = await fetch(`/api/incidents/${incidentId}/reasoning`, { headers: authHeaders() });
  if (!res.ok) return { incident_id: incidentId, count: 0, reasoning: [] };
  return res.json();
}

// Re-run the agent pipeline on an incident's representative alert to (re)capture
// per-agent reasoning. Returns how many reasoning steps were recorded.
export async function reinvestigateIncident(id: string): Promise<{ ok: boolean; alert_id?: string; reasoning_steps?: number; error?: string }> {
  const res = await fetch(`/api/incidents/${id}/reinvestigate`, { method: 'POST', headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Re-investigation failed');
  return data;
}

export async function generateIncidentReport(id: string): Promise<{ ok: boolean; report_body: string }> {
  const res = await fetch(`/api/incidents/${id}/generate-report`, { method: 'POST', headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Report generation failed');
  return data;
}

export async function lockIncidentReport(id: string, locked: boolean): Promise<{ ok: boolean; locked: boolean }> {
  const res = await fetch(`/api/incidents/${id}/report-lock`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ locked }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to change report lock');
  return data;
}

export interface ReportHistoryRow { id: number; user_id: number | null; username: string | null; action: string; snapshot: string | null; created_at: string; }
export async function getReportHistory(id: string): Promise<{ history: ReportHistoryRow[] }> {
  const res = await fetch(`/api/incidents/${id}/report-history`, { headers: authHeaders() });
  if (!res.ok) return { history: [] };
  return res.json();
}

export async function getAlertReasoning(alertId: string): Promise<{
  alert_id: string;
  count:    number;
  reasoning: ReasoningRow[];
}> {
  const res = await fetch(`/api/alerts/${alertId}/reasoning`, { headers: authHeaders() });
  if (!res.ok) return { alert_id: alertId, count: 0, reasoning: [] };
  return res.json();
}

export async function createIncident(payload: { alert_id: string; title?: string; severity?: string; assigned_to: number | null; phase?: string; note?: string; create_glpi?: boolean }): Promise<{ ok: boolean; id?: string; glpi_ticket_id?: string | null; error?: string }> {
  const res = await fetch('/api/incidents', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  return res.json();
}

export async function assignIncident(id: string, user_id: number | null, note?: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  const res = await fetch(`/api/incidents/${id}/assign`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ user_id, note }) });
  return res.json();
}

export async function takeIncident(id: string): Promise<{ ok: boolean; status?: string; assigned_to?: number; error?: string }> {
  const res = await fetch(`/api/incidents/${id}/take`, { method: 'POST', headers: authHeaders() });
  return res.json();
}

export async function moveIncidentPhase(id: string, phase: string, note?: string): Promise<{ ok: boolean; phase?: string; status?: string; error?: string }> {
  const res = await fetch(`/api/incidents/${id}/phase`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ phase, note }) });
  return res.json();
}

export async function closeIncident(id: string, note?: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  const res = await fetch(`/api/incidents/${id}/close`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ note }) });
  return res.json();
}

export async function addIncidentNote(id: string, note: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/incidents/${id}/timeline`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ note }) });
  return res.json();
}

// ─── Knowledge Base ──────────────────────────────────────────────────────────
export interface Insight {
  alert_id:        string;
  summary:         string;
  attack_pattern?: string;
  threat_actor?:   string;
  outcome:         string;
  ttp_tags:        string[];
  triggered_by?:   string;
  created_at:      string;
}

export async function getInsights(opts: { q?: string; outcome?: string; limit?: number; offset?: number } = {}): Promise<{ rows: Insight[]; total: number }> {
  const q = new URLSearchParams();
  if (opts.q)       q.set('q',       opts.q);
  if (opts.outcome) q.set('outcome', opts.outcome);
  if (opts.limit)   q.set('limit',   String(opts.limit));
  if (opts.offset)  q.set('offset',  String(opts.offset));
  const res = await fetch(`/api/memory/insights?${q}`, { headers: authHeaders() });
  if (!res.ok) return { rows: [], total: 0 };
  return res.json();
}

export interface IocRow {
  value:         string;
  type:          string;
  first_seen:    string;
  last_seen:     string;
  alert_count:   number;
  threat_level:  string;
  notes?:        string;
  fp_count:      number;
  tp_count:      number;
  fp_ratio:      number | null;
}

export async function getIocs(opts: { q?: string; type?: string; limit?: number; offset?: number } = {}): Promise<{ rows: IocRow[]; total: number }> {
  const q = new URLSearchParams();
  if (opts.q)      q.set('q',      opts.q);
  if (opts.type)   q.set('type',   opts.type);
  if (opts.limit)  q.set('limit',  String(opts.limit));
  if (opts.offset) q.set('offset', String(opts.offset));
  const res = await fetch(`/api/memory/iocs/all?${q}`, { headers: authHeaders() });
  if (!res.ok) return { rows: [], total: 0 };
  return res.json();
}

export interface Playbook {
  id:         number;
  tactic:     string;
  title:      string;
  steps:      string;
  created_at: string;
}

export async function getPlaybooks(): Promise<Playbook[]> {
  const res = await fetch('/api/playbooks', { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function createPlaybook(payload: { tactic: string; title: string; steps: string }): Promise<{ id: number; error?: string }> {
  const res = await fetch('/api/playbooks', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  return res.json();
}

export async function updatePlaybook(id: number, payload: { tactic?: string; title?: string; steps?: string }): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/playbooks/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
  return res.json();
}

export async function deletePlaybook(id: number): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/playbooks/${id}`, { method: 'DELETE', headers: authHeaders() });
  return res.json();
}

// ─── API Keys ────────────────────────────────────────────────────────────────
export async function listApiKeys(): Promise<any[]> {
  const res = await fetch('/api/api-keys', { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function createApiKey(name: string): Promise<{ ok: boolean; key: string; prefix: string; error?: string }> {
  const res = await fetch('/api/api-keys', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function revokeApiKey(id: number): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/api-keys/${id}`, {
    method: 'DELETE', headers: authHeaders(),
  });
  return res.json();
}

export async function updateApiKey(
  id: number,
  payload: { paused?: boolean; min_severity_override?: number | null }
): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/api-keys/${id}`, {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload),
  });
  return res.json();
}

// kept for backward compat — no-op now
export async function generateWazuhKey(): Promise<{ ok: boolean; webhook_secret: string }> {
  return { ok: false, webhook_secret: '' };
}

// ─── Pipeline: FP Scan + Investigation ──────────────────────────────────────

export async function fpScan(alertId: string): Promise<any> {
  const res = await fetch("/api/ai/fp-scan", {
    method: "POST", headers: authHeaders(), body: JSON.stringify({ alertId }),
  });
  return res.json();
}

export async function fpScanBatch(): Promise<any> {
  const res = await fetch("/api/ai/fp-scan-batch", {
    method: "POST", headers: authHeaders(),
  });
  return res.json();
}

export async function investigateAlert(alertId: string): Promise<any> {
  const res = await fetch("/api/ai/investigate", {
    method: "POST", headers: authHeaders(), body: JSON.stringify({ alertId }),
  });
  return res.json();
}

export async function escalateAlert(alertId: string): Promise<any> {
  const res = await fetch(`/api/alerts/${alertId}/escalate`, {
    method: "POST", headers: authHeaders(),
  });
  return res.json();
}

export async function confirmFp(alertId: string): Promise<any> {
  const res = await fetch(`/api/alerts/${alertId}/confirm-fp`, {
    method: "POST", headers: authHeaders(),
  });
  return res.json();
}

export async function overrideFp(alertId: string): Promise<any> {
  const res = await fetch(`/api/alerts/${alertId}/override-fp`, {
    method: "POST", headers: authHeaders(),
  });
  return res.json();
}

export async function getFpArchive(opts: { page?: number; pageSize?: number; method?: string; source?: string; period?: string } = {}): Promise<any> {
  const params = new URLSearchParams();
  if (opts.page)     params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.method)   params.set('method', opts.method);
  if (opts.source)   params.set('source', opts.source);
  if (opts.period && opts.period !== 'all') params.set('period', opts.period);
  const res = await fetch(`/api/alerts/fp-archive?${params}`, { headers: authHeaders() });
  if (!res.ok) return { alerts: [], total: 0 };
  return res.json();
}

const periodQ = (period?: string) => (period && period !== 'all') ? `?period=${period}` : '';

export async function getPipelineFunnel(period?: string): Promise<any> {
  const res = await fetch(`/api/analytics/pipeline-funnel${periodQ(period)}`, { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}

export async function getDetectionEffectiveness(period?: string): Promise<any> {
  const res = await fetch(`/api/analytics/detection-effectiveness${periodQ(period)}`, { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}

export async function getSourceDistribution(period?: string): Promise<any> {
  const res = await fetch(`/api/analytics/source-distribution${periodQ(period)}`, { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}
