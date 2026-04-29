import { memDb } from "./db.js";
import { embedText, cosineSimilarity, blobToFloat32, float32ToBlob } from "./embeddings.js";

export interface InsightRecord {
  alert_id:        string;
  idempotency_key: string;
  summary:         string;
  attack_pattern?: string;
  threat_actor?:   string;
  outcome?:        string;
  ttp_tags?:       string[];
}

export interface InsightHit {
  alert_id:       string;
  summary:        string;
  attack_pattern: string | null;
  threat_actor:   string | null;
  outcome:        string | null;
  ttp_tags:       string[];
  similarity:     number;
  created_at:     string;
}

/** Abstraction over semantic memory — easy to swap for sqlite-vec / Qdrant later. */
export interface SemanticStore {
  add(record: InsightRecord & { embedding: Float32Array | null }): Promise<void>;
  search(query: string, k?: number, minSimilarity?: number): Promise<InsightHit[]>;
}

class SqliteSemanticStore implements SemanticStore {
  async add(record: InsightRecord & { embedding: Float32Array | null }) {
    const db = memDb();
    db.prepare(`
      INSERT OR IGNORE INTO incident_insights
        (alert_id, idempotency_key, summary, attack_pattern, threat_actor, outcome, ttp_tags, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.alert_id,
      record.idempotency_key,
      record.summary,
      record.attack_pattern ?? null,
      record.threat_actor   ?? null,
      record.outcome        ?? null,
      JSON.stringify(record.ttp_tags ?? []),
      record.embedding ? float32ToBlob(record.embedding) : null,
    );
  }

  async search(query: string, k = 5, minSimilarity = 0.6): Promise<InsightHit[]> {
    const queryVec = await embedText(query);
    if (!queryVec) return [];

    const db   = memDb();
    const rows = db.prepare(`
      SELECT alert_id, summary, attack_pattern, threat_actor, outcome, ttp_tags, embedding, created_at
      FROM incident_insights
      WHERE embedding IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 5000
    `).all() as Array<{
      alert_id: string; summary: string; attack_pattern: string | null;
      threat_actor: string | null; outcome: string | null; ttp_tags: string;
      embedding: Buffer; created_at: string;
    }>;

    const scored: InsightHit[] = [];
    for (const r of rows) {
      const vec = blobToFloat32(r.embedding);
      const sim = cosineSimilarity(queryVec, vec);
      if (sim < minSimilarity) continue;
      scored.push({
        alert_id:       r.alert_id,
        summary:        r.summary,
        attack_pattern: r.attack_pattern,
        threat_actor:   r.threat_actor,
        outcome:        r.outcome,
        ttp_tags:       safeParseArr(r.ttp_tags),
        similarity:     sim,
        created_at:     r.created_at,
      });
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, k);
  }
}

function safeParseArr(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

export const semanticStore: SemanticStore = new SqliteSemanticStore();
