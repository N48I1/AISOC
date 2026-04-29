import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = process.env.SOC_DB_PATH || path.join(__dirname, "..", "..", "soc.db");

let _db: Database.Database | null = null;

/** Lazy singleton DB connection. SQLite supports multiple readers; the server
 *  has its own connection for writes. We share the same file. */
export function memDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("busy_timeout = 5000");
  return _db;
}
