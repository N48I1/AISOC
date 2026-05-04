# Aegis SOC Platform — Feature Documentation

## About This Folder

This `docs/features/` directory contains one Markdown file per major platform feature. Each document explains:

- **What the feature does** (from an analyst's perspective)
- **How it works** under the hood (architecture, data flow)
- **Which files are involved** (so developers know where to look)
- **How to use it** (step-by-step instructions)

---

## Feature Index

| # | Feature | File | Description |
|---|---------|------|-------------|
| 1 | [Hub-and-Swarm Orchestration](./01-hub-and-swarm-orchestration.md) | `01-hub-and-swarm-orchestration.md` | The core AI pipeline — how the planner dispatches agents dynamically |
| 2 | [Alert Triage & Investigation](./02-alert-triage-investigation.md) | `02-alert-triage-investigation.md` | Ingesting, triaging, and investigating alerts from the UI |
| 3 | [False Positive Reduction](./03-false-positive-reduction.md) | `03-false-positive-reduction.md` | Memory-driven FP detection: suppression rules, asset registry, auto-learning |
| 4 | [Noise Reduction Analytics](./04-noise-reduction-analytics.md) | `04-noise-reduction-analytics.md` | Dashboard for measuring FP rates, noisy sources, and time saved |
| 5 | [MITRE ATT&CK & Threat Intel](./05-mitre-threat-intel.md) | `05-mitre-threat-intel.md` | MITRE mapping, MISP enrichment, and the intelligence tab |
| 6 | [Incident Reports & Export](./06-incident-reports.md) | `06-incident-reports.md` | Generating and exporting incident reports (PDF, XML, TXT, Markdown) |
| 7 | [Response Controls & Firewall](./07-response-controls.md) | `07-response-controls.md` | Containment actions, firewall integration, and automated blocking |
| 8 | [Notifications & Integrations](./08-notifications-integrations.md) | `08-notifications-integrations.md` | GLPI ticketing, Telegram alerts, email notifications |
| 9 | [Agent Evaluation & Model Config](./09-agent-evaluation.md) | `09-agent-evaluation.md` | Per-agent confidence tracking, fallback monitoring, model hot-swapping |
| 10 | [Memory System](./10-memory-system.md) | `10-memory-system.md` | Semantic recall, IOC history, working memory, and insight storage |

---

## Quick Start

1. Start the server: `npm run dev`
2. Open `http://localhost:3000` and log in (`admin` / `admin123`)
3. Seed test data: `npx tsx seed-test-alerts.ts && npx tsx seed-known-assets.ts && npx tsx seed-scanner-alerts.ts`
4. Navigate to **Alert Investigation** and click "Run Agents" on any alert
5. Check **Noise Reduction** tab to see FP analytics
