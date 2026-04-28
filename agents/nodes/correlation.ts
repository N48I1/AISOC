import { z } from "zod";
import { callStructuredLLM } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";

// related_alerts is intentionally NOT in this schema — the LLM reliably drops
// array fields. Instead, findRelatedAlerts() populates them deterministically.
const CorrelationSchema = z.object({
  campaign_detected:    z.boolean().default(false),
  campaign_name:        z.string().default("Isolated Incident"),
  campaign_description: z.string().default(""),
  escalation_needed:    z.boolean().default(false),
  kill_chain_stage:     z.string().default("UNKNOWN"),
  confidence:           z.number().min(0).max(1).default(0),
});

interface AlertSummary {
  id: string;
  description: string;
  source_ip: string;
  dest_ip: string;
  agent_name: string;
  hostname: string;
  timestamp: string;
  status: string;
}

function findRelatedAlerts(
  currentAlert: any,
  recentSummary: AlertSummary[],
): Array<{ id: string; description: string }> {
  const seedIps    = new Set<string>([currentAlert.source_ip, currentAlert.dest_ip].filter(Boolean));
  const seedAgents = new Set<string>([currentAlert.agent_name].filter(Boolean));
  const related    = new Map<string, { id: string; description: string }>();

  // Two hops catches pivot chains: attacker changes source IP as they move laterally
  for (let hop = 0; hop < 2; hop++) {
    for (const a of recentSummary) {
      if (a.id === currentAlert.id || related.has(a.id)) continue;
      const matches =
        (a.source_ip  && seedIps.has(a.source_ip))    ||
        (a.dest_ip    && seedIps.has(a.dest_ip))      ||
        (a.agent_name && seedAgents.has(a.agent_name));
      if (matches) {
        related.set(a.id, { id: a.id, description: a.description });
        if (a.source_ip)  seedIps.add(a.source_ip);
        if (a.dest_ip)    seedIps.add(a.dest_ip);
        if (a.agent_name) seedAgents.add(a.agent_name);
      }
    }
  }
  return Array.from(related.values());
}

export async function correlationNode(state: any, model: string = DEFAULT_AGENT_MODELS.correlation) {
  const logs: string[] = [];
  const recentAlertsCount = (state.recentAlerts || []).length;
  logs.push(`[Correlation] Scanning ${recentAlertsCount} recent alerts for multi-stage patterns.`);

  const recentSummary: AlertSummary[] = (state.recentAlerts || []).slice(0, 20).map((a: any) => ({
    id:          a.id,
    description: a.description,
    source_ip:   a.source_ip   || "",
    dest_ip:     a.dest_ip     || "",
    agent_name:  a.agent_name  || "",
    hostname:    a.hostname    || "",
    timestamp:   a.timestamp   || "",
    status:      a.status      || "",
  }));

  const correlationMeta = await callStructuredLLM({
    phase: "correlation",
    model,
    schema: CorrelationSchema,
    systemPrompt: `You are a Security Correlation Agent. Analyse the current alert against recent alerts to detect multi-stage attack campaigns. Respond ONLY with valid JSON:

{
  "campaign_detected": false,
  "campaign_name": "<descriptive name or 'Isolated Incident'>",
  "campaign_description": "<what the campaign appears to be>",
  "escalation_needed": false,
  "kill_chain_stage": "<Reconnaissance|Weaponization|Delivery|Exploitation|Installation|C2|Actions on Objectives>",
  "confidence": 0.8
}

CAMPAIGN DETECTION RULES — set campaign_detected=true when ANY of these patterns hold:
1. SAME ATTACKER IP: An IP appears as source_ip in one alert AND as dest_ip in another.
2. PROGRESSIVE KILL CHAIN: Alerts span multiple stages (Recon → Brute Force → Webshell → C2 → Lateral Movement → Exfiltration).
3. SHARED INFRASTRUCTURE: The same agent_name/hostname is victim in multiple alerts.
4. PIVOT CHAIN: The attacker's source IP changes as they move laterally — do NOT require the same source_ip across all alerts.

Only consider alerts within the 72-hour window provided.`,
    userPrompt: `Current alert (id: ${state.alert.id}):
${JSON.stringify(state.alert, null, 2)}

Recent alerts (last 72 hours):
${recentSummary.map((a, i) => `[${i + 1}] src=${a.source_ip || '—'} dst=${a.dest_ip || '—'} agent=${a.agent_name || '—'} | ${a.description}`).join('\n')}`,
    fallback: {
      campaign_detected:    false,
      campaign_name:        "Isolated Incident",
      campaign_description: "No multi-stage campaign pattern detected.",
      escalation_needed:    false,
      kill_chain_stage:     "Exploitation",
      confidence:           0,
    },
  });

  // Always derive related alerts from the graph — never trust the LLM to produce IDs
  const relatedAlerts = correlationMeta.campaign_detected
    ? findRelatedAlerts(state.alert, recentSummary)
    : [];

  const correlation = {
    ...correlationMeta,
    related_alerts:      relatedAlerts,
    related_alert_count: relatedAlerts.length,
  };

  if (correlation.campaign_detected) {
    logs.push(`[Correlation] CAMPAIGN DETECTED: "${correlation.campaign_name}". Linked to ${relatedAlerts.length} alert(s) via graph traversal.`);
    relatedAlerts.forEach(a => logs.push(`[Correlation]   → ${a.id}`));
  } else {
    logs.push(`[Correlation] No campaign pattern detected. Treating as isolated event.`);
  }

  return { correlation, agentLogs: logs };
}
