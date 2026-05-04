import { memDb } from "./db.js";
import { upsertAssetContext } from "./assets.js";

export interface FpSuggestion {
  value:       string;
  type:        string;
  fp_count:    number;
  tp_count:    number;
  fp_ratio:    number;
  total:       number;
  suggestion:  'auto_register' | 'suggest';
  already_registered: boolean;
}

/**
 * Scan IOC memory for indicators that are overwhelmingly false positives.
 * Returns suggestions for auto-registering them as known infrastructure.
 *
 * Thresholds:
 *  - suggest:       fp_ratio >= 0.85 AND total >= 5
 *  - auto_register: fp_ratio >= 0.95 AND total >= 10
 */
export function scanForFpSuggestions(): FpSuggestion[] {
  const db = memDb();
  const rows = db.prepare(`
    SELECT value, type,
           COALESCE(fp_count, 0) as fp_count,
           COALESCE(tp_count, 0) as tp_count
    FROM ioc_memory
    WHERE COALESCE(fp_count, 0) + COALESCE(tp_count, 0) >= 5
  `).all() as Array<{ value: string; type: string; fp_count: number; tp_count: number }>;

  const suggestions: FpSuggestion[] = [];

  for (const r of rows) {
    const total = r.fp_count + r.tp_count;
    if (total < 5) continue;
    const fp_ratio = r.fp_count / total;
    if (fp_ratio < 0.85) continue;

    // Check if already in asset_context
    const existing = db.prepare(
      `SELECT value FROM asset_context WHERE value = ?`
    ).get(r.value);

    const suggestion: FpSuggestion['suggestion'] =
      fp_ratio >= 0.95 && total >= 10 ? 'auto_register' : 'suggest';

    suggestions.push({
      value: r.value,
      type: r.type,
      fp_count: r.fp_count,
      tp_count: r.tp_count,
      fp_ratio: Number(fp_ratio.toFixed(3)),
      total,
      suggestion,
      already_registered: !!existing,
    });
  }

  return suggestions.sort((a, b) => b.fp_ratio - a.fp_ratio || b.total - a.total);
}

/**
 * Process auto-learning: auto-register IOCs that cross the threshold.
 * Returns the list of newly registered assets.
 */
export function processAutoLearning(): Array<{ value: string; type: string; fp_ratio: number }> {
  const suggestions = scanForFpSuggestions();
  const registered: Array<{ value: string; type: string; fp_ratio: number }> = [];

  for (const s of suggestions) {
    if (s.suggestion !== 'auto_register' || s.already_registered) continue;

    upsertAssetContext({
      value: s.value,
      type: s.type === 'ip' ? 'ip' : s.type === 'domain' ? 'domain' : s.type === 'user' ? 'user' : 'host',
      role: 'production',   // conservative default; analyst can re-classify
      description: `Auto-learned: ${s.fp_count}/${s.total} alerts were FP (${(s.fp_ratio * 100).toFixed(0)}%)`,
      fp_default: true,
      source: 'auto-learned',
    });

    registered.push({ value: s.value, type: s.type, fp_ratio: s.fp_ratio });
    console.log(`[AutoLearn] Registered ${s.value} (${s.type}) as FP-by-default — ${s.fp_count}/${s.total} FP`);
  }

  return registered;
}

/**
 * Reinforce feedback: update IOC fp/tp counts when analyst confirms verdict.
 * Also triggers auto-learning check for the affected IOCs.
 */
export function reinforceFeedback(
  alertIocValues: string[],
  verdict: 'FALSE_POSITIVE' | 'TRUE_POSITIVE',
): void {
  const db = memDb();
  if (!alertIocValues.length) return;

  const fpInc = verdict === 'FALSE_POSITIVE' ? 1 : 0;
  const tpInc = verdict === 'TRUE_POSITIVE' ? 1 : 0;

  const stmt = db.prepare(`
    UPDATE ioc_memory SET
      fp_count = COALESCE(fp_count, 0) + ?,
      tp_count = COALESCE(tp_count, 0) + ?
    WHERE value = ?
  `);

  for (const v of alertIocValues) {
    stmt.run(fpInc, tpInc, v.trim());
  }

  // If TP verdict on a previously auto-learned asset, remove fp_default
  if (verdict === 'TRUE_POSITIVE') {
    for (const v of alertIocValues) {
      const asset = db.prepare(
        `SELECT value, source FROM asset_context WHERE value = ? AND source = 'auto-learned'`
      ).get(v.trim()) as any;
      if (asset) {
        db.prepare(`UPDATE asset_context SET fp_default = 0, description = description || ' [REVOKED by TP feedback]' WHERE value = ?`).run(v.trim());
        console.log(`[AutoLearn] Revoked fp_default for ${v} — analyst confirmed TRUE POSITIVE`);
      }
    }
  }
}
