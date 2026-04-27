import { z } from "zod";
import { callStructuredLLM } from "../shared/llm.js";
import { DEFAULT_AGENT_MODELS } from "../config.js";

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
  false_positive_reason:     z.string().optional(),
  false_positive_confidence: z.number().min(0).max(1).default(0),
  confidence:                z.number().min(0).max(1).default(0),
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

ATTACK CATEGORY: Choose the single MITRE ATT&CK tactic that best matches the alert intent.

KILL CHAIN STAGE: Map to the Lockheed Martin Kill Chain phase:
  RECONNAISSANCE | WEAPONIZATION | DELIVERY | EXPLOITATION | INSTALLATION | C2 | ACTIONS_ON_OBJECTIVES

RISK SCORE (0-100):
  Base = rule.level * 6 (max 78)
  +10 if lateral movement signals present
  +10 if credential access category
  +5  if external IP (non-RFC1918) as src
  -20 if is_false_positive=true
  Clamp result to [0, 100]

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
  "risk_score": 0,
  "severity_validation": "<CRITICAL|HIGH|MEDIUM|LOW>",
  "recommended_action": "<action enum>",
  "is_false_positive": false,
  "false_positive_reason": "<reason string or omit if not FP>",
  "false_positive_confidence": 0.1,
  "confidence": 0.85
}`;

export async function alertAnalysisNode(state: any, model: string = DEFAULT_AGENT_MODELS.analysis) {
  const a = state.alert;
  const logs: string[] = [];

  logs.push(`[Analysis] Initializing triage for alert ${a.id}`);

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

  const userPrompt = `ALERT TO TRIAGE:
- ID: ${a.id}
- Timestamp: ${a.timestamp}
- Agent: ${a.data?.agent?.name ?? a.agent_name ?? 'unknown'} (${a.data?.agent?.ip ?? a.source_ip ?? ''})
- Rule ID: ${a.data?.rule?.id ?? a.rule_id ?? 'N/A'} | Level: ${a.data?.rule?.level ?? a.severity ?? 'N/A'} | Description: ${a.data?.rule?.description ?? a.description ?? 'N/A'}
- Source IP: ${a.data?.srcip ?? a.source_ip ?? 'N/A'} | Dest IP: ${a.data?.dstip ?? 'N/A'}
- User: ${a.data?.dstuser ?? a.data?.srcuser ?? 'N/A'}
- Program: ${a.data?.program_name ?? 'N/A'}
- Full data: ${JSON.stringify(a.data ?? {}, null, 2)}

RECENT RELATED ALERTS (same agent or source IP — last 72 hours):
${related.length ? JSON.stringify(related, null, 2) : 'None'}`;

  const analysis = await callStructuredLLM({
    phase: "analysis",
    model,
    schema: AnalysisSchema,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    fallback: {
      analysis_summary:          "Alert analysis unavailable — LLM did not respond.",
      iocs:                      { ips: [], users: [], hosts: [], hashes: [], files: [], ports: [], domains: [], processes: [], urls: [] },
      attack_category:           "EXECUTION",
      kill_chain_stage:          "DELIVERY",
      risk_score:                0,
      severity_validation:       "MEDIUM" as const,
      recommended_action:        "INVESTIGATE" as const,
      is_false_positive:         false,
      false_positive_reason:     undefined,
      false_positive_confidence: 0,
      confidence:                0,
    },
  });

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
