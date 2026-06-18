import { z } from "zod";
import { callStructuredLLM, type RunContext } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";
import { ReasoningSchema, REASONING_PROMPT_INSTRUCTION, REASONING_JSON_EXAMPLE } from "../memory/reasoning.js";

const TicketSchema = z.object({
  title:                   z.string(),
  priority:                z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  report_body:             z.string(),
  email_notification_sent: z.boolean().default(false),
  affected_systems:        z.array(z.string()).default([]),
  business_impact:         z.string().default("Unknown"),
  confidence:              z.number().min(0).max(1).default(0),
  reasoning:               ReasoningSchema.optional(),
});

export async function ticketingNode(state: any, model: string = DEFAULT_AGENT_MODELS.ticketing, ctx?: RunContext) {
  const logs: string[] = [];
  logs.push(`[Ticketing] Drafting official incident report and assessing business impact.`);

  const promptCtx = {
    alert: {
      description: state.alert?.description,
      severity: state.alert?.severity,
      source_ip: state.alert?.source_ip,
      agent: state.alert?.agent_name,
    },
    analysis: state.analysis,
    intel: state.intel,
    knowledge: state.knowledge,
    correlation: state.correlation,
  };

  const ticket = await callStructuredLLM({
    phase: "ticketing",
    model,
    schema: TicketSchema,
    systemPrompt: `You are an Incident Ticketing Agent. Write a professional, concise incident ticket. If priority is CRITICAL or HIGH set email_notification_sent to true. Respond ONLY with valid JSON:

{
  "title": "<incident title under 80 chars>",
  "priority": "<CRITICAL|HIGH|MEDIUM|LOW>",
  "report_body": "<4-5 sentences: what happened, affected assets, impact assessment, current containment status, next steps>",
  "email_notification_sent": true,
  "affected_systems": ["<hostname or IP>"],
  "business_impact": "<one sentence on business impact>",
  "confidence": 0.8,
  ${REASONING_JSON_EXAMPLE}
}

${REASONING_PROMPT_INSTRUCTION}
For ticketing: evidence_for/against should justify the priority choice with concrete signals from the analysis/intel. rejected_hypotheses should list other priority levels you considered (e.g. "CRITICAL — rejected, no exfiltration evidence and only one host affected").`,
    userPrompt: `Context:\n${JSON.stringify(promptCtx, null, 2)}`,
    fallback: {
      title: "Incident Ticket — Generation Failed",
      priority: "HIGH",
      report_body: "Ticket generation unavailable — LLM did not respond.",
      email_notification_sent: false,
      affected_systems: [],
      business_impact: "Unknown — ticket generation failed.",
      confidence: 0,
      reasoning: {
        decision:            "Ticketing agent did not respond — defaulting to HIGH priority pending review.",
        evidence_for:        [],
        evidence_against:    [],
        rejected_hypotheses: [],
        confidence:          0,
      },
    },
    ctx,
  });

  logs.push(`[Ticketing] Ticket created: "${ticket.title}". Priority: ${ticket.priority}.`);
  if (ticket.email_notification_sent) {
    logs.push(`[Ticketing] 📧 Email notification queued for delivery.`);
  }

  return { ticket, emailSent: ticket.email_notification_sent || false, agentLogs: logs };
}
