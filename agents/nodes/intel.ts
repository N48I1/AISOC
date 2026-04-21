import { z } from "zod";
import { callStructuredLLM } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";

const IntelSchema = z.object({
  mitre_attack: z.array(z.string()),
  risk_score: z.number(),
  intel_summary: z.string(),
  threat_actor_type: z.enum(["nation-state", "cybercriminal", "insider", "hacktivist", "unknown"]),
  campaign_family: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export async function threatIntelNode(state: any, model: string = DEFAULT_AGENT_MODELS.intel) {
  const iocs = state.analysis?.iocs || {};
  const alert = state.alert;

  const intel = await callStructuredLLM({
    phase: "intel",
    model,
    schema: IntelSchema,
    systemPrompt: `You are a Threat Intelligence Agent with deep knowledge of MITRE ATT&CK. Map the IOCs and alert context to MITRE techniques. Respond ONLY with valid JSON:

{
  "mitre_attack": ["T1190", "T1059.001"],
  "risk_score": 8,
  "intel_summary": "<2-3 sentence threat assessment>",
  "threat_actor_type": "<nation-state|cybercriminal|insider|hacktivist|unknown>",
  "campaign_family": "<malware or campaign name, or null>",
  "confidence": 0.85
}`,
    userPrompt: `IOCs: ${JSON.stringify(iocs)}\nAlert: ${alert?.description || ""} | Rule: ${alert?.rule_id || ""}`,
    fallback: {
      mitre_attack: [],
      risk_score: 5,
      intel_summary: "Threat intelligence unavailable.",
      threat_actor_type: "unknown",
      campaign_family: null,
      confidence: 0,
    },
  });

  return { intel };
}
