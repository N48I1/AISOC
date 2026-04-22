# Alert Triage Agent — Technical Deep-Dive

## What It Is

The Alert Triage Agent is **Agent #1** in the 7-agent AI swarm. It is the entry point for every analysis pipeline. Its job is to look at a raw Wazuh security alert and answer five questions:

1. What is this alert actually about? (summary)
2. What indicators of compromise (IOCs) are present?
3. How severe is it really, and where does it sit in the attack lifecycle?
4. Is this a false positive?
5. What should the SOC analyst do next?

Every other agent in the chain (Threat Intel, Knowledge, Correlation, Ticketing, Response, Validation) receives the output of this agent as context — so the quality of triage directly affects the quality of the entire swarm's output.

---

## Files Involved

```
agents/
├── config.ts                  ← model assignment, phase names
├── workflow.ts                ← LangGraph pipeline wiring
├── index.ts                   ← runOrchestration() and runPhase()
├── nodes/
│   └── analysis.ts            ← THE AGENT (schema + prompt + function)
└── shared/
    ├── client.ts              ← OpenRouter HTTP client (LangChain)
    └── llm.ts                 ← callStructuredLLM() with retry logic

server.ts                      ← POST /api/ai/orchestrate (triggers it)
src/App.tsx                    ← renders the results in the UI
```

---

## End-to-End Flow

```
User clicks "Run All" or "Run" on the Analysis agent card
        │
        ▼
src/App.tsx  →  POST /api/ai/orchestrate  { alertId }
        │
        ▼
server.ts
  1. Fetches the alert row from SQLite (alerts table)
  2. Fetches up to 50 recent alerts from the same DB (for context)
  3. Sets alert.status = 'ANALYZING' → broadcasts via Socket.IO
  4. Calls runOrchestration(alert, recentAlerts)
        │
        ▼
agents/index.ts  →  buildSwarmGraph().invoke({ alert, recentAlerts })
        │
        ▼
agents/workflow.ts  (LangGraph StateGraph)
  START → node_triage → node_intel → node_playbook → node_correlate
       → node_ticket → node_response → node_validate → END
        │
        │  ← THIS is where the Alert Triage Agent runs
        ▼
agents/nodes/analysis.ts  →  alertAnalysisNode(state, model)
        │
        ▼
agents/shared/llm.ts  →  callStructuredLLM(...)
        │
        ▼
agents/shared/client.ts  →  ChatOpenAI (OpenRouter API)
        │
        ▼
LLM responds with JSON
        │
        ▼
Zod schema validates the response
        │
        ▼
Returns { analysis: { ... } }  into LangGraph state
        │
        ▼
The next 6 agents receive this state and continue
        │
        ▼
server.ts saves final result to SQLite, broadcasts via Socket.IO
        │
        ▼
src/App.tsx receives the update, renders the analysis card
```

---

## The Agent Function: `alertAnalysisNode`

**File:** `agents/nodes/analysis.ts`

```ts
export async function alertAnalysisNode(state: any, model: string): Promise<{ analysis: ... }>
```

**Input — `state` object:**
- `state.alert` — the full alert row from SQLite (includes `id`, `timestamp`, `severity`, `source_ip`, `agent_name`, `rule_id`, `description`, `data` as a JSON column)
- `state.recentAlerts` — up to 50 other alerts from the DB, used to detect repeated patterns

**What it does, step by step:**

### Step 1 — Build the related alerts context
```ts
const related = (state.recentAlerts || [])
  .filter((r) => r.id !== a.id)   // exclude current alert
  .slice(0, 5)                     // take at most 5
  .map((r) => ({                   // extract only the useful fields
    id, rule_id, description, level, src_ip, agent, timestamp
  }));
```
This is used so the LLM can spot if the same source IP has triggered 3+ alerts recently (a FP or campaign signal).

### Step 2 — Build the user prompt
Instead of dumping the raw alert as `JSON.stringify(alert)`, it structures the key fields as labelled lines:
```
ALERT TO TRIAGE:
- ID: wazuh-001
- Agent: web-server-01 (203.0.113.45)
- Rule ID: 5712 | Level: 10 | Description: SSH brute force
- Source IP: 203.0.113.45 | Dest IP: N/A
- User: root
- Full data: { ... full JSON ... }

RECENT RELATED ALERTS (same agent or source IP):
[ { id, rule_id, level, src_ip, agent, timestamp }, ... ]
```

### Step 3 — Call the LLM
```ts
const analysis = await callStructuredLLM({
  phase: "analysis",
  model,                    // e.g. "openai/gpt-oss-120b:free"
  schema: AnalysisSchema,   // Zod schema (validation gate)
  systemPrompt: SYSTEM_PROMPT,
  userPrompt,
  fallback: { ... },        // returned if LLM fails/times out
});
```

### Step 4 — Return into the swarm state
```ts
return { analysis };
// analysis is now available to all downstream agents as state.analysis
```

---

## The System Prompt (What the LLM Is Told)

The system prompt is a set of deterministic rules the LLM must follow. It is not vague — it gives the LLM explicit thresholds and decision logic:

### Severity Thresholds (Wazuh rule.level)
| Level range | Severity | Example |
|---|---|---|
| ≥ 13 | CRITICAL | Rootkit detected, mass brute force |
| 10–12 | HIGH | Privilege escalation, malware execution |
| 7–9 | MEDIUM | Brute force attempt, policy violation |
| 1–6 | LOW | Informational, low-risk anomaly |

### False Positive Detection Rules
The LLM is told to flag `is_false_positive: true` when ANY of these conditions hold:
- `rule.description` contains "test", "scan", "nmap", or "healthcheck"
- `agent.name` contains "monitoring", "backup", or "scanner"
- `src_ip` is a private/internal IP (RFC1918: `10.x`, `172.16–31.x`, `192.168.x`) AND `rule.level < 8`
- 3+ identical alerts from the same source IP appear in `recentAlerts` with no escalation pattern
- `data.program_name` matches known maintenance programs (cron, logrotate, backup scripts)

### Risk Score Formula (0–100)
```
base      = rule.level × 6        (max 78)
+10       if lateral movement signals
+10       if credential access category
+5        if external/non-RFC1918 source IP
-20       if is_false_positive = true
→ clamp to [0, 100]
```

### Recommended Action Decision Tree
```
false_positive_confidence > 0.85  →  IGNORE
risk_score ≥ 80                   →  BLOCK
risk_score ≥ 60                   →  CONTAIN
risk_score ≥ 50                   →  ESCALATE
risk_score ≥ 20                   →  INVESTIGATE
otherwise                         →  MONITOR
```

### IOC Extraction Rules
The LLM is told exactly which JSON paths to look in for each IOC type:

| IOC type | Source fields |
|---|---|
| `ips` | `data.srcip`, `data.dstip`, `data.win.eventdata.destinationIp` |
| `users` | `data.dstuser`, `data.srcuser`, `data.win.eventdata.targetUserName` |
| `hosts` | `agent.name`, `data.hostname`, `data.win.system.computer` |
| `hashes` | Any 32/40/64-char hex string (MD5 / SHA1 / SHA256) |
| `files` | `data.win.eventdata.image`, `data.file`, `data.audit.file.name` |
| `ports` | `data.dstport`, `data.srcport` (integers, 0 excluded) |
| `domains` | `data.win.eventdata.destinationHostname`, DNS query names |
| `processes` | `data.win.eventdata.parentImage`, `data.audit.command` |

---

## The Output Schema (What the LLM Must Return)

Defined in `analysis.ts` using Zod. Every field is validated before the result is accepted.

```ts
{
  analysis_summary:          string,          // 2-4 sentence technical description

  iocs: {
    ips:       string[],
    users:     string[],
    hosts:     string[],
    hashes:    string[],
    files:     string[],
    ports:     number[],
    domains:   string[],
    processes: string[],
  },

  attack_category:           enum(14 MITRE tactics),
  // INITIAL_ACCESS | EXECUTION | PERSISTENCE | PRIVILEGE_ESCALATION |
  // DEFENSE_EVASION | CREDENTIAL_ACCESS | DISCOVERY | LATERAL_MOVEMENT |
  // COLLECTION | EXFILTRATION | COMMAND_AND_CONTROL | IMPACT |
  // RECONNAISSANCE | RESOURCE_DEVELOPMENT

  kill_chain_stage:          enum(7 stages),
  // RECONNAISSANCE | WEAPONIZATION | DELIVERY | EXPLOITATION |
  // INSTALLATION | C2 | ACTIONS_ON_OBJECTIVES

  risk_score:                number (0–100),
  severity_validation:       "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  recommended_action:        "MONITOR" | "INVESTIGATE" | "CONTAIN" | "ESCALATE" | "BLOCK" | "IGNORE",
  is_false_positive:         boolean,
  false_positive_reason:     string (optional, only when FP),
  false_positive_confidence: number (0–1),
  confidence:                number (0–1),
}
```

---

## How the LLM Call Works: `callStructuredLLM`

**File:** `agents/shared/llm.ts`

This function wraps the raw LLM call with three layers of protection:

### 1. Retry loop (up to 3 attempts)
```
Attempt 1  →  if 429 rate-limit: wait 8s  →  Attempt 2
Attempt 2  →  if 429 rate-limit: wait 16s →  Attempt 3
Attempt 3  →  if still failing: return fallback
```

### 2. JSON extraction
The LLM response is a raw string. The function strips markdown code fences (` ```json ... ``` `) if present, then slices from the first `{` to the last `}` to extract the JSON object.

### 3. Zod schema validation
The extracted JSON is passed through the Zod schema. If it fails (a field is missing, wrong type, or out of range), the **fallback** is returned instead of crashing. The fallback is:
```ts
{
  analysis_summary: "Alert analysis unavailable — LLM did not respond.",
  iocs: { ips: [], users: [], hosts: [], hashes: [], files: [], ports: [], domains: [], processes: [] },
  attack_category: "EXECUTION",
  kill_chain_stage: "DELIVERY",
  risk_score: 0,
  severity_validation: "MEDIUM",
  recommended_action: "INVESTIGATE",
  is_false_positive: false,
  false_positive_confidence: 0,
  confidence: 0,
}
```

---

## How the HTTP Client Is Configured

**File:** `agents/shared/client.ts`

```
ChatOpenAI (LangChain)
  model:       "openai/gpt-oss-120b:free"   (from agents/config.ts)
  temperature: 0.1                           (deterministic, not creative)
  maxRetries:  0                             (retries handled manually in llm.ts)
  baseURL:     https://openrouter.ai/api/v1  (OpenRouter, not OpenAI)
  apiKey:      process.env.OPENROUTER_API_KEY
```

Clients are cached in a `Map<model, client>` so the same model always reuses the same connection object.

---

## Model Selection

**File:** `agents/config.ts`

The default model for the analysis phase is set in:
```ts
export const DEFAULT_AGENT_MODELS = {
  analysis: "openai/gpt-oss-120b:free",
  ...
};
```

This can be overridden per-alert by the admin via the agent settings stored in SQLite (`agent_settings` table). The override is resolved by `resolveModelForPhase("analysis", assignments)` before the node is called.

---

## Where the Result Goes

After `alertAnalysisNode` returns `{ analysis }`, LangGraph merges it into the shared `SwarmState`. All downstream agents can then read `state.analysis`.

When the full swarm finishes, `runOrchestration` in `agents/index.ts` composes the final result:

```ts
const aiAnalysis = {
  summary: result.analysis?.analysis_summary,
  iocs:    result.analysis?.iocs,
  phaseData: {
    analysis: result.analysis,   // ← full output stored here
    intel:    result.intel,
    ...
  }
};
```

This JSON blob is saved to `alerts.ai_analysis` in SQLite. The triage agent's output specifically also controls:
- `alerts.status` → `"FALSE_POSITIVE"` if `is_false_positive === true`, otherwise `"TRIAGED"`
- `aiData.iocs` → the IOC collection shown in the Indicators section of the UI

---

## How It's Rendered in the UI

**File:** `src/App.tsx`

The analysis card in `AlertDetail` reads from:
```ts
const displayResult = getAgentDisplay('analysis');  // may be historical run
```

Fields rendered:
| UI element | Source field |
|---|---|
| Blue/purple badges | `attack_category`, `kill_chain_stage` |
| Risk score bar | `risk_score` (0–100, colour-coded) |
| Action chip | `recommended_action` |
| FP badge | `is_false_positive`, `false_positive_confidence` |
| FP reason text | `false_positive_reason` |
| Confidence badge | `confidence` |
| Summary text | `analysis_summary` |

The Detailed Report (modal) additionally shows:
- Validated severity badge (`severity_validation`)
- Full expanded IOC list with colour-coded chips per type (IPs, users, hosts, domains, processes, files, hashes, ports)
- All classification badges in the Executive Summary section

---

## What Happens on Re-Run

When you click **Rerun** on the analysis card specifically (not Run All), the frontend calls:
```
POST /api/ai/agent-run  { alertId, phase: "analysis" }
```

The server calls `runPhase("analysis", state)` from `agents/index.ts`, which calls `alertAnalysisNode` directly without running the other 6 agents. The result is pushed into the per-agent run history in React state, and you can navigate between runs with the `‹ N/M ›` counter.

---

## Key Design Decisions

**Why structured JSON output instead of free text?**
Every downstream agent and UI component needs to read specific fields programmatically. Free text would require a second parsing step with its own failure modes.

**Why Zod validation?**
LLMs sometimes output slightly malformed JSON or skip optional fields. Zod guarantees that code consuming the output will never get an unexpected type — it either passes fully or the fallback is used.

**Why pass `recentAlerts` instead of querying the DB from inside the agent?**
Agents are stateless functions. All DB access is done in `server.ts` before the swarm starts, then injected into the LangGraph state. This keeps agents testable and decoupled from the database.

**Why `temperature: 0.1`?**
Triage decisions should be deterministic and rule-based, not creative. A low temperature makes the LLM follow the explicit rules in the system prompt more consistently instead of improvising.
