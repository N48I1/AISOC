import { z } from "zod";
import { callStructuredLLM, type RunContext } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";
import { ReasoningSchema, REASONING_PROMPT_INSTRUCTION, REASONING_JSON_EXAMPLE } from "../memory/reasoning.js";
import { buildAlertContext } from "../alert-context.js";

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
  const alertContext = buildAlertContext(state.alert);

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
    systemPrompt: `You are a senior SOC analyst writing the incident report that appears in the "AI Analysis & Conclusion" panel. Your job is to demonstrate expert-level intelligence: synthesise every agent's findings AND the raw event into one clear, specific, actionable report. Respond ONLY with valid JSON.

The "report_body" field MUST be GitHub-Flavored **Markdown** (it is rendered as markdown in the UI). Make it genuinely useful and detailed — like an expert writing for a colleague, not a terse blurb. Structure it with these sections (omit a section only if truly not applicable):

## Incident Summary
2-4 sentences: what happened, on which host/asset, and whether this is a security threat or an operational/configuration failure (say which, plainly).

## Technical Details
A Markdown table of the concrete artifacts pulled from the RAW EVENT and analysis — e.g. affected host, application/service, process path, error/event code, required vs found software versions, rule id, URLs. Quote EXACT values.

| Field | Value |
| --- | --- |
| … | … |

## Root Cause
1-3 sentences naming the precise cause.

## Impact
Business/operational impact, affected systems.

## Recommended Resolution
A numbered list of specific, actionable steps (exact commands, file paths, versions, download URLs, service/host names) — concrete enough to execute. Prefer the steps from the remediation/knowledge agent; refine them with exact values from the raw event.

## MITRE / IOCs
Brief: relevant MITRE techniques and key indicators (only if security-relevant).

JSON shape:
{
  "title": "<incident title under 80 chars>",
  "priority": "<CRITICAL|HIGH|MEDIUM|LOW>",
  "report_body": "<the full Markdown report described above>",
  "email_notification_sent": true,
  "affected_systems": ["<hostname or IP>"],
  "business_impact": "<one sentence on business impact>",
  "confidence": 0.8,
  ${REASONING_JSON_EXAMPLE}
}

Set email_notification_sent to true if priority is CRITICAL or HIGH.
${REASONING_PROMPT_INSTRUCTION}
For ticketing: evidence_for/against should justify the priority choice with concrete signals. rejected_hypotheses should list other priority levels you considered.`,
    userPrompt: `Agent findings:\n${JSON.stringify(promptCtx, null, 2)}\n\nNORMALIZED RAW EVENT CONTEXT (mine for exact services, paths, versions, error codes, URLs):\n${alertContext}`,
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
