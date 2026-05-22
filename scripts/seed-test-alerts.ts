/**
 * Seeds a handful of fresh, investigable alerts (status='NEW') so the user can
 * trigger a real LLM-backed investigation against each from the UI.
 *
 *   - NO hardcoded reasoning rows
 *   - NO fake incidents
 *   - Each alert ID is prefixed `test-` so it's trivially identifiable and removable
 *
 * Workflow after seeding:
 *   1. Open the SOC dashboard (Investigation tab)
 *   2. Pick one of the test- alerts (look for the [TEST] prefix in description)
 *   3. Click "Run Investigation"
 *   4. Wait ~10–30s for the agents to call OpenRouter / local LLM
 *   5. Open the resulting incident → click the "Reasoning" tab
 *   6. Every card you see is real LLM output, not a fixture
 *
 * Run:
 *   npx tsx scripts/seed-test-alerts.ts            # create / refresh the alerts
 *   npx tsx scripts/seed-test-alerts.ts --clean    # remove every test- alert + its derivatives
 */
import path from "node:path";
import Database from "better-sqlite3";

const DB_PATH = process.env.SOC_DB_PATH || path.resolve(process.cwd(), "soc.db");
const CLEAN_ONLY = process.argv.includes("--clean");

interface TestAlert {
  id:           string;
  rule_id:      string;
  description:  string;
  severity:     number;             // wazuh-style level (1..15)
  source_ip:    string;
  dest_ip:      string;
  agent_name:   string;
  hostname:     string;
  user:         string;
  data:         Record<string, any>; // becomes full_log
  hint:         string;             // human-readable expectation; not stored
}

// Each scenario is calibrated to make the agents have to actually weigh
// signals. They are NOT pre-classified; the orchestrator must decide.
const ALERTS: TestAlert[] = [
  {
    id:          "test-ssh-bruteforce-external",
    rule_id:     "5712",
    description: "[TEST] sshd: 47 failed password attempts for user 'admin' from 203.0.113.99 to web-prod-01 in 90 seconds, then 1 success",
    severity:    13,
    source_ip:   "203.0.113.99",
    dest_ip:     "10.0.5.42",
    agent_name:  "web-prod-01",
    hostname:    "web-prod-01",
    user:        "admin",
    data: {
      rule:    { id: 5712, level: 13, description: "Multiple authentication failures followed by success" },
      agent:   { name: "web-prod-01", ip: "10.0.5.42" },
      srcip:   "203.0.113.99",
      dstip:   "10.0.5.42",
      dstuser: "admin",
      data:    { srcip: "203.0.113.99", dstip: "10.0.5.42", dstuser: "admin", attempts: 47, successful_after: 47 },
    },
    hint: "Should be flagged as TRUE positive — external IP, brute-force pattern, success after many failures.",
  },
  {
    id:          "test-backup-host-noise",
    rule_id:     "5710",
    description: "[TEST] sshd: deploy@10.0.0.20 → backup-target-a:22 (port 22 connect, 1 successful auth, normal nightly backup window)",
    severity:    8,
    source_ip:   "10.0.0.20",
    dest_ip:     "10.0.0.21",
    agent_name:  "backup-svc",
    hostname:    "backup-target-a",
    user:        "deploy",
    data: {
      rule:    { id: 5710, level: 8, description: "sshd: authentication success" },
      agent:   { name: "backup-svc", ip: "10.0.0.20" },
      srcip:   "10.0.0.20",
      dstip:   "10.0.0.21",
      dstuser: "deploy",
      data:    { srcip: "10.0.0.20", dstip: "10.0.0.21", dstuser: "deploy" },
    },
    hint: "Should likely be flagged as FALSE positive — internal IP, low rule level, backup-svc agent name.",
  },
  {
    id:          "test-dga-finance-workstation",
    rule_id:     "5715",
    description: "[TEST] DNS: ws-finance-08 issued 32 queries to high-entropy subdomains of *.fastflux.example in 4 minutes",
    severity:    11,
    source_ip:   "10.0.20.108",
    dest_ip:    "8.8.8.8",
    agent_name:  "ws-finance-08",
    hostname:    "ws-finance-08",
    user:        "j.miller",
    data: {
      rule:    { id: 5715, level: 11, description: "DNS: suspicious high-entropy subdomain queries" },
      agent:   { name: "ws-finance-08", ip: "10.0.20.108" },
      srcip:   "10.0.20.108",
      dstip:   "8.8.8.8",
      dstuser: "j.miller",
      data:    { srcip: "10.0.20.108", dstip: "8.8.8.8", queries: 32, avg_entropy: 4.7, sample_subdomain: "qx7p2k9zr8m4w.fastflux.example" },
    },
    hint: "Genuinely ambiguous — DGA pattern but resolver is Google DNS. Different agents may disagree.",
  },
  {
    id:          "test-credential-access-prod-db",
    rule_id:     "5712",
    description: "[TEST] mssql: 'kerberoast' attempt detected — TGS service-ticket extraction from svc_db on db-prod-02",
    severity:    14,
    source_ip:   "10.0.10.99",
    dest_ip:     "10.0.10.42",
    agent_name:  "db-prod-02",
    hostname:    "db-prod-02",
    user:        "svc_db",
    data: {
      rule:    { id: 5712, level: 14, description: "Kerberoast: TGS-REP extraction attempt" },
      agent:   { name: "db-prod-02", ip: "10.0.10.42" },
      srcip:   "10.0.10.99",
      dstip:   "10.0.10.42",
      dstuser: "svc_db",
      data:    { srcip: "10.0.10.99", dstip: "10.0.10.42", dstuser: "svc_db", spn: "MSSQLSvc/db-prod-02:1433" },
    },
    hint: "Should be flagged as TRUE positive — kerberoast keyword + production DB; high-confidence escalation.",
  },
  {
    id:          "test-monitoring-agent-scan",
    rule_id:     "5715",
    description: "[TEST] tcp connect: monitoring agent 10.0.0.30 issued port-checks across 10.0.0.0/24 (heartbeat job)",
    severity:    7,
    source_ip:   "10.0.0.30",
    dest_ip:     "10.0.0.0",
    agent_name:  "monitoring",
    hostname:    "monitoring",
    user:        "monitor-svc",
    data: {
      rule:    { id: 5715, level: 7, description: "TCP connect: rapid sequential port checks" },
      agent:   { name: "monitoring", ip: "10.0.0.30" },
      srcip:   "10.0.0.30",
      data:    { srcip: "10.0.0.30", dstports: [22, 80, 443, 3306, 5432, 6379, 8080], scope: "10.0.0.0/24" },
    },
    hint: "Should be flagged as FALSE positive — known monitoring agent, low rule level, internal infra heartbeat.",
  },
  {
    id:          "test-uncertain-rdp-after-hours",
    rule_id:     "5710",
    description: "[TEST] RDP session: user a.kumar logged in to ws-eng-12 at 03:14 local — outside their normal 09:00–18:00 pattern",
    severity:    9,
    source_ip:   "10.0.30.55",
    dest_ip:     "10.0.30.12",
    agent_name:  "ws-eng-12",
    hostname:    "ws-eng-12",
    user:        "a.kumar",
    data: {
      rule:    { id: 5710, level: 9, description: "RDP session outside expected hours" },
      agent:   { name: "ws-eng-12", ip: "10.0.30.12" },
      srcip:   "10.0.30.55",
      dstip:   "10.0.30.12",
      dstuser: "a.kumar",
      data:    { srcip: "10.0.30.55", dstip: "10.0.30.12", dstuser: "a.kumar", session_start: "03:14:22", weekday: "Saturday" },
    },
    hint: "Genuinely uncertain — could be insider threat, could be a legitimate on-call engineer. Tests handling of ambiguity.",
  },
];

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF");

// ── 1. Find every test-* alert id (so cleanup catches stale entries from
//      older variants of this seeder, not just the IDs in our current list)
const stale: string[] = (db.prepare(`SELECT id FROM alerts WHERE id LIKE 'test-%'`).all() as Array<{ id: string }>).map(r => r.id);
const targetIds = new Set([...stale, ...ALERTS.map(a => a.id)]);

if (targetIds.size > 0) {
  const ids = [...targetIds];
  const ph  = ids.map(() => "?").join(",");

  // Find any incidents that reference these alerts so we can clean them
  // up too. Otherwise an old reasoning row would survive cleanup and pollute
  // the next run's "real LLM output" demonstration.
  const incidentIds: string[] = (db.prepare(`SELECT DISTINCT incident_id FROM incident_alerts WHERE alert_id IN (${ph})`).all(...ids) as Array<{ incident_id: string }>).map(r => r.incident_id);

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM agent_runs         WHERE alert_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM working_memory     WHERE alert_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM incident_reasoning WHERE alert_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM feedback           WHERE alert_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM action_logs        WHERE alert_id IN (${ph})`).run(...ids);
    if (incidentIds.length > 0) {
      const ip = incidentIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM incident_alerts   WHERE incident_id IN (${ip})`).run(...incidentIds);
      db.prepare(`DELETE FROM incident_actions  WHERE incident_id IN (${ip})`).run(...incidentIds);
      db.prepare(`DELETE FROM incident_timeline WHERE incident_id IN (${ip})`).run(...incidentIds);
      db.prepare(`DELETE FROM incidents         WHERE id IN (${ip})`).run(...incidentIds);
    }
    db.prepare(`DELETE FROM alerts WHERE id IN (${ph})`).run(...ids);
  });
  tx();
  console.log(`[Seeder] removed ${ids.length} stale test-* alert(s) and ${incidentIds.length} derived incident(s)`);
}

if (CLEAN_ONLY) {
  console.log(`[Seeder] --clean specified — exiting without seeding new alerts`);
  db.close();
  process.exit(0);
}

// ── 2. Insert fresh test alerts with status='NEW' so they're investigable ───
const insert = db.prepare(`
  INSERT INTO alerts
    (id, timestamp, rule_id, description, severity, source_ip, dest_ip, agent_name, hostname, user, status, ai_analysis, full_log, mitre_attack)
  VALUES (?, datetime('now', '-' || ? || ' minutes'), ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', '{}', ?, '[]')
`);

const tx = db.transaction(() => {
  let ageMinutes = ALERTS.length * 3; // stagger so they don't all share a timestamp
  for (const a of ALERTS) {
    insert.run(a.id, ageMinutes, a.rule_id, a.description, a.severity, a.source_ip, a.dest_ip, a.agent_name, a.hostname, a.user, JSON.stringify(a.data));
    ageMinutes -= 3;
  }
});
tx();

db.pragma("foreign_keys = ON");

console.log(`\n[Seeder] inserted ${ALERTS.length} test alert(s) — status=NEW:\n`);
for (const a of ALERTS) {
  console.log(`  ${a.id.padEnd(38)} sev=${String(a.severity).padStart(2)}  ${a.description.slice(0, 90)}`);
}

console.log(`\n[Seeder] To investigate them with the real LLM-backed orchestrator:`);
console.log(`  - Option A (UI): open the dashboard, find the [TEST] alerts, click "Run Investigation" on each`);
console.log(`  - Option B (API): POST /api/ai/orchestrate?alertId=<id>`);
console.log(`\n[Seeder] After investigation runs, the resulting incident's "Reasoning" tab will show real LLM output.`);
console.log(`[Seeder] To remove these alerts (and any incidents they spawned): npx tsx scripts/seed-test-alerts.ts --clean\n`);

db.close();
