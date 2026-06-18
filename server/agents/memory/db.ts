import { dbq, type DbClient } from "../../db/pool.js";

/**
 * Shared database handle for the agents/memory layer.
 *
 * Previously this opened its own better-sqlite3 connection to the same file.
 * Now the whole process — server + agents — shares a single PostgreSQL pool via
 * the async `dbq` adapter, so this just returns that handle. The function name
 * is kept so the many `memDb().prepare(...)` call sites stay unchanged (they
 * only gain an `await` on the query method).
 */
export function memDb(): DbClient {
  return dbq;
}
