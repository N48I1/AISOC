import { z } from "zod";
import { callStructuredLLM } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";

const ValidationSchema = z.object({
  is_valid: z.boolean(),
  sla_status: z.enum(["SLA_MET", "SLA_AT_RISK", "SLA_BREACHED"]),
  completeness_score: z.number(),
  missing_elements: z.array(z.string()),
  recommendation: z.enum(["CLOSE", "ESCALATE", "MONITOR", "INVESTIGATE_FURTHER"]),
  confidence: z.number().min(0).max(1),
});

export async function validationNode(state: any, model: string = DEFAULT_AGENT_MODELS.validation) {
  const ctx = {
    ticket: state.ticket,
    responsePlan: state.responsePlan,
    analysis_complete: !!state.analysis,
    intel_complete: !!state.intel,
    knowledge_complete: !!state.knowledge,
    correlation_done: !!state.correlation,
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
}`,
    userPrompt: `Incident context:\n${JSON.stringify(ctx, null, 2)}`,
    fallback: {
      is_valid: true,
      sla_status: "SLA_MET",
      completeness_score: 70,
      missing_elements: [],
      recommendation: "MONITOR",
      confidence: 0,
    },
  });

  return { validation };
}
