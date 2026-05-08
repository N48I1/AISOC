# Knowledge Base

## What It Is

The **Knowledge Base** is the analyst-facing UI for everything the SOC has learned. It consolidates three things that were previously invisible or scattered:

1. **Playbooks** — manually authored response procedures (previously buried in Settings)
2. **Incidents** — every past investigation, automatically indexed for AI recall
3. **IOC Memory** — every indicator (IP, domain, hash, user) the agents have seen, with FP/TP scoring

Open it from the sidebar (`📖 Knowledge Base`, between **Reports** and **Response Actions**).

> **Companion doc:** [`10-memory-system.md`](./10-memory-system.md) describes the backend tiers (semantic store, IOC memory, working memory, asset context, learning system). This doc is about the **UI surface** — what an analyst sees and what each control means.

---

## Page Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ Knowledge Base                                                   │
│ Playbooks, RAG-indexed incidents, and IOC memory                 │
├──────────────────────────────────────────────────────────────────┤
│ [📚 Playbooks: 12]  [🧠 Incidents: 87]  [🎯 IOCs: 234]  [RAG ✓] │
├──────────────────────────────────────────────────────────────────┤
│ [Playbooks] [Incidents] [IOC Memory]                             │
├──────────────────────────────────────────────────────────────────┤
│ <selected sub-tab>                                               │
└──────────────────────────────────────────────────────────────────┘
```

The four stat cards at the top are live counts. The **RAG status card** is green when Ollama is reachable (so embeddings are being generated for new incidents) and gray when it isn't. RAG offline is non-fatal — investigations still run, search still works, but new entries won't get vector embeddings until Ollama is back up.

---

## Sub-tab 1: Playbooks

Manually authored response procedures, indexed by **MITRE ATT&CK tactic** (CREDENTIAL_ACCESS, EXECUTION, EXFILTRATION, etc.). The `Knowledge` agent in the investigation pipeline pulls from this list when generating remediation steps.

**Controls:**
- Search bar — substring match on title + steps
- Tactic chip filter — narrow by MITRE tactic
- **Add Playbook** (admin only) — opens a form
- **Edit-in-place** (gear icon, admin only) — fix a typo without delete-and-recreate
- **Delete** (admin only)

**Backed by:** `playbooks` table · routes `GET/POST/PATCH/DELETE /api/playbooks[/:id]`

---

## Sub-tab 2: Incidents

This is the part most users ask about. The banner reads:

> *Auto-indexed from agent investigations. Embeddings via Ollama nomic-embed-text. Substring search runs on summaries below.*

That sentence is three separate facts:

### "Auto-indexed from agent investigations"

You don't add anything here manually. Every time an alert is investigated through the agent pipeline (the **Investigation** tab → "Run Agents"), the orchestrator calls `commitInsightAsync()` (`agents/memory/insights.ts:24`). That function takes the agent output and inserts a row into the `incident_insights` table:

```typescript
{
  alert_id:       "a1b2c3d4...",
  summary:        "Multiple failed SSH logins from 192.168.1.50...",
  attack_pattern: "Brute Force → Initial Access",
  threat_actor:   "external-bot",
  outcome:        "TRIAGED" | "FALSE_POSITIVE" | "ESCALATED" | "CLOSED",
  ttp_tags:       ["T1110.001", "T1078"],
  triggered_by:   "triage" | "memoryFP" | "composer",
  embedding:      <Float32Array, 768-dim>,  // see below
  created_at:     "2026-05-07 14:32:01",
}
```

The list you see on this page is just that table, sorted by `created_at DESC`.

### "Embeddings via Ollama nomic-embed-text"

At the same moment a row is written, the summary text is sent to your **local Ollama server** (`http://localhost:11434/api/embeddings`) using the `nomic-embed-text` model. Ollama returns a 768-dimension float vector — the *embedding* — which captures the meaning of the text in a way computers can compare. The vector is stored as a BLOB on the same row.

**Why bother?** The agents use those embeddings during a *new* investigation. When a fresh alert arrives, the orchestrator's recall phase searches `incident_insights` for past incidents whose embedding has high cosine similarity to the new one — i.e., *"we've seen something like this before."* That's how the system gets smarter over time without any manual tagging.

Everything runs on your own machine. No data leaves the host.

If Ollama isn't running, embeddings are skipped and the banner turns yellow. The investigation itself still completes — only the semantic-recall benefit is paused until Ollama comes back.

### "Substring search runs on summaries below"

This is a caveat about the search bar **on this page**. When you type `brute force` into it, the backend does a plain SQL `LIKE '%brute force%'` against `summary`, `attack_pattern`, and `threat_actor`. It does **not** use the vector embeddings.

So if a past incident's summary says *"credential stuffing"* and you search *"brute force"*, you won't find it from this UI — even though the agents themselves *would* find it via embedding similarity during their own recall phase.

Semantic search through the UI is a v2 feature. The banner is just being honest about the gap.

### Other controls in this sub-tab

- **Outcome filter chips** — TRIAGED / FALSE_POSITIVE / ESCALATED / CLOSED
- **Alert ID chip** on each card — clicking it jumps to the **Investigation** tab with that alert selected (only works for alerts still in the active list)
- **TTP tags** — colored chips showing the MITRE technique IDs the agents extracted
- **`triggered_by` chip** — which pipeline phase wrote the row (`triage`, `memoryFP`, or `composer`)

**Backed by:** `incident_insights` table · route `GET /api/memory/insights?q=&outcome=&limit=&offset=`

---

## Sub-tab 3: IOC Memory

Every indicator the agents have seen across all alerts, with cumulative FP/TP scoring.

**Each row shows:**
- Type badge (`ip`, `domain`, `hash`, `user`, `url`, `file`)
- The IOC value (mono font)
- Threat level (`HIGH` / `MEDIUM` / `LOW`)
- Total alert count where this IOC appeared
- **FP ratio bar** — what fraction of those alerts ended up being false positives. A nearly-full red bar means *"the agents see this constantly but it's almost always benign"* — usually a scanner, monitoring host, or known-good system that should be added to the **Asset Registry** in the Noise Filter tab.
- Time since last seen

**Controls:**
- Search on value/notes
- Type chip filter
- Sort: most alerts / highest FP ratio / most recent

**Why the FP ratio matters:** When the FP ratio is high enough (≥ 0.85), the **learning system** auto-suggests turning that IOC into a suppression rule or asset entry. This is exactly the feedback loop that drives FP reduction over time.

**Backed by:** `ioc_memory` table · route `GET /api/memory/iocs/all?q=&type=&limit=&offset=`

---

## Files

```
src/App.tsx
  └── KnowledgeBaseTab           ← whole UI (sub-tabs, search, filters)

src/services/aiService.ts
  ├── getInsights, getIocs        ← KB browse fetchers
  └── getPlaybooks, createPlaybook,
      updatePlaybook, deletePlaybook

server.ts
  ├── GET  /api/memory/insights        ← paginated browse with q/outcome
  ├── GET  /api/memory/iocs/all        ← paginated browse with q/type
  ├── GET  /api/playbooks              ← list
  ├── POST /api/playbooks              ← create (admin)
  ├── PATCH /api/playbooks/:id         ← edit-in-place (admin)
  └── DELETE /api/playbooks/:id        ← delete (admin)

agents/memory/insights.ts
  └── commitInsightAsync()             ← writes a row + embedding after every investigation
```

---

## Verification

1. Run any investigation from the **Investigation** tab → return to KB → the new entry appears in the Incidents sub-tab within ~1s.
2. Stop Ollama (`pkill ollama`) → reload the KB → the RAG status card turns gray and the Incidents banner turns yellow. Investigations still complete. New rows just won't have embeddings until Ollama returns.
3. Search "brute" in the Incidents sub-tab → matches by substring on summary, attack pattern, or threat actor.
4. Add a playbook for `CREDENTIAL_ACCESS` → run an investigation on a brute-force alert → the Knowledge agent's `remediation_steps` should reflect your new playbook.

---

## Not in This Page (and Why)

- **Asset Registry** (`asset_context`) — already in the **Noise Filter** tab. The KB intentionally avoids duplication; assets are an FP-suppression tool, not a memory artifact.
- **Suppression Rules** — same reason. They live in **Noise Filter**.
- **Working memory** (`working_memory` table) — per-alert planner scratchpad. Useful for debugging a single investigation, exposed via `GET /api/memory/working/:alertId`, not browsable in aggregate.
