#!/usr/bin/env bash

# ==============================
# OpenRouter API Key
# ==============================
OPENROUTER_API_KEY="${OPENROUTER_API_KEY:?Set OPENROUTER_API_KEY in your environment (e.g. export it or source it from .env)}"
PROMPT=$(cat <<'EOF'
You are a Tier-2 SOC analyst.

Analyze the following Wazuh alert and provide:

1. Executive Summary
2. Root Cause
3. Severity Assessment
4. True Positive or False Positive
5. Recommended Remediation Steps

Important instructions:
- Use only information present in the alert.
- Do not assume version compatibility.
- If information is missing, explicitly state assumptions.
- Distinguish operational issues from security incidents.

Alert:

{
  "rule": {
    "id": "61021",
    "description": ".NET Runtime - Fatal execution engine error.",
    "level": 9
  },
  "agent": {
    "name": "SRV_SPHV_100",
    "ip": "172.16.100.7"
  },
  "event": {
    "application": "Veeam.AHV.Service.exe",
    "path": "C:\\Program Files\\Veeam\\Plugins\\Nutanix AHV\\Service\\Veeam.AHV.Service.exe",
    "required_framework": "Microsoft.AspNetCore.App 8.0.0",
    "installed_framework": "10.0.9"
  }
}
EOF
)

MODEL="deepseek/deepseek-v4-flash"

echo
echo "=================================================="
echo "MODEL: $MODEL"
echo "=================================================="

curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
      --arg model "$MODEL" \
      --arg prompt "$PROMPT" \
      '{
          model: $model,
          temperature: 0.2,
          messages: [
            {
              role: "user",
              content: $prompt
            }
          ]
      }')" \
| jq -r '.choices[0].message.content'

echo
