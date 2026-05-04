# Hub-and-Swarm Orchestration

## What It Does

The Hub-and-Swarm is the core AI pipeline that processes every alert. Instead of running all 9 agents in a fixed sequence, a central **Planner LLM** dynamically decides which investigators to dispatch based on the specific alert context, then runs composers sequentially to produce the final output.

This saves tokens, reduces latency, and allows the system to skip unnecessary work — for example, skipping all investigation for confirmed false positives.

---

## Architecture

```
Alert arrives
     │
     ▼
Step 0: Suppression Rules (instant, no LLM)
     │ → If matched: auto-FP, done
     ▼
Step 1: Pre-flight Memory Recall (deterministic, parallel)
     │ → Semantic recall, IOC lookup, asset context
     ▼
Step 2: Mandatory Triage (LLM — analysis node)
     │ → IOC extraction, risk score, FP assessment
     │ → If high-confidence FP: short-circuit, done
     ▼
Step 3: Planner LLM
     │ → Decides which investigators to run
     │ → Decides which composers to skip
     ▼
Step 4: Investigators (parallel swarm)
     │ → intel, knowledge, correlation, recall, ioc_check
     ▼
Step 5: Optional Reflection (2nd planner round)
     │ → Can dispatch more investigators if new evidence found
     ▼
Step 6: Composers (sequential)
     │ → ticketing → response → validation
     ▼
Step 7: Memory Commit
     │ → IOC memory, semantic store, insights
     ▼
Done — output returned to UI
```

---

## Agent Roles

### Investigators (run in parallel)
| Agent | Type | Description |
|-------|------|-------------|
| `intel` | LLM | Enriches IOCs via MISP, assigns MITRE ATT&CK techniques |
| `knowledge` | LLM | Retrieves remediation playbooks for the attack category |
| `correlation` | LLM | Detects multi-stage campaigns in 72h alert window |
| `recall` | Deterministic | Semantic similarity search against past incidents |
| `ioc_check` | Deterministic | Looks up IOCs in the internal observation history |

### Composers (run sequentially)
| Agent | Type | Description |
|-------|------|-------------|
| `ticketing` | LLM | Drafts incident ticket, sends GLPI/Telegram notifications |
| `response` | LLM | Plans containment actions (block IP, isolate host, etc.) |
| `validation` | LLM | SLA compliance check and quality assurance |

---

## Files Involved

```
agents/
├── orchestrator.ts           ← runHubAndSwarm() — the main pipeline
├── planner.ts                ← Planner LLM that decides which agents to run
├── config.ts                 ← Model assignments, phase names, defaults
├── index.ts                  ← runOrchestration() entry point
├── nodes/
│   ├── analysis.ts           ← Mandatory triage agent
│   ├── intel.ts              ← Threat intelligence enrichment
│   ├── knowledge.ts          ← Remediation playbook retrieval
│   ├── correlation.ts        ← Multi-stage campaign detection
│   ├── recall.ts             ← Semantic memory recall (no LLM)
│   ├── ioc_check.ts          ← IOC history lookup (no LLM)
│   ├── ticketing.ts          ← Incident ticket drafting
│   ├── response.ts           ← Containment action planning
│   └── validation.ts         ← SLA and quality validation
├── memory/
│   ├── store.ts              ← Semantic vector store
│   ├── ioc.ts                ← IOC observation history
│   ├── working.ts            ← Per-run scratchpad
│   ├── insights.ts           ← Insight commitment (fire-and-forget)
│   ├── assets.ts             ← Known infrastructure registry
│   ├── suppression.ts        ← Suppression rules engine
│   └── learning.ts           ← Auto-learning from FP patterns
└── shared/
    ├── llm.ts                ← callStructuredLLM() with retry + fallback
    ├── client.ts             ← OpenRouter / Ollama HTTP client
    └── types.ts              ← Shared type definitions
```

---

## How to Trigger

1. **From the UI:** Open any alert → click "Run Agents"
2. **Via API:** `POST /api/ai/orchestrate` with `{ "alertId": "<alert-id>" }`
3. **Auto-trigger:** New alerts ingested via `/api/ingest` can auto-trigger orchestration

---

## Operational Modes

Set via `AGENT_MODE` environment variable:

- **`swarm`** (default): Dynamic Hub-and-Swarm described above
- **`linear`** (legacy): Sequential 7-node chain where every agent runs in order
