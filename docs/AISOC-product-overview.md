# AISOC — AI-Powered Security Operations Center

> A multi-agent platform that triages, investigates, and routes security alerts so SOC analysts only see what genuinely matters.

---

## The Problem

A typical mid-size SOC receives **5,000–50,000 alerts per day**. Industry research consistently shows:

- **70–95% of alerts are false positives**
- The average analyst spends **30+ minutes per alert** during initial triage
- **45% of real incidents go uninvestigated** because of alert fatigue
- Analyst burnout drives **>20% annual turnover** in SOC roles

The cost of this is measured in two ways: missed breaches that could have been caught, and the salary of expensive analysts spending their day on noise that an algorithm could have filtered. AISOC addresses both.

---

## What AISOC Is

A self-hosted platform that sits between your SIEM (Wazuh today, Splunk/Sentinel/Elastic next) and your analysts. It receives raw alerts, runs them through a defense-in-depth pipeline of seven specialized AI agents, and produces one of two outcomes:

1. **False positive** → silently archived to a searchable FP archive with a clear reason
2. **Real incident** → routed to the Incidents tab with a complete report, MITRE mapping, recommended actions, and a Telegram/Slack/email notification fired in real time

The analyst opens their console in the morning and sees only the alerts that need a human. Everything else has already been handled.

---

## Core Innovation: 9-Layer Defense-in-Depth FP Reduction

The thing that makes AISOC actually work — not just demo well — is that no single layer decides "false positive" alone. Every alert passes through nine independent filters, in order, each with a different mechanism:

| # | Layer | Mechanism | Example catch |
|---|---|---|---|
| 1 | Severity filter | Deterministic threshold | Wazuh level < 3 → archive |
| 2 | Time-window filter | Deterministic schedule | Alerts outside business hours → archive |
| 3 | Suppression rules | Pattern matching | Known maintenance window pattern → archive |
| 4 | Memory short-circuit | Embedding similarity (≥ 0.85) | "I've seen this exact alert before and it was FP" → archive |
| 5 | Asset fast-FP | Deterministic graph match | All sources are known scanners + no high-risk keywords → archive without LLM cost |
| 6 | Triage LLM | Multi-signal reasoning | Agent classifies as FP based on combined evidence |
| 7 | Confidence aggregator | Ensemble math: `0.45·triage + 0.20·asset + 0.15·iocFpRatio + 0.20·recallSimilarity` | Score ≥ 0.55 → archive |
| 8 | Risk-score gate | Computed risk score | `risk_score < 40` → archive (catches LLM priority overconfidence) |
| 9 | Priority gate | Final rule | LOW or MEDIUM priority → archive (only HIGH/CRITICAL reach analysts) |

Each filter writes its `fp_method` to the database, so analysts can audit exactly which layer caught what — and tune individual thresholds.

---

## Feature Walkthrough

### 1. Multi-Agent Investigation Pipeline

Built on **LangGraph** with a planner-worker pattern. Seven specialized agents:

- **Triage Agent** — Initial classification, IOC extraction, FP detection
- **Threat Intel Agent** — MITRE ATT&CK mapping, threat actor inference
- **Knowledge Agent** — Pulls relevant playbooks via RAG, suggests remediation
- **Correlation Agent** — Detects multi-alert campaigns within 72-hour windows
- **Ticketing Agent** — Generates structured incident reports with priority
- **Response Agent** — Recommends containment actions (block IP, disable account, etc.)
- **Validation Agent** — Final SLA and completeness check

The planner dynamically decides which agents to dispatch based on the alert. A clear FP doesn't waste tokens on threat intel; a complex multi-host attack gets the full chain.

### 2. Knowledge Base

A unified workspace exposing the system's institutional memory:

- **Playbooks** — Hand-authored response procedures indexed by MITRE tactic. Editable in-place.
- **Indexed Incidents** — Every past investigation auto-stored with a 768-dim embedding (Ollama `nomic-embed-text`) for semantic recall on future alerts.
- **IOC Memory** — Every IP, domain, hash, and user the system has ever seen, with cumulative FP/TP scoring and a visual ratio bar.

The agents use this memory automatically during recall pre-flight. Analysts use the UI to audit what the system has learned and to tune asset context.

### 3. Real-Time Integrations

| Integration | Purpose | Status |
|---|---|---|
| **Wazuh** | Primary alert source via webhook + 60s liveness heartbeat | Production |
| **Telegram** | Real-time incident notifications | Production |
| **Slack** | Incoming webhook alerts to channels | Production |
| **Email (SMTP)** | Incident emails with full report | Production |
| **GLPI** | Helpdesk ticket creation for escalations | Production |
| **LDAP / AD** | SSO for analyst login with auto-provisioned local mirror accounts | Production |

Notifications are gated by configurable priority threshold. Telegram on CRITICAL only, email on HIGH+, etc. Each integration has a Test button and a 24-hour stats panel.

### 4. Auto-Investigate on Arrival

Toggle on the dashboard: when a Wazuh alert arrives, the full agent pipeline kicks off automatically. Analysts watching the live alert stream see real-time toast updates:

```
Alert arrived → "Auto-investigating..."
3-30 seconds later → "Real incident detected — Telegram sent" or "Auto-archived as FP"
```

When off, alerts queue at status `NEW` for manual scanning via the "Scan All" button.

### 5. Analytics & Reporting

- **Pipeline Funnel** — Visual breakdown of alerts → filtered → triaged → escalated
- **FP Reduction Trend** — 30-day timeline of FPs caught by each method
- **Noisy Sources** — IPs/agents generating the most FPs (candidates for asset registry)
- **Detection Effectiveness** — Hit-rate per fp_method (which layers are most productive)
- **Reports Tab** — Searchable archive of every incident report with priority, confidence, MITRE tags, and dispatch history

### 6. Admin & Ops

- **API key management** — Per-key pause, per-key min severity override
- **Alert ingestion controls** — Global on/off, severity threshold, rate limiting, deduplication window, active hours, auto-orchestrate toggle
- **AI model configuration** — Per-agent model assignment with OpenRouter + local Ollama support
- **Model fallback** — Backup keys, automatic retry on rate limits
- **Suppression rule editor** — Pattern-based deterministic filters
- **Asset registry** — Mark known scanners/monitoring/backup hosts as `fp_default=1`
- **Clear Queue / Clear Archive** — Admin reset buttons for testing
- **Audit log** — Every admin action recorded

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Wazuh Manager (or any SIEM)                                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ POST /api/ingest (X-Api-Key)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Express + Socket.IO  (TLS, auth, rate limit, dedup)            │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  9-Layer FP Reduction Pipeline (LangGraph)             │    │
│  │  ─────────────────────────────────────                 │    │
│  │  Suppression → Memory → Asset Fast-FP → Triage LLM →   │    │
│  │  Confidence Agg → Risk-Score Gate → Priority Gate →    │    │
│  │  Composers (ticket, response, validation)              │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌──────────────────────────┐   ┌──────────────────────────┐  │
│  │  Memory Modules          │   │  Integration Dispatcher  │  │
│  │  - ioc_memory            │   │  - Telegram              │  │
│  │  - incident_insights     │   │  - Slack                 │  │
│  │  - asset_context         │   │  - Email (SMTP)          │  │
│  │  - working_memory        │   │  - GLPI                  │  │
│  │  - suppression_rules     │   │  - LDAP / AD SSO         │  │
│  └──────────────────────────┘   └──────────────────────────┘  │
└──────────────────────┬─────────────────────────┬────────────────┘
                       │                         │
                       ▼                         ▼
              ┌─────────────────┐       ┌─────────────────┐
              │  SQLite (WAL)   │       │  Ollama         │
              │  + JSON columns │       │  (embeddings)   │
              └─────────────────┘       └─────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  React + Tailwind Frontend                                      │
│                                                                 │
│  Dashboard │ Noise Filter │ FP Archive │ Reports │              │
│  Knowledge Base │ Incidents │ Response Actions │ Integrations   │
│  │ Settings                                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

**Backend**
- Node.js + Express + Socket.IO
- TypeScript (strict mode)
- SQLite via `better-sqlite3` with WAL mode
- LangChain + LangGraph for agent orchestration
- Zod for structured LLM output validation

**AI / ML**
- OpenRouter for cloud LLMs (GPT-OSS 120B, Llama 3.3, Gemma, Nemotron, etc.)
- Local Ollama support (nomic-embed-text for embeddings, Qwen/Mistral for fallback inference)
- Cosine similarity over BLOB-stored embeddings for semantic recall

**Frontend**
- React 18 + TypeScript
- Tailwind CSS with CSS variable theming (light/dark mode)
- Vite build pipeline
- Lucide icons

**Auth & Security**
- JWT-based session auth
- API key authentication for ingest (separate from session)
- bcrypt password hashing
- Per-route admin-only middleware
- Audit logging for all admin actions

---

## Use Cases

### Primary
- **MSPs / MSSPs** monitoring multiple SMB clients running Wazuh — reduce hours-per-client by automating tier-1 triage
- **Internal security teams** drowning in Wazuh alert volume — focus analysts on the 5–10% that matter
- **Security researchers** wanting a self-hosted, transparent alternative to opaque AI SOC clouds

### Secondary
- **CTF / red team validation** — see whether attack patterns get caught by which layer
- **Detection engineering labs** — measure FP rate of new detection rules end-to-end
- **Compliance demos** — show auditors a complete chain of custody from raw alert → archived FP / escalated incident

---

## What Sets It Apart

Most AI-SOC tools are black boxes: an alert goes in, a verdict comes out, and you trust it. AISOC is **observable by design**:

- Every FP verdict carries the exact `fp_method` that produced it (asset_fast, memory, triage, confidence_aggregated, etc.)
- Every agent's reasoning trace is stored in `working_memory` for the analyst to inspect
- The aggregator's score breakdown is visible (`triage=0.40 asset=0.60 ioc=0.30 recall=0.78 → 0.59`)
- The semantic recall match is shown with similarity score and the past incident it matched
- Memory writes are auditable (commit time, triggered_by phase, embedding presence)

This matters because security teams refuse to deploy black-box tools in detection paths. AISOC lets them tune individual layers based on observed false-negative or false-positive patterns.

---

## Project Status

**Current state: working MVP with all 9 FP-reduction layers operational.**

Verified end-to-end test results from a clean database:

| Alerts sent | Outcome | Routed to | Telegram fired |
|---|---|---|---|
| 5 attack alerts (severity 11–15, attack TTPs) | TRIAGED — 5 real incidents | Incidents tab | Yes (5 messages) |
| 5 noise alerts (severity 2–8, scanners/dpkg/backup) | FALSE_POSITIVE | FP archive | No (correctly suppressed) |

100% precision and recall on the test set. All five filtering methods (`memory`, `triage`, `asset_fast`, `confidence_aggregated`, `noise_priority`) caught alerts during the test.

---

## What's Documented

The `docs/features/` directory contains deep-dives on each subsystem:

- `00-overview.md` — High-level architecture
- `01-hub-and-swarm-orchestration.md` — How the agents are sequenced
- `02-alert-triage-investigation.md` — Triage agent internals
- `03-false-positive-reduction.md` — FP pipeline mathematics
- `04-noise-reduction-analytics.md` — Analytics endpoints
- `05-mitre-threat-intel.md` — MITRE ATT&CK mapping
- `06-incident-reports.md` — Report structure and templating
- `07-response-controls.md` — Response agent and integrations
- `08-notifications-integrations.md` — Telegram/Slack/Email/GLPI
- `09-agent-evaluation.md` — Per-agent metrics
- `10-memory-system.md` — All five memory tiers
- `11-knowledge-base.md` — Knowledge Base UI
- `12-knowledge-base-workflow.md` — Diagram-ready workflow specs

---

## Quick Start

```bash
# Clone and install
git clone <repo>
cd AISOC
npm install

# Configure (set OpenRouter key + JWT secret)
cp .env.example .env
$EDITOR .env

# Run
npm run dev   # backend + frontend with hot reload
# Browse to https://localhost:3001

# Default admin: admin / admin123  (change on first login)

# Send a test alert
curl -X POST https://localhost:3001/api/ingest \
  -H "X-Api-Key: <create-key-in-Settings-tab>" \
  -H "Content-Type: application/json" \
  -d '{"rule":{"id":"60106","level":13,"description":"Lateral Movement: SMB Pass-the-Hash"},"agent":{"name":"DC-01"},"data":{"srcip":"203.0.113.50"}}'
```

Within 30–90 seconds, you'll see the alert classified, a full incident report generated, and (if configured) a Telegram message arrive.
