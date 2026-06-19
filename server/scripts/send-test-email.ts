import 'dotenv/config';
import fs from 'fs';

const port = process.env.PORT || '3001';
const protocol = fs.existsSync('certs/cert.pem') ? 'https' : 'http';
const baseUrl = process.env.AISOC_BASE_URL || `${protocol}://localhost:${port}`;
const username = process.env.AISOC_TEST_USERNAME || 'admin';
const password = process.env.AISOC_TEST_PASSWORD || process.env.ADMIN_SEED_PASSWORD;

if (!password) {
  console.error('Missing password. Set ADMIN_SEED_PASSWORD or AISOC_TEST_PASSWORD.');
  process.exit(1);
}

if (baseUrl.startsWith('https://localhost') || baseUrl.startsWith('https://127.0.0.1')) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

async function request(path: string, init: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${path} failed (${res.status}): ${body.error || text}`);
  }
  return body;
}

const login = await request('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});

const token = login.token;
if (!token) throw new Error('Login succeeded but no token was returned.');

console.log(`Logged in as ${login.user?.username || username} (${login.user?.role || 'unknown role'})`);
console.log(`Sending email integration test via ${baseUrl}`);

const result = await request('/api/integrations/email/test', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
});

if (!result.ok) {
  throw new Error(`Email test failed: ${result.error || 'unknown error'}`);
}

console.log('Email test sent successfully. Check the configured recipient inbox for the branded footer and BBS logo.');
