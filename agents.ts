import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import dotenv from "dotenv";
dotenv.config();

const MODEL    = process.env.AI_MODEL          || "openai/gpt-oss-120b:free";
const API_KEY  = process.env.OPENROUTER_API_KEY || "";
const APP_URL  = process.env.APP_URL           || "http://localhost:3000";

if (!API_KEY) console.warn("[Agents] OPENROUTER_API_KEY not set — AI calls will fail.");

const llm = new ChatOpenAI({
  model: MODEL,
  temperature: 0.1,
  maxRetries: 2,
  configuration: {
    apiKey: API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": APP_URL,
      "X-Title": "Aegis SOC Platform",
    },
  },
});

// ─── JSON extraction: handles markdown fences, leading text, etc. ────────────
function extractJSON(raw: string): any {
  let s = (raw || "").trim();
  // Strip ```json ... ``` fences
  s = s.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  const start = s.indexOf("{");
  const end   = s.lastIndexOf("}");
  if (start === -1 || end === -1)
    throw new Error(`No JSON object found in LLM response: ${s.slice(0, 300)}`);
  return JSON.parse(s.slice(start, end + 1));
}

async function callLLM(system: string, user: string, fallback: any): Promise<any> {
  try {
    const resp = await llm.invoke([
      new SystemMessage(system),
      new HumanMessage(user),
    ]);
    return extractJSON(resp.content as string);
  } catch (err: any) {
    console.error("[LLM Error]", err?.message?.slice(0, 300) ?? err);
    return fallback;
  }
}

// ─── LangGraph state ─────────────────────────────────────────────────────────
const SwarmState = Annotation.Root({
  alert:        Annotation<any>(),
  recentAlerts: Annotation<any[]>(),
  analysis:     Annotation<any>(),
  intel:        Annotation<any>(),
  knowledge:    Annotation<any>(),
  correlation:  Annotation<any>(),
  ticket:       Annotation<any>(),
  responsePlan: Annotation<any>(),
  validation:   Annotation<any>(),
  emailSent:    Annotation<boolean>(),
});

// ─── Node 1: Alert Triage & IOC Extraction ───────────────────────────────────
export const alertAnalysisNode = async (state: any) => {
  const result = await callLLM(
    `You are an expert SOC Alert Analysis Agent. Analyze the Wazuh security alert and respond ONLY with valid JSON — no markdown, no extra text.

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
  "confidence": 0.9
}`,
    `Alert to analyze:\n${JSON.stringify(state.alert, null, 2)}`,
    {
      analysis_summary: "Alert analysis unavailable — LLM did not respond.",
      iocs: { ips: [], users: [], hosts: [] },
      is_false_positive: false,
      confidence: 0,
    }
  );
  return { analysis: result };
};

// ─── Node 2: Threat Intel & MITRE Mapping ────────────────────────────────────
export const threatIntelNode = async (state: any) => {
  const iocs  = state.analysis?.iocs || {};
  const alert = state.alert;
  const result = await callLLM(
    `You are a Threat Intelligence Agent with deep knowledge of MITRE ATT&CK. Map the IOCs and alert context to MITRE techniques. Respond ONLY with valid JSON:

{
  "mitre_attack": ["T1190", "T1059.001"],
  "risk_score": 8,
  "intel_summary": "<2-3 sentence threat assessment>",
  "threat_actor_type": "<nation-state|cybercriminal|insider|hacktivist|unknown>",
  "campaign_family": "<malware or campaign name, or null>"
}`,
    `IOCs: ${JSON.stringify(iocs)}\nAlert: ${alert?.description || ""} | Rule: ${alert?.rule_id || ""}`,
    {
      mitre_attack: [],
      risk_score: 5,
      intel_summary: "Threat intelligence unavailable.",
      threat_actor_type: "unknown",
      campaign_family: null,
    }
  );
  return { intel: result };
};

// ─── Node 3: RAG Knowledge / Playbook ────────────────────────────────────────
export const ragKnowledgeNode = async (state: any) => {
  const result = await callLLM(
    `You are a Security Playbook Retrieval Agent. Provide numbered remediation steps tailored to the alert. Respond ONLY with valid JSON:

{
  "remediation_steps": "1. <first step>\\n2. <second step>\\n3. <third step>\\n4. <fourth step>\\n5. <fifth step>",
  "playbook_reference": "<e.g. NIST IR-2 or internal PB-WEB-001>",
  "containment_priority": "<IMMEDIATE|HIGH|MEDIUM|LOW>",
  "estimated_effort_minutes": 15
}`,
    `Alert: ${state.alert?.description || ""}\nLog: ${(state.alert?.full_log || "").slice(0, 500)}\nAnalysis: ${state.analysis?.analysis_summary || ""}`,
    {
      remediation_steps:
        "1. Isolate the affected host from the network\n2. Block the source IP at the perimeter firewall\n3. Preserve logs and memory for forensics\n4. Reset credentials for any affected accounts\n5. Apply relevant patches and harden configuration",
      playbook_reference: "IRP-GEN-001",
      containment_priority: "HIGH",
      estimated_effort_minutes: 30,
    }
  );
  return { knowledge: result };
};

// ─── Node 4: Campaign Correlation ────────────────────────────────────────────
export const correlationNode = async (state: any) => {
  const recentSummary = (state.recentAlerts || [])
    .slice(0, 10)
    .map((a: any) => ({
      id:          a.id,
      description: a.description,
      source_ip:   a.source_ip,
      timestamp:   a.timestamp,
      status:      a.status,
    }));

  const result = await callLLM(
    `You are a Security Correlation Agent. Analyse the current alert against recent alerts to detect multi-stage campaigns. Respond ONLY with valid JSON:

{
  "campaign_detected": false,
  "campaign_name": "<descriptive name or 'Isolated Incident'>",
  "campaign_description": "<what the campaign appears to be>",
  "related_alert_count": 0,
  "escalation_needed": false,
  "kill_chain_stage": "<Reconnaissance|Weaponization|Delivery|Exploitation|Installation|C2|Actions on Objectives>"
}`,
    `Current alert:\n${JSON.stringify(state.alert, null, 2)}\n\nRecent alerts:\n${JSON.stringify(recentSummary, null, 2)}`,
    {
      campaign_detected:     false,
      campaign_name:         "Isolated Incident",
      campaign_description:  "No multi-stage campaign pattern detected.",
      related_alert_count:   0,
      escalation_needed:     false,
      kill_chain_stage:      "Exploitation",
    }
  );
  return { correlation: result };
};

// ─── Node 5: Incident Ticketing & Email ──────────────────────────────────────
export const ticketingNode = async (state: any) => {
  const ctx = {
    alert:       { description: state.alert?.description, severity: state.alert?.severity, source_ip: state.alert?.source_ip, agent: state.alert?.agent_name },
    analysis:    state.analysis,
    intel:       state.intel,
    knowledge:   state.knowledge,
    correlation: state.correlation,
  };

  const result = await callLLM(
    `You are an Incident Ticketing Agent. Write a professional, concise incident ticket. If priority is CRITICAL or HIGH set email_notification_sent to true. Respond ONLY with valid JSON:

{
  "title": "<incident title under 80 chars>",
  "priority": "<CRITICAL|HIGH|MEDIUM|LOW>",
  "report_body": "<4-5 sentences: what happened, affected assets, impact assessment, current containment status, next steps>",
  "email_notification_sent": true,
  "affected_systems": ["<hostname or IP>"],
  "business_impact": "<one sentence on business impact>"
}`,
    `Context:\n${JSON.stringify(ctx, null, 2)}`,
    {
      title:                   "Security Incident — Investigation Required",
      priority:                "HIGH",
      report_body:             "An automated security incident was detected and requires manual investigation. Refer to the attached logs for details.",
      email_notification_sent: false,
      affected_systems:        [],
      business_impact:         "Unknown — pending investigation.",
    }
  );
  return { ticket: result, emailSent: result.email_notification_sent || false };
};

// ─── Node 6: Response Plan ───────────────────────────────────────────────────
export const responseNode = async (state: any) => {
  const ctx = {
    alert:       { description: state.alert?.description, source_ip: state.alert?.source_ip, agent_name: state.alert?.agent_name },
    analysis:    state.analysis,
    intel:       state.intel,
    correlation: state.correlation,
  };

  const result = await callLLM(
    `You are the Automated Response Agent. Recommend specific, actionable containment steps. Respond ONLY with valid JSON:

{
  "actions": [
    {
      "type": "<BLOCK_IP|DISABLE_USER|ISOLATE_HOST|QUARANTINE_FILE|RESET_PASSWORD|NOTIFY_TEAM>",
      "target": "<IP address, username, hostname, or file path>",
      "reason": "<why this action is necessary>",
      "priority": 1,
      "automated": false
    }
  ],
  "approval_required": true,
  "estimated_containment_time": "15 minutes"
}`,
    `Context:\n${JSON.stringify(ctx, null, 2)}`,
    {
      actions:                    [],
      approval_required:          true,
      estimated_containment_time: "unknown",
    }
  );
  return { responsePlan: result };
};

// ─── Node 7: SLA Validation ──────────────────────────────────────────────────
export const validationNode = async (state: any) => {
  const ctx = {
    ticket:              state.ticket,
    responsePlan:        state.responsePlan,
    analysis_complete:   !!state.analysis,
    intel_complete:      !!state.intel,
    knowledge_complete:  !!state.knowledge,
    correlation_done:    !!state.correlation,
  };

  const result = await callLLM(
    `You are the SLA & Quality Validation Agent. Verify the incident response is thorough and within policy. Respond ONLY with valid JSON:

{
  "is_valid": true,
  "sla_status": "<SLA_MET|SLA_AT_RISK|SLA_BREACHED>",
  "completeness_score": 90,
  "missing_elements": [],
  "recommendation": "<CLOSE|ESCALATE|MONITOR|INVESTIGATE_FURTHER>"
}`,
    `Incident context:\n${JSON.stringify(ctx, null, 2)}`,
    {
      is_valid:            true,
      sla_status:          "SLA_MET",
      completeness_score:  70,
      missing_elements:    [],
      recommendation:      "MONITOR",
    }
  );
  return { validation: result };
};

// ─── LangGraph Workflow ───────────────────────────────────────────────────────
// Note: node names must not clash with state attribute keys.
// State keys: analysis, intel, knowledge, correlation, ticket, responsePlan, validation
// Nodes get a "node_" prefix to avoid collisions.
const workflow = new StateGraph(SwarmState)
  .addNode("node_triage",     alertAnalysisNode)
  .addNode("node_intel",      threatIntelNode)
  .addNode("node_playbook",   ragKnowledgeNode)
  .addNode("node_correlate",  correlationNode)
  .addNode("node_ticket",     ticketingNode)
  .addNode("node_response",   responseNode)
  .addNode("node_validate",   validationNode)
  .addEdge(START,             "node_triage")
  .addEdge("node_triage",     "node_intel")
  .addEdge("node_intel",      "node_playbook")
  .addEdge("node_playbook",   "node_correlate")
  .addEdge("node_correlate",  "node_ticket")
  .addEdge("node_ticket",     "node_response")
  .addEdge("node_response",   "node_validate")
  .addEdge("node_validate",   END);

export const swarmGraph = workflow.compile();

// ─── Public API ──────────────────────────────────────────────────────────────

/** Run a single agent phase and return its raw result */
export async function runPhase(phase: string, state: any): Promise<any> {
  switch (phase) {
    case "analysis":    return alertAnalysisNode(state);
    case "intel":       return threatIntelNode(state);
    case "knowledge":   return ragKnowledgeNode(state);
    case "correlation": return correlationNode(state);
    case "ticketing":   return ticketingNode(state);
    case "response":    return responseNode(state);
    case "validation":  return validationNode(state);
    default: throw new Error(`Unknown agent phase: ${phase}`);
  }
}

/** Run the full 7-agent swarm and return the final composed state */
export async function runOrchestration(alert: any, recentAlerts: any[] = []): Promise<{
  ai_analysis: string;
  mitre_attack: string;
  remediation_steps: string;
  email_sent: number;
  status: string;
}> {
  const result = await swarmGraph.invoke({ alert, recentAlerts });

  const aiAnalysis = {
    summary:     result.analysis?.analysis_summary,
    iocs:        result.analysis?.iocs,
    intel:       result.intel?.intel_summary,
    correlation: result.correlation?.campaign_name || "Isolated Incident",
    ticket:      result.ticket,
    response:    result.responsePlan,
    validation:  result.validation?.sla_status,
  };

  return {
    ai_analysis:       JSON.stringify(aiAnalysis),
    mitre_attack:      JSON.stringify(result.intel?.mitre_attack || []),
    remediation_steps: result.knowledge?.remediation_steps || "",
    email_sent:        result.emailSent ? 1 : 0,
    status:            result.analysis?.is_false_positive ? "FALSE_POSITIVE" : "TRIAGED",
  };
}
