import { type ModelAssignments, resolveModelForPhase } from "./config.js";
import { alertAnalysisNode } from "./nodes/analysis.js";
import { threatIntelNode } from "./nodes/intel.js";
import { ragKnowledgeNode } from "./nodes/knowledge.js";
import { correlationNode } from "./nodes/correlation.js";
import { ticketingNode } from "./nodes/ticketing.js";
import { responseNode } from "./nodes/response.js";
import { validationNode } from "./nodes/validation.js";
import { recallNode } from "./nodes/recall.js";
import { iocCheckNode } from "./nodes/ioc_check.js";
import { runHubAndSwarm, type OrchestrationOutput } from "./orchestrator.js";

interface RunOptions {
  modelAssignments?: ModelAssignments;
}

/** Run a single agent phase and return its raw result. Used by the per-phase
 *  re-run UI controls. */
export async function runPhase(phase: string, state: any, options: RunOptions = {}): Promise<any> {
  const models = options.modelAssignments;
  switch (phase) {
    case "analysis":    return alertAnalysisNode(state, resolveModelForPhase("analysis", models));
    case "intel":       return threatIntelNode(state, resolveModelForPhase("intel", models));
    case "knowledge":   return ragKnowledgeNode(state, resolveModelForPhase("knowledge", models));
    case "correlation": return correlationNode(state, resolveModelForPhase("correlation", models));
    case "ticketing":   return ticketingNode(state, resolveModelForPhase("ticketing", models));
    case "response":    return responseNode(state, resolveModelForPhase("response", models));
    case "validation":  return validationNode(state, resolveModelForPhase("validation", models));
    case "recall":      return recallNode(state);
    case "ioc_check":   return iocCheckNode(state);
    default:
      throw new Error(`Unknown agent phase: ${phase}`);
  }
}

/**
 * Run the full agent orchestration. Mode is selected by AGENT_MODE env var:
 *   - "swarm"  (default): hub-and-swarm with planner + parallel investigators + memory tiers
 *   - "linear" (legacy):  retained for compatibility — sequential 7-node chain via the orchestrator
 *
 * Output shape is identical across both modes.
 */
export async function runOrchestration(
  alert: any,
  recentAlerts: any[] = [],
  options: RunOptions = {},
): Promise<OrchestrationOutput> {
  const mode = (process.env.AGENT_MODE || "swarm").toLowerCase();

  if (mode === "linear") {
    return runLinearLegacy(alert, recentAlerts, options);
  }
  return runHubAndSwarm(alert, recentAlerts, options);
}

/** Sequential 7-agent chain — preserves the pre-swarm behaviour for env=linear. */
async function runLinearLegacy(
  alert: any,
  recentAlerts: any[],
  options: RunOptions,
): Promise<OrchestrationOutput> {
  const { newRunContext } = await import("./shared/llm.js");
  const ctx = newRunContext();
  const modelFor = (p: any) => resolveModelForPhase(p, options.modelAssignments);

  const a = await alertAnalysisNode({ alert, recentAlerts }, modelFor("analysis"), ctx);
  ctx.agentLogs.push(...(a.agentLogs ?? []));
  const analysis = a.analysis;

  const i = await threatIntelNode({ alert, recentAlerts, analysis }, modelFor("intel"), ctx);
  ctx.agentLogs.push(...(i.agentLogs ?? []));
  const intel = i.intel;

  const k = await ragKnowledgeNode({ alert, analysis }, modelFor("knowledge"), ctx);
  ctx.agentLogs.push(...(k.agentLogs ?? []));
  const knowledge = k.knowledge;

  const c = await correlationNode({ alert, recentAlerts, analysis }, modelFor("correlation"), ctx);
  ctx.agentLogs.push(...(c.agentLogs ?? []));
  const correlation = c.correlation;

  const t = await ticketingNode({ alert, analysis, intel, knowledge, correlation }, modelFor("ticketing"), ctx);
  ctx.agentLogs.push(...(t.agentLogs ?? []));
  const ticket = t.ticket;

  const r = await responseNode({ alert, analysis, intel, correlation, ticket }, modelFor("response"), ctx);
  ctx.agentLogs.push(...(r.agentLogs ?? []));
  const responsePlan = r.responsePlan;

  const v = await validationNode({ alert, analysis, intel, knowledge, correlation, ticket, responsePlan }, modelFor("validation"), ctx);
  ctx.agentLogs.push(...(v.agentLogs ?? []));
  const validation = v.validation;

  const aiAnalysis = {
    summary: analysis?.analysis_summary,
    iocs: analysis?.iocs,
    intel: intel?.intel_summary,
    correlation: correlation?.campaign_name || "Isolated Incident",
    ticket, response: responsePlan,
    validation: validation?.sla_status,
    agentLogs: ctx.agentLogs,
    quota_exhausted: ctx.quotaExhausted,
    fallback_phases: ctx.fallbackPhases,
    trace_id: ctx.traceId,
    phaseData: { analysis, intel, knowledge, correlation, ticket, response: responsePlan, validation },
  };

  return {
    ai_analysis:       JSON.stringify(aiAnalysis),
    mitre_attack:      JSON.stringify(intel?.mitre_attack || []),
    remediation_steps: knowledge?.remediation_steps || "",
    email_sent:        ticket?.email_notification_sent ? 1 : 0,
    status:            analysis?.is_false_positive ? "FALSE_POSITIVE" : "TRIAGED",
  };
}

export * from "./config.js";
