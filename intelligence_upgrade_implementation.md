# Intelligence Upgrade — Implementation Log

This document is a precise record of every code change made to ship Tier 1.1 (close the analyst-feedback loop) and Tier 1.2 (visible reasoning trace) from `platforme_intelligence_upgrade.md`, plus the cross-agent memory read I called out as a missing fourth pillar.

It is intentionally a changelog, not a marketing document. Every claim links to a file. Every behaviour is verifiable.

---

## 1. What got diagnosed before any code was written

The proposal's diagnosis was checked against the real codebase. Verified findings:

| Claim | Verified at |
|---|---|
| `reinforceFeedback` was never called from any code path | `agents/memory/learning.ts` was the only file with the symbol; zero call sites elsewhere |
| `processAutoLearning` was unreachable | Same — no cron, no endpoint, no caller |
| `confirm-fp` endpoint did not touch memory | `server.ts` (pre-edit) ran `UPDATE alerts ... + writeAudit` only |
| Every LLM-backed node was a single `callStructuredLLM` call | `agents/nodes/*.ts` — 7 nodes, exactly 1 call each, zero `bindTools` / `ToolMessage` |
| Investigators run with `Promise.all` | `agents/orchestrator.ts` `runInvestigatorsParallel` |
| Reflection was a second dispatch, not real reasoning | Same file, same flow — just adds more workers |
| Hardcoded aggregator weights `0.45·triage + 0.20·asset + 0.15·ioc + 0.20·recall` | Literally that line in `agents/orchestrator.ts` |
| Hardcoded triage FP threshold `0.72` | `agents/orchestrator.ts` |

One additional finding the proposal missed: **`docs/features/12-knowledge-base-workflow.md` already documented behaviour that didn't exist in code.** The doc claimed `confirm-fp` called `reinforceFeedback`. It didn't. Documentation was lying about behaviour.

---

## 2. What got built

### 2.1 Pillars covered

| Pillar | Status |
|---|---|
| Visible reasoning (Tier 1.2) | ✅ schema, prompts, orchestrator capture, persistence, API, UI panel |
| Adaptive behaviour (Tier 1.1) | ✅ `confirm-fp`, `override-fp`, `escalate`, `reclassify-fp` all wire into memory; `processAutoLearning` runs inline + on cron |
| Dialogue | not in scope for this PR — endpoints exist for the next round |
| Continuity (cross-agent memory reads) | ✅ `fetchPriorReasoning` injects past reasoning into the triage prompt |

### 2.2 New files

| File | Purpose |
|---|---|
| `agents/memory/reasoning.ts` | Single source of truth for reasoning shape: `ReasoningSchema` (Zod), prompt-instruction strings, `recordReasoning`, `listReasoningForAlert(s)`, `fetchPriorReasoning` |
| `scripts/test-feedback-loop.ts` | Unit-level smoke test (15 checks): UPSERT semantics, auto-promotion, scan thresholds, reasoning round-trip, TP-revoke |
| `scripts/test-feedback-e2e.ts` | Real HTTP E2E test — boots the server on a random port, exercises every new endpoint (32 checks) |
| `scripts/seed-test-alerts.ts` | Seeds 6 fresh `status='NEW'` alerts so the user can trigger real investigations and watch real LLM output land in the Reasoning tab. **Contains zero hardcoded reasoning rows.** |
| `intelligence_upgrade_implementation.md` | This document |

### 2.3 Modified files

| File | What changed |
|---|---|
| `server.ts` | New `incident_reasoning` table migration; honours `SOC_DB_PATH`; `extractIocsForFeedback` + `applyFeedbackToMemory` helpers; 4 endpoints wire into memory (`confirm-fp`, `override-fp`, `escalate`, `reclassify-fp`); 2 new GET endpoints (`/api/alerts/:id/reasoning`, `/api/incidents/:id/reasoning`); 5-minute `processAutoLearning` cron; cleanup-list extended with `incident_reasoning` |
| `agents/memory/learning.ts` | `reinforceFeedback` upgraded from `UPDATE`-only to `INSERT … ON CONFLICT DO UPDATE`, with `inferIocType` heuristic so out-of-band alerts also capture the signal |
| `agents/orchestrator.ts` | Pre-flight `Promise.all` extended with `fetchPriorReasoning`; triage receives `priorReasoning` block; `recordReasoning` called after every agent in both `runHubAndSwarm` and `runInvestigation`; correlation reasoning captured in `runFpScan` |
| `agents/nodes/analysis.ts` | `reasoning: ReasoningSchema.optional()` added to output schema; system prompt now includes `REASONING_PROMPT_INSTRUCTION` + JSON example; consumes `state.priorReasoning` and renders it as a "PRIOR AGENT REASONING ON SIMILAR INCIDENTS" prompt block; fallback emits empty-but-valid reasoning; `false_positive_reason` made nullable to fix a real schema bug surfaced during E2E (model commonly emits `null`) |
| `agents/nodes/intel.ts` | Reasoning schema field, prompt instruction, fallback |
| `agents/nodes/knowledge.ts` | Same |
| `agents/nodes/correlation.ts` | Same; reasoning passes through the `findRelatedAlerts` post-processing intact via spread |
| `agents/nodes/ticketing.ts` | Same |
| `agents/nodes/response.ts` | Same; reasoning passes through `ACTION_TYPE_MAP` normalisation intact |
| `agents/nodes/validation.ts` | Same |
| `src/services/aiService.ts` | `ReasoningRow` interface, `getIncidentReasoning`, `getAlertReasoning` |
| `src/App.tsx` | Imports `getIncidentReasoning` + `ReasoningRow`; new state `reasoning` + `loadingReasoning`; lazy-fetch on tab open; `'reasoning'` added to `detailTab` union; tab entry in `DETAIL_TABS`; full panel render with per-agent cards |
| `docs/features/12-knowledge-base-workflow.md` | Removed the `source='system_seed'` lie (real value is `'auto-learned'`); documented the inline + cron-tick auto-learning runs; new "Workflow E — Reasoning Capture + Cross-Agent Memory Read" section; endpoint listing brought up to date |

---

## 3. Database schema additions

### 3.1 New table

```sql
CREATE TABLE IF NOT EXISTS incident_reasoning (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id TEXT,
  trace_id TEXT,
  agent TEXT NOT NULL,
  step  INTEGER DEFAULT 0,
  decision TEXT,
  evidence_for TEXT,             -- JSON array
  evidence_against TEXT,         -- JSON array
  rejected_hypotheses TEXT,      -- JSON array
  confidence REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(alert_id) REFERENCES alerts(id)
);
CREATE INDEX IF NOT EXISTS idx_reasoning_alert ON incident_reasoning(alert_id);
CREATE INDEX IF NOT EXISTS idx_reasoning_trace ON incident_reasoning(trace_id);
```

Idempotent — uses `IF NOT EXISTS`. The cleanup-by-alert transaction in `server.ts` was extended to delete from this table too, so test-reset paths don't leave orphans.

### 3.2 Cleanup list extended

`server.ts` had a transaction that deletes child rows on alert removal. The list now includes `incident_reasoning`:

```ts
for (const tbl of ['incident_responses', 'agent_runs', 'feedback', 'action_logs',
                   'blocks', 'working_memory', 'incident_reasoning']) {
  ...
}
```

---

## 4. New HTTP endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/alerts/:id/confirm-fp` (extended) | Now reinforces every IOC in the alert as `FALSE_POSITIVE` and runs `processAutoLearning()` inline |
| `POST /api/alerts/:id/override-fp` (extended) | Reinforces as `TRUE_POSITIVE`; revokes any `fp_default=1` on auto-learned assets |
| `POST /api/alerts/:id/escalate` (extended) | Reinforces as `TRUE_POSITIVE` in addition to creating the incident |
| `POST /api/incidents/:id/reclassify-fp` (extended) | For every linked alert, appends an `FP` signal (deliberately does not erase prior `tp_count` — preserves calibration data) |
| `GET /api/alerts/:id/reasoning` (new) | Returns the structured reasoning trace for one alert |
| `GET /api/incidents/:id/reasoning` (new) | Aggregates reasoning across every alert linked to an incident, sorted chronologically |

All four feedback endpoints now return `feedback: { iocs, auto_registered }` in their JSON body so the UI can show the analyst what just happened in memory.

All four also call `writeAudit` with structured details: how many IOCs were reinforced, how many got auto-registered.

---

## 5. Background jobs

A new `setInterval(processAutoLearning, 5 * 60_000)` runs in `server.ts` startup. It's a safety net for non-analyst commits (e.g. agent-side `upsertIocs` during ingest that crosses the threshold). Each per-feedback endpoint also calls `processAutoLearning` inline, so analyst clicks don't have to wait for the next tick.

When the cron tick promotes any IOC, it writes an audit row with `action='AUTO_LEARN_TICK'`.

---

## 6. Reasoning capture — the contract every agent now obeys

Every LLM-backed node has the same two changes:

1. The Zod output schema gets `reasoning: ReasoningSchema.optional()`
2. The system prompt gets `REASONING_PROMPT_INSTRUCTION` appended, and the JSON example is extended with `REASONING_JSON_EXAMPLE`

The shape:

```ts
reasoning: {
  decision:             string,    // one-sentence conclusion
  evidence_for:         string[],  // 1–4 concrete signals supporting it
  evidence_against:     string[],  // 0–3 counter-signals
  rejected_hypotheses:  string[],  // alternatives considered and why dropped
  confidence:           number     // 0..1, calibrated honestly
}
```

The orchestrator persists each via `recordReasoning(...)` after the node returns. Empty / fallback reasoning is silently skipped — no padding rows in the DB.

---

## 7. Cross-agent memory read

`fetchPriorReasoning(description, k=3, threshold=0.7)` is called in the pre-flight `Promise.all` of both `runHubAndSwarm` and `runFpScan`. It uses `semanticStore.search` to find the top-3 most semantically similar past alerts, then `listReasoningForAlerts` to fetch the most recent 2 reasoning rows for each.

The triage prompt now contains a block titled `PRIOR AGENT REASONING ON SIMILAR INCIDENTS` that shows, per prior alert: similarity %, outcome, and per-agent decision + bullet evidence + rejected hypotheses.

This is what closes the proposal's missing "continuity" pillar — the next triage doesn't start from a blank slate.

---

## 8. UI: the Reasoning tab

In `src/App.tsx`, the incident detail view's tab bar has a new "Reasoning" entry between Tasks and Timeline. When opened it lazy-fetches `GET /api/incidents/:id/reasoning` and renders one card per agent.

Each card shows:

- **Color-coded agent chip** (analysis = violet, intel = blue, knowledge = amber, correlation = pink, ticketing = cyan, response = orange, validation = emerald)
- **Step** number and **timestamp**
- **Confidence** colour-graded green ≥85% / amber ≥60% / red below
- **Decision** in bold
- **Evidence for** (green panel, `+` bullets) and **Evidence against** (red panel, `−` bullets) side by side
- **Rejected hypotheses** in a muted strikethrough list
- Footer with truncated alert/trace IDs for traceability

Empty-state copy is explicit: incidents that ran before this feature deployed will be empty; new investigations populate automatically.

---

## 9. Bugs caught and fixed during verification

These were not in scope but surfaced during E2E testing and were strictly improvements:

### 9.1 `server.ts` ignored `SOC_DB_PATH`

The agents respected the env var; the server hard-coded `'soc.db'`. They only happened to share a DB file when run from the repo root. Fixed:

```ts
db = new Database(process.env.SOC_DB_PATH || 'soc.db');
```

This was a prerequisite to running the E2E test against an alternate DB.

### 9.2 `reinforceFeedback` was UPDATE-only

It used a plain `UPDATE ioc_memory ... WHERE value = ?`. If the row didn't exist (any out-of-band alert that bypassed triage), the analyst's signal was silently lost. Fixed: now `INSERT … ON CONFLICT(value) DO UPDATE` with a heuristic `inferIocType` for the type column.

In normal triage-seeded production flow this changes nothing — the row already exists, so the conflict path runs. The UPSERT only matters for edge cases (manually inserted alerts, alerts that errored during triage, test fixtures).

### 9.3 `analysis` schema rejected `null` for `false_positive_reason`

Real LLMs frequently emit `null` for non-FP alerts rather than omitting the field. The Zod schema was `z.string().optional()` which accepts only `string | undefined`. Fixed to `z.string().nullable().optional()`. Discovered when the live OpenRouter call hit:

```
[LLM Schema Error][analysis] false_positive_reason: Invalid input: expected string, received null
```

---

## 10. Test scripts shipped

### 10.1 `scripts/test-feedback-loop.ts` — unit-level smoke test

Exercises the memory helpers directly (no server, no LLM):

- `reinforceFeedback` correctly bumps `fp_count` / `tp_count`
- `processAutoLearning` promotes when `fp_ratio ≥ 0.95` AND `total ≥ 10`
- Promoted asset has `source='auto-learned'` and `fp_default=1`
- `scanForFpSuggestions` correctly classifies borderline IOCs (>0.85 → suggest; >=0.95 ∧ ≥10 → auto)
- `recordReasoning` round-trips with arrays preserved
- Empty reasoning is skipped silently
- TP override on an auto-learned asset revokes `fp_default` and annotates the description

15 assertions, all pass.

```
SOC_DB_PATH=/tmp/aisoc-test-feedback.db npx tsx scripts/test-feedback-loop.ts
```

### 10.2 `scripts/test-feedback-e2e.ts` — real HTTP integration test

Boots the actual `server.ts` on a random port with a fresh temp SQLite DB. Logs in via `/api/auth/login`. Exercises every new endpoint over HTTP:

- Schema migrations created `incident_reasoning` with all 9 expected columns
- Login returns a JWT
- `confirm-fp` returns 200, body reports IOCs, `ioc_memory.fp_count++`, alert status flips to `FP_CONFIRMED`
- `override-fp` increments `tp_count` and leaves `fp_count` alone
- Reasoning rows round-trip through HTTP with JSON arrays parsed
- Missing-alert reasoning fetch returns `count: 0` gracefully (200, not 404)
- Auto-learning crosses the threshold after 12 FP confirmations and promotes the IOC into `asset_context`
- All endpoints return 401 without a JWT

32 assertions, all pass.

```
npx tsx scripts/test-feedback-e2e.ts
```

### 10.3 `scripts/seed-test-alerts.ts` — investigable test fixtures

Inserts 6 fresh `status='NEW'` alerts into the alerts table only:

| Alert ID | Severity | Hint |
|---|---|---|
| `test-ssh-bruteforce-external` | 13 | external IP brute force, expected TP |
| `test-backup-host-noise` | 8 | internal backup activity, expected FP |
| `test-dga-finance-workstation` | 11 | DGA-pattern but Google DNS, genuinely ambiguous |
| `test-credential-access-prod-db` | 14 | kerberoast on prod DB, expected TP, high confidence |
| `test-monitoring-agent-scan` | 7 | known monitoring agent heartbeat, expected FP |
| `test-uncertain-rdp-after-hours` | 9 | could be insider, could be on-call, genuinely ambiguous |

**There are zero hardcoded reasoning rows.** When you trigger an investigation on any of these from the UI (Investigation tab → Run Investigation), the orchestrator runs every agent against real LLM endpoints, persists their structured reasoning via `recordReasoning`, and the Reasoning tab populates from the actual model output.

```
npx tsx scripts/seed-test-alerts.ts          # create / refresh
npx tsx scripts/seed-test-alerts.ts --clean  # remove all test- alerts and any incidents they spawned
```

---

## 11. Verification matrix

| Check | Result |
|---|---|
| `npm run lint` (TypeScript noEmit) | exit 0 |
| `npm run build` (Vite production build) | exit 0; only pre-existing tailwind utility CSS warnings |
| Unit tests (`scripts/test-feedback-loop.ts`) | **15 / 15 pass** |
| End-to-end HTTP tests (`scripts/test-feedback-e2e.ts`) | **32 / 32 pass** |

---

## 12. What is NOT in this PR (deliberate scope-out)

- **Critic agent (Tier 1.3)**. The reasoning substrate it would read and respond to now exists. Build is gated on seeing real `evidence_against` outputs in production so the structured-counter-evidence requirement can be specced concretely rather than guessed.
- **Co-pilot chat (Tier 2.1)**. Endpoints are not yet wired. The smaller "Challenge this verdict" button I called out as a higher-leverage precursor is also pending.
- **Tool-using ReAct loop (Tier 2.2)**. Should be conditional on triage uncertainty, not a default; spec deferred until calibration data exists.
- **Hypothesis-driven investigation (Tier 2.3)**. Overlaps significantly with the critic agent; recommended to merge.
- **Adaptive thresholds (Tier 3.1)**. The math in the proposal is wrong (`recall · precision` is not a standard objective). Spec deferred until calibration data lets us choose the right objective.
- **Calibration card (Tier 3.3)**. Would be a small follow-up once feedback rows accumulate.
- **Nightly briefing (Tier 3.2)**. Pure follow-up.

---

## 13. How to demonstrate end-to-end

1. Make sure the dev server is running: `npm run dev`
2. **Hard-refresh** the browser (Cmd-Shift-R / Ctrl-Shift-F5) so Vite serves the new bundle
3. Seed test alerts: `npx tsx scripts/seed-test-alerts.ts`
4. Open the dashboard, find the alerts whose description starts with `[TEST]`
5. Click "Run Investigation" on one (suggest `test-credential-access-prod-db` for a confident TP, or `test-dga-finance-workstation` for a case where agents may disagree)
6. Wait ~10–30 seconds for the orchestration to complete
7. The alert will be archived as FP or escalated into an incident depending on the verdict
8. Open that incident → click the **Reasoning** tab
9. Every card you see was produced by a real LLM call — not a fixture

To clean up afterwards: `npx tsx scripts/seed-test-alerts.ts --clean`

---

## 14. File-level audit trail

If you want to read the diffs in order from foundations up:

1. `agents/memory/reasoning.ts` — defines the schema and the helpers; nothing references it yet
2. `server.ts` migration block — `incident_reasoning` table created on startup
3. `agents/nodes/*.ts` — each node now emits a `reasoning` block
4. `agents/orchestrator.ts` — captures and persists; injects prior reasoning into triage
5. `agents/memory/learning.ts` — `reinforceFeedback` made robust
6. `server.ts` endpoints — feedback wired, reasoning endpoints added, cron tick added
7. `src/services/aiService.ts` — frontend client functions
8. `src/App.tsx` — UI tab + panel
9. `docs/features/12-knowledge-base-workflow.md` — drift fixed
10. `scripts/test-feedback-loop.ts`, `scripts/test-feedback-e2e.ts`, `scripts/seed-test-alerts.ts` — verification + demo path
