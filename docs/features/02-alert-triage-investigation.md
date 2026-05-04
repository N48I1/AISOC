# Alert Triage & Investigation

## What It Does

The Alert Investigation tab is the primary analyst workspace. It shows a real-time queue of security alerts ingested from Wazuh, lets analysts run AI agents on any alert, and provides a detailed breakdown of the AI's reasoning — including IOC extraction, risk scoring, MITRE mapping, and recommended actions.

---

## Alert Lifecycle

```
NEW  →  ANALYZING  →  TRIAGED / FALSE_POSITIVE / ESCALATED  →  CLOSED
```

1. **NEW**: Alert just ingested, no AI analysis yet
2. **ANALYZING**: Agent swarm is currently processing
3. **TRIAGED**: AI completed analysis, awaiting analyst review
4. **FALSE_POSITIVE**: AI (or analyst) confirmed this is benign
5. **ESCALATED**: High severity, requires immediate attention
6. **CLOSED**: Analyst has resolved the alert

---

## Alert Ingestion

Alerts enter the system via:

```
POST /api/ingest
Content-Type: application/json

{
  "rule": { "id": "5710", "description": "SSH Brute Force", "level": 10 },
  "agent": { "name": "web-server-01" },
  "data": { "srcip": "185.220.101.47", "dstuser": "root" },
  "full_log": "Apr 24 10:16:05 web-server-01 sshd[3810]: Failed password..."
}
```

The server:
1. Generates a UUID for the alert
2. Parses rule level as severity, extracts source_ip, dest_ip, user, hostname, agent_name
3. Stores in the `alerts` table with status `NEW`
4. Broadcasts `new_alert` via Socket.IO to all connected frontends

---

## Investigation UI

The Alert Investigation tab has two panels:

### Left Panel: Alert Queue
- Filterable by status (NEW, TRIAGED, FALSE_POSITIVE, etc.)
- Searchable by description, IP, agent name
- Each alert row shows:
  - Risk score (or severity level if not yet analyzed)
  - Description
  - Agent progress bar (9 colored segments for each agent phase)
  - Timestamp and source IP

### Right Panel: Alert Detail
When you select an alert, the detail pane shows:

- **Header**: Risk score, severity badge, status, alert ID
- **AI Summary**: The triage agent's analysis summary
- **Agent Pipeline**: Expandable cards for each agent phase showing:
  - Status (completed/skipped/pending)
  - Confidence score
  - Key findings
  - Raw agent logs (the AI's "thought process")
- **IOCs**: Extracted indicators (IPs, domains, hashes, users, files)
- **MITRE ATT&CK**: Mapped techniques
- **Actions**: Run agents, escalate, close, mark as FP, generate report

---

## Running Agents

### Run All Agents
Click "Run Agents" to trigger the full Hub-and-Swarm orchestration. The UI updates in real-time as each agent completes.

### Run Individual Agent
In the Agent Evaluation tab, you can run a single agent phase on any alert for testing/debugging.

---

## Files Involved

```
src/App.tsx                     ← AlertsTab, AlertRow, AlertDetail components
src/services/aiService.ts       ← orchestrateAnalysis(), runAgentPhase()
src/features/alerts/alertUtils.ts ← parseAlertAi(), getAlertRiskScore()
src/types.ts                    ← Alert type definition
server.ts                       ← GET /api/alerts, PATCH /api/alerts/:id,
                                   POST /api/ai/orchestrate
agents/orchestrator.ts          ← runHubAndSwarm()
```

---

## Test Data

Seed realistic test alerts:

```bash
npx tsx seed-test-alerts.ts      # 14 alerts: campaigns, FPs, independent threats
npx tsx seed-scanner-alerts.ts   # 18 alerts: scanner FPs, noise, real attacks
npx tsx generate-test-alerts.ts  # 12 alerts sent via /api/ingest (server must be running)
```
