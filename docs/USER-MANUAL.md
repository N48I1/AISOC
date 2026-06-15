# AISOC — User Manual

A guide for the people who **operate** the Aegis AI-SOC platform: SOC analysts, incident
leads, and administrators. For running, maintaining, or extending the code, see the
[Developer Manual](./DEVELOPER-MANUAL.md).

> AISOC is an AI-powered Security Operations Center. It receives alerts from your SIEM
> (Wazuh), filters out the noise with a team of AI agents, and helps you triage,
> investigate, and respond to the threats that are real — with a human in command at
> every decision point.

---

## 1. What AISOC does (in one minute)

A SIEM like Wazuh produces far more alerts than a team can read — most are false positives.
AISOC sits downstream and:

1. **Receives** each alert over an authenticated ingest API (it never polls the SIEM).
2. **Filters noise** through a cost-ordered, 9-layer false-positive funnel — cheap
   deterministic checks first, an LLM only when needed.
3. **Investigates** real suspects with specialist AI agents (threat intel, correlation,
   knowledge, memory recall) coordinated by a planner.
4. **Composes** an incident: a ticket, a response plan, and a validation pass.
5. **Keeps humans in command** — you confirm, override, escalate, and approve every
   destructive action. The AI proposes; people dispose.
6. **Remembers** — every resolved incident is embedded into semantic memory so the system
   recognizes similar noise faster over time.

## 2. Getting started

### Accessing the app
- Open the app URL in a browser (e.g. `https://soar.bbs.lan:3001`). A self-signed TLS
  certificate may trigger a one-time browser warning — accept it to proceed.
- Log in with your username and password. The seeded bootstrap account is **`admin`** (the
  platform owner). **Change its password immediately after first login.**

### Roles — who can do what
AISOC has six hierarchical roles. Each inherits everything the role below it can do.

| Level | Role | Display name | Headline capability |
|---|---|---|---|
| 0 | `ANALYST` | Analyst | View alerts, incidents, knowledge, memory (read-only triage) |
| 1 | `TIER1` | SOC Analyst L1 | Confirm / override alert verdicts (front-line triage) |
| 2 | `TIER2` | SOC Analyst L2 | Investigate, close/escalate incidents, tune detection (suppression, knowledge) |
| 3 | `INCIDENT_LEAD` | Incident Lead | Execute approved response actions (block, isolate, disable) |
| 4 | `ADMIN` | Administrator | Users, AI models, integrations, audit, API keys |
| 5 | `SUPER_ADMIN` | Super Administrator | Create/promote admins, edit the admin IP allowlist |

The **Roles & Permissions** viewer (Settings) shows the exact matrix. ADMIN handles
day-to-day administration; **SUPER_ADMIN** is the platform owner — the only role that can
mint admins or change the admin IP allowlist (separation of duties).

### Authentication features you'll meet
- **LDAP / Active Directory or local login** — sign in either way.
- **Account lockout** — five failed logins lock the account for 15 minutes.
- **Step-up authentication** — sensitive admin operations (changing AI models, resetting
  alerts, clearing archives, creating providers) ask you to re-enter your password for a
  short elevated window, even with a valid session.
- **Session revocation** — an admin can force-logout a user instantly.

## 3. The interface — the eleven tabs

| Tab | What it's for | Who can act |
|---|---|---|
| **Dashboard** | KPIs: active incidents, MTTR, FP rate, automation rate | view: ANALYST |
| **Noise Filter** | The live alert queue + triage actions | act: TIER1+ |
| **FP Archive** | Auditable store of everything filtered as false positive | view: ANALYST |
| **Investigation** | Run/inspect the full AI agent pipeline on an alert | run: TIER1+ |
| **Incidents** | Real incidents and their lifecycle | manage: TIER1+; close/escalate: TIER2+ |
| **Response Actions** | Pending/approved/executed containment actions | execute: INCIDENT_LEAD+ |
| **Reports** | Generate & export incident reports (PDF/MD/TXT/XML) | view: ANALYST |
| **Knowledge** | Knowledge base: playbooks + past-incident insights | edit: TIER2+ |
| **Integrations** | Notification & ticketing channels | ADMIN |
| **Settings** | AI models, security policies, users, API keys, roles | ADMIN (some SUPER_ADMIN) |
| **Profile** | Your account, preferences, password change | anyone |

## 4. Core workflows

### 4.1 Triage an alert (Noise Filter)
1. Open **Noise Filter** — the queue of alerts needing attention.
2. Each row shows severity, source, rule, and (once analyzed) the AI's verdict/priority.
3. New alerts analyze automatically — the AI run is fire-and-forget, so ingestion never
   blocks. You can also trigger analysis manually.
4. Act on a verdict:
   - **Confirm FP** — agree it's a false positive (archives it; feeds the learning loop).
   - **Override** — the AI was wrong; correct the verdict (also a training signal).
   - **Escalate** — promote it to a real incident.

### 4.2 Investigate (Investigation tab)
- Open an alert and **Run Agents** to execute the full pipeline.
- You'll see the agent timeline: triage → planner → parallel investigators (intel,
  correlation, knowledge, recall, IOC check) → composers (ticket, response, validation),
  each with a structured **reasoning** block: decision, evidence for/against, rejected
  hypotheses, and a confidence score.

### 4.3 False-positive reduction (FP Archive + learning)
- Filtered alerts land in **FP Archive** — never deleted, always auditable.
- From confirmed-FP statistics the system *suggests* new suppression rules and known-asset
  registrations; an admin approves promotion. The funnel tunes itself, with human sign-off.

### 4.4 Manage an incident (Incidents tab)
- Incidents follow a NIST-style lifecycle — phases **Detection → Analysis → Containment →
  Eradication → Recovery → Post-Incident**, statuses **Open → Investigating → Contained →
  Resolved → Closed** (plus *Reclassified FP* if it turns out to be noise).
- Take/assign ownership, advance phases, add timeline notes, write/attach a report.
- Closing an incident feeds the metrics (MTTR, FP rate, automation rate).

### 4.5 Approve & execute response actions (Response Actions)
- AI-proposed actions (block IP, isolate host, disable user, reset password, collect
  forensics…) start as **pending** and **must be approved by a human** before execution.
  This is a hard gate in the data model, not a UI convention.
- **INCIDENT_LEAD** (or higher) executes; each action is logged with who and when.

### 4.6 Reports
- Generate an incident report and export it as PDF, Markdown, TXT, or XML.

### 4.7 Knowledge base
- Browse playbooks (by MITRE tactic) and past-incident insights. Note: the page's search
  box does a plain text match; the *agents* use semantic (embedding) recall during
  investigations, so they can find "credential stuffing" when you searched "brute force".

### 4.8 Notifications & integrations (Admin)
- Configure Telegram, Slack, email (SMTP / Microsoft 365 Graph), and GLPI ticketing — each
  with an **auto-send threshold** (e.g. only notify on HIGH+). Use **Test** to verify each.

### 4.9 Administration (Settings)
- **AI models** — hot-swap the model used per agent phase (step-up required).
- **Security policies** — password policy, lockout policy, admin IP allowlist
  (SUPER_ADMIN), audit retention.
- **Users** — create/edit/disable users below your level, reset passwords, revoke sessions,
  grant a time-boxed temporary role.
- **API keys** — issue/revoke hashed keys for SIEM ingest (shown once on creation).
- **Audit log** — every login, lockout, and admin action; filter and export to CSV.
- **Access reviews** — periodic snapshot of every active user + an admin decision (evidence
  for compliance).

## 5. A day in the life (analyst playbook)
1. Check the **Dashboard** for overnight load and the FP rate.
2. Work the **Noise Filter** queue top-down: confirm FPs, override wrong verdicts.
3. **Escalate** real threats; open **Investigation** to read the agent reasoning.
4. Own your assigned **Incidents**; advance their phase as you contain and eradicate.
5. In **Response Actions**, execute approved containment (if you're INCIDENT_LEAD+).
6. Generate a **Report** when closing an incident.
7. Periodically, an admin promotes suggested suppression rules from confirmed FPs.

## 6. FAQ
- **"The AI marked a real attack as a false positive."** That's why FPs are *archived, not
  deleted*, and why **Override** exists. Your override is also a training signal.
- **"Does anything destructive happen automatically?"** No — every response action is
  approval-gated.
- **"Can it run without internet?"** Yes — point the agents at a local Ollama model
  (Settings → Local LLM) for fully air-gapped operation; embeddings already run locally.
- **"Noise Filter looks empty."** There are zero unscanned (`NEW`) alerts — wait for live
  Wazuh traffic, or ask an admin to send test alerts.
- **"I was asked to re-enter my password."** That's step-up auth protecting a sensitive
  admin action — expected.

---

*See also: [Developer Manual](./DEVELOPER-MANUAL.md) · [Feature docs](./features/) ·
[Diagrams](./diagrams/)*
