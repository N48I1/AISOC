# BBS AISOC — Troubleshooting Guide

## Quick Fix (run this first)

```bash
cd /home/nelhilali/AISOC
bash troubleshoot.sh
```

The script auto-diagnoses and fixes the most common problems.

---

## Symptom Checklist

### "App won't load / blank page / can't connect"

**1. Is the server running?**
```bash
ps aux | grep "tsx" | grep -v grep
```
If no output → server is dead. Start it:
```bash
cd /home/nelhilali/AISOC
npm run dev > /tmp/server.log 2>&1 &
sleep 6 && tail -10 /tmp/server.log
```

**2. Is the right port in use?**
```bash
ss -tlnp | grep 3001
```
Expected: `LISTEN 0 ... *:3001`

If port 3001 is taken by something else:
```bash
ss -tlnp | grep 3001
# find the PID and kill it, then restart
```

**3. Hard-refresh the browser**
The browser caches aggressively. After any server restart do:
- **Linux/Windows**: `Ctrl + Shift + R`
- **Mac**: `Cmd + Shift + R`
- Or open an **Incognito / Private** window

**4. Check the server log for crash details**
```bash
tail -40 /tmp/server.log
```

---

### "White screen / JavaScript error in browser"

Open **DevTools → Console** (`F12`). Common errors:

| Error | Fix |
|---|---|
| `Failed to fetch` | Server is down — restart it |
| `Unauthorized` | Session expired — log out and log back in (`admin` / `admin123`) |
| `SyntaxError` or `Cannot read properties` | Frontend built wrong — run `npm run build` then restart |
| `CERT_INVALID` or SSL warning | Accept the self-signed cert at `https://soar.bbs.lan:3001` |

---

### "Login fails (Invalid credentials)"

Default credentials: **`admin`** / **`admin123`**

If those don't work, reset via Node:
```bash
node -e "
require('dotenv').config();
const pg = require('pg');
const bcrypt = require('bcryptjs');
const pool = new pg.Pool();
const hash = bcrypt.hashSync('admin123', 10);
pool.query('UPDATE users SET password = $1 WHERE username = $2', [hash, 'admin'])
  .then(() => { console.log('Password reset to admin123'); return pool.end(); });
"
```

---

### "Alerts not showing up / alert count is 0"

The demo alerts are re-seeded on every server restart. Just restart:
```bash
kill -9 $(pgrep -f "tsx.*server") 2>/dev/null
sleep 1
npm run dev > /tmp/server.log 2>&1 &
```

To manually check what's in the DB:
```bash
psql "$DATABASE_URL" -c "SELECT status, COUNT(*) AS n FROM alerts GROUP BY status;"
```

---

### "Noise Filter shows 0 unscanned alerts"

Unscanned alerts need `status = 'NEW'`. The 8 FP-candidate demo alerts are reset to `NEW` on every server restart. Simply restart the server (see above) — they come back automatically.

---

### "AI agents fail / orchestration hangs"

**Check API keys:**
```bash
grep -E "OPENROUTER_API_KEY|BACKUP_KEY" .env | cut -c1-40
```

**Check rate limits in the server log:**
```bash
grep "rate-limit\|429\|quota" /tmp/server.log | tail -10
```
Rate limits on the free-tier planner model are normal — the swarm falls back to defaults automatically.

**Check local LLM (Ollama):**
```bash
curl -s http://localhost:11434/api/tags | python3 -m json.tool | grep name
```

---

### "Database errors / migration failed"

The database is PostgreSQL (database `soc`). The schema (`db/schema.sql`) is applied automatically on startup; connection comes from the `PG*`/`DATABASE_URL` vars in `.env`.

Check connectivity:
```bash
psql "$DATABASE_URL" -c "SELECT 'DB OK';" || echo "DB connection failed — check PG* vars in .env and that PostgreSQL is running (sudo systemctl status postgresql)"
```

To wipe all data (core config — users, integrations, playbooks, agent models — re-seeds on the next start; demo alerts can be re-sent with `npx tsx generate-test-alerts.ts`):
```bash
# WARNING: deletes all alert history, memory, and user accounts
psql "$DATABASE_URL" -c "TRUNCATE users, alerts, incidents, incident_alerts, audit_logs, agent_runs, feedback, action_logs, working_memory, incident_insights, incident_reasoning, incident_timeline, incident_actions, playbooks, ioc_memory, asset_context, suppression_rules, agent_settings, integrations, local_llm_config, llm_providers, api_keys, password_history, access_reviews, access_review_items RESTART IDENTITY CASCADE;"
npm run dev > /tmp/server.log 2>&1 &
```

---

### "TLS / HTTPS certificate error"

The app uses a self-signed cert for `soar.bbs.lan`. Browsers will warn the first time.

**To accept it:** click "Advanced → Proceed to soar.bbs.lan (unsafe)" in Chrome, or "Accept the Risk" in Firefox.

If the certs are missing or expired:
```bash
ls -la certs/
# Regenerate:
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem -out certs/cert.pem \
  -days 365 -subj "/CN=soar.bbs.lan" \
  -addext "subjectAltName=DNS:soar.bbs.lan,DNS:localhost,IP:127.0.0.1"
```

---

### "Port 3001 blocked by firewall"

If you can reach `http://localhost:3001` but not `https://soar.bbs.lan:3001`:
```bash
sudo ufw status
sudo ufw allow 3001/tcp
```

---

### "Risk & Pipeline Over Time chart looks flat / only covers the last ~24h"

**How the chart is fed (current design).** The *Risk & Pipeline Over Time* widget is populated by the server endpoint **`GET /api/stats/risk-series?granularity=hours|days|months|years`** (`server/server.ts`). It aggregates the **full `alerts` table** into evenly-spaced buckets with a single `generate_series` + `FILTER` query, reconstructing the state "as of" each bucket end from current status + the resolution timestamp `COALESCE(closed_at, filtered_at)`. `DashboardTab.tsx` fetches it on mount and whenever the granularity selector changes, and overlays the live global-risk score on the most-recent bucket so "now" matches the Global Risk donut.

> **History note.** This chart used to be computed **client-side** from the in-memory `alerts` array, which only ever holds the **100 most-recent alerts** (`/api/alerts?pageSize=100`). On a busy sensor (~200–400 alerts/day) those 100 rows span only a few hours, so every bucket older than "today" was empty and plotted as risk 0 — making the line look like it only covered the last 24h. The server-side endpoint fixed this. The old `Total alerts` series (a cumulative count capped at the 100-row load limit) was replaced with **`New alerts`** (count per bucket).

**If the line is genuinely flat at 100 for recent buckets** — that's not a bug. Risk = `activeCritical*5 + activeHigh*2 + activeMedium + escalated*2`, clamped to 100. A backlog of unresolved high/critical alerts (status `ESCALATED`/`TRIAGED`, never closed) drives the raw score well past 100. Check the active backlog:
```bash
psql "$DATABASE_URL" -tAc \
  "SELECT status, count(*) FROM alerts
    WHERE status NOT IN ('FALSE_POSITIVE','FP_CONFIRMED','FILTERED','CLOSED')
      AND severity >= 10 GROUP BY status ORDER BY 2 DESC;"
```
The score drops as those alerts are closed; it is not rescaled here.

**If older buckets are unexpectedly empty**, confirm the raw data and the endpoint:
```bash
psql "$DATABASE_URL" -tAc "SELECT count(*), min(timestamp), max(timestamp) FROM alerts;"
curl -sk "https://localhost:3001/api/stats/risk-series?granularity=days" \
  -H "Authorization: Bearer <jwt>" | head
```
Note: historical "active as of day" uses each alert's *current* status (there is no per-alert status history), so reclassified alerts are reflected at their current state across the whole window.

---

## Useful One-liners

```bash
# Show server log live
tail -f /tmp/server.log

# Show all alert statuses
psql "$DATABASE_URL" -c "SELECT status, count(*) n FROM alerts GROUP BY status;"

# Show asset_context table
psql "$DATABASE_URL" -c "SELECT * FROM asset_context;"

# Show IOC memory (top 10 by fp_count)
psql "$DATABASE_URL" -c "SELECT value,type,alert_count,fp_count,tp_count FROM ioc_memory ORDER BY fp_count DESC LIMIT 10;"

# Kill server
kill -9 \$(pgrep -f "tsx.*server") 2>/dev/null

# Full restart
kill -9 \$(pgrep -f "tsx.*server") 2>/dev/null; sleep 1; npm run dev > /tmp/server.log 2>&1 &
```

---

## File Reference

| File | Purpose |
|---|---|
| `server.ts` | Main backend (Express + Socket.IO + DB init) |
| PostgreSQL `soc` db | Primary datastore — all alerts, memory, users (pgvector embeddings). `soc.db` remains only as the legacy ETL source. |
| `.env` | Environment variables (API keys, port, TLS paths) |
| `certs/cert.pem` | TLS certificate |
| `certs/key.pem` | TLS private key |
| `/tmp/server.log` | Live server output (after `npm run dev`) |
| `agents/orchestrator.ts` | Hub-and-swarm orchestration logic |
| `agents/memory/` | Memory tiers (IOC, semantic, working, assets) |
| `src/App.tsx` | Frontend React app |
