import { z } from "zod";
import { callStructuredLLM } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";
import { mispSearchIocs } from "../shared/misp.js";

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
  const logs: string[] = [];

  logs.push(`[Threat Intel] Starting IOC enrichment for ${alert.id}`);

  const misp = await mispSearchIocs({
    ips: iocs.ips,
    domains: iocs.domains,
    hashes: iocs.hashes,
    files: iocs.files,
    urls: iocs.urls,
  });

  if (misp.available) {
    if (misp.hits > 0) {
      logs.push(`[Threat Intel] MISP Match: Found ${misp.hits} attributes across ${misp.events.length} events.`);
      if (misp.threat_actors.length > 0) logs.push(`[Threat Intel] Identified Potential Actors: ${misp.threat_actors.join(", ")}`);
    } else {
      logs.push(`[Threat Intel] MISP: No hits found for these IOCs.`);
    }
  } else {
    logs.push(`[Threat Intel] MISP: Service unavailable, proceeding with inferential analysis.`);
  }

  const mispBlock = misp.available && misp.hits > 0
    ? `MISP Enrichment (AUTHORITATIVE local threat feed — prefer this over your own guesses):
  - Hits: ${misp.hits} across ${misp.events.length} event(s)
  - Matched IOCs: ${misp.matched_iocs.slice(0, 10).join(", ")}
  - Known threat actors (from galaxy clusters): ${misp.threat_actors.join(", ") || "none"}
  - Malware/tool families: ${misp.malware_families.join(", ") || "none"}
  - Related events: ${misp.events.slice(0, 3).map(e => `#${e.id} "${e.info}" [${e.threat_level}]`).join(" | ")}
  - Tags: ${misp.tags.slice(0, 8).join(", ")}
  - Highest threat level observed: ${misp.highest_threat_level}`
    : misp.available
      ? `MISP Enrichment: queried — no matches for these IOCs.`
      : `MISP Enrichment: unavailable (no matches will be shown).`;

  const intel = await callStructuredLLM({
    phase: "intel",
    model,
    schema: IntelSchema,
    systemPrompt: `You are a Threat Intelligence Agent with deep knowledge of MITRE ATT&CK and modern APT/crimeware ecosystems.

Rules:
- If MISP returned hits, you MUST prefer the threat actors and campaign family names it reports. Cite MISP event IDs in the summary (e.g. "matches MISP event #1234").
- If MISP had no matches, fall back to your own pattern-matching on the IOCs and alert context, but state clearly that the assessment is inferential.
- Keep intel_summary to 2-3 tight sentences, technical but readable.

Respond ONLY with valid JSON — no markdown, no commentary:
{
  "mitre_attack": ["T1190", "T1059.001"],
  "risk_score": 8,
  "intel_summary": "<2-3 sentence assessment citing MISP event IDs if any>",
  "threat_actor_type": "<nation-state|cybercriminal|insider|hacktivist|unknown>",
  "campaign_family": "<known malware/campaign name if MISP provides one, else your best inference or null>",
  "confidence": 0.85
}`,
    userPrompt: `IOCs: ${JSON.stringify(iocs)}
Alert: ${alert?.description || ""} | Rule: ${alert?.rule_id || ""}

${mispBlock}`,
    fallback: {
      mitre_attack: [],
      risk_score: 5,
      intel_summary: "Threat intelligence unavailable.",
      threat_actor_type: "unknown",
      campaign_family: null,
      confidence: 0,
    },
  });

  return { intel: { ...intel, misp }, agentLogs: logs };
}
