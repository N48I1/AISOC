# BBS AISOC Project Handover Plan

This document defines how AISOC is transferred from the developer/intern to the company team. The goal of the handover is simple: after acceptance, the company must be able to install, run, troubleshoot, secure, and extend the platform without relying on the original developer.

> Status: draft  
> Project owner after transfer: TODO: company/team name  
> Handover owner: TODO: your name  
> Receiving technical owner: TODO  
> Receiving SOC owner: TODO  
> Planned handover date: TODO  
> Accepted version/commit: TODO: git commit hash or release tag

## 1. Scope Of Transfer

### Delivered

- AISOC source code repository.
- React + Vite frontend.
- Express + Socket.IO backend in `server.ts`.
- SQLite database schema and automatic startup migrations.
- Multi-agent AI orchestration code in `agents/`.
- Wazuh ingest API and Wazuh integration guide.
- Admin, troubleshooting, architecture, feature, and diagram documentation.
- TLS certificate/key files used by the deployed instance, if applicable.
- Operational database files from the company server, if the company wants to keep current alert history.
- External integration configuration for OpenRouter/LLM providers, Ollama, GLPI, Telegram, SMTP, LDAP/AD, and MISP, where enabled.

### Not Delivered Unless Explicitly Added

- Production SLA or 24/7 support after the agreed support window.
- New feature development after acceptance.
- Company-owned cloud/billing accounts, unless the company creates them during handover.
- Wazuh Manager administration outside the documented custom integration.
- Legal/IP transfer terms beyond what is already defined by the internship or employment agreement.

## 2. Handover Phases

### Phase 1: Preparation

Complete before the first company transfer session.

- Freeze the version to be transferred by creating a release tag or recording the final commit hash.
- Run `npm run lint` and `npm run build` and record the result in this document.
- Make sure `.env` and private keys are not committed to git.
- Update `.env.example` if new environment variables are required.
- Confirm the Wazuh-side integration script exists, is documented, and is copied to the proper handover location.
- Inventory external accounts and secrets.
- Prepare a backup of `soc.db` and, if SQLite WAL mode is active, its `soc.db-wal` and `soc.db-shm` files.
- Prepare diagrams and speaker notes from `docs/diagrams/` for the architecture walkthrough.

### Phase 2: Knowledge Transfer Sessions

Recommended sessions:

| Session | Audience | Content | Evidence |
|---|---|---|---|
| Architecture walkthrough | Developer/team lead | Tech stack, backend, frontend, database, agents, memory system, Wazuh flow | `SOC_INTELLIGENCE_ARCHITECTURE.md`, `docs/diagrams/`, `docs/features/` |
| Installation and operations | Sysadmin/devops | Node runtime, install, `.env`, TLS, service start/restart, logs, backups, restore | `README.md`, `ADMIN_COMMANDS.md`, `TROUBLESHOOTING.md`, this file |
| SOC usage | SOC lead/analysts | Alert triage, false-positive review, escalation, incidents, reports, GLPI/Telegram/email notifications | `docs/features/` |
| Security handover | Technical owner/security owner | Secrets, admin accounts, API keys, access removal, rotation plan | Section 8 of this file |

### Phase 3: Supervised Operation

The receiving team should operate AISOC while the original developer observes.

- Install the app on a clean machine using only written documentation.
- Start, stop, and restart the service.
- Log in with a company-owned admin account.
- Create a user.
- Issue and revoke an API key.
- Send a test alert through `/api/ingest`.
- Confirm a Wazuh alert flows from Wazuh to AISOC.
- Run an AI analysis and review fallback behavior if LLM quota is unavailable.
- Create or confirm an incident.
- Generate/export an incident report.
- Back up and restore the SQLite database.

Any question asked during this phase should become a documentation fix.

### Phase 4: Formal Acceptance

The company signs only after the acceptance checklist in Section 12 is completed. This is the practical "PV de reception" for the project.

### Phase 5: Exit And Access Removal

After acceptance:

- Company changes all admin passwords.
- Company rotates all API keys and integration secrets.
- Company removes the original developer's server, GitHub, dashboard, and external account access.
- Company confirms external billing/accounts are under company ownership.
- Support window starts and ends on agreed dates.

## 3. Asset Inventory

| Asset | Location | Owner After Transfer | Handover Action |
|---|---|---|---|
| Source code repository | TODO: repo URL | Company | Transfer repository to company org or push final copy to company-owned repo. |
| Application server | TODO: hostname/IP | Company sysadmin | Document OS, Node version, ports, service command, and log path. |
| Frontend/backend app | `server.ts`, `src/`, `agents/` | Company dev team | Walk through app startup, API routes, agent orchestration, and frontend flow. |
| Database | `soc.db` or `$SOC_DB_PATH` | Company | Back up and document restore procedure. Include WAL files if present. |
| TLS files | `certs/cert.pem`, `certs/key.pem`, or `$TLS_CERT`/`$TLS_KEY` | Company sysadmin | Transfer securely or reissue under company control. |
| Runtime env file | `.env` on server | Company sysadmin | Transfer through password manager or encrypted archive. Do not email/chat. |
| Wazuh integration script | `/var/ossec/integrations/custom-aisoc` or `custom-aisoc.py` | Company SOC/sysadmin | Verify it exists on Wazuh Manager; copy the final script into company documentation or repo. |
| Wazuh configuration | `/var/ossec/etc/ossec.conf` | Company SOC/sysadmin | Document `<integration>` block and severity filters. |
| API keys | AISOC Settings -> API Keys | Company admin | Recreate keys under company ownership and revoke old keys. |
| LLM provider keys | `.env` and/or AISOC provider registry | Company | Replace personal keys with company-owned keys. |
| Ollama model | Local Ollama service, `nomic-embed-text` by default | Company sysadmin | Install Ollama and pull the model, or document degraded semantic-memory behavior. |
| GLPI integration | `.env` and/or integrations table | Company service owner | Rotate app/user token and verify test ticket creation. |
| Telegram integration | `.env` and/or integrations table | Company service owner | Transfer or recreate bot under company account; rotate token. |
| SMTP/email integration | `.env` and/or integrations table | Company service owner | Replace with company mailbox or relay credentials. |
| LDAP/AD integration | AISOC integrations table | Company identity owner | Verify bind account, base DN, filters, and fallback policy. |
| MISP integration | `.env` | Company threat intel owner | Rotate API key and verify enrichment. |
| Documentation | `docs/`, `README.md`, `ADMIN_COMMANDS.md`, `TROUBLESHOOTING.md` | Company | Review and update after supervised operation. |

## 4. Architecture Summary

AISOC is a SOC platform made of a React frontend and a single Node.js backend. The backend serves REST APIs, Socket.IO events, authentication, SQLite persistence, alert ingestion, integrations, and AI agent orchestration.

The AI system uses a Hub-and-Swarm model. It performs deterministic memory recall and IOC checks, runs triage, uses a planner to dispatch relevant specialist agents, and commits results back to memory. See:

- `SOC_INTELLIGENCE_ARCHITECTURE.md`
- `docs/features/00-overview.md`
- `docs/diagrams/SPEAKER_NOTES.md`
- `docs/diagrams/`

## 5. Installation Checklist

The final install guide should let a company admin start from a clean machine.

- Install supported Node.js version. TODO: record exact production Node version.
- Clone the company-owned repository.
- Run `npm install`.
- Create `.env` from `.env.example` and fill all required values.
- Create or install TLS certificate/key files.
- Install and start Ollama if semantic memory is required.
- Pull the embedding model: `ollama pull nomic-embed-text`.
- Start development mode with `npm run dev` or production mode with `npm run build` then `npm run start`.
- Confirm the app is reachable on the configured `PORT`.
- Create/confirm the first `SUPER_ADMIN` or admin account.
- Configure Wazuh forwarding using `docs/wazuh-integration.md`.
- Configure optional integrations: GLPI, Telegram, SMTP/email, LDAP/AD, MISP.

## 6. Configuration Reference

Environment variables observed in the code:

| Variable | Purpose | Required? | Handover note |
|---|---|---|---|
| `JWT_SECRET` | Signs user/session tokens | Yes | Must be long, random, company-owned, and rotated after transfer. Code has a fallback, but production should never rely on it. |
| `ADMIN_SEED_PASSWORD` | Initial admin password if account is first created | Initial setup only | Rotate immediately after first login. |
| `ANALYST_SEED_PASSWORD` | Initial analyst password if account is first created | Initial setup only | Rotate or disable seeded account after handover. |
| `PORT` | HTTP/HTTPS app port | No | Defaults to `3000` in code; existing docs mention `3001`, so verify production. |
| `APP_URL` | Public app URL for callbacks/self-links | Recommended | Set to the actual company URL. |
| `SOC_DB_PATH` | SQLite database path | No | Defaults to `soc.db`. Set explicitly in production. |
| `TLS_CERT` | TLS certificate path | Recommended | Defaults to `certs/cert.pem`. |
| `TLS_KEY` | TLS private key path | Recommended | Defaults to `certs/key.pem`. |
| `USE_VITE_MIDDLEWARE` | Enables Vite dev middleware | Dev only | `npm run dev` sets this. Production should serve built `dist/`. |
| `OPENROUTER_API_KEY` | Primary OpenRouter API key | If OpenRouter is used | Replace personal/free key with company key. |
| `OPENROUTER_API_KEY_BACKUP` | Backup OpenRouter key | Optional | Rotate or remove if not company-owned. |
| `OPENROUTER_API_KEY_BACKUP2` | Second backup OpenRouter key | Optional | Rotate or remove if not company-owned. |
| `GEMINI_API_KEY` | Gemini API key | Optional/current docs mention it | Verify whether company still uses Gemini paths; current orchestration also uses OpenRouter/provider registry. |
| `AGENT_MODE` | `swarm` or `linear` orchestration | Optional | Defaults to `swarm`. |
| `EMBED_MODEL` | Ollama embedding model | Optional | Defaults to `nomic-embed-text`. |
| `MISP_URL` | MISP instance URL | Optional | Required for MISP enrichment. |
| `MISP_API_KEY` | MISP API key | Optional | Rotate during security handover. |
| `MISP_VERIFY_SSL` | MISP TLS verification | Optional | Defaults to verify unless set to `false`. |
| `GLPI_URL` | GLPI URL | Optional | Required for GLPI ticketing. |
| `GLPI_APP_TOKEN` | GLPI app token | Optional | Rotate during handover. |
| `GLPI_USER_TOKEN` | GLPI user token | Optional | Rotate during handover. |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | Optional | Recreate under company-owned bot if needed. |
| `TELEGRAM_CHAT_ID` | Telegram chat/channel ID | Optional | Verify destination is company-controlled. |
| `SMTP_HOST` | Email relay host | Optional | Required for email notifications. |
| `SMTP_PORT` | Email relay port | Optional | Defaults to `587`. |
| `SMTP_USER` | Email relay user/from | Optional | Use company mailbox or relay account. |
| `SMTP_PASS` | Email relay password/token | Optional | Rotate during handover. |
| `ALERT_EMAIL_TO` | Notification recipient | Optional | Set to company SOC mailbox or group. |

## 7. Operations Runbook

### Start And Stop

Use `ADMIN_COMMANDS.md` as the command reference. Main scripts from `package.json`:

- `npm run dev`: development mode with Vite middleware.
- `npm run start`: starts `tsx server.ts`.
- `npm run build`: builds the frontend.
- `npm run preview`: Vite preview.
- `npm run lint`: TypeScript check with `tsc --noEmit`.

### Logs

Current docs use `/tmp/server.log`. The receiving team should decide the production log location and service manager, for example `systemd` with `journalctl`.

TODO: record final production command/service file and log path.

### Database Backup

SQLite database file:

- Default: `soc.db`
- Override: `$SOC_DB_PATH`

Backup procedure:

1. Stop the app, or run a SQLite-safe backup.
2. If WAL files exist, include `soc.db-wal` and `soc.db-shm` or checkpoint first.
3. Store backup in company backup system.
4. Test restore on a clean instance before sign-off.

Suggested checkpoint before file backup:

```bash
npx tsx -e "import Database from 'better-sqlite3'; const db = new Database(process.env.SOC_DB_PATH || 'soc.db'); db.pragma('wal_checkpoint(TRUNCATE)'); db.close();"
```

### Troubleshooting

Use:

- `TROUBLESHOOTING.md`
- `troubleshoot.sh`
- `ADMIN_COMMANDS.md`

Common issues to verify during handover:

- Wrong Node version or native `better-sqlite3` build mismatch.
- Missing `.env` values.
- Expired or missing TLS certs.
- Wazuh custom integration script not installed or not executable.
- OpenRouter or Gemini quota exhausted.
- Ollama not running, causing semantic-memory embeddings to be skipped.
- GLPI/Telegram/SMTP credentials invalid.
- LDAP bind account or filters wrong.

## 8. Security Handover

### Secrets Rotation Table

| Secret | Location | Rotation Owner | Rotation Deadline | Done |
|---|---|---|---|---|
| `JWT_SECRET` | `.env` | Company sysadmin | Before final acceptance | TODO |
| Admin/SUPER_ADMIN passwords | AISOC users table/UI | Company platform owner | Before final acceptance | TODO |
| AISOC API keys | AISOC Settings -> API Keys | Company admin | Before final acceptance | TODO |
| Wazuh integration API key | Wazuh `ossec.conf` + AISOC | SOC/sysadmin | Before final acceptance | TODO |
| TLS private key | `certs/` or configured path | Company sysadmin | Before public/production use | TODO |
| OpenRouter/Gemini/provider keys | `.env` and/or provider registry | Company AI/platform owner | Before final acceptance | TODO |
| Ollama host access | Local service | Company sysadmin | During server access review | TODO |
| GLPI tokens | `.env`/integrations table/GLPI | GLPI owner | Before final acceptance | TODO |
| Telegram bot token | `.env`/integrations table/BotFather | Messaging owner | Before final acceptance | TODO |
| SMTP password/token | `.env`/integrations table/mail relay | Mail owner | Before final acceptance | TODO |
| LDAP bind password | AISOC integrations table | Identity owner | Before final acceptance | TODO |
| MISP API key | `.env`/MISP | Threat intel owner | Before final acceptance | TODO |
| Server SSH access | Server/IAM | Company sysadmin | Immediately after acceptance | TODO |
| GitHub access | Repo/org settings | Company repo owner | Immediately after acceptance | TODO |

### Known Security Items To Disclose

- `JWT_SECRET` has a code fallback. Production must set a strong secret in `.env`.
- Secrets must not be transferred through chat, email, or screenshots.
- Integration secrets may exist in the SQLite integrations table depending on how settings were saved.
- External AI provider keys must be company-owned, not personal/free personal accounts.
- Any account used by the original developer must be disabled or converted to a company-owned account after transfer.
- Wazuh API keys should be regenerated after the company takes ownership.
- TLS certificates should be reissued or validated by the company.

## 9. Known Limitations And Risks

- The project is primarily a monolithic Node.js app; scaling beyond one node requires additional design.
- SQLite is suitable for a single-node deployment but needs careful backup discipline.
- Some documentation and branding may still need alignment across files.
- `.env.example` may not list every runtime variable; Section 6 should be used until `.env.example` is updated.
- External LLM provider availability and quota can affect analysis quality.
- Semantic memory depends on local Ollama for embeddings; if Ollama is down, the platform should degrade but recall quality drops.
- Wazuh alert flow depends on a custom script on the Wazuh Manager, which is outside the repo unless explicitly copied.
- Automated tests/CI should be added before production-critical use.
- The frontend has large components and would benefit from modularization for long-term maintenance.

## 10. Improvement Roadmap

Recommended post-handover work:

| Priority | Improvement | Reason |
|---|---|---|
| P0 | Update `.env.example` to include all runtime variables | Reduces installation errors. |
| P0 | Add a production service file and deployment guide | Makes restart and recovery repeatable. |
| P0 | Copy/version the Wazuh integration script in the repo | Prevents loss of the ingest path. |
| P0 | Add backup/restore automation | Protects operational alert history. |
| P1 | Add automated tests for auth, ingest, and orchestration fallbacks | Reduces regression risk. |
| P1 | Add CI build/type-check pipeline | Ensures repo remains deployable. |
| P1 | Encrypt or externalize stored integration secrets | Improves security posture. |
| P1 | Align branding and README with the final company/project name | Makes documentation professional. |
| P2 | Split large frontend files into feature modules | Improves maintainability. |
| P2 | Consider indexed vector storage when incident volume grows | Improves semantic recall at scale. |

## 11. Support Terms And Contacts

### Support Window

- Start date: TODO
- End date: TODO
- Support channel: TODO: email/phone/ticketing
- Response time: TODO

### In Scope During Support Window

- Clarifying documentation.
- Explaining architecture and expected behavior.
- Helping diagnose issues that existed before acceptance.
- Supporting the first production restart/backup/restore exercise.

### Out Of Scope Unless Separately Agreed

- New features.
- Rewriting architecture.
- 24/7 incident response.
- Company infrastructure administration unrelated to AISOC.
- Fixing issues caused by unapproved changes after acceptance.

### Contacts

| Role | Name | Contact |
|---|---|---|
| Original developer | TODO | TODO |
| Company technical owner | TODO | TODO |
| Company SOC owner | TODO | TODO |
| Sysadmin/devops owner | TODO | TODO |
| Security/identity owner | TODO | TODO |

## 12. Acceptance Checklist

The company should complete this checklist before signing.

- [ ] Final version/commit hash recorded.
- [ ] Repository transferred to company ownership or copied to company-owned repo.
- [ ] Project builds successfully with `npm run build`.
- [ ] TypeScript check succeeds with `npm run lint`, or known failures are documented.
- [ ] App installed from scratch on a clean machine using only written docs.
- [ ] App starts and is reachable at the company URL.
- [ ] Company admin/SUPER_ADMIN account created and verified.
- [ ] Original developer account disabled, removed, or converted to company ownership.
- [ ] User creation tested.
- [ ] API key creation and revocation tested.
- [ ] Wazuh test alert reaches `/api/ingest`.
- [ ] Real or simulated alert flows Wazuh -> AISOC -> dashboard.
- [ ] AI orchestration run tested.
- [ ] Incident creation/escalation tested.
- [ ] Incident report export tested.
- [ ] GLPI/Telegram/SMTP integrations tested, if enabled.
- [ ] LDAP/AD login tested, if enabled.
- [ ] MISP enrichment tested, if enabled.
- [ ] Database backup completed.
- [ ] Database restore tested on a clean instance.
- [ ] All secrets rotated or scheduled with named owners.
- [ ] Original developer server access removed.
- [ ] Original developer GitHub/repo access removed if no longer needed.
- [ ] External API accounts moved to company ownership/billing.
- [ ] Support window dates agreed.

## 13. Sign-Off

By signing, the company confirms it has received the AISOC project assets listed above, understands the known limitations and security actions, and accepts operational ownership from the handover date.

| Party | Name | Role | Signature | Date |
|---|---|---|---|---|
| Original developer | TODO | TODO | TODO | TODO |
| Company representative | TODO | TODO | TODO | TODO |
| Technical receiver | TODO | TODO | TODO | TODO |

