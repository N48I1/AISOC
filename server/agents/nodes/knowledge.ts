import { z } from "zod";
import { callStructuredLLM, type RunContext } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";
import { ReasoningSchema, REASONING_PROMPT_INSTRUCTION, REASONING_JSON_EXAMPLE } from "../memory/reasoning.js";

const KnowledgeSchema = z.object({
  remediation_steps:        z.string(),
  playbook_reference:       z.string().default("General Incident Response Playbook"),
  containment_priority:     z.enum(["IMMEDIATE", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  estimated_effort_minutes: z.number().default(60),
  confidence:               z.number().min(0).max(1).default(0),
  reasoning:                ReasoningSchema.optional(),
});

export async function ragKnowledgeNode(state: any, model: string = DEFAULT_AGENT_MODELS.knowledge, ctx?: RunContext) {
  const logs: string[] = [];
  logs.push(`[Knowledge] Fetching playbooks for tactic: ${state.analysis?.attack_category || "Unknown"}`);

  const knowledge = await callStructuredLLM({
    phase: "knowledge",
    model,
    schema: KnowledgeSchema,
    systemPrompt: `You are a Security Playbook Retrieval Agent. Provide numbered remediation steps tailored to the alert. Respond ONLY with valid JSON:

{
  "remediation_steps": "1. <first step>\\n2. <second step>\\n3. <third step>\\n4. <fourth step>\\n5. <fifth step>",
  "playbook_reference": "<e.g. NIST IR-2 or internal PB-WEB-001>",
  "containment_priority": "<IMMEDIATE|HIGH|MEDIUM|LOW>",
  "estimated_effort_minutes": 15,
  "confidence": 0.85,
  ${REASONING_JSON_EXAMPLE}
}

${REASONING_PROMPT_INSTRUCTION}
For the knowledge agent: evidence_for/against should reference the attack category and concrete elements of the alert that drove playbook selection. rejected_hypotheses should list other playbooks you considered (e.g. "PB-WEB-001 — rejected, no HTTP/web vector observed").`,
    userPrompt: `Alert: ${state.alert?.description || ""}\nLog: ${(state.alert?.full_log || "").slice(0, 500)}\nAnalysis: ${state.analysis?.analysis_summary || ""}`,
    fallback: {
      remediation_steps: "Playbook retrieval unavailable — LLM did not respond.",
      playbook_reference: "N/A",
      containment_priority: "HIGH",
      estimated_effort_minutes: 0,
      confidence: 0,
      reasoning: {
        decision:            "Knowledge agent did not respond — no playbook selected.",
        evidence_for:        [],
        evidence_against:    [],
        rejected_hypotheses: [],
        confidence:          0,
      },
    },
    ctx,
  });

  logs.push(`[Knowledge] Playbook identified: ${knowledge.playbook_reference}. Priority: ${knowledge.containment_priority}.`);

  return { knowledge, agentLogs: logs };
}
