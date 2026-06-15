import { memDb } from "./db.js";
import { embedText, toVectorLiteral } from "./embeddings.js";

export interface InsightRecord {
  alert_id:        string;
  idempotency_key: string;
  summary:         string;
  attack_pattern?: string;
  threat_actor?:   string;
  outcome?:        string;
  ttp_tags?:       string[];
  triggered_by?:   string;       // 'triage' | 'memoryFP' | 'composer'
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

class PgSemanticStore implements SemanticStore {
  async add(record: InsightRecord & { embedding: Float32Array | null }) {
    const db = memDb();
    await db.prepare(`
      INSERT INTO incident_insights
        (alert_id, idempotency_key, summary, attack_pattern, threat_actor, outcome, ttp_tags, embedding, triggered_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (idempotency_key) DO NOTHING
    `).run(
      record.alert_id,
      record.idempotency_key,
      record.summary,
      record.attack_pattern ?? null,
      record.threat_actor   ?? null,
      record.outcome        ?? null,
      JSON.stringify(record.ttp_tags ?? []),
      record.embedding ? toVectorLiteral(record.embedding) : null,
      record.triggered_by   ?? 'triage',
    );
  }

  async search(query: string, k = 5, minSimilarity = 0.6): Promise<InsightHit[]> {
    const queryVec = await embedText(query);
    if (!queryVec) return [];

    const db = memDb();
    // pgvector cosine distance is `<=>`; cosine similarity = 1 - distance.
    // The HNSW index on `embedding vector_cosine_ops` makes the ORDER BY/LIMIT
    // an approximate-nearest-neighbour lookup instead of the old full scan.
    // $1 (query vector) is referenced three times; $2 = threshold, $3 = k.
    const rows = await db.prepare(`
      SELECT alert_id, summary, attack_pattern, threat_actor, outcome, ttp_tags, created_at,
             1 - (embedding <=> $1) AS similarity
      FROM incident_insights
      WHERE embedding IS NOT NULL AND 1 - (embedding <=> $1) >= $2
      ORDER BY embedding <=> $1
      LIMIT $3
    `).all(toVectorLiteral(queryVec), minSimilarity, k) as Array<{
      alert_id: string; summary: string; attack_pattern: string | null;
      threat_actor: string | null; outcome: string | null; ttp_tags: string;
      similarity: number; created_at: string;
    }>;

    return rows.map((r) => ({
      alert_id:       r.alert_id,
      summary:        r.summary,
      attack_pattern: r.attack_pattern,
      threat_actor:   r.threat_actor,
      outcome:        r.outcome,
      ttp_tags:       safeParseArr(r.ttp_tags),
      similarity:     Number(r.similarity),
      created_at:     r.created_at,
    }));
  }
}

function safeParseArr(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

export const semanticStore: SemanticStore = new PgSemanticStore();
