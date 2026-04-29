import { semanticStore } from "../memory/store.js";

/**
 * Recall worker — purely deterministic, no LLM.
 * Queries semantic memory for past incidents similar to the current alert.
 * Returns up to 5 hits with similarity ≥ 0.65.
 *
 * Gracefully returns empty when Ollama embeddings are unavailable.
 */
export async function recallNode(state: any) {
  const logs: string[] = [];
  const description    = state.alert?.description || "";
  const triageSummary  = state.analysis?.analysis_summary || "";
  const queryText      = [description, triageSummary].filter(Boolean).join("\n").slice(0, 2000);

  if (!queryText.trim()) {
    logs.push(`[Recall] No query text — skipped.`);
    return { recall: { available: true, hits: [] }, agentLogs: logs };
  }

  const hits = await semanticStore.search(queryText, 5, 0.65);

  if (hits.length === 0) {
    logs.push(`[Recall] No semantically similar past incidents found.`);
  } else {
    logs.push(`[Recall] Found ${hits.length} similar past incident(s):`);
    for (const h of hits) {
      logs.push(`[Recall]   → ${(h.similarity * 100).toFixed(0)}%  ${h.alert_id.slice(0, 12)}: ${h.summary.slice(0, 80)}`);
    }
  }

  return {
    recall: { available: true, hits },
    agentLogs: logs,
  };
}
