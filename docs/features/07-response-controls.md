# Response Controls

## What It Does

The Response Controls system surfaces AI-driven containment recommendations and lets analysts execute them as part of an incident's lifecycle. It includes:

- **Response Agent** — AI-driven containment recommendations (block IP, isolate host, disable user, etc.)
- **Response Actions page** — ranks every persisted action by priority across all open incidents so analysts see the highest-impact work first
- **Incident action lifecycle** — each action moves through `pending → approved → executed | failed | skipped` with timeline audit trail

> **Note (2026-05):** The previous FortiGate / pfSense / Sophos firewall auto-block integration has been removed. The Response Agent still recommends `BLOCK_IP`-style actions, but execution is now manual: analysts approve/execute the action from the Incidents page and apply the change at their firewall using whichever tooling they prefer. The `firewalls` and `firewall_blocks` tables and `/api/firewalls/*` endpoints no longer exist.

---

## Response Agent

The Response Agent (`response` phase) runs during the composer stage of the Hub-and-Swarm pipeline. It receives the full investigation context (triage, intel, correlation) and recommends specific containment actions, which are then **persisted as `incident_actions` rows** when the alert is escalated to an incident.

### Action Types

| Action Type | Description | Target |
|------------|-------------|--------|
| `block_ip` | Block source IP at firewall | IP address |
| `firewall_rule` | Add a perimeter/IDS rule | Rule details / target |
| `isolate_host` | Network-isolate infected host | Hostname |
| `disable_user` | Disable compromised user account | Username |
| `reset_password` | Force credential reset | Username |
| `collect_forensics` | Snapshot disk / memory / logs | Host |
| `escalate` | Page on-call or external responder | Team / handle |
| `other` | Anything outside the canonical set | Free-form |

The agent normalizes LLM-generated action labels to canonical values (e.g. `BLOCK_HOST` → `isolate_host`, `KILL_PROCESS` → maps into `other` with description).

### Output Schema

```typescript
{
  actions: Array<{
    type:      string;   // Canonical action type
    target:    string;   // IP, username, hostname, or null
    reason:    string;   // Why this action is necessary
    priority:  'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    automated: boolean;
  }>;
  approval_required:          boolean;
  estimated_containment_time: string;
  confidence:                 number;   // 0.0–1.0
}
```

---

## Response Actions Page

Top-level navigation (TIER2+). One card per `(action_type, target)` pair, ranked across **all** open incidents.

### Ranking signal

Priority score (0–100) = `0.6 × threat + 0.25 × reach + 0.15 × urgency`, where:

- **Threat** = max(incident severity score, per-action priority hint). CRITICAL = 100, HIGH = 80, MEDIUM = 55, LOW = 30.
- **Reach** = `min(100, distinct_incidents × 25)`. An action needed for 4+ incidents pegs at 100.
- **Urgency** = recency band (60 / 75 / 55 / 35 / 15 for <1h / <6h / <24h / <7d / older), +10 if any pending entries, +15 if any failed.

Cards display the priority score with a donut, a tier badge (CRITICAL / HIGH / MEDIUM / LOW), severity distribution, action-status distribution, the urgency bar, and a chip-row of incident IDs that link directly to the Incidents page (severity-colored, status-tinted).

### Filters

- Search across action type / target / incident id / title
- Category chips (Network / Endpoint / Identity / Monitoring / Other)
- Action type chips (one per emitted type in the current dataset)
- Severity chips (CRITICAL / HIGH / MEDIUM / LOW — applied to *incident* severity)
- Status chips (Pending / Approved / Executed / Failed / Skipped)
- "Hide done" toggle (default ON — drops groups where every entry is executed or skipped)
- Sort by Priority, Threat level, Most incidents, Latest

### Backing endpoint

```
GET /api/response-actions
```

Returns every `incident_actions` row joined with incident metadata (title, severity, phase, status, assigned_to). Drives the page in a single fetch, no per-incident N+1.

---

## Incident Action Lifecycle

Inside the Incidents page → Tasks sub-tab, each action row supports inline edits and a status workflow:

```
pending  ─→ approved  ─→ executed
   │           │            ▲
   │           └─→ failed ──┘  (retry path)
   └─→ skipped
```

Full action CRUD lives under each incident:

```
POST   /api/incidents/:id/actions                — Add a manual action (TIER2+)
PATCH  /api/incidents/:id/actions/:actionId      — Edit fields or change status
DELETE /api/incidents/:id/actions/:actionId      — Remove an action
POST   /api/incidents/:id/actions/reorder        — Re-rank by id[]
```

Each PATCH that changes `status` writes a `note` event to the incident timeline.

---

## Playbooks

Pre-loaded containment playbooks are available for common attack types:

| Tactic | Playbook | Key Steps |
|--------|----------|-----------|
| Credential Access | Brute Force Response | Block IP, lock account, review auth logs, enable MFA |
| Command & Control | C2 Beacon Containment | Isolate host, block C2, capture memory, scan fleet |
| Lateral Movement | Lateral Movement Containment | ID accessed systems, reset creds, segment network |
| Exfiltration | Data Exfiltration Response | Block outbound, preserve logs, notify DPO |
| Privilege Escalation | Priv Esc Remediation | Revoke privileges, audit commands, patch vuln |
| Execution | Malicious Execution Response | Kill process, quarantine file, scan for hash |

### Playbook API
```
GET    /api/playbooks                   # List all playbooks
POST   /api/playbooks                   # Create a playbook (admin only)
DELETE /api/playbooks/:id               # Delete a playbook (admin only)
```

---

## Files Involved

```
agents/nodes/response.ts        ← Response Agent (containment recommendations)
server.ts                       ← Response endpoints (action CRUD, GET /api/response-actions),
                                  incident_actions table, playbooks
src/App.tsx                     ← ResponseActionsTab (ranking page),
                                  IncidentsTab → Tasks sub-tab (per-incident lifecycle)
```
