import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Shield, AlertTriangle, Activity, FileText, Settings, LogOut, Search, Bell, User, CheckCircle, XCircle, Clock, ChevronRight, BarChart3, Terminal, Filter, Plus, X, UserPlus, Eye, ThumbsUp, ThumbsDown, ChevronDown, BookOpen, Trash2, Send, Zap, Mail, ExternalLink, ToggleLeft, ToggleRight, RefreshCw, PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { getAgentModelConfig, orchestrateAnalysis, runAgentPhase, updateAgentModel, getAlertRuns, saveAlertRun, getIntegrations, updateIntegration, testIntegration, getActionLogs, getReports, getReportSummary, getLocalLLMConfig, updateLocalLLMConfig, testLocalLLM, getLocalLLMModels, getAgentStats, type AgentModelConfig, type AgentPhase, type AgentStat, type LocalModel } from './services/aiService';
import { User as UserType, Alert, AgentRun, Stats, UserRole, Integration, ActionLog, ReportRow, ReportSummary } from './types';

// --- Dark Mode ---
const DarkModeContext = createContext<{ dark: boolean; toggle: () => void }>({ dark: false, toggle: () => {} });
const useDarkMode = () => useContext(DarkModeContext);

const DarkModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dark, setDark] = useState<boolean>(() => {
    const stored = localStorage.getItem('soc_dark_mode');
    return stored ? stored === 'true' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('soc_dark_mode', String(dark));
  }, [dark]);

  const toggle = () => setDark(d => !d);
  return <DarkModeContext.Provider value={{ dark, toggle }}>{children}</DarkModeContext.Provider>;
};

// --- Toast System ---
interface ToastItem { id: string; message: string; type: 'success' | 'error' | 'info'; }
const ToastContext = createContext<(msg: string, type?: ToastItem['type']) => void>(() => {});
const useToast = () => useContext(ToastContext);

const ToastContainer = ({ toasts }: { toasts: ToastItem[] }) => (
  <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
    <AnimatePresence>
      {toasts.map(t => (
        <motion.div
          key={t.id}
          initial={{ opacity: 0, x: 60, scale: 0.9 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 60, scale: 0.9 }}
          transition={{ duration: 0.2 }}
          className={`px-4 py-3 rounded-lg shadow-lg text-[0.82rem] font-semibold text-white max-w-[320px] pointer-events-auto ${
            t.type === 'success' ? 'bg-[#1e8e3e]' :
            t.type === 'error'   ? 'bg-[#d93025]' :
            'bg-[#004a99]'
          }`}
        >
          {t.type === 'success' ? '✓ ' : t.type === 'error' ? '✕ ' : 'ℹ '}{t.message}
        </motion.div>
      ))}
    </AnimatePresence>
  </div>
);

// --- Confirm Modal ---
interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmClass?: string;
  onConfirm: () => void;
  onCancel: () => void;
}
const ConfirmModal = ({ title, message, confirmLabel = 'Confirm', confirmClass = 'bg-[#d93025] hover:bg-red-700', onConfirm, onCancel }: ConfirmModalProps) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm">
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-[var(--s0)] rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4"
    >
      <h3 className="text-[1rem] font-black text-[var(--t7)]">{title}</h3>
      <p className="text-[0.85rem] text-[var(--t5)] leading-relaxed">{message}</p>
      <div className="flex gap-3 pt-2 justify-end">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-[var(--b2)] text-[var(--t5)] font-semibold text-[0.82rem] hover:bg-[var(--s1)] transition-colors">Cancel</button>
        <button onClick={onConfirm} className={`px-4 py-2 rounded-lg text-white font-bold text-[0.82rem] transition-colors ${confirmClass}`}>{confirmLabel}</button>
      </div>
    </motion.div>
  </div>
);

// --- Auth Context ---
interface AuthContextType {
  user: UserType | null;
  token: string | null;
  login: (token: string, user: UserType) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserType | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('soc_token'));

  useEffect(() => {
    if (token) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      }).then(res => res.json())
        .then(data => {
          if (data.error) logout();
          else setUser(data);
        })
        .catch(() => logout());
    }
  }, [token]);

  const login = (newToken: string, newUser: UserType) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('soc_token', newToken);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('soc_token');
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

// --- Components ---

const Sidebar = ({ activeTab, setActiveTab }: { activeTab: string, setActiveTab: (t: string) => void }) => {
  const { logout, user } = useAuth();
  const [expanded, setExpanded] = useState(false);

  const menuItems = [
    { id: 'research',       icon: BarChart3,     label: 'Research Overview' },
    { id: 'alerts',         icon: AlertTriangle, label: 'Alert Investigation' },
    { id: 'agents',         icon: Activity,      label: 'Agent Evaluation' },
    { id: 'intelligence',   icon: BookOpen,      label: 'MITRE & Intel' },
    { id: 'reports',        icon: FileText,      label: 'Evidence Reports' },
    { id: 'notifications',  icon: Send,          label: 'Notifications' },
    { id: 'response',       icon: Shield,        label: 'Response Controls' },
    { id: 'settings',       icon: Settings,      label: 'System Admin' },
  ];

  return (
    <aside className={`bg-[var(--s0)] border-r border-[var(--b1)] h-full flex flex-col transition-[width] duration-250 ease-in-out overflow-hidden shrink-0 ${expanded ? 'w-[200px]' : 'w-14'}`}>
      {/* Toggle — always pinned to the top-right of the sidebar */}
      <div className="flex items-center justify-end px-2 py-2 shrink-0">
        <button
          onClick={() => setExpanded(e => !e)}
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--t2)] hover:text-[var(--p1)] hover:bg-[var(--sa)] transition-colors"
        >
          {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      </div>

      <nav className="flex-1 flex flex-col gap-1">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            title={!expanded ? item.label : undefined}
            className={`flex items-center gap-3 py-3 transition-[padding] duration-250 ${expanded ? 'px-5' : 'px-[13px]'} ${
              activeTab === item.id
                ? 'text-[var(--p1)] bg-[var(--sa)] border-r-2 border-[var(--p1)] font-semibold'
                : 'text-[var(--t2)] hover:bg-[var(--sa)] hover:text-[var(--p1)]'
            }`}
          >
            <item.icon className="w-[18px] h-[18px] shrink-0" />
            <span className={`whitespace-nowrap text-[0.85rem] transition-opacity duration-200 ${expanded ? 'opacity-100' : 'opacity-0'}`}>
              {item.label}
            </span>
          </button>
        ))}
      </nav>

      <div className={`pt-4 border-t border-[var(--b1)] space-y-1 transition-[padding] duration-250 ${expanded ? 'px-4' : 'px-[9px]'}`}>
        <button
          onClick={() => setActiveTab('settings')}
          title={!expanded ? user?.username : undefined}
          className="w-full flex items-center gap-3 p-1.5 rounded-lg hover:bg-[var(--sa)] transition-colors text-left"
        >
          <div className="w-8 h-8 rounded-full bg-[var(--pd)] flex items-center justify-center text-white text-xs font-bold border border-white/30 shrink-0">
            {user?.username?.substring(0, 2).toUpperCase()}
          </div>
          <div className={`overflow-hidden transition-opacity duration-200 ${expanded ? 'opacity-100' : 'opacity-0'}`}>
            <p className="text-xs font-semibold text-[var(--t1)] truncate">{user?.username}</p>
            <p className="text-[10px] text-[var(--t2)] uppercase">{user?.role}</p>
          </div>
        </button>
        <button
          onClick={logout}
          title={!expanded ? 'Sign Out' : undefined}
          className="w-full flex items-center gap-3 px-1.5 py-1.5 text-[0.8rem] font-semibold text-[var(--t2)] hover:text-[#d93025] transition-colors"
        >
          <LogOut className="w-[18px] h-[18px] shrink-0" />
          <span className={`whitespace-nowrap transition-opacity duration-200 ${expanded ? 'opacity-100' : 'opacity-0'}`}>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};

const Header = () => {
  const { user, logout } = useAuth();
  const { dark, toggle } = useDarkMode();
  return (
    <header className="h-[48px] bg-[#004a99] text-white flex items-center justify-between px-5 shadow-md z-[100]">
      <div className="flex items-center gap-2.5 font-bold text-[1.05rem] tracking-tight">
        <div className="w-7 h-7 rounded-full bg-[var(--s0)] flex items-center justify-center overflow-hidden shadow-sm shrink-0">
          <img src="/logo-BBS.png" className="h-5 w-5 object-contain" alt="BBS Logo" />
        </div>
        BBS AISOC
      </div>

      <div className="flex items-center gap-4 text-[0.8rem] opacity-90">
        <span className="flex items-center gap-2">
          <div className="w-2 h-2 bg-[#1e8e3e] rounded-full" />
          Wazuh Cluster: Healthy
        </span>
        <span className="opacity-40">|</span>
        <button
          onClick={toggle}
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--s0)]/15 transition-colors text-white"
        >
          {dark ? '☀' : '🌙'}
        </button>
        <span className="opacity-40">|</span>
        <span className="opacity-80">{user?.username} <span className="opacity-60">({user?.role})</span></span>
        <button
          onClick={logout}
          title="Sign out"
          className="flex items-center gap-1.5 ml-1 px-2.5 py-1 rounded hover:bg-[var(--s0)]/15 hover:text-red-300 transition-colors text-[0.78rem] font-semibold"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>
      </div>
    </header>
  );
};

const StatCard = ({ label, value, icon: Icon, trend, color }: any) => (
  <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-5 flex flex-col gap-2 shadow-sm">
    <div className="flex justify-between items-start">
      <div className="text-[0.75rem] font-bold text-[var(--t2)] uppercase tracking-wider">{label}</div>
      <Icon className="w-5 h-5 opacity-20" style={{ color }} />
    </div>
    <div className="text-[1.8rem] font-bold text-[var(--t1)] leading-none">{value}</div>
    {trend && (
      <div className={`text-[0.7rem] font-bold flex items-center gap-1 ${trend > 0 ? 'text-[#d93025]' : 'text-[#1e8e3e]'}`}>
        {trend > 0 ? '+' : ''}{trend}% from last 24h
      </div>
    )}
  </div>
);

const AGENT_PHASES_UI: Array<{ phase: AgentPhase; label: string; short: string }> = [
  { phase: 'analysis',    label: 'Alert Triage',     short: 'Triage' },
  { phase: 'intel',       label: 'Threat Intel',     short: 'Intel' },
  { phase: 'knowledge',   label: 'RAG Knowledge',    short: 'RAG' },
  { phase: 'correlation', label: 'Correlation',      short: 'Correlate' },
  { phase: 'ticketing',   label: 'Ticketing',        short: 'Ticket' },
  { phase: 'response',    label: 'Response',         short: 'Respond' },
  { phase: 'validation',  label: 'SLA Validation',   short: 'Validate' },
];

const parseAlertAi = (alert?: Alert | null): any | null => {
  if (!alert?.ai_analysis) return null;
  try { return JSON.parse(alert.ai_analysis); } catch { return null; }
};

const parseMitreTags = (alert?: Alert | null): string[] => {
  if (!alert?.mitre_attack) return [];
  try {
    const parsed = Array.isArray(alert.mitre_attack) ? alert.mitre_attack : JSON.parse(alert.mitre_attack as any);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
};

const getPhaseData = (aiData: any, phase: AgentPhase) => {
  if (!aiData?.phaseData) return null;
  return phase === 'ticketing' ? (aiData.phaseData.ticketing || aiData.phaseData.ticket) : aiData.phaseData[phase];
};

const getAlertRiskScore = (alert: Alert): number | null => {
  const aiData = parseAlertAi(alert);
  const analysisRisk = aiData?.phaseData?.analysis?.risk_score;
  if (typeof analysisRisk === 'number') return analysisRisk;
  const intelRisk = aiData?.phaseData?.intel?.risk_score;
  if (typeof intelRisk === 'number') return intelRisk <= 10 ? intelRisk * 10 : intelRisk;
  return null;
};

const getConfidenceValues = (aiData: any): number[] =>
  AGENT_PHASES_UI
    .map(a => getPhaseData(aiData, a.phase)?.confidence)
    .filter((v): v is number => typeof v === 'number')
    .map(v => v <= 1 ? Math.round(v * 100) : Math.round(v));

const percent = (value: number, total: number) => total > 0 ? Math.round((value / total) * 100) : 0;

const AlertRow = ({ alert, onClick, isSelected }: { alert: Alert, onClick: () => void, isSelected?: boolean, key?: any }) => {
  let aiData: any = null;
  try { aiData = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch (e) {}

  const riskScore = aiData?.phaseData?.analysis?.risk_score;
  const isFP = aiData?.phaseData?.analysis?.is_false_positive;
  const summary = aiData?.summary || alert.description;
  const pd = aiData?.phaseData || {};
  const agents = ['analysis', 'intel', 'knowledge', 'correlation', 'ticketing', 'response', 'validation'];

  const getSeverityColor = (level: number) => {
    if (level >= 12) return '#d93025';
    if (level >= 7) return '#f29900';
    return '#1a73e8';
  };

  const riskColor = riskScore == null ? '#cbd5e1' : riskScore >= 80 ? '#ef4444' : riskScore >= 60 ? '#f97316' : riskScore >= 40 ? '#f59e0b' : '#10b981';

  return (
    <motion.div 
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClick}
      className={`alert-item p-[12px_15px] border-b border-[#f0f0f0] cursor-pointer transition-colors ${isSelected ? 'bg-[var(--sa)]' : 'hover:bg-[var(--s1)]'}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1 mt-0.5 shrink-0">
          <div className="w-7 h-7 rounded-full flex items-center justify-center border-2" style={{ borderColor: riskColor, backgroundColor: `${riskColor}15` }}>
            <span className="text-[0.6rem] font-black" style={{ color: riskColor }}>
              {riskScore != null ? riskScore : alert.severity}
            </span>
          </div>
          <span className="text-[0.5rem] font-bold text-[var(--t3)] uppercase tracking-wider">{riskScore != null ? 'Risk' : 'Lvl'}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            {isFP && <span className="px-1.5 py-0.5 rounded bg-[var(--s1)] text-[var(--t4)] border border-[var(--b2)] text-[0.55rem] font-black uppercase tracking-wider shrink-0">FP</span>}
            <h4 className="text-[0.78rem] font-bold text-[var(--t1)] truncate" title={summary}>{summary}</h4>
          </div>
          
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="font-mono text-[0.6rem] text-[var(--t3)] bg-[var(--s1)] rounded px-1 py-0.5 shrink-0 select-all">#{alert.id.toUpperCase()}</span>
          </div>

          <div className="flex justify-between items-center text-[0.7rem] text-[var(--t2)] mt-0.5">
            <span className="truncate">{alert.source_ip || alert.agent_name}</span>
            <span className="shrink-0">{new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          <div className="flex items-center gap-1 mt-2">
            {agents.map(a => {
              const isDone = !!pd[a];
              const isRunning = alert.status === 'ANALYZING' && !isDone && (a === 'analysis' || pd[agents[agents.indexOf(a)-1]]);
              return (
                <div key={a} title={a} className={`w-1.5 h-1.5 rounded-full ${isDone ? 'bg-[#004a99]' : isRunning ? 'bg-blue-400 animate-pulse' : 'bg-[var(--s2)]'}`} />
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const DetailedReport = ({ alert, aiData, mitreTags, onClose }: { alert: Alert, aiData: any, mitreTags: string[], onClose: () => void }) => {
  const [exportFormat, setExportFormat] = useState<'txt' | 'xml' | 'pdf' | 'md'>('pdf');
  const severity = alert.severity >= 13 ? 'CRITICAL' : alert.severity >= 10 ? 'HIGH' : alert.severity >= 7 ? 'MEDIUM' : 'LOW';
  const sevColor: Record<string, string> = { CRITICAL: '#d93025', HIGH: '#f29900', MEDIUM: '#1a73e8', LOW: '#1e8e3e' };

  const pd = aiData?.phaseData || {};
  const analysis = pd.analysis || {};
  const intel = pd.intel || {};
  const knowledge = pd.knowledge || {};
  const correlation = pd.correlation || {};
  const ticket = pd.ticket || aiData?.ticket || {};
  const response = pd.response || aiData?.response || {};
  const validation = pd.validation || {};
  const responseActions = response?.actions || [];
  const iocs = aiData?.iocs || analysis?.iocs || {};
  const reportId = `INC-${alert.id.substring(0, 8).toUpperCase()}`;
  const generatedAt = new Date();
  const generatedIso = generatedAt.toISOString();
  const filenameBase = `incident-${alert.id}-report`;

  const asList = (value: any): string[] => Array.isArray(value) ? value.filter(Boolean).map(String) : [];
  const remediationSteps = (alert.remediation_steps || knowledge?.remediation_steps || '')
    .split('\n')
    .map((s: string) => s.trim())
    .filter(Boolean)
    .map((s: string) => s.replace(/^\d+[\.\)]\s*/, '').replace(/^[-*]\s*/, ''));

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const xmlEscape = (value: any) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const htmlEscape = (value: any) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const textReport = [
    `BBS AISOC INCIDENT REPORT`,
    `Report ID: ${reportId}`,
    `Generated: ${generatedAt.toLocaleString()}`,
    `Status: ${alert.status}`,
    `Severity: ${severity} (Wazuh level ${alert.severity})`,
    `Email notification: ${alert.email_sent === 1 ? 'Sent' : 'Not sent'}`,
    ``,
    `1. EXECUTIVE SUMMARY`,
    `Description: ${alert.description}`,
    `AI Summary: ${aiData?.summary || analysis?.analysis_summary || 'No AI summary available.'}`,
    `Risk Score: ${analysis?.risk_score ?? 'N/A'}`,
    `Recommended Action: ${analysis?.recommended_action || validation?.recommendation || 'N/A'}`,
    `False Positive: ${analysis?.is_false_positive === true ? 'Yes' : analysis?.is_false_positive === false ? 'No' : 'Unknown'}`,
    analysis?.false_positive_reason ? `False Positive Reason: ${analysis.false_positive_reason}` : '',
    ``,
    `2. ALERT DETAILS`,
    `Alert ID: ${alert.id}`,
    `Timestamp: ${new Date(alert.timestamp).toLocaleString()}`,
    `Rule ID: ${alert.rule_id || 'N/A'}`,
    `Source IP: ${alert.source_ip || 'N/A'}`,
    `Destination IP: ${alert.dest_ip || 'N/A'}`,
    `User: ${alert.user || 'N/A'}`,
    `Agent: ${alert.agent_name || 'N/A'}`,
    `Hostname: ${alert.hostname || 'N/A'}`,
    ``,
    `3. INDICATORS OF COMPROMISE`,
    `IPs: ${(asList(iocs.ips).length ? asList(iocs.ips) : alert.source_ip ? [alert.source_ip] : ['N/A']).join(', ')}`,
    `Users: ${asList(iocs.users).join(', ') || alert.user || 'N/A'}`,
    `Hosts: ${(asList(iocs.hosts).length ? asList(iocs.hosts) : alert.agent_name ? [alert.agent_name] : ['N/A']).join(', ')}`,
    `Domains: ${asList(iocs.domains).join(', ') || 'N/A'}`,
    `Hashes: ${asList(iocs.hashes).join(', ') || 'N/A'}`,
    `Files: ${asList(iocs.files).join(', ') || 'N/A'}`,
    `Processes: ${asList(iocs.processes).join(', ') || 'N/A'}`,
    `Ports: ${asList(iocs.ports).join(', ') || 'N/A'}`,
    ``,
    `4. MITRE ATT&CK`,
    mitreTags.length ? mitreTags.map(t => `- ${t}`).join('\n') : '- No techniques mapped.',
    ``,
    `5. THREAT INTELLIGENCE`,
    aiData?.intel || intel?.intel_summary || 'No threat intelligence summary available.',
    intel?.misp ? `MISP Hits: ${intel.misp.hits ?? 0}` : '',
    ``,
    `6. CORRELATION`,
    correlation?.campaign_name || aiData?.correlation || 'No campaign correlation available.',
    correlation?.campaign_description || '',
    ``,
    `7. TICKETING / BUSINESS IMPACT`,
    `Title: ${ticket?.title || 'N/A'}`,
    `Priority: ${ticket?.priority || 'N/A'}`,
    `Business Impact: ${ticket?.business_impact || 'N/A'}`,
    ticket?.report_body || '',
    ``,
    `8. REMEDIATION`,
    remediationSteps.length ? remediationSteps.map((s, i) => `${i + 1}. ${s}`).join('\n') : 'No remediation steps available.',
    ``,
    `9. RESPONSE PLAN`,
    responseActions.length
      ? responseActions.map((a: any, i: number) => `${i + 1}. ${a.type || 'ACTION'} -> ${a.target || 'N/A'}\n   Reason: ${a.reason || 'N/A'}\n   Automated: ${a.automated ? 'Yes' : 'No'}`).join('\n')
      : 'No response actions generated.',
    `Approval Required: ${response?.approval_required === true ? 'Yes' : response?.approval_required === false ? 'No' : 'Unknown'}`,
    ``,
    `10. SLA / VALIDATION`,
    `SLA Status: ${validation?.sla_status || aiData?.validation || 'Pending'}`,
    `Completeness Score: ${validation?.completeness_score ?? 'N/A'}`,
    `Recommendation: ${validation?.recommendation || 'N/A'}`,
    ``,
    `11. RAW WAZUH LOG`,
    alert.full_log || 'No log data.',
  ].filter(Boolean).join('\n');

  const xmlReport = `<?xml version="1.0" encoding="UTF-8"?>
<incidentReport id="${xmlEscape(reportId)}" generatedAt="${xmlEscape(generatedIso)}">
  <status>${xmlEscape(alert.status)}</status>
  <severity label="${xmlEscape(severity)}" wazuhLevel="${xmlEscape(alert.severity)}" />
  <emailNotification sent="${alert.email_sent === 1 ? 'true' : 'false'}" />
  <alert>
    <id>${xmlEscape(alert.id)}</id>
    <timestamp>${xmlEscape(alert.timestamp)}</timestamp>
    <ruleId>${xmlEscape(alert.rule_id)}</ruleId>
    <description>${xmlEscape(alert.description)}</description>
    <sourceIp>${xmlEscape(alert.source_ip || '')}</sourceIp>
    <destinationIp>${xmlEscape(alert.dest_ip || '')}</destinationIp>
    <user>${xmlEscape(alert.user || '')}</user>
    <agent>${xmlEscape(alert.agent_name || '')}</agent>
    <hostname>${xmlEscape(alert.hostname || '')}</hostname>
  </alert>
  <analysis>
    <summary>${xmlEscape(aiData?.summary || analysis?.analysis_summary || '')}</summary>
    <riskScore>${xmlEscape(analysis?.risk_score ?? '')}</riskScore>
    <recommendedAction>${xmlEscape(analysis?.recommended_action || validation?.recommendation || '')}</recommendedAction>
    <falsePositive>${analysis?.is_false_positive === true ? 'true' : analysis?.is_false_positive === false ? 'false' : ''}</falsePositive>
    <falsePositiveReason>${xmlEscape(analysis?.false_positive_reason || '')}</falsePositiveReason>
  </analysis>
  <iocs>
${['ips','users','hosts','domains','hashes','files','processes','ports'].map(type =>
  `    <${type}>${asList(iocs[type]).map(v => `<value>${xmlEscape(v)}</value>`).join('')}</${type}>`
).join('\n')}
  </iocs>
  <mitreAttack>
${mitreTags.map(t => `    <technique>${xmlEscape(t)}</technique>`).join('\n')}
  </mitreAttack>
  <threatIntelligence>${xmlEscape(aiData?.intel || intel?.intel_summary || '')}</threatIntelligence>
  <correlation>
    <campaignName>${xmlEscape(correlation?.campaign_name || aiData?.correlation || '')}</campaignName>
    <description>${xmlEscape(correlation?.campaign_description || '')}</description>
  </correlation>
  <ticket>
    <title>${xmlEscape(ticket?.title || '')}</title>
    <priority>${xmlEscape(ticket?.priority || '')}</priority>
    <businessImpact>${xmlEscape(ticket?.business_impact || '')}</businessImpact>
    <body>${xmlEscape(ticket?.report_body || '')}</body>
  </ticket>
  <remediation>
${remediationSteps.map((s, i) => `    <step order="${i + 1}">${xmlEscape(s)}</step>`).join('\n')}
  </remediation>
  <responsePlan approvalRequired="${response?.approval_required === true ? 'true' : response?.approval_required === false ? 'false' : ''}">
${responseActions.map((a: any, i: number) => `    <action order="${i + 1}">
      <type>${xmlEscape(a.type || '')}</type>
      <target>${xmlEscape(a.target || '')}</target>
      <reason>${xmlEscape(a.reason || '')}</reason>
      <automated>${a.automated ? 'true' : 'false'}</automated>
    </action>`).join('\n')}
  </responsePlan>
  <validation>
    <slaStatus>${xmlEscape(validation?.sla_status || aiData?.validation || '')}</slaStatus>
    <completenessScore>${xmlEscape(validation?.completeness_score ?? '')}</completenessScore>
    <recommendation>${xmlEscape(validation?.recommendation || '')}</recommendation>
  </validation>
  <rawLog>${xmlEscape(alert.full_log || '')}</rawLog>
</incidentReport>
`;

  const markdownReport = textReport
    .replace(/^BBS AISOC INCIDENT REPORT/m, '# BBS AISOC Incident Report')
    .replace(/^(\d+)\. ([A-Z /]+)$/gm, '\n---\n## $1. $2');

  const exportText = () => downloadFile(textReport, `${filenameBase}.txt`, 'text/plain;charset=utf-8');
  const exportXml = () => downloadFile(xmlReport, `${filenameBase}.xml`, 'application/xml;charset=utf-8');
  const exportMarkdown = () => downloadFile(markdownReport, `${filenameBase}.md`, 'text/markdown;charset=utf-8');
  const exportPdf = () => {
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${htmlEscape(reportId)} - BBS AISOC Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #1f2937; margin: 32px; line-height: 1.45; }
    h1 { color: #003a7a; margin-bottom: 4px; }
    h2 { color: #004a99; border-bottom: 1px solid #d1d9e6; padding-bottom: 6px; margin-top: 24px; }
    .meta { color: #64748b; font-size: 12px; margin-bottom: 18px; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 6px; background: #f1f5f9; margin-right: 6px; font-size: 12px; font-weight: 700; }
    .sev { background: ${sevColor[severity]}22; color: ${sevColor[severity]}; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; }
    pre { background: #0f172a; color: #34d399; padding: 12px; border-radius: 8px; white-space: pre-wrap; font-size: 11px; }
    @media print { body { margin: 18mm; } button { display: none; } }
  </style>
</head>
<body>
  <button onclick="window.print()" style="float:right;padding:8px 12px">Print / Save PDF</button>
  <h1>BBS AISOC Incident Report</h1>
  <div class="meta">${htmlEscape(reportId)} · Generated ${htmlEscape(generatedAt.toLocaleString())}</div>
  <span class="badge sev">${htmlEscape(severity)}</span><span class="badge">${htmlEscape(alert.status)}</span><span class="badge">Wazuh ${htmlEscape(alert.severity)}</span>
  <h2>Executive Summary</h2>
  <p>${htmlEscape(aiData?.summary || analysis?.analysis_summary || 'No AI summary available.')}</p>
  <table>
    <tr><th>Description</th><td>${htmlEscape(alert.description)}</td></tr>
    <tr><th>Alert ID</th><td>${htmlEscape(alert.id)}</td></tr>
    <tr><th>Rule ID</th><td>${htmlEscape(alert.rule_id || 'N/A')}</td></tr>
    <tr><th>Source IP</th><td>${htmlEscape(alert.source_ip || 'N/A')}</td></tr>
    <tr><th>Agent</th><td>${htmlEscape(alert.agent_name || 'N/A')}</td></tr>
    <tr><th>Risk Score</th><td>${htmlEscape(analysis?.risk_score ?? 'N/A')}</td></tr>
    <tr><th>Recommended Action</th><td>${htmlEscape(analysis?.recommended_action || validation?.recommendation || 'N/A')}</td></tr>
  </table>
  <h2>Indicators of Compromise</h2>
  <p>${htmlEscape(['ips','users','hosts','domains','hashes','files','processes','ports'].map(k => `${k}: ${asList(iocs[k]).join(', ') || 'N/A'}`).join(' | '))}</p>
  <h2>MITRE ATT&CK</h2>
  <p>${htmlEscape(mitreTags.join(', ') || 'No techniques mapped.')}</p>
  <h2>Threat Intelligence</h2>
  <p>${htmlEscape(aiData?.intel || intel?.intel_summary || 'No threat intelligence summary available.')}</p>
  <h2>Correlation</h2>
  <p>${htmlEscape(correlation?.campaign_name || aiData?.correlation || 'No campaign correlation available.')}</p>
  <h2>Remediation</h2>
  <ol>${(remediationSteps.length ? remediationSteps : ['No remediation steps available.']).map(s => `<li>${htmlEscape(s)}</li>`).join('')}</ol>
  <h2>Response Plan</h2>
  <ol>${(responseActions.length ? responseActions : [{ type: 'No response actions generated', target: '', reason: '' }]).map((a: any) => `<li><strong>${htmlEscape(a.type || 'ACTION')}</strong> ${htmlEscape(a.target || '')}<br/>${htmlEscape(a.reason || '')}</li>`).join('')}</ol>
  <h2>SLA / Validation</h2>
  <p>${htmlEscape(validation?.sla_status || aiData?.validation || 'Pending')}</p>
  <h2>Raw Wazuh Log</h2>
  <pre>${htmlEscape(alert.full_log || 'No log data.')}</pre>
</body>
</html>`;
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.setAttribute('aria-hidden', 'true');
    document.body.appendChild(frame);

    const doc = frame.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(frame);
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) return;
      win.focus();
      win.print();
      setTimeout(() => {
        if (document.body.contains(frame)) document.body.removeChild(frame);
      }, 1000);
    };
  };

  const handleDownload = () => {
    if (exportFormat === 'txt') exportText();
    if (exportFormat === 'xml') exportXml();
    if (exportFormat === 'pdf') exportPdf();
    if (exportFormat === 'md') exportMarkdown();
  };

  const Section = ({ title, children }: { title: string, children: React.ReactNode }) => (
    <section>
      <h3 className="text-[0.7rem] font-black text-[var(--p1)] uppercase tracking-widest mb-3 pb-2 border-b border-[#e8eef7]">
        {title}
      </h3>
      {children}
    </section>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[var(--s0)] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 bg-[var(--pd)] text-white shrink-0">
          <div>
            <p className="text-[0.65rem] font-black uppercase tracking-widest text-blue-200 mb-0.5">Aegis SOC — Final Incident Report</p>
            <h2 className="text-[1.1rem] font-black tracking-tight">INC-{alert.id.substring(0, 8).toUpperCase()}</h2>
            <p className="text-[0.75rem] text-blue-200 mt-0.5 truncate max-w-sm">{alert.description}</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as 'txt' | 'xml' | 'pdf' | 'md')}
              className="h-9 rounded-lg bg-[var(--s0)]/10 border border-white/20 text-white text-[0.75rem] font-bold px-2 outline-none hover:bg-[var(--s0)]/20"
              title="Export format"
            >
              <option className="text-[var(--t1)]" value="pdf">PDF</option>
              <option className="text-[var(--t1)]" value="txt">Text</option>
              <option className="text-[var(--t1)]" value="xml">XML</option>
              <option className="text-[var(--t1)]" value="md">Markdown</option>
            </select>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--s0)]/10 hover:bg-[var(--s0)]/20 text-white text-[0.75rem] font-bold transition-colors border border-white/20"
            >
              <ChevronRight size={13} className="rotate-90" />
              Download
            </button>
            <button onClick={onClose} className="p-2 hover:bg-[var(--s0)]/10 rounded-lg transition-colors">
              <XCircle size={20} />
            </button>
          </div>
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-3 px-7 py-2.5 bg-[var(--s1)] border-b border-[var(--b2)] text-[0.7rem] font-bold shrink-0">
          <span
            className="px-2.5 py-1 rounded-full uppercase tracking-wide"
            style={{ background: `${sevColor[severity]}18`, color: sevColor[severity] }}
          >
            {severity}
          </span>
          <span className="text-[var(--t3)]">|</span>
          <span className={`px-2.5 py-1 rounded-full uppercase tracking-wide ${
            alert.status === 'TRIAGED' ? 'bg-green-50 text-green-700' :
            alert.status === 'ANALYZING' ? 'bg-blue-50 text-blue-700' :
            'bg-[var(--s1)] text-[var(--t5)]'
          }`}>{alert.status}</span>
          {alert.email_sent === 1 && (
            <>
              <span className="text-[var(--t3)]">|</span>
              <span className="flex items-center gap-1 text-green-600"><Bell size={11} fill="currentColor" /> Email sent</span>
            </>
          )}
          <span className="ml-auto text-[var(--t3)]">{new Date(alert.timestamp).toLocaleString()}</span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-6 text-sm">

          <Section title="1 — Executive Summary">
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'Source IP', value: alert.source_ip || 'N/A' },
                { label: 'Hostname', value: alert.agent_name || 'N/A' },
                { label: 'Rule ID', value: alert.rule_id || 'N/A' },
              ].map(f => (
                <div key={f.label} className="bg-[var(--s1)] border border-[var(--b2)] rounded-lg p-3">
                  <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-wider mb-1">{f.label}</p>
                  <p className="font-mono font-bold text-[0.8rem] text-[var(--t7)] truncate">{f.value}</p>
                </div>
              ))}
            </div>
            <div className="bg-[var(--sa)] border border-[#c8ddf7] rounded-xl p-4 text-[var(--t6)] leading-relaxed italic text-[0.85rem]">
              {aiData?.summary || 'No AI summary available. Run the Alert Triage agent first.'}
            </div>
            {(() => {
              const pd = aiData?.phaseData?.analysis;
              if (!pd) return null;
              const ac = pd.attack_category as string | undefined;
              const kc = pd.kill_chain_stage as string | undefined;
              const rs = pd.risk_score as number | undefined;
              const ra = pd.recommended_action as string | undefined;
              const sv = pd.severity_validation as string | undefined;
              const isFP = pd.is_false_positive as boolean | undefined;
              const fpReason = pd.false_positive_reason as string | undefined;
              if (!ac && !kc && rs == null && !ra) return null;
              const rsColor = rs == null ? 'bg-slate-300' : rs >= 80 ? 'bg-red-500' : rs >= 60 ? 'bg-orange-500' : rs >= 40 ? 'bg-amber-400' : 'bg-emerald-500';
              const svColor: Record<string, string> = { CRITICAL: 'bg-red-100 text-red-800 border-red-300', HIGH: 'bg-orange-100 text-orange-800 border-orange-300', MEDIUM: 'bg-blue-100 text-blue-800 border-blue-300', LOW: 'bg-green-100 text-green-800 border-green-300' };
              const raColor: Record<string, string> = { IGNORE: 'bg-[var(--s1)] text-[var(--t5)] border-[var(--b1)]', MONITOR: 'bg-blue-100 text-blue-700 border-blue-300', INVESTIGATE: 'bg-cyan-100 text-cyan-700 border-cyan-300', ESCALATE: 'bg-amber-100 text-amber-700 border-amber-300', CONTAIN: 'bg-orange-100 text-orange-700 border-orange-300', BLOCK: 'bg-red-100 text-red-700 border-red-300' };
              return (
                <div className="mt-3 space-y-2.5">
                  <div className="flex flex-wrap gap-2 items-center">
                    {ac && <span className="px-2.5 py-1 rounded-lg bg-blue-100 text-blue-800 border border-blue-200 text-[0.68rem] font-bold uppercase tracking-wide">{ac.replace(/_/g, ' ')}</span>}
                    {kc && <span className="px-2.5 py-1 rounded-lg bg-purple-100 text-purple-800 border border-purple-200 text-[0.68rem] font-bold uppercase tracking-wide">{kc.replace(/_/g, ' ')}</span>}
                    {sv && <span className={`px-2.5 py-1 rounded-lg border text-[0.68rem] font-bold uppercase tracking-wide ${svColor[sv] ?? ''}`}>{sv} (validated)</span>}
                    {ra && <span className={`px-2.5 py-1 rounded-lg border text-[0.68rem] font-bold uppercase tracking-wide ${raColor[ra] ?? ''}`}>Action: {ra}</span>}
                    {isFP && <span className="px-2.5 py-1 rounded-lg bg-red-100 text-red-700 border border-red-300 text-[0.68rem] font-bold uppercase tracking-wide">False Positive</span>}
                  </div>
                  {rs != null && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[0.65rem] text-[var(--t4)] font-semibold">
                        <span>Risk Score</span><span>{rs}/100</span>
                      </div>
                      <div className="w-full h-2 bg-[var(--s1)] rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${rsColor}`} style={{ width: `${rs}%` }} />
                      </div>
                    </div>
                  )}
                  {isFP && fpReason && (
                    <p className="text-[0.72rem] text-[var(--t4)] italic">{fpReason}</p>
                  )}
                </div>
              );
            })()}
          </Section>

          <Section title="2 — Indicators of Compromise">
            <div className="flex flex-wrap gap-2">
              {(iocs.ips?.length ? iocs.ips : alert.source_ip ? [alert.source_ip] : []).map((ip: string) => (
                <span key={ip} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-50 border border-red-200 rounded-lg text-red-800 font-mono text-[0.75rem] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />IP: {ip}
                </span>
              ))}
              {(iocs.users || []).map((u: string) => (
                <span key={u} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-orange-50 border border-orange-200 rounded-lg text-orange-800 font-mono text-[0.75rem] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />User: {u}
                </span>
              ))}
              {(iocs.hosts?.length ? iocs.hosts : alert.agent_name ? [alert.agent_name] : []).map((h: string) => (
                <span key={h} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-purple-50 border border-purple-200 rounded-lg text-purple-800 font-mono text-[0.75rem] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />Host: {h}
                </span>
              ))}
              {(iocs.domains || []).map((d: string) => (
                <span key={d} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-sky-50 border border-sky-200 rounded-lg text-sky-800 font-mono text-[0.75rem] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />Domain: {d}
                </span>
              ))}
              {(iocs.processes || []).map((p: string) => (
                <span key={p} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 font-mono text-[0.75rem] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />Proc: {p}
                </span>
              ))}
              {(iocs.files || []).map((f: string) => (
                <span key={f} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 font-mono text-[0.75rem] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />File: {f}
                </span>
              ))}
              {(iocs.hashes || []).map((h: string) => (
                <span key={h} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 border border-zinc-300 rounded-lg text-[var(--t5)] font-mono text-[0.75rem] font-bold" title={h}>
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />Hash: {h.length > 12 ? h.slice(0, 12) + '…' : h}
                </span>
              ))}
              {(iocs.ports || []).length > 0 && (
                <span className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-800 font-mono text-[0.75rem] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />Ports: {iocs.ports.join(', ')}
                </span>
              )}
              {!iocs.ips?.length && !alert.source_ip && !iocs.users?.length && !iocs.hosts?.length && !alert.agent_name &&
               !iocs.domains?.length && !iocs.processes?.length && !iocs.files?.length && !iocs.hashes?.length && !iocs.ports?.length && (
                <p className="text-[var(--t3)] text-xs italic">No IOCs extracted yet.</p>
              )}
            </div>
          </Section>

          <Section title="3 — MITRE ATT&CK Mapping">
            {mitreTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {mitreTags.map(tag => (
                  <span key={tag} className="px-3 py-1.5 bg-[#1a1a2e] text-[#e94560] border border-[#e94560]/30 rounded-lg text-[0.7rem] font-black font-mono tracking-wide">
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[var(--t3)] text-xs italic">No techniques mapped. Run Threat Intel agent.</p>
            )}
          </Section>

          <Section title="4 — Threat Intelligence">
            {(() => {
              const misp = aiData?.phaseData?.intel?.misp;
              if (!misp) return null;
              if (!misp.available) {
                return <div className="mb-3 text-[0.72rem] text-[var(--t4)] italic">MISP: unavailable (no API key configured or instance unreachable)</div>;
              }
              if (misp.hits === 0) {
                return <div className="mb-3 text-[0.72rem] text-[var(--t4)]">MISP: queried — no matches for these IOCs.</div>;
              }
              const lvlColor: Record<string, string> = {
                High: 'bg-red-100 text-red-800 border-red-200',
                Medium: 'bg-orange-100 text-orange-800 border-orange-200',
                Low: 'bg-amber-50 text-amber-700 border-amber-200',
                Undefined: 'bg-[var(--s1)] text-[var(--t5)] border-[var(--b2)]',
              };
              const tagColor = (t: string) => {
                if (t.startsWith('tlp:')) {
                  if (t.includes('red')) return 'bg-red-600 text-white';
                  if (t.includes('amber')) return 'bg-amber-500 text-white';
                  if (t.includes('green')) return 'bg-green-600 text-white';
                  if (t.includes('white')) return 'bg-[var(--s2)] text-[var(--t7)] border border-[var(--b1)]';
                }
                return 'bg-blue-50 text-blue-800 border border-blue-200';
              };
              return (
                <div className="mb-3 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 px-3 py-1 rounded-full bg-blue-600 text-white text-[0.7rem] font-black uppercase tracking-wider">
                      ✓ MISP — {misp.hits} match{misp.hits === 1 ? '' : 'es'}
                    </span>
                    <span className={`px-2.5 py-1 rounded-full border font-black uppercase text-[0.62rem] tracking-wide ${lvlColor[misp.highest_threat_level]}`}>
                      Threat Level: {misp.highest_threat_level}
                    </span>
                  </div>

                  {(misp.threat_actors?.length > 0 || misp.malware_families?.length > 0) && (
                    <div className="grid grid-cols-2 gap-3">
                      {misp.threat_actors?.length > 0 && (
                        <div>
                          <p className="text-[0.6rem] font-black text-[var(--t4)] uppercase tracking-wider mb-1.5">Threat Actors</p>
                          <div className="flex flex-wrap gap-1">
                            {misp.threat_actors.map((a: string) => (
                              <span key={a} className="px-2 py-0.5 rounded bg-red-100 text-red-800 text-[0.7rem] font-bold">{a}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {misp.malware_families?.length > 0 && (
                        <div>
                          <p className="text-[0.6rem] font-black text-[var(--t4)] uppercase tracking-wider mb-1.5">Malware / Tools</p>
                          <div className="flex flex-wrap gap-1">
                            {misp.malware_families.map((m: string) => (
                              <span key={m} className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-[0.7rem] font-bold">{m}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {misp.events?.length > 0 && (
                    <div>
                      <p className="text-[0.6rem] font-black text-[var(--t4)] uppercase tracking-wider mb-1.5">Related MISP Events</p>
                      <div className="space-y-1">
                        {misp.events.slice(0, 5).map((e: any) => (
                          <div key={e.id} className="flex items-center gap-2 text-[0.72rem] bg-[var(--s0)]/60 rounded px-2 py-1 border border-blue-100">
                            <span className="font-mono font-bold text-blue-700">#{e.id}</span>
                            <span className="flex-1 truncate text-[var(--t6)]">{e.info}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[0.6rem] font-bold border ${lvlColor[e.threat_level]}`}>{e.threat_level}</span>
                            {e.date && <span className="text-[0.62rem] text-[var(--t4)] font-mono">{e.date}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {misp.tags?.length > 0 && (
                    <div>
                      <p className="text-[0.6rem] font-black text-[var(--t4)] uppercase tracking-wider mb-1.5">Tags</p>
                      <div className="flex flex-wrap gap-1">
                        {misp.tags.map((t: string) => (
                          <span key={t} className={`px-1.5 py-0.5 rounded text-[0.62rem] font-bold font-mono ${tagColor(t)}`}>{t}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {misp.matched_iocs?.length > 0 && (
                    <div>
                      <p className="text-[0.6rem] font-black text-[var(--t4)] uppercase tracking-wider mb-1.5">Matched IOCs ({misp.matched_iocs.length})</p>
                      <div className="text-[0.68rem] font-mono text-[var(--t5)] bg-[var(--s0)]/50 rounded px-2 py-1 break-all">
                        {misp.matched_iocs.slice(0, 10).join(' · ')}{misp.matched_iocs.length > 10 ? ` +${misp.matched_iocs.length - 10} more` : ''}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="bg-slate-900 rounded-xl p-4 text-[var(--t3)] text-[0.8rem] leading-relaxed whitespace-pre-wrap font-mono">
              {aiData?.intel || <span className="italic text-[var(--t4)]">No intel data. Run the Threat Intel agent.</span>}
            </div>
          </Section>

          <Section title="5 — Remediation & Playbook">
            {alert.remediation_steps ? (
              <div className="space-y-2">
                {alert.remediation_steps.split('\n').filter(Boolean).map((step, i) => (
                  <div key={i} className="flex gap-3 items-start p-3 bg-green-50 border border-green-100 rounded-lg">
                    <span className="w-5 h-5 shrink-0 rounded-full bg-green-200 text-green-800 font-black text-[0.65rem] flex items-center justify-center mt-0.5">{i + 1}</span>
                    <p className="text-[0.82rem] text-[var(--t6)] leading-relaxed">{step.replace(/^\d+[\.\)]\s*/, '').replace(/^[-•]\s*/, '')}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[var(--t3)] text-xs italic">No playbook retrieved. Run the RAG Knowledge agent.</p>
            )}
          </Section>

          <Section title="6 — Campaign Correlation">
            {(() => {
              const corrObj = aiData?.phaseData?.correlation;
              if (!corrObj) return (
                <div className="rounded-xl p-4 border border-[var(--b2)] bg-[var(--s1)] text-[0.82rem] text-[var(--t4)] italic">
                  No correlation data. Run the Correlation agent.
                </div>
              );
              if (!corrObj.campaign_detected) return (
                <div className="rounded-xl p-4 border border-[var(--b2)] bg-[var(--s1)] text-[0.82rem] text-[var(--t4)] italic">
                  {corrObj.campaign_name || 'No campaign pattern detected — isolated incident.'}
                </div>
              );
              return (
                <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden text-[0.82rem]">
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-100 border-b border-amber-200">
                    <span className="font-black text-amber-800 uppercase tracking-wide text-[0.7rem]">⚠ Campaign Detected</span>
                    {corrObj.kill_chain_stage && corrObj.kill_chain_stage !== 'UNKNOWN' && (
                      <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-[0.62rem] font-black uppercase border border-purple-200">{corrObj.kill_chain_stage}</span>
                    )}
                    {corrObj.escalation_needed && (
                      <span className="ml-auto px-2 py-0.5 rounded bg-red-100 text-red-700 text-[0.62rem] font-black uppercase border border-red-200">Escalate</span>
                    )}
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    <p className="font-bold text-amber-900 text-[0.88rem]">{corrObj.campaign_name}</p>
                    {corrObj.campaign_description && (
                      <p className="text-amber-800 leading-relaxed">{corrObj.campaign_description}</p>
                    )}
                    {corrObj.related_alerts?.length > 0 && (
                      <div className="mt-2 pt-3 border-t border-amber-200 space-y-1.5">
                        <p className="text-[0.62rem] font-black text-amber-700 uppercase tracking-widest">{corrObj.related_alerts.length} Related Alert{corrObj.related_alerts.length !== 1 ? 's' : ''}</p>
                        {corrObj.related_alerts.map((ra: { id: string; description: string }) => (
                          <div key={ra.id} className="rounded-lg bg-[var(--s0)]/70 border border-amber-200 px-3 py-2 space-y-1">
                            <span className="font-mono text-[0.68rem] text-amber-700 font-black bg-amber-100 rounded px-1.5 py-0.5 select-all">#{ra.id.toUpperCase()}</span>
                            <p className="text-[0.78rem] text-amber-900 leading-snug">{ra.description}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </Section>

          <Section title="7 — Response Plan">
            {responseActions.length > 0 ? (
              <div className="space-y-2">
                {responseActions.map((action: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-3.5 border border-[var(--b2)] rounded-xl bg-[var(--s0)]">
                    <span className={`px-2 py-0.5 rounded text-[0.6rem] font-black uppercase tracking-wide shrink-0 mt-0.5 ${
                      action.type === 'BLOCK_IP' ? 'bg-red-100 text-red-700' :
                      action.type === 'ISOLATE_HOST' ? 'bg-orange-100 text-orange-700' :
                      action.type === 'DISABLE_USER' ? 'bg-purple-100 text-purple-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>{action.type?.replace('_', ' ')}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-bold text-[0.8rem] text-[var(--t7)] truncate">{action.target}</p>
                      <p className="text-[0.75rem] text-[var(--t4)] mt-0.5">{action.reason}</p>
                    </div>
                  </div>
                ))}
                {aiData?.response?.approval_required && (
                  <p className="text-[0.7rem] text-amber-700 font-bold bg-amber-50 px-3 py-2 rounded-lg border border-amber-200 flex items-center gap-1.5">
                    <span>⚠</span> Analyst approval required before executing response actions.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[var(--t3)] text-xs italic">No response plan generated. Run the Response agent.</p>
            )}
          </Section>

          <Section title="8 — SLA & Validation">
            <div className={`rounded-xl p-4 border text-[0.82rem] ${aiData?.validation ? 'bg-green-50 border-green-200 text-green-900' : 'bg-[var(--s1)] border-[var(--b2)] text-[var(--t4)] italic'}`}>
              {aiData?.validation || 'SLA validation pending. Run the Validation agent.'}
            </div>
          </Section>

          <Section title="9 — Raw Wazuh Log">
            <pre className="text-[0.7rem] bg-slate-950 text-emerald-400 p-5 rounded-xl overflow-x-auto font-mono leading-relaxed">
              {alert.full_log || 'No log data.'}
            </pre>
          </Section>
        </div>

        <div className="px-7 py-4 border-t bg-[var(--s1)] flex justify-end shrink-0">
          <button onClick={onClose} className="px-6 py-2.5 rounded-lg font-bold text-[var(--t5)] hover:bg-[var(--s1)] transition-colors border border-[var(--b2)] text-sm">
            Close Report
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const buildInitialHistory = (aiData: any): Record<string, any[]> => {
  const pd = aiData?.phaseData || {};
  const h: Record<string, any[]> = {};
  if (pd.analysis)    h.analysis    = [pd.analysis];
  if (pd.intel)       h.intel       = [pd.intel];
  if (pd.knowledge)   h.knowledge   = [pd.knowledge];
  if (pd.correlation) h.correlation = [pd.correlation];
  if (pd.ticket)      h.ticketing   = [pd.ticket];
  if (pd.response)    h.response    = [pd.response];
  if (pd.validation)  h.validation  = [pd.validation];
  return h;
};

const getRawPhaseResult = (phase: string, result: any) => {
  switch (phase) {
    case 'analysis':    return result.analysis;
    case 'intel':       return result.intel;
    case 'knowledge':   return result.knowledge;
    case 'correlation': return result.correlation;
    case 'ticketing':   return result.ticket;
    case 'response':    return result.responsePlan;
    case 'validation':  return result.validation;
    default:            return null;
  }
};

// ==== SOC Console components (dense info-dense layout) =====================

const RiskGauge = ({ value, size = 96 }: { value: number | null, size?: number }) => {
  const v = typeof value === 'number' ? Math.max(0, Math.min(100, value)) : 0;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (v / 100) * c;
  const color = value == null ? '#cbd5e1' : v >= 80 ? '#ef4444' : v >= 60 ? '#f97316' : v >= 40 ? '#f59e0b' : '#10b981';
  const label = value == null ? '—' : v >= 80 ? 'CRITICAL' : v >= 60 ? 'HIGH' : v >= 40 ? 'MEDIUM' : 'LOW';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size/2} cy={size/2} r={r} stroke="#e2e8f0" strokeWidth={stroke} fill="none" />
          <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} className="transition-all duration-700" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[1.4rem] font-black" style={{ color }}>{value == null ? '—' : Math.round(v)}</span>
          <span className="text-[0.55rem] font-bold text-[var(--t3)] uppercase tracking-widest">/100</span>
        </div>
      </div>
      <span className="text-[0.6rem] font-black uppercase tracking-widest" style={{ color }}>{label}</span>
    </div>
  );
};

const MiniBar = ({ value, color }: { value: number, color: string }) => (
  <div className="h-1 w-full bg-[var(--s1)] rounded-full overflow-hidden">
    <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

type HeroProps = {
  alert: Alert;
  aiData: any;
  mitreTags: string[];
  severity: string;
  sevStyle: Record<string, string>;
  agentDefs: { id: string; label: string; icon: any }[];
  agentConfidence: (id: string) => number | null;
  scrollToAgents: () => void;
};

const AlertHeroStrip = ({ alert, aiData, severity, sevStyle, agentDefs, agentConfidence, scrollToAgents }: HeroProps) => {
  const pd = aiData?.phaseData || {};
  const analysis = pd.analysis;
  const intel = pd.intel;
  const risk = typeof analysis?.risk_score === 'number' ? analysis.risk_score : null;
  const attackCat = analysis?.attack_category;
  const killChain = analysis?.kill_chain_stage;
  const threatActors: string[] = intel?.misp?.threat_actors || [];
  const actorLabel = threatActors[0] || intel?.campaign_family || null;
  const threatLabel = [actorLabel, attackCat?.replace(/_/g,' ')].filter(Boolean).join(' · ') || alert.description;

  return (
    <div className="bg-[var(--s0)] rounded-xl border border-[var(--b1)] shadow-sm overflow-hidden">
      <div className="grid grid-cols-12 gap-0 divide-x divide-slate-100">
        {/* Identity */}
        <div className="col-span-12 md:col-span-6 p-4 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[0.68rem] font-bold text-[var(--t3)]">#{alert.id.substring(0,10).toUpperCase()}</span>
            <span className={`px-2 py-0.5 rounded-full border font-black uppercase text-[0.6rem] tracking-wider ${sevStyle[severity]}`}>{severity}</span>
            {analysis?.is_false_positive && <span className="px-2 py-0.5 rounded-full border bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] font-black uppercase text-[0.6rem] tracking-wider">FP</span>}
            {killChain && <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-bold text-[0.6rem] uppercase tracking-wide">{killChain.replace(/_/g,' ')}</span>}
            {alert.email_sent === 1 && <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-bold text-[0.6rem] uppercase">✓ Emailed</span>}
          </div>
          <p className="text-[0.95rem] font-bold text-[var(--t7)] leading-snug">{threatLabel}</p>
          <p className="text-[0.78rem] text-[var(--t4)] leading-snug line-clamp-2">{alert.description}</p>
          <div className="flex items-center gap-4 pt-1 text-[0.68rem] text-[var(--t4)]">
            {alert.source_ip && <span>SRC <span className="font-mono font-bold text-[var(--t6)]">{alert.source_ip}</span></span>}
            <span>HOST <span className="font-mono font-bold text-[var(--t6)]">{alert.agent_name}</span></span>
            <span>RULE <span className="font-mono font-bold text-[var(--t6)]">{alert.rule_id}</span></span>
            <span className="font-mono">{new Date(alert.timestamp).toLocaleString()}</span>
          </div>
        </div>

        {/* Risk gauge */}
        <div className="col-span-6 md:col-span-3 p-4 flex items-center justify-center bg-[var(--s1)]/50">
          <RiskGauge value={risk} size={110} />
        </div>

        {/* Agent pipeline */}
        <div className="col-span-6 md:col-span-3 p-4">
          <button type="button" onClick={scrollToAgents} className="w-full text-left group">
            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-2">Agent Pipeline</p>
            <div className="space-y-1">
              {agentDefs.map((a) => {
                const c = agentConfidence(a.id);
                const pct = c == null ? null : Math.round(c * 100);
                const color = pct == null ? 'bg-[var(--s2)]' : pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400';
                return (
                  <div key={a.id} className="flex items-center gap-2 group-hover:opacity-90">
                    <a.icon size={10} className="text-[var(--t3)] shrink-0" />
                    <span className="text-[0.62rem] text-[var(--t5)] w-20 truncate">{a.label}</span>
                    <div className="flex-1"><MiniBar value={pct ?? 0} color={color} /></div>
                    <span className="text-[0.58rem] font-mono font-bold text-[var(--t4)] w-8 text-right">{pct == null ? '—' : `${pct}%`}</span>
                  </div>
                );
              })}
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

const EvidenceStrip = ({ aiData, mitreTags }: { aiData: any, mitreTags: string[] }) => {
  const pd = aiData?.phaseData || {};
  const misp = pd.intel?.misp;
  const iocs = aiData?.iocs || {};
  const iocCount = ['ips','users','hosts','domains','hashes','files','processes'].reduce((a, k) => a + (Array.isArray(iocs[k]) ? iocs[k].length : 0), 0);
  const iocTypes = ['ips','users','hosts','domains','hashes','files','processes'].filter(k => Array.isArray(iocs[k]) && iocs[k].length > 0).length;
  const actions = pd.response?.actions || aiData?.response?.actions || [];
  const approvalRequired = pd.response?.approval_required ?? aiData?.response?.approval_required;
  const sla = pd.validation?.sla_status || aiData?.validation;
  const slaTone = sla ? (String(sla).toLowerCase().includes('breach') ? 'text-red-700 bg-red-50 border-red-200' : String(sla).toLowerCase().includes('risk') ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-green-700 bg-green-50 border-green-200') : 'text-[var(--t4)] bg-[var(--s1)] border-[var(--b2)]';
  const confidences = ['analysis','intel','knowledge','correlation','ticket','response','validation'].map(k => pd[k]?.confidence).filter((v): v is number => typeof v === 'number');
  const avgConf = confidences.length ? Math.round(confidences.reduce((a,b) => a+b, 0) / confidences.length * 100) : null;
  const mispLevelCls: Record<string,string> = { High: 'text-red-700 bg-red-50 border-red-200', Medium: 'text-orange-700 bg-orange-50 border-orange-200', Low: 'text-amber-700 bg-amber-50 border-amber-200', Undefined: 'text-[var(--t5)] bg-[var(--s1)] border-[var(--b2)]' };

  const Chip = ({ title, value, sub, tone = 'text-[var(--t6)] bg-[var(--s0)] border-[var(--b2)]' }: { title: string, value: React.ReactNode, sub?: React.ReactNode, tone?: string }) => (
    <div className={`rounded-xl border px-3 py-2.5 ${tone} flex flex-col gap-0.5 min-w-0`}>
      <p className="text-[0.55rem] font-black uppercase tracking-widest opacity-70">{title}</p>
      <div className="text-[1rem] font-black leading-tight truncate">{value}</div>
      {sub && <div className="text-[0.62rem] opacity-80 truncate">{sub}</div>}
    </div>
  );

  const riskScore = pd.analysis?.risk_score;
  const riskTone  = riskScore == null ? 'text-[var(--t4)] bg-[var(--s1)] border-[var(--b2)]'
    : riskScore >= 80 ? 'text-red-700 bg-red-50 border-red-200'
    : riskScore >= 60 ? 'text-orange-700 bg-orange-50 border-orange-200'
    : riskScore >= 40 ? 'text-amber-700 bg-amber-50 border-amber-200'
    : 'text-green-700 bg-green-50 border-green-200';

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
      <Chip title="Risk Score"    value={riskScore != null ? `${riskScore}/100` : '—'} sub={pd.analysis?.severity_validation || 'not assessed'} tone={riskTone} />
      <Chip title="MITRE"        value={`${mitreTags.length} technique${mitreTags.length===1?'':'s'}`} sub={mitreTags.slice(0,3).join(' · ') || '—'} />
      <Chip title="MISP"         value={misp?.available ? `${misp.hits || 0} hits` : 'n/a'} sub={misp?.highest_threat_level || (misp?.available ? 'no matches' : 'unavailable')} tone={misp?.available && misp.hits > 0 ? mispLevelCls[misp.highest_threat_level] : 'text-[var(--t5)] bg-[var(--s1)] border-[var(--b2)]'} />
      <Chip title="IOCs"         value={iocCount} sub={`${iocTypes} type${iocTypes===1?'':'s'}`} />
      <Chip title="Actions"      value={actions.length} sub={approvalRequired ? 'approval required' : 'auto-executable'} tone={approvalRequired ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-[var(--t6)] bg-[var(--s0)] border-[var(--b2)]'} />
      <Chip title="Avg Confidence" value={avgConf == null ? '—' : `${avgConf}%`} sub={avgConf == null ? 'no runs' : `${confidences.length}/7 agents`} tone={avgConf == null ? 'text-[var(--t4)] bg-[var(--s1)] border-[var(--b2)]' : avgConf >= 80 ? 'text-green-700 bg-green-50 border-green-200' : avgConf >= 60 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-red-700 bg-red-50 border-red-200'} />
    </div>
  );
};

const IocTable = ({ iocs }: { iocs: any }) => {
  const groups = [
    { key: 'ips', label: 'IP', tone: 'text-red-700 bg-red-50' },
    { key: 'users', label: 'User', tone: 'text-orange-700 bg-orange-50' },
    { key: 'hosts', label: 'Host', tone: 'text-purple-700 bg-purple-50' },
    { key: 'domains', label: 'Domain', tone: 'text-sky-700 bg-sky-50' },
    { key: 'processes', label: 'Proc', tone: 'text-emerald-700 bg-emerald-50' },
    { key: 'files', label: 'File', tone: 'text-yellow-700 bg-yellow-50' },
    { key: 'hashes', label: 'Hash', tone: 'text-[var(--t5)] bg-zinc-50' },
  ];
  const rows: { type: string; value: string; tone: string }[] = [];
  for (const g of groups) {
    const arr = Array.isArray(iocs?.[g.key]) ? iocs[g.key] : [];
    for (const v of arr) rows.push({ type: g.label, value: String(v), tone: g.tone });
  }
  if (iocs?.ports?.length) rows.push({ type: 'Ports', value: iocs.ports.join(', '), tone: 'text-indigo-700 bg-indigo-50' });
  if (rows.length === 0) return <p className="text-[0.72rem] text-[var(--t3)] italic">No IOCs extracted yet.</p>;
  return (
    <div className="overflow-hidden rounded border border-[var(--b2)]">
      <table className="w-full text-[0.72rem]">
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-[var(--s1)]">
              <td className={`px-2 py-1 font-black uppercase tracking-wide text-[0.58rem] ${r.tone} w-16`}>{r.type}</td>
              <td className="px-2 py-1 font-mono text-[var(--t6)] break-all">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const InvestigationGrid = ({ alert, aiData, mitreTags }: { alert: Alert, aiData: any, mitreTags: string[] }) => {
  const pd = aiData?.phaseData || {};
  const misp = pd.intel?.misp;
  const actions = pd.response?.actions || aiData?.response?.actions || [];
  const approvalRequired = pd.response?.approval_required ?? aiData?.response?.approval_required;
  const playbookSteps = (alert.remediation_steps || '').split('\n').map(s => s.trim()).filter(Boolean);
  const correlation = aiData?.correlation;
  const correlationObj = pd.correlation;
  const validation = aiData?.validation;

  const lvlColor: Record<string, string> = {
    High: 'bg-red-100 text-red-800 border-red-200',
    Medium: 'bg-orange-100 text-orange-800 border-orange-200',
    Low: 'bg-amber-50 text-amber-700 border-amber-200',
    Undefined: 'bg-[var(--s1)] text-[var(--t5)] border-[var(--b2)]',
  };
  const tagColor = (t: string) => {
    if (t.startsWith('tlp:')) {
      if (t.includes('red')) return 'bg-red-600 text-white';
      if (t.includes('amber')) return 'bg-amber-500 text-white';
      if (t.includes('green')) return 'bg-green-600 text-white';
      if (t.includes('white')) return 'bg-[var(--s2)] text-[var(--t7)] border border-[var(--b1)]';
    }
    return 'bg-blue-50 text-blue-800 border border-blue-200';
  };
  const actionTone: Record<string,string> = {
    BLOCK_IP: 'bg-red-100 text-red-700',
    ISOLATE_HOST: 'bg-orange-100 text-orange-700',
    DISABLE_USER: 'bg-purple-100 text-purple-700',
    KILL_PROCESS: 'bg-red-100 text-red-700',
    RESET_CREDENTIALS: 'bg-indigo-100 text-indigo-700',
  };

  const Panel = ({ title, accent, children, right }: { title: string, accent: string, children: React.ReactNode, right?: React.ReactNode }) => (
    <div className="bg-[var(--s0)] rounded-xl border border-[var(--b1)] shadow-sm overflow-hidden flex flex-col min-h-[220px]">
      <div className={`flex items-center justify-between px-4 py-2 border-b border-[var(--b3)] ${accent}`}>
        <p className="text-[0.62rem] font-black uppercase tracking-widest">{title}</p>
        {right}
      </div>
      <div className="p-4 flex-1 overflow-y-auto space-y-3 text-[0.78rem] text-[var(--t6)]">{children}</div>
    </div>
  );

  return (
    <div className="space-y-3">
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
      {/* Column 1 — Threat Context */}
      <Panel title="Threat Context" accent="bg-[var(--s1)] text-[var(--p1)]">
        {aiData?.summary ? (
          <div className="bg-[var(--sa)] border border-[#c8ddf7] rounded-lg px-3 py-2 text-[0.78rem] text-[var(--p1)] italic leading-snug">
            {aiData.summary}
          </div>
        ) : (
          <p className="text-[var(--t3)] italic text-[0.72rem]">No AI summary yet. Run the Alert Triage agent.</p>
        )}

        <div>
          <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">MITRE ATT&CK</p>
          {mitreTags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {mitreTags.map(t => (
                <span key={t} className="px-2 py-0.5 bg-[#1a1a2e] text-[#e94560] border border-[#e94560]/30 rounded text-[0.62rem] font-black font-mono">{t}</span>
              ))}
            </div>
          ) : <p className="text-[var(--t3)] italic text-[0.68rem]">None mapped. Run Threat Intel agent.</p>}
        </div>

        <div>
          <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">IOCs</p>
          <IocTable iocs={aiData?.iocs || {}} />
        </div>

        {correlationObj && !correlationObj.campaign_detected && (
          <div>
            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">Campaign Correlation</p>
            <div className="rounded-lg border border-[var(--b2)] bg-[var(--s1)] px-3 py-2 text-[0.72rem] text-[var(--t4)] italic">
              {correlationObj.campaign_name || 'No campaign pattern detected — isolated incident.'}
            </div>
          </div>
        )}
      </Panel>

      {/* Column 2 — MISP Enrichment */}
      <Panel
        title="Threat Intelligence"
        accent="bg-gradient-to-r from-blue-50 to-indigo-50 text-[var(--p1)]"
        right={misp?.available && misp.hits > 0 ? (
          <span className={`px-2 py-0.5 rounded-full border font-black uppercase text-[0.55rem] tracking-wider ${lvlColor[misp.highest_threat_level]}`}>{misp.highest_threat_level}</span>
        ) : misp?.available ? (
          <span className="text-[0.58rem] font-semibold text-[var(--t3)]">queried · 0 hits</span>
        ) : (
          <span className="text-[0.58rem] font-semibold text-[var(--t3)]">unavailable</span>
        )}
      >
        {misp?.available && misp.hits > 0 ? (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full bg-blue-600 text-white text-[0.6rem] font-black uppercase tracking-wider">✓ {misp.hits} MISP match{misp.hits === 1 ? '' : 'es'}</span>
              {misp.matched_iocs?.length > 0 && <span className="text-[0.62rem] text-[var(--t4)] font-mono">{misp.matched_iocs.length} IOC{misp.matched_iocs.length===1?'':'s'}</span>}
            </div>

            {misp.threat_actors?.length > 0 && (
              <div>
                <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Threat Actors</p>
                <div className="flex flex-wrap gap-1">
                  {misp.threat_actors.map((a: string) => (
                    <span key={a} className="px-2 py-0.5 rounded bg-red-100 text-red-800 text-[0.68rem] font-bold">{a}</span>
                  ))}
                </div>
              </div>
            )}

            {misp.malware_families?.length > 0 && (
              <div>
                <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Malware / Tools</p>
                <div className="flex flex-wrap gap-1">
                  {misp.malware_families.map((m: string) => (
                    <span key={m} className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-[0.68rem] font-bold">{m}</span>
                  ))}
                </div>
              </div>
            )}

            {misp.events?.length > 0 && (
              <div>
                <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Related Events</p>
                <div className="space-y-1">
                  {misp.events.slice(0, 5).map((e: any) => (
                    <div key={e.id} className="flex items-center gap-2 text-[0.7rem] bg-[var(--s1)] rounded px-2 py-1 border border-[var(--b3)]">
                      <span className="font-mono font-bold text-blue-700">#{e.id}</span>
                      <span className="flex-1 truncate text-[var(--t6)]">{e.info}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[0.56rem] font-bold border ${lvlColor[e.threat_level]}`}>{e.threat_level}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {misp.tags?.length > 0 && (
              <div>
                <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {misp.tags.map((t: string) => (
                    <span key={t} className={`px-1.5 py-0.5 rounded text-[0.58rem] font-bold font-mono ${tagColor(t)}`}>{t}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-[var(--t3)] italic text-[0.72rem]">No MISP matches for these IOCs.</p>
        )}

        {aiData?.intel && (
          <div>
            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">Analyst Summary</p>
            <div className="bg-slate-900 text-emerald-300 rounded-lg p-3 text-[0.72rem] leading-relaxed whitespace-pre-wrap font-mono">
              {aiData.intel}
            </div>
          </div>
        )}
      </Panel>

      {/* Column 3 — Response Pipeline */}
      <Panel title="Response Pipeline" accent="bg-[var(--s1)] text-[var(--p1)]">
        <div>
          <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">Playbook</p>
          {playbookSteps.length > 0 ? (
            <ol className="space-y-1">
              {playbookSteps.map((s, i) => (
                <li key={i} className="flex gap-2 items-start text-[0.74rem] leading-snug">
                  <span className="w-4 h-4 rounded-full bg-green-200 text-green-800 font-black text-[0.58rem] flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
                  <span className="text-[var(--t6)]">{s.replace(/^\d+[\.\)]\s*/, '').replace(/^[-•]\s*/, '')}</span>
                </li>
              ))}
            </ol>
          ) : <p className="text-[var(--t3)] italic text-[0.68rem]">No playbook retrieved. Run RAG Knowledge agent.</p>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest">Response Actions</p>
            {approvalRequired && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[0.56rem] font-black uppercase tracking-wider">⚠ Approval</span>}
          </div>
          {actions.length > 0 ? (
            <div className="space-y-1">
              {actions.map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 bg-[var(--s1)] rounded px-2 py-1.5 border border-[var(--b3)]">
                  <span className={`px-1.5 py-0.5 rounded text-[0.58rem] font-black uppercase tracking-wider ${actionTone[a.type] || 'bg-blue-100 text-blue-700'}`}>{(a.type || '').replace(/_/g,' ')}</span>
                  <span className="flex-1 text-[0.7rem] font-mono font-bold text-[var(--t6)] truncate">{a.target || '—'}</span>
                </div>
              ))}
              {actions[0]?.reason && <p className="text-[0.65rem] text-[var(--t4)] italic leading-snug">{actions[0].reason}</p>}
            </div>
          ) : <p className="text-[var(--t3)] italic text-[0.68rem]">No response plan. Run Response agent.</p>}
        </div>

        <div>
          <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">Validation / SLA</p>
          {(() => {
            const v = pd.validation;
            if (!v) return (
              <div className="rounded-lg border px-3 py-2 text-[0.72rem] bg-[var(--s1)] border-[var(--b2)] text-[var(--t4)] italic">
                SLA validation pending. Run Validation agent.
              </div>
            );
            const slaColor =
              v.sla_status === 'SLA_MET'      ? 'bg-green-50 border-green-300 text-green-900' :
              v.sla_status === 'SLA_AT_RISK'  ? 'bg-amber-50 border-amber-300 text-amber-900' :
              'bg-red-50 border-red-300 text-red-900';
            const recColor: Record<string,string> = {
              CLOSE:               'bg-green-100 text-green-800',
              MONITOR:             'bg-blue-100 text-blue-800',
              ESCALATE:            'bg-red-100 text-red-800',
              INVESTIGATE_FURTHER: 'bg-amber-100 text-amber-800',
            };
            return (
              <div className={`rounded-lg border px-3 py-2.5 space-y-1.5 ${slaColor}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[0.72rem] font-black uppercase tracking-wide">{v.sla_status?.replace(/_/g,' ')}</span>
                  {v.recommendation && (
                    <span className={`px-2 py-0.5 rounded text-[0.58rem] font-black uppercase tracking-wide ${recColor[v.recommendation] || 'bg-[var(--s1)] text-[var(--t6)]'}`}>
                      {v.recommendation.replace(/_/g,' ')}
                    </span>
                  )}
                </div>
                {typeof v.completeness_score === 'number' && (
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[0.6rem] font-semibold opacity-70">
                      <span>Completeness</span><span>{v.completeness_score}%</span>
                    </div>
                    <div className="h-1 w-full bg-black/10 rounded-full overflow-hidden">
                      <div className="h-full bg-current rounded-full opacity-50 transition-all duration-700" style={{ width: `${v.completeness_score}%` }} />
                    </div>
                  </div>
                )}
                {v.missing_elements?.length > 0 && (
                  <p className="text-[0.62rem] opacity-75 italic">{v.missing_elements.slice(0,2).join(' · ')}</p>
                )}
              </div>
            );
          })()}
        </div>
      </Panel>
    </div>

    {/* Full-width campaign correlation card — shown below the grid when a campaign is detected */}
    {correlationObj?.campaign_detected && (
      <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-100 border-b border-amber-200">
          <span className="text-[0.65rem] font-black uppercase tracking-widest text-amber-800">⚠ Campaign Detected</span>
          {correlationObj.kill_chain_stage && correlationObj.kill_chain_stage !== 'UNKNOWN' && (
            <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-[0.6rem] font-black uppercase border border-purple-200">{correlationObj.kill_chain_stage}</span>
          )}
          {correlationObj.escalation_needed && (
            <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-[0.6rem] font-black uppercase border border-red-200">Escalate</span>
          )}
          {typeof correlationObj.confidence === 'number' && (
            <span className="ml-auto font-mono text-[0.6rem] text-amber-700">{Math.round(correlationObj.confidence * 100)}% confidence</span>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 divide-y xl:divide-y-0 xl:divide-x divide-amber-200">
          {/* Campaign metadata */}
          <div className="px-4 py-3 space-y-1">
            <p className="font-black text-amber-900 text-[0.88rem]">{correlationObj.campaign_name}</p>
            {correlationObj.campaign_description && (
              <p className="text-[0.78rem] text-amber-800 leading-relaxed">{correlationObj.campaign_description}</p>
            )}
          </div>

          {/* Related alerts list */}
          <div className="px-4 py-3">
            {correlationObj.related_alerts?.length > 0 ? (
              <>
                <p className="text-[0.6rem] font-black text-amber-700 uppercase tracking-widest mb-2">
                  {correlationObj.related_alerts.length} Related Alert{correlationObj.related_alerts.length !== 1 ? 's' : ''}
                </p>
                <div className="space-y-1.5">
                  {correlationObj.related_alerts.map((ra: { id: string; description: string }) => (
                    <div key={ra.id} className="flex items-start gap-2.5 bg-[var(--s0)]/70 rounded-lg border border-amber-200 px-3 py-2">
                      <span className="font-mono text-[0.62rem] text-amber-700 font-black bg-amber-100 rounded px-1.5 py-0.5 select-all shrink-0 mt-0.5 whitespace-nowrap">#{ra.id.toUpperCase()}</span>
                      <p className="text-[0.74rem] text-amber-900 leading-snug">{ra.description}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[0.72rem] text-amber-700 italic">No related alerts identified in the 72-hour window.</p>
            )}
          </div>
        </div>
      </div>
    )}
    </div>
  );
};

const AlertDetail = ({ alert, onClose, onAction, returnTab, setActiveTab }: {
  alert: Alert;
  onClose: () => void;
  onAction: (id: string, update: any) => void;
  returnTab?: string;
  setActiveTab?: (t: string) => void;
}) => {
  const showToast = useToast();
  const [showReport, setShowReport] = useState(false);
  const [runningPhase, setRunningPhase] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [isRerunning, setIsRerunning] = useState(false);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ status: string; label: string; message: string; cls?: string } | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({ rawlog: true });

  const agentsRef = useRef<HTMLDivElement>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState<Record<string, boolean>>({});
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<Record<string, 'up' | 'down'>>({});

  const { user, token } = useAuth();

  const toggleSection = (key: string) =>
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));

  const handleFeedback = async (phase: string, isAccurate: boolean) => {
    if (feedbackSubmitted[phase]) return;
    const key = `${phase}-${isAccurate}`;
    setFeedbackLoading(prev => ({ ...prev, [key]: true }));
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          alert_id:    alert.id,
          phase,
          is_accurate: isAccurate,
          comment:     isAccurate ? 'Confirmed by analyst' : 'Flagged as inaccurate by analyst',
        }),
      });
      setFeedbackSubmitted(prev => ({ ...prev, [phase]: isAccurate ? 'up' : 'down' }));
      showToast(isAccurate ? 'Feedback saved — marked as accurate' : 'Feedback saved — marked as inaccurate', isAccurate ? 'success' : 'info');
    } catch (err) {
      console.error('Feedback failed:', err);
      showToast('Failed to save feedback', 'error');
    } finally {
      setFeedbackLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  // Per-agent run history: phase → array of raw phase results (newest = last)
  const [agentRunHistory, setAgentRunHistory] = useState<Record<string, any[]>>(() => {
    let d: any = null;
    try { d = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch (e) {}
    return buildInitialHistory(d);
  });
  const [agentRunIndex, setAgentRunIndex] = useState<Record<string, number>>({});

  useEffect(() => {
    setRunsLoading(true);
    getAlertRuns(alert.id).then(setRuns).catch(() => {}).finally(() => setRunsLoading(false));
  }, [alert.id]);

  // Reset per-agent history when a different alert is opened
  useEffect(() => {
    let d: any = null;
    try { d = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch (e) {}
    setAgentRunHistory(buildInitialHistory(d));
    setAgentRunIndex({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert.id]);

  let aiData: any = null;
  let mitreTags: string[] = [];
  try { aiData = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch (e) {}
  try { mitreTags = alert.mitre_attack ? JSON.parse(alert.mitre_attack as any) : []; } catch (e) {}

  const isAnalyzing = runningPhase !== null || isRerunning;

  const severity = alert.severity >= 13 ? 'CRITICAL' : alert.severity >= 10 ? 'HIGH' : alert.severity >= 7 ? 'MEDIUM' : 'LOW';
  const sevStyle: Record<string, string> = {
    CRITICAL: 'bg-red-50 text-red-700 border-red-200',
    HIGH: 'bg-orange-50 text-orange-700 border-orange-200',
    MEDIUM: 'bg-blue-50 text-blue-700 border-blue-200',
    LOW: 'bg-green-50 text-green-700 border-green-200',
  };

  const agentDefs = [
    { id: 'analysis',    label: 'Alert Triage',    icon: Search,      desc: 'Extracts IOCs and validates severity',  getContent: (d: any) => d?.analysis_summary },
    { id: 'intel',       label: 'Threat Intel',     icon: Shield,      desc: 'MITRE ATT&CK mapping & reputation',     getContent: (d: any) => d?.intel_summary },
    { id: 'knowledge',   label: 'RAG Playbook',     icon: Clock,       desc: 'Retrieves remediation playbooks',       getContent: (d: any) => d?.remediation_steps },
    { id: 'correlation', label: 'Correlation',      icon: Activity,    desc: 'Detects multi-stage campaigns',         getContent: (d: any) => d?.campaign_name },
    { id: 'ticketing',   label: 'Incident Report',  icon: FileText,    desc: 'Generates structured ticket & email',  getContent: (d: any) => d?.title },
    { id: 'response',    label: 'Response Plan',    icon: Terminal,    desc: 'Recommends containment actions',        getContent: (d: any) => d?.actions?.map((a: any) => `${a.type} → ${a.target}`).join('\n') },
    { id: 'validation',  label: 'SLA Validation',   icon: CheckCircle, desc: 'Verifies completeness & SLA',          getContent: (d: any) => d?.sla_status },
  ];

  // Returns the result currently on display for a given phase (may be historical)
  const getAgentDisplay = (phase: string) => {
    const hist = agentRunHistory[phase];
    if (!hist || hist.length === 0) return null;
    const idx = agentRunIndex[phase] ?? hist.length - 1;
    return hist[Math.min(idx, hist.length - 1)];
  };

  const navigateAgentRun = (phase: string, dir: -1 | 1) => {
    const hist = agentRunHistory[phase];
    if (!hist) return;
    const current = agentRunIndex[phase] ?? hist.length - 1;
    setAgentRunIndex(prev => ({ ...prev, [phase]: Math.max(0, Math.min(hist.length - 1, current + dir)) }));
  };

  const getAgentConfidence = (agentId: string): number | null => {
    const raw = getAgentDisplay(agentId)?.confidence;
    if (typeof raw !== 'number' || Number.isNaN(raw)) return null;
    return Math.max(0, Math.min(1, raw));
  };

  const getConfidenceStatus = (confidence: number | null) => {
    if (confidence === null) return { label: 'Unknown', cls: 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)]' };
    if (confidence >= 0.8) return { label: 'High', cls: 'bg-green-50 text-green-700 border-green-200' };
    if (confidence >= 0.6) return { label: 'Medium', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    return { label: 'Low', cls: 'bg-red-50 text-red-700 border-red-200' };
  };

  const applyAgentResult = (phase: string, result: any, base: any) => {
    const updatedAiData = {
      ...base,
      phaseData: { ...(base?.phaseData || {}) },
      agentLogs: [...(base?.agentLogs || [])],
    };
    const extra: any = {};

    if (result.agentLogs && Array.isArray(result.agentLogs)) {
      // Append logs from this phase run
      updatedAiData.agentLogs = [...updatedAiData.agentLogs, ...result.agentLogs];
    }

    if (phase === 'analysis' && result.analysis) {
      updatedAiData.phaseData.analysis = result.analysis;
      updatedAiData.summary = result.analysis.analysis_summary;
      updatedAiData.iocs = result.analysis.iocs;
      if (result.analysis.is_false_positive) extra.status = 'FALSE_POSITIVE';
    }
    if (phase === 'intel' && result.intel) {
      updatedAiData.phaseData.intel = result.intel;
      updatedAiData.intel = result.intel.intel_summary;
      extra.mitre_attack = JSON.stringify(result.intel.mitre_attack);
    }
    if (phase === 'knowledge' && result.knowledge) {
      updatedAiData.phaseData.knowledge = result.knowledge;
      extra.remediation_steps = result.knowledge.remediation_steps;
    }
    if (phase === 'correlation' && result.correlation) {
      updatedAiData.phaseData.correlation = result.correlation;
      updatedAiData.correlation = result.correlation.campaign_name;
    }
    if (phase === 'ticketing' && result.ticket) {
      updatedAiData.phaseData.ticket = result.ticket;
      updatedAiData.ticket = result.ticket;
      extra.email_sent = result.ticket.email_notification_sent ? 1 : 0;
    }
    if (phase === 'response' && result.responsePlan) {
      updatedAiData.phaseData.response = result.responsePlan;
      updatedAiData.response = result.responsePlan;
    }
    if (phase === 'validation' && result.validation) {
      updatedAiData.phaseData.validation = result.validation;
      updatedAiData.validation = result.validation.sla_status;
    }
    return { updatedAiData, extra };
  };

  const buildAgentState = (currentAiData: any, remediationSteps?: string | null) => {
    const phaseData = currentAiData?.phaseData || {};
    const fallbackAnalysis =
      currentAiData?.summary || currentAiData?.iocs
        ? {
            analysis_summary: currentAiData?.summary || '',
            iocs: currentAiData?.iocs || { ips: [], users: [], hosts: [], hashes: [], files: [], ports: [], domains: [], processes: [] },
          }
        : null;

    return {
      alert,
      recentAlerts: [],
      analysis: phaseData.analysis || fallbackAnalysis,
      intel: phaseData.intel || null,
      knowledge: phaseData.knowledge || (remediationSteps ? { remediation_steps: remediationSteps } : null),
      correlation: phaseData.correlation || null,
      ticket: phaseData.ticket || currentAiData?.ticket || null,
      responsePlan: phaseData.response || currentAiData?.response || null,
      validation: phaseData.validation || null,
    };
  };

  const getNextAlertStatus = (currentStatus: Alert['status'], override?: Alert['status']) => {
    if (override) return override;
    if (currentStatus === 'CLOSED' || currentStatus === 'ESCALATED' || currentStatus === 'FALSE_POSITIVE' || currentStatus === 'INCIDENT') {
      return currentStatus;
    }
    return 'TRIAGED';
  };

  const handleAgentRun = async (phase: string) => {
    if (isAnalyzing) return;
    setRunningPhase(phase);
    setRunError(null);
    const baseAiData = aiData || {};
    try {
      const state = buildAgentState(baseAiData, alert.remediation_steps);
      const result = await runAgentPhase(phase, state) as any;

      // Push raw phase result to per-agent history, point index to new last entry
      const rawResult = getRawPhaseResult(phase, result);
      if (rawResult) {
        const prevLen = agentRunHistory[phase]?.length || 0;
        setAgentRunHistory(prev => ({ ...prev, [phase]: [...(prev[phase] || []), rawResult] }));
        setAgentRunIndex(prev => ({ ...prev, [phase]: prevLen })); // new last index
      }

      const { updatedAiData, extra } = applyAgentResult(phase, result, baseAiData);
      onAction(alert.id, {
        ...extra,
        ai_analysis: JSON.stringify(updatedAiData),
        status: getNextAlertStatus(alert.status, extra.status),
      });
    } catch (err: any) {
      console.error('[Agent run failed]', err);
      setRunError(err?.message || `Failed to run the ${phase} agent.`);
    } finally {
      setRunningPhase(null);
    }
  };

  const handleRunAll = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isAnalyzing) return;
    setIsRerunning(true);
    setRunError(null);
    let currentAiData = aiData || {};
    let cumulativeExtra: any = {};
    let completedAny = false;
    // Track new results and their old history lengths for batched index update
    const newResults: Record<string, any> = {};
    const prevLengths: Record<string, number> = {};

    for (const agent of agentDefs) {
      if ((agentRunHistory[agent.id]?.length || 0) > 0) continue; // skip already-run
      setRunningPhase(agent.id);
      try {
        const state = buildAgentState(currentAiData, cumulativeExtra.remediation_steps || alert.remediation_steps);
        const result = await runAgentPhase(agent.id, state) as any;
        const rawResult = getRawPhaseResult(agent.id, result);
        if (rawResult) {
          prevLengths[agent.id] = agentRunHistory[agent.id]?.length || 0;
          newResults[agent.id] = rawResult;
        }
        const { updatedAiData, extra } = applyAgentResult(agent.id, result, currentAiData);
        currentAiData = updatedAiData;
        cumulativeExtra = { ...cumulativeExtra, ...extra };
        completedAny = true;
      } catch (err: any) {
        console.error(`[Agent ${agent.id} failed]`, err);
        setRunError(err?.message || `Failed to run the ${agent.label} agent.`);
        break;
      }
    }
    setRunningPhase(null);
    setIsRerunning(false);

    // Batch-update history for all agents that ran
    if (Object.keys(newResults).length > 0) {
      setAgentRunHistory(prev => {
        const updated = { ...prev };
        for (const [phase, raw] of Object.entries(newResults)) {
          updated[phase] = [...(prev[phase] || []), raw];
        }
        return updated;
      });
      setAgentRunIndex(prev => {
        const updated = { ...prev };
        for (const [phase, oldLen] of Object.entries(prevLengths)) {
          updated[phase] = oldLen; // new entry is at index oldLen
        }
        return updated;
      });
    }

    if (!completedAny && !Object.keys(cumulativeExtra).length) return;
    onAction(alert.id, {
      ...cumulativeExtra,
      ai_analysis: JSON.stringify(currentAiData),
      status: getNextAlertStatus(alert.status, cumulativeExtra.status),
    });
  };

  const handleRerunFresh = async () => {
    if (isAnalyzing || isRerunning) return;
    setIsRerunning(true);
    setRunError(null);
    try {
      await orchestrateAnalysis(alert, [], (update) => onAction(alert.id, update));
      const updated = await getAlertRuns(alert.id);
      setRuns(updated);
    } catch (err: any) {
      setRunError(err?.message || 'Rerun failed.');
    } finally {
      setIsRerunning(false);
    }
  };

  const handleSaveSnapshot = async () => {
    if (!aiData || isSavingSnapshot) return;
    setIsSavingSnapshot(true);
    try {
      await saveAlertRun(alert.id, {
        ai_analysis:       alert.ai_analysis,
        mitre_attack:      Array.isArray(alert.mitre_attack) ? JSON.stringify(alert.mitre_attack) : (alert.mitre_attack as any),
        remediation_steps: alert.remediation_steps,
        status:            alert.status,
      });
      const updated = await getAlertRuns(alert.id);
      setRuns(updated);
      setShowHistory(true);
      showToast('Snapshot saved successfully');
    } catch (err: any) {
      setRunError(err?.message || 'Failed to save snapshot.');
      showToast('Failed to save snapshot', 'error');
    } finally {
      setIsSavingSnapshot(false);
    }
  };

  const completedCount = agentDefs.filter(a => (agentRunHistory[a.id]?.length || 0) > 0).length;

  return (
    <div className="flex flex-col h-full bg-[var(--s2)] overflow-hidden">

      {/* Slim top bar — title + pipeline progress only */}
      <div className="bg-[var(--s0)] border-b border-[var(--b1)] px-5 h-11 flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={() => { onClose(); if (returnTab && setActiveTab) setActiveTab(returnTab); }}
          className="text-[0.72rem] font-semibold text-[var(--t4)] hover:text-[var(--p1)] transition-colors shrink-0"
        >
          ← Back
        </button>
        <div className="w-px h-4 bg-[var(--s2)] shrink-0" />
        <p className="text-[0.82rem] font-semibold text-[var(--t7)] truncate flex-1">{alert.description}</p>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest">Pipeline</span>
          <div className="w-28 h-1.5 bg-[var(--s1)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#004a99] rounded-full transition-all duration-700"
              style={{ width: `${(completedCount / agentDefs.length) * 100}%` }}
            />
          </div>
          <span className="text-[0.65rem] font-bold text-[var(--t4)]">{completedCount}/{agentDefs.length}</span>
        </div>
      </div>

      {/* Main scrollable content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* Alert identity + actions card */}
        <div className="bg-[var(--s0)] rounded-xl border border-[var(--b1)] px-5 py-4 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className={`px-2.5 py-0.5 rounded-full text-[0.62rem] font-black uppercase tracking-wide border ${sevStyle[severity]}`}>
                {severity}
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-[0.62rem] font-black uppercase tracking-wide border ${
                alert.status === 'TRIAGED' ? 'bg-green-50 text-green-700 border-green-200' :
                alert.status === 'ANALYZING' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                alert.status === 'FALSE_POSITIVE' ? 'bg-gray-50 text-[var(--t2)] border-gray-200' :
                'bg-[var(--s1)] text-[var(--t5)] border-[var(--b2)]'
              }`}>{alert.status}</span>
              {alert.email_sent === 1 && (
                <span className="flex items-center gap-1 text-[0.62rem] font-bold text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full uppercase">
                  <Bell size={9} fill="currentColor" /> Email Sent
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-[0.7rem] text-[var(--t4)]">
              <span className="font-mono font-bold text-[var(--t3)]">#{alert.id.substring(0, 10).toUpperCase()}</span>
              {alert.source_ip && <span>SRC: <span className="font-mono font-bold text-[var(--t6)]">{alert.source_ip}</span></span>}
              <span>Host: <span className="font-mono font-bold text-[var(--t6)]">{alert.agent_name}</span></span>
              <span>{new Date(alert.timestamp).toLocaleString()}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => setShowReport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--s1)] hover:bg-[var(--s2)] text-[var(--t6)] text-[0.72rem] font-bold transition-colors border border-[var(--b2)]"
            >
              <FileText size={13} /> Report
            </button>
            <button
              type="button"
              onClick={() => {
                setShowHistory(h => !h);
                if (!showHistory) {
                  setRunsLoading(true);
                  getAlertRuns(alert.id).then(setRuns).catch(() => {}).finally(() => setRunsLoading(false));
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.72rem] font-bold transition-colors border ${showHistory ? 'bg-[#004a99] text-white border-[var(--p1)]' : 'bg-[var(--s1)] hover:bg-[var(--s2)] text-[var(--t6)] border-[var(--b2)]'}`}
            >
              {runsLoading ? <div className="w-3 h-3 rounded-full border-2 border-current/40 border-t-current animate-spin" /> : <Clock size={13} />}
              History {runs.length > 0 ? `(${runs.length})` : ''}
            </button>
            {aiData && (
              <button
                type="button"
                onClick={handleSaveSnapshot}
                disabled={isSavingSnapshot || isAnalyzing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--s1)] hover:bg-[var(--s2)] text-[var(--t6)] text-[0.72rem] font-bold transition-colors border border-[var(--b2)] disabled:opacity-50"
              >
                {isSavingSnapshot ? <div className="w-3 h-3 rounded-full border-2 border-slate-400/40 border-t-slate-600 animate-spin" /> : <Plus size={13} />}
                Snapshot
              </button>
            )}
            <button
              type="button"
              onClick={handleRerunFresh}
              disabled={isAnalyzing}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#004a99] hover:bg-[var(--pd)] text-white text-[0.72rem] font-bold transition-colors disabled:opacity-60 shadow-sm"
            >
              {isRerunning ? (
                <><div className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" /> Running...</>
              ) : (
                <><Activity size={13} /> Run Agents</>
              )}
            </button>
          </div>
        </div>

        {runError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[0.75rem] text-red-700">
            {runError}
          </div>
        )}

        {(() => {
          const fallbackPhases: string[] = Array.isArray(aiData?.fallback_phases) ? aiData.fallback_phases : [];
          const quotaExhausted = aiData?.quota_exhausted === true;
          const allFallback = aiData && fallbackPhases.length >= 7;
          if (!quotaExhausted && !allFallback) return null;
          return (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 text-[0.78rem] text-red-800 leading-relaxed">
                <p className="font-black uppercase tracking-wider text-[0.7rem] mb-0.5">
                  {quotaExhausted ? 'LLM Daily Quota Exhausted' : 'All agents returned fallback data'}
                </p>
                <p>
                  {quotaExhausted
                    ? 'Real analysis could not run — OpenRouter\'s free-tier daily limit (50 req/day) is used up on both API keys. '
                    : `${fallbackPhases.length}/7 agents failed — the data shown below is placeholder fallback, not a real assessment. `}
                  Add credits at <span className="font-mono font-bold">openrouter.ai</span> or wait until midnight UTC for the quota to reset. Then click <span className="font-bold">Run Agents</span> again.
                </p>
              </div>
            </div>
          );
        })()}

        {/* Run History Panel */}
        {showHistory && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[0.65rem] font-black text-[var(--t3)] uppercase tracking-widest">
                Run History — {runs.length} saved run{runs.length !== 1 ? 's' : ''}
              </p>
              <button type="button" onClick={() => setShowHistory(false)} className="text-[var(--t3)] hover:text-[var(--t5)]">
                <X size={14} />
              </button>
            </div>
            {runs.length === 0 ? (
              <div className="bg-[var(--s0)] rounded-xl border border-[var(--b1)] p-6 text-center text-[0.8rem] text-[var(--t3)]">
                No saved runs yet. Use <span className="font-bold text-[var(--t5)]">Run Agents</span> to run all agents, or <span className="font-bold text-[var(--t5)]">Save Snapshot</span> to record the current state.
              </div>
            ) : (
              runs.map((run) => {
                let runAiData: any = null;
                let runMitre: string[] = [];
                try { runAiData = run.ai_analysis ? JSON.parse(run.ai_analysis) : null; } catch (e) {}
                try { runMitre = run.mitre_attack ? JSON.parse(run.mitre_attack) : []; } catch (e) {}
                const runPhaseData = runAiData?.phaseData || {};
                const agentScores = ['analysis','intel','knowledge','correlation','ticketing','response','validation'].map(p => {
                  const raw = p === 'ticketing' ? runPhaseData?.ticket?.confidence : runPhaseData?.[p]?.confidence;
                  return typeof raw === 'number' ? raw : null;
                }).filter((v): v is number => v !== null);
                const avgConf = agentScores.length ? Math.round(agentScores.reduce((a, b) => a + b, 0) / agentScores.length * 100) : null;
                const completedAgents = agentScores.length;
                const isFP = runPhaseData?.analysis?.is_false_positive;
                const isExpanded = expandedRunId === run.id;

                return (
                  <div key={run.id} className="bg-[var(--s0)] rounded-xl border border-[var(--b1)] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--s1)] transition-colors text-left"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[0.72rem] font-mono text-[var(--t4)]">
                          {new Date(run.run_at).toLocaleString()}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full border text-[0.6rem] font-black uppercase tracking-wide ${
                          run.status === 'TRIAGED' ? 'bg-green-50 text-green-700 border-green-200' :
                          run.status === 'FALSE_POSITIVE' ? 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)]' :
                          'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>{run.status || 'TRIAGED'}</span>
                        {isFP !== undefined && (
                          <span className={`px-2 py-0.5 rounded-full border text-[0.6rem] font-black uppercase tracking-wide ${isFP ? 'bg-red-50 text-red-600 border-red-200' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)]'}`}>
                            FP: {isFP ? 'YES' : 'No'}
                          </span>
                        )}
                        {avgConf !== null && (
                          <span className={`px-2 py-0.5 rounded-full border text-[0.6rem] font-black uppercase tracking-wide ${avgConf >= 80 ? 'bg-green-50 text-green-700 border-green-200' : avgConf >= 60 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                            Avg Conf: {avgConf}%
                          </span>
                        )}
                        <span className="text-[0.65rem] text-[var(--t3)]">{completedAgents}/7 agents</span>
                      </div>
                      <ChevronRight size={14} className={`text-[var(--t3)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </button>

                    {isExpanded && (
                      <div className="border-t border-[var(--b3)] px-4 py-3 space-y-3">
                        {runAiData?.summary && (
                          <div>
                            <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Analysis Summary</p>
                            <p className="text-[0.78rem] text-[var(--t6)] leading-relaxed">{runAiData.summary}</p>
                          </div>
                        )}
                        {runMitre.length > 0 && (
                          <div>
                            <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">MITRE ATT&CK</p>
                            <div className="flex flex-wrap gap-1.5">
                              {runMitre.map((tag: string) => (
                                <span key={tag} className="px-2 py-1 bg-[#1a1a2e] text-[#e94560] border border-[#e94560]/30 rounded text-[0.65rem] font-black font-mono">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest mb-2">Agent Confidence</p>
                          <div className="grid grid-cols-7 gap-1">
                            {['analysis','intel','knowledge','correlation','ticketing','response','validation'].map((p) => {
                              const raw = p === 'ticketing' ? runPhaseData?.ticket?.confidence : runPhaseData?.[p]?.confidence;
                              const pct = typeof raw === 'number' ? Math.round(raw * 100) : null;
                              return (
                                <div key={p} className="flex flex-col items-center gap-1">
                                  <div className="h-8 w-full bg-[var(--s1)] rounded-sm overflow-hidden flex flex-col-reverse">
                                    <div
                                      className={`w-full transition-all ${pct === null ? 'h-0' : pct >= 80 ? 'bg-green-400' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
                                      style={{ height: pct !== null ? `${pct}%` : '0%' }}
                                    />
                                  </div>
                                  <span className="text-[0.55rem] text-[var(--t4)] text-center leading-none">{pct !== null ? `${pct}%` : '—'}</span>
                                  <span className="text-[0.5rem] text-[var(--t3)] text-center leading-none capitalize">{p.slice(0,4)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        {run.remediation_steps && (
                          <div>
                            <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Remediation</p>
                            <p className="text-[0.75rem] text-[var(--t5)] whitespace-pre-line leading-relaxed">{run.remediation_steps}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        <EvidenceStrip aiData={aiData} mitreTags={mitreTags} />

        <AlertHeroStrip
          alert={alert}
          aiData={aiData}
          mitreTags={mitreTags}
          severity={severity}
          sevStyle={sevStyle}
          agentDefs={agentDefs}
          agentConfidence={getAgentConfidence}
          scrollToAgents={() => agentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />

        <div ref={agentsRef} className="bg-[var(--s0)] rounded-xl border border-[var(--b1)] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--b3)] bg-[var(--s1)]">
            <p className="text-[0.62rem] font-black uppercase tracking-widest text-[var(--p1)]">Agent Pipeline · click a card to expand</p>
            <span className="text-[0.6rem] font-semibold text-[var(--t3)]">{completedCount}/{agentDefs.length} completed</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 divide-x divide-slate-100">
            {agentDefs.map((agent) => {
              const isRunningThis = runningPhase === agent.id;
              const hist = agentRunHistory[agent.id] || [];
              const runCount = hist.length;
              const isDone = runCount > 0;
              const currentIdx = isDone ? (agentRunIndex[agent.id] ?? runCount - 1) : 0;
              const confidence = getAgentConfidence(agent.id);
              const pct = confidence == null ? null : Math.round(confidence * 100);
              const isViewingLatest = currentIdx === runCount - 1;
              const isExpanded = expandedAgent === agent.id;
              const bar       = pct == null ? 'bg-[var(--s2)]' : pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400';
              const isFallback= Array.isArray(aiData?.fallback_phases) && aiData.fallback_phases.includes(agent.id);

              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                  className={`p-3 text-left transition-colors relative ${
                    isExpanded ? 'bg-blue-50/50' : 'hover:bg-[var(--s1)]'
                  } ${isRunningThis ? 'bg-blue-50' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                      isRunningThis ? 'bg-[#004a99]' : isDone ? 'bg-green-600' : 'bg-[var(--s2)]'
                    }`}>
                      {isRunningThis
                        ? <div className="w-2.5 h-2.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        : <agent.icon size={12} className={isDone ? 'text-white' : 'text-[var(--t4)]'} />
                      }
                    </div>
                    <p className="text-[0.7rem] font-bold text-[var(--t7)] truncate flex-1">{agent.label}</p>
                  </div>
                  <div className="space-y-1">
                    <MiniBar value={pct ?? 0} color={bar} />
                    <div className="flex items-center justify-between text-[0.6rem] font-mono">
                      <span className={pct == null ? 'text-[var(--t3)]' : 'text-[var(--t5)] font-bold'}>{pct == null ? '— waiting' : `${pct}%`}</span>
                      {runCount > 0 && <span className={`${isViewingLatest ? 'text-green-600' : 'text-amber-600'} font-black`}>{currentIdx + 1}/{runCount}</span>}
                    </div>
                    {isFallback && <span className="text-[0.55rem] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5 font-bold uppercase tracking-wide">⚠ Unavailable</span>}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleAgentRun(agent.id); }}
                    disabled={isAnalyzing || isRerunning}
                    className={`mt-2 w-full flex items-center justify-center gap-1 text-[0.58rem] font-black px-2 py-1 rounded transition-colors disabled:opacity-50 uppercase tracking-wider ${
                      isDone ? 'bg-[var(--s1)] text-[var(--t5)] hover:bg-[var(--s2)]' : 'bg-[#004a99] text-white hover:bg-[var(--pd)]'
                    }`}
                  >
                    {isRunningThis ? 'Running' : isDone ? '↺ Rerun' : 'Run'}
                  </button>
                </button>
              );
            })}
          </div>

          {expandedAgent && (() => {
            const agent = agentDefs.find(a => a.id === expandedAgent)!;
            const hist = agentRunHistory[agent.id] || [];
            const runCount = hist.length;
            const currentIdx = runCount > 0 ? (agentRunIndex[agent.id] ?? runCount - 1) : 0;
            const displayResult = runCount > 0 ? hist[Math.min(currentIdx, runCount - 1)] : null;
            const isViewingLatest = currentIdx === runCount - 1;
            if (!displayResult) {
              return <div className="p-4 border-t border-[var(--b3)] text-[0.75rem] text-[var(--t3)] italic">No results yet for <span className="font-bold">{agent.label}</span>. Click Run on the card above.</div>;
            }
            return (
              <div className="border-t border-[var(--b3)] p-4 bg-[var(--s1)]/60 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <agent.icon size={14} className="text-[var(--p1)]" />
                    <p className="text-[0.75rem] font-black uppercase tracking-wider text-[var(--t6)]">{agent.label}</p>
                    <span className="text-[0.62rem] text-[var(--t4)]">{agent.desc}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 border-r border-[var(--b2)] pr-3 mr-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleFeedback(agent.id, true); }}
                        disabled={feedbackLoading[`${agent.id}-true`] || !!feedbackSubmitted[agent.id]}
                        className={`p-1 rounded transition-colors disabled:opacity-50 ${feedbackSubmitted[agent.id] === 'up' ? 'text-green-600 bg-green-100' : 'hover:bg-green-100 text-[var(--t3)] hover:text-green-600'}`}
                        title="Mark as accurate"
                      >
                        <ThumbsUp size={14} className={feedbackLoading[`${agent.id}-true`] ? 'animate-pulse' : ''} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleFeedback(agent.id, false); }}
                        disabled={feedbackLoading[`${agent.id}-false`] || !!feedbackSubmitted[agent.id]}
                        className={`p-1 rounded transition-colors disabled:opacity-50 ${feedbackSubmitted[agent.id] === 'down' ? 'text-red-600 bg-red-100' : 'hover:bg-red-100 text-[var(--t3)] hover:text-red-600'}`}
                        title="Mark as inaccurate"
                      >
                        <ThumbsDown size={14} className={feedbackLoading[`${agent.id}-false`] ? 'animate-pulse' : ''} />
                      </button>
                    </div>
                    {runCount > 0 && (
                      <div className="flex items-center gap-0.5 bg-[var(--s0)] border border-[var(--b2)] rounded-full px-1.5 py-0.5">
                        <button type="button" onClick={(e) => { e.stopPropagation(); navigateAgentRun(agent.id, -1); }} disabled={currentIdx <= 0} className="w-4 h-4 flex items-center justify-center text-[var(--t3)] hover:text-[var(--t6)] disabled:opacity-25">‹</button>
                        <span className={`text-[0.62rem] font-black font-mono px-0.5 ${isViewingLatest ? 'text-green-600' : 'text-amber-600'}`}>{currentIdx + 1}/{runCount}</span>
                        <button type="button" onClick={(e) => { e.stopPropagation(); navigateAgentRun(agent.id, 1); }} disabled={currentIdx >= runCount - 1} className="w-4 h-4 flex items-center justify-center text-[var(--t3)] hover:text-[var(--t6)] disabled:opacity-25">›</button>
                      </div>
                    )}
                  </div>
                </div>
                <pre className="bg-slate-950 text-emerald-300 rounded p-3 text-[0.65rem] leading-relaxed font-mono overflow-x-auto max-h-64 overflow-y-auto">{JSON.stringify(displayResult, null, 2)}</pre>
              </div>
            );
          })()}
        </div>

        <InvestigationGrid alert={alert} aiData={aiData} mitreTags={mitreTags} />

        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-lg">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-2">
              <Terminal size={12} className="text-emerald-500" />
              <p className="text-[0.6rem] font-black uppercase tracking-widest text-emerald-500/80">Agent Logs</p>
            </div>
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-full bg-red-500/20" />
              <div className="w-2 h-2 rounded-full bg-amber-500/20" />
              <div className="w-2 h-2 rounded-full bg-emerald-500/20" />
            </div>
          </div>
          <div className="p-4 h-48 overflow-y-auto font-mono text-[0.7rem] leading-relaxed space-y-1 scrollbar-thin scrollbar-thumb-emerald-500/20 scrollbar-track-transparent">
            {(aiData?.agentLogs || []).length > 0 ? (
              aiData.agentLogs.map((log: string, i: number) => (
                <div key={i} className="flex gap-3 text-emerald-400/90 animate-in fade-in slide-in-from-left-2 duration-300">
                  <span className="text-emerald-500/40 shrink-0 select-none">[{new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                  <span className="flex-1">{log}</span>
                </div>
              ))
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-[var(--t5)] italic gap-2 opacity-50">
                <Activity size={24} className={isAnalyzing ? 'animate-pulse' : ''} />
                <p>{isAnalyzing ? 'Agents are communicating...' : 'Standby — Waiting for swarm activation'}</p>
              </div>
            )}
            <div className="h-1" />
          </div>
        </div>

        <div className="bg-[var(--s0)] rounded-xl border border-[var(--b1)] overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection('rawlog')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--s1)] transition-colors text-left"
          >
            <p className="text-[0.65rem] font-black text-[var(--t3)] uppercase tracking-widest">Raw Wazuh Log</p>
            <ChevronDown size={14} className={`text-[var(--t3)] transition-transform ${collapsedSections.rawlog ? '' : 'rotate-180'}`} />
          </button>
          {!collapsedSections.rawlog && (
            <div className="px-4 pb-4">
              <pre className="text-[0.68rem] bg-slate-950 text-emerald-400 p-4 rounded-xl overflow-x-auto font-mono leading-relaxed">
                {alert.full_log || 'No log data.'}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Action footer */}
      <div className="bg-[var(--s0)] border-t border-[var(--b1)] px-6 py-3.5 flex items-center justify-between shrink-0">
        <div className="text-[0.72rem] text-[var(--t4)]">
          {aiData?.response?.actions?.length
            ? <span className="font-semibold text-[var(--t6)]">Recommended: {aiData.response.actions[0]?.type?.replace('_', ' ')} → <span className="font-mono">{aiData.response.actions[0]?.target}</span></span>
            : 'Run agents to generate recommended actions.'
          }
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirmAction({ status: 'FALSE_POSITIVE', label: 'Mark as False Positive', message: 'Mark this alert as a False Positive? This will suppress further notifications for this alert.', cls: 'bg-slate-600 hover:bg-slate-700' })}
            className="px-4 py-2 rounded-lg border border-[var(--b2)] text-[var(--t5)] font-semibold text-[0.8rem] bg-[var(--s0)] hover:bg-[var(--s1)] transition-colors"
          >
            False Positive
          </button>
          <button
            type="button"
            onClick={() => setConfirmAction({ status: 'ESCALATED', label: 'Escalate', message: 'Escalate this alert to the incident queue for immediate analyst attention?', cls: 'bg-[#004a99] hover:bg-[var(--pd)]' })}
            className="px-4 py-2 rounded-lg border border-[var(--p1)] text-[var(--p1)] font-semibold text-[0.8rem] bg-[var(--s0)] hover:bg-blue-50 transition-colors"
          >
            Escalate
          </button>
          <button
            type="button"
            onClick={() => setConfirmAction({ status: 'CLOSED', label: 'Close Incident', message: 'Close this incident? This marks the alert as resolved.', cls: 'bg-[#1e8e3e] hover:bg-green-700' })}
            className="px-4 py-2 rounded-lg bg-[#004a99] text-white font-bold text-[0.8rem] hover:bg-[var(--pd)] transition-colors shadow-sm"
          >
            Close Incident
          </button>
        </div>
      </div>

      {confirmAction && (
        <ConfirmModal
          title={confirmAction.label}
          message={confirmAction.message}
          confirmLabel={confirmAction.label}
          confirmClass={confirmAction.cls}
          onConfirm={() => {
            onAction(alert.id, { status: confirmAction.status });
            showToast(`Alert marked as ${confirmAction.status.toLowerCase().replace('_', ' ')}`);
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {showReport && (
        <DetailedReport
          alert={alert}
          aiData={aiData}
          mitreTags={mitreTags}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
};

const SkeletonVal = () => (
  <div className="h-8 w-16 bg-[var(--s2)] animate-pulse rounded mt-1" />
);

const ResearchOverview = ({ alerts, onAlertClick, setActiveTab }: { alerts: Alert[], onAlertClick: (a: Alert) => void, setActiveTab: (t: string) => void }) => {
  const { token } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [trends, setTrends] = useState<Array<{ day: string; count: number }> | null>(null);
  const [agentStats, setAgentStatsState] = useState<AgentStat[]>([]);

  useEffect(() => {
    if (!token) return;
    fetch('/api/stats', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(data => { if (!data.error) setStats(data); }).catch(() => {});
    fetch('/api/stats/trends', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(data => { if (Array.isArray(data)) setTrends(data); }).catch(() => {});
    getAgentStats().then(setAgentStatsState).catch(() => setAgentStatsState([]));
  }, [token]);

  const analyzed = alerts.filter(a => !!a.ai_analysis || ['TRIAGED','FALSE_POSITIVE','ESCALATED','CLOSED'].includes(a.status)).length;
  const falsePositives = alerts.filter(a => a.status === 'FALSE_POSITIVE' || parseAlertAi(a)?.phaseData?.analysis?.is_false_positive).length;
  const fallbackAlerts = alerts.filter(a => {
    const ai = parseAlertAi(a);
    return Array.isArray(ai?.fallback_phases) && ai.fallback_phases.length > 0;
  }).length;
  const confidenceValues = alerts.flatMap(a => getConfidenceValues(parseAlertAi(a)));
  const avgConfidence = confidenceValues.length ? Math.round(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length) : null;
  const topCritical = [...alerts]
    .filter(a => !['CLOSED','FALSE_POSITIVE'].includes(a.status))
    .sort((a, b) => (getAlertRiskScore(b) ?? b.severity * 6) - (getAlertRiskScore(a) ?? a.severity * 6))
    .slice(0, 6);
  const trendMax = trends ? Math.max(...trends.map(t => t.count), 1) : 1;

  const cards = [
    { label: 'Dataset Alerts', value: alerts.length, sub: `${analyzed} analyzed`, icon: AlertTriangle, color: '#004a99' },
    { label: 'Automation Coverage', value: `${percent(analyzed, alerts.length)}%`, sub: stats?.automationRate || 'from local alerts', icon: Activity, color: '#1e8e3e' },
    { label: 'False Positives', value: falsePositives, sub: `${percent(falsePositives, Math.max(analyzed, 1))}% of analyzed`, icon: XCircle, color: '#f29900' },
    { label: 'Avg Confidence', value: avgConfidence == null ? '—' : `${avgConfidence}%`, sub: `${confidenceValues.length} phase outputs`, icon: CheckCircle, color: '#0066cc' },
    { label: 'Fallback Runs', value: fallbackAlerts, sub: 'visible degradation marker', icon: AlertTriangle, color: '#d93025' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 overflow-y-auto h-full">
      <div className="flex items-end justify-between border-b border-[var(--b2)] pb-4">
        <div>
          <p className="text-[0.65rem] font-black uppercase tracking-widest text-[var(--t3)] mb-1">Academic Prototype</p>
          <h2 className="text-2xl font-bold text-[var(--p1)]">Multi-Agent SOC Research Overview</h2>
          <p className="text-sm text-[var(--t4)] mt-1">Wazuh alert ingestion, LangGraph orchestration, evidence generation, and analyst feedback in one evaluation surface.</p>
        </div>
        <button onClick={() => setActiveTab('alerts')} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#004a99] text-white text-[0.78rem] font-bold hover:bg-[var(--pd)] transition-colors">
          <AlertTriangle size={14} />
          Open Investigation
        </button>
      </div>

      <div className="grid grid-cols-5 gap-4">
        {cards.map(card => (
          <div key={card.label} className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-widest">{card.label}</p>
              <card.icon size={18} style={{ color: card.color }} className="opacity-50" />
            </div>
            <p className="text-[1.7rem] font-black text-[var(--t1)] mt-2 leading-none">{card.value}</p>
            <p className="text-[0.68rem] text-[var(--t4)] mt-2">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
            <p className="text-[0.82rem] font-black text-[var(--p1)] uppercase tracking-wide">7-Agent LangGraph Pipeline</p>
            <span className="text-[0.65rem] text-[var(--t3)] font-mono">linear execution · START to END</span>
          </div>
          <div className="p-5 grid grid-cols-7 gap-2">
            {AGENT_PHASES_UI.map((agent, i) => {
              const stat = agentStats.find(s => s.phase === agent.phase);
              const fallbackPct = stat && stat.total_runs > 0 ? Math.round((stat.fallback_count / stat.total_runs) * 100) : 0;
              const confidence = stat?.avg_confidence;
              return (
                <button key={agent.phase} onClick={() => setActiveTab('agents')} className="text-left group">
                  <div className={`min-h-[146px] border rounded-lg p-3 transition-colors ${fallbackPct > 20 ? 'border-amber-200 bg-amber-50/50' : 'border-[var(--b2)] bg-[var(--s0)] group-hover:bg-[var(--sa)]'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="w-6 h-6 rounded bg-[#004a99] text-white flex items-center justify-center text-[0.65rem] font-black">{i + 1}</span>
                      <span className="text-[0.58rem] text-[var(--t3)] font-mono">{stat?.total_runs || 0} runs</span>
                    </div>
                    <p className="text-[0.72rem] font-black text-[var(--t7)] leading-tight">{agent.short}</p>
                    <div className="mt-3 space-y-2">
                      <div>
                        <div className="flex justify-between text-[0.58rem] text-[var(--t3)] mb-0.5"><span>Conf</span><span>{confidence == null ? '—' : `${confidence}%`}</span></div>
                        <MiniBar value={confidence || 0} color={confidence == null ? 'bg-[var(--s2)]' : confidence >= 80 ? 'bg-green-500' : confidence >= 60 ? 'bg-amber-400' : 'bg-red-400'} />
                      </div>
                      <div>
                        <div className="flex justify-between text-[0.58rem] text-[var(--t3)] mb-0.5"><span>Fallback</span><span>{fallbackPct}%</span></div>
                        <MiniBar value={fallbackPct} color={fallbackPct > 20 ? 'bg-amber-500' : 'bg-slate-300'} />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-[var(--s1)]">
            <p className="text-[0.82rem] font-black text-[var(--p1)] uppercase tracking-wide">7-Day Alert Volume</p>
          </div>
          <div className="p-5 h-[210px]">
            {trends ? (
              <div className="flex items-end gap-2 h-full">
                {trends.map(t => (
                  <div key={t.day} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-[var(--s1)] rounded-sm overflow-hidden flex flex-col-reverse h-32">
                      <div className="w-full bg-[#004a99] rounded-sm" style={{ height: `${trendMax > 0 ? Math.round((t.count / trendMax) * 100) : 0}%`, minHeight: t.count > 0 ? 4 : 0 }} />
                    </div>
                    <span className="text-[0.6rem] text-[var(--t4)] font-mono">{t.count}</span>
                    <span className="text-[0.52rem] text-[var(--t2)]">{t.day.slice(5)}</span>
                  </div>
                ))}
              </div>
            ) : <div className="h-full flex items-center justify-center text-[var(--t3)] text-sm">Loading trend data...</div>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
            <p className="text-[0.82rem] font-black text-[var(--p1)] uppercase tracking-wide">Highest-Risk Research Samples</p>
            <button onClick={() => setActiveTab('alerts')} className="text-[0.68rem] font-bold text-[var(--p1)] hover:underline">View queue</button>
          </div>
          <div className="divide-y divide-slate-100">
            {topCritical.length ? topCritical.map(alert => {
              const ai = parseAlertAi(alert);
              const risk = getAlertRiskScore(alert);
              const fallbackCount = Array.isArray(ai?.fallback_phases) ? ai.fallback_phases.length : 0;
              return (
                <button key={alert.id} onClick={() => onAlertClick(alert)} className="w-full px-5 py-3 text-left hover:bg-[var(--s1)] flex items-center gap-4">
                  <span className={`w-2 h-8 rounded-full ${alert.severity >= 12 ? 'bg-red-500' : alert.severity >= 10 ? 'bg-orange-500' : 'bg-blue-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[0.82rem] font-bold text-[var(--t7)] truncate">{alert.description}</p>
                    <p className="text-[0.65rem] text-[var(--t3)] font-mono mt-0.5">{alert.id} · rule {alert.rule_id} · {alert.agent_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[0.72rem] font-black text-[var(--t6)]">{risk == null ? `L${alert.severity}` : `${risk}% risk`}</p>
                    <p className={`text-[0.6rem] font-bold ${fallbackCount > 0 ? 'text-amber-600' : 'text-green-600'}`}>{fallbackCount > 0 ? `${fallbackCount} fallback` : alert.status}</p>
                  </div>
                </button>
              );
            }) : <div className="p-8 text-center text-[var(--t3)] text-sm">No alerts available.</div>}
          </div>
        </div>

        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-[var(--s1)]">
            <p className="text-[0.82rem] font-black text-[var(--p1)] uppercase tracking-wide">Research Shortcuts</p>
          </div>
          <div className="p-4 grid gap-2">
            {[
              { tab: 'agents', label: 'Evaluate agent confidence and fallback behavior', icon: Activity },
              { tab: 'intelligence', label: 'Inspect MITRE, IOC, and MISP evidence', icon: BookOpen },
              { tab: 'reports', label: 'Review generated reports and run snapshots', icon: FileText },
              { tab: 'response', label: 'Audit containment and firewall controls', icon: Shield },
            ].map(item => (
              <button key={item.tab} onClick={() => setActiveTab(item.tab)} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--b2)] hover:bg-[var(--sa)] hover:border-[var(--p1)]/30 text-left transition-colors">
                <item.icon size={16} className="text-[var(--p1)] shrink-0" />
                <span className="text-[0.76rem] font-semibold text-[var(--t6)]">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const Dashboard = ({ alerts, onAlertClick }: { alerts: Alert[], onAlertClick: (a: Alert) => void }) => {
  const { token } = useAuth();
  const [stats, setStats]   = useState<Stats | null>(null);
  const [trends, setTrends] = useState<Array<{ day: string; count: number }> | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch('/api/stats',        { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(data => { if (!data.error) setStats(data); }).catch(() => {});
    fetch('/api/stats/trends', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(data => { if (Array.isArray(data)) setTrends(data); }).catch(() => {});
  }, [token]);

  const statCards = [
    { label: 'Critical Alerts',     value: alerts.filter(a => a.severity >= 12).length,                   icon: AlertTriangle, color: '#d93025', ready: true },
    { label: 'Active Incidents',    value: stats ? stats.activeIncidents : null,                           icon: Shield,        color: '#004a99', ready: !!stats },
    { label: 'Mean Time to Triage', value: stats ? stats.mttr : null,                                     icon: Clock,         color: '#1e8e3e', ready: !!stats },
    { label: 'AI Automation Rate',  value: stats ? stats.automationRate : null,                            icon: Activity,      color: '#1a73e8', ready: !!stats },
    { label: 'False Positive Rate', value: stats ? (stats as any).fpRate : null,                          icon: XCircle,       color: '#f29900', ready: !!stats },
  ];

  const swarmAgents = [
    { name: 'Alert Triage Agent',  phaseKey: 'analysis' },
    { name: 'Threat Intel Agent',  phaseKey: 'intel' },
    { name: 'RAG Knowledge Agent', phaseKey: 'knowledge' },
    { name: 'Correlation Agent',   phaseKey: 'correlation' },
    { name: 'Ticketing Agent',     phaseKey: 'ticket' },
    { name: 'Response Agent',      phaseKey: 'response' },
    { name: 'Validation Agent',    phaseKey: 'validation' },
  ];

  const getAgentStatus = (phaseKey: string) => {
    const runCount = alerts.filter(a => {
      if (!a.ai_analysis) return false;
      try { return !!(JSON.parse(a.ai_analysis)?.phaseData?.[phaseKey]); } catch { return false; }
    }).length;
    const isAnalyzing = alerts.some(a => a.status === 'ANALYZING');
    if (isAnalyzing && phaseKey === 'analysis') return { label: 'Analyzing', load: `${Math.round((runCount / Math.max(alerts.length, 1)) * 100)}%` };
    if (runCount === 0) return { label: 'Standby', load: '0%' };
    const loadPct = Math.min(95, Math.round((runCount / Math.max(alerts.length, 1)) * 100));
    return { label: 'Online', load: `${loadPct}%` };
  };

  // Trend chart max
  const trendMax = trends ? Math.max(...trends.map(t => t.count), 1) : 1;

  return (
    <div className="p-6 flex flex-col gap-6 h-full overflow-y-auto">
      <div className="grid grid-cols-5 gap-4">
        {statCards.map((stat, i) => (
          <div key={i} className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-5 flex flex-col gap-2 shadow-sm">
            <div className="flex justify-between items-start">
              <div className="text-[0.7rem] font-bold text-[var(--t2)] uppercase tracking-wider">{stat.label}</div>
              <stat.icon className="w-5 h-5 opacity-20" style={{ color: stat.color }} />
            </div>
            {stat.ready
              ? <div className="text-[1.8rem] font-bold text-[var(--t1)] leading-none">{stat.value}</div>
              : <SkeletonVal />}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-5 flex-1 min-h-0">
        {/* Trend chart */}
        {trends && (
          <div className="col-span-3 bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-4 shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <p className="text-[0.75rem] font-bold text-[var(--p1)] uppercase tracking-wider">7-Day Alert Volume</p>
              <p className="text-[0.65rem] text-[var(--t3)] font-mono">{trends.reduce((s, t) => s + t.count, 0)} total</p>
            </div>
            <div className="flex items-end gap-1.5 h-16">
              {trends.map(t => (
                <div key={t.day} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full bg-[var(--s1)] rounded-sm overflow-hidden flex flex-col-reverse" style={{ height: 48 }}>
                    <div
                      className="w-full bg-[#004a99] rounded-sm transition-all duration-700"
                      style={{ height: `${trendMax > 0 ? Math.round((t.count / trendMax) * 100) : 0}%`, minHeight: t.count > 0 ? 3 : 0 }}
                    />
                  </div>
                  <span className="text-[0.55rem] text-[var(--t3)] font-mono">{t.count}</span>
                  <span className="text-[0.5rem] text-[var(--t2)]">{t.day.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="col-span-2 bg-[var(--s0)] border border-[var(--b1)] rounded-lg flex flex-col overflow-hidden shadow-sm">
          <div className="p-4 border-b border-[var(--b1)] flex justify-between items-center bg-[var(--s1)]/50">
            <h3 className="text-[0.9rem] font-bold text-[var(--p1)] flex items-center gap-2">
              <Activity className="w-4 h-4" />
              LIVE ALERT STREAM (WAZUH)
            </h3>
            <span className="text-[0.7rem] text-[var(--t2)] font-mono">REFRESH: 5S</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {alerts.length > 0 ? (
              [...alerts].sort((a, b) => new Date(b.timestamp.replace(' ', 'T')).getTime() - new Date(a.timestamp.replace(' ', 'T')).getTime()).slice(0, 10).map(alert => (
                <AlertRow key={alert.id} alert={alert} onClick={() => onAlertClick(alert)} />
              ))
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-[var(--t3)] gap-3 opacity-50">
                <Activity className="w-12 h-12 animate-pulse" />
                <p className="text-sm font-medium">Waiting for incoming alerts...</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg flex flex-col shadow-sm overflow-hidden">
          <div className="p-4 border-b border-[var(--b1)] bg-[var(--s1)]/50">
            <h3 className="text-[0.9rem] font-bold text-[var(--p1)]">AI AGENT STATUS</h3>
          </div>
          <div className="p-4 flex flex-col gap-3 flex-1 overflow-y-auto">
            {swarmAgents.map((agent) => {
              const agentStatus = getAgentStatus(agent.phaseKey);
              const loadNum = parseInt(agentStatus.load);
              return (
                <div key={agent.phaseKey} className="flex flex-col gap-1">
                  <div className="flex justify-between text-[0.72rem]">
                    <span className="font-semibold text-[var(--t1)] truncate">{agent.name}</span>
                    <span className={
                      agentStatus.label === 'Online' ? 'text-[#1e8e3e]' :
                      agentStatus.label === 'Analyzing' ? 'text-[#1a73e8]' :
                      'text-[var(--t2)]'
                    }>{agentStatus.label}</span>
                  </div>
                  <div className="h-1.5 w-full bg-[#f0f0f0] rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-1000 ${loadNum > 80 ? 'bg-[#d93025]' : 'bg-[#004a99]'}`}
                      style={{ width: agentStatus.load }}
                    />
                  </div>
                </div>
              );
            })}

            <div className="mt-2 p-3 bg-[var(--sa)] rounded-lg border border-[var(--b1)]">
              <div className="text-[0.8rem] font-bold text-[var(--p1)] mb-1">System Health</div>
              <div className="text-[0.7rem] text-[var(--t2)] leading-relaxed">
                {swarmAgents.filter(a => getAgentStatus(a.phaseKey).label !== 'Standby').length}/{swarmAgents.length} agents have processed alerts. Model assignments are configurable below.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const AlertsTab = ({ alerts, selectedAlert, setSelectedAlert, onAlertAction, setActiveTab }: {
  alerts: Alert[];
  selectedAlert: Alert | null;
  setSelectedAlert: (a: Alert | null) => void;
  onAlertAction: (id: string, update: any) => void;
  setActiveTab: (t: string) => void;
}) => {
  const [filterOpen, setFilterOpen]     = useState(false);
  const [filterSeverity, setFilterSev]  = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [searchQuery, setSearchQuery]   = useState('');
  const [filteredAlerts, setFiltered]   = useState<Alert[]>(alerts);

  useEffect(() => {
    let result = alerts;
    if (filterSeverity) {
      const ranges: Record<string, [number, number]> = {
        CRITICAL: [13, 999], HIGH: [10, 12], MEDIUM: [7, 9], LOW: [0, 6],
      };
      const [lo, hi] = ranges[filterSeverity] || [0, 999];
      result = result.filter(a => a.severity >= lo && a.severity <= hi);
    }
    if (filterStatus) {
      result = result.filter(a => a.status === filterStatus);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(a =>
        a.description?.toLowerCase().includes(q) ||
        a.source_ip?.includes(q) ||
        a.agent_name?.toLowerCase().includes(q) ||
        a.rule_id?.includes(q) ||
        a.id?.toLowerCase().includes(q)
      );
    }
    const ts = (t: string) => new Date(t.replace(' ', 'T')).getTime();
    result = [...result].sort((a, b) => ts(b.timestamp) - ts(a.timestamp));
    setFiltered(result);
  }, [alerts, filterSeverity, filterStatus, searchQuery]);

  const hasFilters = !!filterSeverity || !!filterStatus;
  const clearFilters = () => { setFilterSev(''); setFilterStatus(''); };

  const handleBulkAIClean = () => {
    const fps = alerts.filter(a => {
      if (a.status === 'FALSE_POSITIVE' || a.status === 'CLOSED') return false;
      let aiData: any = null;
      try { aiData = JSON.parse(a.ai_analysis || ''); } catch(e) {}
      return aiData?.phaseData?.analysis?.is_false_positive;
    });
    fps.forEach(a => onAlertAction(a.id, { status: 'FALSE_POSITIVE' }));
  };

  const highRiskCount = alerts.filter(a => {
    if (a.status === 'CLOSED' || a.status === 'FALSE_POSITIVE') return false;
    let aiData: any = null;
    try { aiData = JSON.parse(a.ai_analysis || ''); } catch(e) {}
    const risk = aiData?.phaseData?.analysis?.risk_score;
    return risk && risk >= 80;
  }).length;

  const totalAutoTriagedFP = alerts.filter(a => {
    let aiData: any = null;
    try { aiData = JSON.parse(a.ai_analysis || ''); } catch(e) {}
    return aiData?.phaseData?.analysis?.is_false_positive;
  }).length;
  
  const activeCount = alerts.filter(a => a.status === 'ANALYZING').length;

  return (
    <div className="flex flex-col h-full bg-[var(--s2)]">
      {/* Analyst HUD */}
      <div className="bg-[var(--s0)] border-b border-[var(--b1)] px-6 pt-2 pb-3 shrink-0 shadow-sm z-10 relative">
        <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest mb-2">Queue Intelligence</p>
      <div className="flex gap-6">
        <div className="flex-1 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 flex items-center justify-between">
          <div>
            <p className="text-[0.65rem] font-black text-green-700 uppercase tracking-widest mb-0.5">Noise Reduction</p>
            <p className="text-[0.8rem] font-bold text-green-900">AI identified {totalAutoTriagedFP} False Positives</p>
          </div>
          <button onClick={handleBulkAIClean} className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-[0.7rem] font-bold transition-colors shadow-sm">
            Clean All ({totalAutoTriagedFP})
          </button>
        </div>
        <div className="flex-1 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 flex flex-col justify-center">
          <p className="text-[0.65rem] font-black text-red-700 uppercase tracking-widest mb-0.5">High-Priority Focus</p>
          <p className="text-[0.8rem] font-bold text-red-900">{highRiskCount} Alerts require immediate containment</p>
        </div>
        <div className="flex-1 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 flex flex-col justify-center">
          <p className="text-[0.65rem] font-black text-blue-700 uppercase tracking-widest mb-0.5">Agent Status</p>
          <p className="text-[0.8rem] font-bold text-blue-900">{activeCount > 0 ? `Agents processing ${activeCount} alerts` : 'Agents standing by'}</p>
        </div>
      </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <section className="w-[340px] border-r border-[var(--b1)] bg-[var(--s0)] flex flex-col overflow-hidden shrink-0 shadow-sm z-0">
          <div className="p-3 border-b border-[var(--b1)] bg-[var(--s1)] flex flex-col gap-2">
            <div className="flex justify-between items-center relative">
              <span className="font-bold text-[0.8rem] text-[var(--p1)]">ALERT QUEUE ({filteredAlerts.length})</span>
              <button
                onClick={() => setFilterOpen(!filterOpen)}
                className={`flex items-center gap-1 text-[0.65rem] font-black uppercase tracking-wider px-2 py-1 rounded transition-colors ${
                  hasFilters ? 'bg-[#004a99] text-white' : 'text-[var(--p1)] hover:bg-[var(--sa)]'
                }`}
              >
                <Filter className="w-3 h-3" />
                {hasFilters ? 'Filtered ●' : 'Filter'}
              </button>

              {filterOpen && (
                <div className="absolute top-full right-0 mt-1 z-20 w-56 bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-xl p-4 space-y-3">
                  <div>
                    <label className="text-[0.6rem] font-black text-[var(--t2)] uppercase tracking-wider block mb-1">Severity</label>
                    <select
                      value={filterSeverity}
                      onChange={e => setFilterSev(e.target.value)}
                      className="w-full text-[0.8rem] border border-[var(--b1)] rounded px-2 py-1.5 outline-none focus:border-[var(--p1)]"
                    >
                      <option value="">All</option>
                      <option value="CRITICAL">Critical (13+)</option>
                      <option value="HIGH">High (10-12)</option>
                      <option value="MEDIUM">Medium (7-9)</option>
                      <option value="LOW">Low (&lt;7)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[0.6rem] font-black text-[var(--t2)] uppercase tracking-wider block mb-1">Status</label>
                    <select
                      value={filterStatus}
                      onChange={e => setFilterStatus(e.target.value)}
                      className="w-full text-[0.8rem] border border-[var(--b1)] rounded px-2 py-1.5 outline-none focus:border-[var(--p1)]"
                    >
                      <option value="">All</option>
                      {['NEW','ANALYZING','TRIAGED','FALSE_POSITIVE','ESCALATED','CLOSED'].map(s => (
                        <option key={s} value={s}>{s.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </div>
                  {hasFilters && (
                    <button
                      onClick={clearFilters}
                      className="w-full text-[0.7rem] font-bold text-[#d93025] hover:bg-red-50 py-1.5 rounded transition-colors uppercase tracking-wider"
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--t3)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search alerts, IPs, rules..."
                className="w-full bg-[var(--s0)] border border-[var(--b2)] rounded px-8 py-1.5 text-[0.75rem] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredAlerts.length > 0 ? (
              filteredAlerts.map(alert => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  onClick={() => setSelectedAlert(alert)}
                  isSelected={selectedAlert?.id === alert.id}
                />
              ))
            ) : (
              <div className="p-10 text-center text-[var(--t3)] text-sm">No alerts match the current filters.</div>
            )}
          </div>
        </section>
        <section className="flex-1 overflow-hidden">
          {selectedAlert ? (
            <AlertDetail
              alert={selectedAlert}
              onClose={() => setSelectedAlert(null)}
              onAction={onAlertAction}
              returnTab="alerts"
              setActiveTab={setActiveTab}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-[var(--t3)] flex-col gap-4">
              <Shield className="w-16 h-16 opacity-10" />
              <p className="font-semibold text-sm">Select an alert from the queue to start investigation</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

const MitreIntelligence = ({ alerts, onAlertClick }: { alerts: Alert[], onAlertClick: (a: Alert) => void }) => {
  const mitreCounts: Record<string, { count: number; alerts: Alert[] }> = {};
  const iocRows: Array<{ type: string; value: string; alert: Alert; confidence: number | null; threat: string }> = [];
  const mispRows: Array<{ alert: Alert; level: string; hits: number; actors: string[]; families: string[]; events: any[] }> = [];

  alerts.forEach(alert => {
    const ai = parseAlertAi(alert);
    parseMitreTags(alert).forEach(tag => {
      if (!mitreCounts[tag]) mitreCounts[tag] = { count: 0, alerts: [] };
      mitreCounts[tag].count += 1;
      mitreCounts[tag].alerts.push(alert);
    });

    const iocs = ai?.iocs || ai?.phaseData?.analysis?.iocs || {};
    ['ips','users','hosts','domains','hashes','files','processes'].forEach(type => {
      const values = Array.isArray(iocs[type]) ? iocs[type] : [];
      values.forEach((value: string) => {
        if (!value) return;
        iocRows.push({
          type,
          value: String(value),
          alert,
          confidence: getConfidenceValues(ai)[0] ?? null,
          threat: ai?.phaseData?.intel?.campaign_family || ai?.phaseData?.analysis?.attack_category || 'Unattributed',
        });
      });
    });

    const misp = ai?.phaseData?.intel?.misp;
    if (misp) {
      const events = Array.isArray(misp.events) ? misp.events : [];
      const actors = Array.isArray(misp.threat_actors) ? misp.threat_actors : [];
      const families = Array.isArray(misp.malware_families) ? misp.malware_families : [];
      const hits = typeof misp.hit_count === 'number' ? misp.hit_count : events.length;
      if (hits > 0 || actors.length > 0 || families.length > 0) {
        mispRows.push({ alert, level: misp.threat_level || 'Undefined', hits, actors, families, events });
      }
    }
  });

  const topMitre = Object.entries(mitreCounts).sort(([, a], [, b]) => b.count - a.count).slice(0, 12);
  const uniqueIocs = new Map<string, typeof iocRows[number]>();
  iocRows.forEach(row => {
    const key = `${row.type}:${row.value}`;
    if (!uniqueIocs.has(key)) uniqueIocs.set(key, row);
  });
  const iocs = Array.from(uniqueIocs.values()).slice(0, 80);
  const maxMitre = Math.max(...topMitre.map(([, v]) => v.count), 1);
  const typeTone: Record<string, string> = {
    ips: 'bg-red-50 text-red-700 border-red-200',
    users: 'bg-blue-50 text-blue-700 border-blue-200',
    hosts: 'bg-green-50 text-green-700 border-green-200',
    domains: 'bg-purple-50 text-purple-700 border-purple-200',
    hashes: 'bg-[var(--s1)] text-[var(--t6)] border-[var(--b2)]',
    files: 'bg-amber-50 text-amber-700 border-amber-200',
    processes: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 overflow-y-auto h-full">
      <div className="flex items-end justify-between border-b border-[var(--b2)] pb-4">
        <div>
          <p className="text-[0.65rem] font-black uppercase tracking-widest text-[var(--t3)] mb-1">Evidence Map</p>
          <h2 className="text-2xl font-bold text-[var(--p1)]">MITRE & Threat Intelligence</h2>
          <p className="text-sm text-[var(--t4)] mt-1">A research view of techniques, indicators, MISP enrichment, and the alerts that produced them.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-right">
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg px-4 py-2">
            <p className="text-[0.58rem] font-black uppercase text-[var(--t3)]">Techniques</p>
            <p className="text-lg font-black text-[var(--p1)]">{topMitre.length}</p>
          </div>
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg px-4 py-2">
            <p className="text-[0.58rem] font-black uppercase text-[var(--t3)]">Unique IOCs</p>
            <p className="text-lg font-black text-[var(--p1)]">{uniqueIocs.size}</p>
          </div>
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg px-4 py-2">
            <p className="text-[0.58rem] font-black uppercase text-[var(--t3)]">MISP Hits</p>
            <p className="text-lg font-black text-[var(--p1)]">{mispRows.reduce((a, b) => a + b.hits, 0)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-5">
        <div className="col-span-2 bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-[var(--s1)]">
            <p className="text-[0.82rem] font-black text-[var(--p1)] uppercase tracking-wide">Top MITRE Techniques</p>
          </div>
          <div className="p-5 space-y-3">
            {topMitre.length ? topMitre.map(([tech, data]) => (
              <button key={tech} onClick={() => onAlertClick(data.alerts[0])} className="w-full text-left group">
                <div className="flex items-center gap-3">
                  <span className="w-20 font-mono text-[0.78rem] font-black text-[var(--p1)]">{tech}</span>
                  <div className="flex-1 h-2 bg-[var(--s1)] rounded-full overflow-hidden">
                    <div className="h-full bg-[#004a99] group-hover:bg-[#0066cc]" style={{ width: `${Math.max(8, (data.count / maxMitre) * 100)}%` }} />
                  </div>
                  <span className="w-16 text-right text-[0.68rem] font-bold text-[var(--t4)]">{data.count} alerts</span>
                </div>
              </button>
            )) : <div className="p-8 text-center text-[var(--t3)] text-sm">Run agents to generate MITRE mappings.</div>}
          </div>
        </div>

        <div className="col-span-3 bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
            <p className="text-[0.82rem] font-black text-[var(--p1)] uppercase tracking-wide">IOC Inventory</p>
            <span className="text-[0.65rem] text-[var(--t3)]">first 80 unique indicators</span>
          </div>
          {iocs.length ? (
            <div className="max-h-[360px] overflow-y-auto">
              <table className="w-full text-left text-[0.76rem]">
                <thead className="sticky top-0 bg-[var(--s1)] border-b border-[var(--b3)] text-[0.6rem] text-[var(--t3)] uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Indicator</th>
                    <th className="px-4 py-2">Threat Context</th>
                    <th className="px-4 py-2">Alert</th>
                    <th className="px-4 py-2">Conf</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {iocs.map(row => (
                    <tr key={`${row.type}:${row.value}`} className="hover:bg-[var(--s1)]">
                      <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded border text-[0.6rem] font-black uppercase ${typeTone[row.type] || 'bg-[var(--s1)] text-[var(--t5)] border-[var(--b2)]'}`}>{row.type}</span></td>
                      <td className="px-4 py-2 font-mono text-[var(--t7)] max-w-[220px] truncate" title={row.value}>{row.value}</td>
                      <td className="px-4 py-2 text-[var(--t5)] max-w-[180px] truncate">{row.threat}</td>
                      <td className="px-4 py-2"><button onClick={() => onAlertClick(row.alert)} className="font-mono text-[var(--p1)] hover:underline">{row.alert.id.substring(0, 8).toUpperCase()}</button></td>
                      <td className="px-4 py-2 text-[var(--t4)]">{row.confidence == null ? '—' : `${row.confidence}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="p-10 text-center text-[var(--t3)] text-sm">No extracted IOCs yet.</div>}
        </div>
      </div>

      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b bg-[var(--s1)]">
          <p className="text-[0.82rem] font-black text-[var(--p1)] uppercase tracking-wide">MISP Enrichment Evidence</p>
        </div>
        {mispRows.length ? (
          <div className="divide-y divide-slate-100">
            {mispRows.slice(0, 20).map(row => (
              <button key={row.alert.id} onClick={() => onAlertClick(row.alert)} className="w-full px-5 py-3 text-left hover:bg-[var(--s1)] flex items-center gap-4">
                <span className={`px-2 py-0.5 rounded text-[0.62rem] font-black uppercase ${
                  row.level === 'High' ? 'bg-red-100 text-red-800' :
                  row.level === 'Medium' ? 'bg-orange-100 text-orange-800' :
                  row.level === 'Low' ? 'bg-amber-100 text-amber-800' :
                  'bg-[var(--s1)] text-[var(--t5)]'
                }`}>{row.level}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[0.82rem] font-bold text-[var(--t7)] truncate">{row.alert.description}</p>
                  <p className="text-[0.68rem] text-[var(--t4)] truncate">
                    {row.hits} hits · {[...row.actors, ...row.families].filter(Boolean).join(' · ') || 'No actor or family label'}
                  </p>
                </div>
                <span className="font-mono text-[0.65rem] text-[var(--p1)]">{row.alert.id.substring(0, 8).toUpperCase()}</span>
              </button>
            ))}
          </div>
        ) : <div className="p-10 text-center text-[var(--t3)] text-sm">No MISP hits found in analyzed alerts.</div>}
      </div>
    </div>
  );
};

const ActionsTab = () => {
  const showToast = useToast();
  const { user }  = useAuth();
  const isAdmin   = user?.role === 'ADMIN';

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [actionLogs,   setActionLogs]   = useState<ActionLog[]>([]);
  const [actionStats,  setActionStats]  = useState<any>(null);
  const [testing,      setTesting]      = useState<Record<string, boolean>>({});
  const [saving,       setSaving]       = useState<Record<string, boolean>>({});
  const [expandedCfg,  setExpandedCfg]  = useState<string | null>(null);
  const [localCfg,     setLocalCfg]     = useState<Record<string, Record<string, string>>>({});

  const refresh = useCallback(async () => {
    const [ints, logs, stats] = await Promise.all([
      getIntegrations(),
      getActionLogs({ limit: 50 }),
      fetch('/api/action-stats', { headers: { 'Authorization': `Bearer ${localStorage.getItem('soc_token')}` } }).then(r => r.json()).catch(() => null),
    ]);
    setIntegrations(ints as Integration[]);
    setActionLogs(logs as ActionLog[]);
    setActionStats(stats);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleToggle = async (name: string, enabled: boolean) => {
    if (!isAdmin) return;
    setSaving(prev => ({ ...prev, [name]: true }));
    try {
      await updateIntegration(name, { enabled });
      showToast(`${name} ${enabled ? 'enabled' : 'disabled'}`);
      refresh();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSaving(prev => ({ ...prev, [name]: false }));
    }
  };

  const handleThresholdChange = async (name: string, threshold: string) => {
    if (!isAdmin) return;
    await updateIntegration(name, { auto_send_threshold: threshold });
    refresh();
  };

  const handleSaveConfig = async (name: string) => {
    if (!isAdmin) return;
    setSaving(prev => ({ ...prev, [`cfg_${name}`]: true }));
    try {
      await updateIntegration(name, { config: localCfg[name] || {} });
      showToast(`${name} configuration saved`);
      setExpandedCfg(null);
      refresh();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSaving(prev => ({ ...prev, [`cfg_${name}`]: false }));
    }
  };

  const handleTest = async (name: string) => {
    setTesting(prev => ({ ...prev, [name]: true }));
    try {
      const result = await testIntegration(name);
      showToast(result.ok ? `${name} test successful!` : `${name} test failed: ${result.error}`, result.ok ? 'success' : 'error');
      refresh();
    } finally {
      setTesting(prev => ({ ...prev, [name]: false }));
    }
  };

  const INTG_META: Record<string, { icon: React.ReactNode; label: string; color: string; fields: Array<{ key: string; label: string; placeholder: string; secret?: boolean }> }> = {
    email: {
      icon:  <Mail size={20} />,
      label: 'Email (SMTP)',
      color: 'text-blue-700 bg-blue-50 border-blue-200',
      fields: [
        { key: 'to', label: 'Recipient address', placeholder: 'soc-team@company.com' },
      ],
    },
    glpi: {
      icon:  <ExternalLink size={20} />,
      label: 'GLPI Ticketing',
      color: 'text-purple-700 bg-purple-50 border-purple-200',
      fields: [
        { key: 'url',        label: 'GLPI URL',       placeholder: 'https://glpi.company.com' },
        { key: 'app_token',  label: 'App Token',      placeholder: 'App-Token-here', secret: true },
        { key: 'user_token', label: 'User Token',     placeholder: 'user_token_here', secret: true },
      ],
    },
    telegram: {
      icon:  <Send size={20} />,
      label: 'Telegram',
      color: 'text-cyan-700 bg-cyan-50 border-cyan-200',
      fields: [
        { key: 'bot_token', label: 'Bot Token',  placeholder: '123456:ABCdef...', secret: true },
        { key: 'chat_id',   label: 'Chat ID',    placeholder: '-1001234567890' },
      ],
    },
  };

  const priColor: Record<string, string> = {
    CRITICAL: 'bg-red-100 text-red-800 border-red-200',
    HIGH:     'bg-orange-100 text-orange-800 border-orange-200',
    MEDIUM:   'bg-blue-100 text-blue-800 border-blue-200',
    LOW:      'bg-green-100 text-green-800 border-green-200',
    NEVER:    'bg-[var(--s1)] text-[var(--t5)] border-[var(--b2)]',
  };

  const statusIcon: Record<string, string> = { success: '✓', failed: '✕', skipped: '↷' };
  const statusColor: Record<string, string> = {
    success: 'text-green-700 bg-green-50',
    failed:  'text-red-700 bg-red-50',
    skipped: 'text-[var(--t4)] bg-[var(--s1)]',
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[var(--p1)]">Notification Integrations</h2>
          <p className="text-sm text-[var(--t4)] mt-0.5">Connect agent-generated evidence to Email, GLPI, and Telegram dispatch paths.</p>
        </div>
        <button onClick={refresh} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--b2)] text-[var(--t5)] text-[0.78rem] font-semibold hover:bg-[var(--s1)] transition-colors">
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      {/* Stats strip */}
      {actionStats && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total Actions',  value: actionStats.total,        color: 'text-[var(--p1)]' },
            { label: 'Today',          value: actionStats.today,        color: 'text-[var(--p1)]' },
            { label: 'Success Rate',   value: `${actionStats.success_rate}%`, color: actionStats.success_rate >= 80 ? 'text-[#1e8e3e]' : 'text-[#d93025]' },
            { label: 'Integrations',   value: `${integrations.filter(i => i.enabled).length} / ${integrations.length} active`, color: 'text-[var(--p1)]' },
          ].map((s, i) => (
            <div key={i} className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-4 shadow-sm">
              <p className="text-[0.65rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">{s.label}</p>
              <p className={`text-[1.6rem] font-black ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Integration cards */}
      <div className="grid grid-cols-3 gap-4">
        {integrations.map(intg => {
          const meta      = INTG_META[intg.name];
          if (!meta) return null;
          const isExpanded = expandedCfg === intg.name;
          const s24        = intg.stats_24h || { total: 0, success: 0, failed: 0 };
          const cfgValues  = localCfg[intg.name] ?? intg.config ?? {};

          return (
            <div key={intg.name} className={`bg-[var(--s0)] border rounded-xl shadow-sm overflow-hidden transition-all ${intg.enabled ? 'border-[var(--p1)]/30' : 'border-[var(--b1)]'}`}>
              {/* Card header */}
              <div className={`flex items-center justify-between px-4 py-3 border-b ${intg.enabled ? 'bg-[var(--sa)]' : 'bg-[var(--s1)]'}`}>
                <div className="flex items-center gap-2">
                  <span className={`p-1.5 rounded-lg border ${meta.color}`}>{meta.icon}</span>
                  <div>
                    <p className="text-[0.82rem] font-black text-[var(--t7)]">{meta.label}</p>
                    <span className={`text-[0.58rem] font-black uppercase tracking-wider ${intg.enabled ? 'text-[#1e8e3e]' : 'text-[var(--t3)]'}`}>
                      {intg.enabled ? '● ACTIVE' : '○ DISABLED'}
                    </span>
                  </div>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => handleToggle(intg.name, !intg.enabled)}
                    disabled={saving[intg.name]}
                    className="text-[var(--t3)] hover:text-[var(--p1)] transition-colors disabled:opacity-50"
                    title={intg.enabled ? 'Disable' : 'Enable'}
                  >
                    {intg.enabled
                      ? <ToggleRight size={28} className="text-[var(--p1)]" />
                      : <ToggleLeft  size={28} />}
                  </button>
                )}
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-[var(--b3)]">
                {[
                  { label: '24h sent',  value: s24.total },
                  { label: 'success',   value: s24.success },
                  { label: 'failed',    value: s24.failed },
                ].map((m, i) => (
                  <div key={i} className="py-2 text-center">
                    <p className={`text-[1rem] font-black ${i === 2 && m.value > 0 ? 'text-red-600' : 'text-[var(--t6)]'}`}>{m.value}</p>
                    <p className="text-[0.58rem] text-[var(--t3)] uppercase tracking-wider">{m.label}</p>
                  </div>
                ))}
              </div>

              {/* Auto-fire setting */}
              <div className="px-4 py-3 flex items-center justify-between border-b border-[var(--b3)]">
                <p className="text-[0.7rem] font-bold text-[var(--t4)] uppercase tracking-wider">Auto-fire on</p>
                <select
                  value={intg.auto_send_threshold}
                  disabled={!isAdmin}
                  onChange={e => handleThresholdChange(intg.name, e.target.value)}
                  className={`text-[0.7rem] font-bold border rounded px-2 py-1 outline-none ${priColor[intg.auto_send_threshold] || priColor.NEVER} disabled:opacity-60`}
                >
                  {['CRITICAL','HIGH','NEVER'].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

              {/* Config section */}
              {isAdmin && (
                <div className="px-4 py-2 border-b border-[var(--b3)]">
                  <button
                    onClick={() => {
                      setExpandedCfg(isExpanded ? null : intg.name);
                      if (!localCfg[intg.name]) setLocalCfg(prev => ({ ...prev, [intg.name]: { ...intg.config } }));
                    }}
                    className="flex items-center gap-1 text-[0.7rem] font-bold text-[var(--p1)] hover:underline"
                  >
                    <ChevronDown size={12} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    Configure
                  </button>
                  {isExpanded && (
                    <div className="mt-2 space-y-2">
                      {meta.fields.map(f => (
                        <div key={f.key}>
                          <label className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-wider block mb-0.5">{f.label}</label>
                          <input
                            type={f.secret ? 'password' : 'text'}
                            value={cfgValues[f.key] || ''}
                            onChange={e => setLocalCfg(prev => ({ ...prev, [intg.name]: { ...(prev[intg.name] || {}), [f.key]: e.target.value } }))}
                            placeholder={f.placeholder}
                            className="w-full border border-[var(--b2)] rounded px-2 py-1.5 text-[0.75rem] outline-none focus:border-[var(--p1)] font-mono"
                          />
                        </div>
                      ))}
                      <button
                        onClick={() => handleSaveConfig(intg.name)}
                        disabled={saving[`cfg_${intg.name}`]}
                        className="w-full mt-1 py-1.5 rounded bg-[#004a99] text-white text-[0.72rem] font-bold hover:bg-[var(--pd)] transition-colors disabled:opacity-50"
                      >
                        {saving[`cfg_${intg.name}`] ? 'Saving…' : 'Save Configuration'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Test button */}
              <div className="px-4 py-3">
                <button
                  onClick={() => handleTest(intg.name)}
                  disabled={testing[intg.name] || !isAdmin}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-[var(--p1)] text-[var(--p1)] text-[0.72rem] font-bold hover:bg-[var(--sa)] transition-colors disabled:opacity-50"
                >
                  {testing[intg.name]
                    ? <><div className="w-3 h-3 rounded-full border-2 border-[var(--p1)]/40 border-t-[#004a99] animate-spin" />Testing…</>
                    : <><Send size={12} />Send Test</>}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action log table */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
          <p className="text-[0.82rem] font-black text-[var(--p1)] uppercase tracking-wide">Action Log</p>
          <p className="text-[0.65rem] text-[var(--t3)]">Last 50 dispatches</p>
        </div>
        {actionLogs.length === 0 ? (
          <div className="p-10 text-center text-[var(--t3)] text-sm">No actions dispatched yet. Enable an integration and run agents on a HIGH or CRITICAL alert.</div>
        ) : (
          <table className="w-full text-left text-[0.78rem]">
            <thead className="bg-[var(--s1)]/50 border-b border-[var(--b3)] text-[0.65rem] text-[var(--t3)] font-black uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2">Time</th>
                <th className="px-4 py-2">Integration</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Payload</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {actionLogs.map((log: any) => (
                <tr key={log.id} className="hover:bg-[var(--s1)] transition-colors">
                  <td className="px-4 py-2 font-mono text-[var(--t4)] text-[0.7rem] whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded text-[0.65rem] font-black uppercase tracking-wide ${
                      log.integration === 'email'    ? 'bg-blue-100 text-blue-800' :
                      log.integration === 'telegram' ? 'bg-cyan-100 text-cyan-800' :
                      'bg-purple-100 text-purple-800'
                    }`}>{log.integration}</span>
                  </td>
                  <td className="px-4 py-2 text-[var(--t5)] font-mono text-[0.68rem]">{log.action}</td>
                  <td className="px-4 py-2 text-[var(--t6)] truncate max-w-[200px]" title={log.payload}>{log.payload || '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded text-[0.65rem] font-black ${statusColor[log.status] || 'bg-[var(--s1)] text-[var(--t4)]'}`}>
                      {statusIcon[log.status] || '?'} {log.status}
                    </span>
                    {log.error && <p className="text-[0.62rem] text-red-500 mt-0.5 truncate max-w-[150px]" title={log.error}>{log.error}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
};

// ─── Firewall Section (embedded in ActionsTab) ────────────────────────────────
const FirewallSection = () => {
  const showToast = useToast();
  const { user }  = useAuth();
  const isAdmin   = user?.role === 'ADMIN';

  const [firewalls, setFirewalls]  = useState<any[]>([]);
  const [blocks,    setBlocks]     = useState<Record<number, any[]>>({});
  const [testing,   setTesting]    = useState<Record<number, boolean>>({});
  const [blocking,  setBlocking]   = useState<Record<number, boolean>>({});
  const [showAdd,   setShowAdd]    = useState(false);
  const [blockIpInput, setBlockIpInput] = useState<Record<number, string>>({});
  const [expandedFw, setExpandedFw] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', type: 'fortigate', url: '', api_token: '', client_id: '', client_token: '', username: '', password: '', group_name: '', alias: '' });

  const FW_META: Record<string, { label: string; color: string; fields: Array<{ key: string; label: string; secret?: boolean; placeholder?: string }> }> = {
    fortigate: {
      label: 'FortiGate',
      color: 'text-red-700 bg-red-50 border-red-200',
      fields: [
        { key: 'url',        label: 'Management URL',     placeholder: 'https://192.168.1.1' },
        { key: 'api_token',  label: 'API Token',          secret: true, placeholder: 'REST API admin token' },
        { key: 'group_name', label: 'Block Group Name',   placeholder: 'BBS-AISOC-Blocked (default)' },
      ],
    },
    pfsense: {
      label: 'pfSense',
      color: 'text-blue-700 bg-blue-50 border-blue-200',
      fields: [
        { key: 'url',          label: 'pfSense URL',        placeholder: 'https://192.168.1.1' },
        { key: 'client_id',    label: 'API Client ID',      placeholder: 'From System > API' },
        { key: 'client_token', label: 'API Client Token',   secret: true, placeholder: 'From System > API' },
        { key: 'alias',        label: 'Block Alias Name',   placeholder: 'BBS_AISOC_Blocked (default)' },
      ],
    },
    sophos: {
      label: 'Sophos XG / SFOS',
      color: 'text-blue-900 bg-blue-50 border-blue-300',
      fields: [
        { key: 'url',      label: 'Firewall URL (port 4444)', placeholder: 'https://192.168.1.1:4444' },
        { key: 'username', label: 'Admin Username',           placeholder: 'admin' },
        { key: 'password', label: 'Admin Password',           secret: true },
      ],
    },
  };

  const configFromForm = (type: string) => {
    const meta = FW_META[type];
    const cfg: Record<string, string> = {};
    meta?.fields.forEach(f => { if (form[f.key as keyof typeof form]) cfg[f.key] = form[f.key as keyof typeof form] as string; });
    return cfg;
  };

  const loadFirewalls = useCallback(async () => {
    const res  = await fetch('/api/firewalls', { headers: { Authorization: `Bearer ${localStorage.getItem('soc_token')}` } });
    if (res.ok) setFirewalls(await res.json());
  }, []);

  const loadBlocks = useCallback(async (fwId: number) => {
    const res  = await fetch(`/api/firewalls/${fwId}/blocks`, { headers: { Authorization: `Bearer ${localStorage.getItem('soc_token')}` } });
    if (res.ok) { const data = await res.json(); setBlocks(prev => ({ ...prev, [fwId]: data })); }
  }, []);

  useEffect(() => { loadFirewalls(); }, [loadFirewalls]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/firewalls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('soc_token')}` },
      body: JSON.stringify({ name: form.name, type: form.type, config: configFromForm(form.type), enabled: false, auto_block: false }),
    });
    const data = await res.json();
    if (data.error) { showToast(data.error, 'error'); return; }
    showToast(`Firewall "${form.name}" added`);
    setShowAdd(false);
    setForm({ name: '', type: 'fortigate', url: '', api_token: '', client_id: '', client_token: '', username: '', password: '', group_name: '', alias: '' });
    loadFirewalls();
  };

  const handleToggle = async (fw: any, field: 'enabled' | 'auto_block') => {
    await fetch(`/api/firewalls/${fw.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('soc_token')}` },
      body: JSON.stringify({ [field]: !fw[field] }),
    });
    loadFirewalls();
  };

  const handleTest = async (fw: any) => {
    setTesting(prev => ({ ...prev, [fw.id]: true }));
    const res = await fetch(`/api/firewalls/${fw.id}/test`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('soc_token')}` } });
    const data = await res.json();
    showToast(data.ok ? `${fw.name} connection OK` : `${fw.name} test failed: ${data.error}`, data.ok ? 'success' : 'error');
    setTesting(prev => ({ ...prev, [fw.id]: false }));
  };

  const handleBlockIp = async (fw: any) => {
    const ip = blockIpInput[fw.id]?.trim();
    if (!ip) return;
    setBlocking(prev => ({ ...prev, [fw.id]: true }));
    const res = await fetch(`/api/firewalls/${fw.id}/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('soc_token')}` },
      body: JSON.stringify({ ip, reason: 'Manual block via SOC console' }),
    });
    const data = await res.json();
    showToast(data.ok ? `${ip} blocked on ${fw.name}` : `Block failed: ${data.error}`, data.ok ? 'success' : 'error');
    setBlocking(prev => ({ ...prev, [fw.id]: false }));
    setBlockIpInput(prev => ({ ...prev, [fw.id]: '' }));
    loadFirewalls();
    if (expandedFw === fw.id) loadBlocks(fw.id);
  };

  const handleUnblock = async (fw: any, ip: string) => {
    await fetch(`/api/firewalls/${fw.id}/unblock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('soc_token')}` },
      body: JSON.stringify({ ip }),
    });
    showToast(`${ip} unblocked on ${fw.name}`, 'info');
    loadBlocks(fw.id);
    loadFirewalls();
  };

  const handleDelete = async (fw: any) => {
    await fetch(`/api/firewalls/${fw.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('soc_token')}` } });
    showToast(`${fw.name} removed`, 'info');
    loadFirewalls();
  };

  const statusDot = (enabled: boolean) => (
    <span className={`inline-block w-2 h-2 rounded-full ${enabled ? 'bg-[#1e8e3e]' : 'bg-slate-300'}`} />
  );

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-[var(--p1)]" />
          <h3 className="text-[1rem] font-black text-[var(--p1)]">Firewall Integrations</h3>
          <span className="text-[0.65rem] text-[var(--t3)] font-semibold">Sophos · FortiGate · pfSense</span>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#004a99] text-white text-[0.75rem] font-bold hover:bg-[var(--pd)] transition-colors"
          >
            <Plus size={13} />
            Add Firewall
          </button>
        )}
      </div>

      {/* Add form */}
      {showAdd && isAdmin && (
        <form onSubmit={handleAdd} className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-5 shadow-sm space-y-4">
          <p className="text-[0.78rem] font-black text-[var(--t5)] uppercase tracking-wide">New Firewall Integration</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-wider block mb-1">Display Name</label>
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Perimeter-FW-01" className="w-full border border-[var(--b2)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
            </div>
            <div>
              <label className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-wider block mb-1">Firewall Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full border border-[var(--b2)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--p1)]">
                <option value="fortigate">FortiGate (FortiOS)</option>
                <option value="pfsense">pfSense (REST API)</option>
                <option value="sophos">Sophos XG / SFOS</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {FW_META[form.type]?.fields.map(f => (
              <div key={f.key}>
                <label className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-wider block mb-1">{f.label}</label>
                <input
                  type={f.secret ? 'password' : 'text'}
                  value={form[f.key as keyof typeof form] as string}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full border border-[var(--b2)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--p1)] font-mono"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#004a99] text-white text-[0.78rem] font-bold hover:bg-[var(--pd)]">Add Firewall</button>
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-lg border border-[var(--b2)] text-[var(--t5)] text-[0.78rem] font-semibold hover:bg-[var(--s1)]">Cancel</button>
          </div>
        </form>
      )}

      {/* No firewalls */}
      {firewalls.length === 0 && !showAdd && (
        <div className="bg-[var(--s0)] border border-dashed border-[var(--b1)] rounded-xl p-8 text-center space-y-2">
          <Shield className="w-10 h-10 text-[var(--t2)] mx-auto" />
          <p className="text-[var(--t4)] font-semibold">No firewalls configured</p>
          <p className="text-[var(--t3)] text-[0.78rem]">Add a FortiGate, pfSense, or Sophos XG to enable automatic IP blocking from agent response actions.</p>
        </div>
      )}

      {/* Firewall cards */}
      {firewalls.map(fw => {
        const meta     = FW_META[fw.type];
        const fwBlocks = blocks[fw.id];
        const isExpanded = expandedFw === fw.id;

        return (
          <div key={fw.id} className={`bg-[var(--s0)] border rounded-xl shadow-sm overflow-hidden ${fw.enabled ? 'border-[var(--p1)]/30' : 'border-[var(--b1)]'}`}>
            {/* Card header */}
            <div className={`flex items-center justify-between px-5 py-3 border-b ${fw.enabled ? 'bg-[var(--sa)]' : 'bg-[var(--s1)]'}`}>
              <div className="flex items-center gap-3">
                {statusDot(fw.enabled)}
                <div>
                  <p className="text-[0.88rem] font-black text-[var(--t7)]">{fw.name}</p>
                  <span className={`text-[0.6rem] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${meta?.color || 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)]'}`}>{meta?.label || fw.type}</span>
                </div>
                <div className="ml-2 text-[0.72rem]">
                  <span className="font-mono text-[var(--t4)]">{fw.active_blocks || 0}</span>
                  <span className="text-[var(--t3)]"> IPs blocked</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Auto-block badge */}
                {fw.auto_block && (
                  <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-[0.6rem] font-black uppercase tracking-wide border border-red-200">⚡ Auto-block ON</span>
                )}

                {isAdmin && (
                  <>
                    <button onClick={() => handleToggle(fw, 'enabled')} className={`text-[0.68rem] font-bold px-2.5 py-1 rounded border transition-colors ${fw.enabled ? 'border-[#1e8e3e] text-[#1e8e3e] hover:bg-green-50' : 'border-[var(--b1)] text-[var(--t4)] hover:bg-[var(--s1)]'}`}>
                      {fw.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                    <button onClick={() => handleToggle(fw, 'auto_block')} className={`text-[0.68rem] font-bold px-2.5 py-1 rounded border transition-colors ${fw.auto_block ? 'border-red-400 text-red-600 hover:bg-red-50' : 'border-[var(--b1)] text-[var(--t3)] hover:bg-[var(--s1)]'}`} title="Auto-block IPs from BLOCK_IP agent actions">
                      Auto-block
                    </button>
                    <button onClick={() => handleTest(fw)} disabled={testing[fw.id]} className="text-[0.68rem] font-bold px-2.5 py-1 rounded border border-[var(--p1)] text-[var(--p1)] hover:bg-[var(--sa)] transition-colors disabled:opacity-50">
                      {testing[fw.id] ? '…' : 'Test'}
                    </button>
                    <button onClick={() => handleDelete(fw)} className="p-1.5 rounded hover:bg-red-50 text-[var(--t2)] hover:text-red-500 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </>
                )}

                <button onClick={() => { setExpandedFw(isExpanded ? null : fw.id); if (!isExpanded) loadBlocks(fw.id); }} className="p-1.5 rounded hover:bg-[var(--s1)] transition-colors">
                  <ChevronDown size={14} className={`text-[var(--t3)] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>

            {/* Manual block input */}
            <div className="px-5 py-3 flex items-center gap-2 border-b border-[var(--b3)]">
              <input
                type="text"
                value={blockIpInput[fw.id] || ''}
                onChange={e => setBlockIpInput(prev => ({ ...prev, [fw.id]: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleBlockIp(fw)}
                placeholder="Block IP address manually (e.g. 185.220.101.47)"
                className="flex-1 border border-[var(--b2)] rounded px-3 py-1.5 text-[0.78rem] font-mono outline-none focus:border-red-400 focus:ring-1 focus:ring-red-100"
              />
              <button
                onClick={() => handleBlockIp(fw)}
                disabled={blocking[fw.id] || !blockIpInput[fw.id]?.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#d93025] text-white text-[0.72rem] font-bold hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {blocking[fw.id] ? <div className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" /> : <Shield size={12} />}
                Block
              </button>
            </div>

            {/* Blocked IPs list (expanded) */}
            {isExpanded && (
              <div className="border-t border-[var(--b3)]">
                {!fwBlocks ? (
                  <div className="p-4 text-center text-[var(--t3)] text-[0.75rem]">Loading…</div>
                ) : fwBlocks.filter((b: any) => b.status === 'blocked').length === 0 ? (
                  <div className="p-4 text-center text-[var(--t3)] text-[0.75rem]">No IPs currently blocked on this firewall.</div>
                ) : (
                  <table className="w-full text-[0.75rem]">
                    <thead className="bg-[var(--s1)] border-b border-[var(--b3)]">
                      <tr className="text-[0.6rem] text-[var(--t3)] font-black uppercase tracking-wider">
                        <th className="px-4 py-2 text-left">IP Address</th>
                        <th className="px-4 py-2 text-left">Reason</th>
                        <th className="px-4 py-2 text-left">Blocked At</th>
                        <th className="px-4 py-2 text-left">Alert</th>
                        {isAdmin && <th className="px-4 py-2" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {fwBlocks.filter((b: any) => b.status === 'blocked').map((b: any) => (
                        <tr key={b.id} className="hover:bg-[var(--s1)]">
                          <td className="px-4 py-2 font-mono font-bold text-red-700">{b.ip}</td>
                          <td className="px-4 py-2 text-[var(--t5)] truncate max-w-[180px]">{b.reason}</td>
                          <td className="px-4 py-2 text-[var(--t4)] text-[0.68rem] whitespace-nowrap">
                            {new Date(b.blocked_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-4 py-2 font-mono text-[var(--p1)] text-[0.65rem]">{b.alert_id?.substring(0, 8).toUpperCase() || '—'}</td>
                          {isAdmin && (
                            <td className="px-4 py-2">
                              <button onClick={() => handleUnblock(fw, b.ip)} className="px-2 py-0.5 rounded border border-[var(--b2)] text-[0.62rem] font-bold text-[var(--t4)] hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors">
                                Unblock
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const ResponseControls = () => (
  <div className="p-6 max-w-6xl mx-auto space-y-6 overflow-y-auto h-full">
    <div className="flex items-end justify-between border-b border-[var(--b2)] pb-4">
      <div>
        <p className="text-[0.65rem] font-black uppercase tracking-widest text-[var(--t3)] mb-1">Containment Layer</p>
        <h2 className="text-2xl font-bold text-[var(--p1)]">Response Controls</h2>
        <p className="text-sm text-[var(--t4)] mt-1">Firewall enforcement, manual block/unblock, and auto-block readiness for agent response actions.</p>
      </div>
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg px-4 py-2 text-right">
        <p className="text-[0.58rem] font-black uppercase text-[var(--t3)]">Supported</p>
        <p className="text-[0.78rem] font-black text-[var(--p1)]">FortiGate · pfSense · Sophos</p>
      </div>
    </div>
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-[0.78rem] text-amber-800 font-semibold">
      Auto-blocking is controlled per firewall and should be used only when the response agent emits a high-confidence BLOCK_IP action.
    </div>
    <FirewallSection />
  </div>
);

const AgentsTab = () => {
  const showToast = useToast();
  const { token, user } = useAuth();
  const [promptModal, setPromptModal] = useState<{ name: string; prompt: string } | null>(null);
  const [config,       setConfig]      = useState<AgentModelConfig | null>(null);
  const [loading,      setLoading]     = useState(false);
  const [error,        setError]       = useState('');
  const [savingPhase,  setSavingPhase] = useState<AgentPhase | null>(null);
  const [agentStats,   setAgentStats]  = useState<AgentStat[]>([]);
  const isAdmin = user?.role === 'ADMIN';

  // ── Local LLM state ────────────────────────────────────────────────────────
  const [localUrl,     setLocalUrl]    = useState('http://localhost:11434');
  const [localEnabled, setLocalEnabled]= useState(false);
  const [localModels,  setLocalModels] = useState<LocalModel[]>([]);
  const [localStatus,  setLocalStatus] = useState<'unknown'|'checking'|'connected'|'unreachable'>('unknown');
  const [savingLocal,  setSavingLocal] = useState(false);

  const agentDefs: Array<{ phase: AgentPhase; name: string; desc: string; prompt: string }> = [
    {
      phase: 'analysis',
      name: 'Alert Triage Agent',
      desc: 'Interprets Wazuh alerts, extracts IOCs (IP, user, host), validates severity, detects false positives.',
      prompt: `You are an expert SOC Alert Analysis Agent. Analyze the Wazuh security alert and respond ONLY with valid JSON — no markdown, no extra text.\n\nRequired JSON:\n{\n  "analysis_summary": "<2-3 sentence technical description of the threat>",\n  "iocs": {\n    "ips":   ["<IP addresses>"],\n    "users": ["<usernames>"],\n    "hosts": ["<hostnames or agent names>"]\n  },\n  "severity_validation": "<CRITICAL|HIGH|MEDIUM|LOW>",\n  "is_false_positive": false,\n  "false_positive_confidence": 0.2,\n  "confidence": 0.9\n}`,
    },
    {
      phase: 'intel',
      name: 'Threat Intelligence Agent',
      desc: 'Enriches IOCs (IP/domain/hash), maps to MITRE ATT&CK, assesses reputation risk.',
      prompt: `You are a Threat Intelligence Agent with deep knowledge of MITRE ATT&CK. Map the IOCs and alert context to MITRE techniques. Respond ONLY with valid JSON:\n\n{\n  "mitre_attack": ["T1190", "T1059.001"],\n  "risk_score": 8,\n  "intel_summary": "<2-3 sentence threat assessment>",\n  "threat_actor_type": "<nation-state|cybercriminal|insider|hacktivist|unknown>",\n  "campaign_family": "<malware or campaign name, or null>"\n}`,
    },
    {
      phase: 'knowledge',
      name: 'RAG Knowledge Agent',
      desc: 'Retrieves relevant playbooks, suggests remediation steps, references internal SOPs.',
      prompt: `You are a Security Playbook Retrieval Agent. Provide numbered remediation steps tailored to the alert. Respond ONLY with valid JSON:\n\n{\n  "remediation_steps": "1. <first step>\\n2. <second step>\\n...",\n  "playbook_reference": "<e.g. NIST IR-2 or internal PB-WEB-001>",\n  "containment_priority": "<IMMEDIATE|HIGH|MEDIUM|LOW>",\n  "estimated_effort_minutes": 15\n}`,
    },
    {
      phase: 'correlation',
      name: 'Correlation Agent',
      desc: 'Detects multi-alert patterns, identifies attack campaigns, escalates risk level.',
      prompt: `You are a Security Correlation Agent. Analyse the current alert against recent alerts to detect multi-stage campaigns. Respond ONLY with valid JSON:\n\n{\n  "campaign_detected": false,\n  "campaign_name": "<descriptive name or 'Isolated Incident'>",\n  "campaign_description": "<what the campaign appears to be>",\n  "related_alert_count": 0,\n  "escalation_needed": false,\n  "kill_chain_stage": "<Reconnaissance|Weaponization|Delivery|Exploitation|Installation|C2|Actions on Objectives>"\n}`,
    },
    {
      phase: 'ticketing',
      name: 'Ticketing Agent',
      desc: 'Generates structured incident report, creates GLPI ticket, assigns priority.',
      prompt: `You are an Incident Ticketing Agent. Write a professional, concise incident ticket. If priority is CRITICAL or HIGH set email_notification_sent to true. Respond ONLY with valid JSON:\n\n{\n  "title": "<incident title under 80 chars>",\n  "priority": "<CRITICAL|HIGH|MEDIUM|LOW>",\n  "report_body": "<4-5 sentences summary>",\n  "email_notification_sent": true,\n  "affected_systems": ["<hostname or IP>"],\n  "business_impact": "<one sentence>"\n}`,
    },
    {
      phase: 'response',
      name: 'Response Agent',
      desc: 'Recommends containment actions — block IP, disable user (with analyst approval).',
      prompt: `You are the Automated Response Agent. Recommend specific, actionable containment steps. Respond ONLY with valid JSON:\n\n{\n  "actions": [\n    {\n      "type": "<BLOCK_IP|DISABLE_USER|ISOLATE_HOST|QUARANTINE_FILE|RESET_PASSWORD|NOTIFY_TEAM>",\n      "target": "<IP address, username, hostname, or file path>",\n      "reason": "<why this action is necessary>",\n      "priority": 1,\n      "automated": false\n    }\n  ],\n  "approval_required": true,\n  "estimated_containment_time": "15 minutes"\n}`,
    },
    {
      phase: 'validation',
      name: 'SLA Validation Agent',
      desc: 'Verifies action plan completeness, ensures SLA alignment, logs approval trail.',
      prompt: `You are the SLA & Quality Validation Agent. Verify the incident response is thorough and within policy. Respond ONLY with valid JSON:\n\n{\n  "is_valid": true,\n  "sla_status": "<SLA_MET|SLA_AT_RISK|SLA_BREACHED>",\n  "completeness_score": 90,\n  "missing_elements": [],\n  "recommendation": "<CLOSE|ESCALATE|MONITOR|INVESTIGATE_FURTHER>",\n  "confidence": 0.85\n}`,
    },
  ];

  const checkLocalConnection = useCallback(async (url?: string) => {
    setLocalStatus('checking');
    const res = await testLocalLLM();
    if (res.ok) {
      setLocalStatus('connected');
      const modRes = await getLocalLLMModels();
      setLocalModels(modRes.models || []);
    } else {
      setLocalStatus('unreachable');
      setLocalModels([]);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    Promise.all([
      getAgentModelConfig(),
      getAgentStats(),
      getLocalLLMConfig(),
    ]).then(([cfg, stats, local]) => {
      setConfig(cfg);
      setAgentStats(stats);
      setLocalUrl(local.url);
      setLocalEnabled(local.enabled);
      if (local.enabled) {
        // Also fetch local models from the config response
        if (cfg.localModels && cfg.localModels.length > 0) {
          setLocalModels(cfg.localModels);
          setLocalStatus('connected');
        } else {
          checkLocalConnection(local.url);
        }
      }
    }).catch((err: any) => setError(err?.message || 'Failed to load configuration.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleModelChange = async (phase: AgentPhase, model: string) => {
    if (!isAdmin) return;
    setSavingPhase(phase);
    setError('');
    try {
      const updated = await updateAgentModel(phase, model);
      setConfig(updated);
      showToast(`${phase} agent → ${model.startsWith('local::') ? model.replace('local::','') : (updated?.modelLabels?.[model] || model)}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to update model.');
      showToast('Failed to save model', 'error');
    } finally {
      setSavingPhase(null);
    }
  };

  const handleSaveLocalConfig = async () => {
    setSavingLocal(true);
    try {
      await updateLocalLLMConfig({ url: localUrl, enabled: localEnabled });
      showToast('Local LLM config saved');
      if (localEnabled) await checkLocalConnection(localUrl);
      else { setLocalStatus('unknown'); setLocalModels([]); }
      // Refresh model config to get updated localModels in dropdowns
      const updated = await getAgentModelConfig();
      setConfig(updated);
    } catch (err: any) {
      showToast('Failed to save local LLM config', 'error');
    } finally {
      setSavingLocal(false);
    }
  };

  const handleTestLocal = async () => {
    setLocalStatus('checking');
    const res = await testLocalLLM();
    showToast(res.ok ? `${res.message}` : `Unreachable: ${res.error}`, res.ok ? 'success' : 'error');
    if (res.ok) {
      setLocalStatus('connected');
      const modRes = await getLocalLLMModels();
      setLocalModels(modRes.models || []);
    } else {
      setLocalStatus('unreachable');
      setLocalModels([]);
    }
  };

  const getStatForPhase = (phase: AgentPhase): AgentStat | undefined =>
    agentStats.find(s => s.phase === phase);

  const statusColor: Record<string, string> = {
    unknown:     'text-[var(--t3)]',
    checking:    'text-blue-500',
    connected:   'text-[#1e8e3e]',
    unreachable: 'text-[#d93025]',
  };
  const statusLabel: Record<string, string> = {
    unknown:     '● Not checked',
    checking:    '● Checking…',
    connected:   `● Connected — ${localModels.length} model${localModels.length === 1 ? '' : 's'}`,
    unreachable: '● Unreachable',
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 overflow-y-auto h-full">
      <div>
        <h2 className="text-2xl font-bold text-[var(--p1)]">AI Agents</h2>
        <p className="text-[0.8rem] text-[var(--t4)] mt-0.5">
          {isAdmin ? 'Configure model assignments and local LLM server.' : 'Model selection is admin-only.'}
        </p>
      </div>

      {error && (
        <div className="bg-red-50 text-[#d93025] p-3 rounded border border-red-100 text-[0.8rem] font-semibold">{error}</div>
      )}

      {/* ── Local LLM Server Card ──────────────────────────────────────────── */}
      <div className={`bg-[var(--s0)] border rounded-xl shadow-sm overflow-hidden ${localEnabled && localStatus === 'connected' ? 'border-[#1e8e3e]/40' : 'border-[var(--b1)]'}`}>
        <div className={`flex items-center justify-between px-5 py-3 border-b ${localEnabled && localStatus === 'connected' ? 'bg-green-50/50' : 'bg-[var(--s1)]'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${localEnabled && localStatus === 'connected' ? 'bg-[#1e8e3e]' : 'bg-slate-300'}`} />
            <p className="text-[0.9rem] font-black text-[var(--t7)]">Local LLM Server</p>
            <span className="text-[0.65rem] text-[var(--t3)] font-semibold">Ollama · OpenAI-compatible</span>
          </div>
          <span className={`text-[0.7rem] font-bold ${statusColor[localStatus]}`}>{statusLabel[localStatus]}</span>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-wider block mb-1">Ollama Server URL</label>
              <input
                type="text"
                value={localUrl}
                onChange={e => setLocalUrl(e.target.value)}
                disabled={!isAdmin}
                placeholder="http://localhost:11434"
                className="w-full border border-[var(--b2)] rounded px-3 py-2 text-[0.82rem] font-mono outline-none focus:border-[var(--p1)] disabled:opacity-60"
              />
            </div>
            <div className="flex items-center gap-2 pb-0.5">
              <label className="text-[0.7rem] font-bold text-[var(--t5)]">Enable</label>
              <button
                onClick={() => isAdmin && setLocalEnabled(v => !v)}
                disabled={!isAdmin}
                className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-50 ${localEnabled ? 'bg-[#1e8e3e]' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-[var(--s0)] rounded-full shadow transition-all ${localEnabled ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
            {isAdmin && (
              <>
                <button onClick={handleSaveLocalConfig} disabled={savingLocal} className="px-4 py-2 rounded-lg bg-[#004a99] text-white text-[0.75rem] font-bold hover:bg-[var(--pd)] disabled:opacity-50 transition-colors">
                  {savingLocal ? 'Saving…' : 'Save'}
                </button>
                <button onClick={handleTestLocal} disabled={localStatus === 'checking'} className="px-4 py-2 rounded-lg border border-[var(--p1)] text-[var(--p1)] text-[0.75rem] font-bold hover:bg-[var(--sa)] disabled:opacity-50 transition-colors">
                  {localStatus === 'checking' ? '…' : 'Test'}
                </button>
              </>
            )}
          </div>

          {/* Available models list */}
          {localStatus === 'connected' && localModels.length > 0 && (
            <div>
              <p className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-wider mb-2">Available Models ({localModels.length})</p>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {localModels.map(m => (
                  <span key={m.name} className="px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-green-800 text-[0.68rem] font-bold font-mono">
                    {m.name}
                    {m.size > 0 && <span className="ml-1 opacity-60">{(m.size / 1e9).toFixed(1)}GB</span>}
                  </span>
                ))}
              </div>
              <p className="text-[0.62rem] text-[var(--t3)] mt-1.5">Select a local model from the dropdown below using the <span className="font-mono bg-[var(--s1)] px-1 rounded">🖥 Local (Ollama)</span> group.</p>
            </div>
          )}
          {localStatus === 'unreachable' && (
            <div className="flex items-center gap-2 text-[0.75rem] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle size={14} />
              <span>Cannot reach Ollama at <span className="font-mono font-bold">{localUrl}</span>. Make sure Ollama is running (<span className="font-mono">ollama serve</span>).</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Agent Cards Grid ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-5">
        {agentDefs.map((agent, i) => {
          const currentModel = config?.assignments?.[agent.phase] || config?.defaults?.[agent.phase] || 'unknown';
          const cloudOptions = config?.availableModels || [];
          const isSaving     = savingPhase === agent.phase;
          const isLocalAssigned = currentModel.startsWith('local::');
          const stat = getStatForPhase(agent.phase);
          const fallbackPct = stat && stat.total_runs > 0 ? Math.round((stat.fallback_count / stat.total_runs) * 100) : 0;

          return (
            <div key={i} className={`bg-[var(--s0)] border rounded-xl shadow-sm overflow-hidden ${isLocalAssigned ? 'border-green-300' : 'border-[var(--b1)]'}`}>
              <div className={`flex justify-between items-center px-5 py-3 border-b ${isLocalAssigned ? 'bg-green-50/50' : 'bg-[var(--s1)]/50'}`}>
                <h3 className="font-black text-[0.88rem] text-[var(--p1)]">{agent.name}</h3>
                <div className="flex items-center gap-2">
                  {isLocalAssigned && <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 border border-green-200 text-[0.58rem] font-black uppercase tracking-wide">🖥 LOCAL</span>}
                  <span className="bg-green-50 text-green-600 px-2 py-0.5 rounded text-[0.6rem] font-bold uppercase border border-green-100">Active</span>
                </div>
              </div>

              <div className="p-5 space-y-4">
                <p className="text-[0.78rem] text-[var(--t4)]">{agent.desc}</p>

                {/* Model dropdown with groups */}
                <div className="space-y-1.5">
                  <label className="text-[0.62rem] font-black uppercase tracking-wider text-[var(--t3)] block">Model</label>
                  <select
                    value={currentModel}
                    disabled={!isAdmin || loading || isSaving}
                    onChange={(e) => handleModelChange(agent.phase, e.target.value)}
                    className="w-full border border-[var(--b1)] rounded px-2.5 py-2 text-[0.72rem] outline-none focus:border-[var(--p1)] disabled:opacity-60"
                  >
                    <optgroup label="☁ Cloud (OpenRouter)">
                      {cloudOptions.map((model) => (
                        <option key={model} value={model}>{config?.modelLabels?.[model] || model}</option>
                      ))}
                    </optgroup>
                    {localStatus === 'connected' && localModels.length > 0 && (
                      <optgroup label="🖥 Local (Ollama)">
                        {localModels.map(m => (
                          <option key={`local::${m.name}`} value={`local::${m.name}`}>{m.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <div className="flex justify-between items-center">
                    <span className="text-[0.62rem] text-[var(--t3)]">
                      {isSaving ? 'Saving…' : isLocalAssigned ? `🖥 Ollama · ${currentModel.replace('local::','')}` : 'OpenRouter'}
                    </span>
                    <button onClick={() => setPromptModal({ name: agent.name, prompt: agent.prompt })} className="flex items-center gap-1 text-[var(--p1)] text-[0.68rem] font-bold hover:underline">
                      <Eye className="w-3 h-3" />
                      Prompt
                    </button>
                  </div>
                </div>

                {/* Stats strip */}
                {stat && (
                  <div className="grid grid-cols-3 gap-2 pt-3 border-t border-[var(--b3)]">
                    <div className="text-center">
                      <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-wider">Runs</p>
                      <p className="text-[0.88rem] font-black text-[var(--t6)]">{stat.total_runs || '—'}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-wider">Avg Conf</p>
                      <p className={`text-[0.88rem] font-black ${
                        stat.avg_confidence == null ? 'text-[var(--t3)]' :
                        stat.avg_confidence >= 80 ? 'text-[#1e8e3e]' :
                        stat.avg_confidence >= 60 ? 'text-amber-600' : 'text-[#d93025]'
                      }`}>{stat.avg_confidence != null ? `${stat.avg_confidence}%` : '—'}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-wider">Feedback</p>
                      <p className={`text-[0.88rem] font-black ${
                        stat.feedback_total === 0 ? 'text-[var(--t3)]' :
                        (stat.feedback_accurate / stat.feedback_total) >= 0.75 ? 'text-[#1e8e3e]' :
                        (stat.feedback_accurate / stat.feedback_total) >= 0.5  ? 'text-amber-600' : 'text-[#d93025]'
                      }`}>{stat.feedback_total > 0 ? `${stat.feedback_accurate}/${stat.feedback_total}` : '—'}</p>
                    </div>
                    {fallbackPct > 30 && (
                      <div className="col-span-3 flex items-center gap-1.5 text-[0.65rem] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 font-bold">
                        <AlertTriangle size={11} />
                        {fallbackPct}% fallback rate — model may be unavailable
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Prompt modal */}
      {promptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--s0)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-7 py-5 bg-[var(--pd)] text-white shrink-0">
              <div>
                <p className="text-[0.65rem] font-black uppercase tracking-widest text-blue-200 mb-0.5">System Prompt</p>
                <h3 className="text-[1rem] font-black">{promptModal.name}</h3>
              </div>
              <button onClick={() => setPromptModal(null)} className="p-1 hover:bg-[var(--s0)]/10 rounded"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <pre className="text-[0.78rem] bg-slate-950 text-emerald-400 p-5 rounded-xl font-mono leading-relaxed whitespace-pre-wrap">{promptModal.prompt}</pre>
            </div>
            <div className="px-6 py-4 border-t bg-[var(--s1)] flex justify-end shrink-0">
              <button onClick={() => setPromptModal(null)} className="px-5 py-2 rounded border border-[var(--b2)] text-[var(--t5)] font-semibold text-sm hover:bg-[var(--s1)]">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const TACTIC_OPTIONS = [
  'INITIAL_ACCESS','EXECUTION','PERSISTENCE','PRIVILEGE_ESCALATION','DEFENSE_EVASION',
  'CREDENTIAL_ACCESS','DISCOVERY','LATERAL_MOVEMENT','COLLECTION','EXFILTRATION',
  'COMMAND_AND_CONTROL','IMPACT','RECONNAISSANCE','RESOURCE_DEVELOPMENT',
];

const SettingsTab = () => {
  const showToast = useToast();
  const { user, token } = useAuth();
  const [users, setUsers]              = useState<UserType[]>([]);
  const [loadingUsers, setLoadingUsers]= useState(false);
  const [showCreateForm, setShowCreate]= useState(false);
  const [form, setForm]                = useState({ username: '', password: '', email: '', role: 'ANALYST' });
  const [createError, setCreateError]  = useState('');
  const [createSuccess, setCreateOk]  = useState('');
  const isAdmin = user?.role === 'ADMIN';

  // Playbooks
  const [playbooks, setPlaybooks]         = useState<any[]>([]);
  const [showPBForm, setShowPBForm]       = useState(false);
  const [pbForm, setPBForm]               = useState({ tactic: 'CREDENTIAL_ACCESS', title: '', steps: '' });
  const [pbError, setPBError]             = useState('');

  const fetchPlaybooks = () => {
    if (!token) return;
    fetch('/api/playbooks', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(data => { if (Array.isArray(data)) setPlaybooks(data); }).catch(() => {});
  };

  useEffect(() => { fetchPlaybooks(); }, [token]);

  const handleCreatePlaybook = async (e: React.FormEvent) => {
    e.preventDefault();
    setPBError('');
    if (!pbForm.title || !pbForm.steps) { setPBError('Title and steps are required.'); return; }
    try {
      const res  = await fetch('/api/playbooks', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(pbForm) });
      const data = await res.json();
      if (data.error) { setPBError(data.error); return; }
      fetchPlaybooks();
      setShowPBForm(false);
      setPBForm({ tactic: 'CREDENTIAL_ACCESS', title: '', steps: '' });
      showToast('Playbook created successfully');
    } catch { setPBError('Failed to create playbook.'); }
  };

  const handleDeletePlaybook = async (id: number) => {
    await fetch(`/api/playbooks/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    fetchPlaybooks();
    showToast('Playbook deleted', 'info');
  };

  const [pwForm, setPwForm]   = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwOk, setPwOk]       = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(''); setPwOk('');
    if (pwForm.next !== pwForm.confirm) { setPwError('New passwords do not match.'); return; }
    if (pwForm.next.length < 6) { setPwError('New password must be at least 6 characters.'); return; }
    setPwLoading(true);
    try {
      const res = await fetch('/api/users/me/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      });
      const data = await res.json();
      if (!res.ok) { setPwError(data.message || 'Failed to update password.'); return; }
      setPwOk('Password updated successfully.');
      setPwForm({ current: '', next: '', confirm: '' });
    } catch { setPwError('Connection error.'); }
    finally { setPwLoading(false); }
  };

  useEffect(() => {
    if (!isAdmin || !token) return;
    setLoadingUsers(true);
    fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setUsers(data); })
      .finally(() => setLoadingUsers(false));
  }, [isAdmin, token]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setCreateOk('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.error) { setCreateError(data.error); return; }
      setCreateOk(`User "${data.username}" created successfully.`);
      setUsers(prev => [...prev, data]);
      setForm({ username: '', password: '', email: '', role: 'ANALYST' });
      setShowCreate(false);
      showToast(`User "${data.username}" created`);
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create user');
    }
  };

  const { dark, toggle: toggleDark } = useDarkMode();

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8 overflow-y-auto h-full">
      <h2 className="text-2xl font-bold text-[var(--p1)]">System Administration</h2>

      {/* Appearance */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-6 shadow-sm">
        <h3 className="text-[0.85rem] font-bold text-[var(--t2)] uppercase mb-4">Appearance</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[0.9rem] font-semibold text-[var(--t7)]">Dark Mode</p>
            <p className="text-[0.75rem] text-[var(--t4)] mt-0.5">Switch between light and dark interface</p>
          </div>
          <button
            onClick={toggleDark}
            className={`relative inline-flex h-7 w-13 items-center rounded-full transition-colors duration-200 focus:outline-none ${dark ? 'bg-[#004a99]' : 'bg-slate-300'}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-[var(--s0)] shadow-md transition-transform duration-200 ${dark ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-6 shadow-sm">
        <h3 className="text-[0.85rem] font-bold text-[var(--t2)] uppercase mb-4">Your Profile</h3>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Username', value: user?.username },
            { label: 'Role',     value: user?.role },
            { label: 'User ID',  value: `#${user?.id}` },
          ].map(f => (
            <div key={f.label} className="bg-[var(--s1)] border border-[var(--b2)] rounded-lg p-3">
              <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-wider mb-1">{f.label}</p>
              <p className="font-bold text-[0.9rem] text-[var(--t7)]">{f.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-6 shadow-sm">
        <h3 className="text-[0.85rem] font-bold text-[var(--t2)] uppercase mb-4">Security — Change Password</h3>
        <form onSubmit={handleChangePassword} className="space-y-3 max-w-sm">
          {pwError && <p className="text-[0.8rem] text-[#d93025] bg-red-50 border border-red-100 rounded px-3 py-2">{pwError}</p>}
          {pwOk    && <p className="text-[0.8rem] text-[#1e8e3e] bg-green-50 border border-green-100 rounded px-3 py-2">✓ {pwOk}</p>}
          {[
            { label: 'Current Password', key: 'current' },
            { label: 'New Password',     key: 'next' },
            { label: 'Confirm New Password', key: 'confirm' },
          ].map(({ label, key }) => (
            <div key={key} className="space-y-1">
              <label className="text-[0.7rem] font-bold text-[var(--t2)] uppercase tracking-wider">{label}</label>
              <input
                type="password"
                required
                value={(pwForm as any)[key]}
                onChange={e => setPwForm(prev => ({ ...prev, [key]: e.target.value }))}
                className="w-full px-3 py-2 bg-[var(--s1)] border border-[var(--b1)] rounded text-[0.88rem] outline-none focus:border-[var(--p1)] transition-colors"
              />
            </div>
          ))}
          <button
            type="submit"
            disabled={pwLoading}
            className="mt-1 px-4 py-2 bg-[#004a99] text-white text-[0.82rem] font-bold rounded hover:bg-[var(--pd)] transition-colors disabled:opacity-50"
          >
            {pwLoading ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>

      {isAdmin ? (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg overflow-hidden shadow-sm">
          <div className="p-4 border-b bg-[var(--s1)] flex justify-between items-center">
            <h3 className="text-[0.85rem] font-bold text-[var(--p1)]">User Management</h3>
            <button
              onClick={() => setShowCreate(!showCreateForm)}
              className="flex items-center gap-1.5 bg-[#004a99] text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-[var(--pd)] transition-colors"
            >
              <UserPlus className="w-3 h-3" />
              Add User
            </button>
          </div>

          {showCreateForm && (
            <form onSubmit={handleCreateUser} className="p-5 border-b border-[var(--b1)] bg-[var(--sa)] space-y-3">
              {createError  && <div className="text-[#d93025] text-sm font-semibold">{createError}</div>}
              {createSuccess && <div className="text-[#1e8e3e] text-sm font-semibold">{createSuccess}</div>}
              <div className="grid grid-cols-2 gap-3">
                <input required placeholder="Username" value={form.username}
                  onChange={e => setForm({...form, username: e.target.value})}
                  className="border border-[var(--b1)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
                <input required type="password" placeholder="Password" value={form.password}
                  onChange={e => setForm({...form, password: e.target.value})}
                  className="border border-[var(--b1)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
                <input placeholder="Email (optional)" value={form.email}
                  onChange={e => setForm({...form, email: e.target.value})}
                  className="border border-[var(--b1)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
                <select value={form.role} onChange={e => setForm({...form, role: e.target.value})}
                  className="border border-[var(--b1)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--p1)]">
                  <option value="ANALYST">ANALYST</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="bg-[#004a99] text-white px-4 py-1.5 rounded text-sm font-bold hover:bg-[var(--pd)]">Create</button>
                <button type="button" onClick={() => setShowCreate(false)} className="border border-[var(--b2)] text-[var(--t5)] px-4 py-1.5 rounded text-sm font-semibold hover:bg-[var(--s1)]">Cancel</button>
              </div>
            </form>
          )}

          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--s1)] border-b border-[var(--b1)] text-[var(--t2)] font-bold uppercase text-[0.7rem] tracking-wider">
              <tr>
                <th className="p-4">ID</th>
                <th className="p-4">Username</th>
                <th className="p-4">Email</th>
                <th className="p-4">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {loadingUsers ? (
                <tr><td colSpan={4} className="p-6 text-center text-[var(--t3)]">Loading users...</td></tr>
              ) : users.map(u => (
                <tr key={u.id} className="hover:bg-[var(--s1)]">
                  <td className="p-4 font-mono text-[var(--t3)]">#{u.id}</td>
                  <td className="p-4 font-semibold">{u.username}</td>
                  <td className="p-4 text-[var(--t4)]">{u.email || '—'}</td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${u.role === 'ADMIN' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'}`}>
                      {u.role}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 text-amber-800 text-sm font-semibold">
          User management is restricted to ADMIN role. Contact your SOC administrator.
        </div>
      )}

      {/* Playbooks */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg overflow-hidden shadow-sm">
        <div className="p-4 border-b bg-[var(--s1)] flex justify-between items-center">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[var(--p1)]" />
            <h3 className="text-[0.85rem] font-bold text-[var(--p1)]">SOC Playbooks</h3>
            <span className="text-[0.65rem] text-[var(--t3)]">({playbooks.length} total)</span>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowPBForm(!showPBForm)}
              className="flex items-center gap-1.5 bg-[#004a99] text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-[var(--pd)] transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add Playbook
            </button>
          )}
        </div>

        {showPBForm && isAdmin && (
          <form onSubmit={handleCreatePlaybook} className="p-5 border-b bg-[var(--sa)] space-y-3">
            {pbError && <p className="text-[#d93025] text-sm font-semibold">{pbError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[0.7rem] font-black text-[var(--t4)] uppercase tracking-wider block mb-1">MITRE Tactic</label>
                <select value={pbForm.tactic} onChange={e => setPBForm({...pbForm, tactic: e.target.value})} className="w-full border border-[var(--b1)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--p1)]">
                  {TACTIC_OPTIONS.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[0.7rem] font-black text-[var(--t4)] uppercase tracking-wider block mb-1">Title</label>
                <input required value={pbForm.title} onChange={e => setPBForm({...pbForm, title: e.target.value})} placeholder="e.g. Brute Force Response" className="w-full border border-[var(--b1)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
              </div>
            </div>
            <div>
              <label className="text-[0.7rem] font-black text-[var(--t4)] uppercase tracking-wider block mb-1">Steps (one per line or numbered)</label>
              <textarea required value={pbForm.steps} onChange={e => setPBForm({...pbForm, steps: e.target.value})} rows={4} placeholder="1. Block source IP at firewall&#10;2. Lock affected account..." className="w-full border border-[var(--b1)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--p1)] resize-none font-mono" />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="bg-[#004a99] text-white px-4 py-1.5 rounded text-sm font-bold hover:bg-[var(--pd)]">Create</button>
              <button type="button" onClick={() => setShowPBForm(false)} className="border border-[var(--b2)] text-[var(--t5)] px-4 py-1.5 rounded text-sm font-semibold hover:bg-[var(--s1)]">Cancel</button>
            </div>
          </form>
        )}

        <div className="divide-y divide-slate-100">
          {playbooks.length === 0 ? (
            <div className="p-6 text-center text-[var(--t3)] text-sm">No playbooks yet. Add one above.</div>
          ) : playbooks.map(pb => (
            <div key={pb.id} className="px-5 py-3 flex items-start justify-between gap-4 hover:bg-[var(--s1)]">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[0.6rem] font-black uppercase tracking-wide">{pb.tactic?.replace(/_/g, ' ')}</span>
                  <p className="text-[0.82rem] font-bold text-[var(--t7)] truncate">{pb.title}</p>
                </div>
                <p className="text-[0.72rem] text-[var(--t4)] line-clamp-2 whitespace-pre-line">{pb.steps}</p>
              </div>
              {isAdmin && (
                <button onClick={() => handleDeletePlaybook(pb.id)} className="shrink-0 p-1 rounded hover:bg-red-50 text-[var(--t3)] hover:text-red-600 transition-colors">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const LoginPage = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else login(data.token, data.user);
    } catch (err) {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--s3)] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-[var(--s0)] rounded-lg shadow-xl border border-[var(--b1)] overflow-hidden"
      >
        <div className="bg-[#004a99] p-8 text-white text-center">
          <div className="w-20 h-20 rounded-full bg-[var(--s0)] flex items-center justify-center mx-auto mb-4 shadow-md overflow-hidden">
            <img src="/logo-BBS.png" className="h-14 w-14 object-contain" alt="Black Box Solutions" />
          </div>
          <h1 className="text-[1.4rem] font-bold tracking-tight">BBS AISOC</h1>
          <p className="text-blue-100/70 text-[0.85rem] mt-1 uppercase tracking-widest font-semibold">Black Box Solutions · Cybersecurity</p>
        </div>
        
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {error && (
            <div className="bg-red-50 text-[#d93025] p-4 rounded border border-red-100 text-[0.85rem] font-semibold">
              {error}
            </div>
          )}
          
          <div className="space-y-1.5">
            <label className="text-[0.7rem] font-bold text-[var(--t2)] uppercase tracking-wider">Operator ID</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t2)]" />
              <input 
                type="text" 
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-[var(--s1)] border border-[var(--b1)] rounded outline-none focus:border-[var(--p1)] transition-colors text-[0.9rem]"
                placeholder="Enter username"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[0.7rem] font-bold text-[var(--t2)] uppercase tracking-wider">Access Key</label>
            <div className="relative">
              <Terminal className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t2)]" />
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-[var(--s1)] border border-[var(--b1)] rounded outline-none focus:border-[var(--p1)] transition-colors text-[0.9rem]"
                placeholder="Enter password"
              />
            </div>
          </div>

          <button 
            disabled={loading}
            className="w-full bg-[#004a99] text-white font-bold py-4 rounded hover:bg-[var(--pd)] transition-all shadow-md disabled:opacity-50 text-[0.9rem] uppercase tracking-widest"
          >
            {loading ? 'Verifying Credentials...' : 'Initialize Session'}
          </button>
          
          <div className="text-center space-y-2">
            <p className="text-[0.7rem] text-[var(--t2)] font-semibold">
              SYSTEM ID: SOC-ALPHA-01 • REGION: EU-WEST-2
            </p>
            <p className="text-[0.65rem] text-[var(--t2)] opacity-50">
              Unauthorized access is strictly prohibited and monitored.
            </p>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem('soc_active_tab');
    return saved === 'dashboard' || saved === 'actions' ? 'research' : (saved || 'research');
  });
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(() => localStorage.getItem('soc_selected_alert_id'));
  const [socket, setSocket] = useState<Socket | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((msg: string, type: ToastItem['type'] = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message: msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const selectedAlert = alerts.find((alert) => alert.id === selectedAlertId) || null;

  useEffect(() => {
    localStorage.setItem('soc_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (selectedAlertId) {
      localStorage.setItem('soc_selected_alert_id', selectedAlertId);
    } else {
      localStorage.removeItem('soc_selected_alert_id');
    }
  }, [selectedAlertId]);

  useEffect(() => {
    const socToken = localStorage.getItem('soc_token');
    if (!socToken) return;

    fetch('/api/alerts?pageSize=100', {
      headers: { Authorization: `Bearer ${socToken}` }
    }).then(res => res.json())
      .then(data => {
        const list = Array.isArray(data) ? data : data?.alerts;
        if (!Array.isArray(list)) return;
        setAlerts(list);
        // NOTE: Page-load auto-orchestration intentionally disabled.
        // Users click "Run Agents" on the alert they want to analyze.
        // Socket-triggered orchestration (for fresh incoming alerts) is still active below.
      });

    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('new_alert', (data) => {
      // Fetch the full alert to analyze it
      fetch('/api/alerts?pageSize=100', {
        headers: { Authorization: `Bearer ${socToken}` }
      }).then(res => res.json())
        .then(raw => {
          const dataList = Array.isArray(raw) ? raw : raw?.alerts;
          if (!Array.isArray(dataList)) return;
          setAlerts(dataList);
          const newAlert = dataList.find((a: any) => a.id === data.id);
          if (newAlert && newAlert.status === 'NEW') {
            const recent = dataList.filter((a: any) => a.id !== newAlert.id).slice(0, 50);
            orchestrateAnalysis(newAlert, recent, (update) => {
              // Update local state
              setAlerts(prev => Array.isArray(prev) ? prev.map(a => a.id === newAlert.id ? { ...a, ...update } : a) : prev);
              // Sync with server
              fetch(`/api/alerts/${newAlert.id}`, {
                method: 'PATCH',
                headers: { 
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${socToken}`
                },
                body: JSON.stringify(update)
              });
            });
          }
        });
    });

    newSocket.on('alert_updated', (data) => {
      setAlerts(prev => Array.isArray(prev) ? prev.map(a => a.id === data.id ? { ...a, ...data } : a) : prev);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    if (!selectedAlertId) return;
    if (!alerts.some((alert) => alert.id === selectedAlertId)) {
      setSelectedAlertId(null);
    }
  }, [alerts, selectedAlertId]);

  const handleAlertAction = (id: string, update: any) => {
    const socToken = localStorage.getItem('soc_token');
    // Update local state
    setAlerts(prev => Array.isArray(prev) ? prev.map(a => a.id === id ? { ...a, ...update } : a) : prev);
    // Sync with server
    fetch(`/api/alerts/${id}`, {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${socToken}`
      },
      body: JSON.stringify(update)
    }).catch(err => console.error('Failed to sync alert action:', err));
  };

  return (
    <DarkModeProvider>
      <ToastContext.Provider value={showToast}>
        <AuthProvider>
          <AuthConsumer
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            alerts={alerts}
            selectedAlert={selectedAlert}
            setSelectedAlert={(alert: Alert | null) => setSelectedAlertId(alert?.id || null)}
            onAlertAction={handleAlertAction}
          />
        </AuthProvider>
        <ToastContainer toasts={toasts} />
      </ToastContext.Provider>
    </DarkModeProvider>
  );
}

const Reports = ({ alerts }: { alerts: Alert[] }) => {
  const [summary,    setSummary]    = useState<ReportSummary | null>(null);
  const [reports,    setReports]    = useState<ReportRow[]>([]);
  const [totalReps,  setTotalReps]  = useState(0);
  const [page,       setPage]       = useState(1);
  const [priority,   setPriority]   = useState('');
  const [viewReport, setViewReport] = useState<{ alert: Alert; aiData: any; mitreTags: string[] } | null>(null);
  const pageSize = 15;

  useEffect(() => {
    getReportSummary().then(setSummary).catch(() => {});
  }, []);

  useEffect(() => {
    getReports({ page, pageSize, priority: priority || undefined })
      .then(d => { setReports(d.reports as ReportRow[]); setTotalReps(d.total); })
      .catch(() => {});
  }, [page, priority]);

  const priColor: Record<string, string> = {
    CRITICAL: 'bg-red-100 text-red-800',
    HIGH:     'bg-orange-100 text-orange-800',
    MEDIUM:   'bg-blue-100 text-blue-800',
    LOW:      'bg-green-100 text-green-800',
  };
  const sevColor = (s: number) => s >= 13 ? 'bg-red-50 text-red-700' : s >= 10 ? 'bg-orange-50 text-orange-700' : s >= 7 ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700';
  const sevLabel = (s: number) => s >= 13 ? 'CRIT' : s >= 10 ? 'HIGH' : s >= 7 ? 'MED' : 'LOW';

  const intgIcon: Record<string, string> = { email: '📧', glpi: '🎫', telegram: '✈' };

  // Metrics from alerts array
  const triaged      = alerts.filter(a => a.status === 'TRIAGED').length;
  const falsePos     = alerts.filter(a => a.status === 'FALSE_POSITIVE').length;
  const critCount    = alerts.filter(a => a.severity >= 12).length;
  const highCount    = alerts.filter(a => a.severity >= 7 && a.severity < 12).length;
  const mitreMapping: Record<string, number> = {};
  alerts.forEach(a => {
    if (!a.mitre_attack) return;
    try {
      const tags = Array.isArray(a.mitre_attack) ? a.mitre_attack : JSON.parse(a.mitre_attack as any);
      tags.forEach((t: string) => { mitreMapping[t] = (mitreMapping[t] || 0) + 1; });
    } catch {}
  });
  const topMitre = Object.entries(mitreMapping).sort(([, a], [, b]) => b - a).slice(0, 5);

  const totalPages = Math.ceil(totalReps / pageSize);

  const handleViewReport = (rep: ReportRow) => {
    const alert = alerts.find(a => a.id === rep.alert_id);
    if (!alert) return;
    let aiData: any = null;
    try { aiData = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch {}
    let mitreTags: string[] = [];
    try { mitreTags = alert.mitre_attack ? JSON.parse(alert.mitre_attack as any) : []; } catch {}
    setViewReport({ alert, aiData, mitreTags });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-end justify-between pb-3 border-b border-[var(--b2)]">
        <div>
          <h2 className="text-2xl font-bold text-[var(--p1)]">Incident Reports</h2>
          <p className="text-sm text-[var(--t4)] mt-0.5">Agent-generated reports · {new Date().toLocaleDateString()}</p>
        </div>
        <p className="text-xs font-mono text-[var(--t3)]">BBS-ALPHA-{new Date().toISOString().split('T')[0]}</p>
      </div>

      {/* Top stats row — 3 cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[var(--s0)] p-5 border border-[var(--b1)] rounded-xl shadow-sm space-y-3">
          <p className="text-[0.72rem] font-black text-[var(--t3)] uppercase tracking-widest">Alert Throughput</p>
          <div className="flex items-end gap-2">
            <span className="text-4xl font-black text-[var(--p1)]">{alerts.length}</span>
            <span className="text-sm text-[#1e8e3e] font-bold mb-1">{triaged + falsePos} resolved</span>
          </div>
          {[{ label: 'Triaged', val: triaged, color: 'bg-[#004a99]' }, { label: 'False Pos.', val: falsePos, color: 'bg-slate-400' }].map(s => (
            <div key={s.label}>
              <div className="flex justify-between text-[0.72rem] mb-0.5"><span>{s.label}</span><span className="font-bold">{s.val}</span></div>
              <div className="h-1.5 bg-[var(--s1)] rounded-full overflow-hidden">
                <div className={`h-full ${s.color}`} style={{ width: `${alerts.length ? (s.val / alerts.length) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="bg-[var(--s0)] p-5 border border-[var(--b1)] rounded-xl shadow-sm space-y-3">
          <p className="text-[0.72rem] font-black text-[var(--t3)] uppercase tracking-widest">Severity Distribution</p>
          {[
            { label: 'Critical', count: critCount,       color: '#d93025' },
            { label: 'High',     count: highCount,       color: '#f29900' },
            { label: 'Med/Low',  count: alerts.length - critCount - highCount, color: '#1a73e8' },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="flex-1 text-[0.78rem] text-[var(--t5)]">{s.label}</span>
              <span className="font-black text-[0.82rem]">{s.count}</span>
            </div>
          ))}
        </div>

        <div className="bg-[var(--s0)] p-5 border border-[var(--b1)] rounded-xl shadow-sm space-y-2">
          <p className="text-[0.72rem] font-black text-[var(--t3)] uppercase tracking-widest">Top MITRE Techniques</p>
          {topMitre.length > 0 ? topMitre.map(([tech, count]) => (
            <div key={tech} className="space-y-0.5">
              <div className="flex justify-between text-[0.68rem] font-bold">
                <span className="font-mono truncate max-w-[130px]">{tech}</span>
                <span className="text-[var(--t3)]">{count}×</span>
              </div>
              <div className="h-1 bg-[var(--s1)] rounded-full overflow-hidden">
                <div className="h-full bg-[#004a99]" style={{ width: `${(count / alerts.length) * 100}%` }} />
              </div>
            </div>
          )) : <p className="text-[0.72rem] text-[var(--t3)] italic">Run agents to generate MITRE data.</p>}
        </div>
      </div>

      {/* Report summary stats from server */}
      {summary && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total Reports Generated', value: summary.total,                  color: 'text-[var(--p1)]' },
            { label: 'Last 7 Days',              value: summary.last_7_days,            color: 'text-[var(--p1)]' },
            { label: 'Email Notified',           value: `${summary.email_sent_pct}%`,   color: summary.email_sent_pct > 0 ? 'text-[#1e8e3e]' : 'text-[var(--t3)]' },
            { label: '7-Day Volume',             value: (
                <div className="flex items-end gap-0.5 h-8">
                  {summary.daily_volume?.map((d: any, i: number) => {
                    const max = Math.max(...(summary.daily_volume?.map((x: any) => x.count) || [1]), 1);
                    return (
                      <div key={i} title={`${d.day}: ${d.count}`} className="flex-1 bg-[#004a99] rounded-sm" style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} />
                    );
                  })}
                </div>
              ), color: '' },
          ].map((s, i) => (
            <div key={i} className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 shadow-sm">
              <p className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">{s.label}</p>
              {typeof s.value === 'number' || typeof s.value === 'string'
                ? <p className={`text-[1.6rem] font-black ${s.color}`}>{s.value}</p>
                : s.value}
            </div>
          ))}
        </div>
      )}

      {/* Reports table */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b bg-[var(--s1)] flex items-center justify-between gap-4">
          <p className="text-[0.82rem] font-black text-[var(--p1)] uppercase tracking-wide shrink-0">
            Agent Reports ({totalReps})
          </p>
          <div className="flex items-center gap-2">
            <select
              value={priority}
              onChange={e => { setPriority(e.target.value); setPage(1); }}
              className="text-[0.72rem] border border-[var(--b2)] rounded px-2 py-1 outline-none focus:border-[var(--p1)]"
            >
              <option value="">All priorities</option>
              {['CRITICAL','HIGH','MEDIUM','LOW'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {reports.length === 0 ? (
          <div className="p-10 text-center text-[var(--t3)] text-sm">
            {totalReps === 0
              ? 'No reports generated yet. Open an alert and click Run Agents.'
              : 'No reports match the current filter.'}
          </div>
        ) : (
          <table className="w-full text-left text-[0.78rem]">
            <thead className="bg-[var(--s1)]/50 border-b border-[var(--b3)] text-[0.62rem] text-[var(--t3)] font-black uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2">Time</th>
                <th className="px-4 py-2">Alert</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Priority</th>
                <th className="px-4 py-2">Sev</th>
                <th className="px-4 py-2">Conf</th>
                <th className="px-4 py-2">Sent via</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {reports.map((rep: ReportRow) => (
                <tr key={rep.id} className="hover:bg-[var(--s1)] transition-colors">
                  <td className="px-4 py-2.5 text-[var(--t4)] font-mono text-[0.68rem] whitespace-nowrap">
                    {new Date(rep.run_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[var(--p1)] text-[0.68rem]">{rep.alert_id?.substring(0, 8).toUpperCase()}</td>
                  <td className="px-4 py-2.5 max-w-[220px]">
                    <p className="font-semibold text-[var(--t7)] truncate">{rep.title || rep.description?.slice(0, 55) || '—'}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    {rep.priority
                      ? <span className={`px-2 py-0.5 rounded text-[0.62rem] font-black ${priColor[rep.priority] || 'bg-[var(--s1)] text-[var(--t5)]'}`}>{rep.priority}</span>
                      : <span className="text-[var(--t2)]">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-[0.6rem] font-black ${sevColor(rep.severity)}`}>{sevLabel(rep.severity)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--t5)]">
                    {rep.confidence != null ? `${rep.confidence}%` : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {rep.actions_dispatched && rep.actions_dispatched.length > 0
                      ? <span className="flex gap-1">{rep.actions_dispatched.map(a => <span key={a} title={a}>{intgIcon[a] || '•'}</span>)}</span>
                      : <span className="text-[var(--t2)] text-[0.68rem]">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => handleViewReport(rep)}
                      className="flex items-center gap-1 px-2 py-1 rounded border border-[var(--b2)] text-[0.65rem] font-bold text-[var(--t5)] hover:bg-[var(--s1)] transition-colors"
                    >
                      <Eye size={11} /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t bg-[var(--s1)] flex items-center justify-between text-[0.72rem]">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded border border-[var(--b2)] text-[var(--t5)] font-semibold disabled:opacity-40 hover:bg-[var(--s0)] transition-colors"
            >
              ← Previous
            </button>
            <span className="text-[var(--t4)] font-semibold">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded border border-[var(--b2)] text-[var(--t5)] font-semibold disabled:opacity-40 hover:bg-[var(--s0)] transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Detailed report modal */}
      {viewReport && (
        <DetailedReport
          alert={viewReport.alert}
          aiData={viewReport.aiData}
          mitreTags={viewReport.mitreTags}
          onClose={() => setViewReport(null)}
        />
      )}
    </div>
  );
};

const AuthConsumer = ({ activeTab, setActiveTab, alerts, selectedAlert, setSelectedAlert, onAlertAction }: any) => {
  const { user } = useAuth();

  if (!user) return <LoginPage />;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
        <main className="flex-1 overflow-hidden bg-[var(--s3)]">
          {activeTab === 'research'     && <ResearchOverview alerts={alerts} onAlertClick={(a) => { setSelectedAlert(a); setActiveTab('alerts'); }} setActiveTab={setActiveTab} />}
          {activeTab === 'dashboard'    && <Dashboard alerts={alerts} onAlertClick={(a) => { setSelectedAlert(a); setActiveTab('alerts'); }} />}
          {activeTab === 'alerts'       && <AlertsTab alerts={alerts} selectedAlert={selectedAlert} setSelectedAlert={setSelectedAlert} onAlertAction={onAlertAction} setActiveTab={setActiveTab} />}
          {activeTab === 'agents'       && <AgentsTab />}
          {activeTab === 'intelligence' && <MitreIntelligence alerts={alerts} onAlertClick={(a) => { setSelectedAlert(a); setActiveTab('alerts'); }} />}
          {activeTab === 'reports'      && <Reports alerts={alerts} />}
          {activeTab === 'notifications'&& <ActionsTab />}
          {activeTab === 'actions'      && <ActionsTab />}
          {activeTab === 'response'     && <ResponseControls />}
          {activeTab === 'settings'     && <SettingsTab />}
        </main>
      </div>
    </div>
  );
};
