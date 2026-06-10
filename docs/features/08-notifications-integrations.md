# Notifications & Integrations

## What It Does

The platform dispatches notifications and creates tickets in external systems automatically when incidents are detected. Four notification integrations are supported out of the box:

1. **Email** — SMTP-based incident alerts
2. **Telegram** — Bot messages to a SOC chat channel
3. **Slack** — Incoming-webhook posts to a channel
4. **GLPI** — IT service management ticket creation

Each integration can be independently enabled/disabled, configured with its own auto-send threshold, and tested from the UI.

> **Non-notification integrations** (Wazuh ingest config, LDAP / AD SSO) live in their own sub-tabs of the Integrations page and are intentionally **excluded** from `GET /api/integrations` and the notification card grid. See the dedicated docs:
> - [Wazuh integration](../wazuh-integration.md)
> - [LDAP / AD SSO](./13-ldap-ad-sso.md)
>
> The previous Firewalls sub-tab and `/api/firewalls/*` endpoints were removed in 2026-05 — see [07-response-controls.md](./07-response-controls.md) for the new manual action flow.

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

Set via UI (**Integrations → Email**) or environment variables.

For Gmail in the UI, the minimum working setup is:

1. **Email Provider**: `Gmail`
2. **Mailbox / SMTP Username**: your Gmail address
3. **App Password / SMTP Password**: paste the Gmail app password
4. **Destination Email**: recipient mailbox for alerts

For Office 365 / Microsoft 365 in the UI, the minimum working setup is:

1. **Email Provider**: `Office 365 / Microsoft 365`
2. **Auth Method**: `Microsoft Graph OAuth`
3. **Azure Tenant ID**: the Microsoft Entra tenant ID
4. **Azure Client ID**: the App Registration application/client ID
5. **Azure Client Secret**: a client secret created for the App Registration
6. **Sender Mailbox**: the mailbox used to send alerts, for example `soc@company.com`
7. **Destination Email**: recipient mailbox for alerts

For Microsoft 365, create an Azure App Registration and grant **Microsoft Graph → Application permissions → Mail.Send**, then grant admin consent. AISOC sends via Microsoft Graph `POST /users/{sender}/sendMail`, which matches Microsoft's modern OAuth model for service integrations. This avoids relying on tenant-level SMTP AUTH being enabled.

The legacy **SMTP password / app password** method remains available for tenants that explicitly allow SMTP AUTH. In that mode, `smtp.office365.com:587` is auto-filled. Gmail uses `smtp.gmail.com:587`, and Gmail app-password spaces are normalized automatically.

Environment-variable option:

```env
SMTP_PROVIDER=office365
MS365_TENANT_ID=00000000-0000-0000-0000-000000000000
MS365_CLIENT_ID=00000000-0000-0000-0000-000000000000
MS365_CLIENT_SECRET=your_client_secret
MS365_MAILBOX=aisoc@yourorg.com
ALERT_EMAIL_TO=soc-team@yourorg.com
```

If either all SMTP variables or all Microsoft 365 Graph variables are set, email integration is auto-enabled at startup.

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
GET    /api/integrations                     # List notification integrations (filters out 'wazuh' and 'ldap')
GET    /api/integrations/:name              # Read a single row by name (bypasses the filter — used by Wazuh / LDAP sub-tabs)
PATCH  /api/integrations/:name              # Update config/enabled/threshold (admin only)
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
