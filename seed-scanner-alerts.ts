/**
 * seed-scanner-alerts.ts
 *
 * Inserts test alerts simulating vulnerability scanners, repeated noise, and
 * real attacks mixed in. Designed to validate the memory-driven FP detection.
 *
 * Categories:
 *   1. Scanner FPs (172.10.9.x) — look like real attacks but come from known scanners
 *   2. Repeated noise            — benign activity that triggers low-sev alerts
 *   3. Real attacks              — MUST NOT be auto-FP'd even if src IP overlaps with noise
 */

import Database from 'better-sqlite3';

const db = new Database('soc.db');
db.pragma('journal_mode = WAL');

function mins(offset: number): string {
  const d = new Date(Date.now() - offset * 60 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

const insert = db.prepare(`
  INSERT OR IGNORE INTO alerts
    (id, timestamp, rule_id, description, severity, source_ip, dest_ip, user, hostname, agent_name, full_log, status)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW')
`);

const alerts = [

  // ─── SCANNER FALSE POSITIVES (from known OpenVAS scanner 172.10.9.10) ───
  {
    id: 'scan-01', ts: mins(30), rule_id: '31103',
    desc: 'Web Application Attack: XSS (Cross-Site Scripting) payload detected from vulnerability scanner',
    severity: 11, src: '172.10.9.10', dst: '10.0.0.5', user: null,
    host: 'web-gateway-lb', agent: 'web-gateway-lb',
    log: 'Apr 24 10:30:00 web-gateway-lb modsec: [id "941100"] [msg "XSS Attack Detected"] [data "<script>alert(1)</script>"] [uri "/api/profile"] client: 172.10.9.10 — OpenVAS scan window',
  },
  {
    id: 'scan-02', ts: mins(29), rule_id: '31101',
    desc: 'Web Application Attack: SQL Injection attempt detected from vulnerability scanner',
    severity: 12, src: '172.10.9.10', dst: '10.0.0.5', user: null,
    host: 'web-gateway-lb', agent: 'web-gateway-lb',
    log: "Apr 24 10:31:00 web-gateway-lb nginx: 172.10.9.10 \"GET /login?user=' OR 1=1 -- HTTP/1.1\" 403 — OpenVAS SQLi test",
  },
  {
    id: 'scan-03', ts: mins(28), rule_id: '31150',
    desc: 'Web Application Attack: Path Traversal ../../etc/passwd from vulnerability scanner',
    severity: 12, src: '172.10.9.10', dst: '10.0.0.5', user: null,
    host: 'web-gateway-lb', agent: 'web-gateway-lb',
    log: 'Apr 24 10:32:00 web-gateway-lb nginx: 172.10.9.10 "GET /download?file=../../etc/passwd HTTP/1.1" 400 — OpenVAS path traversal check',
  },
  {
    id: 'scan-04', ts: mins(27), rule_id: '5710',
    desc: 'SSH Brute Force: Multiple failed login attempts from vulnerability scanner IP',
    severity: 10, src: '172.10.9.10', dst: '10.0.0.5', user: 'root',
    host: 'web-server-01', agent: 'web-server-01',
    log: 'Apr 24 10:33:00 web-server-01 sshd: Failed password for root from 172.10.9.10 port 44100 ssh2 — OpenVAS SSH credential check',
  },
  {
    id: 'scan-05', ts: mins(26), rule_id: '31160',
    desc: 'Web Application Attack: Directory bruteforce (gobuster pattern) from scanner',
    severity: 8, src: '172.10.9.10', dst: '10.0.0.5', user: null,
    host: 'web-gateway-lb', agent: 'web-gateway-lb',
    log: 'Apr 24 10:34:00 web-gateway-lb nginx: 172.10.9.10 rapid 404s: /admin /wp-login.php /phpmyadmin /actuator — directory enumeration pattern (OpenVAS)',
  },
  {
    id: 'scan-06', ts: mins(25), rule_id: '31170',
    desc: 'Web Application Attack: LDAP Injection attempt from vulnerability scanner',
    severity: 11, src: '172.10.9.10', dst: '10.0.0.5', user: null,
    host: 'web-gateway-lb', agent: 'web-gateway-lb',
    log: 'Apr 24 10:35:00 web-gateway-lb modsec: [id "943100"] [msg "LDAP Injection"] [data "*)(&"] [uri "/api/search"] client: 172.10.9.10 — OpenVAS LDAP injection test',
  },
  {
    id: 'scan-07', ts: mins(60), rule_id: '40113',
    desc: 'Network Scan: Nessus vulnerability assessment scan from authorized scanner',
    severity: 9, src: '172.10.9.11', dst: '10.10.0.0/24', user: null,
    host: 'fw-edge-01', agent: 'fw-edge-01',
    log: 'Apr 24 09:00:00 fw-edge-01 kernel: Nessus scan from 172.10.9.11 — scheduled vulnerability assessment per IS-POL-042',
  },
  {
    id: 'scan-08', ts: mins(55), rule_id: '40113',
    desc: 'Network Scan: Qualys PCI compliance scan from authorized scanner',
    severity: 7, src: '172.10.9.12', dst: '10.10.0.0/24', user: null,
    host: 'fw-edge-01', agent: 'fw-edge-01',
    log: 'Apr 24 09:05:00 fw-edge-01 kernel: Qualys PCI scan from 172.10.9.12 — quarterly PCI-DSS compliance assessment',
  },

  // ─── REPEATED NOISE (benign activity that triggers alerts) ──────────────
  {
    id: 'noise-01', ts: mins(120), rule_id: '5710',
    desc: 'SSH Login Failure: Failed password for admin from known admin workstation',
    severity: 5, src: '10.0.5.20', dst: '10.0.0.10', user: 'admin',
    host: 'jump-server-01', agent: 'jump-server-01',
    log: 'Apr 24 08:00:00 jump-server-01 sshd: Failed password for admin from 10.0.5.20 — typo in password (admin workstation)',
  },
  {
    id: 'noise-02', ts: mins(100), rule_id: '5710',
    desc: 'SSH Login Failure: Failed password for admin from known admin workstation',
    severity: 5, src: '10.0.5.20', dst: '10.0.0.10', user: 'admin',
    host: 'jump-server-01', agent: 'jump-server-01',
    log: 'Apr 24 08:20:00 jump-server-01 sshd: Failed password for admin from 10.0.5.20 — repeated typo',
  },
  {
    id: 'noise-03', ts: mins(80), rule_id: '5710',
    desc: 'SSH Login Failure: Failed password for admin from known admin workstation',
    severity: 5, src: '10.0.5.20', dst: '10.0.0.10', user: 'admin',
    host: 'jump-server-01', agent: 'jump-server-01',
    log: 'Apr 24 08:40:00 jump-server-01 sshd: Failed password for admin from 10.0.5.20 — caps lock was on',
  },
  {
    id: 'noise-04', ts: mins(150), rule_id: '2910',
    desc: 'Scheduled Task: Cron job execution on backup server — routine log rotation',
    severity: 2, src: '10.0.0.3', dst: null, user: 'backup',
    host: 'backup-agent-01', agent: 'backup-agent-01',
    log: 'Apr 24 07:30:00 backup-agent-01 CRON[5678]: (backup) CMD (/usr/sbin/logrotate /etc/logrotate.conf) — scheduled maintenance',
  },
  {
    id: 'noise-05', ts: mins(140), rule_id: '1002',
    desc: 'System Event: NTP synchronization failure — intermittent network delay',
    severity: 3, src: '10.0.0.1', dst: '129.6.15.28', user: null,
    host: 'core-router-01', agent: 'core-router-01',
    log: 'Apr 24 07:40:00 core-router-01 ntpd: NTP sync failure: no response from 129.6.15.28 — network jitter (resolves automatically)',
  },

  // ─── REAL ATTACKS (must NOT be FP'd even if src IP overlaps with noise) ─
  {
    id: 'real-01', ts: mins(15), rule_id: '92651',
    desc: 'C2 Beacon Detected: Outbound connections to unknown external C2 server from admin workstation',
    severity: 14, src: '10.0.5.20', dst: '198.51.100.77', user: 'admin',
    host: 'admin-ws-03', agent: 'admin-ws-03',
    log: 'Apr 24 10:45:00 admin-ws-03 Sysmon: NETWORK_CONNECT pid=8812 image=C:\\Users\\admin\\AppData\\svchost32.exe dst=198.51.100.77:443 interval=60s — C2 beacon pattern (60s jitter)',
  },
  {
    id: 'real-02', ts: mins(10), rule_id: '88001',
    desc: 'Data Exfiltration: DNS tunneling detected from compromised workstation to attacker domain',
    severity: 13, src: '10.0.1.55', dst: '8.8.8.8', user: 'jdoe',
    host: 'win-workstation-07', agent: 'win-workstation-07',
    log: 'Apr 24 10:50:00 dns-server-01 named: 1200 DNS queries to *.exfil.evil.cc from 10.0.1.55 in 120s — base64-encoded subdomains (DNS tunneling)',
  },
  {
    id: 'real-03', ts: mins(5), rule_id: '100201',
    desc: 'Malware Detected: Ransomware dropper identified on file server — immediate containment required',
    severity: 15, src: '10.0.2.30', dst: null, user: 'msmith',
    host: 'file-server-01', agent: 'file-server-01',
    log: 'Apr 24 10:55:00 file-server-01 WinDefend: DETECTION Ransom:Win32/LockBit.A file=C:\\Shares\\Finance\\encrypt.exe SHA256=abc123... — QUARANTINE FAILED',
  },
];

let inserted = 0;
let skipped  = 0;

for (const a of alerts) {
  const result = insert.run(
    a.id, a.ts, a.rule_id, a.desc, a.severity,
    a.src, a.dst, a.user, a.host, a.agent,
    a.log,
  );
  if (result.changes > 0) {
    inserted++;
    console.log(`  ✓ [${a.id}] ${a.desc.slice(0, 70)}`);
  } else {
    skipped++;
    console.log(`  ⟳ [${a.id}] already exists — skipped`);
  }
}

console.log(`\nDone: ${inserted} inserted, ${skipped} skipped`);
console.log('\nAlert breakdown:');
console.log('  Scanner FPs (172.10.9.x):   scan-01 → scan-08  (XSS, SQLi, path traversal, brute force, dir enum, LDAP inj, Nessus, Qualys)');
console.log('  Repeated noise:              noise-01 → noise-05 (admin typos, cron, NTP)');
console.log('  Real attacks (must NOT FP):  real-01 → real-03   (C2 beacon, DNS tunneling, ransomware)');
console.log('\nKey test: scan-* alerts should be auto-FP\'d when asset_context has 172.10.9.x registered as scanners.');
console.log('Key test: real-01 uses same src IP (10.0.5.20) as noise-01..03 — must NOT be FP\'d due to C2 pattern.\n');

db.close();
