import { lookupIocs, extractRawIocValues } from "../memory/ioc.js";

/**
 * IOC Check worker — purely deterministic, no LLM.
 * Looks up the current alert's IOCs in the long-term ioc_memory table
 * and returns prior observations with confidence-decayed scores.
 */
export async function iocCheckNode(state: any) {
  const logs: string[] = [];
  const values = extractRawIocValues(state.alert, state.analysis?.iocs);

  if (values.length === 0) {
    logs.push(`[IOC-Check] No IOCs to look up.`);
    return { ioc_check: { hits: [], lookups: 0 }, agentLogs: logs };
  }

  const hits = lookupIocs(values);

  if (hits.length === 0) {
    logs.push(`[IOC-Check] ${values.length} IOC(s) checked — none previously seen.`);
  } else {
    logs.push(`[IOC-Check] ${values.length} IOC(s) checked, ${hits.length} previously seen:`);
    for (const h of hits.slice(0, 5)) {
      logs.push(`[IOC-Check]   → ${h.value} (${h.type}) seen ${h.alert_count}× · score=${h.score} · ${h.threat_level || "—"}`);
    }
  }

  return {
    ioc_check: { hits, lookups: values.length },
    agentLogs: logs,
  };
}
