import { z } from "zod";
import { callStructuredLLM } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";

const CorrelationSchema = z.object({
  campaign_detected:    z.boolean().default(false),
  campaign_name:        z.string().default(""),
  campaign_description: z.string().default(""),
  related_alert_count:  z.number().default(0),
  escalation_needed:    z.boolean().default(false),
  kill_chain_stage:     z.string().default("UNKNOWN"),
  confidence:           z.number().min(0).max(1).default(0),
});

export async function correlationNode(state: any, model: string = DEFAULT_AGENT_MODELS.correlation) {
  const logs: string[] = [];
  const recentAlertsCount = (state.recentAlerts || []).length;
  logs.push(`[Correlation] Scanning ${recentAlertsCount} recent alerts for multi-stage patterns.`);

  const recentSummary = (state.recentAlerts || []).slice(0, 20).map((a: any) => ({
    id:          a.id,
    description: a.description,
    source_ip:   a.source_ip,
    timestamp:   a.timestamp,
    status:      a.status,
  }));

  const correlation = await callStructuredLLM({
    phase: "correlation",
    model,
    schema: CorrelationSchema,
    systemPrompt: `You are a Security Correlation Agent. Analyse the current alert against recent alerts to detect multi-stage campaigns. Respond ONLY with valid JSON:

{
  "campaign_detected": false,
  "campaign_name": "<descriptive name or 'Isolated Incident'>",
  "campaign_description": "<what the campaign appears to be>",
  "related_alert_count": 0,
  "escalation_needed": false,
  "kill_chain_stage": "<Reconnaissance|Weaponization|Delivery|Exploitation|Installation|C2|Actions on Objectives>",
  "confidence": 0.8
}

IMPORTANT: Only set campaign_detected=true if multiple related alerts appeared within a 72-hour window of the current alert. Alerts older than 72 hours should be treated as background noise and not used to declare a campaign.`,
    userPrompt: `Current alert:\n${JSON.stringify(state.alert, null, 2)}\n\nRecent alerts (last 72 hours):\n${JSON.stringify(recentSummary, null, 2)}`,
    fallback: {
      campaign_detected:    false,
      campaign_name:        "Isolated Incident",
      campaign_description: "No multi-stage campaign pattern detected.",
      related_alert_count:  0,
      escalation_needed:    false,
      kill_chain_stage:     "Exploitation",
      confidence:           0,
    },
  });

  if (correlation.campaign_detected) {
    logs.push(`[Correlation] CAMPAIGN DETECTED: "${correlation.campaign_name}". Linked to ${correlation.related_alert_count} other alerts.`);
  } else {
    logs.push(`[Correlation] No campaign pattern detected. Treating as isolated event.`);
  }

  return { correlation, agentLogs: logs };
}
