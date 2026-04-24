/**
 * seed-test-alerts.ts
 *
 * Inserts a realistic set of test alerts directly into SQLite for demo/testing.
 * Covers three scenarios:
 *   1. Correlated campaign  — 5 alerts from same attacker IP over 60 min (for Correlation agent)
 *   2. False positives      — 4 alerts that should be auto-FP'd (monitoring, backup, nmap, healthcheck)
 *   3. Independent threats  — 5 isolated high-severity alerts from different sources
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

  // ─── CAMPAIGN: SSH brute-force → login → priv-esc from 185.220.101.47 ───────
  // (Correlation agent should link these as a single campaign)

  {
    id:        'camp-01',
    ts:        mins(65),
    rule_id:   '40101',
    desc:      'Port Scan Detected: Sequential port scan from external IP',
    severity:  7,
    src:       '185.220.101.47',
    dst:       '10.10.0.5',
    user:      null,
    host:      'fw-edge-01',
    agent:     'fw-edge-01',
    log:       'Apr 24 10:01:12 fw-edge-01 kernel: DROP IN=eth0 SRC=185.220.101.47 DST=10.10.0.5 PROTO=TCP DPT=22 — Nmap SYN scan pattern',
  },
  {
    id:        'camp-02',
    ts:        mins(50),
    rule_id:   '5710',
    desc:      'SSH Brute Force: Multiple failed logins from single external IP (>10 in 60s)',
    severity:  10,
    src:       '185.220.101.47',
    dst:       null,
    user:      'root',
    host:      'web-server-01',
    agent:     'web-server-01',
    log:       'Apr 24 10:16:05 web-server-01 sshd[3810]: Failed password for root from 185.220.101.47 port 51234 ssh2 [attempt 14/20]',
  },
  {
    id:        'camp-03',
    ts:        mins(42),
    rule_id:   '5763',
    desc:      'SSH Brute Force Threshold Exceeded: >20 failed attempts — possible credential stuffing',
    severity:  11,
    src:       '185.220.101.47',
    dst:       null,
    user:      'admin',
    host:      'web-server-01',
    agent:     'web-server-01',
    log:       'Apr 24 10:24:44 web-server-01 sshd[3810]: Failed password for admin from 185.220.101.47 — brute force threshold exceeded (22 attempts)',
  },
  {
    id:        'camp-04',
    ts:        mins(35),
    rule_id:   '5715',
    desc:      'SSH Login Success After Multiple Failures: Possible credential compromise from brute-forced IP',
    severity:  13,
    src:       '185.220.101.47',
    dst:       null,
    user:      'deploy',
    host:      'web-server-01',
    agent:     'web-server-01',
    log:       'Apr 24 10:31:17 web-server-01 sshd[3812]: Accepted password for deploy from 185.220.101.47 port 51299 ssh2 — after 28 failed attempts',
  },
  {
    id:        'camp-05',
    ts:        mins(28),
    rule_id:   '5501',
    desc:      'Privilege Escalation: Unexpected sudo usage — user deploy executed /bin/bash as root',
    severity:  14,
    src:       '185.220.101.47',
    dst:       null,
    user:      'deploy',
    host:      'web-server-01',
    agent:     'web-server-01',
    log:       'Apr 24 10:38:53 web-server-01 sudo: deploy : TTY=pts/1 ; PWD=/home/deploy ; USER=root ; COMMAND=/bin/bash',
  },

  // ─── FALSE POSITIVES ──────────────────────────────────────────────────────────
  // (Analysis agent should flag these as FP based on FP indicators in the prompt)

  {
    id:        'fp-01',
    ts:        mins(120),
    rule_id:   '31101',
    desc:      'Web Request — Automated healthcheck probe detected on /health endpoint',
    severity:  3,
    src:       '192.168.1.10',
    dst:       null,
    user:      null,
    host:      'web-server-01',
    agent:     'monitoring-agent-01',
    log:       'Apr 24 08:45:00 web-server-01 nginx: 192.168.1.10 - - "GET /health HTTP/1.1" 200 — healthcheck probe from internal monitoring',
  },
  {
    id:        'fp-02',
    ts:        mins(105),
    rule_id:   '2910',
    desc:      'Log Rotation: logrotate executed by backup service — routine maintenance',
    severity:  2,
    src:       '10.0.0.3',
    dst:       null,
    user:      'backup',
    host:      'backup-agent-01',
    agent:     'backup-agent-01',
    log:       'Apr 24 09:00:00 backup-agent-01 CRON[1234]: (backup) CMD (/usr/sbin/logrotate /etc/logrotate.conf)',
  },
  {
    id:        'fp-03',
    ts:        mins(90),
    rule_id:   '40113',
    desc:      'Network Scan: nmap host discovery scan from internal security scanner',
    severity:  5,
    src:       '192.168.1.100',
    dst:       '192.168.0.0/24',
    user:      null,
    host:      'security-scanner-01',
    agent:     'security-scanner-01',
    log:       'Apr 24 09:15:00 fw-01 kernel: nmap scan detected from 192.168.1.100 — scheduled vulnerability assessment window',
  },
  {
    id:        'fp-04',
    ts:        mins(75),
    rule_id:   '100024',
    desc:      'Authentication: Service account login from internal monitoring platform',
    severity:  4,
    src:       '10.0.0.15',
    dst:       null,
    user:      'svc-monitor',
    host:      'monitoring-02',
    agent:     'monitoring-agent-02',
    log:       'Apr 24 09:30:00 monitoring-02 auth: Accepted publickey for svc-monitor from 10.0.0.15 — automated monitoring check',
  },

  // ─── INDEPENDENT HIGH-SEVERITY ALERTS ─────────────────────────────────────────
  // (Different sources — correlation agent should find no campaign link)

  {
    id:        'ind-01',
    ts:        mins(180),
    rule_id:   '31106',
    desc:      'Web Application Attack: SQL Injection attempt in GET parameter — union-based exfiltration pattern',
    severity:  12,
    src:       '203.0.113.50',
    dst:       null,
    user:      null,
    host:      'web-app-01',
    agent:     'web-app-01',
    log:       "Apr 24 07:45:00 web-app-01 nginx: 203.0.113.50 GET /api/users?id=1'+UNION+SELECT+username,password+FROM+users-- HTTP 500",
  },
  {
    id:        'ind-02',
    ts:        mins(150),
    rule_id:   '87105',
    desc:      'C2 Beacon Detected: Repeated TLS beaconing to known Cobalt Strike C2 server every 60 seconds',
    severity:  15,
    src:       '10.10.0.22',
    dst:       '91.108.4.200',
    user:      'jdoe',
    host:      'win-workstation-07',
    agent:     'win-workstation-07',
    log:       'Apr 24 08:15:00 win-workstation-07 Sysmon[12]: NETWORK_CONNECT pid=4521 image=C:\\Users\\jdoe\\AppData\\Local\\Temp\\svchost32.exe dst=91.108.4.200:443 interval=60s',
  },
  {
    id:        'ind-03',
    ts:        mins(240),
    rule_id:   '510',
    desc:      'Malware Detected: Trojan.AgentTesla keylogger identified — endpoint quarantine required',
    severity:  14,
    src:       '10.10.0.55',
    dst:       null,
    user:      'msmith',
    host:      'win-laptop-03',
    agent:     'win-laptop-03',
    log:       'Apr 24 06:45:00 win-laptop-03 WinDefend: DETECTION Trojan:Win32/AgentTesla.A file=C:\\Users\\msmith\\Downloads\\invoice_04.exe SHA256=a3f2b1c4d5e6f789...',
  },
  {
    id:        'ind-04',
    ts:        mins(310),
    rule_id:   '40302',
    desc:      'Policy Violation: Sensitive file /etc/passwd accessed by non-root web process (www-data)',
    severity:  11,
    src:       '10.10.0.8',
    dst:       null,
    user:      'www-data',
    host:      'app-server-02',
    agent:     'app-server-02',
    log:       'Apr 24 05:45:00 app-server-02 auditd: SYSCALL arch=c000003e syscall=openat success=yes comm="python3" exe="/usr/bin/python3" name="/etc/passwd" uid=33 (www-data)',
  },
  {
    id:        'ind-05',
    ts:        mins(400),
    rule_id:   '40500',
    desc:      'Data Exfiltration Indicator: Abnormal outbound data transfer (>500 MB) to residential IP',
    severity:  13,
    src:       '10.10.0.30',
    dst:       '77.88.55.250',
    user:      'analytics',
    host:      'db-server-01',
    agent:     'db-server-01',
    log:       'Apr 24 04:15:00 db-server-01 netflow: LARGE_TRANSFER src=10.10.0.30 dst=77.88.55.250:443 bytes=524288000 duration=300s protocol=HTTPS',
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
    console.log(`  ✓ [${a.id}] ${a.desc.slice(0, 60)}`);
  } else {
    skipped++;
    console.log(`  ⟳ [${a.id}] already exists — skipped`);
  }
}

console.log(`\nDone: ${inserted} inserted, ${skipped} skipped`);
console.log('\nAlert breakdown:');
console.log('  Campaign (185.220.101.47): camp-01 → camp-05  (port scan → brute force → success → priv-esc)');
console.log('  False Positives:           fp-01 → fp-04     (healthcheck, logrotate, nmap, svc-monitor)');
console.log('  Independent threats:       ind-01 → ind-05   (SQLi, C2 beacon, malware, policy, exfil)');
console.log('\nAll inserted as status=NEW. Open any alert in the UI and click "Run Agents" to test.\n');

db.close();
