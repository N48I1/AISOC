# Memory System

## What It Does

The memory system gives the AI agents persistent context across investigations. Instead of treating every alert in isolation, agents can recall past incidents, recognize repeat offenders, avoid known false positives, and learn from analyst feedback.

The system has **5 tiers**, each serving a different purpose:

---

## Tier 1: Semantic Store (Incident Insights)

**Purpose:** "Have we seen something like this before?"

The semantic store uses pgvector cosine-similarity search (HNSW-indexed, computed in PostgreSQL) over embedded incident summaries. After every investigation, a compact text summary is embedded and stored. Future alerts are compared against this history to find similar past incidents.

### How It Works

1. After orchestration, `commitAsync()` distills the investigation into a summary
2. The summary is embedded via Ollama's `nomic-embed-text` model (384-dim vectors)
3. On new alerts, `search()` embeds the query and finds the top-k most similar past incidents
4. Matches above 60% similarity are returned (85%+ triggers `fpSimilar` flag)

### Data Stored

```typescript
{
  alert_id:        string;       // Source alert
  idempotency_key: string;       // Prevents duplicate inserts
  summary:         string;       // Distilled investigation summary
  attack_pattern:  string;       // MITRE technique chain (T1190 → T1059)
  threat_actor:    string;       // Campaign family or actor type
  outcome:         string;       // TRIAGED, FALSE_POSITIVE, ESCALATED, CLOSED
  ttp_tags:        string[];     // MITRE technique IDs
  embedding:       Float32Array; // 384-dim vector
  triggered_by:    string;       // triage, memoryFP, suppression, composer
}
```

### API
```
GET /api/memory/insights/recent?limit=50
```

---

## Tier 2: IOC Memory (Indicator History)

**Purpose:** "Has this IP/domain/hash been seen before, and was it malicious?"

Tracks every indicator of compromise across all investigations, with false positive and true positive counters that update based on investigation outcomes.

### How It Works

1. During triage, IOCs are extracted (IPs, domains, hashes, URLs, users, files)
2. `upsertIocs()` inserts or updates each IOC with:
   - Incremented `alert_count`
   - Updated `last_seen` timestamp
   - `fp_count++` if outcome is `FALSE_POSITIVE`
   - `tp_count++` if outcome is `TRIAGED` or `ESCALATED`
3. `lookupIocs()` returns IOC history with a **confidence-decayed score**:
   - `score = log2(alert_count + 1) * exp(-age_days / 30)`
   - Recent, frequently-seen IOCs score highest

### Key Fields

```typescript
{
  value:        string;   // "185.220.101.47"
  type:         IocType;  // ip, domain, hash, user, url, file
  first_seen:   string;   // When first observed
  last_seen:    string;   // Most recent observation
  alert_count:  number;   // Total alerts containing this IOC
  fp_count:     number;   // Times this IOC was in a false positive
  tp_count:     number;   // Times this IOC was in a true positive
  fp_ratio:     number;   // fp_count / (fp_count + tp_count)
  score:        number;   // Confidence-decayed relevance score
}
```

### FP Ratio

The `fp_ratio` is the key signal for the FP reduction system. When an IOC has `fp_ratio >= 0.85`, the `fpIocPattern` flag is set during memory recall, telling the triage LLM that this indicator is historically false-positive-heavy.

### API
```
GET /api/memory/iocs?limit=100
GET /api/memory/iocs/recent?limit=50
```

---

## Tier 3: Working Memory (Investigation Trace)

**Purpose:** Per-investigation scratchpad showing the AI's thought process.

Each step of the orchestration pipeline logs its reasoning to working memory:

```typescript
{
  alert_id:       string;  // Which alert
  trace_id:       string;  // Unique per orchestration run
  step:           number;  // 0, 1, 2, ...
  thought:        string;  // What the agent was thinking (max 2000 chars)
  action:         string;  // What it decided to do (max 200 chars)
  result_summary: string;  // What happened (max 4000 chars)
}
```

This powers the "agent logs" expandable section in the Alert Detail UI, letting analysts trace exactly how the AI reached its conclusions.

### API
```
GET /api/memory/working/:alertId
```

---

## Tier 4: Asset Context (Known Infrastructure)

**Purpose:** "Is this a known scanner, monitoring tool, or service account?"

Stores metadata about your organization's infrastructure so the AI knows what's expected vs. suspicious. See [False Positive Reduction](./03-false-positive-reduction.md) for full details.

### Key Fields

```typescript
{
  value:       string;     // "172.10.9.10"
  type:        AssetType;  // ip, domain, host, user
  role:        string;     // scanner, monitoring, backup, admin, production
  description: string;     // "OpenVAS vulnerability scanner"
  fp_default:  number;     // 1 = alerts from this are normally FP
  source:      string;     // manual, seed, auto-learned
}
```

### API
```
GET    /api/assets
POST   /api/assets
DELETE /api/assets/:value
```

---

## Tier 5: Suppression Rules

**Purpose:** Instant, deterministic FP filtering before any LLM runs.

See [False Positive Reduction](./03-false-positive-reduction.md) for full details.

---

## Memory Database

All memory tiers live in the same PostgreSQL database as the rest of the platform (the agents and the API share one connection pool via `db/pool.ts`). Embeddings are stored in a native pgvector `vector(768)` column, so semantic recall is a SQL query rather than an in-process scan.

### Memory tables

| Table | Tier | Description |
|-------|------|-------------|
| `incident_insights` | Semantic Store | Embedded investigation summaries |
| `ioc_memory` | IOC Memory | Per-indicator history with FP/TP counts |
| `working_memory` | Working Memory | Per-step investigation traces |
| `asset_context` | Asset Context | Known infrastructure registry |
| `suppression_rules` | Suppression | Deterministic FP filter rules |

---

## Memory in the Pipeline

```
Pre-flight (Step 1 of orchestration):
  ├── lookupIocs(source_ip, dest_ip, user)     → iocHits, fpIocPattern flag
  ├── semanticStore.search(description)         → pastHits, fpSimilar flag
  └── lookupAssetContext(source_ip, agent_name) → assetHits, fpAsset flag

Post-flight (Step 7 of orchestration):
  ├── upsertIocs(all extracted IOCs, outcome)   → Update FP/TP counters
  ├── commitAsync(investigation summary)         → Add to semantic store
  └── writeWorkingMemory(trace steps)            → Log investigation trace
```

---

## Files Involved

```
agents/memory/
├── db.ts               ← Memory database initialization (memDb singleton)
├── embeddings.ts       ← embedText(), cosineSimilarity(), vector utils
├── store.ts            ← SemanticStore (incident_insights) — add + search
├── ioc.ts              ← IOC memory — upsertIocs(), lookupIocs()
├── working.ts          ← Working memory — write + read per-alert trace
├── insights.ts         ← commitAsync() — distill + embed investigation
├── assets.ts           ← Asset context — lookup, upsert, delete
├── suppression.ts      ← Suppression rules engine
└── learning.ts         ← Auto-learning from FP patterns
```
