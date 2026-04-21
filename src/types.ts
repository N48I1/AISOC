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

export interface Incident {
  id: string;
  title: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  created_at: string;
  updated_at: string;
  assigned_to?: number | null;
  alerts: string[];
  analysis?: string | null;
  action_plan?: string | null;
}

export interface Stats {
  activeIncidents: number;
  mttr: string;
  automationRate: string;
  totalAlerts: number;
  analyzedAlerts: number;
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
