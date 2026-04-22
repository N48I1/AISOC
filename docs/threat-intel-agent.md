# Threat Intelligence Agent — Technical Deep-Dive

## What It Is

The Threat Intelligence Agent is **Agent #2** in the 7-agent AI swarm. It takes the output of the Alert Triage Agent and enriches it with data from external and internal threat feeds (primarily MISP).

Its primary goals are:
1. **Identify the "Who" and "Why":** Determine if the indicators of compromise (IOCs) are linked to known threat actors or malware campaigns.
2. **Contextualize with MITRE ATT&CK:** Map the observed behavior to specific MITRE techniques.
3. **Validate Severity:** Provide an independent risk score based on historical intelligence.
4. **Leverage Local Knowledge:** Consult the organization's MISP instance for "authoritative" local hits.

---

## Files Involved

```
agents/
├── config.ts                  ← model assignment, phase names
├── workflow.ts                ← LangGraph pipeline wiring
├── nodes/
│   └── intel.ts               ← THE AGENT (logic + MISP integration + prompt)
└── shared/
    ├── misp.ts                ← MISP REST API client
    ├── llm.ts                 ← callStructuredLLM() wrapper
    └── types.ts               ← common data structures
```

---

## End-to-End Flow

```
Alert Triage Agent (Agent #1) completes
        │
        ▼
LangGraph state contains { analysis: { iocs: { ... } } }
        │
        ▼
agents/workflow.ts calls node_intel
        │
        ▼
agents/nodes/intel.ts  →  threatIntelNode(state, model)
        │
        ▼
agents/shared/misp.ts  →  mispSearchIocs({ ips, domains, hashes, ... })
        │
        │  ← HTTP POST to /attributes/restSearch
        ▼
MISP returns hits (events, galaxies, tags, threat levels)
        │
        ▼
agents/shared/llm.ts  →  callStructuredLLM(...)
        │
        │  ← System prompt instructs LLM to prioritize MISP data
        ▼
LLM responds with structured JSON
        │
        ▼
Returns { intel: { ...llmResult, misp: rawMispData } }
        │
        ▼
The Knowledge Agent (Agent #3) receives this enriched state
```

---

## The Agent Function: `threatIntelNode`

**File:** `agents/nodes/intel.ts`

### Input — `state` object
- `state.analysis.iocs` — The structured list of IPs, domains, hashes, etc., extracted by Agent #1.
- `state.alert` — The original alert description and metadata.

### Step 1 — MISP Search
The agent first calls `mispSearchIocs`. This helper:
- Searches for all IOCs in a single batch request to MISP.
- Parses `Galaxy` clusters to identify **Threat Actors** and **Malware Families**.
- Extracts `Tags` (e.g., TLP:WHITE, sector:finance).
- Maps MISP `threat_level_id` (1-4) to human-readable levels (High, Medium, Low, Undefined).

### Step 2 — Constructing the "MISP Block"
The MISP results are formatted into a text block for the LLM:
- If hits are found, it lists matched IOCs, known actors, and citing specific MISP event IDs.
- This block is labeled as **"AUTHORITATIVE local threat feed"** to ensure the LLM doesn't ignore it in favor of its own training data.

### Step 3 — LLM Synthesis
The LLM is prompted to act as a senior threat intelligence analyst. It must:
- Cite MISP event IDs in its summary.
- Map the activity to MITRE ATT&CK techniques (e.g., `T1190`).
- Categorize the threat actor type (e.g., `cybercriminal`, `nation-state`).

---

## The System Prompt

The prompt enforces strict behavior:
- **Priority:** MISP data MUST be preferred over inferential guesses.
- **Technicality:** Summaries must be tight (2-3 sentences) and technical.
- **Evidence-based:** If no MISP matches exist, the LLM must explicitly state that the assessment is inferential.

---

## The Output Schema

Defined in `intel.ts` using Zod.

```ts
{
  mitre_attack:      string[],        // e.g. ["T1190", "T1059.001"]
  risk_score:        number (0-10),   // Independent intelligence-based score
  intel_summary:     string,          // 2-3 sentence technical assessment
  threat_actor_type: enum,            // nation-state | cybercriminal | insider | hacktivist | unknown
  campaign_family:   string | null,   // e.g. "Emotet", "Lazarus Group"
  confidence:        number (0-1),    // Confidence in the assessment
}
```

*Note: The final output also includes the raw `misp` enrichment data for UI rendering.*

---

## MISP Integration Details

**File:** `agents/shared/misp.ts`

The MISP client handles:
- **RestSearch:** Uses the `/attributes/restSearch` endpoint.
- **SSL Validation:** Configurable via `MISP_VERIFY_SSL`.
- **Galaxy Parsing:** Navigates the complex `Galaxy` -> `GalaxyCluster` relationship in MISP JSON to find actor and tool names.
- **Deduplication:** Merges hits across multiple IOCs and events.

---

## How It's Rendered in the UI

**File:** `src/App.tsx`

The Threat Intel section in the dashboard shows:
- **MITRE Badges:** Each technique code is displayed as a badge.
- **Actor/Campaign Info:** If identified, the threat actor and campaign name are highlighted.
- **MISP Insights:** A dedicated sub-section shows the number of hits and lists relevant MISP event titles.
- **Intelligence Summary:** The technical assessment provided by the LLM.

---

## Key Design Decisions

**Why query MISP before the LLM?**
By providing the LLM with "ground truth" from MISP, we prevent hallucinations about threat actors and ensure the agent stays aligned with the organization's own intelligence.

**Why map MISP threat levels?**
MISP uses IDs (1, 2, 3, 4) which are not intuitive. Mapping these to High/Medium/Low early in the process makes the LLM and the UI logic more robust.

**Why include MITRE ATT&CK here?**
While the Triage agent (Agent #1) identifies high-level tactics, the Intel agent has the context of "who" and "how" (via MISP), allowing for more specific technique mapping (T-codes).
