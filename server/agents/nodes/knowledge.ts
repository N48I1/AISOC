import { z } from "zod";
import { callStructuredLLM, type RunContext } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";
import { ReasoningSchema, REASONING_PROMPT_INSTRUCTION, REASONING_JSON_EXAMPLE } from "../memory/reasoning.js";
import { buildAlertContext } from "../alert-context.js";

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
  const alertContext = buildAlertContext(state.alert);

  const knowledge = await callStructuredLLM({
    phase: "knowledge",
    model,
    schema: KnowledgeSchema,
    systemPrompt: `You are a Security Remediation Agent. Produce SPECIFIC, actionable remediation steps tailored to THIS exact alert — not a generic playbook. Read the RAW EVENT LOG and use the concrete details in it: name the exact service/application, file paths, software versions, the precise fix (e.g. "install .NET 8.0.0 ASP.NET Core Runtime x64"), any download URL present in the event, config changes, and the service/host to act on. If the event is an operational/configuration failure (missing runtime, expired cert, disk full), give the operational fix — do not force a security-incident framing. Respond ONLY with valid JSON:

{
  "remediation_steps": "1. <specific step naming exact artifact>\\n2. <step, include exact versions / paths / URLs from the event>\\n3. <step>\\n4. <verification step>",
  "playbook_reference": "<e.g. NIST IR-2, internal PB-XXX, or 'Operational: .NET runtime remediation'>",
  "containment_priority": "<IMMEDIATE|HIGH|MEDIUM|LOW>",
  "estimated_effort_minutes": 15,
  "confidence": 0.85,
  ${REASONING_JSON_EXAMPLE}
}

${REASONING_PROMPT_INSTRUCTION}
For the knowledge agent: evidence_for/against should reference concrete elements of the event that drove the remediation. rejected_hypotheses should list other approaches you considered.`,
    userPrompt: `Alert: ${state.alert?.description || ""}\nAnalysis: ${state.analysis?.analysis_summary || ""}\n\nNORMALIZED RAW EVENT CONTEXT (extract exact services, paths, versions, URLs from here):\n${alertContext}`,
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
