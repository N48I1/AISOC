# Current AI Agents Workflow (As Implemented Today)

## Short answer first: **yes, LangGraph is actually used**

The backend orchestration in `agents.ts` builds a real `StateGraph` from `@langchain/langgraph`, compiles it, and executes it with:

- `const workflow = new StateGraph(...) ...`
- `export const swarmGraph = workflow.compile();`
- `const result = await swarmGraph.invoke({ alert, recentAlerts });`

So the full 7-phase flow is truly running through LangGraph right now.

---

## 1. Where the AI logic lives

### Backend orchestration
- File: `agents.ts`
- Responsibility:
  - Create LLM clients (OpenRouter via `ChatOpenAI`)
  - Define 7 agent nodes
  - Define LangGraph state + edges
  - Expose:
    - `runPhase(phase, state)` for one phase
    - `runOrchestration(alert, recentAlerts)` for full 7-phase flow

### API integration
- File: `server.ts`
- Endpoints:
  - `POST /api/ai/agent` → runs one phase (`runPhase`)
  - `POST /api/ai/orchestrate` → runs full graph (`runOrchestration`) and persists results to DB

### Frontend triggers
- Files: `src/services/aiService.ts`, `src/App.tsx`
- Behavior:
  - Automatically runs orchestration for alerts with status `NEW`
  - Allows analyst to run one phase or run all phases manually from the alert detail UI

---

## 2. Model/provider configuration right now

In `agents.ts`:

- Provider path: OpenRouter (`baseURL: "https://openrouter.ai/api/v1"`)
- API key env: `OPENROUTER_API_KEY`
- Main model: `mistralai/mistral-7b-instruct`
- Validation model: `microsoft/phi-3-mini-128k-instruct:free`
- Temperature: `0.1`
- Retries: `maxRetries: 2`

If `OPENROUTER_API_KEY` is missing, code warns that calls will fail.

---

## 3. Core execution pattern for each agent

All nodes call `callLLM(systemPrompt, userPrompt, fallback, client?)`.

`callLLM` flow:
1. Sends system+human messages to model.
2. Parses response with `extractJSON(...)`.
3. If anything fails (model error, invalid JSON, parse issue), it logs error and returns the provided **fallback object**.

Important consequence: orchestration continues even when a phase fails, because fallback data is returned instead of throwing.

---

## 4. LangGraph state and topology

State keys in `SwarmState`:
- `alert`, `recentAlerts`
- `analysis`, `intel`, `knowledge`, `correlation`, `ticket`, `responsePlan`, `validation`
- `emailSent`

Graph node order (strictly sequential):
1. `node_triage` (analysis)
2. `node_intel`
3. `node_playbook`
4. `node_correlate`
5. `node_ticket`
6. `node_response`
7. `node_validate`

Edges are linear from `START` to `END`; there is no branching or parallel fan-out today.

---

## 5. What each of the 7 agents produces today

1. **analysis** (`alertAnalysisNode`)
   - Summary, IOC extraction (`ips/users/hosts`), severity validation, false-positive flag, confidence

2. **intel** (`threatIntelNode`)
   - MITRE ATT&CK techniques, risk score, threat actor type, campaign family, confidence

3. **knowledge** (`ragKnowledgeNode`)
   - Numbered remediation steps, playbook reference, containment priority, estimated effort, confidence

4. **correlation** (`correlationNode`)
   - Campaign detection over recent alerts (top 10 summarized), kill-chain stage, escalation flag, confidence

5. **ticketing** (`ticketingNode`)
   - Incident ticket title/body/priority/impact/affected systems + `email_notification_sent`

6. **response** (`responseNode`)
   - Action list (`BLOCK_IP`, `DISABLE_USER`, etc.), approval flag, estimated containment time, confidence

7. **validation** (`validationNode`)
   - SLA status, completeness score, missing elements, recommendation, confidence

---

## 6. Full orchestration request lifecycle (automatic path)

1. Alert is ingested via `POST /api/ingest` (`server.ts`), inserted into `alerts` table with status `NEW`.
2. Server emits `new_alert` socket event.
3. Frontend receives event, fetches alerts, finds the new alert, and calls `orchestrateAnalysis(...)`.
4. `orchestrateAnalysis` calls `POST /api/ai/orchestrate` with `{ alertId }`.
5. Backend endpoint:
   - Reads alert + recent alerts from SQLite
   - Sets alert status to `ANALYZING`
   - Calls `runOrchestration(alert, recentAlerts)` (LangGraph invoke)
   - Persists result fields into DB:
     - `status`
     - `ai_analysis` (JSON string containing multi-phase result bundle)
     - `mitre_attack` (JSON string)
     - `remediation_steps`
     - `email_sent`
   - Emits `alert_updated`
6. Frontend updates local state from socket/event response.

Error behavior:
- If `/api/ai/orchestrate` fails at endpoint level, backend resets status to `NEW`.
- If an individual node fails internally, fallback output is used and flow usually still completes.

---

## 7. Manual run modes (analyst-triggered)

In alert detail UI:

- **Run one phase**: calls `/api/ai/agent` with `{ phase, state }` → backend `runPhase(...)` switch calls the specific node directly (no full graph invoke).
- **Run all phases**: frontend loops through phase IDs sequentially and calls `/api/ai/agent` repeatedly, then writes one combined update.

So there are two execution patterns:
- Full orchestration endpoint uses real LangGraph graph execution.
- Manual phase endpoints use direct node execution (still same node logic/prompts).

---

## 8. Current output composition rules

`runOrchestration(...)` returns:
- `ai_analysis`: stringified object with:
  - summary/iocs/intel summary/correlation name
  - ticket
  - response
  - validation status
  - `phaseData` with raw outputs from all 7 phases
- `mitre_attack`: JSON string array
- `remediation_steps`: plain text
- `email_sent`: `1` or `0`
- `status`: `FALSE_POSITIVE` if analysis says true, else `TRIAGED`

---

## 9. What this means practically right now

- Yes, it is a real 7-agent pipeline with LangGraph.
- The chain is linear and deterministic in order.
- Robustness comes from fallback objects, not strict validation.
- Quality can appear "successful" even when one or more phases degraded to fallback data.
- Frontend auto-orchestration and manual orchestration both actively use this backend flow.
