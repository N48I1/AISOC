export type UserRole = 'ADMIN' | 'TIER1' | 'TIER2' | 'INCIDENT_LEAD' | 'ANALYST';

export type IncidentPhase = 'detection' | 'analysis' | 'containment' | 'eradication' | 'recovery' | 'post_incident';
export type IncidentStatus = 'OPEN' | 'IN_PROGRESS' | 'CONTAINED' | 'RESOLVED' | 'CLOSED' | 'RECLASSIFIED_FP';

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  OPEN:            'Open',
  IN_PROGRESS:     'Investigating',
  CONTAINED:       'Contained',
  RESOLVED:        'Resolved',
  CLOSED:          'Closed',
  RECLASSIFIED_FP: 'Reclassified FP',
};

export type IncidentActionStatus = 'pending' | 'approved' | 'executed' | 'failed' | 'skipped';
export type IncidentActionSource = 'ai' | 'analyst' | 'playbook';

export interface IncidentAction {
  id:                     number;
  incident_id:            string;
  action_type:            string;
  target:                 string | null;
  priority:               string;
  status:                 IncidentActionStatus;
  source:                 IncidentActionSource;
  description:            string;
  notes:                  string | null;
  order_index:            number;
  created_by:             number | null;
  created_by_username?:   string;
  created_at:             string;
  executed_at:            string | null;
  executed_by:            number | null;
  executed_by_username?:  string;
}

export const INCIDENT_PHASES: IncidentPhase[] = ['detection', 'analysis', 'containment', 'eradication', 'recovery', 'post_incident'];
export const PHASE_LABELS: Record<IncidentPhase, string> = {
  detection:     'Detection',
  analysis:      'Analysis',
  containment:   'Containment',
  eradication:   'Eradication',
  recovery:      'Recovery',
  post_incident: 'Post-Incident',
};

export interface Incident {
  id:                     number;
  title:                  string;
  severity:               string;
  status:                 IncidentStatus;
  phase:                  IncidentPhase;
  assigned_to:            number | null;
  assigned_to_username?:  string;
  escalated_by:           number | null;
  escalated_by_username?: string;
  escalated_at:           string;
  closed_at:              string | null;
  glpi_ticket_id:         string | null;
  analysis:               string | null;
  action_plan:            string | null;
  reason:                 string | null;
  report_body?:           string | null;
  alert_count?:           number;
  action_count?:          number;
  pending_actions?:       number;
  executed_actions?:      number;
  last_event_type?:       string | null;
  last_event_note?:       string | null;
  last_event_at?:         string | null;
  alerts?:                Alert[];
  timeline?:              IncidentTimelineEntry[];
  actions?:               IncidentAction[];
}

export interface IncidentTimelineEntry {
  id:          number;
  event_type:  string;
  phase_from?: string;
  phase_to?:   string;
  status_from?:string;
  status_to?:  string;
  user_id:     number | null;
  username?:   string;
  note?:       string;
  created_at:  string;
}

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
  status: 'NEW' | 'ANALYZING' | 'TRIAGED' | 'FALSE_POSITIVE' | 'ESCALATED' | 'CLOSED' | 'INCIDENT' | 'FAILED' | 'FP_CONFIRMED' | 'FILTERED';
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
  auto_send_threshold: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NEVER';
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
