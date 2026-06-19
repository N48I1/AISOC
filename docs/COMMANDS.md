# Commands & Troubleshooting Runbook

Quick reference for running **Aegis AISOC** and recovering it when something breaks.
All commands assume you're in the project root:

```bash
cd /home/nelhilali/AISOC
```

- **App URL:** `https://soar.bbs.lan:3001` (or `https://localhost:3001`)
- **Server log:** `/tmp/server.log`
- **Stack:** Node/Express + Vite (one process) → PostgreSQL + Ollama (+ optional MISP)

---

## TL;DR — the four you'll actually use

| Situation | Command |
|---|---|
| Run it (development) | `npm run dev` |
| Something's wrong — diagnose | `bash troubleshoot.sh` |
| Server is down — restart it | `bash troubleshoot.sh --fix` |
| Watch the logs | `tail -f /tmp/server.log` |

---

## 1. Run the app

```bash
npm run dev      # everyday mode: tsx watch (auto-reloads backend edits),
                 # serves the frontend from source. No build step needed.

npm run build    # build the frontend into dist/  (required before `npm run start`)
npm run start    # production mode: serves the prebuilt dist/ (errors if you skip build)
```

Open **`https://soar.bbs.lan:3001`**. After a frontend change, hard-refresh the browser: **Ctrl+Shift+R**.

Run detached and tail the log (how `troubleshoot.sh --fix` does it):

```bash
npm run dev > /tmp/server.log 2>&1 &     # start in background
tail -f /tmp/server.log                  # follow the log
```

---

## 2. Troubleshooting — the one script

`troubleshoot.sh` checks the server process, port 3001, HTTPS, the login API, PostgreSQL,
TLS certs, `.env`, and the recent log — then optionally fixes things.

```bash
bash troubleshoot.sh              # READ-ONLY diagnosis (always safe to run first)
bash troubleshoot.sh --fix        # restart the server if it's down (logs to /tmp/server.log)
bash troubleshoot.sh --reset-pass # reset the admin account password to the script's default
                                  #   → log in and change it immediately afterward
bash troubleshoot.sh --reset-db   # ⚠️ DANGER: TRUNCATE all tables — wipes ALL data
```

> Run with **no flags first**. It only diagnoses and tells you what's wrong before you change anything.

---

## 3. Start / check the dependent services

The app needs these. If it boots but misbehaves, a dependency is usually the cause.

### PostgreSQL — data store (port 5432)
```bash
pg_isready                              # "accepting connections" = healthy
sudo systemctl status  postgresql
sudo systemctl restart postgresql       # if it's down
```
Symptoms when down: login fails, dashboards empty, `troubleshoot.sh` reports "PostgreSQL not reachable".

### Ollama — local embeddings / RAG (port 11434)
```bash
curl http://localhost:11434/api/tags    # lists installed models = healthy
sudo systemctl status  ollama
sudo systemctl restart ollama           # if it's down
```
Symptoms when down: semantic recall / "Reasoning" sections come up empty; embeddings stop being written.

### MISP — threat-intel enrichment (`https://localhost`, **optional**)
The Threat-Intel agent degrades gracefully if MISP is unavailable — the app still works.
Check the **Integrations** tab in the UI for connection status.

---

## 4. Manual diagnostics

```bash
# Is the server running / what's on the port?
pgrep -af "tsx.*server"
ss -ltnp | grep 3001

# Restart by hand
pkill -f "tsx.*server"                       # stop
npm run dev > /tmp/server.log 2>&1 &         # start again

# Reachability + an API probe
curl -sk https://localhost:3001/ -o /dev/null -w "%{http_code}\n"    # expect 200
curl -sk https://localhost:3001/api/auth/me -w "\n"                 # expect 401 when logged out

# Recent errors in the log
grep -iE "error|crash|fatal|unhandled" /tmp/server.log | tail
```

---

## 5. Logs

```bash
tail -f /tmp/server.log          # live
tail -200 /tmp/server.log        # last 200 lines
```
`/tmp/server.log` exists only when the server was started via `npm run dev > /tmp/server.log 2>&1 &`
or `troubleshoot.sh --fix`. Started in a plain terminal, logs print to that terminal instead.

---

## 6. Access the database (psql CLI)

```bash
# Load the connection vars from .env — psql then connects with no args and no password prompt.
set -a; . <(grep -E '^PG(HOST|PORT|USER|PASSWORD|DATABASE)=' .env); set +a
psql                      # interactive shell → prompt becomes  soc=>
# long form (will prompt for the password):  psql -h 127.0.0.1 -U aisoc -d soc
```

Inside the shell — backslash meta-commands:

```
\dt          list tables             \d alerts    describe a table (columns, indexes)
\dt+         tables with sizes        \du          list roles/users
\x           toggle wide-row view     \timing      toggle query timing
\h SELECT    SQL syntax help          \?           all meta-commands        \q   quit
```

Run queries (end each statement with `;`):

```sql
SELECT count(*) FROM alerts;
SELECT id, username, role, email FROM users;          -- never select the password column
SELECT status, count(*) FROM alerts GROUP BY status;
```

One-off queries without entering the shell:

```bash
psql -c  "SELECT count(*) FROM alerts;"      # run and exit
psql -tAc "SELECT count(*) FROM alerts;"     # tuples-only, unaligned → just the value (for scripts)
psql -f   query.sql                          # run a .sql file
```

> **Safety:** read-only `SELECT`s can't hurt anything. `aisoc` owns every table, so
> `UPDATE`/`DELETE`/`TRUNCATE` have no guardrails — wrap risky edits in `BEGIN; … ROLLBACK;` to test first.
>
> **Web UI?** PostgreSQL itself has no web interface (CLI/`psql` only). Lightweight add-ons exist —
> Adminer (single PHP file) or pgweb (Docker). Bind any DB web UI to `127.0.0.1` only.

---

## 7. Backups & recovery (PostgreSQL)

```bash
# Connection vars live in .env (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE).
# Load them into the shell so pg tools can connect:
set -a; . <(grep -E '^PG(HOST|PORT|USER|PASSWORD|DATABASE)=' .env); set +a

# Back up (dated, compressed)
pg_dump --no-owner --no-privileges "$PGDATABASE" | gzip -9 > ~/aisoc-backups/soc-pg-$(date +%F).sql.gz

# Restore from a backup
gunzip -c ~/aisoc-backups/soc-pg-2026-06-18.sql.gz | psql "$PGDATABASE"
```

Existing backups live in `~/aisoc-backups/` (outside the repo).

---

## 8. Build & quality checks

```bash
npm run lint     # tsc --noEmit — typecheck the whole project (frontend + server/)
npm run build    # confirm the frontend bundles
npm run clean    # rm -rf dist
```

---

## 9. Rare / one-time

```bash
npm run db:migrate   # legacy SQLite → Postgres ETL. Already done — do NOT re-run
                     # unless re-importing an old soc.db snapshot.
```

---

### Mental model

- **Daily:** `npm run dev`
- **Broken:** `bash troubleshoot.sh` → then `--fix`
- **Logs:** `tail -f /tmp/server.log`
- **Inspect data:** source the `.env` `PG*` vars, then `psql`
- **Dependency down:** `sudo systemctl restart postgresql` / `ollama`
- **Locked out:** `bash troubleshoot.sh --reset-pass` (then change the password)
