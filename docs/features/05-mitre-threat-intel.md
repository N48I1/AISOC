# MITRE ATT&CK & Threat Intelligence

## What It Does

The Threat Intelligence system enriches alerts with:

- **MISP integration** — queries your local MISP instance for IOC matches, threat actors, malware families, and event context
- **MITRE ATT&CK mapping** — maps alert IOCs and behavior to specific techniques (e.g., T1190 Exploit Public-Facing Application)
- **Risk assessment** — combines MISP data with LLM analysis to produce a confidence-weighted risk score
- **Campaign attribution** — identifies threat actor type (nation-state, cybercriminal, insider, hacktivist) and campaign family

---

## How It Works

The Threat Intelligence Agent (`intel` phase) runs during the investigation phase of the Hub-and-Swarm pipeline:

```
IOCs from Triage
       │
       ▼
  MISP Search (HTTP API)
       │ ← ips, domains, hashes, files, urls
       ▼
  LLM Analysis
       │ ← Alert context + MISP results + IOCs
       ▼
  Structured Output:
    - mitre_attack: ["T1190", "T1059.001"]
    - risk_score: 8
    - intel_summary: "..."
    - threat_actor_type: "cybercriminal"
    - campaign_family: "Emotet"
    - confidence: 0.85
```

### MISP Integration

The system queries MISP using a `restSearch` API call for each IOC type. When MISP returns hits, the agent receives:

- **Matched IOCs** — which specific indicators were found
- **Event context** — event IDs, descriptions, threat levels
- **Galaxy clusters** — threat actors, malware families
- **Tags** — TLP marking, taxonomies

The LLM is instructed to **prefer MISP data** over its own inference when matches exist. It must cite MISP event IDs in the summary.

### MITRE ATT&CK Mapping

The LLM maps behaviors to MITRE techniques based on:
- The alert description and rule context
- IOC types (e.g., PowerShell execution → T1059.001)
- MISP event tags that reference ATT&CK techniques
- Attack patterns observed in the investigation

Techniques are stored in the `mitre_attack` field as an array of technique IDs.

---

## MITRE Intelligence Tab (UI)

The **MITRE Intelligence** tab in the frontend displays:

- **Technique heatmap** — visualizes which ATT&CK techniques have been seen across all analyzed alerts
- **Tactic distribution** — breakdown by kill chain phase
- **Top techniques** — most frequently mapped techniques
- **Alert-technique linkage** — click a technique to see which alerts mapped to it

---

## Configuration

### MISP Connection

Set via environment variables:

```env
MISP_URL=https://misp.yourorg.local
MISP_API_KEY=your_misp_api_key_here
```

If MISP is unavailable, the agent falls back to inferential analysis and states clearly that the assessment is not backed by threat feed data.

---

## Output Schema

```typescript
{
  mitre_attack:      string[];    // ["T1190", "T1059.001"]
  risk_score:        number;      // 0-10
  intel_summary:     string;      // 2-3 sentence assessment
  threat_actor_type: "nation-state" | "cybercriminal" | "insider" | "hacktivist" | "unknown";
  campaign_family:   string | null; // Known malware/campaign name
  confidence:        number;      // 0.0-1.0
  misp: {                         // Raw MISP search results
    available: boolean;
    hits: number;
    events: Array<{ id: string; info: string; threat_level: string }>;
    matched_iocs: string[];
    threat_actors: string[];
    malware_families: string[];
    tags: string[];
    highest_threat_level: string;
  };
}
```

---

## Files Involved

```
agents/nodes/intel.ts           ← Threat Intelligence Agent (MISP + LLM)
agents/shared/misp.ts           ← MISP REST API client (mispSearchIocs)
server.ts                       ← mitre_attack field stored on alerts/agent_runs
src/App.tsx                     ← MitreIntelligence tab component
```

---

## Demo Alerts

The seed data includes three MISP-themed alerts designed to test the intel pipeline:

| Alert ID | Description | IOCs |
|----------|-------------|------|
| `demo-misp-dns-001` | DNS beacon to anhei.gotdns.com (known C2) | 103.226.132.7 |
| `demo-misp-conn-001` | TCP to 103.226.132.7:8443 (APT C2 node) | 103.226.132.7 |
| `demo-misp-dga-001` | DNS beaconing to apperu.gnway.cc (DGA-style) | 178.62.60.141 |
