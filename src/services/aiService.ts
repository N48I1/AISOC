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
