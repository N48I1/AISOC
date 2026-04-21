import { z } from "zod";
import { callStructuredLLM } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";

const TicketSchema = z.object({
  title: z.string(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  report_body: z.string(),
  email_notification_sent: z.boolean(),
  affected_systems: z.array(z.string()),
  business_impact: z.string(),
  confidence: z.number().min(0).max(1),
});

export async function ticketingNode(state: any, model: string = DEFAULT_AGENT_MODELS.ticketing) {
  const ctx = {
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
  "confidence": 0.8
}`,
    userPrompt: `Context:\n${JSON.stringify(ctx, null, 2)}`,
    fallback: {
      title: "Security Incident — Investigation Required",
      priority: "HIGH",
      report_body:
        "An automated security incident was detected and requires manual investigation. Refer to the attached logs for details.",
      email_notification_sent: false,
      affected_systems: [],
      business_impact: "Unknown — pending investigation.",
      confidence: 0,
    },
  });

  return { ticket, emailSent: ticket.email_notification_sent || false };
}
