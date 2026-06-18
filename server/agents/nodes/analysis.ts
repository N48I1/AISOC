import { z } from "zod";
import { callStructuredLLM, type RunContext } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";
import {
  ReasoningSchema,
  REASONING_PROMPT_INSTRUCTION,
  REASONING_JSON_EXAMPLE,
  type ReasoningRow,
} from "../memory/reasoning.js";

const IocSchema = z.object({
  ips:       z.array(z.string()).default([]),
  users:     z.array(z.string()).default([]),
  hosts:     z.array(z.string()).default([]),
  hashes:    z.array(z.string()).default([]),
  files:     z.array(z.string()).default([]),
  ports:     z.array(z.number()).default([]),
  domains:   z.array(z.string()).default([]),
  processes: z.array(z.string()).default([]),
  urls:      z.array(z.string()).default([]),
});

const AnalysisSchema = z.object({
  analysis_summary:          z.string(),
  iocs:                      IocSchema.default({ ips: [], users: [], hosts: [], hashes: [], files: [], ports: [], domains: [], processes: [], urls: [] }),
  attack_category:           z.string().default("UNKNOWN"),
  kill_chain_stage:          z.string().default("UNKNOWN"),
  risk_score:                z.number().min(0).max(100).default(0),
  severity_validation:       z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  recommended_action:        z.enum(["MONITOR", "INVESTIGATE", "CONTAIN", "ESCALATE", "BLOCK", "IGNORE"]).default("INVESTIGATE"),
  is_false_positive:         z.boolean().default(false),
  // The model frequently sends `null` for non-FP alerts. Both `null` and
  // omitted are acceptable; we normalise either to undefined downstream.
  false_positive_reason:     z.string().nullable().optional(),
  false_positive_confidence: z.number().min(0).max(1).default(0),
  confidence:                z.number().min(0).max(1).default(0),
  reasoning:                 ReasoningSchema.optional(),
});

const SYSTEM_PROMPT = `You are a SOC Alert Triage Agent specializing in Wazuh SIEM alerts.
Analyze the provided alert and related context, then respond ONLY with valid JSON — no markdown, no extra text.

SEVERITY THRESHOLDS (Wazuh rule.level):
- CRITICAL: level >= 13 (rootkit, mass brute force, data exfil indicators)
- HIGH:     level 10-12 (priv-esc, successful auth after failures, malware exec)
- MEDIUM:   level  7-9  (brute force attempts, policy violations)
- LOW:      level  1-6  (informational, low-risk anomalies)

FALSE POSITIVE INDICATORS — set is_false_positive=true and populate false_positive_reason when:
- rule.description contains "test", "scan", "nmap", "healthcheck"
- agent.name contains "monitoring", "backup", "scanner"
- src_ip is RFC1918 (10.x, 172.16-31.x, 192.168.x) AND rule.level < 8
- 3+ identical alerts from same src_ip appear in recentAlerts with no escalation
- known maintenance patterns in data.program_name (cron, logrotate, backup scripts)

MEMORY-DRIVEN FP RULES (THESE ARE AUTHORITATIVE — TREAT AS GROUND TRUTH):
- If KNOWN ASSET CONTEXT lists any IOC with fp_default=true AND the alert does NOT
  show exfiltration / lateral movement / credential access: set is_false_positive=true
  with false_positive_confidence in [0.82, 0.90]. Do NOT exceed 0.90 — the asset
  could be compromised even if it is a known scanner.
- If PRIOR FALSE-POSITIVE OUTCOMES has a >85% similar past incident: bias toward
  false_positive=true with confidence in [0.78, 0.86]. Lower end if this alert has
  new severity, new IOCs, or new attack patterns not in the prior one.
- If IOC HISTORY shows fp_ratio >= 0.85 with at least 5 prior observations: bias
  toward false_positive=true with confidence in [0.76, 0.84].
- When multiple memory signals agree (e.g. known asset + prior FP outcome), you may
  combine them up to a maximum of 0.91.
- The exfil/lateral/credential exception is non-negotiable — never auto-FP those patterns.
- Calibrate honestly: 0.75 means "likely FP but worth a second look", 0.90 means
  "very strong prior evidence, near-certain FP". Never assign > 0.92 from LLM alone.

PRIORITY ASSIGNMENT — when uncertain, BIAS TOWARD LOWER PRIORITY:
- Use CRITICAL only with multi-IOC, multi-host, or active exploitation evidence
- Use HIGH only when description explicitly contains attack TTPs (credential access,
  lateral movement, exfiltration, privilege escalation, C2)
- Use MEDIUM or LOW by default for: routine traffic, scanner/monitoring activity,
  isolated policy violations, single-host benign-looking events
- LOW and MEDIUM priority alerts are AUTO-ARCHIVED to the FP archive; only HIGH and
  CRITICAL reach a human analyst. Lower priority is reversible (analyst can escalate
  from the archive); over-prioritization wastes scarce SOC time.
- When memory hints (fp_default assets, similar past FPs, high IOC fp_ratio) suggest
  noise but you can't fully commit to is_false_positive=true, drop priority to LOW
  instead of MEDIUM/HIGH. The system will archive it and the memory loop will reinforce.

ATTACK CATEGORY: Choose the single MITRE ATT&CK tactic that best matches the alert intent.

KILL CHAIN STAGE: Map to the Lockheed Martin Kill Chain phase:
  RECONNAISSANCE | WEAPONIZATION | DELIVERY | EXPLOITATION | INSTALLATION | C2 | ACTIONS_ON_OBJECTIVES

RISK SCORE (0-100):
  Base = rule.level * 6 (max 78 at level 13+)
  +10 if lateral movement signals present
  +10 if credential access category
  +5  if external IP (non-RFC1918) as src
  -15% of base score if is_false_positive=true (proportional discount, not flat)

  HARD FLOOR — risk_score MUST be at least max(5, rule.level * 2):
    level  1 → min  5   level  5 → min 10
    level 10 → min 20   level 15 → min 30
  This floor applies even for confirmed false positives — the raw event still happened.
  NEVER output 0 or any value below the floor. Clamp final result to [floor, 100].

RECOMMENDED_ACTION rules:
  IGNORE      if false_positive_confidence > 0.85
  BLOCK       if risk_score >= 80
  CONTAIN     if risk_score >= 60
  ESCALATE    if risk_score >= 50
  INVESTIGATE if risk_score >= 20
  MONITOR     otherwise

IOC extraction:
  ips:       all src/dst IPs from data.srcip, data.dstip, data.win.eventdata.destinationIp
  users:     data.dstuser, data.srcuser, data.win.eventdata.targetUserName, data.win.eventdata.subjectUserName
  hosts:     agent.name, data.hostname, data.win.system.computer
  hashes:    any 32/40/64 hex strings in data.* (MD5/SHA1/SHA256)
  files:     data.win.eventdata.image, data.file, data.audit.file.name, data.win.eventdata.targetFilename
  ports:     data.dstport, data.srcport as integers (omit 0)
  domains:   data.win.eventdata.destinationHostname, DNS query names in data.*
  processes: data.win.eventdata.parentImage, data.win.eventdata.originalFileName, data.audit.command
  urls:      any http/https URLs in data.win.eventdata.destinationUrl, data.url, data.http.url, data.web.url

Respond with this exact JSON structure:
{
  "analysis_summary": "<2-4 sentence technical description>",
  "iocs": { "ips": [], "users": [], "hosts": [], "hashes": [], "files": [], "ports": [], "domains": [], "processes": [], "urls": [] },
  "attack_category": "<MITRE tactic enum>",
  "kill_chain_stage": "<kill chain enum>",
  "risk_score": 45,
  "severity_validation": "<CRITICAL|HIGH|MEDIUM|LOW>",
  "recommended_action": "<action enum>",
  "is_false_positive": false,
  "false_positive_reason": "<reason string or omit if not FP>",
  "false_positive_confidence": 0.1,
  "confidence": 0.85,
  ${REASONING_JSON_EXAMPLE}
}

REASONING BLOCK — this is the visible chain of thought the analyst will read.
${REASONING_PROMPT_INSTRUCTION}
For triage specifically, the reasoning fields should reflect the FP-vs-real decision:
  - decision: state whether this is FP, real, or uncertain, and why in one sentence
  - evidence_for: signals that point toward your is_false_positive choice
  - evidence_against: signals that argue against it (be honest — if asset_context says fp_default but the alert mentions credential access, list that here)
  - rejected_hypotheses: alternative attack interpretations you considered (e.g. "lateral movement — rejected because no SMB/RDP traffic", "scanner activity — rejected because dst_port is non-standard")`;

export async function alertAnalysisNode(state: any, model: string = DEFAULT_AGENT_MODELS.analysis, ctx?: RunContext) {
  const a = state.alert;
  const logs: string[] = [];

  logs.push(`[Analysis] Initializing triage for alert ${a.id}`);

  // For DB-sourced alerts a.data is undefined; parse from full_log if available
  let parsedData: any = a.data ?? {};
  if (!a.data && a.full_log) {
    try { parsedData = JSON.parse(a.full_log).data ?? {}; } catch {}
  }

  const related = (state.recentAlerts || [])
    .filter((r: any) => r.id !== a.id)
    .slice(0, 10)
    .map((r: any) => ({
      id:          r.id,
      rule_id:     r.data?.rule?.id,
      description: r.data?.rule?.description,
      level:       r.data?.rule?.level,
      src_ip:      r.data?.srcip,
      agent:       r.data?.agent?.name,
      timestamp:   r.timestamp,
    }));

  if (related.length > 0) {
    logs.push(`[Analysis] Correlating against ${related.length} historical alerts from same source/agent.`);
  }

  // ── Intelligence context blocks ──────────────────────────────────────────
  const assetCtx: any[]  = Array.isArray(state.assetContext)    ? state.assetContext    : [];
  const priorFp: any[]   = Array.isArray(state.priorFpInsights) ? state.priorFpInsights : [];
  const iocHits: any[]   = Array.isArray(state.iocMemoryHits)   ? state.iocMemoryHits   : [];
  const suppHit: any     = state.suppressionHit ?? null;
  const corrResult: any  = state.correlationResult ?? null;
  const priorReasoning: Array<{ alert_id: string; similarity: number; outcome?: string; reasoning: ReasoningRow[] }> =
    Array.isArray(state.priorReasoning) ? state.priorReasoning : [];

  const assetBlock = assetCtx.length ? assetCtx.map((a: any) =>
    `- ${a.value} (${a.type}) → ${a.role}${a.fp_default ? ' [fp_default=TRUE]' : ''}${a.description ? ` — ${a.description}` : ''}`
  ).join('\n') : '';

  const priorFpBlock = priorFp.length ? priorFp.slice(0, 3).map((h: any) =>
    `- ${(h.similarity * 100).toFixed(0)}% similar (${h.alert_id}, ${h.created_at?.slice(0, 10) || '?'}): ${(h.summary || '').slice(0, 140)} → FALSE_POSITIVE`
  ).join('\n') : '';

  const iocHistBlock = iocHits.length ? iocHits.slice(0, 8).map((h: any) => {
    const total = (h.fp_count ?? 0) + (h.tp_count ?? 0);
    const seenStr = `seen ${h.alert_count}× — ${h.fp_count ?? 0} FP / ${h.tp_count ?? 0} TP`;
    const ratioStr = total > 0 ? `, fp_ratio=${(h.fp_ratio ?? 0).toFixed(2)}` : '';
    return `- ${h.value} (${h.type}): ${seenStr}${ratioStr}`;
  }).join('\n') : '';

  // Suppression rule match — rule-based signal, treat as strong but not conclusive evidence
  const suppressionBlock = suppHit
    ? `SUPPRESSION RULE MATCH (deterministic rule-based signal):\n- Rule: "${suppHit.rule_name}" (confidence=${(suppHit.confidence * 100).toFixed(0)}%)\n- Reason: ${suppHit.reason}\n- Treat as strong FP evidence. Do NOT treat as conclusive — verify independently against the alert data.`
    : '';

  // Correlation — if campaign or escalation detected, it OVERRIDES other FP signals
  const corrBlock = corrResult
    ? `CORRELATION ANALYSIS:\n- campaign_detected: ${corrResult.campaign_detected}\n- escalation_needed: ${corrResult.escalation_needed}\n- campaign_name: ${corrResult.campaign_name || 'N/A'}\n- related_alerts: ${corrResult.related_alert_count ?? 0}\n${corrResult.campaign_detected || corrResult.escalation_needed ? '⚠ CORRELATION OVERRIDE: campaign or escalation detected — do NOT classify as false positive regardless of other signals.' : '- No campaign pattern detected.'}`
    : '';

  // Cross-agent memory read: what prior agents concluded on semantically similar incidents.
  // This is what stops the system "starting from a blank slate" every time — the new triage
  // benefits from how previous triages reasoned, including their rejected hypotheses.
  const priorReasoningBlock = priorReasoning.length ? priorReasoning.slice(0, 3).map((p) => {
    const lines: string[] = [];
    lines.push(`Prior incident ${p.alert_id} (${(p.similarity * 100).toFixed(0)}% similar${p.outcome ? `, outcome=${p.outcome}` : ''}):`);
    for (const r of p.reasoning.slice(0, 2)) {
      lines.push(`  [${r.agent}] decided: ${r.decision || '(no decision recorded)'}`);
      if (r.evidence_for?.length)        lines.push(`    + ${r.evidence_for.slice(0, 3).join(' | ')}`);
      if (r.evidence_against?.length)    lines.push(`    - ${r.evidence_against.slice(0, 3).join(' | ')}`);
      if (r.rejected_hypotheses?.length) lines.push(`    ✗ rejected: ${r.rejected_hypotheses.slice(0, 2).join(' | ')}`);
    }
    return lines.join('\n');
  }).join('\n\n') : '';

  const memoryBlock = [
    suppressionBlock,
    corrBlock,
    assetBlock   ? `KNOWN ASSET CONTEXT (analyst-curated):\n${assetBlock}`                                    : '',
    priorFpBlock ? `PRIOR FALSE-POSITIVE OUTCOMES FOR SIMILAR INCIDENTS (semantic recall):\n${priorFpBlock}` : '',
    iocHistBlock ? `IOC HISTORY (this alert's IOCs in past memory):\n${iocHistBlock}`                       : '',
    priorReasoningBlock ? `PRIOR AGENT REASONING ON SIMILAR INCIDENTS (cross-agent memory read — what previous triages concluded and why; use this to maintain continuity, not as ground truth):\n${priorReasoningBlock}` : '',
  ].filter(Boolean).join('\n\n');

  if (memoryBlock) {
    const parts = [
      suppHit    ? 'suppression rule'     : '',
      corrResult ? 'correlation'          : '',
      assetCtx.length  ? `${assetCtx.length} asset`   : '',
      priorFp.length   ? `${priorFp.length} prior FP` : '',
      iocHits.length   ? `${iocHits.length} IOC`      : '',
      priorReasoning.length ? `${priorReasoning.length} prior-reasoning` : '',
    ].filter(Boolean);
    logs.push(`[Analysis] Intelligence context applied: ${parts.join(', ')}`);
  }

  const userPrompt = `${memoryBlock ? memoryBlock + '\n\n' : ''}ALERT TO TRIAGE:
- ID: ${a.id}
- Timestamp: ${a.timestamp}
- Agent: ${parsedData?.agent?.name ?? a.agent_name ?? 'unknown'} (${parsedData?.agent?.ip ?? a.source_ip ?? ''})
- Rule ID: ${parsedData?.rule?.id ?? a.rule_id ?? 'N/A'} | Level: ${parsedData?.rule?.level ?? a.severity ?? 'N/A'} | Description: ${parsedData?.rule?.description ?? a.description ?? 'N/A'}
- Source IP: ${parsedData?.srcip ?? a.source_ip ?? 'N/A'} | Dest IP: ${parsedData?.dstip ?? a.dest_ip ?? 'N/A'}
- User: ${parsedData?.dstuser ?? parsedData?.srcuser ?? 'N/A'}
- Program: ${parsedData?.program_name ?? 'N/A'}
- Full data: ${JSON.stringify(parsedData, null, 2)}

RECENT RELATED ALERTS (same agent or source IP — last 72 hours):
${related.length ? JSON.stringify(related, null, 2) : 'None'}`;

  const severity = a.severity ?? 0;
  const riskFloor = Math.max(5, severity * 2);   // level 10 SSH brute force → floor 20

  const analysis = await callStructuredLLM({
    phase: "analysis",
    model,
    schema: AnalysisSchema,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    fallback: {
      analysis_summary:          "Alert analysis unavailable — LLM did not respond. Manual review required.",
      iocs:                      { ips: [], users: [], hosts: [], hashes: [], files: [], ports: [], domains: [], processes: [], urls: [] },
      attack_category:           "EXECUTION",
      kill_chain_stage:          "DELIVERY",
      risk_score:                Math.max(riskFloor, severity * 4),   // deterministic fallback, never 0
      severity_validation:       "MEDIUM" as const,
      recommended_action:        "INVESTIGATE" as const,
      is_false_positive:         false,
      false_positive_reason:     undefined,
      false_positive_confidence: 0,
      confidence:                0,
      reasoning: {
        decision:            "Triage agent did not respond — defaulting to manual review.",
        evidence_for:        [],
        evidence_against:    [],
        rejected_hypotheses: [],
        confidence:          0,
      },
    },
    ctx,
  });

  // Hard floor — guaranteed regardless of what the LLM returned
  if ((analysis.risk_score ?? 0) < riskFloor) {
    logs.push(`[Analysis] risk_score ${analysis.risk_score} below floor ${riskFloor} — applying floor`);
    analysis.risk_score = riskFloor;
  }

  if (typeof analysis.false_positive_confidence !== "number") {
    analysis.false_positive_confidence = analysis.is_false_positive ? analysis.confidence : 0;
  }

  if (analysis.is_false_positive) {
    logs.push(`[Analysis] Potential False Positive detected (${Math.round(analysis.false_positive_confidence * 100)}% confidence): ${analysis.false_positive_reason}`);
  } else {
    logs.push(`[Analysis] Triage complete. Risk: ${analysis.risk_score}/100. Category: ${analysis.attack_category}.`);
  }

  return { analysis, agentLogs: logs };
}
