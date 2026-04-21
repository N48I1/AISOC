import { type ModelAssignments, resolveModelForPhase } from "./config.js";
import { alertAnalysisNode } from "./nodes/analysis.js";
import { threatIntelNode } from "./nodes/intel.js";
import { ragKnowledgeNode } from "./nodes/knowledge.js";
import { correlationNode } from "./nodes/correlation.js";
import { ticketingNode } from "./nodes/ticketing.js";
import { responseNode } from "./nodes/response.js";
import { validationNode } from "./nodes/validation.js";
import { buildSwarmGraph } from "./workflow.js";

interface RunOptions {
  modelAssignments?: ModelAssignments;
}

/** Run a single agent phase and return its raw result */
export async function runPhase(phase: string, state: any, options: RunOptions = {}): Promise<any> {
  const models = options.modelAssignments;
  switch (phase) {
    case "analysis":
      return alertAnalysisNode(state, resolveModelForPhase("analysis", models));
    case "intel":
      return threatIntelNode(state, resolveModelForPhase("intel", models));
    case "knowledge":
      return ragKnowledgeNode(state, resolveModelForPhase("knowledge", models));
    case "correlation":
      return correlationNode(state, resolveModelForPhase("correlation", models));
    case "ticketing":
      return ticketingNode(state, resolveModelForPhase("ticketing", models));
    case "response":
      return responseNode(state, resolveModelForPhase("response", models));
    case "validation":
      return validationNode(state, resolveModelForPhase("validation", models));
    default:
      throw new Error(`Unknown agent phase: ${phase}`);
  }
}

/** Run the full 7-agent swarm and return the final composed state */
export async function runOrchestration(
  alert: any,
  recentAlerts: any[] = [],
  options: RunOptions = {},
): Promise<{
  ai_analysis: string;
  mitre_attack: string;
  remediation_steps: string;
  email_sent: number;
  status: string;
}> {
  const result = await buildSwarmGraph(options.modelAssignments).invoke({ alert, recentAlerts });

  const aiAnalysis = {
    summary: result.analysis?.analysis_summary,
    iocs: result.analysis?.iocs,
    intel: result.intel?.intel_summary,
    correlation: result.correlation?.campaign_name || "Isolated Incident",
    ticket: result.ticket,
    response: result.responsePlan,
    validation: result.validation?.sla_status,
    phaseData: {
      analysis: result.analysis,
      intel: result.intel,
      knowledge: result.knowledge,
      correlation: result.correlation,
      ticket: result.ticket,
      response: result.responsePlan,
      validation: result.validation,
    },
  };

  return {
    ai_analysis: JSON.stringify(aiAnalysis),
    mitre_attack: JSON.stringify(result.intel?.mitre_attack || []),
    remediation_steps: result.knowledge?.remediation_steps || "",
    email_sent: result.emailSent ? 1 : 0,
    status: result.analysis?.is_false_positive ? "FALSE_POSITIVE" : "TRIAGED",
  };
}

export * from "./config.js";

