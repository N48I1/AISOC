# BBS AISOC — Admin Command Reference

## Start / Stop Server

### Start server (background, logs to /tmp/server.log)
```bash
nohup npx tsx server.ts > /tmp/server.log 2>&1 &
```

### Check startup logs
```bash
cat /tmp/server.log
```

### Full restart (kill stale instances + start fresh)
```bash
pkill -f "tsx server.ts" 2>/dev/null
pkill -f "node.*server" 2>/dev/null
sleep 2
nohup npx tsx server.ts > /tmp/server.log 2>&1 &
sleep 4 && cat /tmp/server.log
```

### Force-kill by port then restart
```bash
lsof -ti:3000,3001,3002 | xargs kill -9 2>/dev/null
sleep 2
nohup npx tsx server.ts > /tmp/server.log 2>&1 &
sleep 5 && cat /tmp/server.log
```

### Check what is running on ports
```bash
lsof -i:3001
lsof -i:3000,3001,3002
```

---

## Build Frontend

### Production build
```bash
npm run build
```

### TypeScript type-check only (no emit)
```bash
NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit
```

---

## Database — Inspect

### List all alerts (id, severity, status, description snippet, has AI)
```bash
npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('soc.db');
const rows = db.prepare('SELECT id, severity, status, SUBSTR(description,1,60) as desc, ai_analysis IS NOT NULL as has_ai FROM alerts ORDER BY timestamp DESC').all();
console.table(rows);
db.close();
"
```

### Dump full AI analysis for one alert
```bash
npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('soc.db');
const row = db.prepare('SELECT ai_analysis FROM alerts WHERE id = ?').get('ALERT_ID') as any;
const data = JSON.parse(row.ai_analysis);
console.log('quota_exhausted:', data.quota_exhausted);
console.log('fallback_phases:', data.fallback_phases);
console.log('summary:', data.summary);
console.log('iocs:', JSON.stringify(data.iocs));
console.log('ticket:', data.ticket);
console.log('validation:', data.validation);
db.close();
"
```
> Replace `ALERT_ID` with the actual alert ID (e.g. `uglaxu0wi`).

### Dump AI quality for ALL alerts
```bash
npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('soc.db');
const rows = db.prepare('SELECT id, severity, status, description, ai_analysis FROM alerts ORDER BY timestamp DESC').all() as any[];
for (const row of rows) {
  let ai: any = {};
  try { ai = JSON.parse(row.ai_analysis || '{}'); } catch {}
  const fb = ai.fallback_phases || [];
  console.log('─'.repeat(70));
  console.log('ALERT:', row.id, '| Severity:', row.severity, '| Status:', row.status);
  console.log('DESC:', row.description?.slice(0, 80));
  console.log('AI Quality:', fb.length === 0 ? 'REAL ✓' : (fb.length >= 7 ? 'ALL FALLBACK ✗' : 'PARTIAL (' + fb.length + '/7 fallback)'));
  console.log('Fallback phases:', fb.join(', ') || 'none');
  console.log('Summary:', ai.summary?.slice(0, 120));
  console.log('quota_exhausted:', ai.quota_exhausted);
}
db.close();
"
```

### Check current agent model assignments
```bash
npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('soc.db');
console.table(db.prepare('SELECT phase, model FROM agent_settings').all());
db.close();
"
```

### List all users
```bash
npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('soc.db');
console.table(db.prepare('SELECT id, username, role, created_at FROM users').all());
db.close();
"
```

---

## Database — Reset / Fix

### Reset all alerts to NEW (clears stale AI data for fresh re-analysis)
```bash
npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('soc.db');
const res = db.prepare(\"UPDATE alerts SET status = 'NEW', ai_analysis = NULL, mitre_attack = NULL, remediation_steps = NULL\").run();
console.log('Reset', res.changes, 'alerts to NEW');
db.close();
"
```

### Reset a single alert to NEW
```bash
npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('soc.db');
db.prepare(\"UPDATE alerts SET status = 'NEW', ai_analysis = NULL, mitre_attack = NULL, remediation_steps = NULL WHERE id = ?\").run('ALERT_ID');
console.log('Done');
db.close();
"
```

### Update agent model assignment directly in DB
```bash
npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('soc.db');
db.prepare('UPDATE agent_settings SET model = ? WHERE phase = ?').run('MODEL_ID', 'PHASE');
console.table(db.prepare('SELECT phase, model FROM agent_settings').all());
db.close();
"
```
> Replace `MODEL_ID` (e.g. `openai/gpt-oss-120b:free`) and `PHASE` (e.g. `analysis`).

### Bulk-update all agent models to working defaults
```bash
npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('soc.db');
const updates = [
  ['analysis',    'openai/gpt-oss-120b:free'],
  ['intel',       'nvidia/nemotron-3-super-120b-a12b:free'],
  ['knowledge',   'qwen/qwen3-coder:free'],
  ['correlation', 'openai/gpt-oss-20b:free'],
  ['ticketing',   'openai/gpt-oss-120b:free'],
  ['response',    'nvidia/nemotron-3-super-120b-a12b:free'],
  ['validation',  'qwen/qwen3-coder:free'],
];
const stmt = db.prepare('UPDATE agent_settings SET model = ? WHERE phase = ?');
for (const [phase, model] of updates) stmt.run(model, phase);
console.table(db.prepare('SELECT phase, model FROM agent_settings').all());
db.close();
"
```

---

## Troubleshooting — LLM / Agents

### Watch live server logs (tail)
```bash
tail -f /tmp/server.log
```

### Check for LLM errors in logs
```bash
grep -E "\[LLM\]|\[Agents\]|rate-limit|429|400|Schema Error" /tmp/server.log
```

### Check which OpenRouter API keys are loaded
```bash
grep -E "Backup|OPENROUTER|key loaded" /tmp/server.log
```

### Check OpenRouter rate limit headers (manual curl)
```bash
curl -s -I -X POST https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-oss-120b:free","messages":[{"role":"user","content":"hi"}]}' \
  2>&1 | grep -i "ratelimit\|x-rate\|remaining"
```

### Check which models are available on OpenRouter (free tier)
```bash
curl -s https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  | npx tsx -e "
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  const d = JSON.parse(Buffer.concat(chunks).toString());
  d.data.filter((m: any) => m.id.includes(':free')).forEach((m: any) => console.log(m.id));
});
"
```

---

## Troubleshooting — MISP

### Test MISP connectivity
```bash
curl -sk https://localhost/attributes/restSearch \
  -H "Authorization: $MISP_API_KEY" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"returnFormat":"json","value":"8.8.8.8","limit":1}' \
  | head -c 200
```

---

## Environment

### Show loaded .env values (safe — no secrets)
```bash
npx tsx -e "
import dotenv from 'dotenv';
dotenv.config();
console.log('OPENROUTER_API_KEY set:', !!process.env.OPENROUTER_API_KEY);
console.log('OPENROUTER_API_KEY_BACKUP set:', !!process.env.OPENROUTER_API_KEY_BACKUP);
console.log('OPENROUTER_API_KEY_BACKUP2 set:', !!process.env.OPENROUTER_API_KEY_BACKUP2);
console.log('MISP_URL:', process.env.MISP_URL);
console.log('APP_URL:', process.env.APP_URL);
console.log('JWT_SECRET set:', !!process.env.JWT_SECRET);
"
```

---

## Agent Model Reference

| Phase | Default Model | Provider |
|---|---|---|
| analysis | `openai/gpt-oss-120b:free` | OpenAI |
| intel | `nvidia/nemotron-3-super-120b-a12b:free` | NVIDIA |
| knowledge | `qwen/qwen3-coder:free` | Qwen |
| correlation | `openai/gpt-oss-20b:free` | OpenAI |
| ticketing | `openai/gpt-oss-120b:free` | OpenAI |
| response | `nvidia/nemotron-3-super-120b-a12b:free` | NVIDIA |
| validation | `qwen/qwen3-coder:free` | Qwen |

> Models can be changed at runtime via **Admin → Agent Settings** in the UI, or directly in the DB using the command above.

---

## Quick Diagnostics Checklist

```
[ ] Server running?          →  cat /tmp/server.log
[ ] Both backup keys loaded? →  grep "Backup" /tmp/server.log
[ ] LLM errors in logs?      →  grep "LLM" /tmp/server.log
[ ] Agents returning fallback? → run the "dump AI quality" command above
[ ] DB models correct?       →  SELECT phase, model FROM agent_settings
[ ] Quota exhausted?         →  look for "free-models-per-day" in /tmp/server.log
[ ] MISP reachable?          →  run the MISP curl test above
```
