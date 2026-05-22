/**
 * Integration test for the Tier 1.1 + 1.2 unit:
 *  - feedback writes propagate to ioc_memory
 *  - processAutoLearning promotes high-FP IOCs into asset_context
 *  - reasoning rows are persisted and retrievable
 *  - cross-agent memory reads return prior reasoning
 *
 * Run with:
 *   SOC_DB_PATH=/tmp/aisoc-test.db npx tsx scripts/test-feedback-loop.ts
 *
 * The test uses a throwaway DB so it never touches production data.
 */
import path from "node:path";
import fs from "node:fs";
import url from "node:url";
import Database from "better-sqlite3";

const DB = process.env.SOC_DB_PATH ?? "/tmp/aisoc-test-feedback.db";
process.env.SOC_DB_PATH = DB;
try { fs.unlinkSync(DB); } catch {}

// Bootstrap a minimal schema mirroring the production tables we touch.
// We deliberately avoid spinning up the full server — the goal is a fast
// in-process check that the helpers do what they say.
const db = new Database(DB);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE alerts (
    id TEXT PRIMARY KEY,
    timestamp TEXT, rule_id TEXT, description TEXT, severity INTEGER,
    source_ip TEXT, dest_ip TEXT, agent_name TEXT, hostname TEXT, user TEXT,
    status TEXT, ai_analysis TEXT, full_log TEXT, mitre_attack TEXT,
    triage_data TEXT, fp_method TEXT, fp_reason TEXT,
    fp_confidence REAL DEFAULT 0, fp_details TEXT,
    filtered_at TEXT, investigated_at TEXT, escalated_at TEXT, closed_at TEXT
  );
  CREATE TABLE ioc_memory (
    value TEXT PRIMARY KEY, type TEXT,
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen  DATETIME DEFAULT CURRENT_TIMESTAMP,
    alert_count INTEGER DEFAULT 1,
    threat_level TEXT, notes TEXT,
    fp_count INTEGER DEFAULT 0, tp_count INTEGER DEFAULT 0
  );
  CREATE TABLE asset_context (
    value TEXT PRIMARY KEY, type TEXT NOT NULL, role TEXT NOT NULL,
    description TEXT, fp_default INTEGER DEFAULT 0,
    source TEXT DEFAULT 'manual',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE incident_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id TEXT, idempotency_key TEXT UNIQUE,
    summary TEXT, attack_pattern TEXT, threat_actor TEXT,
    outcome TEXT, ttp_tags TEXT, embedding BLOB,
    triggered_by TEXT DEFAULT 'triage',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE incident_reasoning (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id TEXT, trace_id TEXT,
    agent TEXT NOT NULL, step INTEGER DEFAULT 0,
    decision TEXT,
    evidence_for TEXT, evidence_against TEXT, rejected_hypotheses TEXT,
    confidence REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
db.close();

// Now load the real modules; their internal memDb() will see SOC_DB_PATH.
const { reinforceFeedback, processAutoLearning, scanForFpSuggestions } =
  await import("../agents/memory/learning.js");
const { recordReasoning, listReasoningForAlert } =
  await import("../agents/memory/reasoning.js");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { console.log(`  ✓ ${label}`); pass++; }
  else    { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); fail++; }
};

// ── Test 1: reinforceFeedback bumps fp_count ───────────────────────────────
console.log("\n[1] reinforceFeedback writes FP/TP counts");
{
  const d = new Database(DB);
  d.prepare("INSERT INTO ioc_memory (value, type, alert_count) VALUES (?, ?, 1)")
    .run("10.0.0.42", "ip");
  d.close();

  reinforceFeedback(["10.0.0.42"], "FALSE_POSITIVE");
  reinforceFeedback(["10.0.0.42"], "FALSE_POSITIVE");
  reinforceFeedback(["10.0.0.42"], "TRUE_POSITIVE");

  const d2 = new Database(DB);
  const row: any = d2.prepare("SELECT fp_count, tp_count FROM ioc_memory WHERE value = ?")
    .get("10.0.0.42");
  d2.close();
  check("fp_count == 2", row?.fp_count === 2, `got ${row?.fp_count}`);
  check("tp_count == 1", row?.tp_count === 1, `got ${row?.tp_count}`);
}

// ── Test 2: processAutoLearning promotes high-FP IOC into asset_context ────
console.log("\n[2] processAutoLearning promotes when fp_ratio >= 0.95 AND total >= 10");
{
  const d = new Database(DB);
  d.prepare("INSERT INTO ioc_memory (value, type, alert_count, fp_count, tp_count) VALUES ('192.168.1.99', 'ip', 12, 12, 0)").run();
  d.close();

  const newly = processAutoLearning();
  check("at least one auto-registered", newly.length >= 1);

  const d2 = new Database(DB);
  const asset: any = d2.prepare("SELECT * FROM asset_context WHERE value = ?").get("192.168.1.99");
  d2.close();
  check("asset_context row exists", !!asset);
  check("source='auto-learned'", asset?.source === "auto-learned", `got ${asset?.source}`);
  check("fp_default=1", asset?.fp_default === 1, `got ${asset?.fp_default}`);
}

// ── Test 3: scanForFpSuggestions returns 'suggest' for borderline IOCs ─────
console.log("\n[3] scanForFpSuggestions classifies borderline IOCs");
{
  const d = new Database(DB);
  // 6 alerts, 5 FP / 1 TP → fp_ratio ~0.83 → below 0.85 → no suggestion
  d.prepare("INSERT INTO ioc_memory (value, type, alert_count, fp_count, tp_count) VALUES ('5.5.5.5', 'ip', 6, 5, 1)").run();
  // 8 alerts, 7 FP / 1 TP → fp_ratio 0.875 → suggest (not auto-register)
  d.prepare("INSERT INTO ioc_memory (value, type, alert_count, fp_count, tp_count) VALUES ('6.6.6.6', 'ip', 8, 7, 1)").run();
  d.close();

  const suggestions = scanForFpSuggestions();
  const five = suggestions.find(s => s.value === "5.5.5.5");
  const six  = suggestions.find(s => s.value === "6.6.6.6");
  check("5.5.5.5 not flagged (below 0.85)", !five);
  check("6.6.6.6 flagged as 'suggest'", six?.suggestion === "suggest", `got ${six?.suggestion}`);
}

// ── Test 4: recordReasoning + listReasoningForAlert round-trip ─────────────
console.log("\n[4] recordReasoning round-trip");
{
  recordReasoning({
    alertId: "alert-A",
    traceId: "trace-1",
    agent:   "analysis",
    step:    2,
    reasoning: {
      decision:           "False positive — backup service traffic",
      evidence_for:       ["src is 10.0.0.20 (known backup)", "dst port 22 to NAS"],
      evidence_against:   ["unusual time window"],
      rejected_hypotheses: ["data exfil — no large outbound payload"],
      confidence:         0.82,
    },
  });
  recordReasoning({
    alertId: "alert-A",
    traceId: "trace-1",
    agent:   "intel",
    step:    5,
    reasoning: {
      decision:           "Benign — no MISP hits and matches known backup pattern",
      evidence_for:       ["MISP returned 0 hits"],
      evidence_against:   [],
      rejected_hypotheses: [],
      confidence:         0.9,
    },
  });

  const rows = listReasoningForAlert("alert-A");
  check("two reasoning rows persisted", rows.length === 2, `got ${rows.length}`);
  check("first row is from analysis", rows[0]?.agent === "analysis");
  check("evidence_for parsed back to array", Array.isArray(rows[0]?.evidence_for) && rows[0].evidence_for.length === 2);
  check("rejected_hypotheses preserved", (rows[0]?.rejected_hypotheses ?? []).some(h => h.includes("data exfil")));
}

// ── Test 5: empty / dud reasoning is silently skipped ──────────────────────
console.log("\n[5] empty reasoning is skipped (no row inserted)");
{
  recordReasoning({
    alertId: "alert-B",
    traceId: "trace-2",
    agent:   "analysis",
    step:    2,
    reasoning: { decision: "", evidence_for: [], evidence_against: [], rejected_hypotheses: [], confidence: 0 },
  });
  const rows = listReasoningForAlert("alert-B");
  check("no row inserted for empty reasoning", rows.length === 0, `got ${rows.length}`);
}

// ── Test 6: TP override revokes auto-learned fp_default ────────────────────
console.log("\n[6] TP override on auto-learned asset revokes fp_default");
{
  const d = new Database(DB);
  d.prepare(`INSERT INTO asset_context (value, type, role, description, fp_default, source) VALUES ('77.77.77.77','ip','production','Auto-learned: 12/12 alerts were FP (100%)',1,'auto-learned')`).run();
  d.prepare("INSERT INTO ioc_memory (value, type, alert_count, fp_count, tp_count) VALUES ('77.77.77.77','ip',12,12,0)").run();
  d.close();

  reinforceFeedback(["77.77.77.77"], "TRUE_POSITIVE");

  const d2 = new Database(DB);
  const a: any = d2.prepare("SELECT fp_default, description FROM asset_context WHERE value=?").get("77.77.77.77");
  d2.close();
  check("fp_default revoked to 0", a?.fp_default === 0, `got ${a?.fp_default}`);
  check("description annotated", String(a?.description).includes("[REVOKED by TP feedback]"));
}

console.log(`\n[Result] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
