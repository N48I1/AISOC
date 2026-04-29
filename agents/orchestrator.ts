import { newRunContext, type RunContext } from "./shared/llm.js";
import { resolveModelForPhase, type ModelAssignments } from "./config.js";

import { alertAnalysisNode } from "./nodes/analysis.js";
import { threatIntelNode    } from "./nodes/intel.js";
import { ragKnowledgeNode   } from "./nodes/knowledge.js";
import { correlationNode    } from "./nodes/correlation.js";
import { ticketingNode      } from "./nodes/ticketing.js";
import { responseNode       } from "./nodes/response.js";
import { validationNode     } from "./nodes/validation.js";
import { recallNode         } from "./nodes/recall.js";
import { iocCheckNode       } from "./nodes/ioc_check.js";

import { planner, type WorkerName } from "./planner.js";
import { semanticStore       } from "./memory/store.js";
import { upsertIocs, lookupIocs, extractRawIocValues } from "./memory/ioc.js";
import { commitAsync         } from "./memory/insights.js";
import { writeWorkingMemory  } from "./memory/working.js";

export interface OrchestrationOutput {
  ai_analysis:      string;
  mitre_attack:     string;
  remediation_steps:string;
  email_sent:       number;
  status:           string;
}

interface RunOpts {
  modelAssignments?: ModelAssignments;
}

/**
 * Hub-and-Swarm orchestration.
 *
 * Flow:
 *   1. Pre-flight memory recall (semantic + IOC) — purely deterministic, no LLM
 *   2. Mandatory triage (analysis node) — produces IOCs and risk score
 *   3. Short-circuit if triage flags high-confidence false positive
 *   4. Planner LLM dispatches investigators (intel/knowledge/correlation/recall/ioc_check) in parallel
 *   5. Optional reflection round — at most one extra dispatch
 *   6. Composers run sequentially (ticketing → response → validation), respecting skip flags
 *   7. IOC memory written synchronously; insight committed fire-and-forget
 *
 * Output shape is identical to the legacy linear path so the UI is unchanged.
 */
export async function runHubAndSwarm(
  alert: any,
  recentAlerts: any[] = [],
  opts: RunOpts = {},
): Promise<OrchestrationOutput> {
  const ctx = newRunContext();
  const traceId = ctx.traceId;
  const log = (m: string) => { ctx.agentLogs.push(`[${traceId.slice(0, 8)}] ${m}`); };
  log(`Orchestration started (mode=swarm)`);

  const modelFor = (phase: any) => resolveModelForPhase(phase, opts.modelAssignments);

  // ── 1. Pre-flight memory recall (deterministic, parallel) ────────────────
  const queryText = `${alert.description ?? ""}`.slice(0, 1500);
  const [recallHits, iocPreflightValues] = await Promise.all([
    semanticStore.search(queryText, 5, 0.65).catch(() => []),
    Promise.resolve(extractRawIocValues(alert)),
  ]);
  const iocPreflight = lookupIocs(iocPreflightValues);

  if (recallHits.length > 0) log(`Recall: ${recallHits.length} similar past incident(s)`);
  if (iocPreflight.length > 0) log(`IOC pre-flight: ${iocPreflight.length} known IOC(s)`);

  // ── 2. Mandatory triage ──────────────────────────────────────────────────
  const triageRes = await alertAnalysisNode({ alert, recentAlerts }, modelFor("analysis"), ctx);
  ctx.agentLogs.push(...(triageRes.agentLogs ?? []));
  const triage = triageRes.analysis;

  // ── 3. FP short-circuit ──────────────────────────────────────────────────
  if (triage?.is_false_positive && (triage?.false_positive_confidence ?? 0) > 0.85) {
    log(`Confirmed false positive — short-circuiting orchestration.`);
    upsertIocs(triage.iocs ?? {}, alert.id, "Low");
    commitAsync({
      alertId: alert.id, idempotencyKey: traceId,
      alertDescription: alert.description ?? "",
      triage, outcome: "FALSE_POSITIVE",
    });
    return composeOutput({
      analysis: triage, intel: null, knowledge: null, correlation: null,
      ticket: null, responsePlan: null, validation: null,
      ctx, fpShortCircuit: true,
    });
  }

  // ── 4. Planner ───────────────────────────────────────────────────────────
  const plan = await planner({
    alert, triage, recentAlerts,
    recallHits, iocHits: iocPreflight,
    ctx,
  });
  log(`Planner: ${plan.investigators.map(i => i.worker).join("+") || "none"}`);
  writeWorkingMemory(alert.id, traceId, 1, plan.reasoning, "plan",
    JSON.stringify({ workers: plan.investigators.map(i => i.worker), skip: plan.composers_skip }));

  let workerResults = await runInvestigatorsParallel(
    plan.investigators.map(i => i.worker), plan.cost_budget,
    { alert, recentAlerts, analysis: triage, recall: { available: true, hits: recallHits } },
    ctx, modelFor,
  );
  let costSpent = plan.investigators.length;

  // ── 5. Optional reflection ───────────────────────────────────────────────
  if (plan.re_evaluate && costSpent < plan.cost_budget && !ctx.quotaExhausted) {
    log(`Planner round 2 (reflection)`);
    const plan2 = await planner({
      alert, triage, recentAlerts,
      recallHits, iocHits: iocPreflight,
      priorResults: workerResults, reflection: true,
      ctx,
    });
    const newWorkers = plan2.investigators
      .map(i => i.worker)
      .filter(w => !(w in workerResults));   // skip workers we already ran
    if (newWorkers.length > 0) {
      log(`Reflection dispatched: ${newWorkers.join("+")}`);
      writeWorkingMemory(alert.id, traceId, 2, plan2.reasoning, "reflect",
        JSON.stringify({ extra: newWorkers }));
      const more = await runInvestigatorsParallel(
        newWorkers, plan.cost_budget - costSpent,
        { alert, recentAlerts, analysis: triage, ...workerResults },
        ctx, modelFor,
      );
      workerResults = { ...workerResults, ...more };
    }
  }

  // ── 6. Composers (sequential, each reads prior outputs) ──────────────────
  const composerState = { alert, recentAlerts, analysis: triage, ...workerResults };
  let ticket: any = null, responsePlan: any = null, validation: any = null;

  if (!plan.composers_skip.includes("ticketing")) {
    const r = await ticketingNode(composerState, modelFor("ticketing"), ctx);
    ctx.agentLogs.push(...(r.agentLogs ?? []));
    ticket = r.ticket;
  }
  if (!plan.composers_skip.includes("response")) {
    const r = await responseNode({ ...composerState, ticket }, modelFor("response"), ctx);
    ctx.agentLogs.push(...(r.agentLogs ?? []));
    responsePlan = r.responsePlan;
  }
  if (!plan.composers_skip.includes("validation")) {
    const r = await validationNode({ ...composerState, ticket, responsePlan }, modelFor("validation"), ctx);
    ctx.agentLogs.push(...(r.agentLogs ?? []));
    validation = r.validation;
  }

  // ── 7. Memory commits ────────────────────────────────────────────────────
  upsertIocs(triage?.iocs ?? {}, alert.id, ticket?.priority);
  commitAsync({
    alertId: alert.id, idempotencyKey: traceId,
    alertDescription: alert.description ?? "",
    triage, intel: workerResults.intel, ticket,
    outcome: triage?.is_false_positive ? "FALSE_POSITIVE"
           : ticket?.priority === "CRITICAL" ? "ESCALATED"
           : "TRIAGED",
  });

  return composeOutput({
    analysis: triage,
    intel: workerResults.intel ?? null,
    knowledge: workerResults.knowledge ?? null,
    correlation: workerResults.correlation ?? null,
    recall: workerResults.recall ?? { available: true, hits: recallHits },
    ioc_check: workerResults.ioc_check ?? null,
    ticket, responsePlan, validation,
    ctx, fpShortCircuit: false,
  });
}

// ── Worker dispatch ────────────────────────────────────────────────────────

async function runInvestigatorsParallel(
  workers: string[],
  costBudget: number,
  state: any,
  ctx: RunContext,
  modelFor: (p: any) => string,
): Promise<Record<string, any>> {
  const tasks: Array<Promise<{ key: string; data: any; logs: string[] }>> = [];
  const allowed = workers.slice(0, costBudget);

  for (const worker of allowed) {
    tasks.push(runOneInvestigator(worker as WorkerName, state, ctx, modelFor));
  }
  const settled = await Promise.allSettled(tasks);

  const out: Record<string, any> = {};
  for (const r of settled) {
    if (r.status === "fulfilled") {
      out[r.value.key] = r.value.data;
      ctx.agentLogs.push(...r.value.logs);
    } else {
      ctx.agentLogs.push(`[Worker error] ${r.reason}`);
    }
  }
  return out;
}

async function runOneInvestigator(
  worker: WorkerName,
  state: any,
  ctx: RunContext,
  modelFor: (p: any) => string,
): Promise<{ key: string; data: any; logs: string[] }> {
  switch (worker) {
    case "intel": {
      const r = await threatIntelNode(state, modelFor("intel"), ctx);
      return { key: "intel", data: r.intel, logs: r.agentLogs ?? [] };
    }
    case "knowledge": {
      const r = await ragKnowledgeNode(state, modelFor("knowledge"), ctx);
      return { key: "knowledge", data: r.knowledge, logs: r.agentLogs ?? [] };
    }
    case "correlation": {
      const r = await correlationNode(state, modelFor("correlation"), ctx);
      return { key: "correlation", data: r.correlation, logs: r.agentLogs ?? [] };
    }
    case "recall": {
      const r = await recallNode(state);
      return { key: "recall", data: r.recall, logs: r.agentLogs ?? [] };
    }
    case "ioc_check": {
      const r = await iocCheckNode(state);
      return { key: "ioc_check", data: r.ioc_check, logs: r.agentLogs ?? [] };
    }
  }
}

// ── Output composition (matches legacy shape) ──────────────────────────────

function composeOutput(args: {
  analysis: any; intel: any; knowledge: any; correlation: any;
  ticket: any; responsePlan: any; validation: any;
  recall?: any; ioc_check?: any;
  ctx: RunContext; fpShortCircuit: boolean;
}): OrchestrationOutput {
  const { analysis, intel, knowledge, correlation, ticket, responsePlan, validation, ctx } = args;

  const aiAnalysis = {
    summary:    analysis?.analysis_summary,
    iocs:       analysis?.iocs,
    intel:      intel?.intel_summary,
    correlation: correlation?.campaign_name || "Isolated Incident",
    ticket,
    response:   responsePlan,
    validation: validation?.sla_status,
    agentLogs:  ctx.agentLogs,
    quota_exhausted: ctx.quotaExhausted,
    fallback_phases: ctx.fallbackPhases,
    trace_id:   ctx.traceId,
    phaseData: {
      analysis,
      intel,
      knowledge,
      correlation,
      ticket,
      response: responsePlan,
      validation,
      recall:    args.recall    ?? undefined,
      ioc_check: args.ioc_check ?? undefined,
    },
  };

  return {
    ai_analysis:       JSON.stringify(aiAnalysis),
    mitre_attack:      JSON.stringify(intel?.mitre_attack || []),
    remediation_steps: knowledge?.remediation_steps || "",
    email_sent:        ticket?.email_notification_sent ? 1 : 0,
    status:            args.fpShortCircuit ? "FALSE_POSITIVE"
                      : analysis?.is_false_positive ? "FALSE_POSITIVE" : "TRIAGED",
  };
}
