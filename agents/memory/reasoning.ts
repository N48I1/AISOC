import { z } from "zod";
import { memDb } from "./db.js";
import { semanticStore } from "./store.js";

/**
 * Structured reasoning emitted by every LLM-backed agent node.
 *
 * The schema is intentionally narrower than free-text logs:
 *  - `decision` is the one-line conclusion this agent reached
 *  - `evidence_for` / `evidence_against` are short bullets the agent weighed
 *  - `rejected_hypotheses` are the alternatives the agent considered and discarded
 *  - `confidence` is how sure the agent is (0..1)
 *
 * This is what the UI renders as the "Reasoning timeline" and what later runs
 * read back to maintain continuity across agents (cross-agent memory reads).
 */
export const ReasoningSchema = z.object({
  decision:             z.string().default(""),
  evidence_for:         z.array(z.string()).default([]),
  evidence_against:     z.array(z.string()).default([]),
  rejected_hypotheses:  z.array(z.string()).default([]),
  confidence:           z.number().min(0).max(1).default(0),
});

export type AgentReasoning = z.infer<typeof ReasoningSchema>;

/**
 * Snippet inserted verbatim into every node's system prompt. It instructs the
 * model to emit a `reasoning` block in addition to its existing structured
 * output. We keep wording identical across nodes so the UI can render a
 * uniform timeline.
 */
export const REASONING_PROMPT_INSTRUCTION =
`Always include a "reasoning" object in your JSON response with these fields:
  - decision: a single sentence stating the conclusion you reached for THIS agent's job
  - evidence_for: 1-4 short bullets — concrete signals from the alert/context that support the decision
  - evidence_against: 0-3 short bullets — concrete signals that argue against the decision (write [] if none, but try hard to find at least one)
  - rejected_hypotheses: 0-3 alternative interpretations you considered and discarded, each as a short phrase (e.g. "insider data theft — rejected, no privileged credential use observed")
  - confidence: float in [0,1], honestly calibrated. Lower it if evidence is thin, even if the decision feels obvious.
Do NOT pad these with filler. Real evidence only. Empty arrays are fine if there genuinely isn't any.`;

/**
 * The same instruction phrased as a JSON example fragment. Append to the
 * sample JSON block in node prompts so the model sees the exact key.
 */
export const REASONING_JSON_EXAMPLE = `"reasoning": {
  "decision": "<one-sentence conclusion>",
  "evidence_for": ["<bullet>", "<bullet>"],
  "evidence_against": ["<bullet>"],
  "rejected_hypotheses": ["<alt 1 — why rejected>"],
  "confidence": 0.8
}`;

export interface ReasoningRow extends AgentReasoning {
  id:         number;
  alert_id:   string;
  trace_id:   string;
  agent:      string;
  step:       number;
  created_at: string;
}

/**
 * Persist a structured reasoning entry from one agent node.
 *
 * Failures are non-fatal — observability data must never break the pipeline.
 */
export function recordReasoning(args: {
  alertId:  string;
  traceId:  string;
  agent:    string;
  step:     number;
  reasoning: Partial<AgentReasoning> | null | undefined;
}): void {
  const r = args.reasoning;
  if (!r || typeof r !== "object") return;
  if (!r.decision && !(r.evidence_for?.length) && !(r.evidence_against?.length)) {
    // Nothing structured to record — skip silently rather than insert empty rows.
    return;
  }

  try {
    memDb().prepare(`
      INSERT INTO incident_reasoning
        (alert_id, trace_id, agent, step, decision, evidence_for, evidence_against,
         rejected_hypotheses, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      args.alertId,
      args.traceId,
      args.agent,
      args.step,
      String(r.decision ?? "").slice(0, 1000),
      JSON.stringify(Array.isArray(r.evidence_for)         ? r.evidence_for.slice(0, 12)         : []),
      JSON.stringify(Array.isArray(r.evidence_against)     ? r.evidence_against.slice(0, 12)     : []),
      JSON.stringify(Array.isArray(r.rejected_hypotheses)  ? r.rejected_hypotheses.slice(0, 6)   : []),
      typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0,
    );
  } catch (err: any) {
    console.warn(`[Memory][reasoning] record failed for ${args.alertId}/${args.agent}:`, err?.message);
  }
}

/** Fetch the full reasoning trace for one alert, ordered by step ascending. */
export function listReasoningForAlert(alertId: string): ReasoningRow[] {
  try {
    const rows = memDb().prepare(`
      SELECT id, alert_id, trace_id, agent, step, decision,
             evidence_for, evidence_against, rejected_hypotheses, confidence, created_at
      FROM incident_reasoning
      WHERE alert_id = ?
      ORDER BY created_at ASC, step ASC, id ASC
    `).all(alertId) as any[];
    return rows.map(parseRow);
  } catch (err: any) {
    console.warn(`[Memory][reasoning] list failed for ${alertId}:`, err?.message);
    return [];
  }
}

/**
 * Fetch reasoning traces for a set of historical alerts (used to feed
 * "what did past agents conclude on similar incidents" into a new triage run).
 *
 * Returns at most `limitPerAlert` rows per alert, prioritising the triage agent
 * since that's the verdict-bearing node.
 */
export function listReasoningForAlerts(alertIds: string[], limitPerAlert = 2): Record<string, ReasoningRow[]> {
  if (!alertIds.length) return {};
  try {
    const ph = alertIds.map(() => "?").join(",");
    const rows = memDb().prepare(`
      SELECT id, alert_id, trace_id, agent, step, decision,
             evidence_for, evidence_against, rejected_hypotheses, confidence, created_at
      FROM incident_reasoning
      WHERE alert_id IN (${ph})
      ORDER BY alert_id, created_at DESC, step DESC
    `).all(...alertIds) as any[];

    const out: Record<string, ReasoningRow[]> = {};
    for (const raw of rows) {
      const row = parseRow(raw);
      const bucket = out[row.alert_id] ??= [];
      if (bucket.length < limitPerAlert) bucket.push(row);
    }
    return out;
  } catch (err: any) {
    console.warn(`[Memory][reasoning] bulk list failed:`, err?.message);
    return {};
  }
}

/**
 * Cross-agent memory read: given the current alert's description, find the most
 * semantically similar past alerts and return their (recent, triage-leaning)
 * reasoning. The triage prompt injects this as `priorReasoning` so the new
 * agent benefits from what previous agents concluded — the system stops
 * starting from a blank slate every time.
 */
export async function fetchPriorReasoning(
  description: string,
  k = 3,
  threshold = 0.7,
): Promise<Array<{ alert_id: string; similarity: number; outcome?: string; reasoning: ReasoningRow[] }>> {
  if (!description?.trim()) return [];
  try {
    const hits = await semanticStore.search(description.slice(0, 1500), k, threshold);
    if (!hits.length) return [];
    const grouped = listReasoningForAlerts(hits.map(h => h.alert_id), 2);
    return hits
      .map(h => ({
        alert_id:   h.alert_id,
        similarity: h.similarity,
        outcome:    h.outcome,
        reasoning:  grouped[h.alert_id] ?? [],
      }))
      .filter(x => x.reasoning.length > 0);
  } catch (err: any) {
    console.warn(`[Memory][reasoning] prior fetch failed:`, err?.message);
    return [];
  }
}

function parseRow(raw: any): ReasoningRow {
  const safeJson = (s: any): any[] => {
    if (Array.isArray(s)) return s;
    if (typeof s !== "string") return [];
    try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  return {
    id:                   raw.id,
    alert_id:             raw.alert_id,
    trace_id:             raw.trace_id,
    agent:                raw.agent,
    step:                 raw.step,
    decision:             raw.decision ?? "",
    evidence_for:         safeJson(raw.evidence_for),
    evidence_against:     safeJson(raw.evidence_against),
    rejected_hypotheses:  safeJson(raw.rejected_hypotheses),
    confidence:           typeof raw.confidence === "number" ? raw.confidence : 0,
    created_at:           raw.created_at,
  };
}
