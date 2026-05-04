/**
 * seed-known-assets.ts
 *
 * Seeds the asset_context table with known infrastructure entries so the
 * Analysis agent can auto-flag false positives from scanners, monitoring,
 * and backup systems.
 */

import Database from 'better-sqlite3';

const db = new Database('soc.db');
db.pragma('journal_mode = WAL');

const upsert = db.prepare(`
  INSERT INTO asset_context (value, type, role, description, fp_default, source, updated_at)
  VALUES (?, ?, ?, ?, ?, 'seed', CURRENT_TIMESTAMP)
  ON CONFLICT(value) DO UPDATE SET
    type        = excluded.type,
    role        = excluded.role,
    description = excluded.description,
    fp_default  = excluded.fp_default,
    source      = excluded.source,
    updated_at  = CURRENT_TIMESTAMP
`);

const knownAssets = [
  // ── Vulnerability Scanners ──
  { value: '172.10.9.10',    type: 'ip',   role: 'scanner',    fp_default: 1, description: 'OpenVAS vulnerability scanner' },
  { value: '172.10.9.11',    type: 'ip',   role: 'scanner',    fp_default: 1, description: 'Nessus vulnerability scanner' },
  { value: '172.10.9.12',    type: 'ip',   role: 'scanner',    fp_default: 1, description: 'Qualys PCI compliance scanner' },
  { value: '192.168.1.100',  type: 'ip',   role: 'scanner',    fp_default: 1, description: 'Internal nmap security scanner' },

  // ── Monitoring Infrastructure ──
  { value: '192.168.1.10',   type: 'ip',   role: 'monitoring', fp_default: 1, description: 'Health check monitoring probe' },
  { value: '10.0.0.15',      type: 'ip',   role: 'monitoring', fp_default: 1, description: 'Monitoring platform (Zabbix/Nagios)' },
  { value: 'svc-monitor',    type: 'user', role: 'monitoring', fp_default: 1, description: 'Monitoring service account' },
  { value: 'monitoring-agent-01', type: 'host', role: 'monitoring', fp_default: 1, description: 'Monitoring agent host' },
  { value: 'monitoring-agent-02', type: 'host', role: 'monitoring', fp_default: 1, description: 'Monitoring agent host' },

  // ── Backup Infrastructure ──
  { value: '10.0.0.3',       type: 'ip',   role: 'backup',     fp_default: 1, description: 'Backup server' },
  { value: 'backup',         type: 'user', role: 'backup',     fp_default: 1, description: 'Backup service account' },
  { value: 'backup-agent-01', type: 'host', role: 'backup',    fp_default: 1, description: 'Backup agent host' },

  // ── Security Scanner Hosts ──
  { value: 'security-scanner-01', type: 'host', role: 'scanner', fp_default: 1, description: 'Dedicated security scanning host' },
];

let upserted = 0;

for (const a of knownAssets) {
  upsert.run(a.value, a.type, a.role, a.description, a.fp_default);
  upserted++;
  console.log(`  ✓ [${a.type}] ${a.value} — ${a.description}`);
}

console.log(`\nDone: ${upserted} assets upserted into asset_context (source=seed)`);

// List all entries currently in the table
const rows = db.prepare('SELECT value, type, role, fp_default, description FROM asset_context ORDER BY role, type, value').all() as any[];
console.log(`\nAll asset_context entries (${rows.length} total):`);
for (const r of rows) {
  console.log(`  [${r.role}/${r.type}] ${r.value}  fp=${r.fp_default}  — ${r.description}`);
}

db.close();
