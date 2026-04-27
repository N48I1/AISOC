import { z } from "zod";
import { callStructuredLLM } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";

const ACTION_TYPE_MAP: Record<string, string> = {
  BLOCK_HOST:        "ISOLATE_HOST",
  KILL_PROCESS:      "QUARANTINE_FILE",
  ALERT_TEAM:        "NOTIFY_TEAM",
  BLOCK_USER:        "DISABLE_USER",
  RESET_CREDENTIALS: "RESET_PASSWORD",
  QUARANTINE_HOST:   "ISOLATE_HOST",
  TERMINATE_SESSION: "DISABLE_USER",
};

const VALID_TYPES = new Set([
  "BLOCK_IP", "DISABLE_USER", "ISOLATE_HOST",
  "QUARANTINE_FILE", "RESET_PASSWORD", "NOTIFY_TEAM",
]);

const ResponseSchema = z.object({
  actions: z.array(
    z.object({
      type:      z.string(),
      target:    z.string().default(""),
      reason:    z.string().default(""),
      priority:  z.number().default(1),
      automated: z.boolean().default(false),
    }),
  ).default([]),
  approval_required:          z.boolean().default(false),
  estimated_containment_time: z.string().default("unknown"),
  confidence:                 z.number().min(0).max(1).default(0),
});

export async function responseNode(state: any, model: string = DEFAULT_AGENT_MODELS.response) {
  const logs: string[] = [];
  logs.push(`[Response] Formulating containment strategy and response actions.`);

  const ctx = {
    alert: {
      description: state.alert?.description,
      source_ip:   state.alert?.source_ip,
      agent_name:  state.alert?.agent_name,
    },
    analysis:    state.analysis,
    intel:       state.intel,
    correlation: state.correlation,
  };

  const raw = await callStructuredLLM({
    phase: "response",
    model,
    schema: ResponseSchema,
    systemPrompt: `You are the Automated Response Agent. Recommend specific, actionable containment steps. Respond ONLY with valid JSON:

{
  "actions": [
    {
      "type": "<BLOCK_IP|DISABLE_USER|ISOLATE_HOST|QUARANTINE_FILE|RESET_PASSWORD|NOTIFY_TEAM>",
      "target": "<IP address, username, hostname, or file path>",
      "reason": "<why this action is necessary>",
      "priority": 1,
      "automated": false
    }
  ],
  "approval_required": true,
  "estimated_containment_time": "15 minutes",
  "confidence": 0.8
}`,
    userPrompt: `Context:\n${JSON.stringify(ctx, null, 2)}`,
    fallback: {
      actions:                    [],
      approval_required:          true,
      estimated_containment_time: "unknown",
      confidence:                 0,
    },
  });

  // Normalise action types — map LLM synonyms to canonical enum values
  const responsePlan = {
    ...raw,
    actions: raw.actions.map((a: any) => ({
      ...a,
      type: ACTION_TYPE_MAP[a.type] ?? (VALID_TYPES.has(a.type) ? a.type : "NOTIFY_TEAM"),
    })),
  };

  if (responsePlan.actions.length > 0) {
    logs.push(`[Response] Proposed ${responsePlan.actions.length} action(s). Approval Required: ${responsePlan.approval_required}.`);
    responsePlan.actions.forEach((a: any) => logs.push(`[Response] Recommended: ${a.type} on ${a.target}`));
  } else {
    logs.push(`[Response] No automated containment actions recommended at this time.`);
  }

  return { responsePlan, agentLogs: logs };
}
