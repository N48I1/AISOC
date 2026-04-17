import fetch from 'node-fetch';

const sampleAlert = {
  rule: {
    id: '5710',
    description: 'Attempt to login with a non-existent user',
    level: 10
  },
  agent: {
    name: 'web-server-01'
  },
  data: {
    srcip: '192.168.1.45',
    dstuser: 'root'
  },
  full_log: 'Apr 16 04:24:13 web-server-01 sshd[1234]: Invalid user root from 192.168.1.45 port 54321 ssh2'
};

async function sendAlert() {
  try {
    const res = await fetch('http://localhost:3000/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleAlert)
    });
    const data = await res.json();
    console.log('Alert ingested:', data);
  } catch (err) {
    console.error('Failed to send alert:', err);
  }
}

sendAlert();
