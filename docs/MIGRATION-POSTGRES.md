# Migration: SQLite → PostgreSQL + pgvector

**Branch:** `migrate/postgres-pgvector`
**Date:** 2026-06-15
**Status:** Implemented, type-clean (`tsc --noEmit` = 0 errors), and **verified end-to-end against live PostgreSQL 18.4 + pgvector**. `main` still uses SQLite — merge the branch to cut over.

---

## 1. Why

AISOC persisted everything in a single SQLite file (`soc.db`) through **`better-sqlite3`**, a **synchronous** driver. We moved to **PostgreSQL** for:

- Production-grade concurrency, backups, and replication tooling.
- A **native vector index (pgvector)** for the semantic-memory/RAG layer — replacing a brute-force JavaScript cosine scan that loaded up to 5,000 rows per query.
- Coexistence with the MISP MariaDB already on the host (different engine, different port: PG `5432` vs MariaDB `3306`).

The dominant cost was **not** SQL-dialect differences — it was that every Postgres driver is **asynchronous** while ~360 existing call sites were synchronous. The strategy below contained that blast radius behind a thin async adapter.

## 2. Decisions

| Decision | Choice |
|---|---|
| DB layer | Thin async adapter mirroring `better-sqlite3`'s `prepare().get()/.all()/.run()`, on top of `node-postgres` (`pg`). Raw SQL kept. |
| Vector search | Adopt **pgvector** — `vector(768)` column + HNSW cosine index; search rewritten to SQL. |
| Existing data | One-time **ETL** from `soc.db` into Postgres (all tables, incl. embeddings). |
| Deployment | **Native** PostgreSQL install on the host. |

## 3. Architecture change

```
BEFORE                                AFTER
─────────────────────────────        ─────────────────────────────
server.ts ── new Database()           server.ts ─┐
                  │  (sync)                       ├─ dbq (async adapter) ── pg.Pool ── PostgreSQL
agents/memory ── memDb() ─┘           agents/memory ── memDb() ─┘            + pgvector

embedding: SQLite BLOB                embedding: vector(768) column
recall:    load ≤5000 rows →          recall:    SQL  ORDER BY embedding <=> q
           JS cosine scan                        (HNSW ANN index)
```

- A single shared `pg.Pool` + `dbq` adapter (`db/pool.ts`) replaces **both** old connections (`server.ts` and the `memDb()` singleton in `agents/memory/db.ts`).
- `import { dbq as db }` aliasing means the ~309 existing `db.prepare(...)` references in `server.ts` keep working — they only gained `await`.
- JSON columns stay **TEXT** and integer-booleans stay **INTEGER**, so node-postgres auto-parsing doesn't change return types and break `JSON.parse(...)` / `=== 1` checks.
- Timestamps are real `timestamp` columns, but a pg type-parser override returns them as **strings**, preserving existing string handling and JSON-response shapes.

## 4. New files

| File | Purpose |
|---|---|
| `db/schema.sql` | Canonical Postgres DDL for all 26 tables (applied idempotently at startup). |
| `db/pool.ts` | `pg.Pool` + `dbq` adapter + `applySchema()` / `assertDbReady()` / `transaction()`. |
| `scripts/migrate-sqlite-to-pg.ts` | Idempotent ETL (`npm run db:migrate`). |
| `scripts/provision-postgres.sh` | Installs PostgreSQL + pgvector, creates role/db on a Debian/Ubuntu host. |
| `docs/MIGRATION-POSTGRES.md` | This document. |

## 5. The adapter (`db/pool.ts`)

Mirrors better-sqlite3's surface but async:

```ts
export const dbq = {
  prepare(sql) {                        // '?' → '$n' rewrite (quote-aware)
    return {
      get:  async (...p) => (await pool.query(text, flat(p))).rows[0],
      all:  async (...p) => (await pool.query(text, flat(p))).rows,
      run:  async (...p) => { const r = await pool.query(text, flat(p));
                              return { changes: r.rowCount, rows: r.rows,
                                       lastInsertRowid: r.rows?.[0]?.id }; },
    };
  },
  exec: (sql) => pool.query(sql),        // multi-statement DDL
  transaction: (fn) => withClient(fn),   // BEGIN / COMMIT / ROLLBACK on one client
  pragma: () => {},                      // no-op (no WAL/busy_timeout in PG)
};
```

- Statement methods return real `Promise<T>`, so TypeScript flags any un-awaited result the moment a property/array method is accessed — this turned `tsc` into a missing-`await` detector.
- `.changes` keeps working because `run()` returns `{ changes }`.
- `.lastInsertRowid` is populated from a `RETURNING id` clause (the ~9 insert sites that need it now append `RETURNING id`).
- `?` placeholders are rewritten to `$1,$2,…` at prepare time, so existing SQL strings were left untouched.
- Connection config: `DATABASE_URL` or `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` (+ `PGPOOL_MAX`).

## 6. Schema translation (`db/schema.sql`)

| SQLite | PostgreSQL |
|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| `embedding BLOB` | `embedding vector(768)` + HNSW index `(vector_cosine_ops)` |
| `TEXT` JSON columns | kept as `TEXT` (app does its own `JSON.stringify/parse`) |
| INTEGER-booleans (0/1) | kept as `INTEGER` |
| `DATETIME` / `TEXT` timestamps | `timestamp` (type-parser returns strings) |
| `REAL` | `double precision` |
| reserved word column `user` (alerts) | quoted `"user"` everywhere it appears in SQL |

All ALTER-added columns from the old idempotent `safeAlter()` bootstrap are merged directly into the table definitions. The legacy one-time data-backfill blocks were removed (the data they corrected is carried over by the ETL).

## 7. SQL-dialect translations (in `server.ts` + agents)

| SQLite | PostgreSQL |
|---|---|
| `datetime('now')` | `now()` |
| `datetime('now','-5 minutes')` | `now() - interval '5 minutes'` |
| `date('now')` | `current_date` |
| `strftime('%s', x)` | `extract(epoch from x)` |
| `json_extract(col,'$.a.b')` | `col::jsonb #>> '{a,b}'` |
| `INSERT OR IGNORE` | `INSERT … ON CONFLICT (…) DO NOTHING` |
| `… RETURNING id` (for `lastInsertRowid`) | added to the ~9 affected inserts |

## 8. Async conversion

- **server.ts:** ~309 `db.prepare(...)` call sites awaited; ~115 route handlers + helper functions made `async`; the inline-DDL + backfill bootstrap replaced by an `async initDatabase()` that calls `applySchema()` then seeds; **5 transactions** rewritten to pooled-client `BEGIN/COMMIT/ROLLBACK` form (statements run on the checked-out `tx` client for atomicity); `.map`/`.flatMap` callbacks containing `await` refactored to `Promise.all`.
- **agents/memory/* and agents/shared/*:** every module converted to async; `memDb()` now returns the shared `dbq`.
- **Provider hot path stays synchronous:** `resolveProviders()` (called on every LLM invocation via `resolveClientsForModel`) reads an in-memory snapshot refreshed asynchronously at boot and after mutations (`refreshProviderCache`), so model resolution never awaits a query.
- `writeAudit` and other fire-and-forget writers are `async` with internal try/catch, so their call sites need no `await`.

## 9. pgvector (`agents/memory/embeddings.ts`, `store.ts`)

- `float32ToBlob`/`blobToFloat32`/`cosineSimilarity` replaced by `toVectorLiteral(Float32Array)` → `'[v1,v2,…]'`.
- `SqliteSemanticStore` → `PgSemanticStore`. `search()` is now SQL:
  ```sql
  SELECT …, 1 - (embedding <=> $1) AS similarity
  FROM incident_insights
  WHERE embedding IS NOT NULL AND 1 - (embedding <=> $1) >= $2
  ORDER BY embedding <=> $1
  LIMIT $3
  ```
- Public `add()`/`search()` signatures, `k`/`minSimilarity` semantics, `InsightHit` shape, and graceful degradation (Ollama down → `embedding` NULL, search returns `[]`) are unchanged — callers were untouched.

## 10. ETL (`scripts/migrate-sqlite-to-pg.ts`)

- Reads `soc.db` (read-only `better-sqlite3`), copies all tables **parents-first** so FKs hold.
- `TRUNCATE … RESTART IDENTITY CASCADE` first, so it is safe to re-run.
- Per-column transforms by introspected PG type: BLOB → vector literal; empty-string → NULL for timestamp columns.
- Identity columns inserted verbatim with `OVERRIDING SYSTEM VALUE`; sequence advanced with `setval` afterward.
- **Per-row savepoints**: SQLite did not enforce foreign keys, so the file contained rows referencing deleted parents; those are skipped (and counted) rather than aborting the table.
- Run: `SOC_DB_PATH=./soc.db npm run db:migrate`.

## 11. Configuration & ops

- `.env` / `.env.example`: `DATABASE_URL` or `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` (`SOC_DB_PATH` now only used by the ETL).
- `package.json`: added `pg` (dependency) + `@types/pg` (dev); kept `better-sqlite3` as a devDependency for the ETL; added `db:migrate` script.
- Backups now use `pg_dump` / `pg_restore` (documented in `docs/HANDOVER.md`).
- New secret to rotate at handover: the PostgreSQL `aisoc` role password.

## 12. Documentation & diagrams updated

- **Diagrams:** `semantic-memory.eraser` (rewritten), `techstack.eraser`, `aisoc-overview.eraser`, `class-diagram.puml`, `class-diagram.eraser`, `sequence-diagram.puml`, `SPEAKER_NOTES.md`.
- **Docs:** `README.md`, `AEGIS_SOC_PLATFORM_DOCUMENTATION.md`, `ADMIN_COMMANDS.md` (recipes → `psql`/`node-pg`), `TROUBLESHOOTING.md` (recipes → `psql`/`node-pg`), `docs/HANDOVER.md`, `docs/AISOC-product-overview.md`, `docs/alert-triage-agent.md`, `docs/features/09|10|11|12`.
- Left as historical point-in-time records: `GEMINI_MAINTENANCE_LOG.md`, `intelligence_upgrade_implementation.md`.

## 13. Deploy / cut over

```bash
# 1. Provision PostgreSQL + pgvector (needs sudo)
PG_PASSWORD='<strong-pw>' sudo -E bash scripts/provision-postgres.sh

# 2. Configure .env (DATABASE_URL or PG* vars)

# 3. Migrate existing data (optional — start fresh otherwise)
SOC_DB_PATH=./soc.db npm run db:migrate

# 4. Start — db/schema.sql is applied automatically on boot
npm run dev
```

**Rollback:** revert the branch and point config back at `soc.db`. The SQLite file is never modified (the ETL opens it read-only), so it remains a valid fallback until `better-sqlite3` is removed from runtime deps after a successful cutover.

## 14. Verification (against live PostgreSQL 18.4 + pgvector)

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Provision (role `aisoc`, db `soc`, pgvector) | ✅ port 5432, no MariaDB collision |
| `db/schema.sql` applies | ✅ 25 tables |
| ETL `soc.db` → Postgres | ✅ **5,202 rows / 25 tables** (37 orphaned-FK insights skipped) |
| pgvector cosine search (`store.ts` query + HNSW) | ✅ self=1.0000, near=0.9999, far≈0, 768 dims |
| App boots + seeds idempotently | ✅ |
| Auth (login/JWT/gating, async policy loaders) | ✅ |
| Reads (alerts, stats MTTR `extract(epoch)`, incidents `.all().map`, JSON cols, `"user"`) | ✅ |
| Write path (`RETURNING id` create-user, async `writeAudit`, password history) | ✅ |

## 15. Known caveats / follow-ups

- **No automated test suite** existed before the migration; verification was manual + `tsc`. Adding integration tests around the data layer is the recommended next step.
- JSON columns are TEXT and booleans are INTEGER (deliberate, to minimize churn). Optional future polish: migrate to `jsonb` / `boolean`.
- Vector search uses an **HNSW** index (`vector_cosine_ops`) — no training step, good recall; tune `ef_search` if needed at scale.
- A non-superuser role cannot `CREATE EXTENSION`; the provisioning script creates `pgvector` as the `postgres` superuser, after which the schema's `CREATE EXTENSION IF NOT EXISTS vector` is a harmless no-op.
