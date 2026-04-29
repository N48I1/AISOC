# Aegis SOC Platform: Project Overview

## What This Project Is

This repository is a full-stack Security Operations Center (SOC) demo platform named **Aegis SOC Platform**.

It combines:

- A React + Vite frontend for analysts
- An Express + Socket.IO backend
- A local SQLite database for alerts, users, and incidents
- A multi-agent **Hub-and-Swarm** orchestration pipeline built with specialized workers
- Utility scripts for ingesting sample Wazuh-style alerts

The main use case is:

1. Ingest Wazuh-like alerts into the backend
2. Store them in SQLite
3. Stream updates to the frontend in real time
4. Run AI analysis across dynamic agent phases (Triage, Investigation, Composition)
5. Present triage, MITRE mapping, remediation, ticketing, and report generation in the UI

## High-Level Architecture

### Frontend
... (rest of frontend section) ...

### Backend
- Main server: `server.ts`
- AI orchestration workflow: `agents/` (modular hub-and-swarm design)

The backend handles:
... (rest of backend section) ...

## AI Intelligence Architecture

The project uses a sophisticated **Hub-and-Swarm** model for alert analysis. 

Key features:
- **Planner-led**: A central LLM planner dispatches specialized investigators in parallel.
- **Memory Tiers**: Semantic (embeddings), IOC history, and insight tracking.
- **Efficiency**: Short-circuits high-confidence false positives and skips unnecessary agents.
- **Multi-Model**: Robust fallback between OpenRouter (multiple providers) and local Ollama.

For detailed documentation, see: **[SOC_INTELLIGENCE_ARCHITECTURE.md](./SOC_INTELLIGENCE_ARCHITECTURE.md)**

## Main User Flow

### Authentication

- The server seeds a default admin account if it does not exist
- Username: `admin`
- Password: `admin123`

### Alert ingestion

- `POST /api/ingest`
- Stores incoming Wazuh-style alert data in `alerts`
- Emits `new_alert` over Socket.IO

### Alert analysis

- Frontend fetches alerts after login
- Any alert with status `NEW` is automatically sent to `/api/ai/orchestrate`
- The server runs the full agent workflow
- Updated results are written back to SQLite
- The server emits `alert_updated`

### Analyst workflow

From the UI, an analyst can:

- Review live alerts
- Open a detailed alert investigation pane
- Run agents one-by-one
- Run all agents in sequence
- Escalate, close, or mark false positive
- Open and download a generated Markdown incident report

## File Map

### Top-level files

- `README.md`: generic AI Studio bootstrap README, not project-specific
- `metadata.json`: app metadata for "Black Box SOC"
- `package.json`: scripts and dependencies
- `package-lock.json`: locked dependency tree
- `server.ts`: backend app, database setup, auth, routes, Socket.IO, Vite integration
- `agents.ts`: AI orchestration graph and phase implementations
- `generate-test-alerts.ts`: sends 12 realistic Wazuh-style test alerts
- `ingest-sample.ts`: sends a single sample alert
- `vite.config.ts`: Vite config with React and Tailwind plugin
- `tsconfig.json`: TypeScript config
- `index.html`: Vite HTML shell
- `.env.example`: sample environment variables
- `soc.db`: SQLite database

### Frontend source

- `src/main.tsx`: React bootstrap
- `src/App.tsx`: main application UI, auth flow, dashboard, alert queue, reports, agent controls
- `src/index.css`: Tailwind import and theme variables
- `src/types.ts`: `User`, `Alert`, `Incident`, `AuditLog` typings
- `src/services/aiService.ts`: thin client wrappers for `/api/ai/agent` and `/api/ai/orchestrate`

### Local-only / generated / vendor content

- `node_modules/`: installed dependencies
- `.git/`: git metadata
- `.claude/settings.local.json`: local tool permission config
- `soc.db-wal`, `soc.db-shm`: SQLite WAL artifacts

## API Endpoints

Defined in `server.ts`:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/alerts`
- `PATCH /api/alerts/:id`
- `POST /api/ingest`
- `POST /api/ai/agent`
- `POST /api/ai/orchestrate`

Socket.IO events used by the frontend:

- `new_alert`
- `alert_updated`

## UI Structure

`src/App.tsx` is a large all-in-one file containing:

- auth context/provider
- sidebar
- header
- dashboard
- alert list row
- alert detail view
- detailed report modal
- reports page
- login page
- main authenticated shell

Tabs currently present:

- `dashboard`
- `alerts`
- `incidents`
- `agents`
- `reports`
- `settings`

Some sections are fully functional, while others are mostly static/demo UI:

- `alerts`: functional
- `dashboard`: mostly driven by alert data with some hardcoded stats
- `reports`: functional summary view
- `incidents`: mostly static placeholder content
- `agents`: mostly static configuration view
- `settings`: placeholder

## Dependencies That Matter Most

Core runtime libraries from `package.json`:

- `react`, `react-dom`
- `vite`
- `express`
- `socket.io`, `socket.io-client`
- `better-sqlite3`
- `jsonwebtoken`
- `bcryptjs`
- `dotenv`
- `@langchain/core`
- `@langchain/langgraph`
- `@langchain/openai`
- `@langchain/google-genai`
- `@google/genai`
- `zod`
- `lucide-react`
- `motion`

## Notable Mismatches And Observations

These are important if you continue developing this project:

- `README.md` is boilerplate and still references AI Studio/Gemini rather than the actual current stack.
- `.env.example` mentions `GEMINI_API_KEY`, but `agents.ts` currently uses `OPENROUTER_API_KEY`.
- The frontend "AI Agent Swarm Configuration" view says agents use "Gemini 3 Flash", but the backend actually uses OpenRouter with a model from `AI_MODEL`.
- `index.html` still uses the title `My Google AI Studio App`.
- `metadata.json` says "Black Box SOC" while the UI branding says "AEGIS SOC PLATFORM".
- `src/App.tsx` is very large and mixes many concerns into one file.
- The local `better-sqlite3` install is compiled for Node 20, while the default shell Node is 18 in this environment. That matters for local runtime commands unless Node 20 is used.

## Run Notes

From `package.json`:

- `npm run dev`: starts the server through `tsx server.ts`
- `npm run build`: runs Vite build
- `npm run preview`: previews the built app
- `npm run lint`: runs `tsc --noEmit`

The backend serves the frontend in two modes:

- Development: Vite middleware from the Express server
- Production: static files from `dist/`

## Recommended Next Documentation Updates

If you want to improve the repo further, the most useful follow-ups would be:

- replace the boilerplate `README.md` with a real project README
- split `src/App.tsx` into feature-based components
- align branding across `README.md`, `metadata.json`, `index.html`, and UI labels
- align environment variable docs with actual backend usage
- document the expected alert payload format for `/api/ingest`
