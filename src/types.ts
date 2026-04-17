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
  status: 'NEW' | 'ANALYZING' | 'TRIAGED' | 'FALSE_POSITIVE' | 'ESCALATED' | 'CLOSED' | 'INCIDENT';
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
  assigned_to?: number;
  alerts: string[]; // IDs of alerts
  analysis: string;
  action_plan: string;
  audit_logs: AuditLog[];
}

export interface AuditLog {
  id: string;
  timestamp: string;
  user_id: number;
  action: string;
  details: string;
}
