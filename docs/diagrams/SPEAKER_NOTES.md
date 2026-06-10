# Speaker Notes — AISOC Diagrams

Paste each block into the notes pane of the matching slide.
Suggested presentation order: **techstack → use-case-minimal → aisoc-overview → alerts-workflow → false-positive-detection → hub-swarm → memory-system → semantic-memory → incident-lifecycle → auth-and-rbac → class-diagram → sequence-diagram** (drop or move to backup slides as time requires; the full use-case and both class-diagram formats are for the written report rather than the talk).

---

## 1. `techstack.eraser` — Tech Stack

**Open with:** "Everything you see here runs as just two pieces: a browser app, and a single Node.js process."

- Frontend: React 19 + TypeScript, built with Vite. It's a thin client — no AI, no database access. It talks to the backend two ways: REST for actions, Socket.IO for live pushes, so the dashboard updates without refreshing.
- Backend: one Node.js process running Express. It serves the API, enforces auth, and — important — the AI agents are **inside this same process**, not a separate service. That's why the Agents box is drawn nested inside the Backend box.
- Three LLM options: Gemini, OpenAI, and Ollama running locally. The local option matters: the platform can run fully air-gapped, alerts never leave the network.
- Data layer: SQLite plus a memory/RAG store with embeddings.
- Wazuh pushes alerts **to** us — we never poll the SIEM.

**If asked "why a monolith?":** Deliberate for this scale — one deployable, no network hops between API and agents. The agents are modular enough to split out behind a queue later.

---

## 2. `use-case-minimal.puml` — Use Case Overview

**Open with:** "Five human roles, three external systems, and one automated pipeline."

- The arrows between actors are UML generalization — each role inherits everything below it. A Tier-2 analyst can do everything a Tier-1 can, up to the Super Admin who can do everything.
- One headline capability per role: Tier-1 triages, Tier-2 investigates and tunes the detection rules, the Incident Lead owns assignment and closure, the Admin runs the platform, the Super Admin governs the admins themselves.
- The automated chain at the top is the core value: Wazuh ingests, the AI investigates, and only real threats become incidents that notify humans.

**If asked about Super Admin vs Admin:** Admin is day-to-day administration; Super Admin is the platform owner — only that role can create admins or change the admin IP allowlist. Separation of duties.

---

## 3. `aisoc-overview.eraser` — End-to-End Workflow

**Open with:** "This is the whole platform on one slide — follow an alert left to right."

- An alert arrives from Wazuh, passes API-key auth and cheap filters: severity floor, rate limit, deduplication.
- Then the 9-layer false-positive pipeline — ordered by **cost**. Free deterministic checks first, the LLM only when those can't decide. Most noise dies here without spending a single AI call.
- Survivors go to the multi-agent system: a planner dispatches specialist agents — threat intel, knowledge, correlation — then ticketing, response, and validation compose the incident.
- Every outcome feeds memory: insights are embedded, IOCs tracked, so the system gets better at recognizing noise over time.
- Two ends: false positives are archived (auditable, never deleted), real threats become incidents and notify via Telegram, Slack, email, GLPI.

**Key line:** "The design principle is: spend money only on alerts that earn it."

---

## 4. `alerts-workflow.eraser` — Alert Lifecycle

**Open with:** "Every alert is a small state machine — six states, and humans can override the AI at any point."

- New alerts go to ANALYZING automatically — the AI run is fire-and-forget, so ingestion never blocks.
- Two AI paths: a cheap FP-scan, or full orchestration with the whole agent swarm.
- Four outcomes: FALSE_POSITIVE, FILTERED, TRIAGED, or ESCALATED.
- The human stays in command: analysts confirm FPs, override wrong verdicts, and escalate anything to a real incident. An override isn't just a correction — it's a training signal that flows back into memory.

**If asked "what if the AI is wrong?":** That's exactly why FPs are archived, not deleted, and why override exists — the system is a filter with an audit trail, not a judge.

---

## 5. `false-positive-detection.eraser` — FP Detection

**Open with:** "False positives are the number-one problem in every SOC — analysts drown in noise. Here's how we kill it cheaply."

- Four memory signals are gathered in parallel before any AI runs: suppression rules, asset context, IOC history, and similar past incidents.
- One deterministic shortcut: if every source is a known benign asset and there are no attack keywords, we archive **without any LLM call at all**.
- Otherwise the triage LLM sees all the signals as evidence — signals inform, they don't decide alone. One rule being wrong can't auto-archive a real attack.
- Two gates after the LLM: a high-confidence gate, then a weighted aggregator that combines triage, asset, IOC, and recall scores.
- Bottom loop is the learning cycle: analyst confirmations update IOC statistics, the system *suggests* new suppression rules, and a human approves promotion. The funnel tunes itself — with human sign-off.

**Key line:** "Cheap evidence first, expensive judgment last, human always on top."

---

## 6. `hub-swarm-architecture.eraser` — Hub-and-Swarm Orchestration

**Open with:** "Instead of one big AI prompt, we run a team of specialists coordinated by a planner."

- The hub does the mandatory work: suppression check, memory pre-reads, triage. If triage is already confident it's a false positive, we stop right there — short-circuit.
- Otherwise a small, fast planner LLM decides **which** investigators are worth running for this specific alert — intel, knowledge, correlation, memory recall — and dispatches them **in parallel**, under a cost budget.
- At most one reflection round: the planner can look at results and dispatch missing workers once. No infinite loops, bounded cost.
- Composers run sequentially — ticketing, response plan, validation — because each needs the previous one's output.
- Finalize: aggregate FP score, priority gate, memory commit.

**If asked "why not one big prompt?":** Specialist prompts are individually testable, cheap models can do routing, expensive models only do analysis, and any worker can fail without killing the run.

---

## 7. `memory-system.eraser` — Memory System

**Open with:** "What makes this more than an LLM wrapper: the platform remembers."

- Five memory tiers: semantic insights with embeddings, IOC history, asset context, suppression rules, and working memory — the planner's own reasoning trace.
- Read path: every new alert triggers pre-flight reads across these stores before any LLM call — the AI starts every investigation already briefed.
- Write path: after each investigation, IOCs are upserted synchronously and the insight is embedded and committed asynchronously, so writing memory never slows down a response.
- The learning loop at the bottom: IOC statistics generate suppression suggestions, an **admin approves** them, and the new rule joins the front of the funnel.

**Key line:** "Every alert the system handles makes the next one cheaper."

---

## 8. `semantic-memory.eraser` — Semantic Memory (RAG Loop)

**Open with:** "This is the retrieval-augmented generation loop — textbook RAG, running fully locally."

- Write path: when an incident is resolved, its summary is embedded by a local Ollama model — nomic-embed-text — and stored as a vector right inside the database. If Ollama is down, it degrades gracefully: skip, never crash.
- Read path: an incoming alert is embedded the same way, compared by cosine similarity to every stored vector, and the top matches above a threshold come back as recall hits.
- Those hits are injected into the triage LLM's context: "this looks 92% similar to incident X, which was a false positive."
- Honest engineering note: it's a linear scan, not a vector index — at thousands of incidents that's milliseconds. The upgrade path to an indexed vector store exists when scale demands it.

**Key line:** "Embed, search, augment, generate — and all of it can run air-gapped."

---

## 9. `incident-lifecycle-and-risk.eraser` — Incident Lifecycle

**Open with:** "When something is real, it enters a structured incident-response lifecycle — the same phases as the NIST incident-handling standard."

- Six phases: Detection, Analysis, Containment, Eradication, Recovery, Post-incident. Status tracks alongside: OPEN → IN_PROGRESS → CONTAINED → RESOLVED → CLOSED.
- The Actions track is the safety-critical part: AI-proposed response actions — block an IP, isolate a host, disable a user — start as **pending** and must be **approved by a human** before execution. The AI proposes; people dispose.
- Closed incidents feed the metrics panel: MTTR, false-positive rate, automation rate — the numbers a SOC manager actually reports on.

**If asked about automation risk:** Nothing destructive is ever auto-executed. Approval is a hard gate in the data model itself, not a UI convention.

---

## 10. `auth-and-rbac.eraser` — Authentication & RBAC

**Open with:** "A security tool has to be secure itself — here's the access model."

- Two client types, two auth paths: humans log in via LDAP/Active Directory or local bcrypt-hashed credentials; machines — the SIEM forwarder — use hashed API keys. No passwords for machines, no API keys for humans.
- Brute-force protection: five failed logins locks the account for fifteen minutes.
- Every request passes authentication, then a role gate. Six hierarchical levels, from ANALYST up to SUPER_ADMIN — the platform owner, the only role that can create admins or touch the admin IP allowlist.
- Step-up authentication: sensitive admin operations require re-entering your password for a five-minute elevated token — even with a valid session. Stolen-session protection.
- Everything lands in the audit log: logins, lockouts, admin actions — exportable for compliance.

**If asked about token theft:** Sessions can be revoked instantly via an epoch mechanism, and sensitive ops need the step-up re-auth anyway.

---

## 11. `class-diagram.puml` / `class-diagram.eraser` — Data Model

**Open with:** "Twenty-four tables, four domains — and you can read the architecture's priorities straight from the schema."

- Four color groups: Identity & Access, Alerts & Incidents, AI/Agent Memory, Integrations & Config.
- Alerts and Incidents are many-to-many through a junction table — one campaign can group many alerts into one incident.
- The AI Memory domain is the differentiator: insights with an **embedding blob** (the RAG store), per-agent reasoning with evidence for and against, IOC reputation, asset context.
- Governance is in the schema, not bolted on: password history, access reviews, audit logs, hashed API keys.

**If asked why an ER model rather than classes:** The backend is functional TypeScript, not OOP — the persistent entities *are* the domain model, which is the honest UML representation.

---

## 12. `sequence-diagram.puml` — Alert Sequence

**Open with:** "Let's follow one alert through the system in time order — the numbers on the messages are the steps."

- Ingest: Wazuh posts with an API key; invalid, rate-limited, or duplicate requests are rejected in microseconds. The alert is stored and the HTTP response returns **immediately** — the AI pipeline is fire-and-forget, so ingestion never backs up.
- The pipeline then branches — and notice both early exits: a deterministic asset check can archive with zero LLM calls, and a confident triage verdict can archive after just one. Only genuine suspects reach the expensive parallel workers.
- Real threats: workers enrich, composers build the ticket and response plan, the incident is written with full reasoning, memory is updated, notifications go out.
- Last lane: Socket.IO pushes the result to the dashboard live, the analyst acts, and their feedback flows back into the learning loop.

**Key line:** "Three possible exits, increasing in cost — most alerts take the cheap ones."

---

## Backup-slide notes (report-only diagrams)

- **`use-case.puml` (full):** same structure as the minimal version with all ~30 use cases mapped to real API endpoints — reference it if an examiner wants per-role detail.
- **`class-diagram.eraser` vs `.puml`:** identical content; the `.eraser` renders ER-style for visual consistency with the other Eraser diagrams, the `.puml` is standard UML notation with the role enum.
