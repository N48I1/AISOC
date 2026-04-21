import { z } from "zod";
import { callStructuredLLM } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";

const AnalysisSchema = z.object({
  analysis_summary: z.string(),
  iocs: z.object({
    ips: z.array(z.string()),
    users: z.array(z.string()),
    hosts: z.array(z.string()),
  }),
  severity_validation: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
  is_false_positive: z.boolean(),
  false_positive_confidence: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1),
});

export async function alertAnalysisNode(state: any, model: string = DEFAULT_AGENT_MODELS.analysis) {
  const analysis = await callStructuredLLM({
    phase: "analysis",
    model,
    schema: AnalysisSchema,
    systemPrompt: `You are an expert SOC Alert Analysis Agent. Analyze the Wazuh security alert and respond ONLY with valid JSON — no markdown, no extra text.

Required JSON:
{
  "analysis_summary": "<2-3 sentence technical description of the threat>",
  "iocs": {
    "ips":   ["<IP addresses>"],
    "users": ["<usernames>"],
    "hosts": ["<hostnames or agent names>"]
  },
  "severity_validation": "<CRITICAL|HIGH|MEDIUM|LOW>",
  "is_false_positive": false,
  "false_positive_confidence": 0.2,
  "confidence": 0.9
}`,
    userPrompt: `Alert to analyze:\n${JSON.stringify(state.alert, null, 2)}`,
    fallback: {
      analysis_summary: "Alert analysis unavailable — LLM did not respond.",
      iocs: { ips: [], users: [], hosts: [] },
      severity_validation: "MEDIUM",
      is_false_positive: false,
      false_positive_confidence: 0,
      confidence: 0,
    },
  });

  if (typeof analysis.false_positive_confidence !== "number") {
    analysis.false_positive_confidence = analysis.is_false_positive ? analysis.confidence : 0;
  }

  return { analysis };
}
