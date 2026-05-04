# Incident Reports & Export

## What It Does

The Reports system provides a centralized view of all completed AI investigations, with summary statistics and per-incident detail. Analysts can review investigation history, track patterns over time, and verify that investigations met quality standards.

---

## Reports Dashboard

The **Reports** tab displays:

### Summary Statistics
- **Total Investigations** — number of completed agent runs
- **Last 7 Days** — recent investigation volume
- **Email Sent %** — percentage of alerts that triggered email notifications
- **Daily Volume** — chart of investigations per day (last 7 days)
- **FP Rate** — false positive percentage
- **MITRE Coverage** — percentage of investigations with ATT&CK mappings

### Investigation List
Paginated list of all agent runs, showing:
- Alert description and source IP
- Investigation timestamp
- Status (TRIAGED, FALSE_POSITIVE, ESCALATED, CLOSED)
- Priority (from ticketing agent)
- Confidence score
- Actions dispatched (email, telegram, GLPI, firewall)

---

## Report Generation

Reports are generated automatically as part of the Hub-and-Swarm pipeline. The **Ticketing Agent** produces a structured incident ticket with:

```typescript
{
  title:                   string;     // "SSH Brute Force from 185.220.101.47"
  priority:                "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  report_body:             string;     // 4-5 sentence narrative
  email_notification_sent: boolean;
  affected_systems:        string[];   // ["web-server-01", "192.168.1.100"]
  business_impact:         string;     // "Production web server compromised"
  confidence:              number;     // 0.0-1.0
}
```

This report body is:
1. Stored in `ai_analysis` JSON on the alert
2. Sent to enabled integrations (email, Telegram, GLPI)
3. Available in the Reports tab for historical review

---

## API Endpoints

### Report Summary
```
GET /api/reports/summary
```
Returns aggregate statistics: total investigations, last 7 days count, email sent percentage, daily volume for the past week, FP rate, and MITRE coverage.

### Report List
```
GET /api/reports?page=1&pageSize=20
```
Returns paginated investigation records with alert metadata, ticket info, confidence scores, and dispatched actions.

---

## Export Formats

Reports can be exported from the UI in multiple formats:

- **Markdown** — structured incident report with sections
- **Plain Text** — simplified text format for email/ticketing
- **PDF** — (via browser print/save as PDF)
- **JSON** — raw investigation data

---

## Files Involved

```
agents/nodes/ticketing.ts       ← Ticketing Agent (report body generation)
server.ts                       ← GET /api/reports/summary, GET /api/reports
src/App.tsx                     ← Reports tab component
```
