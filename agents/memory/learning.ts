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
 * Best-effort IOC type inference from a raw value. Used by reinforceFeedback
 * when an out-of-band alert (one that never went through triage) requires
 * inserting a fresh ioc_memory row. Production flow seeds the type via
 * upsertIocs(); this is a defensive fallback.
 */
function inferIocType(v: string): 'ip' | 'domain' | 'hash' | 'url' | 'user' | 'file' | 'unknown' {
  const s = v.trim();
  if (!s) return 'unknown';
  // IPv4 / IPv6
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s) || /:[0-9a-f:]+/i.test(s)) return 'ip';
  // hashes (md5/sha1/sha256)
  if (/^[a-f0-9]{32}$/i.test(s) || /^[a-f0-9]{40}$/i.test(s) || /^[a-f0-9]{64}$/i.test(s)) return 'hash';
  // urls
  if (/^https?:\/\//i.test(s)) return 'url';
  // domains
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) return 'domain';
  // file paths
  if (/[\\/]/.test(s) && /\.[a-z0-9]{1,5}$/i.test(s)) return 'file';
  return 'unknown';
}

/**
 * Reinforce feedback: bump IOC fp/tp counts when analyst confirms verdict.
 *
 * Production flow seeds ioc_memory via upsertIocs() during triage, so the row
 * already exists by the time the analyst clicks Confirm FP. For out-of-band
 * alerts (manually inserted, alerts that skipped triage on error, tests), we
 * fall back to an UPSERT so the feedback signal is never silently lost. The
 * type column gets a heuristic default; a later real triage run will overwrite
 * it on next sighting.
 */
export function reinforceFeedback(
  alertIocValues: string[],
  verdict: 'FALSE_POSITIVE' | 'TRUE_POSITIVE',
): void {
  const db = memDb();
  if (!alertIocValues.length) return;

  const fpInc = verdict === 'FALSE_POSITIVE' ? 1 : 0;
  const tpInc = verdict === 'TRUE_POSITIVE' ? 1 : 0;

  // INSERT-or-UPDATE so out-of-band alerts also capture the signal.
  const stmt = db.prepare(`
    INSERT INTO ioc_memory (value, type, alert_count, fp_count, tp_count)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(value) DO UPDATE SET
      last_seen = CURRENT_TIMESTAMP,
      fp_count  = COALESCE(ioc_memory.fp_count, 0) + ?,
      tp_count  = COALESCE(ioc_memory.tp_count, 0) + ?
  `);

  for (const v of alertIocValues) {
    const value = v.trim();
    if (!value) continue;
    stmt.run(value, inferIocType(value), fpInc, tpInc, fpInc, tpInc);
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
