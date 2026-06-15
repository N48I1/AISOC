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

The datastore is **PostgreSQL** (`pgvector`). Set a connection string once, then use
`psql` (which prints result tables natively); JS-heavy recipes use `node-postgres`
(`new pg.Pool()` reads the `PG*` vars from `.env`).

```bash
export DATABASE_URL="postgres://aisoc:<password>@127.0.0.1:5432/soc"   # or rely on PG* in .env
```

### List all alerts (id, severity, status, description snippet, has AI)
```bash
psql "$DATABASE_URL" -c "SELECT id, severity, status, SUBSTR(description,1,60) AS descr, (ai_analysis IS NOT NULL) AS has_ai FROM alerts ORDER BY timestamp DESC;"
```

### Dump full AI analysis for one alert
```bash
psql "$DATABASE_URL" -x -c "SELECT
  ai_analysis::jsonb->>'quota_exhausted'  AS quota_exhausted,
  ai_analysis::jsonb->'fallback_phases'   AS fallback_phases,
  ai_analysis::jsonb->>'summary'          AS summary,
  ai_analysis::jsonb->'iocs'              AS iocs,
  ai_analysis::jsonb->'ticket'            AS ticket,
  ai_analysis::jsonb->'validation'        AS validation
FROM alerts WHERE id = 'ALERT_ID';"
```
> Replace `ALERT_ID` with the actual alert ID (e.g. `uglaxu0wi`). `-x` prints expanded (column-per-line) output.

### Dump AI quality for ALL alerts
```bash
npx tsx -e "
import 'dotenv/config';
import pg from 'pg';
const pool = new pg.Pool();
const { rows } = await pool.query('SELECT id, severity, status, description, ai_analysis FROM alerts ORDER BY timestamp DESC');
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
await pool.end();
"
```

### Check current agent model assignments
```bash
psql "$DATABASE_URL" -c "SELECT phase, model FROM agent_settings;"
```

### List all users
```bash
psql "$DATABASE_URL" -c "SELECT id, username, role, created_at FROM users;"
```

---

## Database — Reset / Fix

### Reset all alerts to NEW (clears stale AI data for fresh re-analysis)
```bash
psql "$DATABASE_URL" -c "UPDATE alerts SET status='NEW', ai_analysis=NULL, mitre_attack=NULL, remediation_steps=NULL;"
```

### Reset a single alert to NEW
```bash
psql "$DATABASE_URL" -c "UPDATE alerts SET status='NEW', ai_analysis=NULL, mitre_attack=NULL, remediation_steps=NULL WHERE id='ALERT_ID';"
```

### Update agent model assignment directly in DB
```bash
psql "$DATABASE_URL" -c "UPDATE agent_settings SET model='MODEL_ID' WHERE phase='PHASE'; SELECT phase, model FROM agent_settings;"
```
> Replace `MODEL_ID` (e.g. `openai/gpt-oss-120b:free`) and `PHASE` (e.g. `analysis`).

### Bulk-update all agent models to working defaults
```bash
psql "$DATABASE_URL" <<'SQL'
UPDATE agent_settings SET model = v.model
FROM (VALUES
  ('analysis',    'openai/gpt-oss-120b:free'),
  ('intel',       'nvidia/nemotron-3-super-120b-a12b:free'),
  ('knowledge',   'qwen/qwen3-coder:free'),
  ('correlation', 'openai/gpt-oss-20b:free'),
  ('ticketing',   'openai/gpt-oss-120b:free'),
  ('response',    'nvidia/nemotron-3-super-120b-a12b:free'),
  ('validation',  'qwen/qwen3-coder:free')
) AS v(phase, model)
WHERE agent_settings.phase = v.phase;
SELECT phase, model FROM agent_settings;
SQL
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
