# Noise Reduction Analytics

## What It Does

The Noise Reduction Analytics dashboard provides real-time visibility into the effectiveness of FP filtering. It answers questions like:

- What percentage of our alerts are false positives?
- Which sources generate the most noise?
- How much analyst time has been saved by automated FP detection?
- Which suppression rules are doing the most work?
- Are there IOC patterns that should be promoted to suppression rules?

---

## Accessing the Dashboard

Navigate to the **Noise Reduction** tab in the sidebar. The tab contains four sections:

### 1. FP Overview Cards
Four summary cards at the top:
- **Total Alerts** — total count in the database
- **False Positives** — alerts with status `FALSE_POSITIVE`
- **FP Rate** — `(FP / analyzed alerts) * 100`
- **Time Saved** — estimated analyst minutes saved (`FP count * 15 min`)

### 2. FP Breakdown by Trigger
Shows how FPs were detected:
- **Suppression** — caught by deterministic suppression rules (zero LLM cost)
- **Memory-driven** — caught via IOC fp_ratio or semantic similarity recall
- **Triage-driven** — caught by the triage LLM based on FP signals
- **Composer-driven** — reclassified during ticketing/validation phase

### 3. Suppression Rules Table
Lists all active suppression rules with:
- Rule name, match criteria (IP/CIDR, regex, agent name)
- Hit count (how many alerts this rule has suppressed)
- Enable/disable toggle
- Delete button

### 4. Noisy Sources Table
Top source IPs and agent names ranked by FP count:
- Source identifier and type (IP or agent)
- Total alerts from that source
- FP count and FP rate
- Whether it's already registered as a known asset
- "Add to known assets" action button for unregistered sources

---

## API Endpoints

### FP Reduction Overview
```
GET /api/analytics/fp-reduction
```
Returns:
```json
{
  "total_alerts": 150,
  "analyzed_alerts": 120,
  "total_fp": 45,
  "fp_rate": 0.375,
  "memory_driven_fp": 12,
  "triage_driven_fp": 18,
  "suppression_driven_fp": 10,
  "composer_driven_fp": 5,
  "fp_by_trigger": { "memoryFP": 12, "triage": 18, "suppression": 10, "composer": 5 },
  "avg_fp_confidence": 0.92,
  "time_saved_minutes": 675,
  "suppression_rules": [{ "name": "OpenVAS", "hit_count": 10, "created_at": "..." }]
}
```

### FP Over Time (30-day trend)
```
GET /api/analytics/fp-over-time
```
Returns daily FP counts broken down by trigger type, alongside total alert volume per day.

### Noisy Sources
```
GET /api/analytics/noisy-sources
```
Returns top 20 IPs and agents by FP count, enriched with asset registry status.

### Auto-Learning Suggestions
```
GET /api/analytics/fp-suggestions
```
Returns IOCs with ≥85% FP ratio and ≥5 observations that could be promoted to suppression rules.

### Accept Suggestion
```
POST /api/analytics/accept-suggestion
{ "value": "172.10.9.10", "type": "ip" }
```
Registers the IOC as a known asset and optionally creates a suppression rule.

---

## Files Involved

```
server.ts                       ← API endpoints (lines ~1245-1425)
src/App.tsx                     ← NoiseReductionTab component
src/services/aiService.ts       ← fetchFpReduction(), fetchNoisySources(), etc.
agents/memory/suppression.ts    ← Suppression rules engine
agents/memory/learning.ts       ← Auto-learning suggestion logic
```
