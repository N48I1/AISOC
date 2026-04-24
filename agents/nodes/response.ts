import { z } from "zod";
import { callStructuredLLM } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";

const ResponseSchema = z.object({
  actions: z.array(
    z.object({
      type: z.enum(["BLOCK_IP", "DISABLE_USER", "ISOLATE_HOST", "QUARANTINE_FILE", "RESET_PASSWORD", "NOTIFY_TEAM"]),
      target: z.string(),
      reason: z.string(),
      priority: z.number(),
      automated: z.boolean(),
    }),
  ),
  approval_required: z.boolean(),
  estimated_containment_time: z.string(),
  confidence: z.number().min(0).max(1),
});

export async function responseNode(state: any, model: string = DEFAULT_AGENT_MODELS.response) {
  const logs: string[] = [];
  logs.push(`[Response] Formulating containment strategy and response actions.`);

  const ctx = {
    alert: {
      description: state.alert?.description,
      source_ip: state.alert?.source_ip,
      agent_name: state.alert?.agent_name,
    },
    analysis: state.analysis,
    intel: state.intel,
    correlation: state.correlation,
  };

  const responsePlan = await callStructuredLLM({
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
      actions: [],
      approval_required: true,
      estimated_containment_time: "unknown",
      confidence: 0,
    },
  });

  if (responsePlan.actions.length > 0) {
    logs.push(`[Response] Proposed ${responsePlan.actions.length} action(s). Approval Required: ${responsePlan.approval_required}.`);
    responsePlan.actions.forEach((a: any) => logs.push(`[Response] Recommended: ${a.type} on ${a.target}`));
  } else {
    logs.push(`[Response] No automated containment actions recommended at this time.`);
  }

  return { responsePlan, agentLogs: logs };
}
