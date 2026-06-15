-- =============================================================================
-- AISOC — canonical PostgreSQL schema
-- =============================================================================
-- Ported from the SQLite (better-sqlite3) bootstrap that previously lived inline
-- in server.ts. All ALTER-added columns from the old idempotent migration block
-- are merged directly into the table definitions here, so this file is the single
-- source of truth for a fresh install.
--
-- Conventions (deliberate, to minimise app-code churn during the migration):
--   * JSON payloads stay as TEXT (the app does JSON.stringify/parse itself).
--     Making them jsonb would cause node-postgres to auto-parse on read and
--     break existing JSON.parse(...) call sites.
--   * Booleans stay as INTEGER 0/1 (the app reads `=== 1` and writes `? 1 : 0`).
--   * Temporal columns are real `timestamp`; a node-postgres type-parser override
--     (see db/pool.ts) returns them as strings so existing string handling and
--     JSON responses are unchanged.
--   * AUTOINCREMENT -> GENERATED ALWAYS AS IDENTITY.
--   * The reserved word `user` (alerts.user) is quoted as "user" everywhere.
--   * incident_insights.embedding is a pgvector vector(768) (nomic-embed-text).
-- Applied idempotently at startup (CREATE TABLE IF NOT EXISTS / CREATE INDEX
-- IF NOT EXISTS / CREATE EXTENSION IF NOT EXISTS).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Identity & access ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT UNIQUE,
  password TEXT,
  email TEXT,
  role TEXT DEFAULT 'ANALYST',
  display_name TEXT,
  avatar_color TEXT DEFAULT '#3b82f6',
  timezone TEXT DEFAULT 'UTC',
  notify_email INTEGER DEFAULT 1,
  notify_critical INTEGER DEFAULT 1,
  notify_assignments INTEGER DEFAULT 1,
  bio TEXT DEFAULT '',
  last_login TIMESTAMP,
  password_changed_at TIMESTAMP,
  failed_logins INTEGER DEFAULT 0,
  locked_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  auth_source TEXT DEFAULT 'local',
  must_change_password INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  access_expires_at TIMESTAMP,
  jwt_epoch INTEGER DEFAULT 0,
  temp_role TEXT,
  temp_role_expires_at TIMESTAMP,
  temp_role_granted_by INTEGER
);

CREATE TABLE IF NOT EXISTS password_history (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pwhist_user ON password_history(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS access_reviews (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at TIMESTAMP DEFAULT now(),
  started_by INTEGER,
  due_at TIMESTAMP,
  completed_at TIMESTAMP,
  note TEXT
);

CREATE TABLE IF NOT EXISTS access_review_items (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  review_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username_at_time TEXT,
  role_at_time TEXT,
  decision TEXT DEFAULT 'pending',
  decided_by INTEGER,
  decided_at TIMESTAMP,
  notes TEXT,
  FOREIGN KEY (review_id) REFERENCES access_reviews(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ari_review ON access_review_items(review_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now(),
  last_used_at TIMESTAMP,
  revoked INTEGER DEFAULT 0,
  paused INTEGER DEFAULT 0,
  min_severity_override INTEGER,
  last_heartbeat_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT now(),
  user_id INTEGER,
  action TEXT,
  details TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- ── Alerts & incidents ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT now(),
  rule_id TEXT,
  description TEXT,
  severity INTEGER,
  source_ip TEXT,
  dest_ip TEXT,
  "user" TEXT,
  hostname TEXT,
  agent_name TEXT,
  full_log TEXT,
  status TEXT DEFAULT 'NEW',
  ai_analysis TEXT,
  mitre_attack TEXT,
  remediation_steps TEXT,
  email_sent INTEGER DEFAULT 0,
  fp_method TEXT,
  fp_confidence DOUBLE PRECISION DEFAULT 0,
  fp_reason TEXT,
  fp_details TEXT,
  triage_data TEXT,
  after_hours INTEGER DEFAULT 0,
  filtered_at TIMESTAMP,
  investigated_at TIMESTAMP,
  escalated_at TIMESTAMP,
  closed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp);
CREATE INDEX IF NOT EXISTS idx_alerts_status    ON alerts(status);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  title TEXT,
  severity TEXT,
  status TEXT DEFAULT 'OPEN',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  assigned_to INTEGER,
  analysis TEXT,
  action_plan TEXT,
  phase TEXT DEFAULT 'analysis',
  escalated_by INTEGER,
  escalated_at TIMESTAMP,
  closed_by INTEGER,
  closed_at TIMESTAMP,
  glpi_ticket_id TEXT,
  reason TEXT,
  report_body TEXT,
  FOREIGN KEY(assigned_to) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS incident_alerts (
  incident_id TEXT,
  alert_id TEXT,
  PRIMARY KEY(incident_id, alert_id),
  FOREIGN KEY(incident_id) REFERENCES incidents(id),
  FOREIGN KEY(alert_id) REFERENCES alerts(id)
);

CREATE TABLE IF NOT EXISTS incident_timeline (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  phase_from TEXT,
  phase_to TEXT,
  status_from TEXT,
  status_to TEXT,
  user_id INTEGER,
  note TEXT,
  created_at TIMESTAMP DEFAULT now(),
  FOREIGN KEY(incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_incident_timeline_incident ON incident_timeline(incident_id);

CREATE TABLE IF NOT EXISTS incident_actions (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target TEXT,
  priority TEXT DEFAULT 'MEDIUM',
  status TEXT DEFAULT 'pending',
  source TEXT DEFAULT 'ai',
  description TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT now(),
  executed_at TIMESTAMP,
  executed_by INTEGER,
  order_index INTEGER DEFAULT 0,
  FOREIGN KEY(incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id),
  FOREIGN KEY(executed_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_incident_actions_incident ON incident_actions(incident_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_id TEXT NOT NULL,
  run_at TIMESTAMP DEFAULT now(),
  ai_analysis TEXT,
  mitre_attack TEXT,
  remediation_steps TEXT,
  status TEXT,
  FOREIGN KEY(alert_id) REFERENCES alerts(id)
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_id TEXT,
  phase TEXT,
  user_id INTEGER,
  is_accurate INTEGER,
  comment TEXT,
  timestamp TIMESTAMP DEFAULT now(),
  FOREIGN KEY(alert_id) REFERENCES alerts(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS action_logs (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_id TEXT,
  integration TEXT NOT NULL,
  action TEXT,
  status TEXT,
  payload TEXT,
  error TEXT,
  created_at TIMESTAMP DEFAULT now(),
  FOREIGN KEY(alert_id) REFERENCES alerts(id)
);
CREATE INDEX IF NOT EXISTS idx_action_logs_created     ON action_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_action_logs_integration ON action_logs(integration);

CREATE TABLE IF NOT EXISTS playbooks (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tactic TEXT NOT NULL,
  title TEXT NOT NULL,
  steps TEXT NOT NULL,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT now(),
  FOREIGN KEY(created_by) REFERENCES users(id)
);

-- ── AI / agent memory ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS working_memory (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_id TEXT,
  trace_id TEXT,
  step INTEGER,
  thought TEXT,
  action TEXT,
  result_summary TEXT,
  created_at TIMESTAMP DEFAULT now(),
  FOREIGN KEY(alert_id) REFERENCES alerts(id)
);
CREATE INDEX IF NOT EXISTS idx_working_alert ON working_memory(alert_id);
CREATE INDEX IF NOT EXISTS idx_working_trace ON working_memory(trace_id);

CREATE TABLE IF NOT EXISTS ioc_memory (
  value TEXT PRIMARY KEY,
  type TEXT,
  first_seen TIMESTAMP DEFAULT now(),
  last_seen  TIMESTAMP DEFAULT now(),
  alert_count INTEGER DEFAULT 1,
  threat_level TEXT,
  notes TEXT,
  fp_count INTEGER DEFAULT 0,
  tp_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ioc_last_seen ON ioc_memory(last_seen);
CREATE INDEX IF NOT EXISTS idx_ioc_type      ON ioc_memory(type);

CREATE TABLE IF NOT EXISTS incident_insights (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_id TEXT,
  idempotency_key TEXT UNIQUE,
  summary TEXT,
  attack_pattern TEXT,
  threat_actor TEXT,
  outcome TEXT,
  ttp_tags TEXT,
  embedding vector(768),
  created_at TIMESTAMP DEFAULT now(),
  triggered_by TEXT DEFAULT 'triage',
  FOREIGN KEY(alert_id) REFERENCES alerts(id)
);
CREATE INDEX IF NOT EXISTS idx_insights_created ON incident_insights(created_at);
-- Approximate nearest-neighbour index for cosine distance (pgvector HNSW).
CREATE INDEX IF NOT EXISTS idx_insights_embedding
  ON incident_insights USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS asset_context (
  value         TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  role          TEXT NOT NULL,
  description   TEXT,
  fp_default    INTEGER DEFAULT 0,
  source        TEXT DEFAULT 'manual',
  created_at    TIMESTAMP DEFAULT now(),
  updated_at    TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_value ON asset_context(value);
CREATE INDEX IF NOT EXISTS idx_asset_type  ON asset_context(type);

CREATE TABLE IF NOT EXISTS incident_reasoning (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_id TEXT,
  trace_id TEXT,
  agent TEXT NOT NULL,
  step  INTEGER DEFAULT 0,
  decision TEXT,
  evidence_for TEXT,
  evidence_against TEXT,
  rejected_hypotheses TEXT,
  confidence DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMP DEFAULT now(),
  FOREIGN KEY(alert_id) REFERENCES alerts(id)
);
CREATE INDEX IF NOT EXISTS idx_reasoning_alert ON incident_reasoning(alert_id);
CREATE INDEX IF NOT EXISTS idx_reasoning_trace ON incident_reasoning(trace_id);

CREATE TABLE IF NOT EXISTS suppression_rules (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  source_ip_pattern TEXT,
  agent_name_pattern TEXT,
  rule_id_pattern TEXT,
  description_pattern TEXT,
  min_severity INTEGER DEFAULT 0,
  max_severity INTEGER DEFAULT 15,
  reason TEXT NOT NULL,
  hit_count INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT now(),
  created_by TEXT DEFAULT 'system'
);

-- ── Integrations & config ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_settings (
  phase TEXT PRIMARY KEY,
  model TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integrations (
  name TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 0,
  config TEXT DEFAULT '{}',
  auto_send_threshold TEXT DEFAULT 'NEVER',
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS local_llm_config (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS llm_providers (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 100,
  headers_json TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  last_test_at TIMESTAMP,
  last_test_ok INTEGER,
  last_test_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_llm_providers_enabled ON llm_providers(enabled, priority);
