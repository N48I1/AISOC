 Making AISOC Feel Intelligent (Not Just Automated)

 Context

 The user's instinct is correct, and three parallel audits of the codebase confirmed it. AISOC today looks like a
 multi-agent reasoning system but is actually:

 1. A linear pipeline disguised as a graph. No LangGraph. No conditional edges. The "planner" is one LLM call that
 emits a flat list of workers; workers always run in parallel; composers always run in fixed order. There is one
 optional reflection round that just dispatches more workers — no debate, no hypothesis testing.
   - Evidence: agents/orchestrator.ts:238 runs investigators with Promise.all; reflection at L245–268 is a second
 dispatch, not reasoning.
 2. A set of single-shot prompt-to-JSON mappers. Each agent is exactly one callStructuredLLM call. No tool use, no
 ReAct loop, no self-critique, no agent-vs-agent argument, no re-prompting. The "Response Agent" picks from 6 hardcoded
  action types; the "Validation Agent" computes SLA from a hardcoded formula; the "Knowledge Agent" has no retrieval
 loop.
   - Evidence: every file in agents/nodes/*.ts has exactly one callStructuredLLM invocation. No ToolMessage, no
 BindTools.
 3. A system whose feedback loop is dead. This is the single biggest gap.
   - reinforceFeedback() exists in agents/memory/learning.ts:95 and is never called by any code path.
   - processAutoLearning() exists at learning.ts:68 and is unreachable — no HTTP endpoint, no cron, no agent invokes
 it.
   - POST /api/alerts/:id/confirm-fp (server.ts:4478) writes a status and an audit row, and does not touch memory at
 all. So an analyst confirming 100 false positives teaches the system literally nothing.
 4. A pile of hardcoded thresholds masquerading as intelligence. Triage FP threshold 0.72, aggregator weights
 0.45·triage + 0.20·asset + 0.15·ioc + 0.20·recall, severity level>=13 → CRITICAL, risk-score formula in
 analysis.ts:81-92, asset role list seeded in server.ts:588-598. None of these are tunable at runtime; none of them
 adapt. The LLM's "decision" is constrained to fill in blanks inside this rigid skeleton.
 5. A memory tier that's read but never reasoned about. working_memory is written by the orchestrator and never read by
  any agent — it exists for the UI only. The recall node retrieves similar prior incidents but they're shown as
 evidence, never used to flip a verdict. When triage says "TP" and 95% similar prior alerts were all FP, that
 contradiction is never flagged.

 The system is fast, predictable, well-tested, and demonstrably useful — but it does not learn, it does not reflect, it
  does not converse, and it does not reason in steps. That is what "feels like automation."

 ---
 The three pillars of felt intelligence

 Three things, in priority order, transform an analyst's perception of the system from tool to colleague:

 1. Visible reasoning — show the chain of thought, the hypotheses considered, the evidence weighed, the disagreement
 resolved. Analysts don't want a verdict; they want a colleague's reasoning they can poke at.
 2. Adaptive behaviour — the system that talked to the analyst yesterday must visibly act differently today. Without
 this, every "fix" is a code change.
 3. Dialogue — the analyst can ask "why" and push back. A one-way oracle is not a colleague.

 Every item in the list below maps to at least one pillar.

 ---
 The intelligence uplift — 12 suggestions, prioritised

 Tier 1 — biggest perception change, smallest scope (do these first)

 1.1 Close the analyst-feedback loop (Pillar 2)

 The single most consequential fix. Every analyst override / confirm-FP / reclassify must call back into memory.
 - On POST /api/alerts/:id/confirm-fp → call reinforceFeedback(iocs, 'FALSE_POSITIVE') to bump fp_count on every IOC
 seen in that alert.
 - On POST /api/alerts/:id/escalate or analyst-driven "this is real" → call reinforceFeedback(iocs, 'TRUE_POSITIVE').
 - On reclassify → invert the prior counters, then apply the new label.
 - Re-embed the incident insight with the corrected outcome so future semantic recall sees the truth.
 - Trigger processAutoLearning() on a 5-min cron + after each feedback event.
 - Files: server.ts confirm-fp / escalate / reclassify endpoints (~L4478+); reuse reinforceFeedback(),
 processAutoLearning(), upsertAssetContext() from agents/memory/learning.ts.
 - Effort: small (~150 lines).
 - Effect: within a week of use, the queue visibly quietens. Analysts feel the system is learning from them.

 1.2 Reasoning trace shown in the UI (Pillar 1)

 Every agent already produces agentLogs and a confidence score; expose the thought process not just the verdict.
 - Capture the model's structured rationale per node into a new incident_reasoning table: each entry has (incident_id,
 agent, hypothesis, evidence_for, evidence_against, confidence, decision).
 - In the incident detail panel, render a "Reasoning timeline" with cards per agent showing what it considered, what it
  weighed, and why it concluded what it did.
 - Critically: include the rejected hypotheses ("considered insider-threat, rejected because no privileged credential
 use").
 - Files: incident detail panel in src/App.tsx; new endpoint GET /api/incidents/:id/reasoning; agents updated to emit a
  reasoning field in their output schema.
 - Effort: medium.
 - Effect: the analyst sees the AI thinking, not just the AI's answer. Single biggest "feel" change.

 1.3 Add a Critic agent (Pillar 1 + 2)

 After every triage / response decision, a second LLM call re-reads the alert + memory + the verdict and tries to
 falsify it.
 - New node agents/nodes/critic.ts. Prompt: "Read this verdict critically. What would make it wrong? What evidence is
 missing? What contradiction did the primary analyst miss?"
 - If the critic disagrees materially (confidence delta > 0.3 or flips FP↔TP), the incident is tagged disputed_by_ai
 and surfaces a visible disagreement card in the UI — e.g. "Triage said FP (87%); Critic flagged this for review
 because it found credential-access language."
 - Append the critic's notes to the reasoning trace.
 - Files: new node; insert into orchestrator.ts between the FP gate and ticketing.
 - Effort: small (one new LLM node + plumbing).
 - Effect: visible AI disagreement is the most credible signal of intelligence. Analysts trust a system that argues
 with itself more than one that's always confident.

 Tier 2 — biggest functional jump (do these second)

 2.1 Conversational co-pilot per incident (Pillar 3)

 A chat panel inside each incident. The analyst can ask:
 - "Why did you flag this?"
 - "Have we seen this pattern before?"
 - "What would you do next?"
 - "Are you sure? I think this is internal scanning."

 The agent has full incident context, the reasoning trace, memory access, and a small tool set (look up an IP, fetch
 the asset's history, find similar prior incidents, search the knowledge base).
 - Backend: POST /api/incidents/:id/copilot accepts {message}, streams a response, persists to a per-incident
 conversation table.
 - Each turn the model can call tools — this is finally a real ReAct loop.
 - Files: new endpoint cluster; new IncidentCopilotPanel React component; new incident_conversations table.
 - Effort: medium-large.
 - Effect: this single feature transforms "AI dashboard" to "AI colleague" more than any other change.

 2.2 Tool-using investigation (Pillar 1)

 Replace the deterministic "always call MISP, always pull recall" pre-flight with a real function-calling LLM loop.
 - Tools: lookupIp(ip), getAssetInfo(host), searchPriorIncidents(natural_query), checkUserHistory(user),
 queryMisp(ioc), queryVirusTotal(ioc).
 - Each tool call is logged into the reasoning trace ("I checked the asset role: 10.0.0.20 is the backup service host.
 That moves my confidence toward FP from 0.6 to 0.85.").
 - LangChain's bindTools() on ChatOpenAI exposes this — works on OpenRouter, OpenAI, Anthropic. Budget per
 investigation: 5 tool calls, then force conclusion.
 - Files: refactor agents/nodes/analysis.ts to a ReAct loop; new tool registry in agents/shared/tools.ts.
 - Effort: medium.
 - Effect: visible "the agent is checking X, then Y, then concluding" — the actual behaviour of a junior analyst, not a
  script.

 2.3 Hypothesis-driven investigation for high-severity alerts (Pillar 1)

 For any alert at CRITICAL or HIGH, switch from "one triage call" to a multi-step hypothesis loop:
 - Hypothesis-generator agent emits 2–4 hypotheses (phishing, insider, misconfig, compromised credential).
 - Evidence-seeker runs per hypothesis, looking only for confirming or refuting evidence.
 - Scorer ranks hypotheses and picks the winner, with explicit confidence and the runners-up retained.
 - Loop budget: 3 rounds, with rejection of low-scoring hypotheses each round.
 - Files: new agents/nodes/hypothesis.ts; conditional branch in orchestrator.ts based on severity.
 - Effort: medium-large.
 - Effect: the system visibly thinks on the alerts that matter. Reasoning timeline shows hypotheses considered +
 rejected, which is the truest expression of intelligence.

 Tier 3 — adaptive behaviour over time (do these third)

 3.1 Adaptive thresholds, per-source and per-asset (Pillar 2)

 Replace the hardcoded 0.72 triage threshold with a learned threshold per (rule_id, asset_role) pair.
 - After ~50 observations for a pair, compute the empirical FP rate and shift the threshold to maximise (recall ·
 precision).
 - New table learned_thresholds(rule_id, asset_role, threshold, sample_size, last_updated).
 - Triage node reads the relevant row, falls back to 0.72 until the sample size is enough.
 - Show the learned thresholds in the admin UI: "rule 5710 on backup hosts is currently 0.41 — based on 78
 observations."
 - Files: agents/orchestrator.ts triage gate; new admin endpoint; new background job.
 - Effort: medium.
 - Effect: visibly adaptive system. Analyst sees the numbers move.

 3.2 Nightly consolidation / "morning briefing" (Pillar 2)

 Add a once-daily background job that reads the last 24 h and produces a briefing artefact:
 - Top 5 noisiest rules / assets that should be suppressed (auto-propose the rule, admin approves).
 - Calibration card: "triage agent was 78% accurate at the >0.9 confidence band, 51% accurate at 0.6–0.7."
 - New patterns observed: "5 alerts in the last 24h share the user-agent string xyz; we've never seen this before."
 - Stored as daily_briefings table; rendered as a dashboard widget at top of incidents page.
 - Files: new background tick (uses the existing 5-min interval pattern); new admin endpoints; new briefing widget.
 - Effort: medium.
 - Effect: feels like an analyst that did their homework overnight.

 3.3 Confidence calibration tracking (Pillar 2 + 1)

 For every triage decision, after the analyst confirms/overrides, record (predicted_confidence, was_correct).
 - Plot calibration curves per agent. Surface in the admin UI: "Validation Agent calibration: high confidence is
 well-calibrated, but at the 0.5–0.7 band it's only 42% accurate."
 - Use the calibration in the UI: "Triage said 88% FP — but at this confidence band the agent has historically been 71%
  accurate."
 - Files: extend feedback path from (1.1) to record predictions; new admin page; new endpoint /api/admin/calibration.
 - Effort: small (once 1.1 is in).
 - Effect: honest uncertainty. Users trust calibrated systems vastly more than over-confident ones.

 Tier 4 — bigger projects (do these last, if at all)

 4.1 Semantic campaign detection across all of history

 Correlation currently looks at a recent time window. Replace with a semantic similarity search across the full
 incident_insights store: this alert's behavioural fingerprint matches a campaign from 3 months ago.
 - Already have embeddings; just need a similarity search keyed by attack-chain fingerprint, not raw text.
 - Effort: medium.

 4.2 Asset graph learned from behaviour

 Drop the hardcoded list of scanner / backup / monitoring assets. Replace with a learner that reads weeks of alerts per
  host and infers the role from behaviour: nmap-style scans → "scanner"; periodic SSH+rsync → "backup"; etc.
 - Asset roles still editable by admin; the system just proposes them.
 - Effort: medium-large.

 4.3 Counterfactual reasoning surface

 The agent explicitly states, in its output, what evidence would change its mind. ("I rate this 85% FP. I would flip to
  TP if I saw: a new outbound connection within 5 minutes, OR the user accessing a file outside their normal cluster.")
 - These counterfactuals become active hunts: a 5-min background job checks for the conditions and pings the agent to
 re-evaluate.
 - Effort: medium.

 ---
 Critical files to be modified

 ┌───────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────┐
 │        Concern        │                                          File                                           │
 ├───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
 │ Feedback wiring       │ server.ts confirm-fp / escalate / reclassify / FP-archive endpoints;                    │
 │                       │ agents/memory/learning.ts (reuse)                                                       │
 ├───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
 │ Reasoning trace       │ new incident_reasoning table in server.ts migrations; new endpoint cluster; reasoning   │
 │ storage + UI          │ timeline in src/App.tsx incident panel                                                  │
 ├───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
 │ Critic agent          │ new agents/nodes/critic.ts; wired into agents/orchestrator.ts between FP gate and       │
 │                       │ ticketing                                                                               │
 ├───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
 │ Co-pilot chat         │ new incident_conversations table; POST /api/incidents/:id/copilot; new                  │
 │                       │ IncidentCopilotPanel React component                                                    │
 ├───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
 │ Tool-using ReAct loop │ new agents/shared/tools.ts; refactor agents/nodes/analysis.ts; uses LangChain's         │
 │                       │ bindTools() on the existing ChatOpenAI clients                                          │
 ├───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
 │ Hypothesis loop       │ new agents/nodes/hypothesis.ts; severity-conditional branch in orchestrator.ts          │
 ├───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
 │ Adaptive thresholds   │ new learned_thresholds table; background job in server.ts; gate read in orchestrator.ts │
 ├───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
 │ Nightly briefing      │ new daily_briefings table; background tick in server.ts; widget in dashboard            │
 ├───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
 │ Calibration           │ extend (1.1) feedback path; new endpoint; new admin card                                │
 └───────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────┘

 Reusable patterns to lean on

 - safeAlter() for every new column (server.ts:448+).
 - writeAudit() for every learning event so the loop itself is auditable.
 - The 30-second policy cache pattern from agents/shared/policy.ts for any new "learned config" that must be tunable.
 - The integrations table pattern for runtime-tunable thresholds (so they don't become new hardcoded constants).
 - The existing callStructuredLLM for one-shot calls; graduate to LangChain bindTools() on the same ChatOpenAI clients
 for tool-using nodes.
 - The 5-min background tick pattern already in server.ts:4774 for daily / hourly consolidation jobs.

 Suggested rollout

 The list above is already in execution order. A pragmatic first-month plan:

 - Week 1: 1.1 (close the feedback loop) and 1.2 (reasoning trace). These two alone move the perception needle more
 than the next five combined.
 - Week 2: 1.3 (critic agent). One new node, visible disagreement in the UI.
 - Week 3: 2.2 (tool-using investigation). Replaces deterministic enrichment with a visible ReAct loop.
 - Week 4: 2.1 (co-pilot chat). The flagship "this is a colleague, not a tool" feature.
 - Then Tier 3 in any order based on what the user finds most useful.

 What we are not doing

 - We are not replacing the existing orchestration with a new framework. The hand-coded pipeline in orchestrator.ts is
 fine; we're adding reasoning within it, not rewriting it.
 - We are not adding LangGraph just to have a "real DAG." The conditional logic added by (2.3) is enough.
 - We are not moving to a different model provider. The provider registry just added supports OpenAI, Anthropic,
 OpenRouter equally; tool use works on all three.

 Verification

 Each Tier item ships with a concrete acceptance test:

 1. Feedback loop closed: confirm 5 alerts as FP; check ioc_memory.fp_count went up by 5 on each IOC; check
 asset_context auto-registered any host that crossed the threshold. Within 24 h, a fresh alert with the same IOC should
  trigger the memory FP hint in the next triage run (visible in the reasoning trace).
 2. Reasoning trace: open any incident; the reasoning timeline shows 5+ cards (one per agent) including a "considered &
  rejected" hypothesis card; clicking a card shows the model's evidence list.
 3. Critic disagreement: feed an ambiguous alert (high-severity rule on a known-scanner asset); the UI shows the triage
  FP verdict alongside a critic disagreement card with a different conclusion.
 4. Co-pilot chat: open an incident; ask "why did you escalate this?" and "have we seen this pattern before?"; both
 answers cite the reasoning trace + memory, and the second includes links to specific prior incidents.
 5. Tool-using investigation: trigger an alert; the reasoning trace shows the agent calling lookupIp then getAssetInfo
 then concluding — the calls and their results are all visible.
 6. Adaptive threshold: pick a noisy (rule, asset) pair; after ~50 FP confirmations the admin UI shows the learned
 threshold has moved below 0.72; new alerts in that pair short-circuit faster.
 7. Nightly briefing: at 00:05 every day a briefing card appears at the top of the dashboard; it proposes at least one
 suppression rule from the last 24 h.
 8. Calibration card: after 100+ analyst decisions, the admin calibration page shows a per-agent calibration curve and
 the accuracy of each confidence band.

 Each item is independently shippable, independently testable, and independently valuable — but stacked, they change
 the system from automation to a colleague.
