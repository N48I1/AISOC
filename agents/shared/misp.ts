import https from "node:https";
import http from "node:http";
import { URL } from "node:url";

const MISP_URL = (process.env.MISP_URL || "").replace(/\/$/, "");
const MISP_KEY = process.env.MISP_API_KEY || "";
const VERIFY_SSL = process.env.MISP_VERIFY_SSL !== "false";

export interface MispEvent {
  id: string;
  info: string;
  threat_level: "High" | "Medium" | "Low" | "Undefined";
  date: string;
}

export interface MispEnrichment {
  available: boolean;
  hits: number;
  matched_iocs: string[];
  events: MispEvent[];
  threat_actors: string[];
  malware_families: string[];
  tags: string[];
  highest_threat_level: "High" | "Medium" | "Low" | "Undefined";
}

export interface IocBundle {
  ips?: string[];
  domains?: string[];
  hashes?: string[];
  files?: string[];
  urls?: string[];
}

const THREAT_LEVEL_MAP: Record<string, MispEnrichment["highest_threat_level"]> = {
  "1": "High", "2": "Medium", "3": "Low", "4": "Undefined",
};
const THREAT_LEVEL_RANK: Record<MispEnrichment["highest_threat_level"], number> = {
  High: 3, Medium: 2, Low: 1, Undefined: 0,
};

function emptyEnrichment(available = false): MispEnrichment {
  return {
    available,
    hits: 0,
    matched_iocs: [],
    events: [],
    threat_actors: [],
    malware_families: [],
    tags: [],
    highest_threat_level: "Undefined",
  };
}

function postJson(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === "https:";
    const mod = isHttps ? https : http;
    const opts: https.RequestOptions = {
      method: "POST",
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
      ...(isHttps ? { rejectUnauthorized: VERIFY_SSL } : {}),
    };
    const req = mod.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`timeout after ${timeoutMs}ms`)); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function mispSearchIocs(iocs: IocBundle): Promise<MispEnrichment> {
  if (!MISP_URL || !MISP_KEY) return emptyEnrichment(false);

  const values = [
    ...(iocs.ips ?? []),
    ...(iocs.domains ?? []),
    ...(iocs.hashes ?? []),
    ...(iocs.files ?? []),
    ...(iocs.urls ?? []),
  ].map((v) => String(v).trim()).filter(Boolean);

  const unique = Array.from(new Set(values));
  if (unique.length === 0) return emptyEnrichment(true);

  const started = Date.now();

  try {
    const { status, text } = await postJson(
      `${MISP_URL}/attributes/restSearch`,
      JSON.stringify({
        returnFormat: "json",
        value: unique,
        includeEventTags: true,
        includeContext: true,
        includeGalaxy: true,
        enforceWarninglist: true,
        limit: 50,
      }),
      {
        Authorization: MISP_KEY,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      5000,
    );

    if (status !== 200) {
      console.warn(`[MISP] HTTP ${status}: ${text.slice(0, 200)}`);
      return emptyEnrichment(false);
    }

    const body = JSON.parse(text);
    const attrs: any[] = body?.response?.Attribute || body?.response || [];

    if (!Array.isArray(attrs) || attrs.length === 0) {
      console.log(`[MISP] 0 hits for ${unique.length} iocs in ${Date.now() - started}ms`);
      return emptyEnrichment(true);
    }

    const matched = new Set<string>();
    const eventsMap = new Map<string, MispEvent>();
    const actors = new Set<string>();
    const malware = new Set<string>();
    const tagSet = new Set<string>();
    let highest: MispEnrichment["highest_threat_level"] = "Undefined";

    for (const a of attrs) {
      if (a.value) matched.add(String(a.value));
      const ev = a.Event;
      if (ev?.id && !eventsMap.has(String(ev.id))) {
        const level = THREAT_LEVEL_MAP[String(ev.threat_level_id)] || "Undefined";
        if (THREAT_LEVEL_RANK[level] > THREAT_LEVEL_RANK[highest]) highest = level;
        eventsMap.set(String(ev.id), {
          id: String(ev.id),
          info: String(ev.info || "(no title)"),
          threat_level: level,
          date: String(ev.date || ""),
        });
      }

      const tagsOnEvent: any[] = ev?.Tag || a.Tag || [];
      for (const t of tagsOnEvent) if (t?.name) tagSet.add(String(t.name));

      const galaxies: any[] = a.Galaxy || ev?.Galaxy || [];
      for (const g of galaxies) {
        const clusters: any[] = g.GalaxyCluster || [];
        for (const c of clusters) {
          const name = String(c.value || c.name || "").trim();
          if (!name) continue;
          const type = String(g.type || c.type || "").toLowerCase();
          if (type.includes("threat-actor")) actors.add(name);
          else if (type.includes("malware") || type.includes("tool") || type.includes("ransomware")) malware.add(name);
        }
      }
    }

    console.log(`[MISP] ${attrs.length} attribute hits → ${eventsMap.size} events, ${actors.size} actors for ${unique.length} iocs in ${Date.now() - started}ms`);

    return {
      available: true,
      hits: attrs.length,
      matched_iocs: Array.from(matched).slice(0, 30),
      events: Array.from(eventsMap.values()).slice(0, 5),
      threat_actors: Array.from(actors).slice(0, 10),
      malware_families: Array.from(malware).slice(0, 10),
      tags: Array.from(tagSet).slice(0, 15),
      highest_threat_level: highest,
    };
  } catch (err: any) {
    console.warn(`[MISP] error: ${err?.message || err}`);
    return emptyEnrichment(false);
  }
}
