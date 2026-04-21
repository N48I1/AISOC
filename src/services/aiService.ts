/**
 * aiService.ts — frontend AI service layer
 * All heavy LLM work runs on the server (agents.ts + LangGraph).
 * These functions are thin wrappers that call the backend API.
 */

const API = "/api/ai";

export type AgentPhase =
  | "analysis"
  | "intel"
  | "knowledge"
  | "correlation"
  | "ticketing"
  | "response"
  | "validation";

export interface AgentModelConfig {
  agents: Array<{ phase: AgentPhase; name: string; desc: string }>;
  defaults: Record<AgentPhase, string>;
  assignments: Record<AgentPhase, string>;
  availableModels: string[];
}

function getToken(): string {
  return localStorage.getItem("soc_token") || "";
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
  };
}

// ─── Run a single agent phase ─────────────────────────────────────────────────
// Called by the "Run" button on each agent card in AlertDetail.
// `state` carries the current alert + whatever previous agents already produced.
export async function runAgentPhase(phase: string, state: any): Promise<any> {
  const res = await fetch(`${API}/agent`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ phase, state }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Agent request failed (${res.status})`);
  }

  return res.json();
}

// ─── Trigger full 7-agent swarm for an alert ─────────────────────────────────
// Called automatically when a NEW alert is detected.
// The server runs the full LangGraph pipeline, writes results to the DB,
// and emits socket.io events — the `onUpdate` callback handles state sync.
export async function orchestrateAnalysis(
  alert: any,
  _recentAlerts: any[],
  onUpdate: (data: any) => void
): Promise<void> {
  // Optimistically mark as analyzing in the UI
  onUpdate({ status: "ANALYZING" });

  try {
    const res = await fetch(`${API}/orchestrate`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ alertId: alert.id }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Orchestration failed (${res.status})`);
    }

    const data = await res.json();
    onUpdate(data);
  } catch (err: any) {
    console.error("[orchestrateAnalysis]", err?.message);
    onUpdate({ status: "NEW" }); // revert on failure so analyst can retry
  }
}

export async function getAlertRuns(alertId: string): Promise<any[]> {
  const res = await fetch(`/api/alerts/${alertId}/runs`, {
    headers: authHeaders(),
  });
  if (!res.ok) return [];
  return res.json();
}

export async function saveAlertRun(alertId: string, data: {
  ai_analysis?: string;
  mitre_attack?: string;
  remediation_steps?: string;
  status?: string;
}): Promise<{ id: number; run_at: string }> {
  const res = await fetch(`/api/alerts/${alertId}/runs`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to save run snapshot');
  return res.json();
}

export async function getAgentModelConfig(): Promise<AgentModelConfig> {
  const res = await fetch(`${API}/models`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to load agent models (${res.status})`);
  }
  return res.json();
}

export async function updateAgentModel(phase: AgentPhase, model: string): Promise<AgentModelConfig> {
  const res = await fetch(`${API}/models/${phase}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ model }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update model (${res.status})`);
  }

  const data = await res.json();
  const cfg = await getAgentModelConfig();
  return {
    ...cfg,
    assignments: data.assignments || cfg.assignments,
  };
}
