/**
 * Replay the orchestrator on a list of alert IDs so per-agent reasoning gets
 * captured into incident_reasoning. Useful when alerts were seeded directly
 * into the DB (bypassing the orchestrator) and their incidents now have empty
 * Reasoning tabs.
 *
 * Usage:
 *   npx tsx scripts/replay-reasoning.ts <alertId> [alertId...]
 *   npx tsx scripts/replay-reasoning.ts --test     # all three INC-TEST-* alerts
 */
import Database from 'better-sqlite3';
import { setProviderDb } from '../agents/shared/client.js';
import { ensureLlmProvidersTable, seedProvidersFromEnv } from '../agents/shared/llm-providers.js';
import { runOrchestration, AGENT_PHASES, DEFAULT_AGENT_MODELS, isAgentPhase, type ModelAssignments } from '../agents.js';
import dotenv from 'dotenv';

dotenv.config();

const DB_PATH = process.env.SOC_DB_PATH || 'soc.db';
const db = new Database(DB_PATH);

// Wire the same provider registry the dev server uses
try { ensureLlmProvidersTable(db); seedProvidersFromEnv(db); setProviderDb(db); }
catch (err: any) { console.warn('[replay] provider init:', err?.message); }

const TEST_ALERTS = [
  'test-ssh-bruteforce-external',
  'test-dga-finance-workstation',
  'test-credential-access-prod-db',
];

async function main() {
  const args = process.argv.slice(2);
  const ids = args.includes('--test') ? TEST_ALERTS : args.filter(a => !a.startsWith('--'));
  if (ids.length === 0) {
    console.error('Usage: npx tsx scripts/replay-reasoning.ts <alertId> [alertId...]');
    console.error('       npx tsx scripts/replay-reasoning.ts --test');
    process.exit(1);
  }

  // Mirror server.ts getAgentModelAssignments() — DB-stored phase→model
  // overrides, falling back to DEFAULT_AGENT_MODELS.
  const assignments: ModelAssignments = {};
  for (const phase of AGENT_PHASES) assignments[phase] = DEFAULT_AGENT_MODELS[phase];
  try {
    const rows = db.prepare('SELECT phase, model FROM agent_settings').all() as Array<{ phase: string; model: string }>;
    for (const r of rows) if (isAgentPhase(r.phase)) assignments[r.phase] = r.model;
  } catch { /* table may not exist */ }

  for (const id of ids) {
    const alert: any = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
    if (!alert) { console.warn(`[skip] alert ${id} not found`); continue; }
    const before: any = db.prepare('SELECT COUNT(*) AS c FROM incident_reasoning WHERE alert_id = ?').get(id);
    console.log(`\n=== replaying ${id} (status=${alert.status}, severity=${alert.severity}) — existing reasoning rows: ${before.c}`);

    const recent = db.prepare(
      `SELECT * FROM alerts WHERE id != ? AND timestamp >= datetime('now', '-3 days') ORDER BY timestamp DESC LIMIT 50`
    ).all(id);

    try {
      const t0 = Date.now();
      // Run end-to-end. We DON'T persist the alert-status change afterwards —
      // we only want the side effect of recordReasoning() firing inside the
      // orchestrator. The existing incident_alerts link stays intact.
      const result: any = await runOrchestration(alert, recent, { modelAssignments: assignments });
      const dt = Math.round((Date.now() - t0) / 100) / 10;
      const after: any = db.prepare('SELECT COUNT(*) AS c FROM incident_reasoning WHERE alert_id = ?').get(id);
      console.log(`    finished in ${dt}s — verdict=${result?.status ?? '?'} — rows now: ${after.c} (+${after.c - before.c})`);
    } catch (err: any) {
      console.error(`    failed:`, err?.message);
    }
  }

  // Summary
  const totals = db.prepare('SELECT alert_id, COUNT(*) AS c FROM incident_reasoning GROUP BY alert_id ORDER BY c DESC').all();
  console.log('\n--- reasoning rows per alert ---');
  for (const r of totals as any[]) console.log(`  ${r.alert_id}: ${r.c}`);

  db.close();
}

main().catch(err => { console.error(err); process.exit(1); });
