# Aegis AI-SOC — Algorithms Reference

This document describes **every algorithm in the platform that produces a score, a verdict, or a derived value**. For each algorithm: the inputs, the exact formula or rules, where it lives in the code, and how it feeds downstream decisions.

> Conventions used below:
> - `level` = Wazuh `rule.level`, integer 1–15
> - `severity` = same thing, mirrored on the `alerts` table column
> - All percentages are stored as floats in `[0, 1]` unless noted as `%`
> - File paths are relative to the repo root

---

## Table of contents

1. [Risk Score](#1-risk-score)
2. [Severity Classification](#2-severity-classification)
3. [SLA Windows](#3-sla-windows)
4. [Recommended-Action Mapping](#4-recommended-action-mapping)
5. [FP Confidence Aggregator](#5-fp-confidence-aggregator)
6. [Asset Fast-FP (Deterministic Short-Circuit)](#6-asset-fast-fp)
7. [Suppression-Rule Confidence](#7-suppression-rule-confidence)
8. [IOC Memory Score (Recency × Frequency)](#8-ioc-memory-score)
9. [Auto-Learning Thresholds](#9-auto-learning-thresholds)
10. [Final-Outcome Routing (Multi-Layer FP Defense)](#10-final-outcome-routing)
11. [Semantic Similarity (Memory Recall)](#11-semantic-similarity)
12. [Detection-Method Effectiveness](#12-detection-method-effectiveness)
13. [Noisy-Source Ranking](#13-noisy-source-ranking)
14. [Incident-Status Computation](#14-incident-status-computation)
15. [Password Strength Estimator](#15-password-strength-estimator)
16. [Pipeline Funnel Metrics](#16-pipeline-funnel-metrics)
17. [UI Risk-Score Color Coding](#17-ui-risk-score-color-coding)

---

## 1. Risk Score

**Range:** `[max(5, level × 2), 100]`
**Location:** `agents/nodes/analysis.ts:90-101, 259, 267-294`
**Consumer:** orchestrator, recommended-action mapper, UI

The risk score is produced **by the triage LLM** following the rubric below, then post-processed by deterministic code that guarantees a floor.

### 1.1 LLM rubric (prompted in `SYSTEM_PROMPT`)

```
Base       = rule.level × 6                          (max 78 at level ≥ 13)
+ 10       if lateral-movement signals present
+ 10       if attack_category == credential access
+  5       if src IP is non-RFC1918 (external)
- 15 %     of base score if is_false_positive == true
                       (proportional discount, not flat)

Floor:    max(5, rule.level × 2)
Clamp:    [floor, 100]
```

### 1.2 Deterministic post-processing

After the LLM returns, code enforces the floor regardless of what the LLM said:

```ts
const riskFloor = Math.max(5, severity * 2);
if ((analysis.risk_score ?? 0) < riskFloor) {
  analysis.risk_score = riskFloor;
}
```

### 1.3 Fallback (LLM unavailable)

```ts
risk_score: Math.max(riskFloor, severity * 4)
```

So a level-10 alert with no LLM response gets `max(20, 40) = 40`.

### 1.4 Worked examples

| Wazuh level | Floor | Base | Likely range |
|---:|---:|---:|---:|
| 3  | 6   | 18  | 6–28   |
| 7  | 14  | 42  | 14–52  |
| 10 | 20  | 60  | 20–80  |
| 13 | 26  | 78  | 26–98  |
| 15 | 30  | 78  | 30–98  |

---

## 2. Severity Classification

**Location:** `server.ts:1804-1809` (and mirrored client-side in `src/App.tsx`)

Maps a Wazuh `rule.level` to a four-tier label.

```ts
function getSeverityLabel(level: number): string {
  if (level >= 13) return 'CRITICAL';
  if (level >= 10) return 'HIGH';
  if (level >= 7)  return 'MEDIUM';
  return 'LOW';
}
```

| level | label | UI color |
|---:|---|---|
| 13–15 | CRITICAL | red    `#d93025` |
| 10–12 | HIGH     | orange `#f29900` |
| 7–9   | MEDIUM   | amber  `#d97706` |
| 1–6   | LOW      | green  `#1e8e3e` |

---

## 3. SLA Windows

**Location:** `server.ts:1797-1802`
**Consumer:** SLA background job (server.ts:5144-5166), validation agent

Time budget (minutes) before an alert is considered SLA-breached. The background job auto-escalates alerts older than `2 × window` that are still in `NEW` or `ANALYZING`.

```ts
const SLA_MINUTES = {
  CRITICAL: 15,
  HIGH:     60,
  MEDIUM:   240,
  LOW:      1440,
};
```

| label | window | auto-escalate at |
|---|---:|---:|
| CRITICAL | 15 min | 30 min |
| HIGH     | 1 h    | 2 h    |
| MEDIUM   | 4 h    | 8 h    |
| LOW      | 24 h   | 48 h   |

---

## 4. Recommended-Action Mapping

**Location:** `agents/nodes/analysis.ts:103-109` (in LLM prompt)

The LLM picks a recommended action from these rules:

```
IGNORE       if false_positive_confidence > 0.85
BLOCK        if risk_score ≥ 80
CONTAIN      if risk_score ≥ 60
ESCALATE     if risk_score ≥ 50
INVESTIGATE  if risk_score ≥ 20
MONITOR      otherwise
```

---

## 5. FP Confidence Aggregator

**Range:** `[0, 1]`
**Location:** `agents/orchestrator.ts:86-110`
**Trigger threshold:** `score ≥ 0.55` → alert routed to FP archive (method = `confidence_aggregated`)

Combines four independent FP signals into a single confidence number. **No extra LLM calls** — only blends pre-computed signals.

### 5.1 Formula

```
score = 0.45 × triageFp
      + 0.20 × assetFp
      + 0.15 × iocFp
      + 0.20 × recallFp
```

Where:

| Term | Source | Computation |
|---|---|---|
| `triageFp` | Triage agent | `clamp01(triage.false_positive_confidence)` |
| `assetFp`  | asset_context table | `0.6` if any alert IOC matches an asset with `fp_default = 1`, else `0` |
| `iocFp`    | ioc_memory table | mean of `fp_count / (fp_count + tp_count)` for IOCs with **≥ 3 prior observations** (others contribute 0) |
| `recallFp` | semantic memory | max similarity over recalled past incidents whose outcome was `FALSE_POSITIVE` |

### 5.2 Why these weights

- Triage gets the biggest weight (0.45) because it has seen all evidence including memory hints.
- Asset and recall are tied at 0.20 — both are strong but specific signals.
- IOC ratio gets 0.15 — most volatile signal, needs at least 3 observations to count.

### 5.3 Code

```ts
const triageFp = Math.max(0, Math.min(1, triageFpConfidence || 0));
const assetFp  = assetCtx?.some(a => a.fp_default === 1) ? 0.6 : 0;
const iocRatios = iocHits.map(h => {
  const total = (h.fp_count || 0) + (h.tp_count || 0);
  return total >= 3 ? (h.fp_count / total) : 0;
});
const iocFp     = iocRatios.length ? iocRatios.reduce((a,b)=>a+b,0) / iocRatios.length : 0;
const recallFps = recallHits
  .filter(h => h.outcome === 'FALSE_POSITIVE')
  .map(h => h.similarity ?? 0);
const recallFp  = recallFps.length ? Math.max(...recallFps) : 0;

const score = 0.45 * triageFp + 0.20 * assetFp + 0.15 * iocFp + 0.20 * recallFp;
```

---

## 6. Asset Fast-FP

**Location:** `agents/orchestrator.ts:60-82, 162-181`
**Cost:** 0 LLM calls
**Routes to:** FP archive with method = `asset_fast`, confidence = 0.85

Deterministic shortcut: if **every** IOC value in the alert is a known FP-default asset AND the description contains no high-risk keywords, classify as FP immediately and skip the entire LLM pipeline.

### 6.1 Logic

```ts
const HIGH_RISK_KEYWORDS = [
  'exfiltration', 'lateral movement', 'credential access', 'privilege escalation',
  'c2 beacon', 'pass-the-hash', 'ransomware', 'data theft', 'persistence',
  'command and control', 'kerberoast', 'mimikatz',
];

function assetFastFp(alert, assetCtx) {
  const fpAssets = assetCtx.filter(a => a.fp_default === 1);
  if (fpAssets.length === 0) return { isFp: false };

  const desc = alert.description.toLowerCase();
  if (HIGH_RISK_KEYWORDS.some(k => desc.includes(k))) return { isFp: false };

  const matchedValues = new Set(fpAssets.map(a => a.value.toLowerCase()));
  const allValues     = extractAssetValuesFromAlert(alert).map(v => v.toLowerCase());
  if (allValues.length === 0) return { isFp: false };

  return { isFp: allValues.every(v => matchedValues.has(v)) };
}
```

### 6.2 Why "every" instead of "any"

Triggering on **any** match would mis-route alerts that include both a known scanner AND a real victim. By requiring **all** IOC values to be known-benign, we only short-circuit when the alert is entirely from known infrastructure.

---

## 7. Suppression-Rule Confidence

**Range:** `[0.78, 0.93]`
**Location:** `agents/memory/suppression.ts:31-33`

Confidence grows logarithmically with how many times a rule has been validated. It never reaches 1.0 — even a known scanner could be compromised.

### 7.1 Formula

```ts
suppressionConfidence(hitCount) = min(0.93, 0.78 + log10(hitCount + 1) × 0.075)
```

### 7.2 Calibration table

| hit_count | confidence |
|---:|---:|
| 0      | 0.780 |
| 1      | 0.803 |
| 10     | 0.858 |
| 100    | 0.930 (cap) |
| 1 000  | 0.930 (cap) |

---

## 8. IOC Memory Score

**Location:** `agents/memory/ioc.ts:89-98`
**Purpose:** rank IOC hits when displaying the IOC table (most actively-seen, most-recently-seen go first)

### 8.1 Formula

```ts
ageDays  = (now - last_seen) / 86_400_000
decay    = exp(-ageDays / 30)        // half-life ≈ 21 days
base     = log2(alert_count + 1)
score    = base × decay
fp_ratio = fp_count / (fp_count + tp_count)
```

### 8.2 Worked examples

| alert_count | days since last seen | base   | decay   | score   |
|---:|---:|---:|---:|---:|
| 1   |  0  | 1.000 | 1.000 | 1.000 |
| 10  |  0  | 3.459 | 1.000 | 3.459 |
| 10  | 30  | 3.459 | 0.368 | 1.273 |
| 100 |  7  | 6.658 | 0.792 | 5.273 |
| 100 | 90  | 6.658 | 0.050 | 0.330 |

---

## 9. Auto-Learning Thresholds

**Location:** `agents/memory/learning.ts:20-21, 38-47`
**Trigger:** runs on every analyst FP feedback + every 5 min via background tick (`server.ts:5240-5249`)

Two thresholds determine how IOCs in `ioc_memory` are promoted into `asset_context`:

| Tier | Rule | Action |
|---|---|---|
| **Suggest** | `fp_ratio ≥ 0.85` AND `total ≥ 5` | flag for analyst review in FP Suggestions panel |
| **Auto-register** | `fp_ratio ≥ 0.95` AND `total ≥ 10` | automatically insert as `asset_context` with `fp_default = 1` |

### 9.1 Rationale

- A 0.85 / 5-obs threshold is sensitive enough to catch noisy scanners after one shift.
- The 0.95 / 10-obs auto-register threshold is conservative — requires two-week-ish corroboration before bypassing the analyst entirely.
- Revoking auto-learns: when an analyst confirms `TRUE_POSITIVE` on an IOC that was previously auto-learned, `fp_default` is cleared and the description gets `[REVOKED by TP feedback]` appended (`learning.ts:149-159`).

---

## 10. Final-Outcome Routing

**Location:** `agents/orchestrator.ts:723-738`
**Order matters** — first match wins.

After the pipeline finishes, `composeOutput()` decides whether the alert is `FALSE_POSITIVE` or `TRIAGED`/`ESCALATED` by running these checks in priority order:

```
1. Asset fast-FP override     (§6)      → FALSE_POSITIVE, method=asset_fast,            conf=0.85
2. Memory short-circuit       (§11)     → FALSE_POSITIVE, method=memory,                conf=0.90
3. Triage agent verdict       (LLM)     → FALSE_POSITIVE, method=triage,                conf=triage.fp_confidence
4. FP confidence aggregator   (§5)      → FALSE_POSITIVE, method=confidence_aggregated, conf=score
5. Low risk-score gate        (§1)      → FALSE_POSITIVE, method=low_risk_score,        conf=0.70
                                          when triage.risk_score < 40
6. Noise-priority gate        (ticket)  → FALSE_POSITIVE, method=noise_priority,        conf=0.60
                                          when ticket.priority ∈ {LOW, MEDIUM}
7. Critical priority                    → ESCALATED
8. Default                              → TRIAGED
```

### 10.1 Code

```ts
const triageRiskScore  = typeof analysis?.risk_score === 'number' ? analysis.risk_score : 100;
const isAgentFp        = !!analysis?.is_false_positive;
const isAggregatedFp   = !fpShortCircuit && !isAgentFp && !!aggregatedFp;
const isLowRiskScore   = !fpShortCircuit && !isAgentFp && !isAggregatedFp && triageRiskScore < 40;
const isNoisePriority  = !fpShortCircuit && !isAgentFp && !isAggregatedFp && !isLowRiskScore
                       && (ticket?.priority === 'LOW' || ticket?.priority === 'MEDIUM');
const isFp = fpShortCircuit || isAgentFp || isAggregatedFp || isLowRiskScore || isNoisePriority;
```

### 10.2 Design notes

- **Defense in depth.** Five independent layers can each catch an FP. Any single layer can be wrong; the union catches the long tail.
- **Risk-score gate overrides LLM priority.** If the LLM said HIGH but its own risk_score < 40, we trust the score, not the label.
- **Priority gate.** Only HIGH and CRITICAL alerts reach an analyst. LOW/MEDIUM are auto-archived (reversible — analyst can promote from the FP archive).

---

## 11. Semantic Similarity

**Location:** `agents/memory/embeddings.ts:46-56`
**Used by:** `semanticStore.search(queryText, k, minSimilarity)`

Standard cosine on Float32 embedding vectors:

```ts
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
```

### 11.1 Calling thresholds

| Caller | k | min similarity |
|---|---:|---:|
| Pre-flight recall (orchestrator.ts:148) | 5  | 0.65 |
| Cross-agent reasoning recall            | 3  | 0.70 |
| Memory FP short-circuit                 | 1  | 0.85 |

### 11.2 Embedding source

Vectors come from Ollama's `/api/embeddings`. If Ollama is unreachable the entire semantic-memory layer degrades gracefully — recalls return an empty list, the rest of the pipeline still runs.

---

## 12. Detection-Method Effectiveness

**Location:** `server.ts:4762-4769`
**Endpoint:** `GET /api/analytics/detection-effectiveness`

Per-method accuracy: how often each FP-detection layer's verdict survived analyst review.

```ts
for each method in ['suppression', 'memory', 'triage']:
  total      = COUNT(alerts WHERE fp_method = method)
  confirmed  = COUNT(alerts WHERE fp_method = method AND status = 'FP_CONFIRMED')
  overridden = COUNT(alerts WHERE fp_method = method AND status = 'FILTERED')
  accuracy   = (total - overridden) / total       // or 1 if total == 0
```

The aggregate `overall.accuracy = (Σ total − Σ overridden) / Σ total`.

### 12.1 Interpretation

- `accuracy = 1.0` means no analyst has ever overridden a verdict by this method.
- `accuracy = 0.5` means analysts disagree with the method half the time → the rule, threshold, or training data needs review.

---

## 13. Noisy-Source Ranking

**Location:** `server.ts:3730-3766`
**Endpoint:** `GET /api/analytics/noisy-sources`

Per-source FP rate, separately for IPs and Wazuh agents.

```sql
fp_rate = SUM(status = 'FALSE_POSITIVE') / COUNT(*)
```

Filters: `total_alerts ≥ 2` (one-shot sources excluded). Top 20 per type by raw FP count.

Each row is then joined against `asset_context` to surface whether the source is already registered (`role`, `fp_default`).

---

## 14. Incident-Status Computation

**Location:** `server.ts:4020-4026`
**Used by:** every incident create / phase-change / assign operation

The incident's `status` column is **derived** from `phase` + assignment — no manual setter.

```ts
function computeIncidentStatus(phase, assignedTo, currentStatus) {
  if (currentStatus === 'CLOSED' || currentStatus === 'RECLASSIFIED_FP') return currentStatus;
  if (phase === 'post_incident')          return 'RESOLVED';
  if (phase === 'recovery')               return 'CONTAINED';
  if (phase === 'containment'
   || phase === 'eradication')            return 'IN_PROGRESS';
  return assignedTo ? 'IN_PROGRESS' : 'OPEN';
}
```

### 14.1 Truth table

| phase            | assignedTo | resulting status |
|---|---|---|
| analysis         | null       | OPEN          |
| analysis         | user X     | IN_PROGRESS   |
| containment      | any        | IN_PROGRESS   |
| eradication      | any        | IN_PROGRESS   |
| recovery         | any        | CONTAINED     |
| post_incident    | any        | RESOLVED      |
| (any)            | currentStatus=CLOSED          | CLOSED         |
| (any)            | currentStatus=RECLASSIFIED_FP | RECLASSIFIED_FP |

---

## 15. Password Strength Estimator

**Range:** score 0–4, bits 0–∞
**Location:** `src/services/aiService.ts:426-446`

Entropy estimate with penalties for repeats and common sequences.

### 15.1 Formula

```ts
pool = (lower ? 26 : 0)
     + (upper ? 26 : 0)
     + (digit ? 10 : 0)
     + (symbol ? 32 : 0)
     || 26

rawBits   = log2(pool) × length
repeats   = (regex /(.)\1{2,}/g count)
sequences = ['0123','1234',...,'abcd','qwer','asdf'] match ? 1 : 0

bits = max(0, rawBits − repeats × 6 − sequences × 8)
```

### 15.2 Score mapping

| bits    | score | label      |
|---:|---:|---|
| 0–27    | 0 | very weak |
| 28–39   | 1 | weak      |
| 40–59   | 2 | fair      |
| 60–79   | 3 | good      |
| ≥ 80    | 4 | strong    |

### 15.3 Server-side enforcement

This is a **client-side hint only**. Server validation runs `validatePassword()` against the live `password_policy` row (`server.ts:1815`) which enforces length, character classes, and reuse history per ISO/NIST policy — strength score does not gate the API.

---

## 16. Pipeline Funnel Metrics

**Location:** `server.ts:4729-4743`
**Endpoint:** `GET /api/analytics/pipeline-funnel`

Six counts + three timing averages.

### 16.1 Counts

```sql
ingested              = COUNT(*)
new                   = COUNT(WHERE status = 'NEW')
fp_filtered           = COUNT(WHERE status IN ('FALSE_POSITIVE','FP_CONFIRMED'))
awaiting_investigation= COUNT(WHERE status = 'FILTERED')
investigated          = COUNT(WHERE status IN ('TRIAGED','ESCALATED','CLOSED')
                              AND investigated_at IS NOT NULL)
escalated             = COUNT(WHERE status = 'ESCALATED')
closed                = COUNT(WHERE status = 'CLOSED')
```

### 16.2 Timing (seconds, averaged over the whole table)

```sql
avg_time_to_filter      = AVG(filtered_at      − timestamp)
avg_time_to_investigate = AVG(investigated_at  − filtered_at)
avg_time_to_close       = AVG(closed_at        − timestamp)
```

Each `AVG()` only counts rows where the relevant timestamp is non-null, so it's the average over completed transitions — not a hidden 0 for incomplete ones.

---

## 17. UI Risk-Score Color Coding

**Location:** `src/App.tsx:567, 1686-1690`
**Source value:** `getAlertRiskScore(alert)` from `src/features/alerts/alertUtils.ts:36-43`

```ts
risk == null          → gray   #cbd5e1
risk ≥ 80             → red    #ef4444   "CRITICAL"
60 ≤ risk < 80        → orange #f97316   "HIGH"
40 ≤ risk < 60        → amber  #f59e0b   "MEDIUM"
risk < 40             → green  #10b981   "LOW"
```

The thresholds intentionally mirror §4 (recommended-action) so that BLOCK/CONTAIN/ESCALATE/MONITOR map 1-to-1 with the visible risk color.

### 17.1 Risk-score source fallback

`getAlertRiskScore()` prefers `phaseData.analysis.risk_score`; if missing, falls back to `phaseData.intel.risk_score` (rescaled ×10 if it's a 0–10 score). Returns `null` when neither is present, which the UI renders as gray.

---

## Cross-references

```
ingest
  ↓
suppression rules           §7   → signal only, no early exit
  ↓
pre-flight memory recall    §11  → signal only
  ↓
asset fast-FP               §6   → can short-circuit to FP archive
  ↓
TRIAGE LLM
  ├── risk score            §1
  ├── recommended action    §4
  └── fp_confidence
  ↓
planner + investigator workers
  ↓
ticketing / response / validation
  ↓
FP confidence aggregator    §5   → may flip to FP
  ↓
final-outcome routing       §10  → FP archive or analyst queue
  ↓
analyst feedback
  ↓
reinforceFeedback           §8   → fp_count/tp_count updated
  ↓
auto-learning tick (5 min)  §9   → IOC promoted to asset_context

side jobs:
  - SLA monitor (5 min)     §3   → ANALYZING/NEW > 2× window → ESCALATED
  - account lifecycle tick  (not scoring — out of scope)
  - audit retention (hourly)(not scoring — out of scope)
```
