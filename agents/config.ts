export const AGENT_PHASES = [
  "analysis",
  "intel",
  "knowledge",
  "correlation",
  "ticketing",
  "response",
  "validation",
] as const;

export type AgentPhase = (typeof AGENT_PHASES)[number];

export const OPENROUTER_FREE_MODELS = [
  "openai/gpt-oss-120b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "meta-llama/llama-3.2-3b-instruct:free",
  "google/gemma-3-12b-it:free",
  "google/gemma-2-9b-it:free",
  "mistralai/mistral-7b-instruct:free",
] as const;

export type OpenRouterFreeModel = (typeof OPENROUTER_FREE_MODELS)[number];

export const DEFAULT_AGENT_MODELS: Record<AgentPhase, OpenRouterFreeModel> = {
  analysis:    "google/gemma-2-9b-it:free",
  intel:       "google/gemma-2-9b-it:free",
  knowledge:   "google/gemma-2-9b-it:free",
  correlation: "google/gemma-2-9b-it:free",
  ticketing:   "google/gemma-2-9b-it:free",
  response:    "google/gemma-2-9b-it:free",
  validation:  "google/gemma-2-9b-it:free",
};

export const AGENT_METADATA: Record<AgentPhase, { name: string; desc: string }> = {
  analysis: {
    name: "Alert Triage Agent",
    desc: "Interprets Wazuh alerts, extracts IOCs (IP, user, host), validates severity, and detects false positives.",
  },
  intel: {
    name: "Threat Intelligence Agent",
    desc: "Enriches IOCs, maps findings to MITRE ATT&CK, and assesses reputation risk.",
  },
  knowledge: {
    name: "RAG Knowledge Agent",
    desc: "Retrieves playbooks, proposes remediation steps, and references SOPs.",
  },
  correlation: {
    name: "Correlation Agent",
    desc: "Detects multi-alert patterns, identifies campaign links, and escalates risk.",
  },
  ticketing: {
    name: "Ticketing Agent",
    desc: "Generates a structured incident report/ticket and assigns priority.",
  },
  response: {
    name: "Response Agent",
    desc: "Recommends containment actions like block IP or disable user with approval checks.",
  },
  validation: {
    name: "Validation Agent",
    desc: "Verifies plan completeness, SLA alignment, and approval trail readiness.",
  },
};

export function isAgentPhase(value: string): value is AgentPhase {
  return AGENT_PHASES.includes(value as AgentPhase);
}

export type ModelAssignments = Partial<Record<AgentPhase, string>>;

export function resolveModelForPhase(phase: AgentPhase, assignments?: ModelAssignments): string {
  const override = assignments?.[phase];
  return override || DEFAULT_AGENT_MODELS[phase];
}
