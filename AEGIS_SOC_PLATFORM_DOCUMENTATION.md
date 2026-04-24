# Aegis SOC Platform: Technical Documentation & Architectural Overview

This document provides a detailed technical breakdown of the Aegis SOC Platform, an automated Security Operations Center (SOC) framework leveraging Multi-Agent Systems (MAS) and Large Language Models (LLMs) for autonomous alert triage and incident response.

---

## 1. System Abstract
The Aegis SOC Platform is designed to bridge the gap between high-volume security telemetry (e.g., Wazuh SIEM alerts) and analyst decision-making. By employing a sequential "Swarm" of specialized AI agents, the platform automates the initial 30–60 minutes of human investigation, providing enriched triage, MITRE ATT&CK mapping, and executable remediation plans within seconds.

## 2. Technical Stack
- **Frontend:** React 19, Vite, Tailwind CSS, Lucide React (Icons), Framer Motion (Animations).
- **Backend:** Node.js (Express), Socket.io (Real-time updates), JWT (Authentication).
- **Database:** SQLite (Better-SQLite3) with WAL mode for high-concurrency ingestion.
- **AI Orchestration:** LangGraph (Stateful graphs), LangChain (LLM abstraction).
- **External Integrations:** OpenRouter (LLM Gateway), MISP (Threat Intel Enrichment).

---

## 3. The 7-Agent Swarm Architecture
The core of the platform is a directed acyclic graph (DAG) implemented via **LangGraph**. Each "node" in the graph represents a specialized security persona.

### Phase 1: Alert Triage Agent (`analysis`)
- **Objective:** Extract Indicators of Compromise (IOCs) and determine initial risk.
- **Logic:** Parses raw JSON logs from Wazuh. It calculates a "Risk Score" based on rule levels, external IP presence, and historical alert patterns.
- **Output:** Categorized IOCs (IPs, Hashes, Domains), Kill Chain stage, and False Positive assessment.

### Phase 2: Threat Intelligence Agent (`intel`)
- **Objective:** Enrich IOCs with external reputation data.
- **Logic:** Queries the MISP (Malware Information Sharing Platform) API. It maps the alert to specific **MITRE ATT&CK** techniques and identifies known Threat Actor patterns.
- **Output:** Threat actor profiles, malware family identification, and reputation scores.

### Phase 3: RAG Knowledge Agent (`knowledge`)
- **Objective:** Provide context-aware remediation.
- **Logic:** Uses Retrieval-Augmented Generation (RAG) concepts to fetch relevant Standard Operating Procedures (SOPs).
- **Output:** Step-by-step remediation plan and containment priority.

### Phase 4: Correlation Agent (`correlation`)
- **Objective:** Detect multi-stage campaigns.
- **Logic:** Analyzes the current alert against the last 50 historical alerts in the database to find temporal or logical links (e.g., same source IP performing different actions across different hosts).
- **Output:** Campaign detection status and escalation triggers.

### Phase 5: Ticketing Agent (`ticketing`)
- **Objective:** Formalize the incident record.
- **Logic:** Synthesizes the findings from Phases 1–4 into a structured report.
- **Output:** Incident title, business impact assessment, and priority level.

### Phase 6: Response Agent (`response`)
- **Objective:** Recommend defensive actions.
- **Logic:** Evaluates the risk vs. operational impact of containment (e.g., blocking a core server vs. a user workstation).
- **Output:** Recommended actions (Block IP, Isolate Host, Reset Password) and required approval levels.

### Phase 7: Validation Agent (`validation`)
- **Objective:** Quality assurance and SLA tracking.
- **Logic:** Reviews the entire state of the swarm to ensure all mandatory fields are populated and the response plan aligns with predefined Service Level Agreements (SLAs).
- **Output:** Completeness score and final "Ready for Analyst" status.

---

## 4. Key Platform Features

### A. Autonomous Orchestration
New alerts ingested via the `/api/ingest` endpoint automatically trigger the full 7-agent swarm. The UI reflects this via a real-time "ANALYZING" status, updated via Socket.io.

### B. Interactive Investigation Dashboard
- **Live Alert Queue:** Real-time streaming of security events with severity-based color coding.
- **Agent Logs:** A transparent view of the "thought process" of each AI agent, showing how it reached its conclusion.
- **MITRE Mapping:** Visual indicators of the specific attack techniques identified.

### C. Incident Management
- **Markdown Report Generation:** One-click generation of professional incident reports for management or regulatory compliance.
- **Feedback Loop:** Analysts can mark AI findings as "Accurate" or "Inaccurate," creating a dataset for future model fine-tuning.

### D. Model Hot-Swapping
The platform supports multi-model strategies. Users can assign different LLMs (e.g., Gemini for speed, Llama for reasoning, Mistral for correlation) to different phases of the investigation via the **Agent Settings** panel.

---

## 5. Security & Ingestion Logic
- **Wazuh Integration:** Designed to accept the standard Wazuh alert schema.
- **Data Integrity:** All AI-generated data is stored in a JSONB format within SQLite, preserving the relationship between raw logs and AI interpretations.
- **Authentication:** Role-based access control (RBAC) ensures only authorized analysts can approve response actions.

---

## 6. Future Research Directions (For Academic Report)
- **Multi-Modal Analysis:** Integrating vision-language models to analyze screenshots of suspicious user activity.
- **Feedback-Driven RLHF:** Implementing a Reinforcement Learning loop where analyst corrections directly influence the system's prompt templates.
- **Decentralized Intel:** Integrating blockchain-based threat intelligence feeds for immutable IOC verification.
