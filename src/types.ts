export type UserRole = 'ADMIN' | 'ANALYST';

export interface User {
  id: number;
  username: string;
  email: string;
  role: UserRole;
}

export interface Alert {
  id: string;
  timestamp: string;
  rule_id: string;
  description: string;
  severity: number;
  source_ip?: string;
  dest_ip?: string;
  user?: string;
  hostname?: string;
  agent_name: string;
  full_log: string;
  status: 'NEW' | 'ANALYZING' | 'TRIAGED' | 'FALSE_POSITIVE' | 'ESCALATED' | 'CLOSED' | 'INCIDENT' | 'FAILED';
  ai_analysis?: string;
  mitre_attack?: string[];
  remediation_steps?: string;
  email_sent?: number;
}

export interface Stats {
  activeIncidents: number;
  mttr: string;
  automationRate: string;
  totalAlerts: number;
  analyzedAlerts: number;
  fpRate: string;
}

export interface AgentRun {
  id: number;
  alert_id: string;
  run_at: string;
  ai_analysis?: string | null;
  mitre_attack?: string | null;
  remediation_steps?: string | null;
  status?: string | null;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  user_id: number;
  action: string;
  details: string;
}

export interface Integration {
  name:                string;
  enabled:             boolean;
  config:              Record<string, string>;
  auto_send_threshold: 'CRITICAL' | 'HIGH' | 'NEVER';
  updated_at:          string;
  stats_24h?:          { total: number; success: number; failed: number };
}

export interface ActionLog {
  id:          number;
  alert_id:    string;
  integration: string;
  action:      string;
  status:      'success' | 'failed' | 'skipped';
  payload:     string;
  error?:      string;
  created_at:  string;
}

export interface ReportRow {
  id:          number;
  alert_id:    string;
  run_at:      string;
  status:      string;
  severity:    number;
  description: string;
  source_ip?:  string;
  email_sent:  number;
  title?:      string;
  priority?:   string;
  confidence?: number;
  report_body?: string;
  actions_dispatched?: string[];
}

export interface ReportSummary {
  total:                number;
  last_7_days:          number;
  avg_confidence:       number | null;
  email_sent_pct:       number;
  priority_distribution:Record<string, number>;
  daily_volume:         Array<{ day: string; count: number }>;
}
