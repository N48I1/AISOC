# AISOC — Manual

The AISOC manual is split by audience:

- 📘 **[User Manual](./USER-MANUAL.md)** — for the people who **operate** the platform
  (SOC analysts, incident leads, admins): roles, the eleven tabs, triage/investigation/
  incident workflows, response actions, reports, integrations, and a day-in-the-life
  playbook.

- 🛠️ **[Developer Manual](./DEVELOPER-MANUAL.md)** — for engineers who **run, maintain, and
  extend** the codebase: architecture, the React frontend internals, the backend, the
  PostgreSQL + pgvector data layer, the AI agent system, Socket.IO events, a **complete
  reference for all 128 API endpoints**, local setup, deployment, and how to extend each
  layer.

- ⚡ **[Commands & Troubleshooting Runbook](./COMMANDS.md)** — the quick command reference:
  starting the app, starting/checking the dependent services (PostgreSQL, Ollama, MISP),
  `troubleshoot.sh`, logs, and PostgreSQL backup/restore.

For deeper dives, both manuals link out to the [feature docs](./features/),
[diagrams](./diagrams/), [`MIGRATION-POSTGRES.md`](./MIGRATION-POSTGRES.md), and
[`HANDOVER.md`](./HANDOVER.md). See the **Documentation Map** at the end of either manual.
