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
import { lookupAssetContext, extractAssetValuesFromAlert } from "./memory/assets.js";
import { checkSuppressionRules } from "./memory/suppression.js";

export interface OrchestrationOutput {
  ai_analysis:      string;
  mitre_attack:     string;
  remediation_steps:string;
  email_sent:       number;
  status:           string;
}

/** Lightweight FP-scan result (Steps 0-3 only). */
export interface FpScanResult {
  is_fp:          boolean;
  fp_confidence:  number;
  fp_reason:      string | null;
  fp_method:      'suppression' | 'memory' | 'triage' | null;   // which layer caught it
  fp_details:     any;              // structured evidence (rule name, IOC data, similarity hit)
  triage:         any;              // full triage analysis (reused if investigation follows)
  ai_analysis:    string;           // JSON string matching OrchestrationOutput shape (partial)
  status:         string;
  agentLogs:      string[];
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

  // ── 0. Suppression rules — collect as signal, do NOT exit early ─────────────
  const suppressionHit = checkSuppressionRules(alert);
  if (suppressionHit) {
    log(`Suppression signal: "${suppressionHit.rule_name}" matched (confidence=${(suppressionHit.confidence * 100).toFixed(0)}%) — continuing through full intelligence pipeline`);
  }

  // ── 1. Pre-flight intelligence (all run in parallel, always) ─────────────
  const queryText   = `${alert.description ?? ""}`.slice(0, 1500);
  const assetValues = extractAssetValuesFromAlert(alert);
  const [recallHits, iocPreflightValues, assetCtx] = await Promise.all([
    semanticStore.search(queryText, 5, 0.65).catch(() => []),
    Promise.resolve(extractRawIocValues(alert)),
    Promise.resolve(lookupAssetContext(assetValues)),
  ]);
  const iocPreflight = lookupIocs(iocPreflightValues);

  if (recallHits.length > 0)   log(`Recall: ${recallHits.length} similar past incident(s)`);
  if (iocPreflight.length > 0) log(`IOC pre-flight: ${iocPreflight.length} known IOC(s)`);
  if (assetCtx.length > 0)     log(`Asset context: ${assetCtx.map(a => `${a.value}=${a.role}${a.fp_default ? ' (FP-by-default)' : ''}`).join(', ')}`);

  // Collect all FP signals — each is evidence for triage, not a verdict on its own
  const fpSimilar    = recallHits.find((h: any) => h.outcome === 'FALSE_POSITIVE' && h.similarity > 0.85);
  const fpAsset      = assetCtx.find(a => a.fp_default === 1);
  const fpIocPattern = iocPreflight.find((i: any) =>
    (i.fp_ratio ?? 0) >= 0.85 && ((i.fp_count ?? 0) + (i.tp_count ?? 0)) >= 5);
  const memoryFpHint = (fpSimilar || fpAsset || fpIocPattern) ? {
    fpSimilar:    fpSimilar    ? { alert_id: fpSimilar.alert_id, summary: fpSimilar.summary, similarity: fpSimilar.similarity } : null,
    fpAsset:      fpAsset      ? { value: fpAsset.value, role: fpAsset.role, description: fpAsset.description } : null,
    fpIocPattern: fpIocPattern ? { value: fpIocPattern.value, fp_count: fpIocPattern.fp_count, tp_count: fpIocPattern.tp_count, fp_ratio: fpIocPattern.fp_ratio } : null,
  } : null;
  if (memoryFpHint) log(`Memory FP signals active — passing to triage as context.`);

  // Track which signals were active (for fp_method analytics)
  const hasSuppressionSignal = !!suppressionHit;
  const hasMemorySignal      = !!memoryFpHint;

  // ── 2. Mandatory triage — receives ALL signals as structured context ───────
  const triageRes = await alertAnalysisNode({
    alert, recentAlerts,
    assetContext:    assetCtx,
    priorFpInsights: recallHits.filter((h: any) => h.outcome === 'FALSE_POSITIVE'),
    iocMemoryHits:   iocPreflight,
    memoryFpHint,
    suppressionHit,   // rule-based signal
  }, modelFor("analysis"), ctx);
  ctx.agentLogs.push(...(triageRes.agentLogs ?? []));
  const triage = triageRes.analysis;

  // ── 3. FP short-circuit (triage has now seen all evidence) ────────────────
  if (triage?.is_false_positive && (triage?.false_positive_confidence ?? 0) > 0.85) {
    const triggeredBy = hasSuppressionSignal ? 'suppression'
                      : hasMemorySignal      ? 'memoryFP'
                      :                        'triage';
    log(`Confirmed false positive — short-circuiting orchestration. (triggered_by=${triggeredBy})`);
    upsertIocs(triage.iocs ?? {}, alert.id, "Low", "FALSE_POSITIVE");
    commitAsync({
      alertId: alert.id, idempotencyKey: traceId,
      alertDescription: alert.description ?? "",
      triage, outcome: "FALSE_POSITIVE",
      triggered_by: triggeredBy,
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
  const finalOutcome = triage?.is_false_positive ? "FALSE_POSITIVE"
                     : ticket?.priority === "CRITICAL" ? "ESCALATED"
                     : "TRIAGED";
  upsertIocs(triage?.iocs ?? {}, alert.id, ticket?.priority, finalOutcome as any);
  commitAsync({
    alertId: alert.id, idempotencyKey: traceId,
    alertDescription: alert.description ?? "",
    triage, intel: workerResults.intel, ticket,
    outcome: finalOutcome,
    triggered_by: 'composer',
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

// ── FP Scan (Steps 0-3 only) ───────────────────────────────────────────────
/**
 * Lightweight FP-only scan.  Runs Steps 0-3 of the pipeline:
 *   0. Suppression rules (deterministic)
 *   1. Pre-flight memory recall (deterministic)
 *   2. Mandatory triage LLM (1 call)
 *   3. FP short-circuit decision
 *
 * Cost: 0 LLM calls if suppression catches it, else 1 LLM call (triage).
 * The triage result is stored so a subsequent `runInvestigation()` can skip it.
 */
export async function runFpScan(
  alert: any,
  recentAlerts: any[] = [],
  opts: RunOpts = {},
): Promise<FpScanResult> {
  const ctx = newRunContext();
  const traceId = ctx.traceId;
  const log = (m: string) => { ctx.agentLogs.push(`[${traceId.slice(0, 8)}] ${m}`); };
  log(`FP scan started`);

  const modelFor = (phase: any) => resolveModelForPhase(phase, opts.modelAssignments);

  // ── 0. Suppression rules — signal only, no early exit ─────────────────
  const suppressionHit = checkSuppressionRules(alert);
  if (suppressionHit) {
    log(`Suppression signal: "${suppressionHit.rule_name}" matched (confidence=${(suppressionHit.confidence * 100).toFixed(0)}%) — continuing through full pipeline`);
  }

  // ── 1. Full intelligence pre-flight — RAG + IOC + assets + correlation ──
  // All run in parallel so FP scan has the same evidence quality as full orchestration
  const queryText   = `${alert.description ?? ""}`.slice(0, 1500);
  const assetValues = extractAssetValuesFromAlert(alert);
  const [recallHits, iocPreflightValues, assetCtx, corrRes] = await Promise.all([
    semanticStore.search(queryText, 5, 0.65).catch(() => []),
    Promise.resolve(extractRawIocValues(alert)),
    Promise.resolve(lookupAssetContext(assetValues)),
    correlationNode({ alert, recentAlerts }, modelFor("correlation"), ctx).catch(() => null),
  ]);
  const iocPreflight = lookupIocs(iocPreflightValues);
  ctx.agentLogs.push(...(corrRes?.agentLogs ?? []));

  if (recallHits.length > 0)   log(`Recall: ${recallHits.length} similar past incident(s)`);
  if (iocPreflight.length > 0) log(`IOC pre-flight: ${iocPreflight.length} known IOC(s)`);
  if (assetCtx.length > 0)     log(`Asset context: ${assetCtx.map(a => `${a.value}=${a.role}${a.fp_default ? ' (FP-by-default)' : ''}`).join(', ')}`);
  if (corrRes?.correlation)     log(`Correlation: campaign_detected=${corrRes.correlation.campaign_detected}, escalation_needed=${corrRes.correlation.escalation_needed}`);

  const fpSimilar    = recallHits.find((h: any) => h.outcome === 'FALSE_POSITIVE' && h.similarity > 0.85);
  const fpAsset      = assetCtx.find(a => a.fp_default === 1);
  const fpIocPattern = iocPreflight.find((i: any) =>
    (i.fp_ratio ?? 0) >= 0.85 && ((i.fp_count ?? 0) + (i.tp_count ?? 0)) >= 5);
  const memoryFpHint = (fpSimilar || fpAsset || fpIocPattern) ? {
    fpSimilar:    fpSimilar    ? { alert_id: fpSimilar.alert_id, summary: fpSimilar.summary, similarity: fpSimilar.similarity } : null,
    fpAsset:      fpAsset      ? { value: fpAsset.value, role: fpAsset.role, description: fpAsset.description } : null,
    fpIocPattern: fpIocPattern ? { value: fpIocPattern.value, fp_count: fpIocPattern.fp_count, tp_count: fpIocPattern.tp_count, fp_ratio: fpIocPattern.fp_ratio } : null,
  } : null;

  const hasSuppressionSignal = !!suppressionHit;
  const hasMemorySignal      = !!memoryFpHint;

  // ── 2. Mandatory triage — receives ALL intelligence as structured context ─
  const triageRes = await alertAnalysisNode({
    alert, recentAlerts,
    assetContext:      assetCtx,
    priorFpInsights:   recallHits.filter((h: any) => h.outcome === 'FALSE_POSITIVE'),
    iocMemoryHits:     iocPreflight,
    memoryFpHint,
    suppressionHit,         // rule-based signal
    correlationResult:      corrRes?.correlation ?? null,   // campaign/escalation signal
  }, modelFor("analysis"), ctx);
  ctx.agentLogs.push(...(triageRes.agentLogs ?? []));
  const triage = triageRes.analysis;

  // ── 3. FP decision — threshold 0.72 (scan is purpose-built for FP detection)
  // Correlation can VETO: if campaign_detected=true or escalation_needed=true,
  // never suppress as FP regardless of other signals.
  const correlationVeto = !!(corrRes?.correlation?.campaign_detected || corrRes?.correlation?.escalation_needed);
  if (correlationVeto) {
    log(`Correlation VETO: campaign or escalation detected — overriding any FP signals`);
  }

  const isFp = !correlationVeto &&
    !!(triage?.is_false_positive && (triage?.false_positive_confidence ?? 0) > 0.72);

  if (isFp) {
    const triggeredBy = hasSuppressionSignal ? 'suppression'
                      : hasMemorySignal      ? 'memoryFP'
                      :                        'triage';
    log(`FP scan verdict: FALSE POSITIVE (confidence=${(triage.false_positive_confidence * 100).toFixed(0)}%, method=${triggeredBy})`);
    upsertIocs(triage.iocs ?? {}, alert.id, "Low", "FALSE_POSITIVE");
    commitAsync({
      alertId: alert.id, idempotencyKey: traceId,
      alertDescription: alert.description ?? "",
      triage, outcome: "FALSE_POSITIVE",
      triggered_by: triggeredBy,
    });

    const fpDetails: any = {};
    if (suppressionHit)          fpDetails.suppression_rule = { rule_name: suppressionHit.rule_name, rule_id: suppressionHit.rule_id };
    if (memoryFpHint?.fpSimilar)    fpDetails.similar_incident = memoryFpHint.fpSimilar;
    if (memoryFpHint?.fpAsset)      fpDetails.known_asset = memoryFpHint.fpAsset;
    if (memoryFpHint?.fpIocPattern) fpDetails.ioc_pattern = memoryFpHint.fpIocPattern;

    return {
      is_fp: true,
      fp_confidence:  triage.false_positive_confidence,
      fp_reason:      triage.false_positive_reason || 'Triage LLM classified as false positive',
      fp_method:      triggeredBy as any,
      fp_details:     fpDetails,
      triage,
      ai_analysis: composeOutput({ analysis: triage, intel: null, knowledge: null, correlation: corrRes?.correlation ?? null, ticket: null, responsePlan: null, validation: null, ctx, fpShortCircuit: true }).ai_analysis,
      status: 'FALSE_POSITIVE',
      agentLogs: ctx.agentLogs,
    };
  }

  // Not FP
  log(`FP scan verdict: NOT FALSE POSITIVE (risk=${triage?.risk_score}, category=${triage?.attack_category}${correlationVeto ? ', correlation veto applied' : ''})`);
  return {
    is_fp: false,
    fp_confidence:  triage?.false_positive_confidence ?? 0,
    fp_reason:      null,
    fp_method:      null,
    fp_details:     null,
    triage,
    ai_analysis: composeOutput({ analysis: triage, intel: null, knowledge: null, correlation: corrRes?.correlation ?? null, ticket: null, responsePlan: null, validation: null, ctx, fpShortCircuit: false }).ai_analysis,
    status: 'FILTERED',
    agentLogs: ctx.agentLogs,
  };
}


// ── Investigation (Steps 4-7 only) ─────────────────────────────────────────
/**
 * Runs the investigation phase (planner + investigators + composers + memory commit).
 * Assumes triage already ran via runFpScan().  The `existingTriage` param is the
 * triage analysis from the FP scan — we skip re-running Steps 0-3.
 */
export async function runInvestigation(
  alert: any,
  existingTriage: any,
  recentAlerts: any[] = [],
  opts: RunOpts = {},
): Promise<OrchestrationOutput> {
  const ctx = newRunContext();
  const traceId = ctx.traceId;
  const log = (m: string) => { ctx.agentLogs.push(`[${traceId.slice(0, 8)}] ${m}`); };
  log(`Investigation started (triage reused from FP scan)`);

  const modelFor = (phase: any) => resolveModelForPhase(phase, opts.modelAssignments);
  const triage = existingTriage;

  // Re-run pre-flight for recall/ioc context needed by planner
  const queryText = `${alert.description ?? ""}`.slice(0, 1500);
  const assetValues = extractAssetValuesFromAlert(alert);
  const [recallHits, iocPreflightValues] = await Promise.all([
    semanticStore.search(queryText, 5, 0.65).catch(() => []),
    Promise.resolve(extractRawIocValues(alert)),
  ]);
  const iocPreflight = lookupIocs(iocPreflightValues);

  // ── 4. Planner ────────────────────────────────────────────────────────
  const plan = await planner({
    alert, triage, recentAlerts,
    recallHits, iocHits: iocPreflight,
    ctx,
  });
  log(`Planner: ${plan.investigators.map((i: any) => i.worker).join("+") || "none"}`);
  writeWorkingMemory(alert.id, traceId, 1, plan.reasoning, "plan",
    JSON.stringify({ workers: plan.investigators.map((i: any) => i.worker), skip: plan.composers_skip }));

  let workerResults = await runInvestigatorsParallel(
    plan.investigators.map((i: any) => i.worker), plan.cost_budget,
    { alert, recentAlerts, analysis: triage, recall: { available: true, hits: recallHits } },
    ctx, modelFor,
  );
  let costSpent = plan.investigators.length;

  // ── 5. Optional reflection ────────────────────────────────────────────
  if (plan.re_evaluate && costSpent < plan.cost_budget && !ctx.quotaExhausted) {
    log(`Planner round 2 (reflection)`);
    const plan2 = await planner({
      alert, triage, recentAlerts,
      recallHits, iocHits: iocPreflight,
      priorResults: workerResults, reflection: true,
      ctx,
    });
    const newWorkers = plan2.investigators
      .map((i: any) => i.worker)
      .filter((w: string) => !(w in workerResults));
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

  // ── 6. Composers ──────────────────────────────────────────────────────
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

  // ── 7. Memory commits ─────────────────────────────────────────────────
  const finalOutcome = triage?.is_false_positive ? "FALSE_POSITIVE"
                     : ticket?.priority === "CRITICAL" ? "ESCALATED"
                     : "TRIAGED";
  upsertIocs(triage?.iocs ?? {}, alert.id, ticket?.priority, finalOutcome as any);
  commitAsync({
    alertId: alert.id, idempotencyKey: traceId,
    alertDescription: alert.description ?? "",
    triage, intel: workerResults.intel, ticket,
    outcome: finalOutcome,
    triggered_by: 'composer',
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
