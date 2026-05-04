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
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const db = new Database('soc.db');
const hash = bcrypt.hashSync('admin123', 10);
db.prepare('UPDATE users SET password = ? WHERE username = ?').run(hash, 'admin');
console.log('Password reset to admin123');
db.close();
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
node -e "
const Database = require('better-sqlite3');
const db = new Database('soc.db', { readonly: true });
const r = db.prepare('SELECT status, COUNT(*) as n FROM alerts GROUP BY status').all();
console.table(r);
db.close();
"
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

The SQLite DB is `soc.db` in the project root. Migrations run automatically on startup.

Check for corruption:
```bash
node -e "
const Database = require('better-sqlite3');
try {
  const db = new Database('soc.db');
  db.prepare('PRAGMA integrity_check').get();
  console.log('DB OK');
  db.close();
} catch(e) { console.error('DB ERROR:', e.message); }
"
```

If corrupted, delete and let it rebuild (all demo data re-seeds):
```bash
# WARNING: deletes all alert history, memory, and user accounts
rm soc.db
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

## Useful One-liners

```bash
# Show server log live
tail -f /tmp/server.log

# Show all alert statuses
node -e "const db=require('better-sqlite3')('soc.db',{readonly:true});console.table(db.prepare('SELECT status,count(*)n FROM alerts GROUP BY status').all());db.close()"

# Show asset_context table
node -e "const db=require('better-sqlite3')('soc.db',{readonly:true});console.table(db.prepare('SELECT * FROM asset_context').all());db.close()"

# Show IOC memory (top 10 by fp_count)
node -e "const db=require('better-sqlite3')('soc.db',{readonly:true});console.table(db.prepare('SELECT value,type,alert_count,fp_count,tp_count FROM ioc_memory ORDER BY fp_count DESC LIMIT 10').all());db.close()"

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
| `soc.db` | SQLite database (all alerts, memory, users) |
| `.env` | Environment variables (API keys, port, TLS paths) |
| `certs/cert.pem` | TLS certificate |
| `certs/key.pem` | TLS private key |
| `/tmp/server.log` | Live server output (after `npm run dev`) |
| `agents/orchestrator.ts` | Hub-and-swarm orchestration logic |
| `agents/memory/` | Memory tiers (IOC, semantic, working, assets) |
| `src/App.tsx` | Frontend React app |
