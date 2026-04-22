
const testAlerts = [
  // --- WEB ATTACKS ---
  {
    rule: { id: '31101', description: 'Web Application Attack: SQL Injection attempt detected in GET parameter', level: 12 },
    agent: { name: 'web-gateway-lb' },
    data: { srcip: '45.132.88.2', dstip: '10.0.0.5', url: '/login', url_param: "' OR 1=1 --" },
    full_log: 'Apr 17 05:12:01 web-gateway-lb nginx: 45.132.88.2 - - [17/Apr/2026:05:12:01 +0000] "GET /login?user=\' OR 1=1 -- &pass=x HTTP/1.1" 403 152 "-" "sqlmap/1.7.8#stable (https://sqlmap.org)"'
  },
  {
    rule: { id: '31103', description: 'Web Application Attack: XSS (Cross-Site Scripting) payload detected in POST body', level: 11 },
    agent: { name: 'web-gateway-lb' },
    data: { srcip: '91.108.56.33', dstip: '10.0.0.5', url: '/api/profile/update' },
    full_log: 'Apr 17 05:45:22 web-gateway-lb modsec: [id "941100"] [msg "XSS Attack Detected via libinjection"] [data "Matched Data: <script>alert(1)</script>"] [uri "/api/profile/update"] [unique_id "ZCEaRoCoAAABBCDE"] client: 91.108.56.33, server: web-gateway-lb'
  },
  {
    rule: { id: '31150', description: 'Web Application Attack: Path Traversal attempt ../../etc/passwd detected', level: 12 },
    agent: { name: 'web-gateway-lb' },
    data: { srcip: '185.220.101.44', dstip: '10.0.0.5', url: '/api/download' },
    full_log: 'Apr 17 06:01:55 web-gateway-lb nginx: 185.220.101.44 - - [17/Apr/2026:06:01:55 +0000] "GET /api/download?file=../../../../../../etc/passwd HTTP/1.1" 400 162 "-" "Mozilla/5.0 (compatible; custom-scanner/1.0)"'
  },

  // --- BRUTE FORCE / AUTH ---
  {
    rule: { id: '5710', description: 'SSH Brute Force: Multiple failed login attempts from single IP (>10 in 60s)', level: 10 },
    agent: { name: 'db-server-prod' },
    data: { srcip: '193.201.224.12', dstuser: 'admin' },
    full_log: 'Apr 17 02:15:10 db-server-prod sshd[4521]: pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=193.201.224.12 user=admin\nApr 17 02:15:11 db-server-prod sshd[4522]: Invalid user admin from 193.201.224.12 port 38291\nApr 17 02:15:12 db-server-prod sshd[4523]: Invalid user root from 193.201.224.12 port 38295\nApr 17 02:15:13 db-server-prod sshd[4524]: Invalid user ubuntu from 193.201.224.12 port 38299'
  },
  {
    rule: { id: '5760', description: 'Authentication Failure: Admin account locked after 5 consecutive failed logins', level: 9 },
    agent: { name: 'active-directory-dc01' },
    data: { srcip: '10.0.3.88', dstuser: 'j.martin', dstip: '10.0.0.10' },
    full_log: 'Apr 17 09:22:40 active-directory-dc01 Microsoft-Windows-Security-Auditing[4740]: A user account was locked out. Subject: Security ID: SYSTEM Account Name: DC01$ Logon ID: 0x3E7 Account That Was Locked Out: Security ID: S-1-5-21-XXXXX Account Name: j.martin Additional Information: Caller Computer Name: WORKSTATION-03'
  },

  // --- MALWARE / ENDPOINT ---
  {
    rule: { id: '100201', description: 'Malware Detected: Trojan.GenericKD dropper identified on endpoint — quarantine failed', level: 14 },
    agent: { name: 'laptop-jdoe-03' },
    data: { srcip: '10.0.5.112', file: 'C:\\Users\\jdoe\\Downloads\\invoice_april.exe' },
    full_log: 'Apr 17 03:44:22 laptop-jdoe-03 WinDefend[1116]: MALWAREPROTECTION_MALWARE_ACTION_FAILED Threat Name: Trojan:Win32/GenericKD.65891234 Category: Trojan Severity: Severe Path: C:\\Users\\jdoe\\Downloads\\invoice_april.exe Action: Quarantine Status: Failed (Access Denied) Process: C:\\Windows\\explorer.exe'
  },
  {
    rule: { id: '100155', description: 'Suspicious Process: cmd.exe spawned by IIS worker process w3wp.exe — possible webshell execution', level: 13 },
    agent: { name: 'web-server-02' },
    data: { srcip: '10.0.0.6', user: 'IIS APPPOOL\\DefaultAppPool' },
    full_log: 'Apr 17 04:07:58 web-server-02 Microsoft-Windows-Sysmon[1]: Process Create: RuleName: technique_id=T1059.003 UtcTime: 2026-04-17 04:07:58.312 ProcessGuid: {aaa-bbb} ProcessId: 7812 Image: C:\\Windows\\System32\\cmd.exe CommandLine: cmd.exe /c whoami && net user ParentImage: C:\\Windows\\System32\\inetsrv\\w3wp.exe ParentCommandLine: "c:\\windows\\system32\\inetsrv\\w3wp.exe" -ap "DefaultAppPool" User: IIS APPPOOL\\DefaultAppPool'
  },

  // --- PRIVILEGE ESCALATION / FILE ACCESS ---
  {
    rule: { id: '550', description: 'Policy Violation: Unauthorized read access to /etc/shadow by non-root process', level: 13 },
    agent: { name: 'app-server-blue' },
    data: { srcip: '127.0.0.1', user: 'www-data', file: '/etc/shadow' },
    full_log: 'Apr 17 06:33:45 app-server-blue auditd[1]: type=SYSCALL msg=audit(1776438000.123:55): arch=c000003e syscall=openat success=no exit=-13 a0=ffffff9c a1=7f3a1c002b40 a2=0 a3=0 items=1 ppid=7123 pid=7456 auid=4294967295 uid=33 gid=33 euid=33 comm="python3" exe="/usr/bin/python3" key="shadow_access" type=PATH msg=audit: name="/etc/shadow" nametype=NORMAL'
  },
  {
    rule: { id: '5902', description: 'Privilege Escalation: Unexpected sudo usage — user www-data executed /bin/bash as root', level: 13 },
    agent: { name: 'app-server-blue' },
    data: { srcip: '10.0.0.6', user: 'www-data' },
    full_log: 'Apr 17 06:41:20 app-server-blue sudo: www-data : TTY=pts/1 ; PWD=/var/www/html ; USER=root ; COMMAND=/bin/bash\nApr 17 06:41:20 app-server-blue sudo: pam_unix(sudo:session): session opened for user root by www-data(uid=33)'
  },

  // --- C2 / LATERAL MOVEMENT ---
  {
    rule: { id: '92651', description: 'C2 Beacon Detected: Repeated outbound connections to known Cobalt Strike C2 server 185.112.55.22:4444', level: 15 },
    agent: { name: 'internal-workstation-09' },
    data: { srcip: '10.0.1.55', dstip: '185.112.55.22' },
    full_log: 'Apr 17 07:11:09 firewall-01 kernel: [REJECT] IN=eth0 OUT=eth1 SRC=10.0.1.55 DST=185.112.55.22 LEN=60 TOS=0x00 PREC=0x00 TTL=64 ID=54321 DF PROTO=TCP SPT=55212 DPT=4444 WINDOW=29200 RES=0x00 SYN URGP=0\nApr 17 07:11:19 firewall-01 kernel: [REJECT] SRC=10.0.1.55 DST=185.112.55.22 PROTO=TCP SPT=55213 DPT=4444\nApr 17 07:11:29 firewall-01 kernel: [REJECT] SRC=10.0.1.55 DST=185.112.55.22 PROTO=TCP SPT=55214 DPT=4444'
  },
  {
    rule: { id: '18152', description: 'Lateral Movement: SMB Pass-the-Hash attack detected — NTLM auth from unusual source host', level: 14 },
    agent: { name: 'active-directory-dc01' },
    data: { srcip: '10.0.1.55', dstip: '10.0.0.10', dstuser: 'Administrator' },
    full_log: 'Apr 17 07:55:33 active-directory-dc01 Microsoft-Windows-Security-Auditing[4624]: An account was successfully logged on. Logon Type: 3 (Network) Account Name: Administrator Workstation Name: WORKSTATION-09 Source Network Address: 10.0.1.55 Source Port: 49812 Logon Process: NtLmSsp Authentication Package: NTLM Key Length: 0 — SUSPICIOUS: NTLMv1 used with no prior interactive session on source host'
  },

  // --- DATA EXFILTRATION ---
  {
    rule: { id: '88001', description: 'Data Exfiltration: Abnormal outbound DNS volume — possible DNS tunneling to ext-c2.attacker.cc', level: 12 },
    agent: { name: 'internal-workstation-09' },
    data: { srcip: '10.0.1.55', dstip: '8.8.8.8' },
    full_log: 'Apr 17 08:03:14 dns-server-01 named[2345]: queries: client @0x7f3a1c002b40 10.0.1.55#52301 (a7f3e291d4bc1a0e9f2b.ext-c2.attacker.cc): query: a7f3e291d4bc1a0e9f2b.ext-c2.attacker.cc IN TXT +E(0)D (10.0.0.1)\n[ANOMALY] 847 DNS queries to *.ext-c2.attacker.cc in last 60 seconds from 10.0.1.55. Avg query size: 224 bytes (>3x baseline). Pattern: base64 encoded subdomains detected.'
  }
];

async function sendAlerts() {
  console.log('--- Aegis SOC Platform: Test Alert Generator ---');
  console.log(`Sending ${testAlerts.length} realistic Wazuh-style alerts...\n`);

  for (const alert of testAlerts) {
    try {
      const res = await fetch('http://localhost:3001/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert)
      });
      const data = await res.json();
      const sev = alert.rule.level >= 13 ? '🔴 CRITICAL' : alert.rule.level >= 10 ? '🟠 HIGH' : '🟡 MED';
      console.log(`[${sev}] ${alert.rule.description.substring(0, 60)}...`);
      console.log(`         ID: ${data.id} | Agent: ${alert.agent.name} | SRC: ${alert.data.srcip}`);
      await new Promise(resolve => setTimeout(resolve, 600));
    } catch (err) {
      console.error(`[ERROR] Failed: "${alert.rule.description}":`, err);
    }
  }
  console.log('\n--- Generation Complete: 12 alerts sent ---');
}

sendAlerts();
