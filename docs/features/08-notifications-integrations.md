# Notifications & Integrations

## What It Does

The platform dispatches notifications and creates tickets in external systems automatically when incidents are detected. Three integrations are supported out of the box:

1. **Email** — SMTP-based incident alerts
2. **Telegram** — Bot messages to a SOC chat channel
3. **GLPI** — IT service management ticket creation

Each integration can be independently enabled/disabled, configured with its own auto-send threshold, and tested from the UI.

---

## How Notifications Fire

After the orchestrator completes an investigation, the ticketing agent produces a ticket with a priority level. The system then checks all enabled integrations whose `auto_send_threshold` matches or exceeds the ticket priority:

```
Orchestration completes
       │
       ▼
  Ticketing Agent produces ticket
       │  priority: "HIGH"
       ▼
  For each enabled integration:
       │
       ├─ Email:    threshold ≤ HIGH? → Send email
       ├─ Telegram: threshold ≤ HIGH? → Send bot message
       └─ GLPI:     threshold ≤ CRITICAL? → Skip (threshold too high)
```

Priority hierarchy: `CRITICAL > HIGH > MEDIUM > LOW`

---

## Email Integration

### Configuration

Set via environment variables:

```env
SMTP_HOST=smtp.yourorg.com
SMTP_PORT=587
SMTP_USER=aisoc@yourorg.com
SMTP_PASS=your_smtp_password
ALERT_EMAIL_TO=soc-team@yourorg.com
```

If all SMTP variables are set, email integration is auto-enabled at startup.

### What Gets Sent

- **Subject**: `[BBS AISOC] <ticket title>`
- **Body**: Full ticket report body with HTML formatting
- **From**: `SMTP_USER`
- **To**: `ALERT_EMAIL_TO`

---

## Telegram Integration

### Configuration

Set via the Settings UI or environment variables:

```env
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=-1001234567890
```

Or configure in the UI: **Settings** → **Integrations** → **Telegram** → enter bot token and chat ID.

### What Gets Sent

HTML-formatted message:
```
[BBS AISOC] HIGH Alert

SSH Brute Force from 185.220.101.47

<first 300 chars of report body>
```

### Creating a Telegram Bot

1. Message `@BotFather` on Telegram
2. Send `/newbot` and follow prompts
3. Copy the bot token
4. Add the bot to your SOC group chat
5. Get the chat ID (use `https://api.telegram.org/bot<TOKEN>/getUpdates`)

---

## GLPI Integration

### Configuration

Set via the Settings UI or environment variables:

```env
GLPI_URL=https://glpi.yourorg.local
GLPI_APP_TOKEN=your_glpi_app_token
GLPI_USER_TOKEN=your_glpi_user_token
```

### What Gets Created

A GLPI ticket with:
- **Title**: Ticket title from the ticketing agent
- **Content**: Full report body
- **Urgency**: Mapped from ticket priority (CRITICAL=5, HIGH=4, MEDIUM=3, LOW=2)

### GLPI Setup

1. Enable the API in GLPI: **Setup** → **General** → **API**
2. Create an API client to get the App Token
3. Generate a User Token in your GLPI user profile
4. Enter URL, App Token, and User Token in the Aegis Settings

---

## Managing Integrations

### UI

Navigate to **Settings** → **Integrations**. Each integration card shows:
- Enabled/disabled status
- Configuration fields (masked for sensitive values)
- Auto-send threshold selector
- 24-hour statistics (total dispatches, successes, failures)
- "Test" button to verify connectivity

### API

```
GET    /api/integrations                     # List all with 24h stats
PATCH  /api/integrations/:name              # Update config/enabled/threshold
POST   /api/integrations/:name/test         # Send a test notification
```

### Action Logs

All integration dispatches (success and failure) are logged in the `action_logs` table:

```
GET /api/action-logs?integration=telegram&status=failed&limit=50
GET /api/action-stats                        # Aggregate stats by integration
```

---

## Files Involved

```
server.ts                       ← Integration CRUD, dispatch logic, test endpoints
agents/shared/telegram.ts       ← Telegram Bot API client (sendTelegramMessage)
agents/shared/glpi.ts           ← GLPI REST API client (createGlpiTicket)
agents/nodes/ticketing.ts       ← Ticketing Agent (produces report for dispatch)
src/App.tsx                     ← Settings tab → Integrations panel
```
