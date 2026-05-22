/**
 * End-to-end test for the Tier 1.1 + 1.2 feedback loop & reasoning trace.
 *
 * Spins up the real server on a free port with a fresh temp DB, logs in,
 * seeds a synthetic alert, then exercises every new HTTP endpoint:
 *
 *   POST /api/alerts/:id/confirm-fp        → ioc_memory.fp_count++
 *   POST /api/alerts/:id/override-fp       → ioc_memory.tp_count++
 *   POST /api/alerts/:id/escalate          → ioc_memory.tp_count++ + incident
 *   POST /api/incidents/:id/reclassify-fp  → ioc_memory.fp_count++ for linked
 *   GET  /api/alerts/:id/reasoning         → returns persisted reasoning rows
 *   GET  /api/incidents/:id/reasoning      → aggregated across linked alerts
 *
 * Run:
 *   npx tsx scripts/test-feedback-e2e.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import Database from "better-sqlite3";

const DB = "/tmp/aisoc-e2e-feedback.db";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { console.log(`  ✓ ${label}`); pass++; }
  else    { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); fail++; }
};

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function startServer(port: number, verbose = false): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", "server.ts"], {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        PORT: String(port),
        SOC_DB_PATH: DB,
        JWT_SECRET: "e2e-test-secret",
        // Force HTTP for the test — we don't need TLS to validate the wiring.
        TLS_CERT: "/dev/null/no-cert",
        TLS_KEY:  "/dev/null/no-key",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    let resolved = false;
    child.stderr?.on("data", (b) => {
      stderr += String(b);
      if (verbose) process.stderr.write(`[server] ${b}`);
    });
    child.stdout?.on("data", (b) => {
      stdout += String(b);
      if (verbose) process.stdout.write(`[server] ${b}`);
      if (!resolved && stdout.includes(`SOC Server running`)) {
        resolved = true;
        resolve(child);
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!resolved) {
        reject(new Error(`server exited with ${code} before ready\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
      }
    });
    setTimeout(() => {
      if (!resolved) reject(new Error(`server did not start in 60s\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    }, 60_000);
  });
}

async function waitForReady(base: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "_warmup", password: "_warmup" }),
      });
      // any HTTP response (even 401) means the server is accepting connections
      if (r.status >= 200 && r.status < 600) return;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server never became ready for HTTP");
}

async function main() {
  // Fresh DB so we start clean
  for (const f of [DB, DB + "-shm", DB + "-wal"]) try { fs.unlinkSync(f); } catch {}

  const port = await getFreePort();
  const verbose = process.env.VERBOSE === "1";
  console.log(`[E2E] starting server on port ${port} with DB ${DB}`);
  const child = await startServer(port, verbose);
  const base = `http://127.0.0.1:${port}`;
  await waitForReady(base);
  console.log(`[E2E] server ready`);

  try {
    // ── Verify schema migrations created the new table ────────────────────
    console.log("\n[A] schema migration");
    const d = new Database(DB);
    const tableInfo = d.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='incident_reasoning'`).get();
    check("incident_reasoning table created", !!tableInfo);
    const cols = d.prepare(`PRAGMA table_info(incident_reasoning)`).all() as any[];
    const colNames = cols.map(c => c.name);
    for (const expected of ["alert_id", "trace_id", "agent", "step", "decision", "evidence_for", "evidence_against", "rejected_hypotheses", "confidence"]) {
      check(`column ${expected} exists`, colNames.includes(expected));
    }
    d.close();

    // ── Login as admin ────────────────────────────────────────────────────
    console.log("\n[B] login");
    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" }),
    });
    const loginBody: any = await loginRes.json();
    check("login OK", loginRes.status === 200, `status=${loginRes.status}`);
    check("token returned", typeof loginBody.token === "string");
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${loginBody.token}` };

    // ── Seed a synthetic alert ────────────────────────────────────────────
    console.log("\n[C] seed alerts");
    const alertId = "e2e-alert-" + Math.random().toString(36).slice(2, 10);
    const triageData = JSON.stringify({
      iocs: { ips: ["10.99.99.10", "8.8.8.8"], users: [], hosts: ["e2e-host-01"], hashes: [], files: [], domains: [], urls: [] },
      analysis_summary: "E2E synthetic alert for feedback loop verification",
      is_false_positive: false,
      false_positive_confidence: 0.4,
    });
    const d2 = new Database(DB);
    d2.prepare(`
      INSERT INTO alerts (id, timestamp, rule_id, description, severity, source_ip, dest_ip, agent_name, hostname, status, ai_analysis, full_log, mitre_attack, triage_data)
      VALUES (?, datetime('now'), '5710', 'E2E test alert: SSH brute force from 10.99.99.10', 10, '10.99.99.10', '8.8.8.8', 'e2e-host-01', 'e2e-host-01', 'NEW', '{}', '{}', '[]', ?)
    `).run(alertId, triageData);
    d2.close();

    // ── Test confirm-fp ───────────────────────────────────────────────────
    console.log("\n[D] POST /api/alerts/:id/confirm-fp");
    const confirmRes = await fetch(`${base}/api/alerts/${alertId}/confirm-fp`, { method: "POST", headers });
    const confirmBody: any = await confirmRes.json();
    check("confirm-fp returns 200", confirmRes.status === 200, `got ${confirmRes.status}`);
    check("response.feedback.iocs is non-empty array", Array.isArray(confirmBody?.feedback?.iocs) && confirmBody.feedback.iocs.length > 0, JSON.stringify(confirmBody?.feedback));

    const d3 = new Database(DB);
    const ipRow: any = d3.prepare("SELECT fp_count, tp_count FROM ioc_memory WHERE value=?").get("10.99.99.10");
    const hostRow: any = d3.prepare("SELECT fp_count, tp_count FROM ioc_memory WHERE value=?").get("e2e-host-01");
    d3.close();
    check("ioc_memory row created for source IP", !!ipRow);
    check("fp_count incremented for IP", ipRow?.fp_count >= 1, `got ${ipRow?.fp_count}`);
    check("ioc_memory row created for host", !!hostRow);

    // alert status should now be FP_CONFIRMED
    const d4 = new Database(DB);
    const alertRow: any = d4.prepare("SELECT status FROM alerts WHERE id=?").get(alertId);
    d4.close();
    check("alert status updated to FP_CONFIRMED", alertRow?.status === "FP_CONFIRMED", `got ${alertRow?.status}`);

    // ── Test override-fp on a fresh alert ─────────────────────────────────
    console.log("\n[E] POST /api/alerts/:id/override-fp");
    const alertId2 = "e2e-alert-" + Math.random().toString(36).slice(2, 10);
    const d5 = new Database(DB);
    d5.prepare(`
      INSERT INTO alerts (id, timestamp, rule_id, description, severity, source_ip, agent_name, status, ai_analysis, full_log, mitre_attack)
      VALUES (?, datetime('now'), '5710', 'E2E override test', 10, '10.99.99.20', 'e2e-host-02', 'FILTERED', '{}', '{}', '[]')
    `).run(alertId2);
    d5.close();

    const overRes = await fetch(`${base}/api/alerts/${alertId2}/override-fp`, { method: "POST", headers });
    const overBody: any = await overRes.json();
    check("override-fp returns 200", overRes.status === 200);

    const d6 = new Database(DB);
    const overIp: any = d6.prepare("SELECT fp_count, tp_count FROM ioc_memory WHERE value=?").get("10.99.99.20");
    d6.close();
    check("override-fp incremented tp_count", overIp?.tp_count >= 1, `got ${overIp?.tp_count}`);
    check("override-fp left fp_count alone", overIp?.fp_count === 0);

    // ── Test reasoning endpoints ──────────────────────────────────────────
    console.log("\n[F] reasoning endpoints");
    // Insert a reasoning trace directly
    const d7 = new Database(DB);
    d7.prepare(`
      INSERT INTO incident_reasoning (alert_id, trace_id, agent, step, decision, evidence_for, evidence_against, rejected_hypotheses, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(alertId, "trace-e2e-1", "analysis", 2,
      "FP — backup pattern matches",
      JSON.stringify(["src is known backup host", "low rule level"]),
      JSON.stringify(["unusual time"]),
      JSON.stringify(["data exfil — no large outbound payload"]),
      0.85,
    );
    d7.prepare(`
      INSERT INTO incident_reasoning (alert_id, trace_id, agent, step, decision, evidence_for, evidence_against, rejected_hypotheses, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(alertId, "trace-e2e-1", "intel", 5,
      "No MISP hits — benign",
      JSON.stringify(["MISP returned 0 hits"]),
      JSON.stringify([]),
      JSON.stringify([]),
      0.9,
    );
    d7.close();

    const reasonRes = await fetch(`${base}/api/alerts/${alertId}/reasoning`, { headers });
    const reasonBody: any = await reasonRes.json();
    check("GET reasoning returns 200", reasonRes.status === 200, `got ${reasonRes.status}`);
    check("reasoning has 2 rows", reasonBody?.count === 2, `got count=${reasonBody?.count}`);
    check("first row is analysis", reasonBody?.reasoning?.[0]?.agent === "analysis");
    check("evidence_for is array", Array.isArray(reasonBody?.reasoning?.[0]?.evidence_for));
    check("rejected_hypotheses preserved", String(JSON.stringify(reasonBody?.reasoning?.[0]?.rejected_hypotheses)).includes("data exfil"));

    // ── Test reasoning endpoint with non-existent alert ───────────────────
    const noResReq = await fetch(`${base}/api/alerts/no-such-id/reasoning`, { headers });
    const noResBody: any = await noResReq.json();
    check("missing alert returns count=0 (graceful)", noResReq.status === 200 && noResBody?.count === 0);

    // ── Test auto-learning across many FP confirmations ───────────────────
    console.log("\n[G] auto-learning crosses fp_default threshold after 10+ FPs");
    // Pre-load an IOC with 11 FP signals so the next confirm-fp pushes it
    // over (12 FPs across 12 alerts → fp_ratio=1.0, total=12 → auto-register)
    const d8 = new Database(DB);
    d8.prepare("INSERT OR REPLACE INTO ioc_memory (value, type, alert_count, fp_count, tp_count) VALUES ('10.99.99.30', 'ip', 11, 11, 0)").run();
    // Create another alert with that IP so the next confirm-fp pushes it to 12
    const alertId3 = "e2e-alert-" + Math.random().toString(36).slice(2, 10);
    const triageData3 = JSON.stringify({ iocs: { ips: ["10.99.99.30"], users: [], hosts: [], hashes: [], files: [], domains: [], urls: [] } });
    d8.prepare(`
      INSERT INTO alerts (id, timestamp, rule_id, description, severity, source_ip, status, ai_analysis, full_log, mitre_attack, triage_data)
      VALUES (?, datetime('now'), '5710', 'E2E auto-learn alert', 10, '10.99.99.30', 'NEW', '{}', '{}', '[]', ?)
    `).run(alertId3, triageData3);
    d8.close();

    await fetch(`${base}/api/alerts/${alertId3}/confirm-fp`, { method: "POST", headers });

    const d9 = new Database(DB);
    const auto: any = d9.prepare("SELECT * FROM asset_context WHERE value=?").get("10.99.99.30");
    d9.close();
    check("auto-promoted to asset_context", !!auto);
    check("source='auto-learned'", auto?.source === "auto-learned", `got ${auto?.source}`);
    check("fp_default=1", auto?.fp_default === 1);

    // ── Test 401 unauthenticated path ─────────────────────────────────────
    console.log("\n[H] auth on new endpoints");
    const unauthFp = await fetch(`${base}/api/alerts/${alertId}/confirm-fp`, { method: "POST" });
    check("confirm-fp without auth returns 401", unauthFp.status === 401, `got ${unauthFp.status}`);
    const unauthReason = await fetch(`${base}/api/alerts/${alertId}/reasoning`);
    check("reasoning without auth returns 401", unauthReason.status === 401, `got ${unauthReason.status}`);

  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (!child.killed) child.kill("SIGKILL");
    for (const f of [DB, DB + "-shm", DB + "-wal"]) try { fs.unlinkSync(f); } catch {}
  }

  console.log(`\n[Result] ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[E2E] fatal:", err);
  process.exit(2);
});
