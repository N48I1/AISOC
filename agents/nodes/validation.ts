import { z } from "zod";
import { callStructuredLLM } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";

const ValidationSchema = z.object({
  is_valid:           z.boolean(),
  sla_status:         z.enum(["SLA_MET", "SLA_AT_RISK", "SLA_BREACHED"]),
  completeness_score: z.number(),
  missing_elements:   z.array(z.string()),
  recommendation:     z.enum(["CLOSE", "ESCALATE", "MONITOR", "INVESTIGATE_FURTHER"]),
  confidence:         z.number().min(0).max(1),
});

const SLA_WINDOWS: Record<string, number> = {
  CRITICAL: 15,
  HIGH:     60,
  MEDIUM:   240,
  LOW:      1440,
};

export async function validationNode(state: any, model: string = DEFAULT_AGENT_MODELS.validation) {
  const logs: string[] = [];
  logs.push(`[Validation] Running final SLA and quality assurance checks.`);

  const alertTimestamp = state.alert?.timestamp || state.alert?.created_at;
  const severityLevel  = state.alert?.severity ?? 0;
  const severityLabel  =
    severityLevel >= 13 ? "CRITICAL" :
    severityLevel >= 10 ? "HIGH" :
    severityLevel >= 7  ? "MEDIUM" : "LOW";
  const slaWindowMinutes = SLA_WINDOWS[severityLabel] ?? 240;

  let ageMinutes = 0;
  if (alertTimestamp) {
    ageMinutes = Math.round((Date.now() - new Date(alertTimestamp).getTime()) / 60000);
  }

  const ctx = {
    ticket:             state.ticket,
    responsePlan:       state.responsePlan,
    analysis_complete:  !!state.analysis,
    intel_complete:     !!state.intel,
    knowledge_complete: !!state.knowledge,
    correlation_done:   !!state.correlation,
    alert_age_minutes:  ageMinutes,
    severity:           severityLabel,
    sla_window_minutes: slaWindowMinutes,
  };

  const validation = await callStructuredLLM({
    phase: "validation",
    model,
    schema: ValidationSchema,
    systemPrompt: `You are the SLA & Quality Validation Agent. Verify the incident response is thorough and within policy. Respond ONLY with valid JSON:

{
  "is_valid": true,
  "sla_status": "<SLA_MET|SLA_AT_RISK|SLA_BREACHED>",
  "completeness_score": 90,
  "missing_elements": [],
  "recommendation": "<CLOSE|ESCALATE|MONITOR|INVESTIGATE_FURTHER>",
  "confidence": 0.85
}

SLA POLICY (use alert_age_minutes and sla_window_minutes from the context to compute):
- SLA_MET     = alert_age_minutes <= sla_window_minutes
- SLA_AT_RISK = alert_age_minutes between 75% and 100% of sla_window_minutes
- SLA_BREACHED= alert_age_minutes > sla_window_minutes

Severity windows: CRITICAL=15 min, HIGH=60 min, MEDIUM=240 min, LOW=1440 min.`,
    userPrompt: `Incident context:\n${JSON.stringify(ctx, null, 2)}`,
    fallback: {
      is_valid:           false,
      sla_status:         "SLA_BREACHED",
      completeness_score: 0,
      missing_elements:   ["Validation unavailable — LLM did not respond"],
      recommendation:     "INVESTIGATE_FURTHER",
      confidence:         0,
    },
  });

  logs.push(`[Validation] Quality Score: ${validation.completeness_score}%. SLA Status: ${validation.sla_status}. Recommendation: ${validation.recommendation}.`);
  logs.push(`[Agents] All agents finished. Finalizing state.`);

  return { validation, agentLogs: logs };
}
