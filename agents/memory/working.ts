import { memDb } from "./db.js";

export function writeWorkingMemory(
  alertId: string,
  traceId: string,
  step:    number,
  thought: string,
  action:  string,
  resultSummary: string,
): void {
  try {
    memDb().prepare(`
      INSERT INTO working_memory (alert_id, trace_id, step, thought, action, result_summary)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(alertId, traceId, step, thought.slice(0, 2000), action.slice(0, 200), resultSummary.slice(0, 4000));
  } catch (err: any) {
    console.warn("[Memory][working] write failed:", err?.message);
  }
}

export function getWorkingMemory(alertId: string) {
  return memDb().prepare(`
    SELECT step, trace_id, thought, action, result_summary, created_at
    FROM working_memory
    WHERE alert_id = ?
    ORDER BY created_at DESC, step DESC
    LIMIT 50
  `).all(alertId);
}
