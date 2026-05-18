# Wazuh Integration Guide — BBS AISOC

This guide explains how to configure a Wazuh Manager to forward alerts in real time to the BBS AISOC platform. Wazuh calls a custom script for each matching alert; the script POSTs the alert JSON to the AISOC ingest endpoint authenticated with an API key you generate inside AISOC.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Wazuh Manager 4.x | Must be on the same network as AISOC |
| AISOC reachable | `https://soar.bbs.lan:3001` accessible from the Wazuh server |
| Admin access to AISOC | Settings → API Keys |
| `curl` on the Wazuh manager | `yum install curl` or `apt install curl` |

---

## Step 1 — Create an API key in AISOC

1. Open AISOC → **Settings** → **API Keys**
2. Enter a name (e.g. `wazuh-manager-prod`) → click **Create Key**
3. **Copy the full key** (`sk_aisoc_...`) — it is shown only once
4. Verify it works from the Wazuh server:

```bash
curl -sk -X POST https://soar.bbs.lan:3001/api/ingest \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: sk_aisoc_YOUR_KEY_HERE" \
  -d '{"rule":{"id":"test-001","description":"connectivity test","level":3},"agent":{"name":"wazuh-manager"},"data":{"srcip":"127.0.0.1"}}'
```

**Expected response:** `{"status":"filtered","reason":"severity 3 below min 7"}`
This confirms the key is valid — the alert was intentionally dropped because level 3 is below the default minimum severity of 7.

---

## Step 2 — Add the integration block to ossec.conf

Edit `/var/ossec/etc/ossec.conf` on the **Wazuh Manager** and add inside `<ossec_config>`:

```xml
<integration>
  <name>custom-aisoc</name>
  <hook_url>https://soar.bbs.lan:3001/api/ingest</hook_url>
  <api_key>sk_aisoc_YOUR_KEY_HERE</api_key>
  <alert_format>json</alert_format>
  <level>7</level>
</integration>
```

| Parameter | Description |
|---|---|
| `<name>custom-aisoc</name>` | Must match the script filename exactly |
| `<hook_url>` | Your AISOC ingest URL |
| `<api_key>` | Your AISOC API key — passed as `$2` to the script |
| `<alert_format>json</alert_format>` | Required — sends JSON, not syslog |
| `<level>7</level>` | Only forward alerts at this Wazuh rule level or above. Should match the Min Severity Level set in AISOC. |

> **Tip:** You can also filter by rule group: `<group>syslog,web,</group>` — only alerts in those groups will be forwarded.

---

## Step 3 — Create the integration script

### Option A — Bash (recommended, simplest)

Create `/var/ossec/integrations/custom-aisoc`:

```bash
#!/usr/bin/env bash
# BBS AISOC — Wazuh custom integration
# Wazuh calls this as: custom-aisoc <alert_file> <api_key> <hook_url>

ALERT_FILE="$1"
API_KEY="$2"
HOOK_URL="$3"

curl -sk \
  -X POST "$HOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $API_KEY" \
  --max-time 10 \
  --retry 2 \
  --data @"$ALERT_FILE" \
  >> /var/ossec/logs/aisoc-integration.log 2>&1

exit 0
```

### Option B — Python (better error logging, handles TLS explicitly)

Create `/var/ossec/integrations/custom-aisoc.py`:

```python
#!/usr/bin/env python3
# BBS AISOC — Wazuh custom integration (Python)
# Wazuh calls this as: custom-aisoc.py <alert_file> <api_key> <hook_url>

import sys
import ssl
import urllib.request
import urllib.error

alert_file = sys.argv[1]
api_key    = sys.argv[2]
hook_url   = sys.argv[3]

LOG = "/var/ossec/logs/aisoc-integration.log"

with open(alert_file) as f:
    payload = f.read().encode()

req = urllib.request.Request(
    hook_url,
    data=payload,
    headers={
        "Content-Type": "application/json",
        "X-Api-Key": api_key,
    },
    method="POST",
)

# AISOC uses a self-signed certificate — disable verification
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

try:
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        body = r.read().decode()
        with open(LOG, "a") as log:
            log.write(f"[AISOC] {r.status} {body}\n")
except urllib.error.URLError as e:
    with open(LOG, "a") as log:
        log.write(f"[AISOC] ERROR: {e}\n")
    sys.exit(1)
```

> If using the Python script, update ossec.conf `<name>` to `custom-aisoc.py`.

---

## Step 4 — Set permissions

Wazuh requires integration scripts to be owned by `root:wazuh` and executable.

```bash
# Bash version
chmod 750 /var/ossec/integrations/custom-aisoc
chown root:wazuh /var/ossec/integrations/custom-aisoc

# Python version (if used)
chmod 750 /var/ossec/integrations/custom-aisoc.py
chown root:wazuh /var/ossec/integrations/custom-aisoc.py
```

---

## Step 5 — Restart Wazuh and verify

```bash
systemctl restart wazuh-manager
```

Check the integration loaded:

```bash
grep -i "custom-aisoc\|integration" /var/ossec/logs/ossec.log | tail -20
```

Watch live output when alerts fire:

```bash
tail -f /var/ossec/logs/aisoc-integration.log
```

**Successful forward:**
```
{"status":"ok","id":"a3f9c2b1d4e5"}
```

**Filtered by severity:**
```
{"status":"filtered","reason":"severity 5 below min 7"}
```

---

## AISOC Filter Settings

All filter options are configurable in **Settings → Integrations → Wazuh → Filter Settings** without touching ossec.conf.

| Setting | Default | Description |
|---|---|---|
| Min Severity Level | `7` | Wazuh `rule.level` minimum (0–15). Alerts below this are dropped. Keep in sync with `<level>` in ossec.conf. |
| Dedup Window (minutes) | `5` | Alerts with the same `rule_id` + `source_ip` within this window are deduplicated. |
| Rate Limit (alerts/min) | `60` | Maximum alerts accepted per minute. Set to `0` to disable. |
| Accept From / Until (HH:MM) | empty | Optional time window. Leave blank for 24/7 ingestion. |
| Auto-run AI pipeline | `true` | Automatically triggers the full triage + investigation swarm on each alert. Set to `false` to ingest silently and analyse manually. |

---

## Alert format reference

AISOC accepts both Wazuh alert formats.

### Flat format (default from custom integration scripts)

```json
{
  "id": "1234567890.12345",
  "rule": {
    "id":          "5710",
    "description": "SSH brute force attempting to get access to the system",
    "level":       10
  },
  "agent": {
    "name": "web-server-01",
    "ip":   "10.0.0.5"
  },
  "data": {
    "srcip":   "203.0.113.45",
    "dstip":   "10.0.0.5",
    "dstuser": "root"
  },
  "full_log": "sshd: Failed password for root from 203.0.113.45 port 51234 ssh2"
}
```

### Wazuh 4.x native format (`_source` wrapper — also accepted)

```json
{
  "_source": {
    "rule":  { "id": "5710", "description": "SSH brute force", "level": 10 },
    "agent": { "name": "web-server-01" },
    "data":  { "srcip": "203.0.113.45" }
  }
}
```

### Field mapping

| Wazuh field | AISOC column | Notes |
|---|---|---|
| `rule.id` | `rule_id` | |
| `rule.description` | `description` | |
| `rule.level` | `severity` | Used for risk score floor |
| `agent.name` | `agent_name`, `hostname` | |
| `data.srcip` or `data.src_ip` | `source_ip` | Both spellings accepted |
| `data.dstip` or `data.dst_ip` | `dest_ip` | Both spellings accepted |
| `data.dstuser` or `data.win.system.subjectUserName` | `user` | Linux + Windows events |
| (full body) | `full_log` | Stored as-is for AI agents |

---

## HTTP response reference

| Response body | HTTP | Meaning |
|---|---|---|
| `{"status":"ok","id":"..."}` | 200 | Alert accepted, AI pipeline triggered |
| `{"status":"filtered","reason":"severity N below min M"}` | 200 | Dropped — below min severity threshold |
| `{"status":"filtered","reason":"outside configured time window"}` | 200 | Dropped — outside ingestion time window |
| `{"status":"deduplicated","original_id":"..."}` | 200 | Duplicate of a recent alert |
| `{"status":"rate_limited","error":"Exceeded N alerts/min"}` | 429 | Rate limit hit — slow down or raise the limit |
| `{"error":"API key required..."}` | 401 | No `X-Api-Key` header sent |
| `{"error":"Invalid or revoked API key."}` | 401 | Wrong key or key was revoked |
| `{"error":"Failed to ingest alert"}` | 500 | Server-side error — check AISOC server log |

---

## Liveness heartbeat (recommended)

Because Wazuh **pushes** to AISOC and we never call back, AISOC can't tell a healthy-but-quiet network apart from a dead Wazuh manager just by watching alert volume. The heartbeat solves that with a tiny one-shot script on the Wazuh box that pings `/api/heartbeat` every 60 s. The Wazuh status pill in the AISOC header turns green / amber / red based on that signal.

### How it differs from `/api/ingest`

| Endpoint | Triggered by | Purpose |
|---|---|---|
| `POST /api/ingest` | Wazuh `<integration>` block on every matching alert | Carries an actual alert payload |
| `POST /api/heartbeat` | systemd timer or cron, every 60 s | Bumps `api_keys.last_heartbeat_at`, nothing else |

Both use the **same API key** — there's no second secret to manage. The heartbeat endpoint accepts an empty body and returns `{ ok: true, paused, at }`.

### 1. Create the heartbeat script on the Wazuh server

Save as `/var/ossec/integrations/aisoc-heartbeat`:

```python
#!/usr/bin/env python3
"""Wazuh -> AISOC heartbeat. Single shot. Run from a timer/cron every 60s."""
import json, os, ssl, sys, urllib.error, urllib.request
from datetime import datetime, timezone

LOG_FILE = "/var/ossec/logs/aisoc-heartbeat.log"

def log(msg):
    with open(LOG_FILE, "a") as f:
        f.write(f"[{datetime.now(timezone.utc).isoformat()}] {msg}\n")

def main():
    url     = os.getenv("AISOC_HEARTBEAT_URL", "").strip()
    api_key = os.getenv("AISOC_API_KEY", "").strip()
    timeout = int(os.getenv("AISOC_TIMEOUT_SEC", "5"))
    verify  = os.getenv("AISOC_VERIFY_TLS", "0").strip().lower() in {"1","true","yes"}
    if not url or not api_key:
        log("ERROR missing AISOC_HEARTBEAT_URL or AISOC_API_KEY"); return 2

    req = urllib.request.Request(url, data=b"{}", method="POST",
        headers={"Content-Type":"application/json","X-Api-Key":api_key,
                 "X-Integration-Forwarder":"aisoc-heartbeat"})
    ctx = ssl.create_default_context()
    if not verify: ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return 0 if 200 <= resp.status < 300 else 1
    except Exception as exc:
        log(f"WARN {exc}"); return 1

if __name__ == "__main__":
    sys.exit(main())
```

```bash
sudo chmod +x /var/ossec/integrations/aisoc-heartbeat
sudo chown root:wazuh /var/ossec/integrations/aisoc-heartbeat
```

### 2. systemd timer (recommended)

`/etc/systemd/system/aisoc-heartbeat.service`:
```ini
[Unit]
Description=AISOC heartbeat
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/aisoc/heartbeat.env
ExecStart=/var/ossec/integrations/aisoc-heartbeat
```

`/etc/systemd/system/aisoc-heartbeat.timer`:
```ini
[Unit]
Description=Run AISOC heartbeat every 60 seconds

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
AccuracySec=5s
Unit=aisoc-heartbeat.service

[Install]
WantedBy=timers.target
```

`/etc/aisoc/heartbeat.env` (chmod 600):
```env
AISOC_HEARTBEAT_URL=https://soar.bbs.lan:3001/api/heartbeat
AISOC_API_KEY=sk_aisoc_YOUR_KEY_HERE
AISOC_VERIFY_TLS=0
AISOC_TIMEOUT_SEC=5
```

Enable:
```bash
sudo mkdir -p /etc/aisoc && sudo chmod 700 /etc/aisoc
# (write heartbeat.env, chmod 600)
sudo systemctl daemon-reload
sudo systemctl enable --now aisoc-heartbeat.timer
sudo systemctl list-timers aisoc-heartbeat.timer
```

### 3. (Tip) Skip DNS for snappier heartbeats

If `aisoc-heartbeat.log` shows repeated "DNS fallback succeeded" lines, each run is paying a multi-second timeout before the POST. Use the IP directly — AISOC's cert TLS-verification is already disabled by the script, so this works fine:

```env
AISOC_HEARTBEAT_URL=https://<aisoc-ip>:3001/api/heartbeat
```

### Status thresholds (UI header pill)

| Pill | Heartbeat age | Meaning |
|---|---|---|
| Green — "Wazuh: Live" | < 5 min | Forwarder is healthy |
| Amber — "Wazuh: Lagging Xm ago" | 5–10 min | Multiple beats missed, transient issues |
| Red — "Wazuh: Offline" | > 10 min, OR no active API key | Definitive failure |
| Slate — "Wazuh: Awaiting events" | Heartbeat never configured AND ingest also quiet | Honest "we don't know" state |

If the script is configured but the pill still says Offline immediately after enabling, check:
- The browser was hard-refreshed (the header polls every 30 s, but the bundle must be current)
- `last_heartbeat_at` is non-null: `SELECT MAX(last_heartbeat_at) FROM api_keys`
- The timestamp the API returns ends with `Z` (server normalizes SQLite's space-separated format to ISO+Z to avoid browser timezone mis-parsing)

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Integration error: 401` in ossec.log | Wrong API key | Re-check `<api_key>` in ossec.conf matches the key shown in AISOC |
| `Integration error: 000` or connection timeout | AISOC unreachable | Run the connectivity test curl from the Wazuh server (Step 1) |
| No alerts appearing in AISOC | Level filter | Lower `<level>` in ossec.conf or lower Min Severity in AISOC settings |
| `Permission denied` when script runs | Wrong file permissions | `chmod 750` + `chown root:wazuh` on the script |
| `No such file or directory` | Wrong script name | Script must be named exactly `custom-aisoc` (bash) or `custom-aisoc.py` (python) — no other extension |
| All alerts show `{"status":"filtered"}` | min_severity too high | Lower Min Severity Level in Settings → Integrations → Wazuh |
| `{"status":"rate_limited"}` responses | Too many alerts | Raise Rate Limit in AISOC settings, or increase `<level>` in ossec.conf to reduce volume |

### Check Wazuh integration log

```bash
# Integration output (AISOC responses)
tail -50 /var/ossec/logs/aisoc-integration.log

# Wazuh manager log (script launch errors)
grep -i "integration\|custom-aisoc\|error" /var/ossec/logs/ossec.log | tail -30
```

### Quick connectivity test from the Wazuh server

```bash
curl -sk -X POST https://soar.bbs.lan:3001/api/ingest \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: sk_aisoc_YOUR_KEY" \
  -d '{"rule":{"id":"test-001","description":"connectivity test","level":3},"agent":{"name":"wazuh-manager"},"data":{"srcip":"127.0.0.1"}}'
# Expected: {"status":"filtered","reason":"severity 3 below min 7"}
# ✓ key valid   ✗ {"error":"Invalid or revoked API key."} = wrong key
```
