#!/usr/bin/env bash
# Send one real Wazuh alert payload to AISOC /api/ingest.
#
# Usage:
#   ./send-real-wazuh-log.sh
#   AISOC_API_KEY=sk_aisoc_xxx ./send-real-wazuh-log.sh
#   BASE_URL=https://localhost:3001 ADMIN_USER=admin ADMIN_PASS=admin123 ./send-real-wazuh-log.sh
#   ALERT_LEVEL=10 ./send-real-wazuh-log.sh

set -euo pipefail

BASE_URL="${BASE_URL:-https://localhost:3001}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin123}"
DEFAULT_API_KEY="sk_aisoc_fd3417f2ec5a488ca1fa69b0d9f286e19d5e80c70c4b9a3d"
API_KEY="${AISOC_API_KEY:-${API_KEY:-$DEFAULT_API_KEY}}"
ALERT_ID="${ALERT_ID:-$(date +%s).$(printf '%08d' "$((RANDOM * RANDOM % 100000000))")}"
ALERT_LEVEL="${ALERT_LEVEL:-8}"
EVENT_RECORD_ID="${EVENT_RECORD_ID:-$((1234567 + RANDOM))}"
TIMESTAMP_WAZUH="${TIMESTAMP_WAZUH:-$(date -u +'%Y-%m-%dT%H:%M:%S.000+0000')}"
SYSTEM_TIME="${SYSTEM_TIME:-$(date -u +'%Y-%m-%dT%H:%M:%S.0000000Z')}"
CURL=(curl -sk --max-time 30)

json_get() {
  node -e '
    const key = process.argv[1];
    let s = "";
    process.stdin.on("data", d => s += d);
    process.stdin.on("end", () => {
      try {
        const data = JSON.parse(s || "{}");
        const value = key.split(".").reduce((obj, part) => obj && obj[part], data);
        if (value == null) process.exit(1);
        process.stdout.write(String(value));
      } catch {
        process.exit(1);
      }
    });
  ' "$1"
}

if [[ -z "$API_KEY" ]]; then
  echo "No AISOC_API_KEY/API_KEY provided; creating a temporary ingest key via admin login..."
  LOGIN_RESP=$("${CURL[@]}" -X POST "$BASE_URL/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")
  TOKEN=$(printf '%s' "$LOGIN_RESP" | json_get token) || {
    echo "ERROR: admin login failed. Response:"
    echo "$LOGIN_RESP"
    exit 1
  }

  KEY_RESP=$("${CURL[@]}" -X POST "$BASE_URL/api/api-keys" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"real-wazuh-log-$(date +%s)\"}")
  API_KEY=$(printf '%s' "$KEY_RESP" | json_get key) || {
    echo "ERROR: API key creation failed. Response:"
    echo "$KEY_RESP"
    exit 1
  }
  echo "Created ingest key: ${API_KEY:0:20}..."
fi

PAYLOAD_FILE="$(mktemp)"
trap 'rm -f "$PAYLOAD_FILE"' EXIT

cat > "$PAYLOAD_FILE" <<JSON
{
  "id": "$ALERT_ID",
  "rule": {
    "id": "60122",
    "description": "Logon Failure - Unknown user or bad password",
    "level": $ALERT_LEVEL,
    "groups": [
      "windows",
      "windows_security",
      "authentication_failed"
    ]
  },
  "agent": {
    "id": "015",
    "name": "SRV-DC-01",
    "ip": "10.20.30.15"
  },
  "data": {
    "srcip": "unknown",
    "dstip": null,
    "user": null
  },
  "full_log": "windows_eventchannel",
  "timestamp": "$TIMESTAMP_WAZUH",
  "integration": {
    "source": "wazuh",
    "forwarder": "custom-aisoc-hardened",
    "host": "soc-manager-01",
    "tags": [
      "wazuh-rule:60122",
      "severity:$ALERT_LEVEL",
      "group:windows",
      "group:windows_security",
      "group:authentication_failed"
    ]
  },
  "attachments": {
    "raw_wazuh_alert": {
      "timestamp": "$TIMESTAMP_WAZUH",
      "rule": {
        "level": $ALERT_LEVEL,
        "description": "Logon Failure - Unknown user or bad password",
        "id": "60122",
        "mitre": {
          "id": [
            "T1531"
          ],
          "tactic": [
            "Impact"
          ],
          "technique": [
            "Account Access Removal"
          ]
        },
        "firedtimes": 5,
        "mail": false,
        "groups": [
          "windows",
          "windows_security",
          "authentication_failed"
        ],
        "pci_dss": [
          "10.2.4",
          "10.2.5"
        ],
        "gpg13": [
          "7.1"
        ],
        "gdpr": [
          "IV_35.7.d",
          "IV_32.2"
        ],
        "hipaa": [
          "164.312.b"
        ],
        "nist_800_53": [
          "AU.14",
          "AC.7"
        ],
        "tsc": [
          "CC6.1",
          "CC6.8",
          "CC7.2",
          "CC7.3"
        ]
      },
      "agent": {
        "id": "015",
        "name": "SRV-DC-01",
        "ip": "10.20.30.15"
      },
      "manager": {
        "name": "soc-manager-01"
      },
      "id": "$ALERT_ID",
      "decoder": {
        "name": "windows_eventchannel"
      },
      "data": {
        "win": {
          "system": {
            "providerName": "Microsoft-Windows-Security-Auditing",
            "providerGuid": "{54849625-5478-4994-a5ba-3e3b0328c30d}",
            "eventID": "4625",
            "version": "0",
            "level": "0",
            "task": "12544",
            "opcode": "0",
            "keywords": "0x8010000000000000",
            "systemTime": "$SYSTEM_TIME",
            "eventRecordID": "$EVENT_RECORD_ID",
            "processID": "928",
            "threadID": "3888",
            "channel": "Security",
            "computer": "SRV-DC-01.CORP.LOCAL",
            "severityValue": "AUDIT_FAILURE",
            "message": "An account failed to log on.\n\nSubject:\n\tSecurity ID:\t\tS-1-0-0\n\tAccount Name:\t\t-\n\tAccount Domain:\t\t-\n\tLogon ID:\t\t0x0\n\nLogon Type:\t\t\t3\n\nAccount For Which Logon Failed:\n\tSecurity ID:\t\tS-1-0-0\n\tAccount Name:\t\t\n\tAccount Domain:\t\t-\n\nFailure Information:\n\tFailure Reason:\t\tAn Error occurred during Logon.\n\tStatus:\t\t\t0xC000035B\n\tSub Status:\t\t0x0\n\nProcess Information:\n\tCaller Process ID:\t0x0\n\tCaller Process Name:\t-\n\nNetwork Information:\n\tWorkstation Name:\t-\n\tSource Network Address:\t10.20.30.1\n\tSource Port:\t\t52314\n\nDetailed Authentication Information:\n\tLogon Process:\t\tKerberos\n\tAuthentication Package:\tKerberos\n\tTransited Services:\t-\n\tPackage Name (NTLM only):\t-\n\tKey Length:\t\t0"
          },
          "eventdata": {
            "subjectUserSid": "S-1-0-0",
            "subjectLogonId": "0x0",
            "targetUserSid": "S-1-0-0",
            "status": "0xc000035b",
            "failureReason": "%%2304",
            "subStatus": "0x0",
            "logonType": "3",
            "logonProcessName": "Kerberos",
            "authenticationPackageName": "Kerberos",
            "keyLength": "0",
            "processId": "0x0",
            "ipAddress": "10.20.30.1",
            "ipPort": "52314"
          }
        }
      },
      "location": "EventChannel"
    }
  }
}
JSON

echo "Demo alert id: $ALERT_ID"
echo "Demo severity: $ALERT_LEVEL"
echo "Sending Wazuh alert to $BASE_URL/api/ingest ..."
RESP=$("${CURL[@]}" -X POST "$BASE_URL/api/ingest" \
  -H "X-Api-Key: $API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @"$PAYLOAD_FILE")

echo "$RESP"
ALERT_ID=$(printf '%s' "$RESP" | json_get id || true)
STATUS=$(printf '%s' "$RESP" | json_get status || true)

if [[ -n "${ALERT_ID:-}" ]]; then
  echo "Created alert: $ALERT_ID"
fi
if [[ -n "${STATUS:-}" ]]; then
  echo "Ingest status: $STATUS"
fi

if [[ "${STATUS:-}" == "archived_fp" ]]; then
  echo "The platform archived this as FP. For the demo incident path, raise ALERT_LEVEL above your Noise Filter threshold or lower the threshold in Settings."
else
  echo "Open the platform and check Alerts/Incidents. This payload uses Wazuh level $ALERT_LEVEL and a unique id so it can be re-run during the demo."
fi
