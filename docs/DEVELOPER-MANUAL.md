# AISOC — Developer Manual

The complete reference for engineers who **run, maintain, and extend** the Aegis AI-SOC
platform — frontend internals through every backend endpoint. For operating the platform
as an analyst/admin, see the [User Manual](./USER-MANUAL.md).

## Table of contents
1. [Architecture & request lifecycle](#1-architecture--request-lifecycle)
2. [Tech stack](#2-tech-stack)
3. [Repository layout](#3-repository-layout)
4. [Frontend architecture](#4-frontend-architecture)
5. [Backend architecture](#5-backend-architecture)
6. [Authentication & RBAC](#6-authentication--rbac)
7. [Data layer (PostgreSQL + pgvector)](#7-data-layer-postgresql--pgvector)
8. [The agent system](#8-the-agent-system)
9. [Real-time (Socket.IO)](#9-real-time-socketio)
10. [API reference — all 128 endpoints](#10-api-reference--all-128-endpoints)
11. [Local development setup](#11-local-development-setup)
12. [Build & deployment](#12-build--deployment)
13. [Extending the app](#13-extending-the-app)
14. [Testing & verification](#14-testing--verification)
15. [Operations & troubleshooting](#15-operations--troubleshooting)
16. [Security & known limitations](#16-security--known-limitations)
17. [Reference](#17-reference)

---

## 1. Architecture & request lifecycle

AISOC is a **monolith by design**: a single Node.js process serves the Express REST API,
the Socket.IO server, **and** runs the LangGraph AI agents in-process. There is no separate
agent microservice and no message queue.

```
Wazuh / SIEM ──POST /api/ingest (X-Api-Key)──▶ ┌──────────── Node.js process ────────────┐
Browser (React) ◀── REST + Socket.IO ────────▶ │ Express API · Auth (JWT/RBAC) · Socket  │
                                               │ AI agents (LangGraph, in-process)       │
                                               └───────────────┬─────────────────────────┘
                                                               │ dbq (async adapter)
                                                               ▼
                                  PostgreSQL + pgvector  ·  Ollama (embeddings)  ·  LLM APIs
```

**Alert lifecycle (happy path):**
1. Wazuh forwarder `POST /api/ingest` with an `X-Api-Key`.
2. Cheap gate: API-key auth → severity floor → rate-limit → dedup. The row is stored and
   the HTTP response returns **immediately** — the AI pipeline is **fire-and-forget**, so
   ingestion never backs up.
3. The pipeline runs the **9-layer FP funnel**; most noise is archived without an LLM call.
4. Genuine suspects go through the **hub-and-swarm** multi-agent investigation.
5. Real threats become incidents and fire notifications (Telegram/Slack/Email/GLPI).
6. Socket.IO pushes the result to the dashboard live.

See [`docs/diagrams/sequence-diagram.puml`](./diagrams/sequence-diagram.puml) and
[`docs/diagrams/aisoc-overview.eraser`](./diagrams/aisoc-overview.eraser).

## 2. Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript, Vite, Tailwind CSS, Recharts, Lucide, Motion, Socket.IO client |
| Backend | Node.js 20+, Express 4, Socket.IO, run via `tsx` (no build step for the server) |
| Auth | JWT (`jsonwebtoken`), `bcryptjs`, optional LDAP/AD (`ldapjs`) |
| Database | **PostgreSQL + pgvector** via `node-postgres` (`pg`), behind the async adapter `db/pool.ts` |
| AI orchestration | LangChain + LangGraph; `zod` for structured LLM-output validation |
| LLM providers | OpenRouter, OpenAI, Google Gemini, Ollama (local) — DB-backed registry |
| Embeddings | Ollama `nomic-embed-text` (768-dim) |

## 3. Repository layout

```
server.ts                  Backend entrypoint: bootstrap, auth, all 128 routes, Socket.IO, Vite glue
agents.ts                  Public agent API: runOrchestration / runFpScan / runInvestigation / runPhase
agents/
  orchestrator.ts          Hub-and-swarm: runHubAndSwarm / runFpScan / runInvestigation, FP aggregation
  planner.ts               Planner LLM: which investigators to dispatch; WORKER_NAMES / COMPOSER_NAMES
  config.ts                AGENT_PHASES, DEFAULT_AGENT_MODELS, AGENT_METADATA, OPENROUTER_FREE_MODELS
  index.ts                 runPhase / runOrchestration dispatch (swarm vs linear)
  nodes/                   One async node per agent (analysis, intel, knowledge, correlation,
                           ticketing, response, validation, recall, ioc_check)
  memory/                  Memory tiers: store(pgvector) · ioc · assets · suppression · reasoning ·
                           working · insights · learning · embeddings · db(adapter handle)
  shared/                  client(LLM resolution) · llm-providers(registry) · policy(RBAC+password) ·
                           ldap · glpi · telegram · cidr
db/
  pool.ts                  pg.Pool + dbq async adapter + applySchema() / assertDbReady() / transaction()
  schema.sql               Canonical PostgreSQL DDL (all 26 tables, pgvector, indexes)
scripts/
  migrate-sqlite-to-pg.ts  One-time ETL (npm run db:migrate)
  provision-postgres.sh    Host provisioning (PostgreSQL + pgvector + role/db)
src/
  App.tsx                  The SPA (≈11.9k lines): all views, state, auth, charts
  main.tsx                 React bootstrap
  types.ts                 Shared domain types (roles, Alert, Incident, …)
  services/aiService.ts    The API client layer — the canonical frontend↔backend contract
  features/alerts/alertUtils.ts   Agent-phase UI helpers
  components/ui/PageHeader.tsx     Shared UI
  index.css                Tailwind + theme
troubleshoot.sh            Diagnose/auto-fix (server, ports, DB, TLS, env)
docs/                      Manuals, feature docs, diagrams, architecture, handover, migration
```

## 4. Frontend architecture

The frontend is a **single-page React app**, intentionally simple (no router library, no
Redux). Client-side navigation is a `activeTab` state value switching between eleven views.

> **Known limitation:** `src/App.tsx` is one ~11.9k-line file mixing many concerns. New
> work should extract views/components out of it; the helpers in `src/features/` and
> `src/components/` show the target pattern.

### Files
| File | Role |
|---|---|
| `src/main.tsx` | Mounts `<App/>` into `index.html`. |
| `src/App.tsx` | All eleven views, global state, auth flow, dashboards/charts. Tabs: `dashboard`, `noise-filter`, `fp-archive`, `investigation`, `incidents`, `response-actions`, `reports`, `knowledge`, `integrations`, `settings`, `profile`. |
| `src/services/aiService.ts` | **The API client.** Typed `fetch` wrappers for every backend area — read this first to learn the contract. |
| `src/types.ts` | Shared domain types: `UserRole`, `ROLE_LEVEL`, `IncidentPhase/Status`, `Incident`, `Alert`, `Integration`, `Stats`, etc. |
| `src/features/alerts/alertUtils.ts` | `AGENT_PHASES_UI`, `getPhaseData` — rendering the agent timeline. |
| `src/components/ui/PageHeader.tsx` | Shared header component. |

### Auth & token flow
- After login, the JWT is stored in `localStorage` under **`soc_token`**.
- Every request sends `Authorization: Bearer <token>` (see `authHeaders()` in `aiService.ts`).
- **Step-up:** for a sensitive admin op, the UI calls `verifyPassword(password)` →
  `POST /api/auth/verify-password`, gets a short-lived token, and resends the op with an
  **`X-Step-Up-Token`** header. The backend returns `{ step_up_required: true }` (HTTP 401/403)
  when the elevated token is missing/expired; the client surfaces a re-auth modal.
- `ROLE_LEVEL` (in `types.ts`) gates UI affordances client-side; the backend enforces the
  same matrix server-side (never trust the client).

### Real-time
The app opens a Socket.IO connection and re-renders on server pushes — primarily
`new_alert` and `alert_updated` (full event list in [§9](#9-real-time-socketio)).

### Build / serving
- **Dev:** `npm run dev` runs the server with `USE_VITE_MIDDLEWARE=true`; the Node process
  serves the frontend through Vite middleware (HMR) — one process, one origin, so relative
  `/api/...` calls "just work".
- **Prod:** `npm run build` emits `dist/`; `npm run start` serves it. The SPA fallback route
  (`GET *`) returns `dist/index.html` for client-side routes.

## 5. Backend architecture

`server.ts` is the single backend file. Top-to-bottom it:
1. Imports + config (`JWT_SECRET`, helpers, rate-limiter).
2. `import { dbq as db } from './db/pool.js'` — the async DB handle.
3. `async function initDatabase()` — `assertDbReady()` → `applySchema()` → seed
   (admin user, policies, LLM providers, integrations, local-LLM defaults, agent settings,
   playbooks). Idempotent (`ON CONFLICT DO NOTHING`).
4. Helpers: `writeAudit`, `dispatchActions`, auth/policy helpers, `readLdapConfig`, etc.
5. `async function startServer()` — builds the Express app, middleware stack, registers all
   routes, attaches Socket.IO, then `httpServer.listen(PORT)`.
6. Entrypoint: `initDatabase().then(startServer)`.

**Middleware stack:** `helmet` → `cors` → `express.json` → `express-rate-limit` (on ingest)
→ per-route guards (`authenticate`, `requireAdmin`, `requireRole`, `requireStepUp`).

**Route handlers are `async`** and `await` the `dbq` adapter. A missing `await` is usually a
TypeScript error because the adapter returns real `Promise<T>` (see [§7](#7-data-layer-postgresql--pgvector)).

## 6. Authentication & RBAC

- **Roles & levels** (`agents/shared/policy.ts`, mirrored by `ROLE_LEVEL` in `server.ts`):
  `ANALYST(0) < TIER1(1) < TIER2(2) < INCIDENT_LEAD(3) < ADMIN(4) < SUPER_ADMIN(5)`.
  Keep the two in sync. The full `PERMISSIONS` matrix (key → min level → area) lives in
  `policy.ts` and drives the `/api/admin/permissions` viewer.
- **Guards:** `authenticate` (valid JWT + epoch check), `requireAdmin` (level ≥ ADMIN +
  optional IP allowlist), `requireRole(level)`, `requireStepUp` (valid `X-Step-Up-Token`).
- **JWT:** signed with `JWT_SECRET`; carries `{ id, username, role, email, epoch }`.
  Bumping a user's `jwt_epoch` (revoke-sessions) invalidates all their outstanding tokens.
- **Lockout:** 5 failed logins → 15-minute lock (configurable via `lockout_policy`).
- **Password policy/history:** enforced server-side (`validatePassword`,
  `passwordMatchesHistory`), configurable via `password_policy`.
- **Step-up:** `verify-password` issues a short elevated token for destructive admin ops.
- **Machine auth:** `POST /api/ingest` uses an `X-Api-Key` (SHA-256 hashed in `api_keys`),
  never a JWT.
- **Audit:** `writeAudit(userId, action, details)` records logins, lockouts, and admin
  actions to `audit_logs` (exportable to CSV; retention via `audit_retention`).
- **Access reviews:** snapshot active users + an admin decision per user (compliance evidence).

## 7. Data layer (PostgreSQL + pgvector)

- **One shared pool + async adapter.** `db/pool.ts` exports `dbq`, mirroring
  better-sqlite3's `prepare().get()/.all()/.run()` but returning **Promises**. `server.ts`
  uses `import { dbq as db }`; `agents/memory/db.ts`'s `memDb()` returns the same handle —
  the whole process shares one `pg.Pool`.
- **`?` → `$n`** placeholders are rewritten automatically; `.run()` returns
  `{ changes, lastInsertRowid }` (the latter from a `RETURNING id` clause).
- **Conventions (deliberate, to minimize churn):** JSON columns are `TEXT` (app does its own
  `JSON.stringify/parse`); booleans are `INTEGER` 0/1; timestamps are real `timestamp` but a
  type-parser returns them as strings.
- **Transactions:** `await db.transaction(async (tx) => { … await tx.prepare(sql).run(…) })`
  — statements must use the `tx` client for atomicity.
- **Vectors:** `incident_insights.embedding` is `vector(768)` with an HNSW cosine index;
  search is SQL (`1 - (embedding <=> $1)`) in `agents/memory/store.ts`.
- **Schema source of truth:** `db/schema.sql`, applied idempotently at startup via
  `applySchema()`. Background: [`docs/MIGRATION-POSTGRES.md`](./MIGRATION-POSTGRES.md).

### The 26 tables (by domain)
| Domain | Tables |
|---|---|
| Identity & access | `users`, `password_history`, `access_reviews`, `access_review_items`, `api_keys`, `audit_logs` |
| Alerts & incidents | `alerts`, `incidents`, `incident_alerts`, `incident_timeline`, `incident_actions`, `agent_runs`, `feedback`, `action_logs`, `playbooks` |
| AI / agent memory | `incident_insights` (pgvector), `incident_reasoning`, `ioc_memory`, `asset_context`, `working_memory`, `suppression_rules` |
| Integrations & config | `agent_settings`, `integrations`, `local_llm_config`, `llm_providers` |

Agent output is stored as JSON in `alerts.ai_analysis`, so **adding an agent needs no
migration**. See [`docs/diagrams/class-diagram.puml`](./diagrams/class-diagram.puml).

## 8. The agent system

- **Public API** (`agents.ts` / `agents/index.ts`): `runOrchestration`, `runFpScan`,
  `runInvestigation`, `runPhase`.
- **Orchestration modes** (`agents/orchestrator.ts`):
  - `runHubAndSwarm` — the full pipeline.
  - `runFpScan` — cheap FP-only (steps 0–3): suppression → memory pre-reads → triage → FP
    decision. 0 LLM calls if suppression catches it, else 1 (triage).
  - `runInvestigation` — steps 4–7 (planner → investigators → composers → memory commit),
    reusing the FP-scan's triage.
- **Hub** does the mandatory work: suppression check, memory pre-reads (recall/IOC/asset),
  triage. Confident FP → short-circuit.
- **Planner** (`planner.ts`): a small/fast LLM picks which investigators to run, dispatched
  **in parallel** under a cost budget, with at most one reflection round.
- **Investigators (workers):** `intel`, `knowledge`, `correlation`, `recall`, `ioc_check`.
- **Composers (sequential):** `ticketing` → `response` → `validation`.
- **FP aggregation:** `aggregateFpScore` combines triage/asset/IOC/recall signals
  (`0.45·triage + 0.20·asset + 0.15·ioc + 0.20·recall`); priority/noise gates decide the
  final outcome (`FALSE_POSITIVE` / `TRIAGED` / `ESCALATED`).
- **Memory tiers** (`agents/memory/`): semantic insights (pgvector), IOC reputation, asset
  context, suppression rules, working memory (planner trace), per-agent reasoning.
- **Models:** resolved per phase from `agent_settings`; the provider registry (`llm_providers`)
  is walked in priority order with fallback. The hot path (`resolveProviders` →
  `resolveClientsForModel`) reads a synchronous in-memory snapshot refreshed async.
- Deep dives: [`docs/features/01-hub-and-swarm-orchestration.md`](./features/01-hub-and-swarm-orchestration.md),
  [`docs/features/10-memory-system.md`](./features/10-memory-system.md),
  [`CURRENT_AI_AGENTS_WORKFLOW.md`](../CURRENT_AI_AGENTS_WORKFLOW.md),
  [`docs/ALGORITHMS.md`](./ALGORITHMS.md).

## 9. Real-time (Socket.IO)

The server pushes these events to all connected clients (`io.emit(...)` in `server.ts`):

| Event | Emitted when | Payload (shape) |
|---|---|---|
| `new_alert` | An alert is ingested | the new alert row |
| `alert_updated` | An alert's status/analysis changes | `{ id, status, … }` |
| `alerts_cleared` | FP archive / queue cleared | `{ ids }` |
| `incident_created` | A new incident is opened | the incident |
| `incident_updated` | Incident phase/status/action changes | the incident |
| `incidents_cleared` | Incidents bulk-cleared | `{ … }` |

The frontend subscribes (at least to `new_alert` and `alert_updated`) and refreshes the
relevant view. There is no client→server custom event; clients act via the REST API.

## 10. API reference — all 128 endpoints

Base path `/api`. **Guard legend:** `auth` = valid JWT; `admin` = `authenticate +
requireAdmin`; `step-up` = also `requireStepUp` (`X-Step-Up-Token`); `api-key` = `X-Api-Key`
(machine); `public` = none. The definitive source is the `app.<method>(...)` registrations
in `server.ts`.

### Auth & session
| Method | Path | Guard | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | public | Authenticate (LDAP or local); returns JWT + user |
| GET | `/api/auth/me` | auth | Current user from the JWT |
| GET | `/api/auth/password-rules` | public | Active password policy (for the login/change UI) |
| POST | `/api/auth/verify-password` | auth | Step-up: exchange password for a short `X-Step-Up-Token` |

### Ingest (machine)
| Method | Path | Guard | Purpose |
|---|---|---|---|
| POST | `/api/ingest` | api-key | SIEM forwarder posts an alert (severity floor, rate-limit, dedup) |
| POST | `/api/heartbeat` | api-key | Forwarder liveness heartbeat |
| GET | `/api/ingest/status` | auth | Ingest config + API-key status |

### Alerts
| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/alerts` | auth | Alert queue (filter + paginate) |
| GET | `/api/alerts/fp-archive` | auth | False-positive archive (filter by method/source) |
| PATCH | `/api/alerts/:id` | auth | Update an alert (e.g. status) |
| POST | `/api/alerts/:id/confirm-fp` | auth | Confirm a false positive (feeds learning) |
| POST | `/api/alerts/:id/override-fp` | auth | Override an FP verdict |
| POST | `/api/alerts/:id/escalate` | auth | Escalate an alert to an incident |
| GET | `/api/alerts/:id/reasoning` | auth | Per-agent reasoning timeline for an alert |
| GET | `/api/alerts/:alertId/runs` | auth | Agent-run snapshots for an alert |
| POST | `/api/alerts/:alertId/runs` | auth | Save an agent-run snapshot |

### AI pipeline
| Method | Path | Guard | Purpose |
|---|---|---|---|
| POST | `/api/ai/agent` | auth | Run one agent phase against a state |
| POST | `/api/ai/orchestrate` | auth | Full hub-and-swarm orchestration for an alert |
| POST | `/api/ai/fp-scan` | auth | Cheap FP-only scan for one alert |
| POST | `/api/ai/fp-scan-batch` | auth | FP-scan a batch of `NEW` alerts |
| POST | `/api/ai/investigate` | auth | Investigation phase (reuses FP-scan triage) |
| GET | `/api/ai/models` | auth | Agent model config + provider groups + local models |
| PATCH | `/api/ai/models/:phase` | step-up | Set the model for an agent phase |
| GET | `/api/ai/agent-stats` | auth | Per-agent confidence / fallback / feedback stats |

### Local LLM (Ollama)
| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/local-llm/config` | auth | Ollama base URL + enabled flag |
| PATCH | `/api/local-llm/config` | step-up | Update base URL / enable local fallback |
| GET | `/api/local-llm/models` | auth | List pulled Ollama models |
| POST | `/api/local-llm/test` | admin | Ping Ollama, return model count |

### Incidents
| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/incidents` | auth | List incidents (filter + status counts) |
| POST | `/api/incidents` | auth | Create an incident from an alert (optional GLPI ticket) |
| GET | `/api/incidents/:id` | auth | One incident (alerts, timeline, actions) |
| PATCH | `/api/incidents/:id` | auth | Update title/severity/status/report_body |
| POST | `/api/incidents/:id/take` | auth | Take ownership |
| PATCH | `/api/incidents/:id/assign` | auth | Assign an owner |
| PATCH | `/api/incidents/:id/phase` | auth | Move to a lifecycle phase |
| POST | `/api/incidents/:id/close` | auth | Close the incident |
| POST | `/api/incidents/:id/timeline` | auth | Add a timeline note |
| GET | `/api/incidents/:id/reasoning` | auth | Reasoning across the incident's alerts |
| POST | `/api/incidents/:id/reclassify-fp` | auth | Reclassify the incident as a false positive |
| POST | `/api/incidents/:id/actions` | auth | Add a response action |
| PATCH | `/api/incidents/:id/actions/:actionId` | auth | Approve / execute / annotate an action |
| DELETE | `/api/incidents/:id/actions/:actionId` | auth | Remove an action |
| POST | `/api/incidents/:id/actions/reorder` | auth | Reorder actions |

### Response actions & logs
| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/response-actions` | auth | All actions joined with their incidents + totals |
| GET | `/api/action-logs` | auth | Integration dispatch logs (filter limit/integration/status) |
| GET | `/api/action-stats` | auth | Dispatch success/fail counts |

### Memory
| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/memory/insights` | auth | Semantic insights (LIKE search + outcome filter) |
| GET | `/api/memory/insights/recent` | auth | Recent insights |
| GET | `/api/memory/iocs` | auth | IOC lookup |
| GET | `/api/memory/iocs/all` | auth | IOC table (search + paginate) |
| GET | `/api/memory/iocs/recent` | auth | Recent IOCs |
| GET | `/api/memory/working/:alertId` | auth | Working memory (planner trace) for an alert |

### Assets & suppression & playbooks
| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/assets` | auth | Asset-context registry |
| POST | `/api/assets` | admin | Upsert an asset |
| DELETE | `/api/assets/:value` | admin | Delete an asset |
| GET | `/api/suppression-rules` | auth | List suppression rules |
| POST | `/api/suppression-rules` | admin | Create a rule |
| PATCH | `/api/suppression-rules/:id` | admin | Update a rule |
| DELETE | `/api/suppression-rules/:id` | admin | Delete a rule |
| GET | `/api/playbooks` | auth | List playbooks |
| POST | `/api/playbooks` | admin | Create a playbook |
| PATCH | `/api/playbooks/:id` | admin | Update a playbook |
| DELETE | `/api/playbooks/:id` | admin | Delete a playbook |

### Analytics, stats & reports
| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/stats` | auth | Dashboard KPIs (active incidents, MTTR, FP rate, …) |
| GET | `/api/stats/trends` | auth | Trend series |
| GET | `/api/analytics/fp-reduction` | auth | FP-reduction summary |
| GET | `/api/analytics/fp-over-time` | auth | FP time series |
| GET | `/api/analytics/noisy-sources` | auth | Noisiest sources (enriched with asset role) |
| GET | `/api/analytics/fp-suggestions` | auth | Suggested suppression / asset registrations |
| POST | `/api/analytics/accept-suggestion` | admin | Promote a suggestion to an asset |
| GET | `/api/analytics/pipeline-funnel` | auth | Pipeline funnel counts |
| GET | `/api/analytics/detection-effectiveness` | auth | Effectiveness by `fp_method` |
| GET | `/api/analytics/source-distribution` | auth | Alert source distribution |
| GET | `/api/reports` | auth | Incident reports (paginate, filter priority) |
| GET | `/api/reports/summary` | auth | Report rollup (volume, priority mix, confidence) |
| POST | `/api/feedback` | auth | Analyst feedback on an agent phase |

### Integrations
| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/integrations` | auth | Notification channels + 24h dispatch stats |
| GET | `/api/integrations/:name` | auth | One integration (incl. LDAP/Wazuh sub-tabs) |
| PATCH | `/api/integrations/:name` | admin | Update config / enabled / auto-send threshold |
| POST | `/api/integrations/:name/test` | admin | Send a test notification |

### Users (self + admin)
| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/users/analysts` | auth | Analyst list (for incident assignment) |
| GET | `/api/users/me/profile` | auth | Own profile |
| PATCH | `/api/users/me/profile` | auth | Update own profile/preferences |
| GET | `/api/users/me/activity` | auth | Own recent activity |
| PATCH | `/api/users/me/password` | auth | Change own password |
| POST | `/api/users/me/sessions/revoke-all` | auth | Revoke all of your own sessions |
| GET | `/api/users` | admin | List users |
| POST | `/api/users` | admin | Create a user (`RETURNING id`) |
| PATCH | `/api/users/:id` | admin | Update a user below your level |
| DELETE | `/api/users/:id` | step-up | Delete a user |
| POST | `/api/users/:id/reset-password` | admin | Admin reset → one-time temp password |

### API keys
| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/api-keys` | admin | List ingest API keys (masked) |
| POST | `/api/api-keys` | admin | Create a key (raw value shown once) |
| PATCH | `/api/api-keys/:id` | admin | Pause / set min-severity override |
| DELETE | `/api/api-keys/:id` | admin | Revoke a key |

### Audit
| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/audit-logs` | admin | Paginated, filtered audit log |
| GET | `/api/audit-logs/actions` | admin | Distinct action types (filter dropdown) |
| GET | `/api/audit-logs/export.csv` | admin | CSV export |

### Admin & governance (`/api/admin/*`)
| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/admin/health` | admin | System / DB / dependency health |
| GET | `/api/admin/permissions` | admin | Full permission matrix |
| GET | `/api/admin/security-policies` | admin | All security policies |
| PATCH | `/api/admin/security-policies/:name` | step-up | Update a policy (password/lockout/ip-allowlist/retention) |
| GET | `/api/admin/failed-logins` | admin | Failed-login dashboard (window + sparkline) |
| GET | `/api/admin/inactive-users` | admin | Inactive users |
| POST | `/api/admin/inactive-users/disable` | step-up | Bulk-disable inactive users |
| POST | `/api/admin/unlock-user/:id` | admin | Unlock a locked account |
| POST | `/api/admin/users/:id/revoke-sessions` | admin | Force-logout a user (bump epoch) |
| POST | `/api/admin/users/:id/temp-role` | step-up | Grant a time-boxed elevated role |
| DELETE | `/api/admin/users/:id/temp-role` | admin | Revoke a temporary role |
| POST | `/api/admin/reset-alerts` | step-up | Reset all alerts to `NEW` |
| POST | `/api/admin/clear-investigation` | step-up | Wipe incidents + active alert queue |
| POST | `/api/admin/clear-fp-archive` | step-up | Wipe the FP archive |
| GET | `/api/admin/llm-providers` | admin | List the LLM provider registry (keys masked) |
| POST | `/api/admin/llm-providers` | step-up | Add a provider (`RETURNING id`) |
| PATCH | `/api/admin/llm-providers/:id` | step-up | Update a provider |
| DELETE | `/api/admin/llm-providers/:id` | step-up | Delete a provider |
| POST | `/api/admin/llm-providers/:id/test` | admin | Test a provider |
| POST | `/api/admin/integrations/ldap/test` | admin | Test an LDAP bind for a username |
| GET | `/api/admin/access-reviews` | admin | List access reviews |
| POST | `/api/admin/access-reviews` | admin | Start a review (snapshots active users) |
| GET | `/api/admin/access-reviews/:id` | admin | One review + items |
| POST | `/api/admin/access-reviews/:id/complete` | admin | Complete a review |
| PATCH | `/api/admin/access-reviews/:id/items/:itemId` | admin | Record a per-user decision |
| GET | `/api/admin/reports/user-roster.csv` | admin | Compliance CSV: user roster |
| GET | `/api/admin/reports/failed-logins.csv` | admin | Compliance CSV: failed logins |
| GET | `/api/admin/reports/admin-actions.csv` | admin | Compliance CSV: admin actions |
| GET | `/api/admin/reports/privileged-coverage.csv` | admin | Compliance CSV: privileged coverage |

### Frontend serving
| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `*` | public | SPA fallback — serves `dist/index.html` (or Vite middleware in dev) |

## 11. Local development setup

Prerequisites: **Node 20+**, **PostgreSQL 14+ with pgvector**, (optional) **Ollama** with
`nomic-embed-text` pulled.

```bash
# 1. Provision PostgreSQL + pgvector (Debian/Ubuntu; needs sudo)
PG_PASSWORD='dev-pw' sudo -E bash scripts/provision-postgres.sh

# 2. Configure env
cp .env.example .env        # set JWT_SECRET, PG*/DATABASE_URL, LLM keys, APP_URL, …

# 3. Install
npm install

# 4. (Optional) migrate legacy SQLite data
SOC_DB_PATH=./soc.db npm run db:migrate

# 5. Run (schema auto-applies; Vite middleware serves the frontend with HMR)
npm run dev                 # http://localhost:3000  (or HTTPS :PORT if certs/ exist)

# 6. Seed demo alerts
npx tsx generate-test-alerts.ts
```

Type-check anytime: `npm run lint` (`tsc --noEmit`).

## 12. Build & deployment

- **Frontend build:** `npm run build` → `dist/`.
- **Run backend:** `npm run start` (serves `dist/`; do not set `USE_VITE_MIDDLEWARE`).
- **TLS:** if `certs/cert.pem` + `certs/key.pem` exist, the server serves **HTTPS** on
  `PORT` (default 3000; commonly 3001); otherwise HTTP. Regenerate certs per
  `TROUBLESHOOTING.md`.
- **Process management:** run under a supervisor (systemd/pm2). Logs in dev go to
  `/tmp/server.log`.
- **Firewall / proxy:** expose the chosen port; the Wazuh forwarder must reach `/api/ingest`
  with its API key.
- Full ops + company handover: [`docs/HANDOVER.md`](./HANDOVER.md).

## 13. Extending the app

| Task | How |
|---|---|
| **Add an API endpoint** | In `server.ts`: `app.METHOD('/api/…', authenticate, [requireRole/requireAdmin], [requireStepUp], async (req,res) => {…})`; query with `await db.prepare('… ?').get/all/run(…)`; add a typed wrapper in `src/services/aiService.ts`. |
| **Add an agent node** | Create `agents/nodes/<name>.ts` (async `(state, model, ctx) => {...}`); register as a worker in `planner.ts` or in the composer sequence in `orchestrator.ts`; add its phase to `agents/config.ts`. No DB migration (output is JSON in `alerts.ai_analysis`). An RCA node fits best as a **composer** (needs intel+correlation evidence). |
| **Add a table / column** | Edit `db/schema.sql`; it applies on next boot (or `psql "$DATABASE_URL" -f db/schema.sql`). For an `IDENTITY` PK insert, use `RETURNING id`. |
| **Add an integration** | Add a sender in `agents/shared/`, a seed row in `integrations`, and dispatch logic in `dispatchActions` (`server.ts`). |
| **Add a permission** | Add to `PERMISSIONS` in `agents/shared/policy.ts` and apply the matching guard on the route. |
| **Add a Socket.IO event** | `io.emit('name', payload)` server-side; subscribe in `App.tsx`. |
| **Change agent models** | Settings UI, or the `agent_settings` table (see `ADMIN_COMMANDS.md`). |

## 14. Testing & verification

There is **no automated test suite yet** — adding one around the data layer and the
`ingest → triage → incident` flow is the top-priority follow-up. Until then:

- `npm run lint` is the primary safety net — the async DB adapter makes most missing
  `await`s a compile error (a `Promise<T>` used as a value fails type-checking).
- The end-to-end smoke checklist in [`docs/MIGRATION-POSTGRES.md`](./MIGRATION-POSTGRES.md) §14.
- `./troubleshoot.sh` health-checks server/port/DB/TLS/env.

## 15. Operations & troubleshooting

- **Logs:** `tail -f /tmp/server.log` (dev).
- **Health / auto-fix:** `./troubleshoot.sh` (diagnose) or `./troubleshoot.sh --fix` (restart).
- **DB inspection / admin recipes:** `ADMIN_COMMANDS.md` (`psql` / `node-pg`).
- **Backup:** `pg_dump -Fc "$DATABASE_URL" -f soc-$(date +%F).dump`; restore with `pg_restore`.
- **Reset DB (destructive):** `./troubleshoot.sh --reset-db` (TRUNCATEs all tables; config
  re-seeds on next start).
- **Reset admin password:** `./troubleshoot.sh --reset-pass` (→ `admin123`).
- More: [`TROUBLESHOOTING.md`](../TROUBLESHOOTING.md).

## 16. Security & known limitations

- Set a strong `JWT_SECRET` in `.env`; production must not rely on the code fallback.
- Integration secrets (Telegram token, GLPI key, LDAP bind password) are stored as plaintext
  JSON in `integrations.config` — protect DB access and `.env`; rotate at handover.
- Rotate the PostgreSQL `aisoc` role password at handover.
- CORS and the Socket.IO origin are permissive (`*`) — tighten for production.
- The Wazuh forwarder script must be versioned/documented separately.
- No automated tests yet (§14). `src/App.tsx` is a large single file — extract components
  over time. JSON columns are `TEXT` and booleans `INTEGER` by design (migration choice) —
  candidates for future `jsonb`/`boolean` normalization.

## 17. Reference

### Environment variables (see `.env.example` for the full list)
| Var | Purpose |
|---|---|
| `JWT_SECRET` | Signs JWTs — must be long, random, company-owned |
| `DATABASE_URL` *or* `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` | PostgreSQL connection |
| `PGPOOL_MAX` | Max pooled connections (default 10) |
| `SOC_DB_PATH` | Legacy SQLite path — **only** used by the ETL |
| `PORT` | HTTP/HTTPS port (default 3000) |
| `APP_URL` | Public app URL (self-links / OpenRouter referer) |
| `TLS_CERT` / `TLS_KEY` | TLS cert/key paths (default `certs/`) |
| `OPENROUTER_API_KEY[_BACKUP[2]]` | OpenRouter keys (seed the provider registry) |
| `GEMINI_API_KEY` | Google Gemini |
| `EMBED_MODEL` | Ollama embedding model (default `nomic-embed-text`) |
| SMTP / MS365 / `TELEGRAM_*` / `GLPI_*` / `MISP_*` / LDAP | Integration credentials |

### npm scripts
| Script | Does |
|---|---|
| `npm run dev` | Server + Vite middleware (HMR), watch mode |
| `npm run start` | Server only (serves `dist/`) |
| `npm run build` | Build the frontend to `dist/` |
| `npm run lint` | `tsc --noEmit` |
| `npm run db:migrate` | One-time SQLite→Postgres ETL |

### Key shared types (`src/types.ts`)
`UserRole`, `ROLE_LEVEL`, `IncidentPhase`, `IncidentStatus`, `IncidentActionStatus`,
`Incident`, `IncidentAction`, `Alert`, `User`, `Integration`, `ActionLog`, `Stats`,
`ReportRow`, `ReportSummary`. The API client `src/services/aiService.ts` re-exports the
request/response shapes per endpoint.

### Documentation map
| Doc | Covers |
|---|---|
| `docs/USER-MANUAL.md` | Operating the platform (analyst/admin) |
| **`docs/DEVELOPER-MANUAL.md`** | This document |
| `docs/MANUAL.md` | Landing index linking both manuals |
| `README.md` | Quick intro + setup |
| `docs/AISOC-product-overview.md`, `SOC_INTELLIGENCE_ARCHITECTURE.md`, `AEGIS_SOC_PLATFORM_DOCUMENTATION.md` | Architecture |
| `docs/features/00-13` | One doc per user-facing feature |
| `docs/diagrams/` | Eraser + PlantUML diagrams (+ `SPEAKER_NOTES.md`) |
| `docs/alert-triage-agent.md`, `threat-intel-agent.md`, `CURRENT_AI_AGENTS_WORKFLOW.md`, `docs/ALGORITHMS.md` | Agent internals & algorithms |
| `docs/MIGRATION-POSTGRES.md` | The SQLite→PostgreSQL+pgvector migration record |
| `docs/HANDOVER.md` | Company handover plan |
| `docs/wazuh-integration.md`, `docs/compliance-mapping.md` | Wazuh setup · NIST/ISO mapping |
| `ADMIN_COMMANDS.md`, `TROUBLESHOOTING.md` | Operational command references |
