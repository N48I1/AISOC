
const testAlerts = [
  {
    rule: {
      id: '5710',
      description: 'SSH Brute Force: Attempt to login with a non-existent user',
      level: 10
    },
    agent: { name: 'db-server-prod' },
    data: { srcip: '193.201.224.12', dstuser: 'admin' },
    full_log: 'Apr 17 02:15:10 db-server-prod sshd[4521]: Invalid user admin from 193.201.224.12 port 38291 ssh2'
  },
  {
    rule: {
      id: '100201',
      description: 'Malware detected: EICAR Test File identified by ClamAV',
      level: 14
    },
    agent: { name: 'laptop-jdoe-03' },
    data: { srcip: '10.0.5.112', file: '/downloads/eicar.com.txt' },
    full_log: 'Apr 17 03:44:22 laptop-jdoe-03 clamav[991]: Found virus: Eicar-Test-Signature in /downloads/eicar.com.txt'
  },
  {
    rule: {
      id: '31101',
      description: 'Web Application Attack: SQL Injection attempt detected in GET parameter',
      level: 12
    },
    agent: { name: 'web-gateway-lb' },
    data: { srcip: '45.132.88.2', url_param: "' OR 1=1 --" },
    full_log: 'Apr 17 05:12:01 web-gateway-lb nginx: 45.132.88.2 - "GET /login?user=\' OR 1=1 -- HTTP/1.1" 403 152'
  },
  {
    rule: {
      id: '550',
      description: 'Policy Violation: Access to unauthorized sensitive directory /etc/shadow',
      level: 13
    },
    agent: { name: 'app-server-blue' },
    data: { srcip: '127.0.0.1', user: 'www-data', file: '/etc/shadow' },
    full_log: 'Apr 17 06:33:45 app-server-blue auditd: type=SYSCALL msg=audit(1681720425.123:55): arch=c000003e syscall=2 success=no exit=-13 items=1 ppid=123 pid=456 auid=4294967295 uid=33 gid=33 euid=33 suid=33 fsuid=33 egid=33 sgid=33 fsgid=33 tty=(none) ses=4294967295 comm="cat" exe="/usr/bin/cat" key="shadow_access"'
  },
  {
    rule: {
      id: '92651',
      description: 'Anomalous Network Traffic: Multiple failed connection attempts from internal host to known C2 IP',
      level: 11
    },
    agent: { name: 'internal-workstation-09' },
    data: { srcip: '10.0.1.55', dstip: '185.112.55.22' },
    full_log: 'Apr 17 07:11:09 firewall-01: [REJECT] src=10.0.1.55 dst=185.112.55.22 proto=TCP sport=55212 dport=4444'
  }
];

async function sendAlerts() {
  console.log('--- Aegis SOC Platform: Test Alert Generator ---');
  for (const alert of testAlerts) {
    try {
      const res = await fetch('http://localhost:3000/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert)
      });
      const data = await res.json();
      console.log(`[INGEST] Ingested: ${alert.rule.description} -> ID: ${data.id}`);
      
      // Wait a bit between ingestions to simulate real-ish flow
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      console.error(`[ERROR] Failed to send alert "${alert.rule.description}":`, err);
    }
  }
  console.log('--- Generation Complete ---');
}

sendAlerts();
