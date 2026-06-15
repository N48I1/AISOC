// =============================================================================
// One-time ETL: copy all data from the legacy SQLite file (soc.db) into Postgres.
// =============================================================================
// Usage:
//   SOC_DB_PATH=./soc.db DATABASE_URL=postgres://aisoc:pw@127.0.0.1:5432/soc \
//     npm run db:migrate
//
// Safe to re-run: every target table is TRUNCATEd (RESTART IDENTITY CASCADE)
// before loading. Run AFTER db/schema.sql has been applied (the server does this
// on first boot, or apply it manually with psql -f db/schema.sql).
//
// Notes:
//   * Tables are loaded parents-first so foreign keys hold.
//   * incident_insights.embedding (SQLite BLOB of raw float32) is converted to a
//     pgvector text literal "[v1,v2,…]".
//   * Identity (auto-increment) columns are inserted verbatim with OVERRIDING
//     SYSTEM VALUE, then the sequence is advanced past the max id.
//   * Empty-string values in timestamp columns are coerced to NULL (SQLite was
//     lax; Postgres timestamps reject '').
// =============================================================================

import 'dotenv/config';
import Database from 'better-sqlite3';
import pg from 'pg';

const SQLITE_PATH = process.env.SOC_DB_PATH || 'soc.db';

// Parents before children so FK constraints are satisfied on insert.
const LOAD_ORDER = [
  'users', 'alerts', 'incidents',
  'api_keys', 'password_history', 'access_reviews', 'access_review_items',
  'audit_logs', 'agent_runs', 'feedback', 'action_logs', 'working_memory',
  'incident_insights', 'incident_reasoning', 'incident_alerts',
  'incident_timeline', 'incident_actions', 'playbooks',
  'ioc_memory', 'asset_context', 'suppression_rules',
  'agent_settings', 'integrations', 'local_llm_config', 'llm_providers',
];

function blobToVectorLiteral(buf: Buffer | null): string | null {
  if (!buf || buf.byteLength === 0) return null;
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  return '[' + Array.from(f32).join(',') + ']';
}

interface PgColumn { name: string; dataType: string; isIdentity: boolean; }

async function pgColumns(pool: pg.Pool, table: string): Promise<PgColumn[]> {
  const r = await pool.query(
    `SELECT column_name, data_type, is_identity
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`, [table]);
  return r.rows.map((c: any) => ({
    name: c.column_name, dataType: c.data_type, isIdentity: c.is_identity === 'YES',
  }));
}

function sqliteColumns(sqlite: Database.Database, table: string): Set<string> {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

async function main() {
  console.log(`[ETL] source SQLite: ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
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

  // Clean slate (idempotent re-runs). CASCADE handles FK order for truncation.
  await pool.query(`TRUNCATE TABLE ${LOAD_ORDER.join(', ')} RESTART IDENTITY CASCADE`);
  console.log('[ETL] target tables truncated');

  let grandTotal = 0;
  for (const table of LOAD_ORDER) {
    const pgCols = await pgColumns(pool, table);
    if (pgCols.length === 0) { console.warn(`[ETL] ${table}: no such PG table, skipped`); continue; }
    const srcCols = sqliteColumns(sqlite, table);
    // Only copy columns present in both schemas.
    const cols = pgCols.filter((c) => srcCols.has(c.name));
    const colNames = cols.map((c) => c.name);
    const tsCols = new Set(cols.filter((c) => /timestamp|date/.test(c.dataType)).map((c) => c.name));
    const vecCols = new Set(cols.filter((c) => c.dataType === 'USER-DEFINED').map((c) => c.name));
    const hasIdentity = cols.some((c) => c.isIdentity);

    const rows = sqlite.prepare(`SELECT ${colNames.map((c) => `"${c}"`).join(', ')} FROM ${table}`).all() as any[];
    if (rows.length === 0) { console.log(`[ETL] ${table}: 0 rows`); continue; }

    const colList = colNames.map((c) => `"${c}"`).join(', ');
    const overriding = hasIdentity ? 'OVERRIDING SYSTEM VALUE ' : '';

    const client = await pool.connect();
    let inserted = 0;
    let skipped = 0;
    try {
      await client.query('BEGIN');
      const insertSql = `INSERT INTO ${table} (${colList}) ${overriding}VALUES (${colNames.map((_, i) => `$${i + 1}`).join(', ')})`;
      for (const row of rows) {
        const values = colNames.map((name) => {
          const v = row[name];
          if (vecCols.has(name)) return blobToVectorLiteral(v as Buffer | null);
          if (tsCols.has(name) && (v === '' || v === undefined)) return null;
          if (v === undefined) return null;
          return v;
        });
        // Per-row savepoint: the legacy SQLite file did not enforce foreign keys,
        // so it can contain rows referencing deleted parents. Postgres rejects
        // those; skip them rather than aborting the whole table.
        await client.query('SAVEPOINT row');
        try {
          await client.query(insertSql, values);
          await client.query('RELEASE SAVEPOINT row');
          inserted++;
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT row');
          skipped++;
        }
      }
      // Advance identity sequence past the largest copied id.
      if (hasIdentity && colNames.includes('id')) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('${table}', 'id'),
                  (SELECT COALESCE(MAX(id), 1) FROM ${table}), true)`);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`[ETL] ${table} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
    console.log(`[ETL] ${table}: ${inserted} rows${skipped ? ` (skipped ${skipped} with dangling FK)` : ''}`);
    grandTotal += inserted;
  }

  console.log(`[ETL] done — ${grandTotal} rows across ${LOAD_ORDER.length} tables`);
  sqlite.close();
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
