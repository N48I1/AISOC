import { semanticStore } from "./store.js";
import { embedText } from "./embeddings.js";
import { memDb } from "./db.js";

interface CommitParams {
  alertId:        string;
  idempotencyKey: string;
  alertDescription: string;
  triage:         any;       // analysis result
  intel?:         any;
  ticket?:        any;
  outcome?:       string;    // TRIAGED | FALSE_POSITIVE | ESCALATED | CLOSED
}

/**
 * Distill an orchestration's outputs into a single semantic-memory record.
 * Embeddings are produced from a compact text summary; if Ollama isn't
 * available the record is still written without an embedding (no recall hits,
 * but the historical row is preserved).
 *
 * Fire-and-forget: caller does NOT await this. Idempotent via traceId.
 */
export function commitAsync(p: CommitParams): void {
  void doCommit(p).catch((err) =>
    console.warn(`[Memory][insight] commit failed for ${p.alertId}:`, err?.message)
  );
}

async function doCommit(p: CommitParams) {
  const ttpTags    = Array.isArray(p.intel?.mitre_attack) ? p.intel.mitre_attack : [];
  const actor      = p.intel?.threat_actor_type || null;
  const family     = p.intel?.campaign_family   || null;
  const summary    = buildSummary(p);
  const attackPath = buildAttackPattern(p);

  // Compose embedding text — semantic anchor for future recall
  const embedSrc = [
    p.alertDescription,
    summary,
    attackPath,
    ttpTags.join(" "),
    family,
  ].filter(Boolean).join("\n");

  const vec = await embedText(embedSrc);

  await semanticStore.add({
    alert_id:        p.alertId,
    idempotency_key: p.idempotencyKey,
    summary,
    attack_pattern:  attackPath || undefined,
    threat_actor:    family || actor || undefined,
    outcome:         p.outcome,
    ttp_tags:        ttpTags,
    embedding:       vec,
  });
}

function buildSummary(p: CommitParams): string {
  const parts: string[] = [];
  const cat   = p.triage?.attack_category;
  const stage = p.triage?.kill_chain_stage;
  const risk  = p.triage?.risk_score;
  if (cat || stage)              parts.push(`${cat ?? "incident"} at ${stage ?? "unknown stage"}`);
  if (typeof risk === "number")  parts.push(`risk ${risk}`);
  if (p.intel?.intel_summary)    parts.push(p.intel.intel_summary);
  if (p.ticket?.title)           parts.push(`Ticket: ${p.ticket.title}`);
  return parts.join(" — ").slice(0, 800);
}

function buildAttackPattern(p: CommitParams): string {
  const tags = Array.isArray(p.intel?.mitre_attack) ? p.intel.mitre_attack : [];
  if (tags.length > 0) return tags.join(" → ");
  return p.triage?.kill_chain_stage || "";
}

/** Recent insight rows (for UI / debugging). */
export function recentInsights(limit = 50) {
  return memDb().prepare(`
    SELECT alert_id, summary, attack_pattern, threat_actor, outcome, ttp_tags, created_at
    FROM incident_insights
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}
