# Knowledge Base — Workflow & Agent Memory Loop

This document describes the **end-to-end workflow** of the Knowledge Base: how memory gets written, how AI agents read from it during investigations, and how the loop closes through analyst feedback. It is structured for direct ingestion into a diagramming tool (e.g. eraser.io) — every flow is broken into discrete **actors → action → target** steps.

> **Companion docs:**
> - [`10-memory-system.md`](./10-memory-system.md) — the backend memory tiers
> - [`11-knowledge-base.md`](./11-knowledge-base.md) — the UI surface

---

## 1. Components (Actors & Systems)

| ID | Name | Type | Role |
|----|------|------|------|
| `analyst` | SOC Analyst | Human actor | Browses KB, marks FP/TP, authors playbooks |
| `wazuh` | Wazuh Manager | External system | Sends raw alerts via webhook |
| `server` | AISOC Server | Backend (Node/Express) | Routes, auth, orchestrator entry point |
| `orchestrator` | Agent Orchestrator | LangGraph pipeline | Sequences agent nodes per investigation |
| `triage` | Triage Agent | LLM node (`analyzeNode`) | Interprets alert + memory hints |
| `intel` | Threat Intel Agent | LLM node (`intelNode`) | MITRE mapping, threat actor inference |
| `knowledge` | Knowledge Agent | LLM node (`ragKnowledgeNode`) | Pulls playbooks → remediation steps |
| `correlate` | Correlation Agent | LLM node (`correlateNode`) | Cross-alert campaign detection |
| `ticket` | Ticketing Agent | LLM node (`ticketNode`) | Builds the report `ticket` |
| `response` | Response Agent | LLM node (`responseNode`) | Suggests/dispatches actions |
| `validate` | Validation Agent | LLM node (`validateNode`) | Final review |
| `recall` | Recall Pre-flight | Pure function | Pulls memory hints before triage |
| `ollama` | Ollama Server | External (localhost:11434) | `nomic-embed-text` embedding model |
| `db` | PostgreSQL (`soc` db) | Database | All persistence |
| `ui_kb` | KnowledgeBaseTab | Frontend (React) | Browse playbooks / incidents / IOCs |
| `learning` | Learning Loop | Background scanner | Promotes high-FP IOCs to suggestions |

### Database tables (memory tier)

| Table | Purpose | Written by | Read by |
|-------|---------|-----------|---------|
| `playbooks` | Manually authored response procedures | `analyst` (via UI) | `knowledge` |
| `incident_insights` | Distilled past investigations + 768-dim embedding (`vector(768)`) | `orchestrator` (post-investigation) | `recall`, `ui_kb` |
| `ioc_memory` | Indicator history with FP/TP counts | `orchestrator` (per IOC seen), `learning` | `recall`, `triage`, `ui_kb` |
| `asset_context` | Curated infrastructure (FP-by-default) | `analyst`, `learning` (auto-promote) | `recall`, `triage` |
| `suppression_rules` | Pattern-based deterministic FP filter | `analyst`, `learning` | `orchestrator` (pre-triage) |
| `working_memory` | Per-alert planner scratchpad | `orchestrator` (each phase) | Debug / audit only |

---

## 2. Workflow A — **Memory READ** (during a new investigation)

> Trigger: An alert is investigated (manually or auto-orchestrated). The agents consult memory **before** spending LLM tokens.

### Sequence

```
1. wazuh        → server         : POST /api/ingest (raw alert)
2. server       → db             : INSERT INTO alerts
3. server       → orchestrator   : runOrchestration(alert, recentAlerts)
4. orchestrator → db             : SELECT * FROM suppression_rules
   ├── 4a. If pattern matches → status='FILTERED' → STOP
   └── 4b. Otherwise → continue
5. orchestrator → recall         : preFlight(alert)
6. recall       → db             : lookupIocs(values)        → ioc_memory
7. recall       → db             : lookupAssetContext(values) → asset_context
8. recall       → ollama         : embed(alert.description)
9. ollama       → recall         : Float32Array[768]
10. recall      → db             : semanticStore.search(embedding, k=5, minSim=0.65)
11. db          → recall         : top-k incident_insights rows
12. recall      → orchestrator   : { iocHits, assetCtx, similarPast, fpHints }
13. orchestrator → triage        : invoke(alert, memoryContext)
14. triage      → ollama (LLM)   : prompt with memory blocks injected
15. triage      → orchestrator   : { is_false_positive, severity_assessment, ... }
16. orchestrator → intel → knowledge → correlate → ticket → response → validate
    └── (each agent receives accumulated state including memory hints)
17. orchestrator → ticket        : ticket = { title, priority, report_body, confidence }
```

### Memory-into-prompt injection points

| Memory source | Injected into | What the LLM sees |
|--------------|--------------|-------------------|
| `iocHits` | `triage` prompt | `"IOC 192.168.1.50 seen 12× before, FP ratio 25%, threat=MEDIUM"` |
| `assetCtx` | `triage` prompt | `"Source IP 172.10.9.10 = OpenVAS scanner [fp_default=TRUE]"` |
| `similarPast` | `triage` prompt | `"Previously seen: Brute force on SSH (similarity 0.87), outcome=TRIAGED"` |
| `playbooks` (by tactic) | `knowledge` prompt | `"Playbook 'Brute Force Response': 1. Block IP 2. Lock account..."` |

### Decision branches in this flow

```
suppression_rules match? ──→ FILTERED (skip everything, write fp_method='suppression')
                          │
                          └──→ continue to recall
                                │
                                ├── fpSimilar (sim ≥ 0.85, prior outcome was FP)
                                │      ──→ memoryFP fast-path → status='FALSE_POSITIVE'
                                │
                                └── normal path → triage → ... → ticket
```

---

## 3. Workflow B — **Memory WRITE** (after every investigation)

> Trigger: Investigation completes (success or failure). Memory is updated **fire-and-forget** (does not block the user response).

### Sequence

```
1. orchestrator → db    : UPDATE alerts SET ai_analysis=..., status='TRIAGED'
2. orchestrator → db    : INSERT INTO agent_runs (snapshot)
3. orchestrator ─┬─→ insights.commitInsightAsync(state)
                 ├─→ for each IOC in alert: ioc.upsertIoc(value, type, outcome)
                 └─→ working.flushTrace(traceId)

4. commitInsightAsync:
   4a. Build summary text (combines triage.summary + ticket.title + intel.attack_pattern)
   4b. → ollama : POST /api/embeddings { model: "nomic-embed-text", prompt: summary }
       └── If Ollama down → embedding = null (row still inserted, just unsearchable semantically)
   4c. ollama → 768-dim Float32Array
   4d. → db    : INSERT INTO incident_insights (alert_id, summary, attack_pattern,
                                               threat_actor, outcome, ttp_tags,
                                               embedding vector(768), triggered_by)

5. upsertIoc (per IOC found):
   5a. → db    : SELECT * FROM ioc_memory WHERE value=?
   5b. If row exists: UPDATE alert_count++, last_seen=now, fp_count or tp_count++
   5c. If new:        INSERT with alert_count=1
```

### Outcome → IOC counter mapping

```
investigation.outcome === 'FALSE_POSITIVE' || 'FP_CONFIRMED'  ──→ fp_count++
investigation.outcome === 'TRIAGED' || 'ESCALATED' || 'INCIDENT' ──→ tp_count++
investigation.outcome === 'CLOSED'                              ──→ no counter change
```

### `triggered_by` taxonomy (which phase wrote the insight)

| Value | Written when |
|-------|--------------|
| `triage` | Normal path — triage agent reached a verdict |
| `memoryFP` | Fast-path FP via similarity match (skipped most of the pipeline) |
| `composer` | Manual override or analyst-confirmed FP |
| `suppression` | Suppression rule fired |

---

## 4. Workflow C — **UI Browse** (analyst reading the KB)

> Trigger: Analyst clicks the **Knowledge Base** tab in the sidebar.

### Sequence

```
1. analyst    → ui_kb        : click "Knowledge Base"
2. ui_kb      → server       : GET /api/playbooks
3. ui_kb      → server       : GET /api/local-llm/test          (RAG status indicator)
4. ui_kb      → server       : GET /api/memory/insights?limit=1 (count)
5. ui_kb      → server       : GET /api/memory/iocs/all?limit=1 (count)
6. server     → db           : SELECT/COUNT respective tables
7. db         → server → ui_kb: stat counts + RAG status

[Analyst clicks "Incidents" sub-tab]
8.  ui_kb     → server       : GET /api/memory/insights?q=&outcome=&limit=100
9.  server    → db           : SELECT … WHERE summary LIKE ? ... ORDER BY created_at DESC
10. db        → server → ui_kb: rows + total

[Analyst types in search box]
11. ui_kb     → server       : GET /api/memory/insights?q="brute force"
    NOTE: substring SQL only. The 768-dim embeddings are NOT used by the UI search.
          Semantic search is reserved for the agent recall path (Workflow A, step 10).

[Analyst clicks alert ID chip on a card]
12. ui_kb     → React state  : setSelectedAlert(...) ; setActiveTab('investigation')
```

### Why the UI uses substring search but the agents use embeddings

```
Agents (Workflow A):
  query embedding (768d) → cosineSimilarity(stored_embedding) → top-k
  ──→ finds "credential stuffing" when query is "brute force"

UI (Workflow C):
  query string → SQL LIKE '%query%' on summary/attack_pattern/threat_actor
  ──→ literal match only
```

This asymmetry is intentional for v1. Wiring the UI search through the embedding path is a v2 task.

---

## 5. Workflow D — **Feedback Loop** (analyst teaches the system)

> Trigger: Analyst marks an alert as FP, escalates, overrides an FP, reclassifies an incident as FP, or accepts an FP suggestion.

### Sequence

```
1. analyst   → ui            : click "Confirm FP" / "Override FP" / "Escalate" / "Reclassify FP"
2. ui        → server        : POST /api/alerts/:id/confirm-fp        (FALSE_POSITIVE)
                               POST /api/alerts/:id/override-fp       (TRUE_POSITIVE)
                               POST /api/alerts/:id/escalate          (TRUE_POSITIVE)
                               POST /api/incidents/:id/reclassify-fp  (FALSE_POSITIVE — every linked alert)
3. server    → applyFeedbackToMemory(alertId, verdict, ctx)
                               ├── extractIocsForFeedback(alertId)
                               │     ├── triage_data JSON  (LLM-extracted IOCs — best)
                               │     ├── alert raw fields (source_ip, dest_ip, agent_name, hostname, user)
                               │     └── extractAssetValuesFromAlert (fallback)
                               └── reinforceFeedback(iocs, verdict)
                                     └── per-IOC UPDATE ioc_memory SET fp_count++ or tp_count++
                                         (TP override on auto-learned asset → revoke fp_default)
4. server    → processAutoLearning()    (ran inline, not just on the cron)
                               └── promote any IOC that just crossed
                                   fp_ratio ≥ 0.95 AND total ≥ 10
                                   into asset_context (source='auto-learned', fp_default=1)
5. server    → writeAudit       FP_CONFIRMED / FP_OVERRIDDEN / ALERT_ESCALATED / INCIDENT_RECLASSIFIED_FP
                               (logs IOC count and how many were auto-registered)

[Cron tick — every 5 minutes, in addition to the per-feedback inline call]
6. server    → processAutoLearning()    (safety net for non-analyst commits)

[FP suggestions UI — analyst can accept partially-confident promotions]
7. learning  → db          : SELECT FROM ioc_memory WHERE
                                  (fp_count + tp_count) >= 5
                              AND fp_count / (fp_count + tp_count) >= 0.85
8. ui (NoiseFilter) → server: GET /api/analytics/fp-suggestions
9. analyst    → ui         : click "Accept" on a suggestion
10. ui        → server     : POST /api/analytics/accept-suggestion
11. server    → db         : INSERT INTO asset_context (fp_default=1, source='manual')

[Next investigation that touches the same IOC]
12. recall   → db          : lookupAssetContext returns fp_default=1
13. triage   → LLM         : prompt now contains "[fp_default=TRUE]" hint
                              ──→ much higher likelihood of FP verdict
```

### Auto-promotion (no analyst click)

When `fp_ratio ≥ 0.95` and `(fp_count + tp_count) ≥ 10`, the learning system auto-inserts an `asset_context` row with `source='auto-learned'` (and `fp_default=1`) without waiting for analyst approval. If a later analyst override (TRUE_POSITIVE) lands on an auto-learned asset, `reinforceFeedback` revokes the `fp_default=1` and annotates the description with `[REVOKED by TP feedback]` so the agent stops short-circuiting on it.

### What "Reclassify FP" does to the counters

When an analyst reclassifies an incident as FP, every linked alert had previously contributed `tp_count++` (at escalate time). Reclassification appends an `fp_count++` for the same IOCs but does **not** decrement the prior `tp_count`: the analyst genuinely thought it was real at the time, and erasing that signal would distort calibration tracking. The empirical `fp_ratio` rebalances on its own as both counters coexist.

---

## 6. Combined State Diagram (alert lifecycle through memory)

```
[wazuh ingest]
      │
      ▼
[NEW] ──── suppression match? ────► [FILTERED] ──► (no agent run)
      │ no                                │
      ▼                                   ▼
[ANALYZING] ────► recall pre-flight       │
      │            ├── fpSimilar ≥0.85 ──►[FALSE_POSITIVE] (memoryFP)
      │            └── normal              │
      ▼                                    │
[triage → … → ticket]                      │
      │                                    │
      ├── is_false_positive=true ─────────►[FALSE_POSITIVE] (triage)
      │                                    │
      ├── priority=CRITICAL/HIGH ─────────►[ESCALATED] ──► dispatch integrations
      │                                    │
      └── priority=MEDIUM/LOW ────────────►[TRIAGED]
                                           │
                  ┌────────────────────────┘
                  ▼
         [commitInsightAsync]
                  │
                  ├──► incident_insights (+ embedding via Ollama)
                  ├──► ioc_memory (per IOC, fp_count or tp_count++)
                  └──► working_memory (trace flush)
                  │
                  ▼
         [analyst feedback?]
                  │ yes
                  ▼
            [reinforceFeedback]
                  │
                  └──► ioc_memory counters adjusted
                       │
                       ▼
                  [scanForFpSuggestions]
                       │
                       ├── ratio ≥0.95 ──► auto-add asset_context
                       └── ratio ≥0.85 ──► fp_suggestions ──► analyst → asset_context
```

---

## 6.5 Workflow E — **Reasoning Capture + Cross-Agent Memory Read**

> Trigger: Every LLM-backed agent run. Captures structured reasoning per agent and reuses past reasoning to maintain continuity across investigations.

Every node (`analysis`, `intel`, `knowledge`, `correlation`, `ticketing`, `response`, `validation`) emits a `reasoning` block in its structured output:

```
reasoning: {
  decision:             string,    // one-sentence conclusion
  evidence_for:         string[],  // 1-4 concrete signals supporting it
  evidence_against:     string[],  // 0-3 counter-signals
  rejected_hypotheses:  string[],  // alternatives considered and why dropped
  confidence:           number     // 0..1, calibrated
}
```

### Sequence

```
1. orchestrator → fetchPriorReasoning(description, k=3, threshold=0.7)
                  ├── semanticStore.search(...)         → similar alert IDs
                  └── listReasoningForAlerts(ids, 2)    → 2 most-recent reasoning rows each
2. orchestrator → triage node                state includes priorReasoning[]
                  └── triage prompt block "PRIOR AGENT REASONING ON SIMILAR INCIDENTS"
                      shows decision / evidence_for / evidence_against / rejected
3. each LLM node → emits structured reasoning per its job
4. orchestrator → recordReasoning({alertId, traceId, agent, step, reasoning})
                  └── INSERT INTO incident_reasoning
5. ui (incident panel) → GET /api/alerts/:id/reasoning
                       → GET /api/incidents/:id/reasoning  (aggregates all linked alerts)
```

### Why this matters

Without prior reasoning injection, every triage starts from a blank slate. With it:
- A repeat scenario the system already saw is recognised: "the previous triage on this asset rejected lateral-movement because no SMB traffic — same pattern here."
- Rejected hypotheses propagate forward: if a past run considered and discarded "insider data theft", a new run sees that and either confirms the same rejection or explicitly counters it.
- The UI's "Reasoning timeline" can render cards per agent showing decision / evidence / rejected hypotheses — the visible chain of thought.

---

## 7. Key Files (for traceability when building the diagram)

```
agents/orchestrator.ts           ← entry: runOrchestration() — sequences nodes
agents/memory/
  ├── embeddings.ts              ← embedText() → Ollama; cosineSimilarity()
  ├── insights.ts                ← commitInsightAsync(), search()
  ├── ioc.ts                     ← lookupIocs(), upsertIoc()
  ├── assets.ts                  ← lookupAssetContext(), extractAssetValues()
  ├── store.ts                   ← SemanticStore (pgvector cosine search, HNSW index)
  ├── working.ts                 ← writeWorkingMemory()
  ├── reasoning.ts               ← ReasoningSchema, recordReasoning, fetchPriorReasoning
  └── learning.ts                ← reinforceFeedback(), processAutoLearning(), scanForFpSuggestions()

agents/nodes/
  ├── analysis.ts                ← triage agent (consumes memory hints + priorReasoning)
  ├── intel.ts                   ← MITRE mapping
  ├── knowledge.ts               ← ragKnowledgeNode (consumes playbooks)
  ├── correlate.ts               ← cross-alert correlation
  ├── ticket.ts                  ← report builder
  ├── response.ts                ← action recommender
  ├── validate.ts                ← final review
  └── recall.ts                  ← memory pre-flight

server.ts
  ├── /api/ingest                       ← wazuh entry point
  ├── /api/ai/orchestrate               ← manual investigation trigger
  ├── /api/memory/insights              ← KB browse: incidents
  ├── /api/memory/iocs/all              ← KB browse: IOCs
  ├── /api/playbooks  (GET/POST/PATCH/DELETE)
  ├── /api/alerts/:id/confirm-fp        ← feedback loop: FALSE_POSITIVE
  ├── /api/alerts/:id/override-fp       ← feedback loop: TRUE_POSITIVE
  ├── /api/alerts/:id/escalate          ← feedback loop: TRUE_POSITIVE (via escalation)
  ├── /api/incidents/:id/reclassify-fp  ← feedback loop: FALSE_POSITIVE (every linked alert)
  ├── /api/alerts/:id/reasoning         ← reasoning timeline for one alert
  ├── /api/incidents/:id/reasoning      ← reasoning timeline aggregated across linked alerts
  └── /api/analytics/fp-suggestions     ← learning output (suggestions to accept)

server.ts (background)
  ├── 5-min cron: processAutoLearning()       ← safety net for non-analyst commits
  └── inline:     processAutoLearning()       ← runs after every analyst feedback

src/App.tsx
  └── KnowledgeBaseTab                  ← UI surface (Workflow C)
```

---

## 8. Suggested eraser.io snippets

These minimal blocks correspond to each workflow above and can be pasted directly into eraser.io (sequence + cloud diagram modes).

### Workflow A — agent recall (sequence diagram)

```
title Memory READ — Agent Recall During Investigation

Wazuh > AISOC Server: POST /api/ingest (alert)
AISOC Server > PostgreSQL: INSERT alerts
AISOC Server > Orchestrator: runOrchestration(alert)
Orchestrator > PostgreSQL: SELECT suppression_rules
alt suppression match
  Orchestrator > PostgreSQL: status='FILTERED'
else no match
  Orchestrator > Recall Pre-flight: preFlight(alert)
  Recall Pre-flight > PostgreSQL: lookupIocs / lookupAssetContext
  Recall Pre-flight > Ollama: embed(description)
  Ollama > Recall Pre-flight: float32[768]
  Recall Pre-flight > PostgreSQL: semanticStore.search(embedding)
  PostgreSQL > Recall Pre-flight: top-k incident_insights
  Recall Pre-flight > Orchestrator: memory hints
  Orchestrator > Triage Agent: invoke(alert, hints)
  Triage Agent > Orchestrator: verdict
  Orchestrator > Knowledge Agent: invoke(state)
  Knowledge Agent > PostgreSQL: SELECT playbooks WHERE tactic=?
  PostgreSQL > Knowledge Agent: matching playbooks
  Knowledge Agent > Orchestrator: remediation_steps
end
```

### Workflow B — memory write (sequence diagram)

```
title Memory WRITE — Post-Investigation Commit

Orchestrator > PostgreSQL: UPDATE alerts SET status, ai_analysis
Orchestrator > Insights Module: commitInsightAsync(state)
Insights Module > Ollama: embed(summary text)
Ollama > Insights Module: float32[768] (or null if offline)
Insights Module > PostgreSQL: INSERT incident_insights (+ embedding vector(768))
Orchestrator > IOC Module: upsertIoc(value, outcome) [per IOC]
IOC Module > PostgreSQL: UPDATE ioc_memory (fp_count or tp_count++)
```

### Cloud architecture (component diagram)

```
title Knowledge Base Architecture

Analyst [icon: user, color: blue]
Wazuh [icon: shield, color: orange]

AISOC Server [icon: server, color: green] {
  Orchestrator [icon: workflow]
  Agent Nodes [icon: cpu] {
    Recall Pre-flight
    Triage
    Knowledge
    Ticket
  }
  Memory Modules [icon: database] {
    insights.ts
    ioc.ts
    assets.ts
    learning.ts
  }
  KB API Routes [icon: api]
}

PostgreSQL [icon: database, color: gray] {
  playbooks
  incident_insights
  ioc_memory
  asset_context
  suppression_rules
  working_memory
}

Ollama [icon: cpu, color: purple, label: "nomic-embed-text"]

Frontend [icon: monitor, color: blue] {
  KnowledgeBaseTab
}

Wazuh > AISOC Server: webhook alerts
Analyst > Frontend: browse / edit
Frontend > KB API Routes: GET /api/memory/*
KB API Routes > PostgreSQL: SELECT
Orchestrator > Memory Modules: read/write
Memory Modules > PostgreSQL: SQL
Memory Modules > Ollama: embed()
Recall Pre-flight > Memory Modules: lookup hints
Triage > Memory Modules: receives hints
Knowledge > PostgreSQL: SELECT playbooks
```

---

## 9. Invariants the diagram should preserve

1. **Ollama is optional.** If unreachable, the system degrades gracefully — embeddings become null, semantic search is skipped, but every other path still works.
2. **Memory writes are async.** The user gets their investigation result before `commitInsightAsync` finishes — never the other way around.
3. **The UI search bar bypasses Ollama.** Only the agent recall path uses embeddings.
4. **Asset Registry & Suppression Rules live in the Noise Filter tab**, not in the Knowledge Base. The diagram should show them as separate UI surfaces feeding the same backend tables.
5. **Feedback loops back into the same tables it reads from.** `ioc_memory` is the primary feedback target; `asset_context` is the curated promotion target.
