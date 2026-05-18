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

export interface AgentModelConfig {
  agents:          Array<{ phase: AgentPhase; name: string; desc: string }>;
  defaults:        Record<AgentPhase, string>;
  assignments:     Record<AgentPhase, string>;
  availableModels: string[];
  modelLabels?:    Record<string, string>;
  localConfig?:    { url: string; enabled: boolean };
  localModels?:    LocalModel[];
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
    console.error("[orchestrateAnalysis]", err?.message);
    onUpdate({ status: "NEW" });
    return null;
  }
}

export async function getAlertRuns(alertId: string): Promise<any[]> {
  const res = await fetch(`/api/alerts/${alertId}/runs`, { headers: authHeaders() });
  if (!res.ok) return [];
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

export async function updateAgentModel(phase: AgentPhase, model: string): Promise<AgentModelConfig> {
  const res = await fetch(`${API}/models/${phase}`, {
    method:  "PATCH",
    headers: authHeaders(),
    body:    JSON.stringify({ model }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
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

export async function updateLocalLLMConfig(payload: { url?: string; enabled?: boolean }): Promise<void> {
  await fetch('/api/local-llm/config', { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
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

export async function getFpOverTime(): Promise<any[]> {
  const res = await fetch("/api/analytics/fp-over-time", { headers: authHeaders() });
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

export async function getFpArchive(opts: { page?: number; pageSize?: number; method?: string; source?: string } = {}): Promise<any> {
  const params = new URLSearchParams();
  if (opts.page)     params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.method)   params.set('method', opts.method);
  if (opts.source)   params.set('source', opts.source);
  const res = await fetch(`/api/alerts/fp-archive?${params}`, { headers: authHeaders() });
  if (!res.ok) return { alerts: [], total: 0 };
  return res.json();
}

export async function getPipelineFunnel(): Promise<any> {
  const res = await fetch("/api/analytics/pipeline-funnel", { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}

export async function getDetectionEffectiveness(): Promise<any> {
  const res = await fetch("/api/analytics/detection-effectiveness", { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}

export async function getSourceDistribution(): Promise<any> {
  const res = await fetch("/api/analytics/source-distribution", { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}
