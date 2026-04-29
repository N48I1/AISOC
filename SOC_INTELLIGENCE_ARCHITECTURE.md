# Aegis SOC Intelligence Architecture

## Overview
Aegis SOC utilizes a **Hub-and-Swarm** multi-agent orchestration model. Unlike traditional sequential pipelines, this architecture uses a central **Planner** to dynamically dispatch specialized AI agents (Investigators) based on the specific context of an alert, followed by a sequence of **Composers** to finalize the response.

## 1. Orchestration Lifecycle

The full intelligence lifecycle follows these stages:

### Phase A: Pre-flight Memory Recall (Deterministic)
Before any LLM is called, the system performs parallel deterministic lookups:
- **Semantic Recall**: Searches the vector database for similar past incidents (cosine similarity > 0.65).
- **IOC Pre-flight**: Checks extracted IOCs against the internal history of observed indicators.

### Phase B: Mandatory Triage
The **Alert Analysis Node** performs the first LLM-powered assessment:
- Extracts IOCs (IPs, domains, hashes, users).
- Assigns an initial risk score and attack category.
- **Short-circuit**: If triage identifies a high-confidence False Positive (>85%), the orchestration stops immediately to save tokens and time.

### Phase C: Dynamic Planning
The **Planner LLM** analyzes the triage results and pre-flight context to decide:
1. Which **Investigators** to dispatch (parallel).
2. Which **Composers** to skip.
3. Whether a **Reflection** round is needed.

### Phase D: Investigation (Parallel Swarm)
Specialized workers run in parallel based on the Planner's instructions:
- `intel`: Enriches IOCs via MISP and assigns MITRE ATT&CK techniques.
- `knowledge`: Retrieves remediation steps and playbooks.
- `correlation`: Analyzes recent alert history for multi-stage campaign patterns.
- `recall`: Deep dive into similar historical incidents.
- `ioc_check`: Validates indicators against the local observation database.

### Phase E: Reflection (Optional)
If enabled by the Planner, a second planning round can occur after investigators return, allowing for follow-up investigations if new evidence surfaces.

### Phase F: Composition (Sequential)
The results are passed through sequential composers to generate final artifacts:
1. `ticketing`: Drafts the incident ticket and sends notifications (GLPI/Telegram).
2. `response`: Formulates containment and remediation plans (Firewall/EDR actions).
3. `validation`: Final audit for SLA compliance and data completeness.

### Phase G: Memory Commitment
Final results are persisted to three memory tiers:
- **Semantic Store**: Incident summary stored as embeddings for future recall.
- **IOC Memory**: Indicator counts and scores are updated.
- **Insights**: High-level findings stored for the dashboard and reporting.

---

## 2. Memory Tiers

The "Intelligence" of the system is grounded in four memory layers:
- **Semantic Memory**: Long-term storage of incident summaries using vector embeddings.
- **IOC Observation History**: Tracks the frequency and context of indicators across the entire environment.
- **Working Memory**: Short-term context (reasoning, trace IDs) persisted during a single orchestration run.
- **Insights DB**: Structured database of agent findings used for trend analysis.

---

## 3. Operational Modes

The system supports two modes configured via `AGENT_MODE` environment variable:
- **`swarm` (Default)**: The dynamic Hub-and-Swarm model described above. Optimizes for token efficiency and speed by only running relevant agents.
- **`linear` (Legacy)**: A sequential 7-node chain where every agent runs in order. Maintained for backward compatibility.

---

## 4. Technical Foundations

- **Structured Outputs**: All LLM interactions use **Zod** schemas to ensure 100% predictable JSON responses.
- **Multi-Tier Fallback**: The `callStructuredLLM` utility handles rate limits and quota exhaustion by rotating through primary, backup, and local (Ollama) model providers.
- **Deterministic Reliability**: Core SOC logic (SLA checks, IOC lookups, ticket formatting) is balanced between LLM reasoning and hard-coded TypeScript validation.
- **Traceability**: Every orchestration run generates a unique `trace_id` and maintains detailed `agentLogs` for transparency and debugging.
