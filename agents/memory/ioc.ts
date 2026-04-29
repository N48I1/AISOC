import { memDb } from "./db.js";

export type IocType = "ip" | "domain" | "hash" | "user" | "url" | "file";

export interface IocHit {
  value:        string;
  type:         IocType;
  first_seen:   string;
  last_seen:    string;
  alert_count:  number;
  threat_level: string | null;
  notes:        string | null;
  /** confidence-decayed score: base = log2(alert_count+1), decay = exp(-age_days/30) */
  score:        number;
}

interface IocBundle {
  ips?:     string[];
  domains?: string[];
  hashes?:  string[];
  files?:   string[];
  urls?:    string[];
  users?:   string[];
}

const TYPE_FOR_KEY: Record<keyof IocBundle, IocType> = {
  ips: "ip", domains: "domain", hashes: "hash", files: "file", urls: "url", users: "user",
};

export function upsertIocs(iocs: IocBundle, _alertId: string, threatLevel?: string): void {
  const db = memDb();
  const stmt = db.prepare(`
    INSERT INTO ioc_memory (value, type, threat_level, alert_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(value) DO UPDATE SET
      last_seen     = CURRENT_TIMESTAMP,
      alert_count   = alert_count + 1,
      threat_level  = COALESCE(excluded.threat_level, ioc_memory.threat_level)
  `);
  const tx = db.transaction(() => {
    for (const key of Object.keys(TYPE_FOR_KEY) as (keyof IocBundle)[]) {
      const arr = iocs[key];
      if (!Array.isArray(arr)) continue;
      const type = TYPE_FOR_KEY[key];
      for (const raw of arr) {
        const value = String(raw).trim();
        if (!value) continue;
        stmt.run(value, type, threatLevel ?? null);
      }
    }
  });
  try { tx(); } catch (err: any) {
    console.warn("[Memory][ioc] upsert failed:", err?.message);
  }
}

export function lookupIocs(values: string[]): IocHit[] {
  if (!values.length) return [];
  const db    = memDb();
  const ph    = values.map(() => "?").join(",");
  const rows  = db.prepare(
    `SELECT value, type, first_seen, last_seen, alert_count, threat_level, notes
     FROM ioc_memory WHERE value IN (${ph})`
  ).all(...values) as Array<Omit<IocHit, "score">>;

  const now = Date.now();
  return rows.map((r) => {
    const ageMs    = now - new Date(r.last_seen).getTime();
    const ageDays  = ageMs / 86_400_000;
    const decay    = Math.exp(-ageDays / 30);
    const base     = Math.log2(r.alert_count + 1);
    return { ...r, score: Number((base * decay).toFixed(3)) };
  }).sort((a, b) => b.score - a.score);
}

/** Flatten an alert + analysis into raw IOC values (for pre-flight lookup). */
export function extractRawIocValues(alert: any, analysisIocs?: IocBundle): string[] {
  const set = new Set<string>();
  if (alert?.source_ip)  set.add(String(alert.source_ip).trim());
  if (alert?.dest_ip)    set.add(String(alert.dest_ip).trim());
  if (alert?.user)       set.add(String(alert.user).trim());
  if (analysisIocs) {
    for (const arr of [analysisIocs.ips, analysisIocs.domains, analysisIocs.hashes, analysisIocs.files, analysisIocs.urls, analysisIocs.users]) {
      if (Array.isArray(arr)) for (const v of arr) {
        const s = String(v).trim();
        if (s) set.add(s);
      }
    }
  }
  return Array.from(set);
}
