import { GoogleGenAI, Type } from "@google/genai";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";

// Initialize the Gemini API client correctly for AI Studio environment
const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY 
});

const MODEL_NAME = "gemini-3-flash-preview";

// Define the state for our swarm
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
  status: Annotation<string>(),
  emailSent: Annotation<boolean>(),
});

// --- Helper for structured generation ---

async function generateStructured(prompt: string, schema: any, systemInstruction: string) {
  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    if (!response.text) {
      throw new Error("Empty response from Gemini");
    }

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Gemini Generation Error:", error);
    throw error;
  }
}

// --- Node functions for each agent ---

const alertAnalysisNode = async (state: any) => {
  const system = `You are the Alert Analysis Agent. Interpret Wazuh alerts, extract IOCs (IP, user, hostname), validate severity, and filter false positives.`;
  const schema = {
    type: Type.OBJECT,
    properties: {
      iocs: {
        type: Type.OBJECT,
        properties: {
          ips: { type: Type.ARRAY, items: { type: Type.STRING } },
          users: { type: Type.ARRAY, items: { type: Type.STRING } },
          hosts: { type: Type.ARRAY, items: { type: Type.STRING } }
        }
      },
      severity_validation: { type: Type.STRING },
      is_false_positive: { type: Type.BOOLEAN },
      analysis_summary: { type: Type.STRING }
    },
    required: ["iocs", "is_false_positive", "analysis_summary"]
  };

  const data = await generateStructured(JSON.stringify(state.alert), schema, system);
  return { analysis: data };
};

const threatIntelNode = async (state: any) => {
  const iocs = state.analysis?.iocs || {};
  const system = `You are the Threat Intelligence Agent. Enrich IOCs, map to MITRE ATT&CK techniques, and assess reputation/risk.`;
  const schema = {
    type: Type.OBJECT,
    properties: {
      mitre_attack: { type: Type.ARRAY, items: { type: Type.STRING } },
      risk_score: { type: Type.NUMBER },
      intel_summary: { type: Type.STRING }
    },
    required: ["mitre_attack", "intel_summary"]
  };

  const data = await generateStructured(JSON.stringify(iocs), schema, system);
  return { intel: data };
};

const ragKnowledgeNode = async (state: any) => {
  const system = `You are the RAG Knowledge Agent. Suggest remediation steps and reference playbooks based on the incident type.`;
  const schema = {
    type: Type.OBJECT,
    properties: {
      remediation_steps: { type: Type.STRING },
      playbook_reference: { type: Type.STRING }
    },
    required: ["remediation_steps"]
  };

  const data = await generateStructured(JSON.stringify(state.alert), schema, system);
  return { knowledge: data };
};

const correlationNode = async (state: any) => {
  const system = `You are the Correlation Agent. Detect patterns across current and recent alerts to identify multi-stage campaigns.`;
  const schema = {
    type: Type.OBJECT,
    properties: {
      related_alert_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
      campaign_detected: { type: Type.BOOLEAN },
      campaign_name: { type: Type.STRING },
      escalation_needed: { type: Type.BOOLEAN }
    },
    required: ["campaign_detected", "campaign_name"]
  };

  const data = await generateStructured(JSON.stringify({ current: state.alert, recent: state.recentAlerts }), schema, system);
  return { correlation: data };
};

const ticketingNode = async (state: any) => {
  const fullContext = { analysis: state.analysis, intel: state.intel, knowledge: state.knowledge, correlation: state.correlation };
  const system = `You are the Ticketing Agent. Generate professional incident reports. If priority is CRITICAL or HIGH, set email_notification_sent to true.`;
  const schema = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      priority: { type: Type.STRING, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
      report_body: { type: Type.STRING },
      email_notification_sent: { type: Type.BOOLEAN }
    },
    required: ["title", "priority", "report_body", "email_notification_sent"]
  };

  const data = await generateStructured(JSON.stringify(fullContext), schema, system);
  return { ticket: data, emailSent: data.email_notification_sent };
};

const responseNode = async (state: any) => {
  const fullContext = { analysis: state.analysis, intel: state.intel, knowledge: state.knowledge, correlation: state.correlation };
  const system = `You are the Response Agent. Recommend specific containment actions (blocking IP, disabling user, etc).`;
  const schema = {
    type: Type.OBJECT,
    properties: {
      actions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING, enum: ["BLOCK_IP", "DISABLE_USER", "ISOLATE_HOST", "QUARANTINE_FILE"] },
            target: { type: Type.STRING },
            reason: { type: Type.STRING }
          }
        }
      },
      approval_required: { type: Type.BOOLEAN }
    },
    required: ["actions", "approval_required"]
  };

  const data = await generateStructured(JSON.stringify(fullContext), schema, system);
  return { responsePlan: data };
};

const validationNode = async (state: any) => {
  const plan = { ticket: state.ticket, responsePlan: state.responsePlan };
  const system = `You are the Validation Agent. Verify the analysis completeness, response effectiveness, and SLA compliance.`;
  const schema = {
    type: Type.OBJECT,
    properties: {
      is_valid: { type: Type.BOOLEAN },
      missing_elements: { type: Type.ARRAY, items: { type: Type.STRING } },
      sla_status: { type: Type.STRING }
    },
    required: ["is_valid", "sla_status"]
  };

  const data = await generateStructured(JSON.stringify(plan), schema, system);
  return { validation: data };
};

// Build the graph
const workflow = new StateGraph(SwarmState)
  .addNode("agent_alertAnalysis", alertAnalysisNode)
  .addNode("agent_threatIntel", threatIntelNode)
  .addNode("agent_ragKnowledge", ragKnowledgeNode)
  .addNode("agent_correlation", correlationNode)
  .addNode("agent_ticketing", ticketingNode)
  .addNode("agent_response", responseNode)
  .addNode("agent_validation", validationNode)
  .addEdge(START, "agent_alertAnalysis")
  .addEdge("agent_alertAnalysis", "agent_threatIntel")
  .addEdge("agent_threatIntel", "agent_ragKnowledge")
  .addEdge("agent_ragKnowledge", "agent_correlation")
  .addEdge("agent_correlation", "agent_ticketing")
  .addEdge("agent_ticketing", "agent_response")
  .addEdge("agent_response", "agent_validation")
  .addEdge("agent_validation", END);

const swarmGraph = workflow.compile();

export async function runAgentPhase(phase: string, state: any) {
  try {
    switch (phase) {
      case 'analysis':
        return await alertAnalysisNode(state);
      case 'intel':
        return await threatIntelNode(state);
      case 'knowledge':
        return await ragKnowledgeNode(state);
      case 'correlation':
        return await correlationNode(state);
      case 'ticketing':
        return await ticketingNode(state);
      case 'response':
        return await responseNode(state);
      case 'validation':
        return await validationNode(state);
      default:
        throw new Error(`Unknown phase: ${phase}`);
    }
  } catch (error) {
    console.error(`Error in phase ${phase}:`, error);
    throw error;
  }
}

export async function orchestrateAnalysis(alert: any, recentAlerts: any[], onUpdate: (data: any) => void) {
  onUpdate({ status: 'ANALYZING' });

  try {
    const result = await swarmGraph.invoke({
      alert,
      recentAlerts,
    });

    const finalAnalysisText = JSON.stringify({
      summary: result.analysis?.analysis_summary,
      intel: result.intel?.intel_summary,
      correlation: result.correlation?.campaign_name || "None detected",
      validation: result.validation?.sla_status,
      ticket: result.ticket,
      response: result.responsePlan,
      emailSent: result.emailSent
    }, null, 2);

    const updateData = {
      status: result.analysis?.is_false_positive ? 'FALSE_POSITIVE' : 'TRIAGED',
      ai_analysis: finalAnalysisText,
      mitre_attack: JSON.stringify(result.intel?.mitre_attack || []),
      remediation_steps: result.knowledge?.remediation_steps,
      email_sent: result.emailSent ? 1 : 0
    };

    onUpdate(updateData);
    return updateData;
  } catch (error: any) {
    console.error("Swarm Orchestration Error:", error);
    onUpdate({ 
      status: 'FAILED', 
      ai_analysis: JSON.stringify({ 
        error: "Swarm failed", 
        details: error?.message || "Internal Error" 
      }) 
    });
    return null;
  }
}
