import { memDb } from "./db.js";

export type AssetType = "ip" | "domain" | "host" | "user";
export type AssetRole = "scanner" | "monitoring" | "backup" | "admin" | "production" | "user_workstation";

export interface AssetContextHit {
  value:        string;
  type:         AssetType;
  role:         AssetRole | string;
  description:  string | null;
  fp_default:   number;        // 0 or 1
  source:       string;
  created_at:   string;
  updated_at:   string;
}

export async function lookupAssetContext(values: string[]): Promise<AssetContextHit[]> {
  if (!values.length) return [];
  const db = memDb();
  const ph = values.map(() => "?").join(",");
  return await db.prepare(
    `SELECT value, type, role, description, fp_default, source, created_at, updated_at
     FROM asset_context WHERE value IN (${ph})`
  ).all(...values) as AssetContextHit[];
}

export async function listAssetContext(limit = 200): Promise<AssetContextHit[]> {
  return await memDb().prepare(
    `SELECT value, type, role, description, fp_default, source, created_at, updated_at
     FROM asset_context ORDER BY updated_at DESC LIMIT ?`
  ).all(limit) as AssetContextHit[];
}

export interface UpsertAssetParams {
  value:        string;
  type:         AssetType | string;
  role:         AssetRole | string;
  description?: string;
  fp_default?:  boolean | number;
  source?:      string;
}

export async function upsertAssetContext(p: UpsertAssetParams): Promise<void> {
  const db = memDb();
  const fp = p.fp_default ? 1 : 0;
  await db.prepare(`
    INSERT INTO asset_context (value, type, role, description, fp_default, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(value) DO UPDATE SET
      type        = excluded.type,
      role        = excluded.role,
      description = excluded.description,
      fp_default  = excluded.fp_default,
      source      = excluded.source,
      updated_at  = CURRENT_TIMESTAMP
  `).run(p.value.trim(), p.type, p.role, p.description ?? null, fp, p.source ?? 'manual');
}

export async function deleteAssetContext(value: string): Promise<boolean> {
  const r = await memDb().prepare(`DELETE FROM asset_context WHERE value = ?`).run(value.trim());
  return r.changes > 0;
}

/** Pull every value from an alert that may match an asset_context row. */
export function extractAssetValuesFromAlert(alert: any): string[] {
  const set = new Set<string>();
  if (alert?.source_ip)  set.add(String(alert.source_ip).trim());
  if (alert?.dest_ip)    set.add(String(alert.dest_ip).trim());
  if (alert?.user)       set.add(String(alert.user).trim());
  if (alert?.agent_name) set.add(String(alert.agent_name).trim());
  if (alert?.hostname)   set.add(String(alert.hostname).trim());
  return Array.from(set).filter(Boolean);
}
