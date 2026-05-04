# False Positive Reduction

## What It Does

The FP reduction system is a multi-layered approach to filtering noise from security alerts. It combines three strategies:

1. **Suppression Rules** — Instant, deterministic filtering before any LLM runs
2. **Known Asset Registry** — Context about your infrastructure (scanners, monitoring, backups) that tells the AI "this is expected"
3. **Auto-Learning** — Automatic detection of frequently-false-positive IOC patterns, promoted to suppression rules

Together, these layers can short-circuit a noisy alert in < 1ms — saving LLM tokens, reducing analyst fatigue, and focusing attention on real threats.

---

## Architecture

```
Alert arrives at orchestrator
         │
         ▼
┌─────────────────────────────┐
│  Layer 1: Suppression Rules │  ← Instant check (regex, CIDR, agent name)
│  (deterministic, 0 tokens)  │  → If matched: auto-FP, attach rule_id, DONE
└─────────────────────────────┘
         │ not suppressed
         ▼
┌─────────────────────────────┐
│  Layer 2: Memory Recall     │  ← IOC fp_ratio, semantic similarity, asset_context
│  (deterministic, 0 tokens)  │  → Sets fpSimilar, fpAsset, fpIocPattern flags
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Layer 3: Triage LLM        │  ← Sees all FP signals in context
│  (1 LLM call)               │  → If high-confidence FP: short-circuit, DONE
└─────────────────────────────┘
         │ not FP
         ▼
    Normal investigation...
```

---

## Layer 1: Suppression Rules

### How It Works

Before any memory recall or LLM call, the orchestrator checks the alert against all active suppression rules. Each rule can match on:

- **Source IP** — exact match or CIDR range (e.g., `172.10.9.0/24`)
- **Description regex** — pattern match on the alert description (e.g., `vulnerability scan`)
- **Agent name** — match on the Wazuh agent name (e.g., `scanner-host-01`)

If any enabled rule matches, the alert is immediately classified as `false_positive` with:
- `riskScore: 0`
- `summary: "Auto-suppressed by rule: <rule_name>"`
- The rule ID attached in metadata

### Managing Rules

**From the UI:**
Navigate to **Noise Reduction** → **Suppression Rules** section. You can:
- View all rules with match counts
- Create new rules (name, source IP/CIDR, description regex, agent name)
- Enable/disable rules
- Delete rules

**Via API:**
```
GET    /api/suppression-rules              # List all rules
POST   /api/suppression-rules              # Create a rule
PATCH  /api/suppression-rules/:id          # Update (enable/disable)
DELETE /api/suppression-rules/:id          # Delete
```

### Example Rule

```json
{
  "name": "OpenVAS Scanner",
  "source_ip": "172.10.9.0/24",
  "description_regex": "vulnerability scan|openvas|nessus",
  "agent_name": null,
  "enabled": true
}
```

This suppresses any alert from the 172.10.9.x range whose description mentions vulnerability scanning.

---

## Layer 2: Known Asset Registry

### How It Works

The `asset_context` table stores known infrastructure — scanners, monitoring tools, backup servers, service accounts. During memory recall, the orchestrator checks if the alert's source IP, agent name, or username appears in this table.

If a known asset is found with `fp_default = 1` (meaning "alerts from this asset are normally false positives"), the `fpAsset` flag is set to `true` in the memory context, which the Triage LLM sees and factors into its FP confidence.

### Asset Types

| Type | Examples | fp_default |
|------|----------|-----------|
| `scanner` | OpenVAS (172.10.9.10), Nessus, Qualys | 1 |
| `monitoring` | Nagios, Prometheus | 1 |
| `backup` | Backup server, rsync service account | 1 |
| `internal` | Dev servers, CI/CD runners | Varies |

### Managing Assets

**From the UI:**
Navigate to **Noise Reduction** → **Known Assets** section. You can:
- View all assets with their type, identifier, and FP default
- Add new assets
- Delete assets
- One-click "Add to known assets" from the Noisy Sources table

**Via API:**
```
GET    /api/assets                          # List all assets
POST   /api/assets                          # Add an asset
DELETE /api/assets/:id                      # Remove an asset
```

### Seeding

Run the seed script to populate with common infrastructure:

```bash
npx tsx seed-known-assets.ts
```

This adds 13 entries: 3 scanners, 3 monitoring systems, 2 backup systems, 2 internal services, 3 service accounts.

---

## Layer 3: Auto-Learning

### How It Works

The auto-learning module scans IOC memory for indicators that have accumulated a high false-positive ratio (≥ 85% by default). It suggests these as candidate suppression rules that an analyst can review and promote.

```
IOC Memory (ioc_memory table)
     │
     ▼ scan for fp_ratio ≥ 0.85 and observation_count ≥ 3
     │
     ▼
Candidate Suggestions
     │
     ▼ analyst reviews and approves
     │
     ▼
New Suppression Rule registered
```

### Using Auto-Learning

**Check suggestions:**
```
GET /api/memory/learning/suggestions
```

Returns a list of IOCs with high FP ratios, each with a suggested suppression rule configuration.

**Promote a suggestion to a rule:**
```
POST /api/memory/learning/promote
{ "indicator": "172.10.9.10", "type": "ip" }
```

Creates a new suppression rule from the suggestion.

---

## Analytics

The **Noise Reduction** tab in the UI shows:

### FP Overview Cards
- **Total Alerts** — count of all alerts
- **False Positives** — count with status = false_positive
- **FP Rate** — percentage
- **Suppressed** — count handled by suppression rules (riskScore = 0)

### Noisy Sources Table
Top source IPs ranked by FP count, with columns:
- Source IP
- Total alerts from that IP
- FP count
- FP rate (%)
- "Add to known assets" action button

### API Endpoints
```
GET /api/analytics/fp-overview              # Summary stats
GET /api/analytics/noisy-sources            # Top 20 noisiest IPs
```

---

## Files Involved

```
agents/memory/suppression.ts    ← Suppression rules engine (match, CRUD)
agents/memory/learning.ts       ← Auto-learning suggestions + promotion
agents/memory/assets.ts         ← Asset context lookups
agents/orchestrator.ts          ← Step 0 suppression check integration
server.ts                       ← API endpoints for rules, assets, analytics
src/App.tsx                     ← NoiseReductionTab UI component
src/services/aiService.ts       ← Frontend service functions
seed-known-assets.ts            ← Seeds 13 known infrastructure entries
seed-scanner-alerts.ts          ← Seeds 18 test alerts (FP + real)
```

---

## Design Decisions

1. **Suppression runs before memory recall** — zero cost for known noise. No embeddings computed, no LLM tokens spent.
2. **CIDR matching** — scanners often use IP ranges; matching `172.10.9.0/24` catches the entire scanner subnet.
3. **IOC fp_ratio threshold at 0.85** — conservative enough to avoid suppressing indicators that are sometimes real (e.g., an IP used for both scanning and actual C2).
4. **Auto-learning requires analyst approval** — fully automatic suppression would risk hiding real attacks. The system suggests; the analyst decides.
