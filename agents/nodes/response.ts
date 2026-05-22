import { z } from "zod";
import { callStructuredLLM, type RunContext } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";
import { ReasoningSchema, REASONING_PROMPT_INSTRUCTION, REASONING_JSON_EXAMPLE } from "../memory/reasoning.js";

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
  reasoning:                  ReasoningSchema.optional(),
});

export async function responseNode(state: any, model: string = DEFAULT_AGENT_MODELS.response, ctx?: RunContext) {
  const logs: string[] = [];
  logs.push(`[Response] Formulating containment strategy and response actions.`);

  const promptCtx = {
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
    systemPrompt: `You are the Automated Response Agent. Recommend specific, actionable containment steps. Respond ONLY with valid JSON.

CRITICAL RULES:
- Every action MUST have a concrete target (real IP, username, hostname, or file path from the alert context). NEVER emit "unknown", "N/A", "<target>", or any placeholder.
- If the alert has no IP, do NOT emit BLOCK_IP. If no user, do NOT emit DISABLE_USER or RESET_PASSWORD. If no host, do NOT emit ISOLATE_HOST. If no file, do NOT emit QUARANTINE_FILE.
- It is better to return an empty actions array than to invent a target. NOTIFY_TEAM is the only type that may have an empty target.
- Each action's reason must be 1 concrete sentence — no vague "investigate further" filler.

Schema:
{
  "actions": [
    {
      "type": "<BLOCK_IP|DISABLE_USER|ISOLATE_HOST|QUARANTINE_FILE|RESET_PASSWORD|NOTIFY_TEAM>",
      "target": "<exact IP / username / hostname / file path from the alert>",
      "reason": "<one concrete sentence>",
      "priority": 1,
      "automated": false
    }
  ],
  "approval_required": true,
  "estimated_containment_time": "15 minutes",
  "confidence": 0.8,
  ${REASONING_JSON_EXAMPLE}
}

${REASONING_PROMPT_INSTRUCTION}
For response: evidence_for/against should justify the chosen actions. rejected_hypotheses should list response strategies you considered and dropped (e.g. "BLOCK_IP — rejected, source IP is internal NAT shared by many users; would cause collateral disruption").`,
    userPrompt: `Context:\n${JSON.stringify(promptCtx, null, 2)}`,
    fallback: {
      actions:                    [],
      approval_required:          true,
      estimated_containment_time: "unknown",
      confidence:                 0,
      reasoning: {
        decision:            "Response agent did not respond — no containment actions proposed.",
        evidence_for:        [],
        evidence_against:    [],
        rejected_hypotheses: [],
        confidence:          0,
      },
    },
    ctx,
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
