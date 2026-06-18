// =============================================================================
// One-time cleanup: merge duplicate incidents that should have been one campaign.
// =============================================================================
// Older builds (and the legacy SQLite backfill) created one incident per escalated
// alert, so a bot flood firing the same Wazuh rule from the same source produced
// dozens of near-identical incidents. The ingest path now deduplicates
// (createIncidentFromAlert groups same rule + source into one active incident);
// this script collapses the *existing* duplicates the same way.
//
// For each group of incidents whose linked alerts share the same (rule_id,
// source_ip), the OLDEST incident is kept and the rest are merged into it:
// their alerts are re-linked, then the redundant incidents (and their cascaded
// timeline/actions) are deleted. A timeline note records the merge.
//
//   Dry run (default — shows what it would do, changes nothing):
//     npx tsx scripts/merge-duplicate-incidents.ts
//   Apply:
//     npx tsx scripts/merge-duplicate-incidents.ts --apply
// =============================================================================

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');

async function main() {
  const pool = new pg.Pool(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {
          host: process.env.PGHOST || '127.0.0.1',
          port: Number(process.env.PGPORT || 5432),
          user: process.env.PGUSER || 'aisoc',
          password: process.env.PGPASSWORD || '',
          database: process.env.PGDATABASE || 'soc',
        });

  // Group incidents by the (rule_id, source_ip) of their linked alerts. ids[] is
  // ordered oldest-first, so ids[0] is the survivor and the rest are redundant.
  const groups = await pool.query(`
    WITH sig AS (
      SELECT i.id, i.created_at,
             (array_agg(a.rule_id   ORDER BY a.timestamp))[1] AS rule_id,
             (array_agg(a.source_ip ORDER BY a.timestamp))[1] AS source_ip
      FROM incidents i
      JOIN incident_alerts ia ON ia.incident_id = i.id
      JOIN alerts a ON a.id = ia.alert_id
      GROUP BY i.id, i.created_at
    )
    SELECT rule_id, source_ip,
           array_agg(id ORDER BY created_at) AS ids,
           count(*) AS n
    FROM sig
    WHERE rule_id IS NOT NULL AND source_ip IS NOT NULL
    GROUP BY rule_id, source_ip
    HAVING count(*) > 1
    ORDER BY count(*) DESC
  `);

  if (groups.rows.length === 0) { console.log('No duplicate incident groups found.'); await pool.end(); return; }

  let mergedAway = 0;
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${groups.rows.length} duplicate group(s):\n`);
  for (const g of groups.rows) {
    const ids: string[] = g.ids;
    const survivor = ids[0];
    const redundant = ids.slice(1);
    mergedAway += redundant.length;
    console.log(`  rule=${g.rule_id} src=${g.source_ip}: ${g.n} incidents → keep ${survivor}, merge ${redundant.length}`);

    if (!APPLY) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Re-link every alert from the redundant incidents onto the survivor.
      await client.query(
        `INSERT INTO incident_alerts (incident_id, alert_id)
         SELECT $1, alert_id FROM incident_alerts WHERE incident_id = ANY($2)
         ON CONFLICT DO NOTHING`, [survivor, redundant]);
      await client.query(`DELETE FROM incident_alerts WHERE incident_id = ANY($1)`, [redundant]);
      // Delete redundant incidents (timeline + actions cascade via ON DELETE CASCADE).
      await client.query(`DELETE FROM incidents WHERE id = ANY($1)`, [redundant]);
      await client.query(
        `INSERT INTO incident_timeline (incident_id, event_type, note)
         VALUES ($1, 'merged', $2)`,
        [survivor, `Merged ${redundant.length} duplicate incident(s) (same rule ${g.rule_id} · source ${g.source_ip}) into this campaign`]);
      await client.query(`UPDATE incidents SET updated_at = now() WHERE id = $1`, [survivor]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`merge for survivor ${survivor} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  const total = (await pool.query('SELECT count(*) c FROM incidents')).rows[0].c;
  console.log(`\n${APPLY ? `Merged away ${mergedAway} duplicate incident(s).` : `Would merge away ${mergedAway} duplicate incident(s). Re-run with --apply to execute.`}`);
  console.log(`Incidents now: ${total}`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
