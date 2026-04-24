import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { resolveModelForPhase, type ModelAssignments } from "./config.js";
import { alertAnalysisNode } from "./nodes/analysis.js";
import { threatIntelNode } from "./nodes/intel.js";
import { ragKnowledgeNode } from "./nodes/knowledge.js";
import { correlationNode } from "./nodes/correlation.js";
import { ticketingNode } from "./nodes/ticketing.js";
import { responseNode } from "./nodes/response.js";
import { validationNode } from "./nodes/validation.js";

const SwarmState = Annotation.Root({
  alert: Annotation<any>(),
  recentAlerts: Annotation<any[]>(),
  analysis: Annotation<any>(),
  intel: Annotation<any>(),
  knowledge: Annotation<any>(),
  correlation: Annotation<any>(),
  ticket: Annotation<any>(),
  responsePlan: Annotation<any>(),
  validation: Annotation<any>(),
  emailSent: Annotation<boolean>(),
  agentLogs: Annotation<string[]>({
    reducer: (old, newVal) => [...old, ...newVal],
    default: () => [],
  }),
});

export function buildSwarmGraph(assignments?: ModelAssignments) {
  return new StateGraph(SwarmState)
    .addNode("node_triage",   (state: any) => alertAnalysisNode(state, resolveModelForPhase("analysis",    assignments)))
    .addNode("node_intel",    (state: any) => threatIntelNode  (state, resolveModelForPhase("intel",       assignments)))
    .addNode("node_playbook", (state: any) => ragKnowledgeNode (state, resolveModelForPhase("knowledge",   assignments)))
    .addNode("node_correlate",(state: any) => correlationNode  (state, resolveModelForPhase("correlation", assignments)))
    .addNode("node_ticket",   (state: any) => ticketingNode    (state, resolveModelForPhase("ticketing",   assignments)))
    .addNode("node_response", (state: any) => responseNode     (state, resolveModelForPhase("response",    assignments)))
    .addNode("node_validate", (state: any) => validationNode   (state, resolveModelForPhase("validation",  assignments)))
    .addEdge(START,            "node_triage")
    .addEdge("node_triage",    "node_intel")
    .addEdge("node_intel",     "node_playbook")
    .addEdge("node_playbook",  "node_correlate")
    .addEdge("node_correlate", "node_ticket")
    .addEdge("node_ticket",    "node_response")
    .addEdge("node_response",  "node_validate")
    .addEdge("node_validate",  END)
    .compile();
}

