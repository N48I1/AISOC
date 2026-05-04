# Response Controls & Firewall Integration

## What It Does

The Response Controls system enables automated and semi-automated containment actions in response to security incidents. It includes:

- **Response Agent** — AI-driven containment recommendations (block IP, isolate host, disable user)
- **Firewall Integration** — direct API integration with FortiGate, pfSense, and Sophos XG firewalls
- **Auto-blocking** — automatic IP blocking on enabled firewalls when the Response Agent recommends BLOCK_IP
- **Manual controls** — UI for manually blocking/unblocking IPs on any configured firewall

---

## Response Agent

The Response Agent (`response` phase) runs during the composer stage of the Hub-and-Swarm pipeline. It receives the full investigation context (triage, intel, correlation) and recommends specific containment actions.

### Action Types

| Action Type | Description | Target |
|------------|-------------|--------|
| `BLOCK_IP` | Block source IP at firewall | IP address |
| `DISABLE_USER` | Disable compromised user account | Username |
| `ISOLATE_HOST` | Network-isolate infected host | Hostname |
| `QUARANTINE_FILE` | Quarantine malicious file | File path |
| `RESET_PASSWORD` | Force credential reset | Username |
| `NOTIFY_TEAM` | Alert the SOC team | Team name |

### Output Schema

```typescript
{
  actions: Array<{
    type:      string;   // One of the action types above
    target:    string;   // IP, username, hostname, or file path
    reason:    string;   // Why this action is necessary
    priority:  number;   // Execution priority (1 = highest)
    automated: boolean;  // Whether it can run without approval
  }>;
  approval_required:          boolean;
  estimated_containment_time: string;   // e.g., "15 minutes"
  confidence:                 number;   // 0.0-1.0
}
```

The agent normalizes LLM-generated action types to canonical values. For example, `BLOCK_HOST` maps to `ISOLATE_HOST`, `KILL_PROCESS` maps to `QUARANTINE_FILE`.

---

## Firewall Integration

### Supported Firewalls

| Firewall | API Type | Auth Method | Strategy |
|----------|----------|-------------|----------|
| **FortiGate** | FortiOS REST API v2 | API Token | Creates address objects, adds to block group `BBS-AISOC-Blocked` |
| **pfSense** | REST API (jaredhendrickson13) | Client ID + Token | Adds IPs to alias `BBS_AISOC_Blocked` |
| **Sophos XG** | XML API (port 4444) | Username + Password | Creates IP Host objects |

### Auto-Blocking

When the orchestrator completes an investigation and the Response Agent has recommended `BLOCK_IP` actions:

1. The system finds all firewalls with `enabled = 1` AND `auto_block = 1`
2. For each firewall and each recommended IP, it calls the firewall API to block
3. Results are logged in `firewall_blocks` table and `action_logs`
4. The UI updates in real-time via Socket.IO

### Manual Blocking

From the UI or API, analysts can:
- Block an IP on any configured firewall
- Unblock a previously blocked IP
- View all active blocks per firewall
- Test firewall connectivity (uses RFC 5737 test IP 192.0.2.1)

---

## API Endpoints

### Firewall CRUD
```
GET    /api/firewalls                    # List all firewalls with active block counts
POST   /api/firewalls                    # Add a firewall (admin only)
PATCH  /api/firewalls/:id               # Update settings (admin only)
DELETE /api/firewalls/:id               # Remove firewall (admin only)
```

### Firewall Actions
```
POST   /api/firewalls/:id/test          # Test connectivity (admin only)
POST   /api/firewalls/:id/block         # Block an IP
POST   /api/firewalls/:id/unblock       # Unblock an IP (admin only)
GET    /api/firewalls/:id/blocks        # List all blocks for a firewall
```

### Firewall Configuration

When creating a firewall, provide:

```json
{
  "name": "Main FortiGate",
  "type": "fortigate",
  "enabled": true,
  "auto_block": true,
  "config": {
    "url": "https://192.168.1.1",
    "api_token": "your_fortigate_api_token",
    "group_name": "BBS-AISOC-Blocked"
  }
}
```

Config keys vary by firewall type:
- **FortiGate**: `url`, `api_token`, `group_name` (optional, defaults to `BBS-AISOC-Blocked`)
- **pfSense**: `url`, `client_id`, `client_token`, `alias` (optional, defaults to `BBS_AISOC_Blocked`)
- **Sophos XG**: `url`, `username`, `password`

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
GET    /api/playbooks                    # List all playbooks
POST   /api/playbooks                    # Create a playbook (admin only)
DELETE /api/playbooks/:id               # Delete a playbook (admin only)
```

---

## Files Involved

```
agents/nodes/response.ts        ← Response Agent (containment recommendations)
agents/shared/firewall.ts       ← Firewall API clients (FortiGate, pfSense, Sophos)
server.ts                       ← Firewall CRUD, block/unblock, playbook endpoints
src/App.tsx                     ← ResponseControls, Firewall management UI
```
