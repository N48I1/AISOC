// =============================================================================
// PostgreSQL connection pool + a thin async adapter that mirrors the shape of
// better-sqlite3's `prepare().get()/.all()/.run()` API.
// =============================================================================
// The rest of the codebase was written against better-sqlite3's *synchronous*
// API. node-postgres is async, so every call site gains an `await`, but the
// surface stays identical: `dbq.prepare(sql).get(params)` etc. This keeps the
// migration mechanical and reviewable.
//
// Design notes:
//   * `?` placeholders are rewritten to `$1,$2,…` at prepare time (quote-aware),
//     so existing SQL strings stay untouched.
//   * Statement methods return real Promises (Promise<any> / Promise<any[]> /
//     Promise<RunResult>), so TypeScript flags any un-awaited result the moment
//     a property/array method is accessed on it — our missing-`await` detector.
//   * `run()` returns { changes, lastInsertRowid } so existing `.changes` reads
//     keep working; `lastInsertRowid` is populated from a `RETURNING id` clause
//     when present (the ~10 insert sites that need it add `RETURNING id`).
//   * timestamp/timestamptz are returned as raw strings (type-parser override),
//     matching the SQLite text behaviour the app and frontend already expect.
// =============================================================================

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool, types } = pg;

// Keep temporal types as strings instead of JS Date objects so existing string
// handling (comparisons, JSON responses) is unchanged. 1114 = timestamp,
// 1184 = timestamptz, 1082 = date.
types.setTypeParser(1114, (v) => v);
types.setTypeParser(1184, (v) => v);
types.setTypeParser(1082, (v) => v);

// node-postgres returns bigint (int8) and numeric as strings by default — but
// SQLite returned plain numbers, and the app does arithmetic on COUNT(*)/SUM(...)
// aggregates (counts, stats). Parse them back to numbers so e.g. summing
// `pending_actions` adds instead of string-concatenating ("0"+"3"+"3" → "033").
// All bigint/numeric values here are small aggregates, so precision is not a concern.
types.setTypeParser(20,   (v) => (v === null ? null : Number(v)));     // int8 / bigint
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function buildPoolConfig(): pg.PoolConfig {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host:     process.env.PGHOST     || '127.0.0.1',
    port:     Number(process.env.PGPORT || 5432),
    user:     process.env.PGUSER     || 'aisoc',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'soc',
    max:      Number(process.env.PGPOOL_MAX || 10),
  };
}

export const pool = new Pool(buildPoolConfig());

pool.on('error', (err) => {
  // Idle-client errors (e.g. backend restart) must never crash the process.
  console.error('[pg] idle client error:', err.message);
});

// ── ? → $n rewrite (skips single-quoted string literals) ─────────────────────
function convertPlaceholders(sql: string): string {
  let out = '';
  let n = 0;
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      // handle escaped '' inside a string literal
      if (inStr && sql[i + 1] === "'") { out += "''"; i++; continue; }
      inStr = !inStr;
      out += c;
      continue;
    }
    if (c === '?' && !inStr) { out += '$' + ++n; continue; }
    out += c;
  }
  return out;
}

// better-sqlite3 accepted both `.run(a, b, c)` and `.run([a, b, c])`.
function flattenParams(args: any[]): any[] {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

export interface RunResult {
  changes: number;
  rows: any[];
  /** Populated from a `RETURNING id` clause when present. */
  lastInsertRowid?: number;
}

export interface Statement {
  get(...params: any[]): Promise<any>;
  all(...params: any[]): Promise<any[]>;
  run(...params: any[]): Promise<RunResult>;
}

type Queryable = Pick<pg.PoolClient, 'query'> | Pick<pg.Pool, 'query'>;

function makeStatement(executor: Queryable, sql: string): Statement {
  const text = convertPlaceholders(sql);
  return {
    async get(...params: any[]) {
      const r = await (executor as any).query(text, flattenParams(params));
      return r.rows[0];
    },
    async all(...params: any[]) {
      const r = await (executor as any).query(text, flattenParams(params));
      return r.rows;
    },
    async run(...params: any[]): Promise<RunResult> {
      const r = await (executor as any).query(text, flattenParams(params));
      return { changes: r.rowCount ?? 0, rows: r.rows, lastInsertRowid: r.rows?.[0]?.id };
    },
  };
}

/** Transaction context handed to `dbq.transaction(async (tx) => …)`. */
export interface TxClient {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
}

export interface DbClient {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T>;
  /** No-op — Postgres has no per-connection PRAGMA equivalent. */
  pragma(_directive: string): void;
}

export const dbq: DbClient = {
  prepare(sql: string): Statement {
    return makeStatement(pool, sql);
  },
  async exec(sql: string): Promise<void> {
    // Simple-query protocol (no params) supports multiple `;`-separated statements.
    await pool.query(sql);
  },
  async transaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx: TxClient = {
        prepare: (sql: string) => makeStatement(client, sql),
        exec: async (sql: string) => { await client.query(sql); },
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
      throw err;
    } finally {
      client.release();
    }
  },
  pragma(_directive: string): void { /* no-op */ },
};

/** Apply db/schema.sql idempotently. Call once at startup before seeding. */
export async function applySchema(): Promise<void> {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
}

/** Verify connectivity early so startup fails loudly if Postgres is unreachable. */
export async function assertDbReady(): Promise<void> {
  await pool.query('SELECT 1');
}
