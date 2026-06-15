# Agent Evaluation & Model Configuration

## What It Does

The Agent Evaluation system provides per-agent performance monitoring and lets administrators hot-swap LLM models for any agent phase without restarting the server. This enables:

- **A/B testing** — compare model performance by switching individual agents
- **Cost optimization** — use smaller models for simple phases, larger for complex ones
- **Fallback monitoring** — track when agents fail and how often they fall back to defaults
- **Confidence tracking** — monitor per-agent confidence scores over time

---

## Agent Phases

The system has 7 configurable LLM agent phases plus 2 deterministic workers and a planner:

### LLM Agents (configurable model)
| Phase | Agent Name | Default Model |
|-------|-----------|---------------|
| `analysis` | Alert Triage Agent | Nemotron Super 120B (Free) |
| `intel` | Threat Intelligence Agent | Nemotron Super 120B (Free) |
| `knowledge` | RAG Knowledge Agent | Nemotron Super 120B (Free) |
| `correlation` | Correlation Agent | Nemotron Super 120B (Free) |
| `ticketing` | Ticketing Agent | Nemotron Super 120B (Free) |
| `response` | Response Agent | Nemotron Super 120B (Free) |
| `validation` | Validation Agent | Nemotron Super 120B (Free) |

### Non-LLM Workers (not configurable)
| Phase | Agent Name | Description |
|-------|-----------|-------------|
| `recall` | Semantic Recall | pgvector cosine-similarity search (HNSW) |
| `ioc_check` | IOC History Check | Lookup in ioc_memory table |

### Planner
| Phase | Agent Name | Default Model |
|-------|-----------|---------------|
| `planner` | Swarm Planner | Llama 3.2 3B Instruct (Free) |

The planner uses a small, fast model since it only makes routing decisions (which agents to dispatch), not deep analysis.

---

## Available Models

All models are sourced from OpenRouter's free tier:

| Model | ID |
|-------|-----|
| GPT-OSS 120B | `openai/gpt-oss-120b:free` |
| GPT-OSS 20B | `openai/gpt-oss-20b:free` |
| Llama 3.3 70B Instruct | `meta-llama/llama-3.3-70b-instruct:free` |
| Llama 3.2 3B Instruct | `meta-llama/llama-3.2-3b-instruct:free` |
| Hermes 3 Llama 405B | `nousresearch/hermes-3-llama-3.1-405b:free` |
| Gemma 3 27B IT | `google/gemma-3-27b-it:free` |
| Gemma 3 12B IT | `google/gemma-3-12b-it:free` |
| Nemotron Super 120B | `nvidia/nemotron-3-super-120b-a12b:free` |
| Qwen3 Coder | `qwen/qwen3-coder:free` |

### Local LLM Support

The platform also supports local LLMs via Ollama:

```
GET  /api/local-llm/config          # Get current Ollama base URL
PATCH /api/local-llm/config         # Set Ollama base URL
GET  /api/local-llm/models          # List models available on Ollama
POST /api/local-llm/test            # Test Ollama connectivity
```

---

## Agent Statistics

The system tracks per-agent performance metrics:

### Metrics Tracked
- **Call count** — how many times each agent has been invoked
- **Average confidence** — mean confidence score across all runs
- **Average latency** — mean execution time in milliseconds
- **Fallback count** — how many times the agent returned fallback defaults (LLM failure)
- **Fallback rate** — `fallback_count / call_count`
- **Skip count** — how many times the planner decided to skip this agent

### API
```
GET /api/ai/agent-stats
```

Returns per-phase statistics extracted from `agent_runs` data.

---

## Model Hot-Swapping

### From the UI
Navigate to **Settings** → **Agent Configuration**. Each agent phase shows:
- Current model assignment
- Dropdown to select a different model
- Performance stats (confidence, latency, fallback rate)

### Via API
```
GET  /api/ai/models                          # List all phase→model assignments
PATCH /api/ai/models/:phase                  # Update model for a phase
      { "model": "google/gemma-3-27b-it:free" }
```

Changes take effect immediately for the next orchestration run.

---

## Running Individual Agents

For testing or debugging, you can run a single agent phase on any alert:

```
POST /api/ai/agent
{
  "alertId": "alert-123",
  "phase": "intel",
  "model": "google/gemma-3-27b-it:free"   // optional override
}
```

This runs just that one agent and returns its output, without triggering the full pipeline.

---

## Analyst Feedback

Analysts can provide feedback on investigation quality:

```
POST /api/feedback
{
  "alertId": "alert-123",
  "feedback": "accurate",          // or "inaccurate", "partial"
  "notes": "MITRE mapping was spot on"
}
```

Feedback is stored and used to track agent accuracy over time. When an alert is marked as `FALSE_POSITIVE` via feedback, the IOC memory is updated with incremented `fp_count`.

---

## Files Involved

```
agents/config.ts                ← Phase definitions, model defaults, metadata
agents/shared/llm.ts            ← callStructuredLLM() with retry + fallback tracking
agents/shared/client.ts         ← OpenRouter / Ollama HTTP client
server.ts                       ← /api/ai/models, /api/ai/agent-stats, /api/ai/agent
src/App.tsx                     ← AgentsTab component
```
