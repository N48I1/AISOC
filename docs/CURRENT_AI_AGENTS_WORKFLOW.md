# [DEPRECATED] Current AI Agents Workflow

> **Note**: This document describes the legacy sequential LangGraph implementation. 
> The project has moved to a **Hub-and-Swarm** architecture.

For the current intelligence architecture, please refer to:
**[SOC_INTELLIGENCE_ARCHITECTURE.md](./SOC_INTELLIGENCE_ARCHITECTURE.md)**

---

## Historical Context (Legacy Linear Flow)
Previously, the system used a strictly sequential 7-node LangGraph:
1. `node_triage`
2. `node_intel`
3. `node_playbook`
4. `node_correlate`
5. `node_ticket`
6. `node_response`
7. `node_validate`

This mode is still available via `AGENT_MODE=linear` but is no longer the primary orchestration method.
