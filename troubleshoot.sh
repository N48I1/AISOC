#!/usr/bin/env bash
# BBS AISOC — Troubleshooting & Recovery Script
# Usage: bash troubleshoot.sh [--fix] [--reset-db] [--reset-pass]
#
#   (no args)      — diagnose only, print report
#   --fix          — auto-fix: restart server if down, hard-refresh instructions
#   --reset-db     — DANGER: delete soc.db and restart fresh (loses all data)
#   --reset-pass   — reset admin password to admin123

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-3001}"
LOG="/tmp/server.log"
DB="$APP_DIR/soc.db"

RED='\033[0;31m'; YEL='\033[0;33m'; GRN='\033[0;32m'; BLU='\033[0;34m'; NC='\033[0m'

ok()   { echo -e "${GRN}  ✓${NC}  $*"; }
warn() { echo -e "${YEL}  ⚠${NC}  $*"; }
err()  { echo -e "${RED}  ✗${NC}  $*"; }
info() { echo -e "${BLU}  →${NC}  $*"; }
sep()  { echo -e "\n${BLU}────────────────────────────────────────${NC}"; }

FIX=false; RESET_DB=false; RESET_PASS=false
for arg in "$@"; do
  case "$arg" in
    --fix)        FIX=true ;;
    --reset-db)   RESET_DB=true ;;
    --reset-pass) RESET_PASS=true ;;
  esac
done

echo ""
echo -e "${BLU}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLU}║      BBS AISOC — Troubleshoot Script     ║${NC}"
echo -e "${BLU}╚══════════════════════════════════════════╝${NC}"
echo ""

cd "$APP_DIR"

# ── 1. Server process ──────────────────────────────────────────────────────────
sep
echo "1. SERVER PROCESS"
SERVER_PID=$(pgrep -f "tsx.*server" 2>/dev/null || true)
if [ -n "$SERVER_PID" ]; then
  ok "Server is running (PID $SERVER_PID)"
  SERVER_UP=true
else
  err "Server process not found"
  SERVER_UP=false
fi

# ── 2. Port availability ────────────────────────────────────────────────────────
sep
echo "2. PORT $PORT"
if ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
  ok "Port $PORT is LISTENING"
elif $SERVER_UP; then
  warn "Server PID found but port $PORT not listening yet (still booting?)"
else
  err "Port $PORT not in use — server is definitely down"
fi

# ── 3. HTTPS reachability ────────────────────────────────────────────────────────
sep
echo "3. HTTPS ENDPOINT"
HTTP_CODE=$(curl -sk --max-time 5 --connect-timeout 3 -o /dev/null -w "%{http_code}" "https://localhost:$PORT/" 2>/dev/null || true)
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "304" ]; then
  ok "https://localhost:$PORT/ → HTTP $HTTP_CODE"
elif [ "$HTTP_CODE" = "000" ]; then
  err "No response from https://localhost:$PORT/ (connection refused or TLS error)"
else
  warn "https://localhost:$PORT/ → HTTP $HTTP_CODE"
fi

# ── 4. Login API ────────────────────────────────────────────────────────────────
sep
echo "4. LOGIN API"
LOGIN_RESP=$(curl -sk --max-time 5 --connect-timeout 3 -X POST "https://localhost:$PORT/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' 2>/dev/null || true)
[ -z "$LOGIN_RESP" ] && LOGIN_RESP='{"error":"curl failed"}'
if echo "$LOGIN_RESP" | grep -q '"token"'; then
  ok "Login OK (admin/admin123 works)"
elif echo "$LOGIN_RESP" | grep -q "Invalid credentials"; then
  err "Invalid credentials — admin password may have been changed"
  info "Run: bash troubleshoot.sh --reset-pass"
else
  err "Login API not reachable: $LOGIN_RESP"
fi

# ── 5. Database ─────────────────────────────────────────────────────────────────
sep
echo "5. DATABASE"
if [ -f "$DB" ]; then
  DB_SIZE=$(du -sh "$DB" 2>/dev/null | cut -f1)
  ok "soc.db exists ($DB_SIZE)"
  DB_CHECK=$(node -e "
    const Database = require('better-sqlite3');
    try {
      const db = new Database('$DB', { readonly: true });
      const r = db.prepare('PRAGMA integrity_check').get();
      const alerts = db.prepare('SELECT COUNT(*) as n FROM alerts').get().n;
      const newAlerts = db.prepare(\"SELECT COUNT(*) as n FROM alerts WHERE status='NEW'\").get().n;
      console.log('ok|alerts=' + alerts + '|new=' + newAlerts);
      db.close();
    } catch(e) { console.log('error|' + e.message); }
  " 2>/dev/null || echo "error|node failed")
  if echo "$DB_CHECK" | grep -q "^ok"; then
    ALERT_COUNT=$(echo "$DB_CHECK" | grep -o 'alerts=[0-9]*' | cut -d= -f2)
    NEW_COUNT=$(echo "$DB_CHECK" | grep -o 'new=[0-9]*' | cut -d= -f2)
    ok "DB integrity OK — $ALERT_COUNT alerts ($NEW_COUNT unscanned NEW)"
    if [ "$NEW_COUNT" -eq 0 ]; then
      warn "0 unscanned alerts — Noise Filter will look empty (restart server to reseed)"
    fi
  else
    err "DB integrity check failed: $DB_CHECK"
    info "Run: bash troubleshoot.sh --reset-db  (WARNING: deletes all data)"
  fi
else
  err "soc.db not found — will be created on first server start"
fi

# ── 6. TLS certificates ─────────────────────────────────────────────────────────
sep
echo "6. TLS CERTIFICATES"
CERT="${TLS_CERT:-certs/cert.pem}"
KEY="${TLS_KEY:-certs/key.pem}"
if [ -f "$CERT" ] && [ -f "$KEY" ]; then
  EXPIRY=$(openssl x509 -enddate -noout -in "$CERT" 2>/dev/null | cut -d= -f2 || echo "unknown")
  ok "Certs exist — expires: $EXPIRY"
else
  err "TLS certs missing ($CERT / $KEY)"
  info "Regenerate: openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/key.pem -out certs/cert.pem -days 365 -subj '/CN=soar.bbs.lan' -addext 'subjectAltName=DNS:soar.bbs.lan,DNS:localhost,IP:127.0.0.1'"
fi

# ── 7. .env file ─────────────────────────────────────────────────────────────────
sep
echo "7. ENVIRONMENT"
if [ -f "$APP_DIR/.env" ]; then
  ok ".env found"
  HAS_KEY=$(grep -cE 'OPENROUTER_API_KEY="?sk-' "$APP_DIR/.env" 2>/dev/null || true)
  if [ "${HAS_KEY:-0}" -gt 0 ] 2>/dev/null; then
    ok "OpenRouter API key present"
  else
    warn "No OpenRouter API key found — AI agents will use fallback/local LLM only"
  fi
else
  err ".env not found — copy .env.example to .env and fill in values"
fi

# ── 8. Recent server log ────────────────────────────────────────────────────────
sep
echo "8. RECENT SERVER LOG"
if [ -f "$LOG" ]; then
  ERRORS=$(grep -i "error\|crash\|fatal\|unhandled" "$LOG" | tail -5 || true)
  if [ -n "$ERRORS" ]; then
    warn "Recent errors in $LOG:"
    echo "$ERRORS" | while IFS= read -r line; do echo "     $line"; done
  else
    ok "No errors in recent log"
  fi
  info "Full log: tail -f $LOG"
else
  warn "No server log at $LOG — server hasn't been started with 'npm run dev' yet"
fi

# ── ACTIONS ─────────────────────────────────────────────────────────────────────
sep
echo "ACTIONS"

# --reset-pass
if $RESET_PASS; then
  info "Resetting admin password to 'admin123'..."
  node -e "
    const Database = require('better-sqlite3');
    const bcrypt = require('bcryptjs');
    const db = new Database('$DB');
    const hash = bcrypt.hashSync('admin123', 10);
    const r = db.prepare('UPDATE users SET password = ? WHERE username = ?').run(hash, 'admin');
    console.log(r.changes > 0 ? 'Password reset OK' : 'User not found');
    db.close();
  " && ok "Password reset to admin123" || err "Password reset failed"
fi

# --reset-db
if $RESET_DB; then
  warn "DANGER: Deleting soc.db — all alert history, memory, and user accounts will be lost"
  read -rp "  Type YES to confirm: " CONFIRM
  if [ "$CONFIRM" = "YES" ]; then
    rm -f "$DB"
    ok "Database deleted"
    FIX=true
  else
    info "Aborted — database not deleted"
  fi
fi

# --fix (restart server)
if $FIX; then
  info "Killing any existing server processes..."
  pkill -9 -f "tsx.*server" 2>/dev/null || true
  sleep 1
  info "Starting server..."
  npm run dev > "$LOG" 2>&1 &
  sleep 12
  SERVER_PID=$(pgrep -f "tsx.*server" 2>/dev/null || true)
  if [ -n "$SERVER_PID" ]; then
    ok "Server started (PID $SERVER_PID)"
    tail -8 "$LOG"
    # Re-check HTTPS after restart so summary reflects new state
    HTTP_CODE=$(curl -sk --max-time 5 --connect-timeout 3 -o /dev/null -w "%{http_code}" "https://localhost:$PORT/" 2>/dev/null || true)
  else
    err "Server failed to start — check log:"
    tail -20 "$LOG"
  fi
elif ! $SERVER_UP; then
  echo ""
  warn "Server is down. To restart:"
  echo "      bash troubleshoot.sh --fix"
  echo "   or manually:"
  echo "      cd $APP_DIR && npm run dev > /tmp/server.log 2>&1 &"
fi

# ── Summary ─────────────────────────────────────────────────────────────────────
sep
echo "SUMMARY"
if $SERVER_UP && { [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "304" ]; }; then
  ok "App is reachable at https://soar.bbs.lan:$PORT"
  info "If browser shows a stale page: Ctrl+Shift+R (hard refresh)"
else
  echo ""
  echo -e "  ${YEL}Next steps:${NC}"
  echo "  1. bash troubleshoot.sh --fix       (restart server)"
  echo "  2. Open https://soar.bbs.lan:$PORT and Ctrl+Shift+R"
  echo "  3. Login: admin / admin123"
  echo "  4. See TROUBLESHOOTING.md for details"
fi
echo ""
