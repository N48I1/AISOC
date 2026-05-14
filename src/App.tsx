import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Shield, AlertTriangle, AlertOctagon, Activity, FileText, Settings, LogOut, Search, Bell, User, CheckCircle, XCircle, Clock, ChevronRight, BarChart3, Terminal, Filter, Plus, X, UserPlus, Eye, ThumbsUp, ThumbsDown, ChevronDown, BookOpen, Trash2, Send, Zap, Mail, ExternalLink, ToggleLeft, ToggleRight, RefreshCw, PanelLeftOpen, PanelLeftClose, Database, Copy, Key, Webhook, Hash, Globe, Crosshair, ListChecks, MessageSquare, Laptop, Link2, ChevronUp, Lock, Palette, MapPin, Edit3, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getAgentModelConfig, orchestrateAnalysis, runAgentPhase, updateAgentModel, getAlertRuns, saveAlertRun, getIntegrations, updateIntegration, testIntegration, getActionLogs, getReports, getReportSummary, getLocalLLMConfig, updateLocalLLMConfig, testLocalLLM, getLocalLLMModels, getAgentStats, getFpReduction, getFpOverTime, getNoisySources, getSuppressionRules, createSuppressionRule, updateSuppressionRule, deleteSuppressionRule, getAssets, upsertAsset, deleteAsset, getFpSuggestions, acceptFpSuggestion, fpScan, fpScanBatch, investigateAlert, escalateAlert, confirmFp, overrideFp, getFpArchive, getPipelineFunnel, getDetectionEffectiveness, getSourceDistribution, listApiKeys, createApiKey, revokeApiKey, updateApiKey, getInsights, getIocs, getPlaybooks, createPlaybook, updatePlaybook, deletePlaybook, listAnalysts, getIncidents, getIncident, createIncident, assignIncident, takeIncident, moveIncidentPhase, closeIncident, addIncidentNote, reclassifyIncidentFp, addIncidentAction, updateIncidentAction, deleteIncidentAction, reorderIncidentActions, updateIncident, type AgentModelConfig, type AgentPhase, type AgentStat, type LocalModel, type Insight, type IocRow, type Playbook } from './services/aiService';
import { INCIDENT_PHASES, PHASE_LABELS, INCIDENT_STATUS_LABELS, type Incident, type IncidentPhase, type IncidentStatus, type IncidentAction, type IncidentActionStatus } from './types';
import { User as UserType, Alert, AgentRun, Stats, UserRole, Integration, ActionLog, ReportRow, ReportSummary, ROLE_LABELS, ROLE_LEVEL } from './types';
import PageHeader from './components/ui/PageHeader';
import { AGENT_PHASES_UI, parseAlertAi, parseMitreTags, getPhaseData, getAlertRiskScore, getConfidenceValues, percent } from './features/alerts/alertUtils';

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
            'bg-[var(--p1)]'
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
  refreshProfile: () => void;
  hasRole: (minRole: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserType | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('soc_token'));

  const refreshProfile = useCallback(() => {
    if (!token) return;
    fetch('/api/users/me/profile', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (!data.error) setUser(data); })
      .catch(() => {});
  }, [token]);

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

  const hasRole = (minRole: string) => {
    const userLevel = ROLE_LEVEL[user?.role || ''] ?? -1;
    const reqLevel  = ROLE_LEVEL[minRole] ?? 99;
    return userLevel >= reqLevel;
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, refreshProfile, hasRole }}>
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
  const { logout, user, hasRole } = useAuth();
  const [expanded, setExpanded] = useState<boolean>(() => {
    const stored = localStorage.getItem('soc_sidebar_expanded');
    return stored === null ? true : stored === 'true';
  });

  useEffect(() => {
    localStorage.setItem('soc_sidebar_expanded', String(expanded));
  }, [expanded]);

  // Role-gated menu: minRole defines the minimum role required to see each item
  const menuSections: Array<{ label: string; items: Array<{ id: string; icon: any; label: string; minRole?: string }> }> = [
    {
      label: 'Operations',
      items: [
        { id: 'dashboard',        icon: BarChart3,     label: 'Dashboard' },
        { id: 'noise-filter',     icon: Filter,        label: 'Noise Filter' },
        { id: 'investigation',    icon: AlertTriangle, label: 'Alerts Queue' },
        { id: 'fp-archive',       icon: XCircle,       label: 'FP Archive' },
      ],
    },
    {
      label: 'Response',
      items: [
        { id: 'incidents',        icon: AlertOctagon,  label: 'Incidents' },
        { id: 'response-actions', icon: Zap,           label: 'Response Actions', minRole: 'TIER2' },
      ],
    },
    {
      label: 'Memory',
      items: [
        { id: 'reports',          icon: FileText,      label: 'Reports' },
        { id: 'knowledge',        icon: BookOpen,      label: 'Knowledge Base' },
      ],
    },
    {
      label: 'Config',
      items: [
        { id: 'integrations',     icon: Send,          label: 'Integrations', minRole: 'INCIDENT_LEAD' },
        { id: 'settings',         icon: Settings,      label: 'Admin Ops', minRole: 'ADMIN' },
      ],
    },
  ];

  return (
    <aside className={`bg-[var(--s0)] border-r border-[var(--b1)] h-full flex flex-col transition-[width] duration-300 ease-in-out overflow-hidden shrink-0 ${expanded ? 'w-[220px]' : 'w-16'}`}>
      <div className="flex items-center justify-between px-4 py-4 shrink-0">
        <div className={`overflow-hidden transition-opacity duration-300 ${expanded ? 'opacity-100' : 'opacity-0'}`}>
          <span className="text-[0.65rem] font-black uppercase tracking-[0.2em] text-[var(--p1)]">Aegis</span>
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--t3)] hover:text-[var(--p1)] hover:bg-[var(--sa)] transition-all"
        >
          {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      </div>

      <nav className="flex-1 flex flex-col gap-1 px-2 overflow-y-auto">
        {menuSections.map((section, sIdx) => {
          const visibleItems = section.items.filter(item => !item.minRole || hasRole(item.minRole));
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.label} className={sIdx > 0 ? 'mt-3' : ''}>
              {expanded ? (
                <p className="px-3 pt-1 pb-1 text-[0.55rem] font-black uppercase tracking-[0.2em] text-[var(--t3)]">
                  {section.label}
                </p>
              ) : (
                sIdx > 0 && <div className="mx-3 my-1 border-t border-[var(--b1)]" />
              )}
              <div className="flex flex-col gap-1">
                {visibleItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`flex items-center gap-3 py-2.5 rounded-xl transition-all ${
                      activeTab === item.id
                        ? 'text-white bg-gradient-to-r from-[var(--p1)] to-[var(--pd)] shadow-lg shadow-blue-500/20 font-semibold'
                        : 'text-[var(--t2)] hover:bg-[var(--sa)] hover:text-[var(--p1)]'
                    } ${expanded ? 'px-4' : 'px-3 justify-center'}`}
                  >
                    <item.icon className="w-[18px] h-[18px] shrink-0" />
                    <span className={`whitespace-nowrap text-[0.85rem] transition-all duration-300 ${expanded ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2 w-0'}`}>
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-[var(--b1)] space-y-2">
        <button
          onClick={() => setActiveTab('profile')}
          className={`w-full flex items-center gap-3 p-2 rounded-xl hover:bg-[var(--sa)] transition-all text-left ${activeTab === 'profile' ? 'bg-[var(--sa)]' : ''} ${!expanded && 'justify-center'}`}
        >
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[0.7rem] font-black shadow-sm shrink-0" style={{ backgroundColor: user?.avatar_color || '#3b82f6' }}>
            {(user?.display_name || user?.username || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
          </div>
          <div className={`overflow-hidden transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>
            <p className="text-[0.75rem] font-bold text-[var(--t1)] truncate">{user?.display_name || user?.username}</p>
            <p className="text-[0.6rem] font-black text-[var(--p1)] uppercase tracking-wider">{ROLE_LABELS[user?.role as UserRole] || user?.role}</p>
          </div>
        </button>
        <button
          onClick={logout}
          className={`w-full flex items-center gap-3 p-2 rounded-xl text-[var(--t4)] hover:text-red-500 hover:bg-red-50 transition-all ${!expanded && 'justify-center'}`}
        >
          <LogOut className="w-[18px] h-[18px] shrink-0" />
          <span className={`whitespace-nowrap text-[0.8rem] font-bold transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};

const Header = () => {
  const { user, token, logout } = useAuth();
  const [ingestInfo, setIngestInfo] = useState<{
    lastIngestAt: string | null;
    lastAlertAt: string | null;
    alertsLast5m: number;
    alertsLastHour: number;
    totalKeys: number;
    activeKeys: number;
  } | null>(null);

  useEffect(() => {
    if (!token) return;
    const fetchStatus = () => {
      fetch('/api/ingest/status', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setIngestInfo(d); })
        .catch(() => {});
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 30_000);
    return () => clearInterval(id);
  }, [token]);

  // Status derived from ingest activity, not from a fake "is enabled" toggle:
  //   healthy  — Wazuh POSTed something in the last 5 minutes
  //   degraded — last activity 5–30 minutes ago
  //   offline  — no activity 30+ min, or no active API key configured
  const minsSinceIngest = (() => {
    const ts = ingestInfo?.lastIngestAt || ingestInfo?.lastAlertAt;
    if (!ts) return Infinity;
    return (Date.now() - new Date(ts).getTime()) / 60_000;
  })();

  const wazuhStatus: 'healthy' | 'degraded' | 'offline' =
    !ingestInfo || ingestInfo.activeKeys === 0 ? 'offline' :
    minsSinceIngest < 5  ? 'healthy' :
    minsSinceIngest < 30 ? 'degraded' :
                           'offline';

  const formatAgo = (mins: number) => {
    if (!isFinite(mins)) return 'never';
    if (mins < 1) return 'just now';
    if (mins < 60) return `${Math.floor(mins)}m ago`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  const tooltipText =
    !ingestInfo ? 'Checking ingest status…' :
    ingestInfo.activeKeys === 0
      ? 'No active API keys — Wazuh cannot push alerts. Create a key in Integrations.'
      : `Last alert: ${formatAgo(minsSinceIngest)} · ${ingestInfo.alertsLast5m} in 5m · ${ingestInfo.alertsLastHour} in 1h · ${ingestInfo.activeKeys} active key${ingestInfo.activeKeys !== 1 ? 's' : ''}`;

  const statusColors = { healthy: 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]', degraded: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]', offline: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' };
  const statusTextColors = { healthy: 'text-green-700', degraded: 'text-amber-700', offline: 'text-red-700' };
  const statusLabels = {
    healthy:  ingestInfo ? `Wazuh: Live (${ingestInfo.alertsLast5m}/5m)` : 'Wazuh: Live',
    degraded: `Wazuh: Idle ${formatAgo(minsSinceIngest)}`,
    offline:  ingestInfo?.activeKeys === 0 ? 'Wazuh: No API Key' : 'Wazuh: Silent',
  };
  return (
    <header className="h-[60px] bg-[var(--s0)] border-b border-[var(--b1)] text-[var(--t1)] flex items-center justify-between px-6 z-[100] sticky top-0 transition-all">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--p1)] to-[var(--pd)] flex items-center justify-center shadow-lg shadow-blue-500/20 shrink-0">
          <img src="/logo-BBS.png" className="h-5 w-5 object-contain brightness-0 invert" alt="BBS Logo" />
        </div>
        <div className="flex flex-col -space-y-1">
          <span className="text-[0.6rem] font-black uppercase tracking-[0.3em] text-[var(--t4)]">Security Operations</span>
          <div className="flex items-center">
            <span className="font-black text-xl text-[var(--t1)] tracking-tighter">BBS</span>
            <span className="font-black text-xl text-[var(--p1)] tracking-tighter ml-1">AISOC</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div
          className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--s1)] border border-[var(--b2)] cursor-help"
          title={tooltipText}
        >
          <div className={`w-2 h-2 rounded-full ${wazuhStatus === 'healthy' ? 'animate-pulse' : ''} ${statusColors[wazuhStatus]}`} />
          <span className={`text-[0.7rem] font-black uppercase tracking-wider ${statusTextColors[wazuhStatus]}`}>{statusLabels[wazuhStatus]}</span>
        </div>
        
        <div className="h-6 w-px bg-[var(--b2)]" />
        
        <div className="flex items-center gap-3 pl-2">
          <div className="flex flex-col items-end hidden sm:block">
            <p className="text-[0.8rem] font-bold text-[var(--t1)]">{user?.display_name || user?.username}</p>
            <p className="text-[0.6rem] font-black text-[var(--p1)] uppercase tracking-widest">{ROLE_LABELS[user?.role as UserRole] || user?.role}</p>
          </div>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[0.75rem] font-black shadow-sm" style={{ backgroundColor: user?.avatar_color || '#3b82f6' }}>
            {(user?.display_name || user?.username || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
          </div>
        </div>
      </div>
    </header>
  );
};

const StatCard = ({ label, value, icon: Icon, trend, color }: any) => (
  <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-2xl p-6 flex flex-col gap-3 shadow-sm card-hover">
    <div className="flex justify-between items-start">
      <div className="w-10 h-10 rounded-xl bg-[var(--s1)] flex items-center justify-center border border-[var(--b2)]">
        <Icon className="w-5 h-5" style={{ color: color || 'var(--p1)' }} />
      </div>
      {trend && (
        <div className={`px-2 py-1 rounded-lg text-[0.65rem] font-black flex items-center gap-1 ${trend > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
          {trend > 0 ? '+' : ''}{trend}%
        </div>
      )}
    </div>
    <div>
      <div className="text-[1.8rem] font-black text-[var(--t1)] tracking-tight">{value}</div>
      <div className="text-[0.7rem] font-black text-[var(--t3)] uppercase tracking-[0.1em] mt-1">{label}</div>
    </div>
  </div>
);

const MANDATORY_PHASES    = ['analysis'];
const INVESTIGATOR_PHASES = ['intel', 'knowledge', 'correlation', 'recall', 'ioc_check'];
const COMPOSER_PHASES     = ['ticketing', 'response', 'validation'];

const severityChipColor = (sv: string) =>
  sv === 'CRITICAL' ? 'bg-red-100 text-red-700 border border-red-200 hover:bg-red-200' :
  sv === 'HIGH'     ? 'bg-orange-100 text-orange-700 border border-orange-200 hover:bg-orange-200' :
  sv === 'MEDIUM'   ? 'bg-amber-100 text-amber-700 border border-amber-200 hover:bg-amber-200' :
                      'bg-[var(--s1)] text-[var(--t5)] border border-[var(--b2)] hover:bg-[var(--s2)]';

const AlertRow = ({ alert, onClick, isSelected }: { alert: Alert, onClick: () => void, isSelected?: boolean, key?: any }) => {
  let aiData: any = null;
  try { aiData = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch (e) {}

  const riskScore = aiData?.phaseData?.analysis?.risk_score;
  const isFP = aiData?.phaseData?.analysis?.is_false_positive;
  const summary = aiData?.summary || alert.description;
  const pd = aiData?.phaseData || {};
  const agents = ['analysis', 'intel', 'knowledge', 'correlation', 'recall', 'ioc_check', 'ticketing', 'response', 'validation'];
  const phaseDone = (phase: string) => phase === 'ticketing' ? !!pd.ticket : !!pd[phase];

  const riskColor = riskScore == null ? '#cbd5e1' : riskScore >= 80 ? '#ef4444' : riskScore >= 60 ? '#f97316' : riskScore >= 40 ? '#f59e0b' : '#10b981';

  return (
    <motion.div 
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClick}
      className={`alert-item p-4 border-b border-[var(--b3)] cursor-pointer transition-all ${isSelected ? 'bg-[var(--sa)] border-l-4 border-l-[var(--p1)]' : 'hover:bg-[var(--s1)] border-l-4 border-l-transparent'}`}
    >
      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center gap-1 mt-0.5 shrink-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center border-2 shadow-sm" style={{ borderColor: riskColor, backgroundColor: `${riskColor}10` }}>
            <span className="text-[0.85rem] font-black" style={{ color: riskColor }}>
              {riskScore != null ? riskScore : alert.severity}
            </span>
          </div>
          <span className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest">{riskScore != null ? 'Risk' : 'Lvl'}</span>
        </div>

        <div className="flex-1 min-w-0 py-0.5">
          <div className="flex items-center gap-2 mb-1">
            {isFP && <span className="px-1.5 py-0.5 rounded-lg bg-[var(--s2)] text-[var(--t4)] border border-[var(--b2)] text-[0.55rem] font-black uppercase tracking-wider shrink-0">False Positive</span>}
            <h4 className="text-[0.85rem] font-bold text-[var(--t1)] truncate leading-tight" title={summary}>{summary}</h4>
          </div>
          
          <div className="flex items-center gap-3 text-[0.7rem] text-[var(--t4)] font-medium mb-2">
            <span className="font-mono text-[0.6rem] bg-[var(--s1)] text-[var(--p1)] rounded-md px-1.5 py-0.5 border border-[var(--b2)] select-all">#{alert.id.substring(0,8).toUpperCase()}</span>
            <span className="truncate flex items-center gap-1"><Activity size={10} /> {alert.source_ip || alert.agent_name}</span>
            <span className="shrink-0 flex items-center gap-1 ml-auto"><Clock size={10} /> {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          <div className="flex items-center gap-1.5">
            {agents.map(a => {
              const isDone = phaseDone(a);
              const prev = agents[agents.indexOf(a) - 1];
              const isRunning = alert.status === 'ANALYZING' && !isDone && (a === 'analysis' || phaseDone(prev));
              return (
                <div key={a} title={a} className={`h-1 flex-1 rounded-full transition-all duration-500 ${isDone ? 'bg-[var(--p1)] shadow-[0_0_4px_var(--pa)]' : isRunning ? 'bg-blue-400 animate-pulse' : 'bg-[var(--s2)]'}`} />
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
              aria-label="Download report"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--s0)]/10 hover:bg-[var(--s0)]/20 text-white text-[0.75rem] font-bold transition-colors border border-white/20"
            >
              <ChevronRight size={13} className="rotate-90" />
              Download
            </button>
            <button onClick={onClose} aria-label="Close report modal" className="p-2 hover:bg-[var(--s0)]/10 rounded-lg transition-colors">
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
  if (pd.recall)      h.recall      = [pd.recall];
  if (pd.ioc_check)   h.ioc_check   = [pd.ioc_check];
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
    case 'recall':      return result.recall;
    case 'ioc_check':   return result.ioc_check;
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

const ConfidenceDonut = ({ value, size = 34 }: { value: number | null; size?: number }) => {
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = typeof value === 'number' ? Math.max(0, Math.min(100, Math.round(value * 100))) : null;
  const progress = pct == null ? 0 : pct;
  const dashOffset = circumference - (progress / 100) * circumference;
  const color =
    pct == null ? '#94a3b8' :
    pct >= 80 ? '#16a34a' :
    pct >= 60 ? '#f59e0b' :
    '#ef4444';

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#e2e8f0" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[0.54rem] font-black tabular-nums" style={{ color }}>
        {pct == null ? '—' : `${pct}`}
      </div>
    </div>
  );
};

const GlobalRiskDonut = ({ score, critical, high, resolvedHighCritical }: { score: number; critical: number; high: number; resolvedHighCritical: number }) => {
  const size = 164;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, Math.round(score)));
  const off = c - (v / 100) * c;
  const color = v >= 80 ? '#d93025' : v >= 60 ? '#f97316' : v >= 35 ? '#f29900' : '#1e8e3e';
  const label = v >= 80 ? 'Critical' : v >= 60 ? 'High' : v >= 35 ? 'Elevated' : 'Stable';

  return (
    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm p-5 h-full flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-[0.72rem] font-black text-[var(--p1)] uppercase tracking-wider">Global Risk Score</p>
          <p className="text-[0.68rem] text-[var(--t4)] mt-1">Driven by active severity and reduced as incidents move to contained, resolved, or closed.</p>
        </div>
        <span className="px-2 py-1 rounded-full text-[0.6rem] font-black uppercase tracking-wider border" style={{ color, borderColor: `${color}55`, backgroundColor: `${color}15` }}>
          {label}
        </span>
      </div>

      <div className="flex items-center justify-center flex-1">
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--s1)" strokeWidth={stroke} fill="none" />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={color}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={off}
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[2.2rem] font-black leading-none" style={{ color }}>{v}</span>
            <span className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-widest mt-1">risk / 100</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 pt-4 border-t border-[var(--b1)]">
        <div className="text-center">
          <p className="text-[1.1rem] font-black text-red-500 leading-none">{critical}</p>
          <p className="text-[0.56rem] font-bold text-[var(--t3)] uppercase tracking-wider mt-1">Critical</p>
        </div>
        <div className="text-center">
          <p className="text-[1.1rem] font-black text-orange-500 leading-none">{high}</p>
          <p className="text-[0.56rem] font-bold text-[var(--t3)] uppercase tracking-wider mt-1">High</p>
        </div>
        <div className="text-center">
          <p className="text-[1.1rem] font-black text-green-600 leading-none">{resolvedHighCritical}</p>
          <p className="text-[0.56rem] font-bold text-[var(--t3)] uppercase tracking-wider mt-1">Solved</p>
        </div>
      </div>
    </div>
  );
};

type RiskSeriesPoint = {
  day: string;
  label: string;
  risk: number;
  activeHighCritical: number;
  solvedHighCritical: number;
  totalAlerts: number;
};

type RiskChartGranularity = 'hours' | 'days' | 'months' | 'years';

const PipelineRiskTimeSeries = ({
  points,
  granularity,
  setGranularity,
}: {
  points: RiskSeriesPoint[];
  granularity: RiskChartGranularity;
  setGranularity: (value: RiskChartGranularity) => void;
}) => {
  const last = points[points.length - 1] || { risk: 0, activeHighCritical: 0, solvedHighCritical: 0, totalAlerts: 0 };
  const series = [
    { key: 'risk' as const, label: 'Risk score', color: '#d93025', value: `${Math.round(last.risk)}/100` },
    { key: 'activeHighCritical' as const, label: 'Active high/critical', color: '#f97316', value: String(last.activeHighCritical) },
    { key: 'solvedHighCritical' as const, label: 'Solved high/critical', color: '#1e8e3e', value: String(last.solvedHighCritical) },
    { key: 'totalAlerts' as const, label: 'Total alerts', color: '#004a99', value: String(last.totalAlerts) },
  ];

  return (
    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm p-5 h-full">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-[0.72rem] font-black text-[var(--p1)] uppercase tracking-wider">Risk & Pipeline Over Time</p>
          <p className="text-[0.68rem] text-[var(--t4)] mt-1">Risk is red; choose hourly, daily, monthly, or yearly buckets.</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as RiskChartGranularity)}
            className="rounded-lg border border-[var(--b2)] bg-[var(--s0)] px-2.5 py-1.5 text-[0.7rem] font-bold text-[var(--t6)] outline-none focus:border-[var(--p1)]"
            title="Chart time bucket"
          >
            <option value="hours">Hours</option>
            <option value="days">Days</option>
            <option value="months">Months</option>
            <option value="years">Years</option>
          </select>
          <div className="flex flex-wrap gap-2 justify-end">
            {series.map(s => (
              <div key={s.key} className="flex items-center gap-1.5 text-[0.62rem] font-bold text-[var(--t5)]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span>{s.label}</span>
                <span className="font-mono text-[var(--t3)]">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="w-full h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 18, bottom: 4, left: -8 }}>
            <CartesianGrid stroke="var(--b1)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--t3)', fontSize: 11, fontFamily: 'monospace' }}
              axisLine={{ stroke: 'var(--b1)' }}
              tickLine={{ stroke: 'var(--b1)' }}
              minTickGap={10}
            />
            <YAxis
              yAxisId="risk"
              domain={[0, 100]}
              tick={{ fill: 'var(--t3)', fontSize: 11, fontFamily: 'monospace' }}
              axisLine={{ stroke: 'var(--b1)' }}
              tickLine={{ stroke: 'var(--b1)' }}
              width={36}
            />
            <YAxis
              yAxisId="count"
              orientation="right"
              allowDecimals={false}
              tick={{ fill: 'var(--t3)', fontSize: 11, fontFamily: 'monospace' }}
              axisLine={{ stroke: 'var(--b1)' }}
              tickLine={{ stroke: 'var(--b1)' }}
              width={34}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--s0)',
                border: '1px solid var(--b1)',
                borderRadius: 8,
                color: 'var(--t7)',
                fontSize: 12,
              }}
              labelStyle={{ color: 'var(--t7)', fontWeight: 800 }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: 'var(--t5)', paddingTop: 8 }} />
            <Line yAxisId="risk" type="monotone" dataKey="risk" name="Risk score" stroke="#d93025" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line yAxisId="count" type="monotone" dataKey="activeHighCritical" name="Active high/critical" stroke="#f97316" strokeWidth={2.4} dot={false} />
            <Line yAxisId="count" type="monotone" dataKey="solvedHighCritical" name="Solved high/critical" stroke="#1e8e3e" strokeWidth={2.4} dot={false} />
            <Line yAxisId="count" type="monotone" dataKey="totalAlerts" name="Total alerts" stroke="#004a99" strokeWidth={2.4} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

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

        {/* Agent confidence */}
        <div className="col-span-6 md:col-span-3 p-4">
          <button type="button" onClick={scrollToAgents} className="w-full text-left group">
            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-2">Agents Confidence</p>
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
  const confidences = ['analysis', 'intel', 'knowledge', 'correlation', 'recall', 'ioc_check', 'ticket', 'response', 'validation']
    .map(k => pd[k]?.confidence)
    .filter((v): v is number => typeof v === 'number');
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
      <Chip title="Avg Confidence" value={avgConf == null ? '—' : `${avgConf}%`} sub={avgConf == null ? 'no runs' : `${confidences.length}/${AGENT_PHASES_UI.length} agents`} tone={avgConf == null ? 'text-[var(--t4)] bg-[var(--s1)] border-[var(--b2)]' : avgConf >= 80 ? 'text-green-700 bg-green-50 border-green-200' : avgConf >= 60 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-red-700 bg-red-50 border-red-200'} />
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

const InvestigationGrid = ({
  alert, aiData, mitreTags,
  allAlerts = [],
  onAlertSelect,
}: {
  alert: Alert; aiData: any; mitreTags: string[];
  allAlerts?: Alert[];
  onAlertSelect?: (a: Alert) => void;
}) => {
  const pd = aiData?.phaseData || {};
  const misp = pd.intel?.misp;
  const actions = pd.response?.actions || aiData?.response?.actions || [];
  const approvalRequired = pd.response?.approval_required ?? aiData?.response?.approval_required;
  const playbookSteps = (alert.remediation_steps || '').split('\n').map(s => s.trim()).filter(Boolean);
  const correlation = aiData?.correlation;
  const correlationObj = pd.correlation;
  const validation = aiData?.validation;

  const sameActionMap = React.useMemo(() => {
    const map: Record<string, Array<{ id: string; sv: string; alertObj: Alert }>> = {};
    for (const a of allAlerts) {
      if (a.id === alert.id) continue;
      if (['FALSE_POSITIVE','FP_CONFIRMED'].includes(a.status)) continue;
      let ai2: any = null;
      try { ai2 = a.ai_analysis ? JSON.parse(a.ai_analysis) : null; } catch {}
      const pd2 = ai2?.phaseData || {};
      const acts = pd2.response?.actions || ai2?.response?.actions || [];
      const sv: string = pd2.analysis?.severity_validation ?? ai2?.analysis?.severity_validation ?? 'MEDIUM';
      for (const ac of acts) {
        if (!ac.type) continue;
        if (!map[ac.type]) map[ac.type] = [];
        if (!map[ac.type].some(x => x.id === a.id)) {
          map[ac.type].push({ id: a.id, sv, alertObj: a });
        }
      }
    }
    return map;
  }, [allAlerts, alert.id]);

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
                <div key={i} className="bg-[var(--s1)] rounded border border-[var(--b3)] px-2 py-1.5 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[0.58rem] font-black uppercase tracking-wider ${actionTone[a.type] || 'bg-blue-100 text-blue-700'}`}>{(a.type || '').replace(/_/g,' ')}</span>
                    <span className="flex-1 text-[0.7rem] font-mono font-bold text-[var(--t6)] truncate">{a.target || '—'}</span>
                  </div>
                  {(sameActionMap[a.type]?.length ?? 0) > 0 && onAlertSelect && (
                    <div className="flex flex-wrap gap-1 items-center">
                      <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Also in:</span>
                      {sameActionMap[a.type].slice(0, 8).map(x => (
                        <button
                          key={x.id}
                          onClick={() => onAlertSelect(x.alertObj)}
                          className={`font-mono text-[0.58rem] font-bold px-1.5 py-0.5 rounded transition-colors ${severityChipColor(x.sv)}`}
                          title={x.alertObj.description}
                        >
                          #{x.id.substring(0, 8).toUpperCase()}
                        </button>
                      ))}
                      {sameActionMap[a.type].length > 8 && (
                        <span className="text-[0.55rem] text-[var(--t3)]">+{sameActionMap[a.type].length - 8} more</span>
                      )}
                    </div>
                  )}
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

const AlertDetail = ({
  alert, onClose, onAction, returnTab, setActiveTab,
  allAlerts = [],
  onAlertSelect,
}: {
  alert: Alert;
  onClose: () => void;
  onAction: (id: string, update: any) => void;
  returnTab?: string;
  setActiveTab?: (t: string) => void;
  allAlerts?: Alert[];
  onAlertSelect?: (a: Alert) => void;
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

  // ── Run timer ──────────────────────────────────────────────────────────────
  const runStartRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    if (!isRerunning) return;
    runStartRef.current = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => {
      setElapsedMs(Date.now() - runStartRef.current!);
    }, 100);
    return () => clearInterval(id);
  }, [isRerunning]);

  const formatElapsed = (ms: number) => {
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

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

  // Rebuild per-agent history whenever ai_analysis changes (new alert OR fresh orchestration result)
  useEffect(() => {
    // Skip during an active rerun — handleRerunFresh will rebuild from the direct response
    if (isRerunning) return;
    let d: any = null;
    try { d = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch (e) {}
    setAgentRunHistory(buildInitialHistory(d));
    setAgentRunIndex({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert.ai_analysis]);

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
    { id: 'recall',      label: 'Memory Recall',    icon: BookOpen,    desc: 'Finds similar past incidents',          getContent: (d: any) => d?.hits?.length ? `${d.hits.length} past incident(s)` : 'No similar hits' },
    { id: 'ioc_check',   label: 'IOC History',      icon: Database,    desc: 'Known IOC observation history',         getContent: (d: any) => d?.hits?.length ? `${d.hits.length} known IOC(s)` : 'No prior observations' },
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
    if (phase === 'recall' && result.recall) {
      updatedAiData.phaseData.recall = result.recall;
    }
    if (phase === 'ioc_check' && result.ioc_check) {
      updatedAiData.phaseData.ioc_check = result.ioc_check;
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
      const result = await orchestrateAnalysis(alert, [], (update) => onAction(alert.id, update));
      // Rebuild per-phase history from the orchestration result so cards light up immediately
      if (result?.ai_analysis) {
        try {
          const newAiData = JSON.parse(result.ai_analysis);
          setAgentRunHistory(buildInitialHistory(newAiData));
          setAgentRunIndex({});
        } catch (_) {}
      }
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
  const totalPhases = agentDefs.length;
  const progressPct = Math.round((completedCount / totalPhases) * 100);
  const runningPhaseLabel = runningPhase ? (agentDefs.find(a => a.id === runningPhase)?.label || runningPhase) : null;

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
          {runningPhaseLabel && (
            <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[0.62rem] font-black uppercase tracking-wide">
              Running: {runningPhaseLabel}
            </span>
          )}
          <span className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest">Pipeline</span>
          <div className="w-28 h-1.5 bg-[var(--s1)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--p1)] rounded-full transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[0.65rem] font-bold text-[var(--t4)]">{completedCount}/{totalPhases} · {progressPct}%</span>
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.72rem] font-bold transition-colors border ${showHistory ? 'bg-[var(--p1)] text-white border-[var(--p1)]' : 'bg-[var(--s1)] hover:bg-[var(--s2)] text-[var(--t6)] border-[var(--b2)]'}`}
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
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--p1)] hover:bg-[var(--pd)] text-white text-[0.72rem] font-bold transition-colors disabled:opacity-60 shadow-sm"
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
          const agentFallbacks = fallbackPhases.filter(p => AGENT_PHASES_UI.some(a => a.phase === p));
          const quotaExhausted = aiData?.quota_exhausted === true;
          const allFallback = aiData && agentFallbacks.length >= AGENT_PHASES_UI.length;
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
                    : `${agentFallbacks.length}/${AGENT_PHASES_UI.length} agents failed — the data shown below is placeholder fallback, not a real assessment. `}
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
              <button type="button" onClick={() => setShowHistory(false)} aria-label="Close run history" className="text-[var(--t3)] hover:text-[var(--t5)]">
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
                const allPhases: Array<'analysis'|'intel'|'knowledge'|'correlation'|'recall'|'ioc_check'|'ticketing'|'response'|'validation'> = ['analysis','intel','knowledge','correlation','recall','ioc_check','ticketing','response','validation'];
                const agentScores = allPhases.map(p => {
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
                        <span className="text-[0.65rem] text-[var(--t3)]">{completedAgents}/{AGENT_PHASES_UI.length} agents</span>
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
                          <div className="grid grid-cols-9 gap-1">
                            {['analysis','intel','knowledge','correlation','recall','ioc_check','ticketing','response','validation'].map((p) => {
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
                                  <span className="text-[0.5rem] text-[var(--t3)] text-center leading-none capitalize">{p === 'ioc_check' ? 'ioc' : p.slice(0,4)}</span>
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
            <p className="text-[0.62rem] font-black uppercase tracking-widest text-[var(--p1)]">Swarm Pipeline</p>
            <div className="flex items-center gap-3">
              {isRerunning && elapsedMs !== null ? (
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[var(--p1)] animate-ping" />
                  <span className="text-[0.65rem] font-mono font-bold text-[var(--p1)] tabular-nums">{formatElapsed(elapsedMs)}</span>
                </div>
              ) : elapsedMs !== null && elapsedMs > 0 ? (
                <span className="text-[0.6rem] font-mono text-green-600 font-semibold">✓ {formatElapsed(elapsedMs)}</span>
              ) : null}
              <span className="text-[0.6rem] font-semibold text-[var(--t3)]">{completedCount}/{agentDefs.length} completed</span>
            </div>
          </div>

          {(() => {
            if (isRerunning) {
              return (
                <div className="px-4 py-3 border-b border-[var(--b3)] bg-[var(--p1)]/5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="skeleton h-2 w-20" style={{ animationDelay: '0ms' }} />
                      <div className="skeleton h-3 w-2/3" style={{ animationDelay: '80ms' }} />
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <div className="skeleton h-5 w-32 rounded-full" style={{ animationDelay: '160ms' }} />
                      <div className="skeleton h-5 w-20" style={{ animationDelay: '240ms' }} />
                    </div>
                  </div>
                </div>
              );
            }
            if (!aiData) return null;
            const plannerLog = (aiData.agentLogs || []).find((l: string) => l.includes('] Planner:'));
            const dispatched = plannerLog ? plannerLog.replace(/.*\] Planner:\s*/, '').trim() : null;
            const isFP = alert.status === 'FALSE_POSITIVE';
            const plannerFallback = Array.isArray(aiData.fallback_phases) && aiData.fallback_phases.includes('planner');
            const traceShort = aiData.trace_id ? aiData.trace_id.slice(0, 8) : null;
            const investigatorCount = INVESTIGATOR_PHASES.filter(p => aiData.phaseData?.[p] != null).length;
            return (
              <div className={`px-4 py-3 border-b border-[var(--b3)] ${isFP ? 'bg-amber-500/10' : 'bg-[var(--p1)]/5'}`}>
                {isFP ? (
                  <div className="flex items-center gap-2">
                    <Zap size={13} className="text-amber-500 shrink-0" />
                    <p className="text-[0.72rem] font-bold text-amber-700 dark:text-amber-400">Short-circuited — high-confidence false positive. Only triage ran; all investigators and composers were skipped.</p>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <p className="text-[0.6rem] font-black uppercase tracking-widest text-[var(--p1)] mb-0.5">Planner Decision</p>
                      {dispatched ? (
                        <p className="text-[0.72rem] text-[var(--t6)] font-mono">{dispatched}</p>
                      ) : (
                        <p className="text-[0.72rem] text-[var(--t3)] italic">{plannerFallback ? 'Planner fell back to defaults (rate-limited)' : 'Run swarm to see planner output'}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      {investigatorCount > 0 && (
                        <span className="text-[0.6rem] font-bold px-2 py-0.5 rounded-full bg-[var(--p1)]/15 text-[var(--p1)] border border-[var(--p1)]/20">
                          {investigatorCount} investigator{investigatorCount !== 1 ? 's' : ''} dispatched
                        </span>
                      )}
                      {plannerFallback && (
                        <span className="text-[0.6rem] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">⚠ fallback</span>
                      )}
                      {traceShort && (
                        <span className="text-[0.58rem] font-mono text-[var(--t3)] px-2 py-0.5 rounded bg-[var(--s1)] border border-[var(--b2)]">trace {traceShort}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {(() => {
            const isFP = alert.status === 'FALSE_POSITIVE';
            const phaseOrder = agentDefs.map(a => a.id);
            const phaseStates = agentDefs.map(agent => {
              const hist = agentRunHistory[agent.id] || [];
              const runCount = hist.length;
              const isDone = runCount > 0;
              const isRunning = runningPhase === agent.id;
              const isFallback = Array.isArray(aiData?.fallback_phases) && aiData.fallback_phases.includes(agent.id);
              const isSkipped = !isFP && aiData?.phaseData && (agent.id in aiData.phaseData) && aiData.phaseData[agent.id] === null;
              return { isDone, isRunning, isFallback, isSkipped };
            });
            const doneCount = phaseStates.filter(p => p.isDone).length;
            const runningCount = phaseStates.filter(p => p.isRunning).length;
            const pendingCount = phaseStates.filter(p => !p.isDone && !p.isRunning && !p.isSkipped).length;
            const fallbackCount = phaseStates.filter(p => p.isFallback).length;

            const getSnippet = (agent: typeof agentDefs[0], result: any) => {
              if (!result) return 'No output yet.';
              const raw = agent.getContent?.(result);
              const text =
                Array.isArray(raw) ? raw.join(', ') :
                typeof raw === 'string' ? raw :
                raw == null ? '' :
                String(raw);
              const compact = text.replace(/\s+/g, ' ').trim();
              if (!compact) return agent.desc;
              return compact.length > 110 ? `${compact.slice(0, 110)}…` : compact;
            };

            const renderPhaseCard = (agent: typeof agentDefs[0]) => {
              const isRunningThis = runningPhase === agent.id;
              const hist = agentRunHistory[agent.id] || [];
              const runCount = hist.length;
              const isDone = runCount > 0;
              const currentIdx = isDone ? (agentRunIndex[agent.id] ?? runCount - 1) : 0;
              const displayResult = isDone ? hist[Math.min(currentIdx, runCount - 1)] : null;
              const confidence = getAgentConfidence(agent.id);
              const confidenceState = getConfidenceStatus(confidence);
              const isViewingLatest = currentIdx === runCount - 1;
              const isExpanded = expandedAgent === agent.id;
              const isFallback = Array.isArray(aiData?.fallback_phases) && aiData.fallback_phases.includes(agent.id);
              const isSkipped = !isFP && aiData?.phaseData && (agent.id in aiData.phaseData) && aiData.phaseData[agent.id] === null;
              const memHits = (agent.id === 'recall' || agent.id === 'ioc_check')
                ? (displayResult?.hits?.length ?? aiData?.phaseData?.[agent.id]?.hits?.length ?? null)
                : null;
              const isSkeleton = isRerunning && !isDone && !isRunningThis;
              const staggerDelay = `${phaseOrder.indexOf(agent.id) * 120}ms`;
              const statusText = isFP || isSkipped ? 'Skipped' : isRunningThis ? 'Running' : isDone ? 'Complete' : 'Pending';

              return (
                <div
                  key={agent.id}
                  className={`rounded-lg border border-[var(--b2)] bg-[var(--s0)] overflow-hidden ${
                    isExpanded ? 'ring-1 ring-[var(--p1)]/30 border-[var(--p1)]/30' : ''
                  } ${(isFP || isSkipped) ? 'opacity-45' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                    className={`w-full px-3 py-2.5 text-left transition-colors ${isExpanded ? 'bg-[var(--p1)]/6' : 'hover:bg-[var(--s1)]'} ${isRunningThis ? 'bg-[var(--p1)]/10' : ''}`}
                  >
                    {isSkeleton ? (
                      <div className="flex items-center gap-3">
                        <div className="skeleton w-7 h-7 rounded-md shrink-0" style={{ animationDelay: staggerDelay }} />
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="skeleton h-2.5 w-40" style={{ animationDelay: staggerDelay }} />
                          <div className="skeleton h-2.5 w-2/3" style={{ animationDelay: staggerDelay }} />
                        </div>
                        <div className="skeleton w-8 h-8 rounded-full shrink-0" style={{ animationDelay: staggerDelay }} />
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                          isRunningThis ? 'bg-[var(--p1)]' : isDone ? 'bg-green-600' : 'bg-[var(--s2)]'
                        }`}>
                          {isRunningThis
                            ? <div className="w-2.5 h-2.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                            : <agent.icon size={13} className={isDone ? 'text-white' : 'text-[var(--t4)]'} />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            <p className="text-[0.72rem] font-bold text-[var(--t7)]">{agent.label}</p>
                            <span className="text-[0.52rem] font-bold px-1.5 py-0.5 rounded border border-[var(--b2)] bg-[var(--s1)] text-[var(--t4)] uppercase tracking-wide">{statusText}</span>
                            {isFallback && !isFP && !isSkipped && (
                              <span className="text-[0.52rem] font-bold px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700 uppercase tracking-wide">Fallback</span>
                            )}
                            {memHits !== null && (
                              <span className="text-[0.52rem] font-bold px-1.5 py-0.5 rounded border border-[var(--p1)]/20 bg-[var(--p1)]/10 text-[var(--p1)]">{memHits} hit{memHits !== 1 ? 's' : ''}</span>
                            )}
                          </div>
                          <p className="text-[0.66rem] text-[var(--t5)] leading-relaxed truncate">{getSnippet(agent, displayResult)}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <ConfidenceDonut value={confidence} />
                          <div className={`text-[0.5rem] font-black px-1.5 py-0.5 rounded border ${confidenceState.cls}`}>
                            {confidenceState.label}
                          </div>
                          <ChevronDown size={14} className={`text-[var(--t3)] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </div>
                    )}
                  </button>

                  {isExpanded && (
                    <div className="border-t border-[var(--b2)] bg-[var(--s1)]/60 px-3 py-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[0.58rem] font-bold px-1.5 py-0.5 rounded border border-[var(--b2)] bg-[var(--s0)] text-[var(--t4)]">
                            confidence {confidence == null ? '—' : `${Math.round(confidence * 100)}%`}
                          </span>
                          {runCount > 0 && (
                            <div className="flex items-center gap-0.5 bg-[var(--s0)] border border-[var(--b2)] rounded-full px-1.5 py-0.5">
                              <button type="button" onClick={(e) => { e.stopPropagation(); navigateAgentRun(agent.id, -1); }} disabled={currentIdx <= 0} className="w-4 h-4 flex items-center justify-center text-[var(--t3)] hover:text-[var(--t6)] disabled:opacity-25">‹</button>
                              <span className={`text-[0.62rem] font-black font-mono px-0.5 ${isViewingLatest ? 'text-green-600' : 'text-amber-600'}`}>{currentIdx + 1}/{runCount}</span>
                              <button type="button" onClick={(e) => { e.stopPropagation(); navigateAgentRun(agent.id, 1); }} disabled={currentIdx >= runCount - 1} className="w-4 h-4 flex items-center justify-center text-[var(--t3)] hover:text-[var(--t6)] disabled:opacity-25">›</button>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleFeedback(agent.id, true); }}
                            disabled={feedbackLoading[`${agent.id}-true`] || !!feedbackSubmitted[agent.id]}
                            className={`p-1 rounded transition-colors disabled:opacity-50 ${feedbackSubmitted[agent.id] === 'up' ? 'text-green-600 bg-green-100' : 'hover:bg-green-100 text-[var(--t3)] hover:text-green-600'}`}
                            title="Mark as accurate"
                          >
                            <ThumbsUp size={14} className={feedbackLoading[`${agent.id}-true`] ? 'animate-pulse' : ''} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleFeedback(agent.id, false); }}
                            disabled={feedbackLoading[`${agent.id}-false`] || !!feedbackSubmitted[agent.id]}
                            className={`p-1 rounded transition-colors disabled:opacity-50 ${feedbackSubmitted[agent.id] === 'down' ? 'text-red-600 bg-red-100' : 'hover:bg-red-100 text-[var(--t3)] hover:text-red-600'}`}
                            title="Mark as inaccurate"
                          >
                            <ThumbsDown size={14} className={feedbackLoading[`${agent.id}-false`] ? 'animate-pulse' : ''} />
                          </button>
                        </div>
                      </div>
                      {displayResult ? (
                        <pre className="bg-slate-950 text-emerald-300 rounded p-3 text-[0.65rem] leading-relaxed font-mono overflow-x-auto max-h-64 overflow-y-auto">{JSON.stringify(displayResult, null, 2)}</pre>
                      ) : (
                        <p className="text-[0.68rem] text-[var(--t4)] italic">No result yet for this agent.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            };

            return (
              <div className="divide-y divide-[var(--b3)]">
                <div className="px-3 py-2 bg-[var(--s1)]/60 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[0.55rem] font-bold px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">Complete {doneCount}</span>
                    <span className="text-[0.55rem] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">Running {runningCount}</span>
                    <span className="text-[0.55rem] font-bold px-1.5 py-0.5 rounded bg-[var(--s0)] text-[var(--t5)] border border-[var(--b2)]">Pending {pendingCount}</span>
                    <span className="text-[0.55rem] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">Fallback {fallbackCount}</span>
                  </div>
                  <span className="text-[0.58rem] text-[var(--t4)]">Confidence = model certainty</span>
                </div>

                <div className="px-3 pt-3 pb-2">
                  <p className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)] mb-2">Mandatory</p>
                  <div className="grid gap-2">
                    {agentDefs.filter(a => MANDATORY_PHASES.includes(a.id)).map(renderPhaseCard)}
                  </div>
                </div>

                <div className="px-3 pt-3 pb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Investigators</p>
                    <span className="text-[0.5rem] font-bold px-1.5 py-0.5 rounded bg-[var(--p1)]/10 text-[var(--p1)] border border-[var(--p1)]/20 uppercase tracking-wide">⚡ parallel</span>
                  </div>
                  <div className="grid gap-2">
                    {agentDefs.filter(a => INVESTIGATOR_PHASES.includes(a.id)).map(renderPhaseCard)}
                  </div>
                </div>

                <div className="px-3 pt-3 pb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Composers</p>
                    <span className="text-[0.5rem] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-[var(--t4)] border border-[var(--b2)] uppercase tracking-wide dark:bg-[var(--s2)] dark:text-[var(--t3)]">→ sequential</span>
                  </div>
                  <div className="grid gap-2">
                    {agentDefs.filter(a => COMPOSER_PHASES.includes(a.id)).map(renderPhaseCard)}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        <InvestigationGrid alert={alert} aiData={aiData} mitreTags={mitreTags} allAlerts={allAlerts} onAlertSelect={onAlertSelect} />

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
            onClick={() => setConfirmAction({ status: 'ESCALATED', label: 'Escalate', message: 'Escalate this alert to the incident queue for immediate analyst attention?', cls: 'bg-[var(--p1)] hover:bg-[var(--pd)]' })}
            className="px-4 py-2 rounded-lg border border-[var(--p1)] text-[var(--p1)] font-semibold text-[0.8rem] bg-[var(--s0)] hover:bg-blue-50 transition-colors"
          >
            Escalate
          </button>
          <button
            type="button"
            onClick={() => setConfirmAction({ status: 'CLOSED', label: 'Close Incident', message: 'Close this incident? This marks the alert as resolved.', cls: 'bg-[#1e8e3e] hover:bg-green-700' })}
            className="px-4 py-2 rounded-lg bg-[var(--p1)] text-white font-bold text-[0.8rem] hover:bg-[var(--pd)] transition-colors shadow-sm"
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

// ── Noise Reduction Analytics Dashboard ─────────────────────────────────────

const NoiseReductionDashboard = () => {
  const toast = useToast();
  const [fpData, setFpData] = useState<any>(null);
  const [fpTimeline, setFpTimeline] = useState<any[]>([]);
  const [noisySources, setNoisySources] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [assets, setAssetsState] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showAddRule, setShowAddRule] = useState(false);
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [newRule, setNewRule] = useState({ name: '', reason: '', source_ip_pattern: '', description_pattern: '', max_severity: 15 });
  const [newAsset, setNewAsset] = useState({ value: '', type: 'ip', role: 'scanner', description: '', fp_default: true });
  const [activeSection, setActiveSection] = useState<'overview'|'rules'|'assets'|'sources'>('overview');

  const reload = useCallback(() => {
    getFpReduction().then(d => d && setFpData(d)).catch(() => {});
    getFpOverTime().then(setFpTimeline).catch(() => {});
    getNoisySources().then(setNoisySources).catch(() => {});
    getSuppressionRules().then(setRules).catch(() => {});
    getAssets().then(setAssetsState).catch(() => {});
    getFpSuggestions().then(setSuggestions).catch(() => {});
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleCreateRule = async () => {
    if (!newRule.name || !newRule.reason) return;
    await createSuppressionRule({ ...newRule, max_severity: newRule.max_severity });
    setNewRule({ name: '', reason: '', source_ip_pattern: '', description_pattern: '', max_severity: 15 });
    setShowAddRule(false);
    toast('Suppression rule created', 'success');
    reload();
  };

  const handleToggleRule = async (id: number, enabled: boolean) => {
    await updateSuppressionRule(id, { enabled: !enabled });
    reload();
  };

  const handleDeleteRule = async (id: number) => {
    await deleteSuppressionRule(id);
    toast('Rule deleted', 'success');
    reload();
  };

  const handleAddAsset = async () => {
    if (!newAsset.value) return;
    await upsertAsset(newAsset);
    setNewAsset({ value: '', type: 'ip', role: 'scanner', description: '', fp_default: true });
    setShowAddAsset(false);
    toast('Asset registered', 'success');
    reload();
  };

  const handleDeleteAsset = async (value: string) => {
    await deleteAsset(value);
    toast('Asset removed', 'success');
    reload();
  };

  const handleAcceptSuggestion = async (value: string, type: string) => {
    await acceptFpSuggestion(value, type);
    toast(`${value} added to known infrastructure`, 'success');
    reload();
  };

  const fpTimelineMax = fpTimeline.length ? Math.max(...fpTimeline.map(t => t.total_fp || 0), 1) : 1;

  const sections = [
    { id: 'overview' as const, label: 'FP Overview' },
    { id: 'rules' as const, label: 'Suppression Rules' },
    { id: 'assets' as const, label: 'Known Assets' },
    { id: 'sources' as const, label: 'Noisy Sources' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 overflow-y-auto h-full">
      <PageHeader
        eyebrow="Intelligence"
        title="Noise Reduction Analytics"
        description="Memory-driven false positive detection, suppression rules, known infrastructure, and analyst time savings."
      />

      {/* Section tabs */}
      <div className="flex gap-2">
        {sections.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`px-4 py-2 rounded-lg text-[0.78rem] font-bold transition-colors ${activeSection === s.id ? 'bg-[var(--p1)] text-white' : 'bg-[var(--s0)] text-[var(--t4)] border border-[var(--b2)] hover:bg-[var(--s1)]'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Overview ──────────────────────────────────────────────────────── */}
      {activeSection === 'overview' && fpData && (
        <>
          <div className="grid grid-cols-5 gap-4">
            {[
              { label: 'Total FPs Detected', value: fpData.total_fp, color: '#f29900' },
              { label: 'Memory-Driven', value: fpData.memory_driven_fp, color: '#1e8e3e' },
              { label: 'Triage (LLM)', value: fpData.triage_driven_fp, color: '#1a73e8' },
              { label: 'Suppression Rules', value: fpData.suppression_driven_fp, color: '#7c3aed' },
              { label: 'Time Saved', value: `${Math.round(fpData.time_saved_minutes / 60)}h`, color: '#059669' },
            ].map(c => (
              <div key={c.label} className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-4 shadow-sm">
                <p className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-widest">{c.label}</p>
                <p className="text-[1.7rem] font-black mt-2 leading-none" style={{ color: c.color }}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* FP Rate & Confidence */}
          <div className="grid grid-cols-3 gap-5">
            <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-5 shadow-sm">
              <p className="text-[0.72rem] font-black text-[var(--t3)] uppercase tracking-wider mb-3">FP Detection Breakdown</p>
              <div className="space-y-3">
                {[
                  { label: 'Memory-Driven (Asset/IOC/Recall)', value: fpData.memory_driven_fp, color: '#1e8e3e', total: fpData.total_fp },
                  { label: 'LLM Triage', value: fpData.triage_driven_fp, color: '#1a73e8', total: fpData.total_fp },
                  { label: 'Suppression Rules', value: fpData.suppression_driven_fp, color: '#7c3aed', total: fpData.total_fp },
                  { label: 'Composer', value: fpData.composer_driven_fp || 0, color: '#f59e0b', total: fpData.total_fp },
                ].map(b => (
                  <div key={b.label}>
                    <div className="flex justify-between text-[0.68rem] mb-1">
                      <span className="text-[var(--t5)] font-semibold">{b.label}</span>
                      <span className="font-black" style={{ color: b.color }}>{b.value} ({b.total > 0 ? Math.round(b.value / b.total * 100) : 0}%)</span>
                    </div>
                    <div className="h-2 bg-[var(--s2)] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${b.total > 0 ? (b.value / b.total) * 100 : 0}%`, backgroundColor: b.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-5 shadow-sm">
              <p className="text-[0.72rem] font-black text-[var(--t3)] uppercase tracking-wider mb-3">Key Metrics</p>
              <div className="space-y-4">
                <div>
                  <p className="text-[0.65rem] text-[var(--t3)] font-bold">Overall FP Rate</p>
                  <p className="text-[1.4rem] font-black text-[var(--t1)]">{(fpData.fp_rate * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-[0.65rem] text-[var(--t3)] font-bold">Avg FP Confidence</p>
                  <p className="text-[1.4rem] font-black text-[var(--t1)]">{fpData.avg_fp_confidence ? (fpData.avg_fp_confidence * 100).toFixed(0) + '%' : '--'}</p>
                </div>
                <div>
                  <p className="text-[0.65rem] text-[var(--t3)] font-bold">Analyzed / Total</p>
                  <p className="text-[1.4rem] font-black text-[var(--t1)]">{fpData.analyzed_alerts} / {fpData.total_alerts}</p>
                </div>
              </div>
            </div>

            <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-5 shadow-sm overflow-hidden">
              <p className="text-[0.72rem] font-black text-[var(--t3)] uppercase tracking-wider mb-3">FP Over Time (30d)</p>
              {fpTimeline.length > 0 ? (
                <div className="flex items-end gap-1 h-[160px]">
                  {fpTimeline.map((t, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                      <div className="w-full bg-[var(--s1)] rounded-sm overflow-hidden flex flex-col-reverse h-28">
                        <div className="w-full rounded-sm" style={{ height: `${fpTimelineMax > 0 ? (t.total_fp / fpTimelineMax) * 100 : 0}%`, minHeight: t.total_fp > 0 ? 3 : 0, background: `linear-gradient(to top, #1e8e3e ${t.memory_fp && t.total_fp ? (t.memory_fp/t.total_fp)*100 : 0}%, #7c3aed ${t.suppression_fp && t.total_fp ? ((t.memory_fp+t.suppression_fp)/t.total_fp)*100 : 0}%, #1a73e8 100%)` }} />
                      </div>
                      <span className="text-[0.5rem] text-[var(--t3)]">{t.day?.slice(5)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[var(--t3)] text-sm">No FP data yet — run agents on alerts to populate.</p>}
            </div>
          </div>

          {/* Auto-Learning Suggestions */}
          {suggestions.length > 0 && (
            <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b bg-amber-50 dark:bg-amber-900/20">
                <p className="text-[0.82rem] font-black text-amber-700 dark:text-amber-400 uppercase tracking-wide">Auto-Learning Suggestions</p>
                <p className="text-[0.68rem] text-amber-600 dark:text-amber-500 mt-0.5">These IOCs are overwhelmingly false positives. Add them to known infrastructure?</p>
              </div>
              <div className="divide-y divide-[var(--b3)]">
                {suggestions.filter((s: any) => !s.already_registered).slice(0, 10).map((s: any) => (
                  <div key={s.value} className="px-5 py-3 flex items-center gap-4">
                    <div className="flex-1">
                      <p className="text-[0.82rem] font-bold text-[var(--t1)] font-mono">{s.value}</p>
                      <p className="text-[0.68rem] text-[var(--t3)]">{s.type} — {s.fp_count} FP / {s.tp_count} TP ({(s.fp_ratio * 100).toFixed(0)}% FP rate)</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[0.6rem] font-black uppercase ${s.suggestion === 'auto_register' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {s.suggestion === 'auto_register' ? 'Recommended' : 'Suggested'}
                    </span>
                    <button onClick={() => handleAcceptSuggestion(s.value, s.type)}
                      className="px-3 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.72rem] font-bold hover:bg-[var(--pd)] transition-colors">
                      Accept
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Suppression Rules ─────────────────────────────────────────────── */}
      {activeSection === 'rules' && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
            <div>
              <p className="text-[0.82rem] font-black text-[var(--p1)] uppercase tracking-wide">Suppression Rules</p>
              <p className="text-[0.65rem] text-[var(--t3)] mt-0.5">Pattern-based rules that auto-dismiss alerts before LLM analysis</p>
            </div>
            <button onClick={() => setShowAddRule(!showAddRule)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.72rem] font-bold hover:bg-[var(--pd)]">
              <Plus size={14} /> Add Rule
            </button>
          </div>
          {showAddRule && (
            <div className="px-5 py-4 border-b bg-[var(--sa)] space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Rule name" value={newRule.name} onChange={e => setNewRule({ ...newRule, name: e.target.value })}
                  className="px-3 py-2 rounded-lg border border-[var(--b2)] bg-[var(--s0)] text-[0.78rem] text-[var(--t1)]" />
                <input placeholder="Reason (shown in logs)" value={newRule.reason} onChange={e => setNewRule({ ...newRule, reason: e.target.value })}
                  className="px-3 py-2 rounded-lg border border-[var(--b2)] bg-[var(--s0)] text-[0.78rem] text-[var(--t1)]" />
                <input placeholder="Source IP pattern (e.g. 172.10.9.0/24)" value={newRule.source_ip_pattern} onChange={e => setNewRule({ ...newRule, source_ip_pattern: e.target.value })}
                  className="px-3 py-2 rounded-lg border border-[var(--b2)] bg-[var(--s0)] text-[0.78rem] text-[var(--t1)]" />
                <input placeholder="Description pattern (pipe-delimited, e.g. XSS|SQLi)" value={newRule.description_pattern} onChange={e => setNewRule({ ...newRule, description_pattern: e.target.value })}
                  className="px-3 py-2 rounded-lg border border-[var(--b2)] bg-[var(--s0)] text-[0.78rem] text-[var(--t1)]" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleCreateRule} className="px-4 py-2 rounded-lg bg-[var(--p1)] text-white text-[0.78rem] font-bold hover:bg-[var(--pd)]">Create</button>
                <button onClick={() => setShowAddRule(false)} className="px-4 py-2 rounded-lg border border-[var(--b2)] text-[var(--t4)] text-[0.78rem] font-bold">Cancel</button>
              </div>
            </div>
          )}
          <div className="divide-y divide-[var(--b3)]">
            {rules.length === 0 && <p className="px-5 py-8 text-center text-[var(--t3)] text-sm">No suppression rules configured yet.</p>}
            {rules.map((r: any) => (
              <div key={r.id} className="px-5 py-3 flex items-center gap-4">
                <button onClick={() => handleToggleRule(r.id, !!r.enabled)}
                  className={`w-10 h-5 rounded-full transition-colors flex items-center ${r.enabled ? 'bg-green-500 justify-end' : 'bg-[var(--s2)] justify-start'}`}>
                  <div className="w-4 h-4 rounded-full bg-white shadow mx-0.5" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-[0.82rem] font-bold text-[var(--t1)]">{r.name}</p>
                  <p className="text-[0.65rem] text-[var(--t3)] font-mono truncate">
                    {[r.source_ip_pattern && `ip:${r.source_ip_pattern}`, r.description_pattern && `desc:${r.description_pattern}`, r.agent_name_pattern && `agent:${r.agent_name_pattern}`].filter(Boolean).join(' | ') || 'No patterns'}
                    {' — '}{r.reason}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[0.82rem] font-black text-[var(--p1)]">{r.hit_count}</p>
                  <p className="text-[0.58rem] text-[var(--t3)] uppercase">hits</p>
                </div>
                <button onClick={() => handleDeleteRule(r.id)} className="text-[var(--t3)] hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Known Assets ──────────────────────────────────────────────────── */}
      {activeSection === 'assets' && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
            <div>
              <p className="text-[0.82rem] font-black text-[var(--p1)] uppercase tracking-wide">Known Infrastructure</p>
              <p className="text-[0.65rem] text-[var(--t3)] mt-0.5">Scanners, monitoring, and backup systems — alerts from these are auto-FP'd</p>
            </div>
            <button onClick={() => setShowAddAsset(!showAddAsset)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.72rem] font-bold hover:bg-[var(--pd)]">
              <Plus size={14} /> Add Asset
            </button>
          </div>
          {showAddAsset && (
            <div className="px-5 py-4 border-b bg-[var(--sa)] space-y-3">
              <div className="grid grid-cols-4 gap-3">
                <input placeholder="Value (IP, hostname, user)" value={newAsset.value} onChange={e => setNewAsset({ ...newAsset, value: e.target.value })}
                  className="px-3 py-2 rounded-lg border border-[var(--b2)] bg-[var(--s0)] text-[0.78rem] text-[var(--t1)]" />
                <select value={newAsset.type} onChange={e => setNewAsset({ ...newAsset, type: e.target.value })}
                  className="px-3 py-2 rounded-lg border border-[var(--b2)] bg-[var(--s0)] text-[0.78rem] text-[var(--t1)]">
                  <option value="ip">IP</option><option value="domain">Domain</option><option value="host">Host</option><option value="user">User</option>
                </select>
                <select value={newAsset.role} onChange={e => setNewAsset({ ...newAsset, role: e.target.value })}
                  className="px-3 py-2 rounded-lg border border-[var(--b2)] bg-[var(--s0)] text-[0.78rem] text-[var(--t1)]">
                  <option value="scanner">Scanner</option><option value="monitoring">Monitoring</option><option value="backup">Backup</option><option value="admin">Admin</option><option value="production">Production</option>
                </select>
                <input placeholder="Description" value={newAsset.description} onChange={e => setNewAsset({ ...newAsset, description: e.target.value })}
                  className="px-3 py-2 rounded-lg border border-[var(--b2)] bg-[var(--s0)] text-[0.78rem] text-[var(--t1)]" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddAsset} className="px-4 py-2 rounded-lg bg-[var(--p1)] text-white text-[0.78rem] font-bold hover:bg-[var(--pd)]">Register</button>
                <button onClick={() => setShowAddAsset(false)} className="px-4 py-2 rounded-lg border border-[var(--b2)] text-[var(--t4)] text-[0.78rem] font-bold">Cancel</button>
              </div>
            </div>
          )}
          <div className="divide-y divide-[var(--b3)]">
            {assets.length === 0 && <p className="px-5 py-8 text-center text-[var(--t3)] text-sm">No assets registered. Run seed-known-assets.ts or add manually.</p>}
            {assets.map((a: any) => (
              <div key={a.value} className="px-5 py-3 flex items-center gap-4">
                <div className={`w-2 h-8 rounded-full ${a.role === 'scanner' ? 'bg-purple-500' : a.role === 'monitoring' ? 'bg-blue-500' : a.role === 'backup' ? 'bg-green-500' : 'bg-slate-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[0.82rem] font-bold text-[var(--t1)] font-mono">{a.value}</p>
                  <p className="text-[0.65rem] text-[var(--t3)]">{a.type} / {a.role} — {a.description || 'No description'}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-[0.6rem] font-black uppercase ${a.fp_default ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                  {a.fp_default ? 'FP Default' : 'Normal'}
                </span>
                <span className="text-[0.6rem] text-[var(--t3)] font-mono">{a.source}</span>
                <button onClick={() => handleDeleteAsset(a.value)} className="text-[var(--t3)] hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Noisy Sources ─────────────────────────────────────────────────── */}
      {activeSection === 'sources' && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-[var(--s1)]">
            <p className="text-[0.82rem] font-black text-[var(--p1)] uppercase tracking-wide">Noisiest Alert Sources</p>
            <p className="text-[0.65rem] text-[var(--t3)] mt-0.5">IPs and agents generating the most false positives — unregistered sources can be added to known infrastructure</p>
          </div>
          <div className="divide-y divide-[var(--b3)]">
            {noisySources.length === 0 && <p className="px-5 py-8 text-center text-[var(--t3)] text-sm">No noisy sources detected yet.</p>}
            {noisySources.map((s: any) => (
              <div key={s.source} className="px-5 py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[0.82rem] font-bold text-[var(--t1)] font-mono">{s.source}</p>
                    {s.role && <span className="px-1.5 py-0.5 rounded bg-[var(--s1)] text-[0.58rem] font-black text-[var(--t3)] uppercase border border-[var(--b2)]">{s.role}</span>}
                    {s.is_registered && <span className="px-1.5 py-0.5 rounded bg-green-100 text-[0.58rem] font-black text-green-700 uppercase">Registered</span>}
                  </div>
                  <p className="text-[0.65rem] text-[var(--t3)]">{s.total_alerts} alerts — {s.fp_count} FP ({(s.fp_rate * 100).toFixed(0)}%)</p>
                </div>
                <div className="w-32">
                  <div className="h-2 bg-[var(--s2)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${s.fp_rate * 100}%` }} />
                  </div>
                </div>
                {!s.is_registered && s.fp_rate >= 0.5 && (
                  <button onClick={() => handleAcceptSuggestion(s.source, s.source_type === 'ip' ? 'ip' : 'host')}
                    className="px-3 py-1.5 rounded-lg border border-[var(--p1)] text-[var(--p1)] text-[0.72rem] font-bold hover:bg-[var(--p1)] hover:text-white transition-colors shrink-0">
                    Register
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

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
      <PageHeader
        eyebrow="Academic Prototype"
        title="Multi-Agent SOC Research Overview"
        description="Wazuh alert ingestion, LangGraph orchestration, evidence generation, and analyst feedback in one evaluation surface."
        right={(
          <button onClick={() => setActiveTab('investigation')} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--p1)] text-white text-[0.78rem] font-bold hover:bg-[var(--pd)] transition-colors">
            <AlertTriangle size={14} />
            Open Investigation
          </button>
        )}
      />

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
            <p className="text-[0.82rem] font-black text-[var(--p1)] uppercase tracking-wide">{AGENT_PHASES_UI.length}-Agent LangGraph Pipeline</p>
            <span className="text-[0.65rem] text-[var(--t3)] font-mono">linear execution · START to END</span>
          </div>
          <div className="p-5 grid gap-2" style={{ gridTemplateColumns: `repeat(${AGENT_PHASES_UI.length}, minmax(0, 1fr))` }}>
            {AGENT_PHASES_UI.map((agent, i) => {
              const stat = agentStats.find(s => s.phase === agent.phase);
              const fallbackPct = stat && stat.total_runs > 0 ? Math.round((stat.fallback_count / stat.total_runs) * 100) : 0;
              const confidence = stat?.avg_confidence;
              return (
                <button key={agent.phase} onClick={() => setActiveTab('settings')} className="text-left group">
                  <div className={`min-h-[146px] border rounded-lg p-3 transition-colors ${fallbackPct > 20 ? 'border-amber-200 bg-amber-50/50' : 'border-[var(--b2)] bg-[var(--s0)] group-hover:bg-[var(--sa)]'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="w-6 h-6 rounded bg-[var(--p1)] text-white flex items-center justify-center text-[0.65rem] font-black">{i + 1}</span>
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
                      <div className="w-full bg-[var(--p1)] rounded-sm" style={{ height: `${trendMax > 0 ? Math.round((t.count / trendMax) * 100) : 0}%`, minHeight: t.count > 0 ? 4 : 0 }} />
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
            <button onClick={() => setActiveTab('investigation')} className="text-[0.68rem] font-bold text-[var(--p1)] hover:underline">View queue</button>
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
    { name: 'Memory Recall Agent', phaseKey: 'recall' },
    { name: 'IOC Memory Agent',    phaseKey: 'ioc_check' },
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
                      className="w-full bg-[var(--p1)] rounded-sm transition-all duration-700"
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
                      className={`h-full transition-all duration-1000 ${loadNum > 80 ? 'bg-[#d93025]' : 'bg-[var(--p1)]'}`}
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--p1)] text-[var(--t7)] text-[0.75rem] font-bold hover:bg-[var(--pd)] transition-colors"
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
            <button type="submit" className="px-4 py-2 rounded-lg bg-[var(--p1)] text-[var(--t7)] text-[0.78rem] font-bold hover:bg-[var(--pd)]">Add Firewall</button>
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
  const [selectedPhase, setSelectedPhase] = useState<AgentPhase>('analysis');

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
      phase: 'recall',
      name: 'Memory Recall Agent',
      desc: 'Finds similar past incidents from insight memory for contextual guidance.',
      prompt: `You are a SOC memory recall agent. Find similar prior incidents to the current alert and return ONLY valid JSON:\n\n{\n  "hits": [\n    {\n      "alert_id": "<historical alert id>",\n      "summary": "<short prior incident summary>",\n      "outcome": "<resolved|escalated|false_positive|other>",\n      "similarity": 0.0\n    }\n  ],\n  "confidence": 0.8\n}`,
    },
    {
      phase: 'ioc_check',
      name: 'IOC History Agent',
      desc: 'Checks IOC memory history (first seen, last seen, volume, and threat level).',
      prompt: `You are an IOC history agent. Check extracted indicators against historical IOC memory and return ONLY valid JSON:\n\n{\n  "hits": [\n    {\n      "value": "<ioc value>",\n      "type": "<ip|domain|hash|user|host|process|file>",\n      "first_seen": "<timestamp or null>",\n      "last_seen": "<timestamp or null>",\n      "alert_count": 0,\n      "threat_level": "<low|medium|high|unknown>"\n    }\n  ],\n  "confidence": 0.8\n}`,
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

  const agentIcons: Record<AgentPhase, any> = {
    analysis:    Search,
    intel:       Crosshair,
    knowledge:   BookOpen,
    correlation: Link2,
    recall:      Clock,
    ioc_check:   Hash,
    ticketing:   FileText,
    response:    Zap,
    validation:  CheckCircle,
  };

  const agentGroups: Array<{ label: string; phases: AgentPhase[] }> = [
    { label: 'Triage (mandatory)',         phases: ['analysis'] },
    { label: 'Investigators (parallel)',   phases: ['intel', 'knowledge', 'correlation', 'recall', 'ioc_check'] },
    { label: 'Composers (sequential)',     phases: ['ticketing', 'response', 'validation'] },
  ];

  const selectedAgent = agentDefs.find(a => a.phase === selectedPhase);
  const selectedModel = config?.assignments?.[selectedPhase] || config?.defaults?.[selectedPhase] || '';
  const selectedStat = getStatForPhase(selectedPhase);

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
    <div className="space-y-6">
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
                <button onClick={handleSaveLocalConfig} disabled={savingLocal} className="px-4 py-2 rounded-lg bg-[var(--p1)] text-white text-[0.75rem] font-bold hover:bg-[var(--pd)] disabled:opacity-50 transition-colors">
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

      {/* ── Agent Configuration: sidebar list + single detail panel ────────── */}
      <div className="grid grid-cols-[280px_1fr] gap-5">
        {/* Left: agent list grouped by orchestration stage */}
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden self-start">
          <div className="px-4 py-3 border-b border-[var(--b1)] bg-[var(--s1)]">
            <h3 className="text-[0.82rem] font-black text-[var(--t7)]">Agents</h3>
            <p className="text-[0.62rem] text-[var(--t3)] mt-0.5">{agentDefs.length} phases · select to configure</p>
          </div>
          <div className="divide-y divide-[var(--b1)]">
            {agentGroups.map(group => (
              <div key={group.label} className="py-2">
                <p className="px-4 pt-1 pb-2 text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-[0.18em]">{group.label}</p>
                {group.phases.map(phase => {
                  const def = agentDefs.find(d => d.phase === phase);
                  if (!def) return null;
                  const Icon = agentIcons[phase];
                  const model = config?.assignments?.[phase] || config?.defaults?.[phase] || '';
                  const isLocal = model.startsWith('local::');
                  const isSelected = selectedPhase === phase;
                  const stat = getStatForPhase(phase);
                  const fallbackPct = stat && stat.total_runs > 0 ? Math.round((stat.fallback_count / stat.total_runs) * 100) : 0;
                  const modelLabel = isLocal ? model.replace('local::', '') : (config?.modelLabels?.[model] || model.split('/').pop() || model);
                  return (
                    <button
                      key={phase}
                      onClick={() => setSelectedPhase(phase)}
                      className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors border-l-2 ${
                        isSelected
                          ? 'bg-[var(--sa)] border-l-[var(--p1)]'
                          : 'border-l-transparent hover:bg-[var(--s1)]'
                      }`}
                    >
                      <Icon size={14} className={isSelected ? 'text-[var(--p1)]' : 'text-[var(--t3)]'} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-[0.76rem] font-bold truncate ${isSelected ? 'text-[var(--p1)]' : 'text-[var(--t7)]'}`}>{def.name}</p>
                        <p className="text-[0.6rem] text-[var(--t3)] truncate font-mono">{model ? modelLabel : '—'}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {fallbackPct > 30 && <AlertTriangle size={10} className="text-amber-600" />}
                        {isLocal && <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Local LLM" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Right: detail panel for the selected agent */}
        {selectedAgent && (() => {
          const isLocalAssigned = selectedModel.startsWith('local::');
          const isSaving = savingPhase === selectedPhase;
          const cloudOptions = config?.availableModels || [];
          const fallbackPct = selectedStat && selectedStat.total_runs > 0 ? Math.round((selectedStat.fallback_count / selectedStat.total_runs) * 100) : 0;
          const Icon = agentIcons[selectedPhase];

          return (
            <div className={`bg-[var(--s0)] border rounded-xl shadow-sm overflow-hidden ${isLocalAssigned ? 'border-green-300' : 'border-[var(--b1)]'}`}>
              {/* Header */}
              <div className={`flex justify-between items-center px-6 py-4 border-b ${isLocalAssigned ? 'bg-green-50/50' : 'bg-[var(--s1)]/50'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isLocalAssigned ? 'bg-green-100' : 'bg-[var(--sa)]'}`}>
                    <Icon size={18} className={isLocalAssigned ? 'text-green-700' : 'text-[var(--p1)]'} />
                  </div>
                  <div>
                    <h3 className="font-black text-[1rem] text-[var(--t7)]">{selectedAgent.name}</h3>
                    <p className="text-[0.6rem] font-mono text-[var(--t3)] uppercase tracking-wider mt-0.5">phase: {selectedPhase}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isLocalAssigned && <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 border border-green-200 text-[0.58rem] font-black uppercase tracking-wide">🖥 LOCAL</span>}
                  <span className="bg-green-50 text-green-600 px-2 py-0.5 rounded text-[0.6rem] font-bold uppercase border border-green-100">Active</span>
                </div>
              </div>

              <div className="p-6 space-y-5">
                {/* Description */}
                <div>
                  <p className="text-[0.62rem] font-black uppercase tracking-wider text-[var(--t3)] block mb-1.5">What this agent does</p>
                  <p className="text-[0.85rem] text-[var(--t5)] leading-relaxed">{selectedAgent.desc}</p>
                </div>

                {/* Model selector */}
                <div className="space-y-1.5">
                  <label className="text-[0.62rem] font-black uppercase tracking-wider text-[var(--t3)] block">Model Assignment</label>
                  <select
                    value={selectedModel}
                    disabled={!isAdmin || loading || isSaving}
                    onChange={(e) => handleModelChange(selectedPhase, e.target.value)}
                    className="w-full border border-[var(--b1)] rounded-lg px-3 py-2.5 text-[0.82rem] outline-none focus:border-[var(--p1)] disabled:opacity-60 bg-[var(--s0)]"
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
                  <div className="flex justify-between items-center pt-0.5">
                    <span className="text-[0.65rem] text-[var(--t3)] font-semibold">
                      {isSaving ? 'Saving…' : isLocalAssigned ? `🖥 Ollama · ${selectedModel.replace('local::', '')}` : '☁ OpenRouter'}
                    </span>
                    {!isAdmin && <span className="text-[0.62rem] text-amber-600 font-bold">Admin-only setting</span>}
                  </div>
                </div>

                {/* Stats strip */}
                <div className="grid grid-cols-3 gap-3 pt-1">
                  <div className="bg-[var(--s1)] border border-[var(--b1)] rounded-lg px-3 py-3 text-center">
                    <p className="text-[0.58rem] font-black text-[var(--t3)] uppercase tracking-wider mb-1">Total Runs</p>
                    <p className="text-[1.1rem] font-black text-[var(--t7)]">{selectedStat?.total_runs ?? '—'}</p>
                  </div>
                  <div className="bg-[var(--s1)] border border-[var(--b1)] rounded-lg px-3 py-3 text-center">
                    <p className="text-[0.58rem] font-black text-[var(--t3)] uppercase tracking-wider mb-1">Avg Confidence</p>
                    <p className={`text-[1.1rem] font-black ${
                      !selectedStat || selectedStat.avg_confidence == null ? 'text-[var(--t3)]' :
                      selectedStat.avg_confidence >= 80 ? 'text-[#1e8e3e]' :
                      selectedStat.avg_confidence >= 60 ? 'text-amber-600' : 'text-[#d93025]'
                    }`}>{selectedStat?.avg_confidence != null ? `${selectedStat.avg_confidence}%` : '—'}</p>
                  </div>
                  <div className="bg-[var(--s1)] border border-[var(--b1)] rounded-lg px-3 py-3 text-center">
                    <p className="text-[0.58rem] font-black text-[var(--t3)] uppercase tracking-wider mb-1">Feedback</p>
                    <p className={`text-[1.1rem] font-black ${
                      !selectedStat || selectedStat.feedback_total === 0 ? 'text-[var(--t3)]' :
                      (selectedStat.feedback_accurate / selectedStat.feedback_total) >= 0.75 ? 'text-[#1e8e3e]' :
                      (selectedStat.feedback_accurate / selectedStat.feedback_total) >= 0.5 ? 'text-amber-600' : 'text-[#d93025]'
                    }`}>{selectedStat && selectedStat.feedback_total > 0 ? `${selectedStat.feedback_accurate}/${selectedStat.feedback_total}` : '—'}</p>
                  </div>
                </div>

                {fallbackPct > 30 && (
                  <div className="flex items-center gap-2 text-[0.72rem] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-bold">
                    <AlertTriangle size={13} />
                    {fallbackPct}% fallback rate — the assigned model may be unavailable. Consider switching providers.
                  </div>
                )}

                {/* System prompt preview */}
                <div className="pt-2 border-t border-[var(--b1)]">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[0.62rem] font-black uppercase tracking-wider text-[var(--t3)]">System Prompt</p>
                    <button onClick={() => setPromptModal({ name: selectedAgent.name, prompt: selectedAgent.prompt })} className="flex items-center gap-1 text-[var(--p1)] text-[0.7rem] font-bold hover:underline">
                      <Eye size={12} />
                      Expand
                    </button>
                  </div>
                  <pre className="text-[0.65rem] bg-slate-950 text-emerald-400 p-3 rounded-lg font-mono leading-relaxed max-h-32 overflow-hidden line-clamp-6 whitespace-pre-wrap">
                    {selectedAgent.prompt}
                  </pre>
                </div>
              </div>
            </div>
          );
        })()}
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

type AdminSection = 'users' | 'system' | 'ai' | 'appearance';
type SystemOpKey = 'reset' | 'clear-investigation' | 'clear-fp';

const SYSTEM_OPS: Record<SystemOpKey, { title: string; description: string; endpoint: string; confirmTitle: string; confirmMessage: string; confirmLabel: string }> = {
  'reset': {
    title: 'Reset All Alerts',
    description: 'Sets every alert back to NEW status and clears AI analysis. Alerts remain in the database but lose their triage state.',
    endpoint: '/api/admin/reset-alerts',
    confirmTitle: 'Reset all alerts?',
    confirmMessage: 'This will reset every alert back to NEW and delete its AI analysis, MITRE tags, and remediation steps. The alerts themselves are kept.',
    confirmLabel: 'Reset Alerts',
  },
  'clear-investigation': {
    title: 'Clear Incidents Queue',
    description: 'Permanently deletes alerts currently in the Incidents queue (TRIAGED / ESCALATED / CLOSED / ANALYZING). The FP archive is preserved.',
    endpoint: '/api/admin/clear-investigation',
    confirmTitle: 'Clear Incidents queue?',
    confirmMessage: 'This will permanently delete every alert in the Incidents queue along with their agent runs, action logs, and working memory. The FP archive is not affected.',
    confirmLabel: 'Clear Queue',
  },
  'clear-fp': {
    title: 'Clear FP Archive',
    description: 'Permanently deletes alerts in the FP archive (FALSE_POSITIVE / FP_CONFIRMED). The Incidents queue is preserved.',
    endpoint: '/api/admin/clear-fp-archive',
    confirmTitle: 'Clear FP archive?',
    confirmMessage: 'This will permanently delete every alert currently archived as a false positive. The Incidents queue is not affected.',
    confirmLabel: 'Clear Archive',
  },
};

const SettingsTab = () => {
  const showToast = useToast();
  const { user, token } = useAuth();
  const { dark, toggle: toggleDark } = useDarkMode();
  const isAdmin = user?.role === 'ADMIN';

  // Sub-tab navigation
  const [section, setSection] = useState<AdminSection>('users');

  // System-wide stats (drives the cards at the top)
  const [stats, setStats] = useState<{ activeIncidents: number; totalAlerts: number; automationRate: string; fpRate: string } | null>(null);

  // Users
  const [users, setUsers]              = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers]= useState(false);
  const [showCreateForm, setShowCreate]= useState(false);
  const [form, setForm]                = useState({ username: '', password: '', email: '', role: 'TIER1' });
  const [createError, setCreateError]  = useState('');
  const [createSuccess, setCreateOk]   = useState('');
  const [editingRole, setEditingRole]  = useState<Record<number, string>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // System ops
  const [confirmOp, setConfirmOp] = useState<SystemOpKey | null>(null);
  const [opRunning, setOpRunning] = useState<SystemOpKey | null>(null);

  const loadUsers = () => {
    if (!isAdmin || !token) return;
    setLoadingUsers(true);
    fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setUsers(data); })
      .finally(() => setLoadingUsers(false));
  };

  const loadStats = () => {
    if (!token) return;
    fetch('/api/stats', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (!data.error) setStats(data); })
      .catch(() => {});
  };

  useEffect(() => { loadUsers(); loadStats(); }, [isAdmin, token]);

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
      if (data.error) { setCreateError(data.error + (data.details ? ': ' + data.details.join(', ') : '')); return; }
      setCreateOk(`User "${data.username}" created successfully.`);
      setUsers(prev => [...prev, data]);
      setForm({ username: '', password: '', email: '', role: 'TIER1' });
      setShowCreate(false);
      showToast(`User "${data.username}" created`, 'success');
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create user');
    }
  };

  const handleRoleChange = async (uid: number, newRole: string) => {
    try {
      const res = await fetch(`/api/users/${uid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to update role', 'error'); return; }
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, role: newRole } : u));
      setEditingRole(prev => { const n = { ...prev }; delete n[uid]; return n; });
      showToast(`Role updated to ${newRole}`, 'success');
    } catch { showToast('Connection error', 'error'); }
  };

  const handleDeleteUser = async (uid: number) => {
    try {
      const res = await fetch(`/api/users/${uid}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to delete user', 'error'); return; }
      setUsers(prev => prev.filter(u => u.id !== uid));
      setDeleteConfirm(null);
      showToast('User deleted', 'success');
    } catch { showToast('Connection error', 'error'); }
  };

  const handleUnlockUser = async (uid: number) => {
    try {
      const res = await fetch(`/api/admin/unlock-user/${uid}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) { loadUsers(); showToast('Account unlocked', 'success'); }
    } catch { showToast('Connection error', 'error'); }
  };

  const isLocked = (u: any) => u.locked_until && new Date(u.locked_until) > new Date();
  const lockedCount = users.filter(isLocked).length;

  const runSystemOp = async (key: SystemOpKey) => {
    const op = SYSTEM_OPS[key];
    setOpRunning(key);
    setConfirmOp(null);
    try {
      const res = await fetch(op.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || `${op.title} failed`, 'error'); return; }
      const count = data.deleted ?? data.reset ?? 0;
      showToast(`${op.title} — ${count} record${count !== 1 ? 's' : ''} affected`, 'success');
      loadStats();
    } catch { showToast('Connection error', 'error'); }
    finally { setOpRunning(null); }
  };

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-3xl mx-auto h-full overflow-y-auto">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-800 flex items-start gap-3">
          <Lock className="w-5 h-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-bold text-[0.95rem]">Admin Ops is restricted to administrators</p>
            <p className="text-[0.8rem] mt-1 opacity-90">Contact your SOC administrator if you need elevated access.</p>
          </div>
        </div>
      </div>
    );
  }

  const sections: Array<{ id: AdminSection; label: string; icon: any }> = [
    { id: 'users',      label: 'Users',       icon: User },
    { id: 'system',     label: 'System Ops',  icon: AlertOctagon },
    { id: 'ai',         label: 'AI Models',   icon: Database },
    { id: 'appearance', label: 'Appearance',  icon: Palette },
  ];

  const statCards = [
    { label: 'Users',            value: users.length,                   subtitle: `${lockedCount} locked`,                  icon: User,         tint: 'text-blue-600',    bg: 'bg-blue-50' },
    { label: 'Active Incidents', value: stats?.activeIncidents ?? '—',  subtitle: 'NEW · ANALYZING · ESCALATED',            icon: AlertOctagon, tint: 'text-red-600',     bg: 'bg-red-50'  },
    { label: 'Total Alerts',     value: stats?.totalAlerts ?? '—',      subtitle: `${stats?.fpRate ?? '—'} false-positive`, icon: Bell,         tint: 'text-amber-600',   bg: 'bg-amber-50' },
    { label: 'Automation Rate',  value: stats?.automationRate ?? '—',   subtitle: 'analyzed by AI agents',                  icon: Activity,     tint: 'text-emerald-600', bg: 'bg-emerald-50' },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-black text-[var(--t7)]">System Administration</h2>
          <p className="text-[0.78rem] text-[var(--t3)] mt-0.5">Manage users, run system operations, and configure AI agents.</p>
        </div>
        <button
          onClick={() => { loadUsers(); loadStats(); showToast('Refreshed', 'info'); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--b2)] text-[0.72rem] font-bold text-[var(--t5)] hover:bg-[var(--s1)] transition-colors"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {statCards.map(s => (
          <div key={s.label} className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 shadow-sm">
            <div className="flex items-start justify-between mb-2">
              <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-wider">{s.label}</p>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${s.bg}`}><s.icon size={14} className={s.tint} /></div>
            </div>
            <p className="text-2xl font-black text-[var(--t7)] leading-none">{s.value}</p>
            <p className="text-[0.65rem] text-[var(--t3)] mt-1.5 font-semibold">{s.subtitle}</p>
          </div>
        ))}
      </div>

      {/* Sub-tab nav */}
      <div className="flex gap-1 bg-[var(--s1)] p-1 rounded-xl border border-[var(--b1)]">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[0.78rem] font-bold transition-all ${
              section === s.id ? 'bg-[var(--s0)] text-[var(--p1)] shadow-sm' : 'text-[var(--t3)] hover:text-[var(--t7)]'
            }`}
          >
            <s.icon size={14} />{s.label}
          </button>
        ))}
      </div>

      {/* Modals */}
      {deleteConfirm !== null && (
        <ConfirmModal
          title="Delete User"
          message={`Delete user "${users.find(u => u.id === deleteConfirm)?.username}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => handleDeleteUser(deleteConfirm)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
      {confirmOp && (
        <ConfirmModal
          title={SYSTEM_OPS[confirmOp].confirmTitle}
          message={SYSTEM_OPS[confirmOp].confirmMessage}
          confirmLabel={SYSTEM_OPS[confirmOp].confirmLabel}
          onConfirm={() => runSystemOp(confirmOp)}
          onCancel={() => setConfirmOp(null)}
        />
      )}

      {/* ─── USERS ─── */}
      {section === 'users' && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-[var(--b1)] bg-[var(--s1)] flex justify-between items-center">
            <div>
              <h3 className="text-[0.88rem] font-black text-[var(--t7)]">User Management</h3>
              <p className="text-[0.68rem] text-[var(--t3)] mt-0.5">{users.length} user{users.length !== 1 ? 's' : ''} · {lockedCount} locked</p>
            </div>
            <button
              onClick={() => setShowCreate(!showCreateForm)}
              className="flex items-center gap-1.5 bg-[var(--p1)] text-white px-3 py-1.5 rounded-lg text-[0.72rem] font-bold hover:bg-[var(--pd)] transition-colors"
            >
              <UserPlus size={13} />
              {showCreateForm ? 'Cancel' : 'Add User'}
            </button>
          </div>

          {showCreateForm && (
            <form onSubmit={handleCreateUser} className="p-5 border-b border-[var(--b1)] bg-[var(--sa)] space-y-3">
              <p className="text-[0.72rem] text-[var(--t3)]">Password must be at least 8 chars with uppercase, lowercase, digit, and special character.</p>
              {createError  && <div className="text-[#d93025] text-[0.78rem] font-semibold bg-red-50 border border-red-200 rounded px-3 py-2">{createError}</div>}
              {createSuccess && <div className="text-[#1e8e3e] text-[0.78rem] font-semibold bg-green-50 border border-green-100 rounded px-3 py-2">{createSuccess}</div>}
              <div className="grid grid-cols-2 gap-3">
                <input required placeholder="Username" value={form.username}
                  onChange={e => setForm({...form, username: e.target.value})}
                  className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
                <input required type="password" placeholder="Password (min 8 chars)" value={form.password}
                  onChange={e => setForm({...form, password: e.target.value})}
                  className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
                <input placeholder="Email (optional)" value={form.email}
                  onChange={e => setForm({...form, email: e.target.value})}
                  className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
                <select value={form.role} onChange={e => setForm({...form, role: e.target.value})}
                  className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]">
                  <option value="TIER1">SOC Analyst L1 (TIER1)</option>
                  <option value="TIER2">SOC Analyst L2 (TIER2)</option>
                  <option value="INCIDENT_LEAD">Incident Lead</option>
                  <option value="ADMIN">Administrator</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="bg-[var(--p1)] text-white px-4 py-1.5 rounded-lg text-sm font-bold hover:bg-[var(--pd)]">Create User</button>
                <button type="button" onClick={() => { setShowCreate(false); setCreateError(''); setCreateOk(''); }} className="border border-[var(--b2)] text-[var(--t5)] px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-[var(--s1)]">Cancel</button>
              </div>
            </form>
          )}

          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--s1)] border-b border-[var(--b1)] text-[var(--t2)] font-bold uppercase text-[0.7rem] tracking-wider">
              <tr>
                <th className="p-3 pl-4">User</th>
                <th className="p-3">Role</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right pr-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--b1)]">
              {loadingUsers ? (
                <tr><td colSpan={4} className="p-6 text-center text-[var(--t3)]">Loading users...</td></tr>
              ) : users.map(u => {
                const locked = isLocked(u);
                const isCurrentUser = u.id === user?.id;
                const currentEditRole = editingRole[u.id] ?? u.role;
                return (
                  <tr key={u.id} className={`hover:bg-[var(--s1)] transition-colors ${locked ? 'bg-red-50/30' : ''}`}>
                    <td className="p-3 pl-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[0.65rem] font-black shrink-0" style={{ backgroundColor: u.avatar_color || '#3b82f6' }}>
                          {(u.display_name || u.username || '?').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
                        </div>
                        <div>
                          <p className="font-semibold text-[0.82rem] text-[var(--t7)]">{u.display_name || u.username}</p>
                          <p className="text-[0.65rem] text-[var(--t3)]">@{u.username} {u.email ? `· ${u.email}` : ''}</p>
                        </div>
                        {isCurrentUser && <span className="text-[0.6rem] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded">you</span>}
                      </div>
                    </td>
                    <td className="p-3">
                      {editingRole[u.id] !== undefined ? (
                        <div className="flex items-center gap-1.5">
                          <select
                            value={currentEditRole}
                            onChange={e => setEditingRole(prev => ({ ...prev, [u.id]: e.target.value }))}
                            className="bg-[var(--s1)] border border-[var(--p1)] rounded px-2 py-1 text-[0.75rem] outline-none"
                          >
                            <option value="TIER1">SOC Analyst L1</option>
                            <option value="TIER2">SOC Analyst L2</option>
                            <option value="INCIDENT_LEAD">Incident Lead</option>
                            <option value="ADMIN">Administrator</option>
                          </select>
                          <button onClick={() => handleRoleChange(u.id, currentEditRole)} className="text-green-600 hover:text-green-700 p-0.5"><CheckCircle size={15} /></button>
                          <button onClick={() => setEditingRole(prev => { const n = {...prev}; delete n[u.id]; return n; })} className="text-[var(--t3)] hover:text-[var(--t6)] p-0.5"><XCircle size={15} /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                            u.role === 'ADMIN'         ? 'bg-purple-100 text-purple-700' :
                            u.role === 'INCIDENT_LEAD' ? 'bg-indigo-100 text-indigo-700' :
                            u.role === 'TIER2'         ? 'bg-blue-100 text-blue-700'     :
                            u.role === 'TIER1'         ? 'bg-cyan-100 text-cyan-700'     :
                            'bg-slate-100 text-slate-600'
                          }`}>{ROLE_LABELS[u.role as UserRole] || u.role}</span>
                          {!isCurrentUser && (
                            <button onClick={() => setEditingRole(prev => ({ ...prev, [u.id]: u.role }))} className="text-[var(--t3)] hover:text-[var(--p1)] transition-colors" title="Edit role">
                              <Edit3 size={12} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      {locked ? (
                        <div className="flex items-center gap-1.5">
                          <span className="flex items-center gap-1 text-[0.72rem] text-red-600 font-semibold"><Lock size={12} />Locked</span>
                          <button onClick={() => handleUnlockUser(u.id)} className="text-[0.65rem] bg-amber-100 text-amber-700 hover:bg-amber-200 font-bold px-2 py-0.5 rounded transition-colors">Unlock</button>
                        </div>
                      ) : (u.failed_logins > 0) ? (
                        <span className="text-[0.72rem] text-amber-600 font-semibold">{u.failed_logins} failed login{u.failed_logins !== 1 ? 's' : ''}</span>
                      ) : (
                        <span className="flex items-center gap-1 text-[0.72rem] text-green-600"><CheckCircle size={12} />Active</span>
                      )}
                    </td>
                    <td className="p-3 pr-4 text-right">
                      {!isCurrentUser && (
                        <button onClick={() => setDeleteConfirm(u.id)} className="text-[var(--t3)] hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50" title="Delete user">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── SYSTEM OPS ─── */}
      {section === 'system' && (
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <AlertOctagon className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-[0.85rem] font-black text-red-700">Danger Zone</p>
              <p className="text-[0.72rem] text-red-700/90 mt-0.5">These operations are immediate and irreversible. They write to the audit log under your account.</p>
            </div>
          </div>

          {(Object.entries(SYSTEM_OPS) as Array<[SystemOpKey, typeof SYSTEM_OPS[SystemOpKey]]>).map(([key, op]) => (
            <div key={key} className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-5 shadow-sm flex items-start justify-between gap-6">
              <div className="flex-1">
                <h4 className="text-[0.88rem] font-black text-[var(--t7)] mb-1">{op.title}</h4>
                <p className="text-[0.75rem] text-[var(--t3)] leading-relaxed">{op.description}</p>
                <p className="text-[0.62rem] text-[var(--t3)] mt-2 font-mono">POST {op.endpoint}</p>
              </div>
              <button
                onClick={() => setConfirmOp(key)}
                disabled={opRunning !== null}
                className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-[0.75rem] font-bold hover:bg-red-100 disabled:opacity-50 transition-colors"
              >
                {opRunning === key ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                {opRunning === key ? 'Running...' : op.confirmLabel}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ─── AI MODELS ─── */}
      {section === 'ai' && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-[var(--b1)] bg-[var(--s1)] flex items-center gap-2">
            <Database className="w-4 h-4 text-[var(--p1)]" />
            <div>
              <h3 className="text-[0.88rem] font-black text-[var(--t7)]">AI Agent Models</h3>
              <p className="text-[0.65rem] text-[var(--t3)]">Assign models to each phase of the orchestration pipeline.</p>
            </div>
          </div>
          <div className="p-5">
            <AgentsTab />
          </div>
        </div>
      )}

      {/* ─── APPEARANCE ─── */}
      {section === 'appearance' && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-6 shadow-sm">
          <h3 className="text-[0.88rem] font-black text-[var(--t7)] mb-4 flex items-center gap-2">
            <Palette size={15} className="text-[var(--p1)]" />Theme & Display
          </h3>
          <div className="flex items-center justify-between py-3 border-b border-[var(--b1)]">
            <div>
              <p className="text-[0.85rem] font-semibold text-[var(--t7)]">Dark Mode</p>
              <p className="text-[0.7rem] text-[var(--t3)] mt-0.5">Switch between light and dark interface for this device</p>
            </div>
            <button
              onClick={toggleDark}
              className={`relative inline-flex h-7 w-13 items-center rounded-full transition-colors duration-200 focus:outline-none ${dark ? 'bg-[var(--p1)]' : 'bg-slate-300'}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-[var(--s0)] shadow-md transition-transform duration-200 ${dark ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </div>
          <p className="text-[0.65rem] text-[var(--t3)] mt-3">Tip: per-user preferences (notifications, avatar, timezone) live in your <span className="font-bold text-[var(--p1)]">Profile</span> page.</p>
        </div>
      )}
    </div>
  );
};

type ActionCategory = 'network' | 'endpoint' | 'identity' | 'monitor' | 'other';

const ACTION_CATEGORIES: Record<ActionCategory, {
  label: string; icon: any; tint: string; bg: string; ring: string; border: string; types: string[];
}> = {
  network:  { label: 'Network',    icon: Shield,   tint: 'text-blue-600',    bg: 'bg-blue-50',    ring: 'ring-blue-200',    border: 'border-l-blue-500',    types: ['BLOCK_IP', 'BLOCK_DOMAIN', 'BLOCK_URL', 'BLOCK_PORT'] },
  endpoint: { label: 'Endpoint',   icon: Database, tint: 'text-purple-600',  bg: 'bg-purple-50',  ring: 'ring-purple-200',  border: 'border-l-purple-500',  types: ['ISOLATE_HOST', 'KILL_PROCESS', 'QUARANTINE_FILE', 'REMOVE_FILE'] },
  identity: { label: 'Identity',   icon: User,     tint: 'text-indigo-600',  bg: 'bg-indigo-50',  ring: 'ring-indigo-200',  border: 'border-l-indigo-500',  types: ['DISABLE_USER', 'RESET_CREDENTIALS', 'REVOKE_TOKENS', 'DISABLE_ACCOUNT', 'FORCE_LOGOUT'] },
  monitor:  { label: 'Monitoring', icon: Eye,      tint: 'text-emerald-600', bg: 'bg-emerald-50', ring: 'ring-emerald-200', border: 'border-l-emerald-500', types: ['MONITOR', 'INVESTIGATE', 'ALERT', 'OBSERVE', 'ESCALATE'] },
  other:    { label: 'Other',      icon: Zap,      tint: 'text-amber-600',   bg: 'bg-amber-50',   ring: 'ring-amber-200',   border: 'border-l-amber-500',   types: [] },
};

const categorize = (type: string): ActionCategory => {
  for (const k of Object.keys(ACTION_CATEGORIES) as ActionCategory[]) {
    if (ACTION_CATEGORIES[k].types.includes(type)) return k;
  }
  return 'other';
};

const timeAgo = (ts: number) => {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

// ── Priority scoring ────────────────────────────────────────────────────────
// Each action item is keyed by (type, target). Score is an absolute 0–100
// with a transparent breakdown: Threat (worst risk among related alerts),
// Reach (how many alerts reference this target), and Urgency (recency +
// approval pressure). The final score weights them 60 / 25 / 15.
type PriorityBreakdown = { score: number; threat: number; reach: number; urgency: number };

const computePriority = (entries: { riskScore: number; timestamp: number; approvalRequired: boolean }[]): PriorityBreakdown => {
  const threat = Math.min(100, Math.max(...entries.map(e => e.riskScore)));
  const reach  = Math.min(100, entries.length * 20);
  const newest = Math.max(...entries.map(e => e.timestamp));
  const ageH   = (Date.now() - newest) / 3_600_000;
  let urgency  = ageH < 1 ? 100 : ageH < 6 ? 70 : ageH < 24 ? 50 : ageH < 168 ? 30 : 10;
  if (entries.some(e => e.approvalRequired)) urgency = Math.min(100, urgency + 20);
  const score = Math.round(threat * 0.6 + reach * 0.25 + urgency * 0.15);
  return { score, threat, reach, urgency };
};

const tierFor = (score: number) =>
  score >= 80 ? { label: 'CRITICAL', text: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-300',     stroke: '#dc2626' } :
  score >= 60 ? { label: 'HIGH',     text: 'text-orange-700',  bg: 'bg-orange-50',  border: 'border-orange-300',  stroke: '#ea580c' } :
  score >= 40 ? { label: 'MEDIUM',   text: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-300',   stroke: '#d97706' } :
                { label: 'LOW',      text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300', stroke: '#10b981' };

const PriorityDonut = ({ value, size = 40 }: { value: number; size?: number }) => {
  const stroke      = 4;
  const radius      = (size - stroke) / 2;
  const circ        = 2 * Math.PI * radius;
  const pct         = Math.max(0, Math.min(100, value));
  const dashOffset  = circ - (pct / 100) * circ;
  const color       = tierFor(pct).stroke;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#e2e8f0" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
          className="transition-[stroke-dashoffset,stroke] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[0.62rem] font-black tabular-nums" style={{ color }}>
        {pct}
      </div>
    </div>
  );
};

const ResponseActionsTab = ({
  alerts,
  setActiveTab,
  setSelectedAlert,
}: {
  alerts: Alert[];
  setActiveTab: (t: string) => void;
  setSelectedAlert: (a: Alert | null) => void;
}) => {
  const [search, setSearch]             = useState('');
  const [activeCats, setActiveCats]     = useState<Set<ActionCategory>>(new Set());
  const [activeTypes, setActiveTypes]   = useState<Set<string>>(new Set());
  const [activeSevs, setActiveSevs]     = useState<Set<string>>(new Set());
  const [sortBy, setSortBy]             = useState<'priority' | 'count' | 'latest' | 'threat'>('priority');
  const [onlyApproval, setOnlyApproval] = useState(false);

  // Each action card represents ONE (type, target) pair, not a type group.
  const actionData = React.useMemo(() => {
    type Entry = {
      alertId: string; sv: string; riskScore: number;
      alertObj: Alert; timestamp: number;
      approvalRequired: boolean;
    };
    type ActionItem = {
      key: string; type: string; target: string; category: ActionCategory;
      entries: Entry[]; count: number;
      latestTimestamp: number;
      approvalRequired: boolean;
      sevCounts: Record<string, number>;
      priority: PriorityBreakdown;
    };

    const map: Record<string, { type: string; target: string; entries: Entry[] }> = {};

    for (const alert of alerts) {
      if (['FALSE_POSITIVE','FP_CONFIRMED'].includes(alert.status)) continue;
      let ai: any = null;
      try { ai = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch {}
      if (!ai) continue;
      const pd = ai.phaseData || {};
      const acts: any[] = pd.response?.actions || ai.response?.actions || [];
      if (!acts.length) continue;
      const riskScore: number = pd.analysis?.risk_score ?? ai.analysis?.risk_score ?? (alert.severity * 4);
      const sv: string = pd.analysis?.severity_validation ?? ai.analysis?.severity_validation ?? 'MEDIUM';
      const ts = new Date(alert.timestamp).getTime();
      const approvalRequired = !!(pd.response?.approval_required ?? ai.response?.approval_required);

      for (const ac of acts) {
        if (!ac.type) continue;
        const target = (ac.target || '').trim();
        const key = `${ac.type}::${target || '__no_target__'}`;
        if (!map[key]) map[key] = { type: ac.type, target, entries: [] };
        map[key].entries.push({ alertId: alert.id, sv, riskScore, alertObj: alert, timestamp: ts, approvalRequired });
      }
    }

    const items: ActionItem[] = Object.entries(map).map(([key, { type, target, entries }]) => {
      const sevCounts = entries.reduce((acc, e) => { acc[e.sv] = (acc[e.sv] || 0) + 1; return acc; }, {} as Record<string, number>);
      return {
        key, type, target,
        category: categorize(type),
        entries,
        count: entries.length,
        latestTimestamp: Math.max(...entries.map(e => e.timestamp)),
        approvalRequired: entries.some(e => e.approvalRequired),
        sevCounts,
        priority: computePriority(entries),
      };
    });

    return items;
  }, [alerts]);

  const availableTypes = React.useMemo(
    () => Array.from(new Set(actionData.map(a => a.type))).sort(),
    [actionData],
  );

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return actionData
      .filter(a => {
        if (activeCats.size  > 0 && !activeCats.has(a.category)) return false;
        if (activeTypes.size > 0 && !activeTypes.has(a.type))    return false;
        if (activeSevs.size  > 0 && !a.entries.some(e => activeSevs.has(e.sv))) return false;
        if (onlyApproval && !a.approvalRequired) return false;
        if (q) {
          const inType   = a.type.toLowerCase().includes(q);
          const inTarget = a.target.toLowerCase().includes(q);
          const inAlert  = a.entries.some(e => e.alertId.toLowerCase().includes(q));
          if (!inType && !inTarget && !inAlert) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'count')  return b.count - a.count;
        if (sortBy === 'latest') return b.latestTimestamp - a.latestTimestamp;
        if (sortBy === 'threat') return b.priority.threat - a.priority.threat;
        return b.priority.score - a.priority.score;
      });
  }, [actionData, activeCats, activeTypes, activeSevs, onlyApproval, search, sortBy]);

  const stats = {
    items:        actionData.length,
    totalAlerts:  actionData.reduce((s, a) => s + a.count, 0),
    critical:     actionData.filter(a => a.priority.score >= 80).length,
    needApproval: actionData.filter(a => a.approvalRequired).length,
  };

  const toggleSet = <T extends string>(set: Set<T>, val: T): Set<T> => {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    return next;
  };

  const filtersActive = activeCats.size > 0 || activeTypes.size > 0 || activeSevs.size > 0 || !!search || onlyApproval;

  if (actionData.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-16 text-center h-full">
        <div>
          <Shield size={40} className="mx-auto text-[var(--t3)] mb-4 opacity-30" />
          <p className="text-[var(--t3)] text-sm font-semibold">No response actions yet</p>
          <p className="text-[var(--t4)] text-xs mt-1">Run agents on alerts to generate response plans.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        {/* Header */}
        <div>
          <h2 className="text-xl font-black text-[var(--t1)]">Response Actions</h2>
          <p className="text-[0.75rem] text-[var(--t3)] mt-1">
            One card per <span className="font-mono text-[var(--t5)]">action × target</span>. Priority is a 0–100 score derived from threat severity, reach, and urgency.
          </p>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Action Items',  value: stats.items,        icon: Zap,            tone: 'text-[var(--t1)]' },
            { label: 'Total Alerts',  value: stats.totalAlerts,  icon: AlertTriangle,  tone: 'text-[var(--t1)]' },
            { label: 'Critical',      value: stats.critical,     icon: Shield,         tone: 'text-red-600' },
            { label: 'Need Approval', value: stats.needApproval, icon: Bell,           tone: 'text-amber-600' },
          ].map(s => (
            <div key={s.label} className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg bg-[var(--s1)] flex items-center justify-center ${s.tone}`}>
                <s.icon size={16} />
              </div>
              <div>
                <div className="text-[1.4rem] font-black tracking-tight leading-none text-[var(--t1)]">{s.value}</div>
                <div className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)] mt-0.5">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Filter bar */}
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3 space-y-2.5">
          <div className="flex gap-2 items-center">
            <div className="flex-1 relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--t3)]" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search action type, target, or alert ID…"
                className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-[var(--b2)] bg-[var(--s1)] text-[0.75rem] text-[var(--t1)] placeholder:text-[var(--t3)] focus:outline-none focus:border-[var(--p1)]"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--t3)] hover:text-[var(--t1)]">
                  <X size={12} />
                </button>
              )}
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="py-1.5 px-2 rounded-lg border border-[var(--b2)] bg-[var(--s1)] text-[0.7rem] font-bold text-[var(--t1)] focus:outline-none focus:border-[var(--p1)]"
            >
              <option value="priority">Sort: Priority</option>
              <option value="threat">Sort: Threat level</option>
              <option value="count">Sort: Most alerts</option>
              <option value="latest">Sort: Latest</option>
            </select>
          </div>

          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Category:</span>
            {(Object.keys(ACTION_CATEGORIES) as ActionCategory[]).map(k => {
              const c = ACTION_CATEGORIES[k];
              const isActive = activeCats.has(k);
              const Icon = c.icon;
              return (
                <button
                  key={k}
                  onClick={() => setActiveCats(toggleSet(activeCats, k))}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[0.65rem] font-bold transition-all ${isActive ? `${c.bg} ${c.tint} border-current ring-2 ring-offset-0 ${c.ring}` : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
                >
                  <Icon size={11} /> {c.label}
                </button>
              );
            })}
          </div>

          {availableTypes.length > 0 && (
            <div className="flex gap-2 items-center flex-wrap">
              <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Action:</span>
              {availableTypes.map(t => {
                const isActive = activeTypes.has(t);
                const cat = ACTION_CATEGORIES[categorize(t)];
                return (
                  <button
                    key={t}
                    onClick={() => setActiveTypes(toggleSet(activeTypes, t))}
                    className={`px-2 py-0.5 rounded-full border text-[0.62rem] font-black uppercase tracking-wider transition-all font-mono ${isActive ? `${cat.bg} ${cat.tint} border-current ring-2 ring-offset-0 ${cat.ring}` : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
                  >
                    {t.replace(/_/g, ' ')}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Severity:</span>
            {(['CRITICAL','HIGH','MEDIUM','LOW'] as const).map(sv => {
              const isActive = activeSevs.has(sv);
              return (
                <button
                  key={sv}
                  onClick={() => setActiveSevs(toggleSet(activeSevs, sv))}
                  className={`px-2 py-0.5 rounded-full border text-[0.62rem] font-black uppercase tracking-wider transition-all ${isActive ? severityChipColor(sv) + ' ring-2 ring-offset-0 ring-current' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
                >
                  {sv}
                </button>
              );
            })}
            <button
              onClick={() => setOnlyApproval(!onlyApproval)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[0.62rem] font-bold transition-all ${onlyApproval ? 'bg-amber-50 text-amber-700 border-amber-300 ring-2 ring-offset-0 ring-amber-200' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
            >
              <Bell size={10} /> Approval only
            </button>
            {filtersActive && (
              <button
                onClick={() => { setActiveCats(new Set()); setActiveTypes(new Set()); setActiveSevs(new Set()); setSearch(''); setOnlyApproval(false); }}
                className="ml-auto text-[0.62rem] font-bold text-[var(--p1)] hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Result count */}
        <div className="text-[0.65rem] font-bold text-[var(--t3)]">
          Showing <span className="text-[var(--t1)]">{filtered.length}</span> of <span className="text-[var(--t1)]">{actionData.length}</span> action item{actionData.length !== 1 ? 's' : ''}
        </div>

        {/* Action cards */}
        {filtered.length === 0 ? (
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-10 text-center">
            <Filter size={28} className="mx-auto text-[var(--t3)] mb-2 opacity-40" />
            <p className="text-[0.78rem] font-semibold text-[var(--t3)]">No actions match your filters.</p>
          </div>
        ) : (
          filtered.map((a, rank) => {
            const cat   = ACTION_CATEGORIES[a.category];
            const Icon  = cat.icon;
            const tier  = tierFor(a.priority.score);

            return (
              <div key={a.key} className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 space-y-3">
                  {/* Top row */}
                  <div className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-[var(--s1)] border border-[var(--b2)] text-[0.65rem] font-black text-[var(--t4)] flex items-center justify-center shrink-0 mt-0.5">
                      {rank + 1}
                    </span>
                    <div className={`w-10 h-10 rounded-lg ${cat.bg} flex items-center justify-center shrink-0`}>
                      <Icon size={18} className={cat.tint} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-[0.85rem] font-black text-[var(--t1)] tracking-tight uppercase">
                          {a.type.replace(/_/g, ' ')}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[0.55rem] font-black uppercase tracking-wider ${cat.bg} ${cat.tint}`}>
                          {cat.label}
                        </span>
                        {a.approvalRequired && (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[0.55rem] font-black uppercase tracking-wider">
                            <Bell size={9} /> Approval
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[0.85rem] font-bold text-[var(--t7)] truncate" title={a.target || 'no target specified'}>
                        {a.target || <span className="italic text-[var(--t3)] font-sans font-normal text-[0.75rem]">no target specified</span>}
                      </div>
                      <div className="flex items-center gap-3 text-[0.62rem] text-[var(--t4)] font-medium mt-1">
                        <span><span className="font-mono font-bold text-[var(--t6)]">{a.count}</span> alert{a.count !== 1 ? 's' : ''}</span>
                        <span className="text-[var(--t3)]">·</span>
                        <span className="flex items-center gap-1"><Clock size={9} /> Latest {timeAgo(a.latestTimestamp)}</span>
                      </div>
                    </div>

                    {/* Priority — tier + donut */}
                    <div className="text-right shrink-0 space-y-2">
                      <div className="flex items-center justify-end gap-2">
                        <span className={`px-1.5 py-0.5 rounded border text-[0.55rem] font-black uppercase tracking-wider ${tier.bg} ${tier.text} ${tier.border}`}>
                          {tier.label}
                        </span>
                        <PriorityDonut value={a.priority.score} size={40} />
                      </div>
                    </div>
                  </div>

                  {/* Severity distribution */}
                  <div className="flex items-center gap-1.5 flex-wrap pl-[3.75rem]">
                    {(['CRITICAL','HIGH','MEDIUM','LOW'] as const).filter(sv => a.sevCounts[sv]).map(sv => (
                      <span key={sv} className={`px-1.5 py-0.5 rounded text-[0.55rem] font-black uppercase tracking-wider ${severityChipColor(sv)} pointer-events-none`}>
                        {a.sevCounts[sv]} {sv}
                      </span>
                    ))}
                  </div>

                  {/* Alert chips & Urgency bar */}
                  <div className="flex items-end justify-between gap-6 pl-[3.75rem]">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Alerts:</span>
                      {a.entries.slice(0, 16).map(e => (
                        <button
                          key={e.alertId}
                          onClick={() => { setSelectedAlert(e.alertObj); setActiveTab('investigation'); }}
                          className={`font-mono text-[0.6rem] font-bold px-1.5 py-0.5 rounded transition-colors ${severityChipColor(e.sv)}`}
                          title={`${e.alertObj.description} — Risk ${e.riskScore} · ${timeAgo(e.timestamp)}`}
                        >
                          #{e.alertId.substring(0, 8).toUpperCase()}
                        </button>
                      ))}
                      {a.entries.length > 16 && (
                        <span className="text-[0.58rem] text-[var(--t3)]">+{a.entries.length - 16} more</span>
                      )}
                    </div>

                    <div className="shrink-0 w-32 space-y-1 pb-0.5" title="Urgency = recency of latest alert + approval pressure">
                      <div className="flex items-center justify-between text-[0.55rem]">
                        <span className="font-black uppercase tracking-widest text-[var(--t3)]">Urgency</span>
                        <span className="font-mono font-bold text-[var(--t6)] tabular-nums">{a.priority.urgency}%</span>
                      </div>
                      <div className="relative h-1 w-full rounded-full overflow-hidden bg-[var(--s1)]">
                        <div
                          className="absolute inset-0"
                          style={{ background: 'linear-gradient(to right, #10b981, #84cc16, #facc15, #f97316, #ef4444)' }}
                        />
                        <div
                          className="absolute inset-y-0 right-0 bg-[var(--s1)] transition-[width] duration-500"
                          style={{ width: `${100 - a.priority.urgency}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ─── Profile Tab ─────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['#3b82f6','#8b5cf6','#ec4899','#f59e0b','#10b981','#ef4444','#06b6d4','#6366f1','#84cc16','#f97316'];
const TIMEZONES = ['UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Europe/Paris','Europe/Berlin','Asia/Tokyo','Asia/Shanghai','Asia/Kolkata','Australia/Sydney'];

const ProfileTab = () => {
  const { user, token, refreshProfile } = useAuth();
  const toast = useToast();

  const [section, setSection] = useState<'profile'|'security'|'preferences'|'activity'>('profile');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    display_name: user?.display_name || '',
    email: user?.email || '',
    bio: user?.bio || '',
    avatar_color: user?.avatar_color || '#3b82f6',
    timezone: user?.timezone || 'UTC',
  });
  useEffect(() => {
    if (user) setForm({
      display_name: user.display_name || '',
      email: user.email || '',
      bio: user.bio || '',
      avatar_color: user.avatar_color || '#3b82f6',
      timezone: user.timezone || 'UTC',
    });
  }, [user?.id]);

  // Security
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwErrors, setPwErrors] = useState<string[]>([]);
  const [pwOk, setPwOk] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwRules, setPwRules] = useState<{ minLength: number; requireUppercase: boolean; requireLowercase: boolean; requireDigit: boolean; requireSpecial: boolean } | null>(null);

  useEffect(() => { fetch('/api/auth/password-rules').then(r => r.json()).then(setPwRules).catch(() => {}); }, []);

  const pwStrength = (() => {
    const pw = pwForm.next;
    if (!pw) return { score: 0, label: '', color: '' };
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    if (s <= 1) return { score: s, label: 'Weak', color: 'bg-red-500' };
    if (s <= 2) return { score: s, label: 'Fair', color: 'bg-orange-500' };
    if (s <= 3) return { score: s, label: 'Good', color: 'bg-yellow-500' };
    return { score: s, label: 'Strong', color: 'bg-green-500' };
  })();

  // Notification prefs
  const [notifyEmail, setNotifyEmail] = useState(user?.notify_email ?? 1);
  const [notifyCritical, setNotifyCritical] = useState(user?.notify_critical ?? 1);
  const [notifyAssign, setNotifyAssign] = useState(user?.notify_assignments ?? 1);
  useEffect(() => {
    if (user) { setNotifyEmail(user.notify_email ?? 1); setNotifyCritical(user.notify_critical ?? 1); setNotifyAssign(user.notify_assignments ?? 1); }
  }, [user?.id]);

  // Activity log
  const [activity, setActivity] = useState<{ id: number; timestamp: string; action: string; details: string }[]>([]);
  useEffect(() => {
    if (section === 'activity' && token) {
      fetch('/api/users/me/activity', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).then(d => { if (Array.isArray(d)) setActivity(d); }).catch(() => {});
    }
  }, [section, token]);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/users/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      if (res.ok) { toast('Profile updated', 'success'); refreshProfile(); setEditing(false); }
      else { const d = await res.json(); toast(d.error || 'Failed', 'error'); }
    } catch { toast('Connection error', 'error'); }
    finally { setSaving(false); }
  };

  const handleSaveNotifications = async () => {
    try {
      const res = await fetch('/api/users/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ notify_email: notifyEmail, notify_critical: notifyCritical, notify_assignments: notifyAssign }),
      });
      if (res.ok) { toast('Preferences saved', 'success'); refreshProfile(); }
    } catch { toast('Failed', 'error'); }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwErrors([]); setPwOk('');
    if (pwForm.next !== pwForm.confirm) { setPwErrors(['Passwords do not match']); return; }
    setPwLoading(true);
    try {
      const res = await fetch('/api/users/me/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      });
      const data = await res.json();
      if (!res.ok) { setPwErrors(data.details || [data.message || 'Failed']); return; }
      setPwOk('Password updated successfully.');
      setPwForm({ current: '', next: '', confirm: '' });
      refreshProfile();
    } catch { setPwErrors(['Connection error']); }
    finally { setPwLoading(false); }
  };

  const timeAgo = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const actionIcons: Record<string, string> = {
    LOGIN: '🔑', LOGOUT: '🚪', PASSWORD_CHANGED: '🔒', PROFILE_UPDATED: '✏️',
    ALERT_STATUS_CHANGE: '🔔', USER_CREATED: '👤', ACCOUNT_LOCKED: '🚫',
  };

  const initials = (user?.display_name || user?.username || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const sections = [
    { id: 'profile' as const, label: 'Profile', icon: User },
    { id: 'security' as const, label: 'Security', icon: Lock },
    { id: 'preferences' as const, label: 'Preferences', icon: Bell },
    { id: 'activity' as const, label: 'Activity', icon: Clock },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 overflow-y-auto h-full">
      {/* Header Card */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden shadow-sm">
        <div className="h-24 bg-gradient-to-r from-[var(--p1)] to-[var(--pd)] relative">
          <div className="absolute -bottom-10 left-6">
            <div className="w-20 h-20 rounded-2xl border-4 border-[var(--s0)] shadow-lg flex items-center justify-center text-white text-2xl font-black" style={{ backgroundColor: user?.avatar_color || '#3b82f6' }}>
              {initials}
            </div>
          </div>
        </div>
        <div className="pt-12 pb-4 px-6 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-black text-[var(--t7)]">{user?.display_name || user?.username}</h2>
            <p className="text-[0.75rem] text-[var(--t3)] mt-0.5">@{user?.username} &middot; {ROLE_LABELS[user?.role as UserRole] || user?.role}</p>
            {user?.bio && <p className="text-[0.8rem] text-[var(--t5)] mt-2 max-w-lg">{user.bio}</p>}
          </div>
          <div className="flex items-center gap-3 text-[0.68rem] text-[var(--t3)]">
            {user?.last_login && <span className="flex items-center gap-1"><Clock size={12} /> Last login: {timeAgo(user.last_login)}</span>}
            {user?.created_at && <span className="flex items-center gap-1"><MapPin size={12} /> Joined {new Date(user.created_at).toLocaleDateString()}</span>}
          </div>
        </div>
      </div>

      {/* Section nav */}
      <div className="flex gap-1 bg-[var(--s1)] p-1 rounded-xl border border-[var(--b1)]">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-[0.78rem] font-bold transition-all ${
              section === s.id ? 'bg-[var(--s0)] text-[var(--p1)] shadow-sm' : 'text-[var(--t3)] hover:text-[var(--t7)]'
            }`}
          >
            <s.icon size={15} />{s.label}
          </button>
        ))}
      </div>

      {/* Profile section */}
      {section === 'profile' && (
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[0.9rem] font-black text-[var(--t7)]">Personal Information</h3>
              {!editing ? (
                <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.72rem] font-bold text-[var(--p1)] border border-[var(--b2)] hover:bg-[var(--s1)]">
                  <Edit3 size={13} />Edit Profile
                </button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg text-[0.72rem] font-bold border border-[var(--b2)] text-[var(--t5)] hover:bg-[var(--s1)]">Cancel</button>
                  <button onClick={handleSaveProfile} disabled={saving} className="px-3 py-1.5 rounded-lg text-[0.72rem] font-bold bg-[var(--p1)] text-white hover:bg-[var(--pd)] disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              )}
            </div>

            {editing ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[0.65rem] font-black text-[var(--t3)] uppercase tracking-wider">Display Name</label>
                  <input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--s1)] border border-[var(--b1)] rounded-lg text-[0.85rem] outline-none focus:border-[var(--p1)]"
                    placeholder="Your full name" />
                </div>
                <div className="space-y-1">
                  <label className="text-[0.65rem] font-black text-[var(--t3)] uppercase tracking-wider">Email</label>
                  <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} type="email"
                    className="w-full px-3 py-2 bg-[var(--s1)] border border-[var(--b1)] rounded-lg text-[0.85rem] outline-none focus:border-[var(--p1)]"
                    placeholder="analyst@aisoc.local" />
                </div>
                <div className="space-y-1">
                  <label className="text-[0.65rem] font-black text-[var(--t3)] uppercase tracking-wider">Bio</label>
                  <textarea value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} rows={3}
                    className="w-full px-3 py-2 bg-[var(--s1)] border border-[var(--b1)] rounded-lg text-[0.85rem] outline-none focus:border-[var(--p1)] resize-none"
                    placeholder="Brief description..." />
                </div>
                <div className="space-y-1">
                  <label className="text-[0.65rem] font-black text-[var(--t3)] uppercase tracking-wider">Timezone</label>
                  <select value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--s1)] border border-[var(--b1)] rounded-lg text-[0.85rem] outline-none focus:border-[var(--p1)]">
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[0.65rem] font-black text-[var(--t3)] uppercase tracking-wider">Avatar Color</label>
                  <div className="flex gap-2 flex-wrap">
                    {AVATAR_COLORS.map(c => (
                      <button key={c} onClick={() => setForm({ ...form, avatar_color: c })}
                        className={`w-8 h-8 rounded-lg transition-all ${form.avatar_color === c ? 'ring-2 ring-offset-2 ring-[var(--p1)] scale-110' : 'hover:scale-110'}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {[
                  { label: 'Display Name', value: user?.display_name || 'Not set', icon: User },
                  { label: 'Email', value: user?.email || 'Not set', icon: Mail },
                  { label: 'Timezone', value: user?.timezone || 'UTC', icon: Globe },
                  { label: 'Username', value: user?.username || '', icon: Terminal },
                ].map(f => (
                  <div key={f.label} className="flex items-center gap-3 py-2 border-b border-[var(--b1)] last:border-0">
                    <f.icon size={16} className="text-[var(--t3)] shrink-0" />
                    <div className="flex-1">
                      <p className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-wider">{f.label}</p>
                      <p className="text-[0.85rem] text-[var(--t7)] font-semibold">{f.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Role card */}
          <div className="space-y-4">
            <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-5 shadow-sm">
              <h4 className="text-[0.72rem] font-black text-[var(--t3)] uppercase tracking-wider mb-3">Role & Permissions</h4>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: user?.avatar_color || '#3b82f6' }}>
                  <Shield size={20} className="text-white" />
                </div>
                <div>
                  <p className="text-[0.85rem] font-bold text-[var(--t7)]">{ROLE_LABELS[user?.role as UserRole] || user?.role}</p>
                  <p className="text-[0.65rem] text-[var(--t3)]">Level {ROLE_LEVEL[user?.role || ''] ?? 0} access</p>
                </div>
              </div>
              <div className="space-y-2">
                {[
                  { perm: 'View Dashboard & Alerts', min: 'TIER1' },
                  { perm: 'Investigate Alerts', min: 'TIER1' },
                  { perm: 'Manage Incidents', min: 'TIER2' },
                  { perm: 'Assign Incidents', min: 'INCIDENT_LEAD' },
                  { perm: 'Admin Panel & Users', min: 'ADMIN' },
                  { perm: 'Clear Queues', min: 'ADMIN' },
                  { perm: 'Integrations Config', min: 'INCIDENT_LEAD' },
                ].map(p => {
                  const has = (ROLE_LEVEL[user?.role || ''] ?? 0) >= (ROLE_LEVEL[p.min] ?? 99);
                  return (
                    <div key={p.perm} className="flex items-center gap-2">
                      {has ? <CheckCircle size={13} className="text-green-600 shrink-0" /> : <XCircle size={13} className="text-[var(--t3)] opacity-40 shrink-0" />}
                      <span className={`text-[0.7rem] ${has ? 'text-[var(--t6)] font-semibold' : 'text-[var(--t3)]'}`}>{p.perm}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-5 shadow-sm">
              <h4 className="text-[0.72rem] font-black text-[var(--t3)] uppercase tracking-wider mb-3">Account Info</h4>
              <div className="space-y-3 text-[0.75rem]">
                <div className="flex justify-between"><span className="text-[var(--t3)]">User ID</span><span className="font-mono font-bold text-[var(--t6)]">#{user?.id}</span></div>
                <div className="flex justify-between"><span className="text-[var(--t3)]">Member since</span><span className="font-semibold text-[var(--t6)]">{user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}</span></div>
                <div className="flex justify-between"><span className="text-[var(--t3)]">Last password change</span><span className="font-semibold text-[var(--t6)]">{user?.password_changed_at ? timeAgo(user.password_changed_at) : 'Never'}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Security section */}
      {section === 'security' && (
        <div className="max-w-lg mx-auto space-y-6">
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-6 shadow-sm">
            <h3 className="text-[0.9rem] font-black text-[var(--t7)] mb-1">Change Password</h3>
            <p className="text-[0.72rem] text-[var(--t3)] mb-5">
              {pwRules ? `Min ${pwRules.minLength} chars, uppercase, lowercase, digit, and special character required.` : 'Loading requirements...'}
            </p>

            {pwErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 space-y-1">
                {pwErrors.map((e, i) => <p key={i} className="text-[0.78rem] text-red-700 font-semibold flex items-center gap-1.5"><XCircle size={13} />{e}</p>)}
              </div>
            )}
            {pwOk && <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4"><p className="text-[0.78rem] text-green-700 font-semibold flex items-center gap-1.5"><CheckCircle size={13} />{pwOk}</p></div>}

            <form onSubmit={handleChangePassword} className="space-y-4">
              {[
                { label: 'Current Password', key: 'current' },
                { label: 'New Password', key: 'next' },
                { label: 'Confirm New Password', key: 'confirm' },
              ].map(({ label, key }) => (
                <div key={key} className="space-y-1">
                  <label className="text-[0.65rem] font-black text-[var(--t3)] uppercase tracking-wider">{label}</label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--t3)]" />
                    <input
                      type="password" required
                      value={(pwForm as any)[key]}
                      onChange={e => setPwForm(prev => ({ ...prev, [key]: e.target.value }))}
                      className="w-full pl-10 pr-3 py-2.5 bg-[var(--s1)] border border-[var(--b1)] rounded-lg text-[0.85rem] outline-none focus:border-[var(--p1)]"
                    />
                  </div>
                </div>
              ))}

              {/* Password strength meter */}
              {pwForm.next && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[0.62rem] font-bold text-[var(--t3)] uppercase">Strength</span>
                    <span className={`text-[0.62rem] font-bold ${pwStrength.score >= 4 ? 'text-green-600' : pwStrength.score >= 3 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {pwStrength.label}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {[1,2,3,4,5].map(i => (
                      <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i <= pwStrength.score ? pwStrength.color : 'bg-[var(--s2)]'}`} />
                    ))}
                  </div>
                </div>
              )}

              <button type="submit" disabled={pwLoading}
                className="w-full py-2.5 bg-[var(--p1)] text-white font-bold text-[0.82rem] rounded-lg hover:bg-[var(--pd)] disabled:opacity-50 transition-colors">
                {pwLoading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <h4 className="text-[0.78rem] font-bold text-amber-800 mb-2">Account Lockout Policy</h4>
            <p className="text-[0.72rem] text-amber-700">After 5 failed login attempts, your account will be locked for 15 minutes. Contact an administrator to unlock your account earlier.</p>
          </div>
        </div>
      )}

      {/* Preferences section */}
      {section === 'preferences' && (
        <div className="max-w-lg mx-auto space-y-6">
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-6 shadow-sm">
            <h3 className="text-[0.9rem] font-black text-[var(--t7)] mb-5">Notification Preferences</h3>
            <div className="space-y-4">
              {[
                { label: 'Email Notifications', desc: 'Receive email alerts for incidents and assignments', val: notifyEmail, set: setNotifyEmail },
                { label: 'Critical Alerts', desc: 'Immediate notification for critical severity alerts', val: notifyCritical, set: setNotifyCritical },
                { label: 'Assignment Alerts', desc: 'Notify when an incident is assigned to you', val: notifyAssign, set: setNotifyAssign },
              ].map(n => (
                <div key={n.label} className="flex items-center justify-between py-3 border-b border-[var(--b1)] last:border-0">
                  <div>
                    <p className="text-[0.82rem] font-semibold text-[var(--t7)]">{n.label}</p>
                    <p className="text-[0.68rem] text-[var(--t3)] mt-0.5">{n.desc}</p>
                  </div>
                  <button onClick={() => n.set(n.val ? 0 : 1)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${n.val ? 'bg-[var(--p1)]' : 'bg-slate-300'}`}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${n.val ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={handleSaveNotifications}
              className="mt-5 px-4 py-2 bg-[var(--p1)] text-white text-[0.78rem] font-bold rounded-lg hover:bg-[var(--pd)] transition-colors">
              Save Preferences
            </button>
          </div>
        </div>
      )}

      {/* Activity section */}
      {section === 'activity' && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b bg-[var(--s1)]">
            <h3 className="text-[0.85rem] font-black text-[var(--t7)]">Recent Activity</h3>
            <p className="text-[0.68rem] text-[var(--t3)]">Your last 50 actions in the system</p>
          </div>
          {activity.length === 0 ? (
            <div className="p-8 text-center text-[var(--t3)] text-[0.82rem]">No activity recorded yet.</div>
          ) : (
            <div className="divide-y divide-[var(--b1)] max-h-[500px] overflow-y-auto">
              {activity.map(a => (
                <div key={a.id} className="px-5 py-3 flex items-start gap-3 hover:bg-[var(--s1)] transition-colors">
                  <span className="text-lg mt-0.5">{actionIcons[a.action] || '📋'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[0.78rem] font-semibold text-[var(--t7)]">{a.action.replace(/_/g, ' ')}</p>
                    <p className="text-[0.7rem] text-[var(--t4)] truncate">{a.details}</p>
                  </div>
                  <span className="text-[0.65rem] text-[var(--t3)] shrink-0 mt-0.5">{timeAgo(a.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const LoginPage = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setLocked(false);
    setAttemptsLeft(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        if (data.locked) setLocked(true);
        if (data.attemptsRemaining !== undefined) setAttemptsLeft(data.attemptsRemaining);
      } else {
        login(data.token, data.user);
      }
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
        <div className="bg-[var(--p1)] p-8 text-white text-center">
          <div className="w-20 h-20 rounded-full bg-[var(--s0)] flex items-center justify-center mx-auto mb-4 shadow-md overflow-hidden">
            <img src="/logo-BBS.png" className="h-14 w-14 object-contain" alt="Black Box Solutions" />
          </div>
          <h1 className="text-[1.4rem] font-bold tracking-tight">BBS AISOC</h1>
          <p className="text-blue-100/70 text-[0.85rem] mt-1 uppercase tracking-widest font-semibold">Black Box Solutions · Cybersecurity</p>
        </div>
        
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {error && (
            <div className={`p-4 rounded border text-[0.85rem] font-semibold ${locked ? 'bg-orange-50 text-orange-800 border-orange-200' : 'bg-red-50 text-[#d93025] border-red-100'}`}>
              <p>{error}</p>
              {attemptsLeft !== null && !locked && (
                <p className="text-[0.72rem] mt-1 opacity-80">{attemptsLeft} attempt{attemptsLeft !== 1 ? 's' : ''} remaining before lockout</p>
              )}
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
            className="w-full bg-[var(--p1)] text-white font-bold py-4 rounded hover:bg-[var(--pd)] transition-all shadow-md disabled:opacity-50 text-[0.9rem] uppercase tracking-widest"
          >
            {loading ? 'Verifying Credentials...' : 'Initialize Session'}
          </button>
          
          <div className="text-center space-y-2">
            <p className="text-[0.7rem] text-[var(--t2)] font-semibold">
              AISOC {new Date().getFullYear()} • SECURE ACCESS
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

// ═══════════════════════════════════════════════════════════════════════════
// NEW TAB COMPONENTS — Pipeline Redesign
// ═══════════════════════════════════════════════════════════════════════════

// ── Dashboard Tab ───────────────────────────────────────────────────────────
type DashboardIncidentCounts = {
  OPEN: number;
  IN_PROGRESS: number;
  CONTAINED: number;
  RESOLVED: number;
  CLOSED: number;
  RECLASSIFIED_FP: number;
};

const toDashboardIncidentCounts = (counts?: Record<string, number>): DashboardIncidentCounts => ({
  OPEN: counts?.OPEN ?? 0,
  IN_PROGRESS: counts?.IN_PROGRESS ?? 0,
  CONTAINED: counts?.CONTAINED ?? 0,
  RESOLVED: counts?.RESOLVED ?? 0,
  CLOSED: counts?.CLOSED ?? 0,
  RECLASSIFIED_FP: counts?.RECLASSIFIED_FP ?? 0,
});

const computeDashboardRiskScore = ({
  activeCritical,
  activeHigh,
  activeMedium,
  openIncidentCount,
  aiRiskPressure,
  containedIncidents,
  resolvedIncidents,
  closedIncidents,
}: {
  activeCritical: number;
  activeHigh: number;
  activeMedium: number;
  openIncidentCount: number;
  aiRiskPressure: number;
  containedIncidents: number;
  resolvedIncidents: number;
  closedIncidents: number;
}) => {
  const rawRisk =
    activeCritical * 5 +
    activeHigh * 2 +
    activeMedium +
    openIncidentCount * 2 +
    aiRiskPressure;
  const mitigation =
    containedIncidents * 2 +
    resolvedIncidents * 3 +
    closedIncidents * 4;
  const bounded = Math.max(0, Math.min(100, Math.round(rawRisk - mitigation)));
  // Keep 100 reserved for sustained critical pressure (>20 critical alerts).
  return activeCritical <= 20 && bounded === 100 ? 99 : bounded;
};

const DashboardTab = ({ alerts, onAlertClick, setActiveTab, onRefreshAlerts }: { alerts: Alert[]; onAlertClick: (a: Alert) => void; setActiveTab: (t: string) => void; onRefreshAlerts?: () => void }) => {
  const { token } = useAuth();
  const [funnel, setFunnel] = useState<any>(null);
  const [trends, setTrends] = useState<Array<{ day: string; count: number }> | null>(null);
  const [agentStats, setAgentStatsState] = useState<AgentStat[]>([]);
  const [incidentCounts, setIncidentCounts] = useState<DashboardIncidentCounts>(() => toDashboardIncidentCounts());
  const [refreshing, setRefreshing] = useState(false);
  const [riskGranularity, setRiskGranularity] = useState<RiskChartGranularity>('days');

  const handleRefresh = () => {
    if (!onRefreshAlerts || refreshing) return;
    setRefreshing(true);
    onRefreshAlerts();
    getIncidents({ limit: 1, offset: 0 })
      .then(data => setIncidentCounts(toDashboardIncidentCounts(data?.counts)))
      .catch(() => setIncidentCounts(toDashboardIncidentCounts()));
    setTimeout(() => setRefreshing(false), 800);
  };

  useEffect(() => {
    if (!token) return;
    getPipelineFunnel().then(setFunnel).catch(() => {});
    fetch('/api/stats/trends', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(data => { if (Array.isArray(data)) setTrends(data); }).catch(() => {});
    getAgentStats().then(setAgentStatsState).catch(() => setAgentStatsState([]));
    getIncidents({ limit: 1, offset: 0 })
      .then(data => setIncidentCounts(toDashboardIncidentCounts(data?.counts)))
      .catch(() => setIncidentCounts(toDashboardIncidentCounts()));
  }, [token]);

  const analyzed = alerts.filter(a => !!a.ai_analysis || ['TRIAGED','FALSE_POSITIVE','ESCALATED','CLOSED','FP_CONFIRMED','FILTERED'].includes(a.status)).length;
  const topThreats = [...alerts]
    .filter(a => !['CLOSED','FALSE_POSITIVE','FP_CONFIRMED'].includes(a.status) && a.status !== 'NEW')
    .sort((a, b) => (getAlertRiskScore(b) ?? b.severity * 6) - (getAlertRiskScore(a) ?? a.severity * 6))
    .slice(0, 6);
  const trendMax = trends ? Math.max(...trends.map(t => t.count), 1) : 1;
  const fallbackAgents = agentStats.filter(s => s.total_runs > 0 && (s.fallback_count / s.total_runs) > 0.2);
  const resolvedStatuses = new Set(['CLOSED', 'FALSE_POSITIVE', 'FP_CONFIRMED', 'FILTERED']);
  const fpStatuses = new Set(['FALSE_POSITIVE', 'FP_CONFIRMED', 'FILTERED']);
  const activeAlerts = alerts.filter(a => !resolvedStatuses.has(a.status));
  const activeCritical = activeAlerts.filter(a => a.severity >= 13).length;
  const activeHigh = activeAlerts.filter(a => a.severity >= 10 && a.severity < 13).length;
  const activeMedium = activeAlerts.filter(a => a.severity >= 7 && a.severity < 10).length;
  const activeEscalated = activeAlerts.filter(a => a.status === 'ESCALATED' || a.status === 'INCIDENT').length;
  const totalAlerts = alerts.length;
  const fpFiltered = alerts.filter(a => fpStatuses.has(a.status) || parseAlertAi(a)?.phaseData?.analysis?.is_false_positive).length;
  const openIncidentCount = incidentCounts.OPEN + incidentCounts.IN_PROGRESS;
  const activeIncidents = openIncidentCount;
  const resolvedHighCritical = alerts.filter(a => resolvedStatuses.has(a.status) && a.severity >= 10).length;
  const aiRiskPressure = activeAlerts.reduce((sum, alert) => {
    const risk = getAlertRiskScore(alert);
    if (risk == null) return sum;
    if (risk >= 80) return sum + 2;
    if (risk >= 60) return sum + 1;
    return sum;
  }, 0);
  const globalRiskScore = computeDashboardRiskScore({
    activeCritical,
    activeHigh,
    activeMedium,
    openIncidentCount,
    aiRiskPressure,
    containedIncidents: incidentCounts.CONTAINED,
    resolvedIncidents: incidentCounts.RESOLVED,
    closedIncidents: incidentCounts.CLOSED,
  });

  const riskSeriesConfig: Record<RiskChartGranularity, { count: number; label: (d: Date) => string; key: (d: Date) => string; shift: (d: Date, offset: number) => void; end: (d: Date) => void }> = {
    hours: {
      count: 24,
      label: d => d.toLocaleTimeString([], { hour: '2-digit' }),
      key: d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}`,
      shift: (d, offset) => d.setHours(d.getHours() + offset),
      end: d => d.setMinutes(59, 59, 999),
    },
    days: {
      count: 30,
      label: d => d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      key: d => d.toISOString().split('T')[0],
      shift: (d, offset) => d.setDate(d.getDate() + offset),
      end: d => d.setHours(23, 59, 59, 999),
    },
    months: {
      count: 12,
      label: d => d.toLocaleDateString([], { month: 'short', year: '2-digit' }),
      key: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      shift: (d, offset) => d.setMonth(d.getMonth() + offset),
      end: d => {
        d.setTime(new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime());
      },
    },
    years: {
      count: 5,
      label: d => String(d.getFullYear()),
      key: d => String(d.getFullYear()),
      shift: (d, offset) => d.setFullYear(d.getFullYear() + offset),
      end: d => {
        d.setMonth(11, 31);
        d.setHours(23, 59, 59, 999);
      },
    },
  };
  const riskSeriesConf = riskSeriesConfig[riskGranularity];
  const riskSeriesPointsBase: RiskSeriesPoint[] = Array.from({ length: riskSeriesConf.count }, (_, idx) => {
    const d = new Date();
    riskSeriesConf.shift(d, -(riskSeriesConf.count - 1 - idx));
    riskSeriesConf.end(d);
    const day = riskSeriesConf.key(d);
    const label = riskSeriesConf.label(d);

    const alertsSoFar = alerts.filter(alert => {
      const ts = new Date(alert.timestamp.replace(' ', 'T')).getTime();
      return Number.isFinite(ts) && ts <= d.getTime();
    });
    const activeSoFar = alertsSoFar.filter(alert => {
      if (!resolvedStatuses.has(alert.status)) return true;
      const closedRaw = (alert as any).closed_at || (alert as any).filtered_at || (alert as any).updated_at;
      if (!closedRaw) return false;
      const closedTs = new Date(String(closedRaw).replace(' ', 'T')).getTime();
      return Number.isFinite(closedTs) && closedTs > d.getTime();
    });
    const activeCrit = activeSoFar.filter(a => a.severity >= 13).length;
    const activeHi = activeSoFar.filter(a => a.severity >= 10 && a.severity < 13).length;
    const activeMed = activeSoFar.filter(a => a.severity >= 7 && a.severity < 10).length;
    const escalated = activeSoFar.filter(a => a.status === 'ESCALATED' || a.status === 'INCIDENT').length;
    const riskPressure = activeSoFar.reduce((sum, alert) => {
      const risk = getAlertRiskScore(alert);
      if (risk == null) return sum;
      if (risk >= 80) return sum + 2;
      if (risk >= 60) return sum + 1;
      return sum;
    }, 0);
    const solvedHighCritical = alerts.filter(alert => {
      if (!resolvedStatuses.has(alert.status) || alert.severity < 10) return false;
      const closedRaw = (alert as any).closed_at || (alert as any).filtered_at || (alert as any).updated_at || alert.timestamp;
      const closedTs = new Date(String(closedRaw).replace(' ', 'T')).getTime();
      return Number.isFinite(closedTs) && closedTs <= d.getTime();
    }).length;

    return {
      day,
      label,
      risk: computeDashboardRiskScore({
        activeCritical: activeCrit,
        activeHigh: activeHi,
        activeMedium: activeMed,
        openIncidentCount: escalated,
        aiRiskPressure: riskPressure,
        containedIncidents: 0,
        resolvedIncidents: 0,
        closedIncidents: 0,
      }),
      activeHighCritical: activeCrit + activeHi,
      solvedHighCritical,
      totalAlerts: alertsSoFar.length,
    };
  });
  const riskSeriesPoints: RiskSeriesPoint[] = riskSeriesPointsBase.map((point, idx) =>
    idx === riskSeriesPointsBase.length - 1 ? { ...point, risk: globalRiskScore } : point
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 overflow-y-auto h-full">
      <PageHeader eyebrow="Overview" title="Aegis SOC Dashboard" description="Real-time alert pipeline, FP filtering efficiency, and system health." />

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Alerts', value: totalAlerts, sub: `${analyzed} processed`, icon: AlertTriangle, color: '#004a99' },
          { label: 'FP Filtered', value: fpFiltered, sub: `${totalAlerts ? Math.round((fpFiltered / totalAlerts) * 100) : 0}% of all alerts`, icon: Filter, color: '#f29900' },
          { label: 'Active Incidents', value: activeIncidents, sub: 'open incident pipeline', icon: Search, color: '#7c3aed' },
          { label: 'Escalated', value: activeEscalated, sub: 'incident queue depth', icon: Shield, color: '#d93025' },
        ].map(card => (
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

      <div className="grid grid-cols-[minmax(0,2fr)_320px] gap-5 items-stretch">
        <div className="space-y-3">
          <PipelineRiskTimeSeries
            points={riskSeriesPoints}
            granularity={riskGranularity}
            setGranularity={setRiskGranularity}
          />
        </div>
        <GlobalRiskDonut
          score={globalRiskScore}
          critical={activeCritical}
          high={activeHigh}
          resolvedHighCritical={resolvedHighCritical}
        />
      </div>

      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-[var(--b1)] flex justify-between items-center bg-[var(--s1)]/50">
          <h3 className="text-[0.82rem] font-black text-[var(--p1)] flex items-center gap-2"><Activity className="w-4 h-4" />LIVE ALERT STREAM (WAZUH)</h3>
          <div className="flex items-center gap-3">
            <span className="text-[0.65rem] text-[var(--t2)] font-mono">{alerts.length} ALERTS</span>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh alert list"
              className="flex items-center gap-1.5 px-2 py-1 rounded border border-[var(--b2)] text-[0.65rem] font-bold text-[var(--t4)] hover:bg-[var(--s1)] hover:text-[var(--p1)] transition-colors disabled:opacity-50"
            >
              <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {alerts.length > 0 ? (
            [...alerts].sort((a, b) => new Date(b.timestamp.replace(' ', 'T')).getTime() - new Date(a.timestamp.replace(' ', 'T')).getTime()).slice(0, 30).map(alert => {
              const sevLabel = alert.severity >= 13 ? 'CRIT' : alert.severity >= 10 ? 'HIGH' : alert.severity >= 7 ? 'MED' : 'LOW';
              const sevColor = alert.severity >= 13 ? 'text-red-500 bg-red-50' : alert.severity >= 10 ? 'text-orange-500 bg-orange-50' : alert.severity >= 7 ? 'text-blue-500 bg-blue-50' : 'text-green-500 bg-green-50';
              return (
                <div key={alert.id} onClick={() => onAlertClick(alert)} className="px-4 py-2.5 border-b border-[var(--b1)] cursor-pointer hover:bg-[var(--sa)] flex items-center gap-3">
                  <span className="text-[0.58rem] text-[var(--t3)] font-mono shrink-0 w-14">{new Date(alert.timestamp.replace(' ', 'T')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[0.55rem] font-black shrink-0 ${sevColor}`}>L{alert.severity} {sevLabel}</span>
                  <p className="text-[0.72rem] text-[var(--t7)] truncate flex-1">{alert.description}</p>
                  <span className="text-[0.6rem] text-[var(--t3)] font-mono shrink-0">{alert.source_ip || '—'}</span>
                  <span className="text-[0.58rem] text-[var(--t2)] shrink-0 w-16 truncate text-right">{alert.agent_name}</span>
                </div>
              );
            })
          ) : (
            <div className="h-32 flex items-center justify-center text-[var(--t3)] text-sm opacity-50">
              <Activity className="w-8 h-8 animate-pulse mr-2" /> Waiting for Wazuh alerts...
            </div>
          )}
        </div>
      </div>



      {/* Top Active Threats */}
      {topThreats.length > 0 && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
            <p className="text-[0.82rem] font-black text-[var(--p1)] uppercase tracking-wide">Top Active Threats</p>
            <button onClick={() => setActiveTab('investigation')} className="text-[0.68rem] font-bold text-[var(--p1)] hover:underline">View all</button>
          </div>
          <div className="divide-y divide-slate-100">
            {topThreats.map(alert => {
              const risk = getAlertRiskScore(alert);
              return (
                <button key={alert.id} onClick={() => onAlertClick(alert)} className="w-full px-5 py-3 text-left hover:bg-[var(--s1)] flex items-center gap-4">
                  <span className={`w-2 h-8 rounded-full ${alert.severity >= 12 ? 'bg-red-500' : alert.severity >= 10 ? 'bg-orange-500' : 'bg-blue-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[0.82rem] font-bold text-[var(--t7)] truncate">{alert.description}</p>
                    <p className="text-[0.62rem] text-[var(--t3)] font-mono mt-0.5">{alert.source_ip} · {alert.agent_name} · {alert.status}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[0.72rem] font-black text-[var(--t6)]">{risk != null ? `${risk}%` : `L${alert.severity}`}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};


// ── Noise Filter Tab ────────────────────────────────────────────────────────
const NoiseFilterTab = ({ alerts, setActiveTab, autoFilter, setAutoFilter }: { alerts: Alert[]; setActiveTab: (t: string) => void; autoFilter: boolean; setAutoFilter: (v: boolean) => void }) => {
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [fpResults, setFpResults] = useState<any[]>([]);
  const [fpData, setFpData] = useState<any>(null);
  const [rules, setRules] = useState<any[]>([]);
  const [assets, setAssetsState] = useState<any[]>([]);
  const [showAddRule, setShowAddRule] = useState(false);
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [newRule, setNewRule] = useState({ name: '', reason: '', source_ip_pattern: '', description_pattern: '', max_severity: 15 });
  const [newAsset, setNewAsset] = useState({ value: '', type: 'ip', role: 'scanner', description: '', fp_default: true });
  const [activeSection, setActiveSection] = useState<'filter' | 'rules' | 'assets'>('filter');

  const unscanned = alerts.filter(a => a.status === 'NEW');
  const recentFp = alerts.filter(a => a.status === 'FALSE_POSITIVE' || a.status === 'FP_CONFIRMED').slice(0, 20);
  const [unscannedSearch, setUnscannedSearch] = useState('');
  const [unscannedSevs, setUnscannedSevs] = useState<Set<'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'>>(new Set());

  const reload = useCallback(() => {
    getFpReduction().then(d => d && setFpData(d)).catch(() => {});
    getSuppressionRules().then(setRules).catch(() => {});
    getAssets().then(setAssetsState).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const handleScanAll = async () => {
    setScanning(true);
    try {
      const result: any = await fpScanBatch();
      const fps  = (result.results || []).filter((r: any) => r.status === 'FALSE_POSITIVE');
      const incs = (result.results || []).filter((r: any) => r.status === 'TRIAGED' || r.status === 'ESCALATED');
      setFpResults(fps);
      toast(`Scanned ${result.scanned}: ${fps.length} → FP archive · ${incs.length} → Investigation`, 'success');
    } catch { toast('Batch scan failed', 'error'); }
    setScanning(false);
  };

  const handleScanOne = async (alertId: string) => {
    setScanningId(alertId);
    try {
      const result = await fpScan(alertId);
      if (result.is_fp) {
        setFpResults(prev => [...prev, { id: alertId, ...result }]);
        toast(`FP detected: ${result.fp_reason?.slice(0, 60)}`, 'success');
      } else {
        toast('Not FP — moved to Incidents queue', 'success');
      }
    } catch { toast('Scan failed', 'error'); }
    setScanningId(null);
  };

  const handleConfirmFp = async (alertId: string) => {
    await confirmFp(alertId);
    setFpResults(prev => prev.filter(r => r.id !== alertId));
    toast('FP confirmed', 'success');
  };

  const handleOverrideFp = async (alertId: string) => {
    await overrideFp(alertId);
    setFpResults(prev => prev.filter(r => r.id !== alertId));
    toast('Sent to Incidents queue', 'success');
  };

  const handleCreateRule = async () => {
    if (!newRule.name || !newRule.reason) return;
    await createSuppressionRule({ ...newRule, max_severity: newRule.max_severity });
    setNewRule({ name: '', reason: '', source_ip_pattern: '', description_pattern: '', max_severity: 15 });
    setShowAddRule(false); toast('Rule created', 'success'); reload();
  };

  const handleAddAsset = async () => {
    if (!newAsset.value) return;
    await upsertAsset(newAsset);
    setNewAsset({ value: '', type: 'ip', role: 'scanner', description: '', fp_default: true });
    setShowAddAsset(false); toast('Asset registered', 'success'); reload();
  };

  const fpMethodBadge = (method: string | null) => {
    const styles: Record<string, string> = {
      suppression: 'bg-blue-100 text-blue-800',
      memory: 'bg-green-100 text-green-800',
      triage: 'bg-purple-100 text-purple-800',
    };
    return method ? <span className={`px-2 py-0.5 rounded-full text-[0.58rem] font-black uppercase ${styles[method] || 'bg-gray-100 text-gray-700'}`}>{method}</span> : null;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 overflow-y-auto h-full">
      <PageHeader eyebrow="Pipeline Step 1" title="Noise Filter" description="Scan incoming alerts. Confirmed FPs are archived; real incidents (HIGH/CRITICAL) advance to the Incidents tab and trigger Telegram." />

      {/* Auto-Filter Toggle */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${autoFilter ? 'bg-green-100' : 'bg-gray-100'}`}>
            <Zap size={20} className={autoFilter ? 'text-green-600' : 'text-gray-400'} />
          </div>
          <div>
            <p className="text-[0.82rem] font-black text-[var(--t7)]">Auto-Investigate on Arrival</p>
            <p className="text-[0.65rem] text-[var(--t3)]">
              {autoFilter
                ? 'Enabled — incoming Wazuh alerts run the full agent pipeline. FPs go to archive, real incidents fire Telegram/email/Slack.'
                : 'Disabled — new alerts sit in NEW status until you investigate manually.'}
            </p>
          </div>
        </div>
        <button onClick={() => { setAutoFilter(!autoFilter); toast(autoFilter ? 'Auto-investigate disabled' : 'Auto-investigate enabled — new alerts will run the full pipeline', 'success'); }}
          className={`relative w-14 h-7 rounded-full transition-colors ${autoFilter ? 'bg-green-500' : 'bg-gray-300'}`}>
          <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${autoFilter ? 'translate-x-7' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {/* Stats */}
      {fpData && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total FPs', value: fpData.total_fp, color: '#f29900' },
            { label: 'Suppression', value: fpData.suppression_driven_fp, color: '#1a73e8' },
            { label: 'Memory-Driven', value: fpData.memory_driven_fp, color: '#1e8e3e' },
            { label: 'Time Saved', value: `${fpData.time_saved_minutes}m`, color: '#7c3aed' },
          ].map(c => (
            <div key={c.label} className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-3">
              <p className="text-[0.58rem] font-black text-[var(--t3)] uppercase tracking-widest">{c.label}</p>
              <p className="text-[1.4rem] font-black mt-1" style={{ color: c.color }}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Section Tabs */}
      <div className="flex gap-2">
        {[
          { id: 'filter' as const, label: `Scan & Filter (${unscanned.length} new)` },
          { id: 'rules' as const, label: `Suppression Rules (${rules.length})` },
          { id: 'assets' as const, label: `Known Assets (${assets.length})` },
        ].map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`px-4 py-2 rounded-lg text-[0.75rem] font-bold transition-colors ${activeSection === s.id ? 'bg-[var(--p1)] text-white' : 'bg-[var(--s0)] text-[var(--t4)] border border-[var(--b2)] hover:bg-[var(--s1)]'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Filter Section ──────────────────────────────────────────────── */}
      {activeSection === 'filter' && (
        <div className="grid grid-cols-2 gap-5">
          {/* Left: Unscanned */}
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
              <p className="text-[0.78rem] font-black text-[var(--t7)]">Unscanned Alerts ({unscanned.length})</p>
              <button onClick={handleScanAll} disabled={scanning || unscanned.length === 0}
                className="px-3 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.68rem] font-bold hover:bg-[var(--pd)] disabled:opacity-50 flex items-center gap-1.5">
                <Zap size={12} />{scanning ? 'Scanning...' : 'Scan All'}
              </button>
            </div>

            {/* Filter bar — search + severity chips */}
            <div className="px-3 py-2.5 border-b border-[var(--b1)] bg-[var(--s0)] space-y-2.5">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--t3)]" />
                <input
                  type="text"
                  placeholder="Search description, IP, agent, or alert ID…"
                  value={unscannedSearch}
                  onChange={e => setUnscannedSearch(e.target.value)}
                  className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-[var(--b2)] bg-[var(--s1)] text-[0.75rem] text-[var(--t1)] placeholder:text-[var(--t3)] focus:outline-none focus:border-[var(--p1)]"
                />
                {unscannedSearch && (
                  <button onClick={() => setUnscannedSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--t3)] hover:text-[var(--t1)]">
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Severity:</span>
                {(['CRITICAL','HIGH','MEDIUM','LOW'] as const).map(sv => {
                  const isActive = unscannedSevs.has(sv);
                  return (
                    <button
                      key={sv}
                      onClick={() => setUnscannedSevs(prev => {
                        const next = new Set(prev);
                        next.has(sv) ? next.delete(sv) : next.add(sv);
                        return next;
                      })}
                      className={`px-2 py-0.5 rounded-full border text-[0.62rem] font-black uppercase tracking-wider transition-all ${isActive ? severityChipColor(sv) + ' ring-2 ring-offset-0 ring-current' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
                    >
                      {sv}
                    </button>
                  );
                })}
                {(unscannedSearch || unscannedSevs.size > 0) && (
                  <button
                    onClick={() => { setUnscannedSearch(''); setUnscannedSevs(new Set()); }}
                    className="ml-auto text-[0.62rem] font-bold text-[var(--p1)] hover:underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 max-h-[480px] overflow-y-auto divide-y divide-[var(--b1)]">
              {(() => {
                const q = unscannedSearch.toLowerCase();
                const sevOf = (s: number) =>
                  s >= 12 ? 'CRITICAL' : s >= 10 ? 'HIGH' : s >= 7 ? 'MEDIUM' : 'LOW';
                const filtered = unscanned.filter(a => {
                  const matchesText = !q ||
                    a.description?.toLowerCase().includes(q) ||
                    a.source_ip?.toLowerCase().includes(q) ||
                    a.agent_name?.toLowerCase().includes(q) ||
                    a.id?.toLowerCase().includes(q);
                  const matchesSev = unscannedSevs.size === 0 || unscannedSevs.has(sevOf(a.severity) as any);
                  return matchesText && matchesSev;
                });
                if (unscanned.length === 0) return (
                  <div className="p-8 text-center text-[var(--t3)] text-[0.78rem]">No unscanned alerts. All clear.</div>
                );
                if (filtered.length === 0) return (
                  <div className="p-6 text-center text-[var(--t3)] text-[0.78rem]">No alerts match the current filters.</div>
                );
                return filtered.map(a => (
                  <div key={a.id} className="px-4 py-3 flex items-center gap-3 hover:bg-[var(--sa)] group">
                    <span className={`w-1.5 h-8 rounded-full shrink-0 ${a.severity >= 12 ? 'bg-red-500' : a.severity >= 10 ? 'bg-orange-400' : a.severity >= 7 ? 'bg-yellow-400' : 'bg-blue-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[0.75rem] font-semibold text-[var(--t7)] truncate">{a.description}</p>
                      <p className="text-[0.6rem] text-[var(--t3)] font-mono">{a.source_ip} · {a.agent_name} · sev {a.severity}</p>
                    </div>
                    <button onClick={() => handleScanOne(a.id)} disabled={scanningId === a.id}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.62rem] font-bold hover:bg-[var(--pd)] disabled:opacity-50 flex items-center gap-1 transition-colors">
                      {scanningId === a.id
                        ? <><div className="w-2.5 h-2.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />Scanning</>
                        : <><Zap size={10} />Scan</>}
                    </button>
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* Right: FP Verdicts */}
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b bg-[var(--s1)]">
              <p className="text-[0.78rem] font-black text-[var(--t7)]">FP Verdicts ({fpResults.length + recentFp.length})</p>
            </div>
            <div className="max-h-[420px] overflow-y-auto divide-y divide-[var(--b1)]">
              {fpResults.length === 0 && recentFp.length === 0 ? (
                <div className="p-8 text-center text-[var(--t3)] text-[0.78rem]">Run a scan to see FP verdicts here.</div>
              ) : (
                <>
                  {fpResults.map(r => (
                    <div key={r.id} className="px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2">
                        {fpMethodBadge(r.fp_method)}
                        <span className="text-[0.65rem] font-bold text-[var(--t7)]">{r.fp_confidence ? `${(r.fp_confidence * 100).toFixed(0)}% confidence` : ''}</span>
                      </div>
                      <p className="text-[0.72rem] text-[var(--t7)]">{r.fp_reason || 'False positive detected'}</p>
                      {r.fp_details && (
                        <div className="text-[0.6rem] text-[var(--t3)] bg-[var(--sa)] rounded p-2">
                          {r.fp_details.rule_name && <span>Rule: {r.fp_details.rule_name}</span>}
                          {r.fp_details.known_asset && <span>Asset: {r.fp_details.known_asset.value} ({r.fp_details.known_asset.role})</span>}
                          {r.fp_details.similar_incident && <span>Similar: {(r.fp_details.similar_incident.similarity * 100).toFixed(0)}% match</span>}
                          {r.fp_details.ioc_pattern && <span>IOC: {r.fp_details.ioc_pattern.value} (fp_ratio={r.fp_details.ioc_pattern.fp_ratio})</span>}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => handleConfirmFp(r.id)} className="px-3 py-1 rounded bg-green-100 text-green-800 text-[0.62rem] font-bold hover:bg-green-200">Confirm FP</button>
                        <button onClick={() => handleOverrideFp(r.id)} className="px-3 py-1 rounded bg-amber-100 text-amber-800 text-[0.62rem] font-bold hover:bg-amber-200">Override → Investigate</button>
                      </div>
                    </div>
                  ))}
                  {recentFp.map(a => (
                    <div key={a.id} className="px-4 py-2.5 flex items-center gap-3 opacity-70">
                      <XCircle size={14} className="text-amber-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[0.7rem] text-[var(--t6)] truncate">{a.description}</p>
                        <p className="text-[0.58rem] text-[var(--t3)] font-mono">{a.source_ip} · {a.status}</p>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Suppression Rules ───────────────────────────────────────────── */}
      {activeSection === 'rules' && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
            <p className="text-[0.78rem] font-black text-[var(--t7)]">Suppression Rules</p>
            <button onClick={() => setShowAddRule(!showAddRule)} className="px-3 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.68rem] font-bold hover:bg-[var(--pd)] flex items-center gap-1"><Plus size={12} />Add Rule</button>
          </div>
          {showAddRule && (
            <div className="p-4 bg-[var(--sa)] border-b border-[var(--b1)] grid grid-cols-2 gap-3">
              <input placeholder="Rule name" value={newRule.name} onChange={e => setNewRule(r => ({ ...r, name: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]" />
              <input placeholder="Reason" value={newRule.reason} onChange={e => setNewRule(r => ({ ...r, reason: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]" />
              <input placeholder="Source IP / CIDR" value={newRule.source_ip_pattern} onChange={e => setNewRule(r => ({ ...r, source_ip_pattern: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]" />
              <input placeholder="Description regex" value={newRule.description_pattern} onChange={e => setNewRule(r => ({ ...r, description_pattern: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]" />
              <button onClick={handleCreateRule} className="col-span-2 px-4 py-2 rounded bg-[var(--p1)] text-white text-[0.72rem] font-bold hover:bg-[var(--pd)]">Create Rule</button>
            </div>
          )}
          <div className="divide-y divide-[var(--b1)]">
            {rules.length === 0 ? (
              <div className="p-6 text-center text-[var(--t3)] text-[0.78rem]">No suppression rules yet.</div>
            ) : rules.map((r: any) => (
              <div key={r.id} className="px-4 py-3 flex items-center gap-4">
                <button onClick={() => updateSuppressionRule(r.id, { enabled: !r.enabled }).then(reload)}
                  className={`w-8 h-5 rounded-full transition-colors ${r.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${r.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-[0.75rem] font-bold text-[var(--t7)]">{r.name}</p>
                  <p className="text-[0.6rem] text-[var(--t3)]">{r.reason} {r.source_ip_pattern && `· IP: ${r.source_ip_pattern}`} {r.description_pattern && `· Regex: ${r.description_pattern}`}</p>
                </div>
                <span className="text-[0.62rem] font-mono text-[var(--t3)]">{r.hit_count} hits</span>
                <button onClick={() => deleteSuppressionRule(r.id).then(reload)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Known Assets ────────────────────────────────────────────────── */}
      {activeSection === 'assets' && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
            <p className="text-[0.78rem] font-black text-[var(--t7)]">Known Assets</p>
            <button onClick={() => setShowAddAsset(!showAddAsset)} className="px-3 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.68rem] font-bold hover:bg-[var(--pd)] flex items-center gap-1"><Plus size={12} />Add Asset</button>
          </div>
          {showAddAsset && (
            <div className="p-4 bg-[var(--sa)] border-b border-[var(--b1)] grid grid-cols-2 gap-3">
              <input placeholder="Value (IP, hostname, user)" value={newAsset.value} onChange={e => setNewAsset(a => ({ ...a, value: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]" />
              <select value={newAsset.type} onChange={e => setNewAsset(a => ({ ...a, type: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]">
                <option value="ip">IP</option><option value="host">Host</option><option value="user">User</option><option value="domain">Domain</option>
              </select>
              <select value={newAsset.role} onChange={e => setNewAsset(a => ({ ...a, role: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]">
                <option value="scanner">Scanner</option><option value="monitoring">Monitoring</option><option value="backup">Backup</option><option value="admin">Admin</option><option value="production">Production</option>
              </select>
              <input placeholder="Description" value={newAsset.description} onChange={e => setNewAsset(a => ({ ...a, description: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]" />
              <button onClick={handleAddAsset} className="col-span-2 px-4 py-2 rounded bg-[var(--p1)] text-white text-[0.72rem] font-bold hover:bg-[var(--pd)]">Register Asset</button>
            </div>
          )}
          <div className="divide-y divide-[var(--b1)]">
            {assets.length === 0 ? (
              <div className="p-6 text-center text-[var(--t3)] text-[0.78rem]">No known assets. Run seed-known-assets.ts to populate.</div>
            ) : assets.map((a: any) => (
              <div key={a.value} className="px-4 py-2.5 flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-[0.58rem] font-bold uppercase ${a.fp_default ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{a.type}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[0.72rem] font-bold text-[var(--t7)]">{a.value}</p>
                  <p className="text-[0.58rem] text-[var(--t3)]">{a.role} {a.description && `— ${a.description}`}</p>
                </div>
                {a.fp_default ? <span className="text-[0.58rem] font-bold text-amber-600">FP by default</span> : null}
                <button onClick={() => deleteAsset(a.value).then(reload)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};


// ── FP Archive Tab ──────────────────────────────────────────────────────────
const FpArchiveTab = () => {
  const toast = useToast();
  const { user, token } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [data, setData] = useState<{ alerts: any[]; total: number }>({ alerts: [], total: 0 });
  const [page, setPage] = useState(1);
  const [methodFilter, setMethodFilter] = useState('');
  const [effectiveness, setEffectiveness] = useState<any>(null);
  const [fpTimeline, setFpTimeline] = useState<any[]>([]);
  const [noisySources, setNoisySources] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const reload = useCallback(() => {
    getFpArchive({ page, pageSize: 25, method: methodFilter || undefined }).then(setData).catch(() => {});
    getDetectionEffectiveness().then(setEffectiveness).catch(() => {});
    getFpOverTime().then(setFpTimeline).catch(() => {});
    getNoisySources().then(setNoisySources).catch(() => {});
  }, [page, methodFilter]);
  useEffect(() => { reload(); }, [reload]);

  const handleReinvestigate = async (id: string) => {
    await overrideFp(id);
    toast('Alert moved to Incidents queue', 'success');
    reload();
  };

  const handleClearArchive = async () => {
    setShowClearConfirm(false);
    setClearing(true);
    try {
      const res = await fetch('/api/admin/clear-fp-archive', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json();
      toast(`Deleted ${d.deleted ?? 0} alerts from FP Archive`, 'success');
      window.location.reload();
    } catch (err: any) {
      toast(err?.message || 'Failed to clear archive', 'error');
    } finally {
      setClearing(false);
    }
  };

  const fpTimelineMax = fpTimeline.length ? Math.max(...fpTimeline.map(t => t.total_fp || 0), 1) : 1;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 overflow-y-auto h-full">
      <PageHeader eyebrow="History" title="False Positive Archive" description="Browse all detected false positives with reasoning, analytics, and audit trail." />

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: 'Total FPs', value: data.total },
          { label: 'Suppression', value: effectiveness?.suppression?.total_caught ?? '—' },
          { label: 'Memory', value: effectiveness?.memory?.total_caught ?? '—' },
          { label: 'Triage LLM', value: effectiveness?.triage?.total_caught ?? '—' },
          { label: 'Overall Accuracy', value: effectiveness?.overall?.accuracy != null ? `${(effectiveness.overall.accuracy * 100).toFixed(0)}%` : '—' },
        ].map(c => (
          <div key={c.label} className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-3">
            <p className="text-[0.58rem] font-black text-[var(--t3)] uppercase tracking-widest">{c.label}</p>
            <p className="text-[1.3rem] font-black text-[var(--t7)] mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      {/* FP Trend */}
      {fpTimeline.length > 0 && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4">
          <p className="text-[0.72rem] font-black text-[var(--p1)] uppercase tracking-wide mb-3">FP Detections (30 days)</p>
          <div className="flex items-end gap-1 h-14">
            {fpTimeline.map(t => (
              <div key={t.day} className="flex-1 flex flex-col items-center">
                <div className="w-full rounded-t overflow-hidden flex flex-col-reverse" style={{ height: 40 }}>
                  <div className="w-full bg-amber-400 rounded-t" style={{ height: `${fpTimelineMax > 0 ? (t.total_fp / fpTimelineMax) * 100 : 0}%`, minHeight: t.total_fp > 0 ? 2 : 0 }} />
                </div>
                <span className="text-[0.45rem] text-[var(--t2)] mt-1">{t.day?.slice(8)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3">
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">FP Method:</span>
          {['analyst', 'suppression', 'memory', 'triage', 'asset_fast', 'confidence_aggregated', 'low_risk_score', 'noise_priority', 'low_priority', 'severity_filter', 'time_window', 'legacy_filter'].map(m => {
            const isActive = methodFilter === m;
            return (
              <button
                key={m}
                onClick={() => { setMethodFilter(isActive ? '' : m); setPage(1); }}
                className={`px-2 py-0.5 rounded-full border text-[0.62rem] font-black uppercase tracking-wider transition-all font-mono ${isActive ? 'bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-offset-0 ring-blue-200' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
              >
                {m.replace(/_/g, ' ')}
              </button>
            );
          })}
          {methodFilter && (
            <button
              onClick={() => { setMethodFilter(''); setPage(1); }}
              className="ml-auto text-[0.62rem] font-bold text-[var(--p1)] hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--b1)] bg-[var(--s1)] flex items-center justify-between gap-3">
          <p className="text-[0.78rem] font-black text-[var(--t7)]">FP Alerts ({data.total})</p>
          {isAdmin && data.total > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={clearing}
              className="px-3 py-1 rounded text-[0.62rem] font-bold bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 disabled:opacity-50 flex items-center gap-1.5"
              title="Permanently delete all FP archive entries (Incidents queue is not affected)"
            >
              <Trash2 size={11} />{clearing ? 'Clearing…' : 'Clear Archive'}
            </button>
          )}
        </div>
        <div className="divide-y divide-[var(--b1)]">
          {data.alerts.length === 0 ? (
            <div className="p-8 text-center text-[var(--t3)] text-[0.78rem]">No false positives in archive yet.</div>
          ) : data.alerts.map(a => (
            <div key={a.id}>
              <button onClick={() => setExpanded(expanded === a.id ? null : a.id)} className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[var(--sa)]">
                <ChevronRight size={14} className={`text-[var(--t3)] transition-transform ${expanded === a.id ? 'rotate-90' : ''}`} />
                <span className={`px-2 py-0.5 rounded text-[0.55rem] font-black uppercase ${
                  a.fp_method === 'suppression'           ? 'bg-blue-100 text-blue-700'      :
                  a.fp_method === 'memory'                ? 'bg-green-100 text-green-700'    :
                  a.fp_method === 'severity_filter'       ? 'bg-amber-100 text-amber-700'    :
                  a.fp_method === 'time_window'           ? 'bg-cyan-100 text-cyan-700'      :
                  a.fp_method === 'triage'                ? 'bg-purple-100 text-purple-700'  :
                  a.fp_method === 'low_priority'          ? 'bg-pink-100 text-pink-700'      :
                  a.fp_method === 'noise_priority'        ? 'bg-pink-100 text-pink-700'      :
                  a.fp_method === 'low_risk_score'        ? 'bg-rose-100 text-rose-700'      :
                  a.fp_method === 'asset_fast'            ? 'bg-teal-100 text-teal-700'      :
                  a.fp_method === 'confidence_aggregated' ? 'bg-indigo-100 text-indigo-700'  :
                  a.fp_method === 'analyst'               ? 'bg-slate-200 text-slate-700'    :
                  a.fp_method === 'legacy_filter'         ? 'bg-yellow-100 text-yellow-700'  :
                  'bg-gray-100 text-gray-700'
                }`}>{(a.fp_method || '?').replace(/_/g, ' ')}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[0.72rem] font-semibold text-[var(--t7)] truncate">{a.description}</p>
                  <p className="text-[0.58rem] text-[var(--t3)] font-mono">{a.source_ip} · {a.agent_name} · {a.timestamp?.slice(0, 16)}</p>
                </div>
                <ConfidenceDonut value={a.fp_confidence ?? null} size={34} />
              </button>
              {expanded === a.id && (
                <div className="px-4 pb-3 pl-10 space-y-2">
                  <div className="bg-[var(--sa)] rounded-lg p-3 text-[0.68rem] text-[var(--t6)]">
                    <p className="font-bold mb-1">FP Reason:</p>
                    <p>{a.fp_reason || 'No reason recorded'}</p>
                  </div>
                  {a.fp_details && (
                    <div className="bg-[var(--sa)] rounded-lg p-3 text-[0.62rem] text-[var(--t3)] space-y-1">
                      {a.fp_details.rule_name && <p>Suppression rule: <b>{a.fp_details.rule_name}</b></p>}
                      {a.fp_details.known_asset && <p>Known asset: <b>{a.fp_details.known_asset.value}</b> ({a.fp_details.known_asset.role})</p>}
                      {a.fp_details.similar_incident && <p>Similar incident: <b>{(a.fp_details.similar_incident.similarity * 100).toFixed(0)}%</b> match with {a.fp_details.similar_incident.alert_id}</p>}
                      {a.fp_details.ioc_pattern && <p>IOC pattern: <b>{a.fp_details.ioc_pattern.value}</b> fp_ratio={a.fp_details.ioc_pattern.fp_ratio}</p>}
                    </div>
                  )}
                  <button onClick={() => handleReinvestigate(a.id)} className="px-3 py-1.5 rounded bg-amber-100 text-amber-800 text-[0.65rem] font-bold hover:bg-amber-200">
                    Re-investigate
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        {data.total > 25 && (
          <div className="px-4 py-3 border-t border-[var(--b1)] flex items-center justify-between">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 rounded text-[0.68rem] font-bold bg-[var(--sa)] disabled:opacity-30">Prev</button>
            <span className="text-[0.65rem] text-[var(--t3)]">Page {page} of {Math.ceil(data.total / 25)}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(data.total / 25)} className="px-3 py-1 rounded text-[0.68rem] font-bold bg-[var(--sa)] disabled:opacity-30">Next</button>
          </div>
        )}
      </div>

      {/* Noisy Sources */}
      {noisySources.length > 0 && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-[var(--s1)]">
            <p className="text-[0.78rem] font-black text-[var(--t7)]">Top Noisy Sources</p>
          </div>
          <div className="divide-y divide-[var(--b1)]">
            {noisySources.slice(0, 10).map((s: any) => (
              <div key={s.source} className="px-4 py-2.5 flex items-center gap-3">
                <span className="text-[0.62rem] font-mono text-[var(--t6)] w-32 truncate">{s.source}</span>
                <span className="text-[0.58rem] text-[var(--t3)]">{s.source_type}</span>
                <div className="flex-1" />
                <span className="text-[0.62rem] font-bold text-amber-600">{s.fp_count} FP / {s.total_alerts} total</span>
                <span className="text-[0.58rem] text-[var(--t3)]">{(s.fp_rate * 100).toFixed(0)}%</span>
                {s.is_registered && <span className="text-[0.55rem] text-green-600 font-bold">Registered</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {showClearConfirm && (
        <ConfirmModal
          title="Clear FP Archive"
          message="Delete ALL alerts in the FP Archive? This permanently removes both AI-flagged and analyst-confirmed FPs. The Incidents queue is NOT affected."
          confirmLabel="Delete All"
          onConfirm={handleClearArchive}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </div>
  );
};


// ── Investigation Tab ───────────────────────────────────────────────────────
const InvestigationTab = ({ alerts, selectedAlert, setSelectedAlert, onAlertAction, setActiveTab }: {
  alerts: Alert[];
  selectedAlert: Alert | null;
  setSelectedAlert: (a: Alert | null) => void;
  onAlertAction: (id: string, update: any) => void;
  setActiveTab: (t: string) => void;
}) => {
  const toast = useToast();
  const { user, token } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [investigating, setInvestigating] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleClearQueue = async () => {
    setShowClearConfirm(false);
    setClearing(true);
    try {
      const res = await fetch('/api/admin/clear-investigation', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      toast(`Deleted ${data.deleted ?? 0} alerts from Incidents`, 'success');
      // Force a page-data refresh
      window.location.reload();
    } catch (err: any) {
      toast(err?.message || 'Failed to clear queue', 'error');
    } finally {
      setClearing(false);
    }
  };

  // Alerts Queue: alerts that passed FP filtering and need Tier-1 review.
  // Once escalated, they move to the dedicated Incidents tab.
  const investigationAlerts = alerts.filter(a =>
    ['TRIAGED', 'ANALYZING'].includes(a.status)
  );

  const handleInvestigate = async (alertId: string) => {
    setInvestigating(alertId);
    try {
      const result = await investigateAlert(alertId);
      toast(`Investigation complete → ${result.status}`, 'success');
      onAlertAction(alertId, result);
    } catch (err: any) { toast(err?.message || 'Investigation failed', 'error'); }
    setInvestigating(null);
  };

  // ── Escalate-to-Incident modal state ─────────────────────────────────────
  const [escAlert, setEscAlert]     = useState<Alert | null>(null);
  const [analysts, setAnalysts]     = useState<{ id: number; username: string; role: string }[]>([]);
  const [escForm, setEscForm]       = useState({ title: '', severity: 'HIGH', phase: 'analysis' as IncidentPhase, assigned_to: 0, note: '', create_glpi: true });
  const [escSubmitting, setEscSubmitting] = useState(false);

  const openEscalateModal = async (alert: Alert) => {
    let title = alert.description || 'Untitled';
    let severity: string = 'HIGH';
    try {
      const j = JSON.parse(alert.ai_analysis || '{}');
      title    = j?.ticket?.title || j?.phaseData?.ticket?.title || title;
      severity = j?.ticket?.priority || j?.phaseData?.ticket?.priority || 'HIGH';
    } catch {}
    setEscAlert(alert);
    // Default to UNASSIGNED — incident starts at status=OPEN until someone takes it
    setEscForm({ title, severity, phase: 'analysis', assigned_to: 0, note: '', create_glpi: true });
    try {
      const list = await listAnalysts();
      setAnalysts(list);
    } catch { setAnalysts([]); }
  };

  const submitEscalation = async () => {
    if (!escAlert) return;
    setEscSubmitting(true);
    try {
      const r = await createIncident({
        alert_id:    escAlert.id,
        title:       escForm.title || undefined,
        severity:    escForm.severity,
        phase:       escForm.phase,
        assigned_to: escForm.assigned_to || null,  // 0 = unassigned (incident starts OPEN)
        note:        escForm.note || undefined,
        create_glpi: escForm.create_glpi,
      });
      if (!r.ok || !r.id) { toast(r.error || 'Failed to create incident', 'error'); return; }
      const assigneeText = escForm.assigned_to
        ? `→ ${analysts.find(a => a.id === escForm.assigned_to)?.username || 'analyst'}`
        : '(unassigned, status=Open)';
      const glpiNote = r.glpi_ticket_id ? ` · GLPI #${r.glpi_ticket_id}` : '';
      toast(`Incident ${r.id} created ${assigneeText}${glpiNote}`, 'success');
      onAlertAction(escAlert.id, { status: 'ESCALATED' });
      setEscAlert(null);
      setSelectedAlert(null);
    } catch (err: any) { toast(err?.message || 'Escalation failed', 'error'); }
    finally { setEscSubmitting(false); }
  };

  const handleMarkFp = async (alertId: string) => {
    try {
      await confirmFp(alertId);
      toast('Marked as false positive', 'success');
    } catch { toast('Failed', 'error'); }
  };

  if (selectedAlert) {
    return (
      <div className="flex h-full">
        <div className="w-80 border-r border-[var(--b1)] bg-[var(--s0)] overflow-y-auto shrink-0">
          <div className="px-4 py-3 border-b bg-[var(--s1)]">
            <p className="text-[0.72rem] font-black text-[var(--t7)]">Queue ({investigationAlerts.length})</p>
          </div>
          {investigationAlerts.map(a => (
            <button key={a.id} onClick={() => setSelectedAlert(a)}
              className={`w-full px-3 py-2.5 text-left border-b border-[var(--b1)] hover:bg-[var(--sa)] ${selectedAlert.id === a.id ? 'bg-[var(--sa)] border-l-2 border-l-[var(--p1)]' : ''}`}>
              <p className="text-[0.7rem] font-semibold text-[var(--t7)] truncate">{a.description}</p>
              <p className="text-[0.58rem] text-[var(--t3)] font-mono">{a.source_ip} · {a.status}</p>
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          <AlertDetail
            alert={selectedAlert}
            onClose={() => setSelectedAlert(null)}
            onAction={onAlertAction}
            returnTab="investigation"
            setActiveTab={setActiveTab}
            allAlerts={investigationAlerts}
            onAlertSelect={setSelectedAlert}
          />
          {/* Action bar */}
          <div className="sticky bottom-0 bg-[var(--s0)] border-t border-[var(--b1)] px-6 py-3 flex gap-3">
            {selectedAlert.status === 'FILTERED' && (
              <button onClick={() => handleInvestigate(selectedAlert.id)} disabled={investigating === selectedAlert.id}
                className="px-5 py-2.5 rounded-lg bg-[var(--p1)] text-white text-[0.78rem] font-bold hover:bg-[var(--pd)] disabled:opacity-50 flex items-center gap-2">
                <Zap size={14} />{investigating === selectedAlert.id ? 'Running...' : 'Run Investigation'}
              </button>
            )}
            {['TRIAGED', 'FILTERED'].includes(selectedAlert.status) && (
              <>
                <button onClick={() => openEscalateModal(selectedAlert)}
                  className="px-4 py-2.5 rounded-lg bg-red-600 text-white text-[0.75rem] font-bold hover:bg-red-700 flex items-center gap-2">
                  <AlertOctagon size={14} />Escalate to Incident
                </button>
                <button onClick={() => handleMarkFp(selectedAlert.id)}
                  className="px-4 py-2.5 rounded-lg bg-amber-100 text-amber-800 text-[0.75rem] font-bold hover:bg-amber-200">
                  Mark as FP
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // No alert selected — show queue
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 overflow-y-auto h-full">
      <PageHeader eyebrow="Tier-1 Triage" title="Alerts Queue" description="Alerts that passed FP filtering, awaiting Tier-1 analyst review. Click Escalate to promote a real threat into the Incidents tab with an assigned owner." />

      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
          <p className="text-[0.78rem] font-black text-[var(--t7)]">Alerts Queue ({investigationAlerts.length})</p>
          {isAdmin && investigationAlerts.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={clearing}
              className="px-3 py-1 rounded text-[0.65rem] font-bold bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 disabled:opacity-50 flex items-center gap-1.5"
              title="Permanently delete all alerts in this queue (FP Archive is not affected)"
            >
              <Trash2 size={11} />{clearing ? 'Clearing…' : 'Clear Queue'}
            </button>
          )}
        </div>
        <div className="divide-y divide-[var(--b1)]">
          {investigationAlerts.length === 0 ? (
            <div className="p-8 text-center text-[var(--t3)]">
              <p className="text-[0.85rem] font-semibold mb-2">✅ No incidents need attention</p>
              <p className="text-[0.72rem]">The FP-reduction pipeline is filtering noise to the <button onClick={() => setActiveTab('fp-archive')} className="text-[var(--p1)] font-bold hover:underline">FP Archive</button> — check there for archived items, or tune the <button onClick={() => setActiveTab('noise-filter')} className="text-[var(--p1)] font-bold hover:underline">Noise Filter</button>.</p>
            </div>
          ) : investigationAlerts.map(a => {
            const risk = getAlertRiskScore(a);
            const hasAnalysis = !!a.ai_analysis;
            return (
              <button key={a.id} onClick={() => setSelectedAlert(a)} className="w-full px-4 py-3 text-left hover:bg-[var(--sa)] flex items-center gap-4">
                <span className={`w-2 h-8 rounded-full ${a.severity >= 12 ? 'bg-red-500' : a.severity >= 10 ? 'bg-orange-400' : 'bg-blue-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[0.78rem] font-semibold text-[var(--t7)] truncate">{a.description}</p>
                  <p className="text-[0.62rem] text-[var(--t3)] font-mono">{a.source_ip} · {a.agent_name} · {a.timestamp?.slice(0, 16)}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-[0.6rem] font-bold uppercase ${
                  a.status === 'FILTERED' ? 'bg-purple-100 text-purple-700' :
                  a.status === 'TRIAGED' ? 'bg-green-100 text-green-700' :
                  a.status === 'ESCALATED' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-600'
                }`}>{a.status}</span>
                {risk != null && <span className="text-[0.68rem] font-black text-[var(--t6)]">{risk}%</span>}
                {!hasAnalysis && a.status === 'FILTERED' && (
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 text-[0.58rem] font-bold">Needs investigation</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Escalate-to-Incident modal ──────────────────────────────────── */}
      {escAlert && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--b1)] bg-[var(--s1)]">
              <div className="flex items-center gap-2">
                <AlertOctagon size={16} className="text-red-600" />
                <p className="text-[0.85rem] font-black text-[var(--t7)]">Escalate to Incident</p>
              </div>
              <button onClick={() => setEscAlert(null)} className="text-[var(--t3)] hover:text-[var(--t6)]"><X size={16} /></button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="text-[0.62rem] font-black text-[var(--t4)] uppercase tracking-widest block mb-1">Title</label>
                <input value={escForm.title} onChange={e => setEscForm({ ...escForm, title: e.target.value })}
                  className="w-full border border-[var(--b2)] rounded px-3 py-2 text-[0.78rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)]" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[0.62rem] font-black text-[var(--t4)] uppercase tracking-widest block mb-1">Severity</label>
                  <select value={escForm.severity} onChange={e => setEscForm({ ...escForm, severity: e.target.value })}
                    className="w-full border border-[var(--b2)] rounded px-3 py-2 text-[0.78rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)]">
                    {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[0.62rem] font-black text-[var(--t4)] uppercase tracking-widest block mb-1">Initial Phase</label>
                  <select value={escForm.phase} onChange={e => setEscForm({ ...escForm, phase: e.target.value as IncidentPhase })}
                    className="w-full border border-[var(--b2)] rounded px-3 py-2 text-[0.78rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)]">
                    {INCIDENT_PHASES.map(p => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[0.62rem] font-black text-[var(--t4)] uppercase tracking-widest block mb-1">Assign To</label>
                <p className="text-[0.62rem] text-[var(--t3)] mb-1.5">
                  If left unassigned, the incident starts as <span className="font-bold text-blue-700">Open</span> and any TIER2+ user can claim it.
                  Assigning it directly auto-promotes it to <span className="font-bold text-orange-700">Investigating</span>.
                </p>
                <div className="border border-[var(--b2)] rounded divide-y divide-[var(--b1)] max-h-44 overflow-y-auto">
                  <label className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[var(--s1)] ${escForm.assigned_to === 0 ? 'bg-blue-50' : ''}`}>
                    <input type="radio" name="assignee" checked={escForm.assigned_to === 0} onChange={() => setEscForm({ ...escForm, assigned_to: 0 })} />
                    <span className="text-[0.78rem] font-semibold text-[var(--t6)] flex-1">— Leave unassigned —</span>
                    <span className="px-2 py-0.5 rounded text-[0.55rem] font-black uppercase tracking-widest bg-blue-100 text-blue-700">Open</span>
                  </label>
                  {analysts.length === 0 ? (
                    <p className="text-[0.72rem] text-[var(--t4)] px-3 py-2 italic">
                      No TIER2 / INCIDENT_LEAD users available. Create one in Admin Ops → Users.
                    </p>
                  ) : (
                    analysts.map(a => (
                      <label key={a.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[var(--s1)] ${escForm.assigned_to === a.id ? 'bg-blue-50' : ''}`}>
                        <input type="radio" name="assignee" checked={escForm.assigned_to === a.id} onChange={() => setEscForm({ ...escForm, assigned_to: a.id })} />
                        <span className="text-[0.78rem] font-semibold text-[var(--t7)] flex-1">{a.username}</span>
                        <span className={`px-2 py-0.5 rounded text-[0.55rem] font-black uppercase tracking-widest ${
                          a.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' :
                          a.role === 'INCIDENT_LEAD' ? 'bg-indigo-100 text-indigo-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>{a.role}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div>
                <label className="text-[0.62rem] font-black text-[var(--t4)] uppercase tracking-widest block mb-1">Escalation Note (optional)</label>
                <textarea value={escForm.note} onChange={e => setEscForm({ ...escForm, note: e.target.value })} rows={2}
                  placeholder="Why is this a real incident? Any context for the assignee?"
                  className="w-full border border-[var(--b2)] rounded px-3 py-2 text-[0.78rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)] resize-none" />
              </div>

              <label className="flex items-center gap-2 text-[0.78rem] text-[var(--t6)]">
                <input type="checkbox" checked={escForm.create_glpi} onChange={e => setEscForm({ ...escForm, create_glpi: e.target.checked })} />
                Also create GLPI ticket
              </label>
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--b1)] bg-[var(--s1)]">
              <button onClick={() => setEscAlert(null)}
                className="px-4 py-2 rounded border border-[var(--b2)] text-[var(--t5)] text-[0.75rem] font-semibold hover:bg-[var(--s2)]">Cancel</button>
              <button onClick={submitEscalation} disabled={escSubmitting}
                className="px-4 py-2 rounded bg-red-600 text-white text-[0.75rem] font-bold hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5">
                <AlertOctagon size={13} />{escSubmitting ? 'Escalating…' : 'Escalate'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showClearConfirm && (
        <ConfirmModal
          title="Clear Incidents Queue"
          message="Delete all alerts in the Incidents queue? This permanently removes alerts with status TRIAGED, ESCALATED, CLOSED, or ANALYZING. The FP Archive is NOT affected."
          confirmLabel="Delete All"
          onConfirm={handleClearQueue}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </div>
  );
};


// ── Integrations Tab (merge Notifications + Response Controls) ──────────────
const EMAIL_CONFIG_DEFAULTS: Record<string, string> = {
  smtp_user: '',
  smtp_pass: '',
  to: '',
  from: '',
  smtp_host: 'smtp.gmail.com',
  smtp_port: '587',
};

function normalizeEmailConfig(raw: Record<string, string> = {}): Record<string, string> {
  const cfg = { ...EMAIL_CONFIG_DEFAULTS, ...raw };
  const user = (cfg.smtp_user || cfg.from || '').trim();
  const gmailMode = /@gmail\.com$/i.test(user) || (cfg.smtp_host || '').trim().toLowerCase() === 'smtp.gmail.com';
  return {
    ...cfg,
    smtp_user: user,
    smtp_pass: gmailMode ? (cfg.smtp_pass || '').replace(/\s+/g, '') : (cfg.smtp_pass || ''),
    smtp_host: (cfg.smtp_host || '').trim() || (gmailMode ? 'smtp.gmail.com' : ''),
    smtp_port: (cfg.smtp_port || '').trim() || (gmailMode ? '587' : ''),
    from: (cfg.from || '').trim() || user,
    to: (cfg.to || '').trim(),
  };
}

const IntegrationsTab = () => {
  const toast = useToast();
  const { user, token } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [activeSection, setActiveSection] = useState<'notifications' | 'firewalls' | 'logs' | 'ingest'>('notifications');
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [actionLogs, setActionLogs] = useState<ActionLog[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<any>({});

  // ── Alert Ingest state ──────────────────────────────────────────────────────
  const [apiKeys,      setApiKeys]      = useState<any[]>([]);
  const [newKeyName,   setNewKeyName]   = useState('');
  const [createdKey,   setCreatedKey]   = useState<{ key: string; prefix: string } | null>(null);
  const [keyCreating,  setKeyCreating]  = useState(false);
  const [keyRevoke,    setKeyRevoke]    = useState<Record<number, boolean>>({});
  const [keyUpdating,  setKeyUpdating]  = useState<Record<number, boolean>>({});
  const [showKeyValue, setShowKeyValue] = useState(false);
  const [expandedKey,  setExpandedKey]  = useState<number | null>(null);
  const [ingestCfg,    setIngestCfg]    = useState<Record<string, string>>({
    ingest_enabled: 'true', min_severity: '7', max_alerts_per_min: '60',
    dedup_window_minutes: '5', time_window_start: '', time_window_end: '', auto_orchestrate: 'true',
  });
  const [ingestSaving, setIngestSaving] = useState(false);
  const getEmailConfigWithDefaults = useCallback((raw: Record<string, string> = {}) => {
    const normalized = normalizeEmailConfig(raw);
    const defaultSender = (user?.email || '').trim();
    const smtpUser = normalized.smtp_user || defaultSender;
    return normalizeEmailConfig({
      ...normalized,
      smtp_user: smtpUser,
      from: normalized.from || smtpUser,
    });
  }, [user?.email]);

  const fetchApiKeys = () => listApiKeys().then(setApiKeys).catch(() => {});

  const reload = useCallback(() => {
    getIntegrations().then(list => {
      setIntegrations(list);
      const w = list.find((i: any) => i.name === 'wazuh');
      if (w?.config) setIngestCfg((prev) => ({ ...prev, ...w.config }));
    }).catch(() => {});
    getActionLogs().then(setActionLogs).catch(() => {});
    if (isAdmin) fetchApiKeys();
  }, [isAdmin]);
  useEffect(() => { reload(); }, [reload]);

  const handleSaveIngestCfg = async () => {
    setIngestSaving(true);
    try {
      await updateIntegration('wazuh', { config: ingestCfg });
      toast('Ingest settings saved', 'success');
    } catch { toast('Failed to save settings', 'error'); }
    finally { setIngestSaving(false); }
  };

  const handleToggleKeyPause = async (k: any) => {
    setKeyUpdating(p => ({ ...p, [k.id]: true }));
    try { await updateApiKey(k.id, { paused: !k.paused }); fetchApiKeys(); }
    catch { toast('Failed to update key', 'error'); }
    finally { setKeyUpdating(p => ({ ...p, [k.id]: false })); }
  };

  const handleKeyMinSev = async (k: any, raw: string) => {
    const v = raw.trim() === '' ? null : Number(raw);
    if (v !== null && (isNaN(v) || v < 0 || v > 15)) return;
    setKeyUpdating(p => ({ ...p, [k.id]: true }));
    try { await updateApiKey(k.id, { min_severity_override: v }); fetchApiKeys(); }
    catch { toast('Failed to update key', 'error'); }
    finally { setKeyUpdating(p => ({ ...p, [k.id]: false })); }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setKeyCreating(true);
    try {
      const r = await createApiKey(newKeyName.trim());
      if (r.ok) { setCreatedKey({ key: r.key, prefix: r.prefix }); setNewKeyName(''); fetchApiKeys(); }
      else toast(r.error || 'Failed to create key', 'error');
    } catch { toast('Failed to create key', 'error'); }
    finally { setKeyCreating(false); }
  };

  const [revokeKeyId, setRevokeKeyId] = useState<number | null>(null);
  const handleRevokeKey = async (id: number) => {
    setRevokeKeyId(null);
    setKeyRevoke(p => ({ ...p, [id]: true }));
    await revokeApiKey(id);
    fetchApiKeys();
    setKeyRevoke(p => ({ ...p, [id]: false }));
  };

  const handleToggle = async (name: string, enabled: boolean) => {
    await updateIntegration(name, { enabled: !enabled });
    toast(`${name} ${!enabled ? 'enabled' : 'disabled'}`, 'success');
    reload();
  };

  const handleTest = async (name: string) => {
    try {
      const result = await testIntegration(name);
      toast(result.ok ? `${name} test succeeded` : `${name} test failed: ${result.error}`, result.ok ? 'success' : 'error');
    } catch (err: any) {
      toast(`${name} test failed: ${err?.message || 'Request error'}`, 'error');
    } finally {
      reload();
    }
  };

  const handleSaveConfig = async (name: string) => {
    const nextConfig = name === 'email' ? getEmailConfigWithDefaults(editConfig) : editConfig;
    await updateIntegration(name, { config: nextConfig });
    setEditing(null);
    toast(`${name} config saved`, 'success');
    reload();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5 overflow-y-auto h-full">
      <PageHeader eyebrow="External Systems" title="Integrations" description="GLPI ticketing, Telegram alerts, email notifications, and firewall controls." />

      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'notifications' as const, label: 'Notifications' },
          { id: 'firewalls' as const, label: 'Firewalls' },
          { id: 'logs' as const, label: 'Activity Log' },
          ...(isAdmin ? [{ id: 'ingest' as const, label: 'Alert Ingest' }] : []),
        ].map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id as any)}
            className={`px-4 py-2 rounded-lg text-[0.75rem] font-bold transition-colors ${activeSection === s.id ? 'bg-[var(--p1)] text-white' : 'bg-[var(--s0)] text-[var(--t4)] border border-[var(--b2)] hover:bg-[var(--s1)]'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Notifications */}
      {activeSection === 'notifications' && (
        <div className="space-y-4">
          {integrations.map(intg => {
            const rawCfg = intg.config as Record<string, string>;
            const cfg = intg.name === 'email' ? getEmailConfigWithDefaults(rawCfg) : rawCfg;
            const emailSender = (cfg?.smtp_user || cfg?.from || '').trim();
            const isEmailUnconfigured = intg.name === 'email' && !(emailSender && cfg?.smtp_pass && cfg?.to);
            const isSlackUnconfigured = intg.name === 'slack' && !cfg?.webhook_url;
            const unconfigured = isEmailUnconfigured || isSlackUnconfigured;

            const INTG_META: Record<string, { icon: React.ReactNode; desc: string; color: string }> = {
              email:    { icon: <Mail size={18} className="text-blue-600" />,      desc: 'Send alert emails via SMTP (Gmail, Outlook, custom)',    color: 'bg-blue-100' },
              telegram: { icon: <Send size={18} className="text-sky-500" />,       desc: 'Push notifications to a Telegram bot channel',           color: 'bg-sky-100' },
              glpi:     { icon: <ExternalLink size={18} className="text-violet-600" />, desc: 'Create GLPI helpdesk tickets for escalated incidents', color: 'bg-violet-100' },
              slack:    { icon: <Hash size={18} className="text-green-600" />,     desc: 'Post alerts to a Slack channel via Incoming Webhook',    color: 'bg-green-100' },
            };
            const meta = INTG_META[intg.name] || { icon: <ExternalLink size={18} className="text-gray-500" />, desc: '', color: 'bg-gray-100' };

            const FIELD_LABELS: Record<string, string> = {
              smtp_host: 'SMTP Host', smtp_port: 'SMTP Port', smtp_user: 'Gmail Address / SMTP Username',
              smtp_pass: 'App Password / SMTP Password', from: 'From Address', to: 'Destination Email',
              bot_token: 'Bot Token', chat_id: 'Chat ID',
              url: 'GLPI URL', app_token: 'App Token', user_token: 'User Token',
              webhook_url: 'Webhook URL',
            };
            const editCfgForCard = intg.name === 'email' ? getEmailConfigWithDefaults(editConfig) : editConfig;
            const editKeys = intg.name === 'email'
              ? ['smtp_user', 'smtp_pass', 'to', 'from', 'smtp_host', 'smtp_port']
              : Object.keys(editCfgForCard);

            return (
              <div key={intg.name} className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4">
                <div className="flex items-center gap-4 mb-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${intg.enabled && !unconfigured ? meta.color : 'bg-gray-100'}`}>
                    {meta.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[0.85rem] font-black text-[var(--t7)] capitalize">{intg.name}</p>
                      {unconfigured && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[0.58rem] font-black uppercase tracking-wide">Not configured</span>
                      )}
                    </div>
                    <p className="text-[0.62rem] text-[var(--t3)] truncate">{meta.desc}</p>
                    <p className="text-[0.60rem] text-[var(--t4)] mt-0.5">Threshold: <span className="font-bold">{intg.auto_send_threshold}</span> · 24h sent: <span className="font-bold">{(intg as any).stats_24h?.success || 0}</span></p>
                  </div>
                  <button onClick={() => handleToggle(intg.name, intg.enabled)}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-[0.68rem] font-bold transition-colors ${intg.enabled ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                    {intg.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button onClick={() => handleTest(intg.name)} className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--sa)] text-[0.68rem] font-bold text-[var(--p1)] hover:bg-[var(--s1)]">Test</button>
                  <button onClick={() => { setEditing(editing === intg.name ? null : intg.name); setEditConfig(intg.name === 'email' ? getEmailConfigWithDefaults(intg.config as Record<string, string>) : { ...intg.config }); }}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--sa)] text-[0.68rem] font-bold text-[var(--t4)] hover:bg-[var(--s1)]">
                    {editing === intg.name ? 'Cancel' : 'Config'}
                  </button>
                </div>

                {editing === intg.name && (
                  <div className="bg-[var(--sa)] border border-[var(--b2)] rounded-lg p-4 space-y-3 mt-1">
                    <p className="text-[0.65rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Configuration</p>
                    <div className="grid grid-cols-2 gap-3">
                      {editKeys.map(k => {
                        const isSecret = k.includes('token') || k.includes('pass') || k.includes('password') || k.includes('secret');
                        return (
                          <div key={k} className="space-y-1">
                            <label className="text-[0.65rem] font-black text-[var(--t4)] uppercase tracking-wider">
                              {FIELD_LABELS[k] || k.replace(/_/g, ' ')}
                            </label>
                            <input
                              value={editCfgForCard[k] || ''}
                              onChange={e => setEditConfig((c: any) => ({ ...c, [k]: e.target.value }))}
                              type={isSecret ? 'password' : 'text'}
                              placeholder={isSecret ? '••••••••' : undefined}
                              className="w-full px-2 py-1.5 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.72rem] outline-none focus:border-[var(--p1)] font-mono"
                            />
                          </div>
                        );
                      })}
                    </div>
                    {intg.name === 'email' && (
                      <p className="text-[0.62rem] text-[var(--t3)]">
                        For Gmail, enter your Gmail address, paste the <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-[var(--p1)] underline">App Password</a>, set destination email, then Save + Test. Gmail host/port defaults are auto-filled.
                      </p>
                    )}
                    {intg.name === 'slack' && (
                      <p className="text-[0.62rem] text-[var(--t3)]">
                        Create an Incoming Webhook in your Slack workspace under <span className="font-mono bg-[var(--s1)] px-1 rounded">App Directory → Incoming Webhooks</span> and paste the URL above.
                      </p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => handleSaveConfig(intg.name)} className="px-4 py-1.5 rounded bg-[var(--p1)] text-white text-[0.68rem] font-bold hover:bg-[var(--pd)]">Save</button>
                      <button onClick={() => setEditing(null)} className="px-4 py-1.5 rounded border border-[var(--b2)] text-[var(--t4)] text-[0.68rem] font-semibold hover:bg-[var(--s1)]">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Firewalls */}
      {activeSection === 'firewalls' && <FirewallSection />}

      {/* Activity Log */}
      {activeSection === 'logs' && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-[var(--s1)]">
            <p className="text-[0.78rem] font-black text-[var(--t7)]">Recent Actions ({actionLogs.length})</p>
          </div>
          <div className="divide-y divide-[var(--b1)] max-h-[500px] overflow-y-auto">
            {actionLogs.length === 0 ? (
              <div className="p-6 text-center text-[var(--t3)] text-[0.78rem]">No action logs yet.</div>
            ) : actionLogs.map((l: any) => (
              <div key={l.id} className="px-4 py-2.5 flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${l.status === 'success' ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-[0.65rem] font-bold text-[var(--t7)] w-20">{l.integration}</span>
                <span className="text-[0.62rem] text-[var(--t4)] flex-1 truncate">{l.action} — {l.payload}</span>
                <span className="text-[0.58rem] text-[var(--t3)] font-mono">{l.created_at?.slice(0, 16)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Alert Ingest ────────────────────────────────────────────────────── */}
      {activeSection === 'ingest' && isAdmin && (
        <div className="space-y-5">

          {/* Alert Ingestion card */}
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[var(--p1)]" />
                <h3 className="text-[0.85rem] font-bold text-[var(--p1)]">Alert Ingestion</h3>
                <span className="text-[0.65rem] text-[var(--t3)]">Global controls for all alerts received via API key.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[0.62rem] font-black uppercase tracking-wide ${ingestCfg.ingest_enabled === 'false' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-800'}`}>
                  {ingestCfg.ingest_enabled === 'false' ? 'Paused' : 'Active'}
                </span>
              </div>
            </div>
            <div className="p-5 space-y-5">

              {/* Global on/off */}
              <div className="flex items-center justify-between py-2 border-b border-[var(--b2)]">
                <div>
                  <p className="text-[0.82rem] font-bold text-[var(--t6)]">Receive alerts</p>
                  <p className="text-[0.68rem] text-[var(--t3)] mt-0.5">When off, all ingest requests return HTTP 503 regardless of key.</p>
                </div>
                <button
                  onClick={() => setIngestCfg(c => ({ ...c, ingest_enabled: c.ingest_enabled === 'false' ? 'true' : 'false' }))}
                  className="shrink-0"
                  title="Toggle global ingestion"
                >
                  {ingestCfg.ingest_enabled === 'false'
                    ? <ToggleLeft size={32} className="text-[var(--t3)] hover:text-[var(--t5)] transition-colors" />
                    : <ToggleRight size={32} className="text-[var(--p1)]" />}
                </button>
              </div>

              {/* Settings grid */}
              <div className="grid grid-cols-2 gap-x-8 gap-y-4">

                {/* Min severity */}
                <div className="space-y-1.5">
                  <label className="text-[0.72rem] font-black text-[var(--t4)] uppercase tracking-widest">Min Severity Level</label>
                  <p className="text-[0.65rem] text-[var(--t3)]">Alerts below this Wazuh level (0–15) are silently dropped.</p>
                  <div className="flex items-center gap-3">
                    <input
                      type="range" min="0" max="15" step="1"
                      value={ingestCfg.min_severity ?? '7'}
                      onChange={e => setIngestCfg(c => ({ ...c, min_severity: e.target.value }))}
                      className="flex-1 accent-[var(--p1)]"
                    />
                    <span className="w-8 text-center font-black text-[var(--t1)] text-[0.9rem] tabular-nums">{ingestCfg.min_severity ?? '7'}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[0.58rem] font-black uppercase ${
                      Number(ingestCfg.min_severity ?? 7) >= 12 ? 'bg-red-100 text-red-700' :
                      Number(ingestCfg.min_severity ?? 7) >= 7  ? 'bg-orange-100 text-orange-700' :
                      Number(ingestCfg.min_severity ?? 7) >= 4  ? 'bg-amber-100 text-amber-700' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {Number(ingestCfg.min_severity ?? 7) >= 12 ? 'Critical+' :
                       Number(ingestCfg.min_severity ?? 7) >= 7  ? 'High+' :
                       Number(ingestCfg.min_severity ?? 7) >= 4  ? 'Medium+' : 'All'}
                    </span>
                  </div>
                </div>

                {/* Rate limit */}
                <div className="space-y-1.5">
                  <label className="text-[0.72rem] font-black text-[var(--t4)] uppercase tracking-widest">Rate Limit (alerts / min)</label>
                  <p className="text-[0.65rem] text-[var(--t3)]">Requests beyond this threshold return HTTP 429. Set 0 to disable.</p>
                  <input
                    type="number" min="0" max="10000" step="10"
                    value={ingestCfg.max_alerts_per_min ?? '60'}
                    onChange={e => setIngestCfg(c => ({ ...c, max_alerts_per_min: e.target.value }))}
                    className="w-full border border-[var(--b2)] rounded px-3 py-1.5 text-[0.78rem] outline-none focus:border-[var(--p1)] font-mono bg-[var(--s1)]"
                  />
                </div>

                {/* Dedup window */}
                <div className="space-y-1.5">
                  <label className="text-[0.72rem] font-black text-[var(--t4)] uppercase tracking-widest">Deduplication Window (minutes)</label>
                  <p className="text-[0.65rem] text-[var(--t3)]">Identical alerts (same rule + source IP) within this window are dropped.</p>
                  <input
                    type="number" min="0" max="1440" step="1"
                    value={ingestCfg.dedup_window_minutes ?? '5'}
                    onChange={e => setIngestCfg(c => ({ ...c, dedup_window_minutes: e.target.value }))}
                    className="w-full border border-[var(--b2)] rounded px-3 py-1.5 text-[0.78rem] outline-none focus:border-[var(--p1)] font-mono bg-[var(--s1)]"
                  />
                </div>

                {/* Active hours */}
                <div className="space-y-1.5">
                  <label className="text-[0.72rem] font-black text-[var(--t4)] uppercase tracking-widest">Active Hours (24h, optional)</label>
                  <p className="text-[0.65rem] text-[var(--t3)]">Only accept alerts during this window. Leave empty to accept all hours.</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={ingestCfg.time_window_start ?? ''}
                      onChange={e => setIngestCfg(c => ({ ...c, time_window_start: e.target.value }))}
                      className="flex-1 border border-[var(--b2)] rounded px-2 py-1.5 text-[0.78rem] outline-none focus:border-[var(--p1)] font-mono bg-[var(--s1)]"
                    />
                    <span className="text-[var(--t3)] text-[0.72rem] font-bold shrink-0">to</span>
                    <input
                      type="time"
                      value={ingestCfg.time_window_end ?? ''}
                      onChange={e => setIngestCfg(c => ({ ...c, time_window_end: e.target.value }))}
                      className="flex-1 border border-[var(--b2)] rounded px-2 py-1.5 text-[0.78rem] outline-none focus:border-[var(--p1)] font-mono bg-[var(--s1)]"
                    />
                    {(ingestCfg.time_window_start || ingestCfg.time_window_end) && (
                      <button
                        onClick={() => setIngestCfg(c => ({ ...c, time_window_start: '', time_window_end: '' }))}
                        className="text-[var(--t3)] hover:text-[var(--t6)]" title="Clear"
                      ><X size={13} /></button>
                    )}
                  </div>
                </div>
              </div>

              {/* Auto-orchestrate */}
              <div className="flex items-center justify-between py-2 border-t border-[var(--b2)]">
                <div>
                  <p className="text-[0.82rem] font-bold text-[var(--t6)]">Auto-orchestrate new alerts</p>
                  <p className="text-[0.68rem] text-[var(--t3)] mt-0.5">Immediately run AI agents on every alert received via API.</p>
                </div>
                <button
                  onClick={() => setIngestCfg(c => ({ ...c, auto_orchestrate: c.auto_orchestrate === 'false' ? 'true' : 'false' }))}
                  className="shrink-0"
                >
                  {ingestCfg.auto_orchestrate === 'false'
                    ? <ToggleLeft size={32} className="text-[var(--t3)] hover:text-[var(--t5)] transition-colors" />
                    : <ToggleRight size={32} className="text-[var(--p1)]" />}
                </button>
              </div>

              {/* Save button */}
              <div className="flex justify-end">
                <button
                  onClick={handleSaveIngestCfg}
                  disabled={ingestSaving}
                  className="px-4 py-2 rounded bg-[var(--p1)] text-white text-[0.78rem] font-bold hover:bg-[var(--pd)] transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {ingestSaving ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                  {ingestSaving ? 'Saving…' : 'Save Ingest Settings'}
                </button>
              </div>
            </div>
          </div>

          {/* API Keys card */}
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-[var(--p1)]" />
                <h3 className="text-[0.85rem] font-bold text-[var(--p1)]">API Keys</h3>
                <span className="text-[0.65rem] text-[var(--t3)]">Authenticate Wazuh and external forwarders to POST alerts to this platform.</span>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {/* Ingest endpoint info */}
              <div className="bg-[var(--s2)] border border-[var(--b2)] rounded-lg px-4 py-3 flex items-start gap-3">
                <Webhook className="w-4 h-4 text-[var(--p1)] mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[0.72rem] font-bold text-[var(--t6)] mb-1">Ingest endpoint</p>
                  <div className="flex gap-2 items-center">
                    <code className="flex-1 text-[0.72rem] font-mono text-[var(--t5)] bg-[var(--s0)] border border-[var(--b2)] rounded px-2 py-1 truncate">
                      POST {window.location.protocol}//{window.location.host}/api/ingest
                    </code>
                    <button onClick={() => { navigator.clipboard.writeText(`${window.location.protocol}//${window.location.host}/api/ingest`); toast('URL copied'); }} className="shrink-0 px-2 py-1 rounded border border-[var(--b2)] hover:bg-[var(--s1)] transition-colors" title="Copy">
                      <Copy size={12} className="text-[var(--t4)]" />
                    </button>
                  </div>
                  <p className="text-[0.65rem] text-[var(--t3)] mt-1.5">
                    Send alerts with header: <code className="font-mono bg-[var(--s1)] px-1 rounded">X-Api-Key: sk_aisoc_…</code>
                  </p>
                  <details className="mt-2 group">
                    <summary className="cursor-pointer text-[0.65rem] font-bold text-[var(--p1)] hover:underline list-none flex items-center gap-1">
                      <ChevronDown size={10} className="group-open:rotate-180 transition-transform" />Test curl command
                    </summary>
                    <div className="mt-2">
                      {(() => {
                        const cmd = `curl -sk -X POST ${window.location.protocol}//${window.location.host}/api/ingest \\\n  -H "Content-Type: application/json" \\\n  -H "X-Api-Key: YOUR_KEY_HERE" \\\n  -d '{"rule":{"id":"test-001","description":"API key connectivity test","level":3},"agent":{"name":"test-host"},"data":{"srcip":"192.168.1.100"}}'`;
                        return (
                          <>
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-[0.6rem] text-[var(--t3)]">Replace <code className="font-mono bg-[var(--s1)] px-0.5">YOUR_KEY_HERE</code> with your key</p>
                              <button onClick={() => { navigator.clipboard.writeText(cmd.replace(/\\\n  /g, ' \\\n  ')); toast('Copied'); }} className="flex items-center gap-1 text-[0.6rem] text-[var(--p1)] hover:underline"><Copy size={8}/>Copy</button>
                            </div>
                            <pre className="bg-slate-900 text-slate-200 rounded p-2.5 text-[0.65rem] font-mono overflow-x-auto whitespace-pre leading-relaxed">{cmd}</pre>
                            <p className="text-[0.6rem] text-[var(--t3)] mt-1">
                              ✓ <code className="font-mono">{`{"status":"filtered",...}`}</code> = key valid, alert below min severity<br/>
                              ✗ <code className="font-mono">{`{"error":"Invalid or revoked API key."}`}</code> = key rejected
                            </p>
                          </>
                        );
                      })()}
                    </div>
                  </details>
                </div>
              </div>

              {/* Key creation row */}
              <div className="flex gap-2">
                <input
                  value={newKeyName}
                  onChange={e => setNewKeyName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateKey()}
                  placeholder="Key name (e.g. wazuh-manager-prod)"
                  className="flex-1 border border-[var(--b2)] rounded px-3 py-2 text-[0.78rem] outline-none focus:border-[var(--p1)] font-mono"
                />
                <button
                  onClick={handleCreateKey}
                  disabled={keyCreating || !newKeyName.trim()}
                  className="px-4 py-2 rounded bg-[var(--p1)] text-white text-[0.78rem] font-bold hover:bg-[var(--pd)] transition-colors disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Plus size={13} />{keyCreating ? 'Creating…' : 'Create Key'}
                </button>
              </div>

              {/* Created key reveal — shown once */}
              {createdKey && (() => {
                const curlCmd = `curl -sk -X POST ${window.location.protocol}//${window.location.host}/api/ingest \\\n  -H "Content-Type: application/json" \\\n  -H "X-Api-Key: ${createdKey.key}" \\\n  -d '{"rule":{"id":"test-001","description":"API key connectivity test","level":3},"agent":{"name":"test-host"},"data":{"srcip":"192.168.1.100"}}'`;
                return (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
                    <p className="text-[0.72rem] font-black text-green-800 flex items-center gap-1.5">
                      <CheckCircle size={13} /> API key created — copy it now, it won't be shown again
                    </p>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        type={showKeyValue ? 'text' : 'password'}
                        value={createdKey.key}
                        className="flex-1 border border-green-300 rounded px-2 py-1.5 text-[0.75rem] font-mono bg-white text-green-900"
                      />
                      <button onClick={() => setShowKeyValue(v => !v)} className="px-2 py-1.5 rounded border border-green-300 text-green-700 text-[0.68rem] font-bold hover:bg-green-100 transition-colors">{showKeyValue ? 'Hide' : 'Show'}</button>
                      <button onClick={() => { navigator.clipboard.writeText(createdKey.key); toast('Key copied!', 'success'); }} className="px-2 py-1.5 rounded border border-green-300 hover:bg-green-100 transition-colors" title="Copy key"><Copy size={13} className="text-green-700" /></button>
                      <button onClick={() => { setCreatedKey(null); setShowKeyValue(false); }} className="px-2 py-1.5 rounded border border-green-300 text-green-700 hover:bg-green-100 transition-colors"><X size={13} /></button>
                    </div>
                    <div className="border-t border-green-200 pt-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[0.65rem] font-black text-green-700 uppercase tracking-wider">Test your key (run this in a terminal)</p>
                        <button
                          onClick={() => { navigator.clipboard.writeText(curlCmd.replace(/\\\n  /g, ' \\\n  ')); toast('curl command copied!', 'success'); }}
                          className="flex items-center gap-1 text-[0.62rem] text-green-700 hover:underline font-bold"
                        ><Copy size={9} />Copy</button>
                      </div>
                      <pre className="bg-green-900 text-green-200 rounded p-3 text-[0.68rem] font-mono overflow-x-auto whitespace-pre leading-relaxed">{curlCmd}</pre>
                      <p className="text-[0.62rem] text-green-700 mt-1.5">
                        Expected response: <code className="font-mono bg-green-100 px-1 rounded">{`{"status":"filtered","reason":"severity 3 below min 7"}`}</code> — key works, alert filtered by severity setting.<br/>
                        If you see <code className="font-mono bg-green-100 px-1 rounded">{`{"error":"Invalid or revoked API key."}`}</code> the key is wrong.
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* Existing keys */}
              {apiKeys.length > 0 ? (
                <div className="space-y-2">
                  {apiKeys.map((k: any) => (
                    <div key={k.id} className={`border border-[var(--b2)] rounded-lg overflow-hidden ${k.revoked ? 'opacity-50' : ''}`}>
                      <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--s1)] hover:bg-[var(--s2)] transition-colors">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${k.revoked ? 'bg-red-400' : k.paused ? 'bg-amber-400' : 'bg-green-500'}`} />
                        <div className="flex-1 min-w-0">
                          <span className="text-[0.82rem] font-bold text-[var(--t6)]">{k.name}</span>
                          <span className="ml-2 font-mono text-[0.68rem] text-[var(--t3)]">{k.key_prefix}</span>
                        </div>
                        <span className="text-[0.68rem] text-[var(--t3)] hidden sm:block shrink-0">
                          {k.last_used_at ? `Used ${timeAgo(new Date(k.last_used_at).getTime())}` : 'Never used'}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[0.62rem] font-black uppercase tracking-wide shrink-0 ${
                          k.revoked ? 'bg-red-100 text-red-700' :
                          k.paused  ? 'bg-amber-100 text-amber-700' :
                          'bg-green-100 text-green-800'
                        }`}>
                          {k.revoked ? 'Revoked' : k.paused ? 'Paused' : 'Active'}
                        </span>
                        {!k.revoked && (
                          <button
                            onClick={() => handleToggleKeyPause(k)}
                            disabled={keyUpdating[k.id]}
                            title={k.paused ? 'Resume ingestion for this key' : 'Pause ingestion for this key'}
                            className="shrink-0 disabled:opacity-40"
                          >
                            {k.paused
                              ? <ToggleLeft size={24} className="text-amber-500 hover:text-amber-600 transition-colors" />
                              : <ToggleRight size={24} className="text-green-600 hover:text-green-700 transition-colors" />}
                          </button>
                        )}
                        {!k.revoked && (
                          <button
                            onClick={() => setExpandedKey(expandedKey === k.id ? null : k.id)}
                            className="shrink-0 text-[0.65rem] font-bold text-[var(--p1)] hover:underline"
                          >
                            {expandedKey === k.id ? 'Close' : 'Configure'}
                          </button>
                        )}
                        {!k.revoked && (
                          <button
                            disabled={keyRevoke[k.id]}
                            onClick={() => setRevokeKeyId(k.id)}
                            className="shrink-0 text-[0.65rem] text-red-600 hover:underline font-semibold disabled:opacity-50"
                          >Revoke</button>
                        )}
                      </div>
                      {expandedKey === k.id && !k.revoked && (
                        <div className="px-4 py-3 border-t border-[var(--b2)] bg-[var(--s0)] space-y-3">
                          <p className="text-[0.68rem] font-black text-[var(--t3)] uppercase tracking-widest">Per-key overrides</p>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-[0.75rem] font-bold text-[var(--t6)]">Accept alerts</p>
                                <p className="text-[0.62rem] text-[var(--t3)]">When off, this key returns HTTP 403.</p>
                              </div>
                              <button onClick={() => handleToggleKeyPause(k)} disabled={keyUpdating[k.id]} className="shrink-0">
                                {k.paused
                                  ? <ToggleLeft size={28} className="text-amber-400 hover:text-amber-500 transition-colors" />
                                  : <ToggleRight size={28} className="text-[var(--p1)]" />}
                              </button>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[0.68rem] font-black text-[var(--t3)] uppercase tracking-widest">Min Severity Override</label>
                              <p className="text-[0.62rem] text-[var(--t3)]">Overrides global min ({ingestCfg.min_severity ?? '7'}). Leave blank to use global.</p>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number" min="0" max="15" step="1"
                                  placeholder={`Global: ${ingestCfg.min_severity ?? '7'}`}
                                  defaultValue={k.min_severity_override ?? ''}
                                  onBlur={e => handleKeyMinSev(k, e.target.value)}
                                  className="w-24 border border-[var(--b2)] rounded px-2 py-1 text-[0.72rem] font-mono outline-none focus:border-[var(--p1)] bg-[var(--s1)]"
                                />
                                {k.min_severity_override != null && (
                                  <span className={`px-1.5 py-0.5 rounded text-[0.58rem] font-black uppercase ${
                                    k.min_severity_override >= 12 ? 'bg-red-100 text-red-700' :
                                    k.min_severity_override >= 7  ? 'bg-orange-100 text-orange-700' :
                                    k.min_severity_override >= 4  ? 'bg-amber-100 text-amber-700' :
                                    'bg-green-100 text-green-700'
                                  }`}>
                                    {k.min_severity_override >= 12 ? 'Critical+' :
                                     k.min_severity_override >= 7  ? 'High+' :
                                     k.min_severity_override >= 4  ? 'Medium+' : 'All'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <p className="text-[0.6rem] text-[var(--t3)] italic">Changes apply immediately — no restart needed.</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[0.78rem] text-[var(--t3)] text-center py-4">No API keys yet. Create one above to connect Wazuh.</p>
              )}
            </div>
          </div>

        </div>
      )}
      {revokeKeyId !== null && (
        <ConfirmModal
          title="Revoke API Key"
          message="Revoke this key? Any Wazuh scripts using it will stop working immediately."
          confirmLabel="Revoke"
          onConfirm={() => handleRevokeKey(revokeKeyId)}
          onCancel={() => setRevokeKeyId(null)}
        />
      )}
    </div>
  );
};


export default function App() {
  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem('soc_active_tab');
    const validTabs = ['dashboard', 'investigation', 'incidents', 'noise-filter', 'fp-archive', 'response-actions', 'reports', 'knowledge', 'integrations', 'settings', 'profile'];
    return (saved && validTabs.includes(saved)) ? saved : 'dashboard';
  });
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(() => localStorage.getItem('soc_selected_alert_id'));
  const [socket, setSocket] = useState<Socket | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [autoFilter, setAutoFilter] = useState(() => localStorage.getItem('soc_auto_filter') === 'true');
  const autoFilterRef = useRef(autoFilter);
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  useEffect(() => { autoFilterRef.current = autoFilter; localStorage.setItem('soc_auto_filter', String(autoFilter)); }, [autoFilter]);

  // Auto-filter is bound to backend wazuh.auto_orchestrate. Sync on mount + on flip.
  const wazuhCfgRef = useRef<Record<string, string>>({});
  useEffect(() => {
    getIntegrations().then(list => {
      const w = list.find((i: any) => i.name === 'wazuh');
      if (w?.config) {
        wazuhCfgRef.current = w.config;
        setAutoFilter(w.config.auto_orchestrate !== 'false');
      }
    }).catch(() => {});
  }, []);

  const setAutoFilterSynced = useCallback((v: boolean) => {
    setAutoFilter(v);
    const next = { ...wazuhCfgRef.current, auto_orchestrate: v ? 'true' : 'false' };
    wazuhCfgRef.current = next;
    updateIntegration('wazuh', { config: next }).catch(() => {});
  }, []);

  const showToast = useCallback((msg: string, type: ToastItem['type'] = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message: msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const selectedAlert = alerts.find((alert) => alert.id === selectedAlertId) || null;

  const refreshAlerts = useCallback(() => {
    const socToken = localStorage.getItem('soc_token');
    if (!socToken) return;
    fetch('/api/alerts?pageSize=100', { headers: { Authorization: `Bearer ${socToken}` } })
      .then(r => r.json())
      .then(data => { const list = Array.isArray(data) ? data : data?.alerts; if (Array.isArray(list)) setAlerts(list); })
      .catch(() => {});
  }, []);

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
      // Backend's auto_orchestrate handles the full pipeline. Just refresh the list.
      fetch('/api/alerts?pageSize=100', {
        headers: { Authorization: `Bearer ${socToken}` }
      }).then(res => res.json())
        .then(raw => {
          const dataList = Array.isArray(raw) ? raw : raw?.alerts;
          if (Array.isArray(dataList)) setAlerts(dataList);
        });
      // Toast on arrival (auto path will show ANALYZING/TRIAGED/FP toasts via alert_updated)
      if (autoFilterRef.current) {
        showToast(`📥 New alert ALERT-${String(data.id).slice(0, 8).toUpperCase()} — auto-investigating…`, 'info');
      }
    });

    newSocket.on('alert_updated', (data) => {
      const prev = prevStatusRef.current.get(data.id);
      const next = data.status;
      if (next) prevStatusRef.current.set(data.id, next);

      if (next && prev && prev !== next) {
        const shortId = `ALERT-${String(data.id).slice(0, 8).toUpperCase()}`;
        if (next === 'FALSE_POSITIVE' || next === 'FP_CONFIRMED' || next === 'FILTERED') {
          showToast(`✅ ${shortId} — auto-archived as FP`, 'success');
        } else if (next === 'TRIAGED' || next === 'ESCALATED' || next === 'INCIDENT') {
          let priority = '';
          try {
            const ai = typeof data.ai_analysis === 'string' ? JSON.parse(data.ai_analysis) : data.ai_analysis;
            priority = ai?.ticket?.priority || ai?.phaseData?.ticket?.priority || '';
          } catch {}
          showToast(`🚨 ${shortId} — ${priority ? priority + ' incident' : 'incident detected'}`, 'error');
        }
      }

      setAlerts(prevAlerts => Array.isArray(prevAlerts) ? prevAlerts.map(a => a.id === data.id ? { ...a, ...data } : a) : prevAlerts);
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
            autoFilter={autoFilter}
            setAutoFilter={setAutoFilterSynced}
            refreshAlerts={refreshAlerts}
          />
        </AuthProvider>
        <ToastContainer toasts={toasts} />
      </ToastContext.Provider>
    </DarkModeProvider>
  );
}

// ─── Knowledge Base ────────────────────────────────────────────────────────
const KnowledgeBaseTab = ({
  alerts,
  setActiveTab,
  setSelectedAlert,
}: {
  alerts:           Alert[];
  setActiveTab:     (t: string) => void;
  setSelectedAlert: (a: Alert | null) => void;
}) => {
  const showToast = useToast();
  const { user }  = useAuth();
  const isAdmin   = user?.role === 'ADMIN';

  type Section = 'playbooks' | 'incidents' | 'iocs';
  const [section, setSection] = useState<Section>('playbooks');

  // Stats / RAG status
  const [ragStatus, setRagStatus] = useState<{ ok: boolean; model_count?: number } | null>(null);
  useEffect(() => { testLocalLLM().then(setRagStatus).catch(() => setRagStatus({ ok: false })); }, []);

  // ── Playbooks state ──────────────────────────────────────────────────────
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [pbSearch,  setPbSearch]  = useState('');
  const [pbTactic,  setPbTactic]  = useState<string>('');
  const [showPBForm, setShowPBForm] = useState(false);
  const [pbForm, setPBForm] = useState({ tactic: 'CREDENTIAL_ACCESS', title: '', steps: '' });
  const [pbError, setPBError] = useState('');
  const [editingPB, setEditingPB] = useState<number | null>(null);
  const [editPBForm, setEditPBForm] = useState({ tactic: '', title: '', steps: '' });

  const fetchPlaybooks = () => getPlaybooks().then(setPlaybooks).catch(() => {});
  useEffect(() => { fetchPlaybooks(); }, []);

  const handleCreatePlaybook = async (e: React.FormEvent) => {
    e.preventDefault();
    setPBError('');
    if (!pbForm.title || !pbForm.steps) { setPBError('Title and steps are required.'); return; }
    try {
      const r: any = await createPlaybook(pbForm);
      if (r?.error) { setPBError(r.error); return; }
      fetchPlaybooks();
      setShowPBForm(false);
      setPBForm({ tactic: 'CREDENTIAL_ACCESS', title: '', steps: '' });
      showToast('Playbook created', 'success');
    } catch { setPBError('Failed to create playbook.'); }
  };

  const [deletePBId, setDeletePBId] = useState<number | null>(null);
  const handleDeletePlaybook = async (id: number) => {
    setDeletePBId(null);
    await deletePlaybook(id);
    fetchPlaybooks();
    showToast('Playbook deleted', 'info');
  };

  const startEditPB = (pb: Playbook) => {
    setEditingPB(pb.id);
    setEditPBForm({ tactic: pb.tactic, title: pb.title, steps: pb.steps });
  };

  const saveEditPB = async (id: number) => {
    if (!editPBForm.title || !editPBForm.steps) return;
    await updatePlaybook(id, editPBForm);
    setEditingPB(null);
    fetchPlaybooks();
    showToast('Playbook updated', 'success');
  };

  const filteredPlaybooks = React.useMemo(() => {
    let res = playbooks;
    if (pbTactic) res = res.filter(p => p.tactic === pbTactic);
    if (pbSearch) {
      const q = pbSearch.toLowerCase();
      res = res.filter(p => p.title.toLowerCase().includes(q) || p.steps.toLowerCase().includes(q));
    }
    return res;
  }, [playbooks, pbSearch, pbTactic]);

  // ── Incidents state ──────────────────────────────────────────────────────
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsTotal, setInsightsTotal] = useState(0);
  const [insightSearch, setInsightSearch] = useState('');
  const [insightOutcome, setInsightOutcome] = useState<string>('');
  const [insightsLoading, setInsightsLoading] = useState(false);

  const fetchInsights = useCallback(() => {
    setInsightsLoading(true);
    getInsights({ q: insightSearch || undefined, outcome: insightOutcome || undefined, limit: 100 })
      .then(d => { setInsights(d.rows); setInsightsTotal(d.total); })
      .catch(() => { setInsights([]); setInsightsTotal(0); })
      .finally(() => setInsightsLoading(false));
  }, [insightSearch, insightOutcome]);

  useEffect(() => {
    if (section !== 'incidents') return;
    const t = setTimeout(fetchInsights, 200);
    return () => clearTimeout(t);
  }, [section, fetchInsights]);

  // ── IOCs state ───────────────────────────────────────────────────────────
  const [iocs, setIocs] = useState<IocRow[]>([]);
  const [iocsTotal, setIocsTotal] = useState(0);
  const [iocSearch, setIocSearch] = useState('');
  const [iocType, setIocType]     = useState<string>('');
  const [iocSort, setIocSort]     = useState<'alerts' | 'fp_ratio' | 'last_seen'>('alerts');

  const fetchIocs = useCallback(() => {
    getIocs({ q: iocSearch || undefined, type: iocType || undefined, limit: 200 })
      .then(d => { setIocs(d.rows); setIocsTotal(d.total); })
      .catch(() => { setIocs([]); setIocsTotal(0); });
  }, [iocSearch, iocType]);

  useEffect(() => {
    if (section !== 'iocs') return;
    const t = setTimeout(fetchIocs, 200);
    return () => clearTimeout(t);
  }, [section, fetchIocs]);

  const sortedIocs = React.useMemo(() => {
    const arr = [...iocs];
    arr.sort((a, b) => {
      if (iocSort === 'alerts')    return b.alert_count - a.alert_count;
      if (iocSort === 'fp_ratio')  return (b.fp_ratio ?? -1) - (a.fp_ratio ?? -1);
      if (iocSort === 'last_seen') return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
      return 0;
    });
    return arr;
  }, [iocs, iocSort]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const outcomeColor: Record<string, string> = {
    TRIAGED:        'bg-blue-100 text-blue-700 border border-blue-200',
    FALSE_POSITIVE: 'bg-green-100 text-green-700 border border-green-200',
    FP_CONFIRMED:   'bg-green-100 text-green-700 border border-green-200',
    ESCALATED:      'bg-red-100 text-red-700 border border-red-200',
    CLOSED:         'bg-gray-100 text-gray-700 border border-gray-200',
    INCIDENT:       'bg-orange-100 text-orange-700 border border-orange-200',
  };

  const threatColor: Record<string, string> = {
    HIGH:   'bg-red-100 text-red-700',
    MEDIUM: 'bg-amber-100 text-amber-700',
    LOW:    'bg-green-100 text-green-700',
  };

  const goToAlert = (alertId: string) => {
    const alert = alerts.find(a => a.id === alertId);
    if (alert) {
      setSelectedAlert(alert);
      setActiveTab('investigation');
    } else {
      showToast(`Alert ${alertId.slice(0, 8)} no longer in active list`, 'info');
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5 overflow-y-auto h-full">
      <PageHeader
        eyebrow="SOC Memory"
        title="Knowledge Base"
        description="Playbooks, RAG-indexed incidents, and IOC memory — auto-populated from agent investigations."
      />

      {/* ── Stats row ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-3 flex items-center gap-3">
          <BookOpen className="w-5 h-5 text-blue-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest">Playbooks</p>
            <p className="text-[1.2rem] font-black text-[var(--t7)] tabular-nums">{playbooks.length}</p>
          </div>
        </div>
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-3 flex items-center gap-3">
          <Database className="w-5 h-5 text-violet-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest">Indexed Incidents</p>
            <p className="text-[1.2rem] font-black text-[var(--t7)] tabular-nums">{insightsTotal}</p>
          </div>
        </div>
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-3 flex items-center gap-3">
          <Shield className="w-5 h-5 text-amber-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest">Tracked IOCs</p>
            <p className="text-[1.2rem] font-black text-[var(--t7)] tabular-nums">{iocsTotal}</p>
          </div>
        </div>
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-3 flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${ragStatus?.ok ? 'bg-green-500' : 'bg-gray-400'}`} />
          <div className="min-w-0">
            <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest">RAG / Embeddings</p>
            <p className="text-[0.78rem] font-bold text-[var(--t7)] truncate">
              {ragStatus?.ok ? `Ollama · ${ragStatus.model_count ?? 0} models` : 'Offline (substring search)'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Sub-section tabs ────────────────────────────────────────────── */}
      <div className="flex gap-2 border-b border-[var(--b1)]">
        {([
          { id: 'playbooks',  label: 'Playbooks',  count: playbooks.length },
          { id: 'incidents',  label: 'Incidents',  count: insightsTotal },
          { id: 'iocs',       label: 'IOC Memory', count: iocsTotal },
        ] as const).map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`px-4 py-2 text-[0.78rem] font-bold transition-colors border-b-2 -mb-[1px] ${section === s.id ? 'border-[var(--p1)] text-[var(--p1)]' : 'border-transparent text-[var(--t4)] hover:text-[var(--t6)]'}`}
          >
            {s.label} <span className="text-[0.65rem] font-mono text-[var(--t3)] ml-1">({s.count})</span>
          </button>
        ))}
      </div>

      {/* ── Playbooks ───────────────────────────────────────────────────── */}
      {section === 'playbooks' && (
        <div className="space-y-3">
          {/* Filter bar */}
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3 space-y-2.5">
            <div className="flex gap-2 items-center">
              <div className="flex-1 relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--t3)]" />
                <input
                  value={pbSearch}
                  onChange={e => setPbSearch(e.target.value)}
                  placeholder="Search playbooks (title or steps)…"
                  className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-[var(--b2)] bg-[var(--s1)] text-[0.75rem] text-[var(--t1)] placeholder:text-[var(--t3)] focus:outline-none focus:border-[var(--p1)]"
                />
                {pbSearch && (
                  <button onClick={() => setPbSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--t3)] hover:text-[var(--t1)]">
                    <X size={12} />
                  </button>
                )}
              </div>
              {isAdmin && (
                <button
                  onClick={() => setShowPBForm(!showPBForm)}
                  className="flex items-center gap-1.5 bg-[var(--p1)] text-white px-3 py-1.5 rounded-lg text-[0.7rem] font-bold hover:bg-[var(--pd)] whitespace-nowrap"
                >
                  <Plus size={12} />Add Playbook
                </button>
              )}
            </div>

            <div className="flex gap-2 items-center flex-wrap">
              <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Tactic:</span>
              {TACTIC_OPTIONS.map(t => {
                const isActive = pbTactic === t;
                return (
                  <button
                    key={t}
                    onClick={() => setPbTactic(isActive ? '' : t)}
                    className={`px-2 py-0.5 rounded-full border text-[0.62rem] font-black uppercase tracking-wider transition-all font-mono ${isActive ? 'bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-offset-0 ring-blue-200' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
                  >
                    {t.replace(/_/g, ' ')}
                  </button>
                );
              })}
              {(pbSearch || pbTactic) && (
                <button
                  onClick={() => { setPbSearch(''); setPbTactic(''); }}
                  className="ml-auto text-[0.62rem] font-bold text-[var(--p1)] hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* Create form */}
          {showPBForm && isAdmin && (
            <form onSubmit={handleCreatePlaybook} className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-4 space-y-3">
              {pbError && <p className="text-red-600 text-sm font-semibold">{pbError}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[0.65rem] font-black text-[var(--t4)] uppercase tracking-wider block mb-1">MITRE Tactic</label>
                  <select value={pbForm.tactic} onChange={e => setPBForm({ ...pbForm, tactic: e.target.value })} className="w-full border border-[var(--b2)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--p1)] bg-[var(--s0)]">
                    {TACTIC_OPTIONS.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[0.65rem] font-black text-[var(--t4)] uppercase tracking-wider block mb-1">Title</label>
                  <input required value={pbForm.title} onChange={e => setPBForm({ ...pbForm, title: e.target.value })} placeholder="e.g. Brute Force Response" className="w-full border border-[var(--b2)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--p1)] bg-[var(--s0)]" />
                </div>
              </div>
              <div>
                <label className="text-[0.65rem] font-black text-[var(--t4)] uppercase tracking-wider block mb-1">Steps</label>
                <textarea required value={pbForm.steps} onChange={e => setPBForm({ ...pbForm, steps: e.target.value })} rows={4} placeholder="1. Block source IP at firewall&#10;2. Lock affected account…" className="w-full border border-[var(--b2)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--p1)] resize-none font-mono bg-[var(--s0)]" />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="bg-[var(--p1)] text-white px-4 py-1.5 rounded text-sm font-bold hover:bg-[var(--pd)]">Create</button>
                <button type="button" onClick={() => setShowPBForm(false)} className="border border-[var(--b2)] text-[var(--t5)] px-4 py-1.5 rounded text-sm font-semibold hover:bg-[var(--s1)]">Cancel</button>
              </div>
            </form>
          )}

          {/* List */}
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg overflow-hidden divide-y divide-[var(--b1)]">
            {filteredPlaybooks.length === 0 ? (
              <div className="p-8 text-center text-[var(--t3)] text-sm">
                {playbooks.length === 0 ? 'No playbooks yet. Add one above.' : 'No playbooks match this filter.'}
              </div>
            ) : filteredPlaybooks.map(pb => (
              <div key={pb.id} className="px-5 py-3 hover:bg-[var(--s1)]">
                {editingPB === pb.id ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <select value={editPBForm.tactic} onChange={e => setEditPBForm({ ...editPBForm, tactic: e.target.value })} className="border border-[var(--b2)] rounded px-2 py-1.5 text-[0.78rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)]">
                        {TACTIC_OPTIONS.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                      </select>
                      <input value={editPBForm.title} onChange={e => setEditPBForm({ ...editPBForm, title: e.target.value })} className="border border-[var(--b2)] rounded px-2 py-1.5 text-[0.78rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)]" />
                    </div>
                    <textarea value={editPBForm.steps} onChange={e => setEditPBForm({ ...editPBForm, steps: e.target.value })} rows={4} className="w-full border border-[var(--b2)] rounded px-2 py-1.5 text-[0.78rem] font-mono outline-none focus:border-[var(--p1)] resize-none bg-[var(--s0)]" />
                    <div className="flex gap-2">
                      <button onClick={() => saveEditPB(pb.id)} className="px-3 py-1 rounded bg-[var(--p1)] text-white text-[0.7rem] font-bold hover:bg-[var(--pd)]">Save</button>
                      <button onClick={() => setEditingPB(null)} className="px-3 py-1 rounded border border-[var(--b2)] text-[var(--t5)] text-[0.7rem] font-semibold hover:bg-[var(--s1)]">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[0.6rem] font-black uppercase tracking-wide">{pb.tactic?.replace(/_/g, ' ')}</span>
                        <p className="text-[0.82rem] font-bold text-[var(--t7)] truncate">{pb.title}</p>
                      </div>
                      <p className="text-[0.72rem] text-[var(--t4)] line-clamp-3 whitespace-pre-line">{pb.steps}</p>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => startEditPB(pb)} className="p-1.5 rounded hover:bg-[var(--s2)] text-[var(--t3)] hover:text-[var(--p1)]" title="Edit">
                          <Settings size={13} />
                        </button>
                        <button onClick={() => setDeletePBId(pb.id)} className="p-1.5 rounded hover:bg-red-50 text-[var(--t3)] hover:text-red-600" title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Incidents ───────────────────────────────────────────────────── */}
      {section === 'incidents' && (
        <div className="space-y-3">
          <div className={`rounded-lg px-3 py-2 text-[0.7rem] flex items-center gap-2 ${ragStatus?.ok ? 'bg-blue-50 text-blue-800 border border-blue-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
            <Database size={13} className="shrink-0" />
            <span>
              {ragStatus?.ok
                ? <>Auto-indexed from agent investigations. Embeddings via Ollama <code className="font-mono bg-blue-100 px-1 rounded">nomic-embed-text</code>. Substring search runs on summaries below.</>
                : <>Semantic indexing offline (Ollama unreachable). Substring search still works — past incidents remain browsable.</>}
            </span>
          </div>

          {/* Filter bar */}
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3 space-y-2.5">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--t3)]" />
              <input
                value={insightSearch}
                onChange={e => setInsightSearch(e.target.value)}
                placeholder="Search summary, attack pattern, threat actor…"
                className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-[var(--b2)] bg-[var(--s1)] text-[0.75rem] text-[var(--t1)] placeholder:text-[var(--t3)] focus:outline-none focus:border-[var(--p1)]"
              />
              {insightSearch && (
                <button onClick={() => setInsightSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--t3)] hover:text-[var(--t1)]">
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="flex gap-2 items-center flex-wrap">
              <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Outcome:</span>
              {(['TRIAGED', 'FALSE_POSITIVE', 'ESCALATED', 'CLOSED'] as const).map(o => {
                const isActive = insightOutcome === o;
                return (
                  <button
                    key={o}
                    onClick={() => setInsightOutcome(isActive ? '' : o)}
                    className={`px-2 py-0.5 rounded-full border text-[0.62rem] font-black uppercase tracking-wider transition-all ${isActive ? (outcomeColor[o] || 'bg-[var(--p1)] text-white') + ' ring-2 ring-offset-0 ring-current' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
                  >
                    {o.replace(/_/g, ' ')}
                  </button>
                );
              })}
              {(insightSearch || insightOutcome) && (
                <button
                  onClick={() => { setInsightSearch(''); setInsightOutcome(''); }}
                  className="ml-auto text-[0.62rem] font-bold text-[var(--p1)] hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {insightsLoading ? (
            <div className="p-8 text-center text-[var(--t3)] text-sm">Loading…</div>
          ) : insights.length === 0 ? (
            <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-8 text-center text-[var(--t3)] text-sm">
              {insightSearch || insightOutcome ? 'No incidents match this filter.' : 'No indexed incidents yet. Run an investigation to populate the knowledge base.'}
            </div>
          ) : (
            <div className="space-y-2">
              {insights.map((it, i) => (
                <div key={`${it.alert_id}-${i}`} className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-3 hover:border-[var(--p1)] transition-colors">
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded text-[0.58rem] font-black uppercase tracking-widest ${outcomeColor[it.outcome] || 'bg-gray-100 text-gray-700'}`}>
                        {it.outcome}
                      </span>
                      {it.attack_pattern && (
                        <span className="text-[0.72rem] font-semibold text-[var(--t6)]">{it.attack_pattern}</span>
                      )}
                      {it.threat_actor && (
                        <span className="text-[0.65rem] text-[var(--t3)]">· actor: <span className="font-mono">{it.threat_actor}</span></span>
                      )}
                    </div>
                    <button
                      onClick={() => goToAlert(it.alert_id)}
                      className="shrink-0 px-2 py-0.5 rounded bg-[var(--s1)] hover:bg-[var(--s2)] text-[0.6rem] font-mono text-[var(--p1)] border border-[var(--b2)]"
                      title="Open in Incidents"
                    >ALERT-{it.alert_id.slice(0, 8).toUpperCase()}</button>
                  </div>
                  <p className="text-[0.72rem] text-[var(--t5)] line-clamp-2 whitespace-pre-line mb-1.5">{it.summary}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(it.ttp_tags || []).slice(0, 6).map(tag => (
                      <span key={tag} className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 text-[0.55rem] font-mono">{tag}</span>
                    ))}
                    {it.triggered_by && (
                      <span className="px-1.5 py-0.5 rounded bg-[var(--s1)] text-[var(--t4)] text-[0.55rem] uppercase tracking-wider font-bold border border-[var(--b2)]">{it.triggered_by}</span>
                    )}
                    <span className="text-[0.6rem] text-[var(--t3)] ml-auto">{timeAgo(new Date(it.created_at).getTime())}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── IOCs ────────────────────────────────────────────────────────── */}
      {section === 'iocs' && (
        <div className="space-y-3">
          {/* Filter bar */}
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3 space-y-2.5">
            <div className="flex gap-2 items-center">
              <div className="flex-1 relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--t3)]" />
                <input
                  value={iocSearch}
                  onChange={e => setIocSearch(e.target.value)}
                  placeholder="Search IOC value or notes…"
                  className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-[var(--b2)] bg-[var(--s1)] text-[0.75rem] text-[var(--t1)] placeholder:text-[var(--t3)] focus:outline-none focus:border-[var(--p1)]"
                />
                {iocSearch && (
                  <button onClick={() => setIocSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--t3)] hover:text-[var(--t1)]">
                    <X size={12} />
                  </button>
                )}
              </div>
              <select
                value={iocSort}
                onChange={e => setIocSort(e.target.value as any)}
                className="py-1.5 px-2 rounded-lg border border-[var(--b2)] bg-[var(--s1)] text-[0.7rem] font-bold text-[var(--t1)] focus:outline-none focus:border-[var(--p1)]"
              >
                <option value="alerts">Sort: Most alerts</option>
                <option value="fp_ratio">Sort: Highest FP ratio</option>
                <option value="last_seen">Sort: Recently seen</option>
              </select>
            </div>

            <div className="flex gap-2 items-center flex-wrap">
              <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Type:</span>
              {(['ip', 'domain', 'hash', 'user', 'url', 'file'] as const).map(t => {
                const isActive = iocType === t;
                return (
                  <button
                    key={t}
                    onClick={() => setIocType(isActive ? '' : t)}
                    className={`px-2 py-0.5 rounded-full border text-[0.62rem] font-black uppercase tracking-wider transition-all font-mono ${isActive ? 'bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-offset-0 ring-blue-200' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
                  >
                    {t}
                  </button>
                );
              })}
              {(iocSearch || iocType) && (
                <button
                  onClick={() => { setIocSearch(''); setIocType(''); }}
                  className="ml-auto text-[0.62rem] font-bold text-[var(--p1)] hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {sortedIocs.length === 0 ? (
            <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-8 text-center text-[var(--t3)] text-sm">
              {iocSearch || iocType ? 'No IOCs match this filter.' : 'No IOCs tracked yet. Investigations will populate this list.'}
            </div>
          ) : (
            <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg overflow-hidden divide-y divide-[var(--b1)]">
              {sortedIocs.map(ioc => (
                <div key={ioc.value} className="px-4 py-2.5 hover:bg-[var(--s1)] flex items-center gap-3">
                  <span className="px-1.5 py-0.5 rounded bg-[var(--s2)] text-[var(--t4)] text-[0.55rem] font-black uppercase tracking-widest w-14 text-center shrink-0">{ioc.type}</span>
                  <span className="font-mono text-[0.78rem] text-[var(--t7)] flex-1 truncate">{ioc.value}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[0.55rem] font-black uppercase tracking-widest shrink-0 ${threatColor[ioc.threat_level] || 'bg-gray-100 text-gray-700'}`}>{ioc.threat_level || 'LOW'}</span>
                  <span className="text-[0.65rem] text-[var(--t3)] shrink-0 w-16 text-right">{ioc.alert_count} alert{ioc.alert_count === 1 ? '' : 's'}</span>
                  <div className="flex items-center gap-1.5 shrink-0 w-24">
                    <span className="text-[0.55rem] text-[var(--t3)] uppercase font-bold">FP</span>
                    <div className="w-12 h-1.5 rounded-full bg-[var(--s2)] overflow-hidden">
                      <div
                        className="h-full bg-red-400"
                        style={{ width: ioc.fp_ratio != null ? `${Math.round(ioc.fp_ratio * 100)}%` : '0%' }}
                      />
                    </div>
                    <span className="text-[0.55rem] font-mono text-[var(--t4)] tabular-nums w-7 text-right">
                      {ioc.fp_ratio != null ? `${Math.round(ioc.fp_ratio * 100)}%` : '—'}
                    </span>
                  </div>
                  <span className="text-[0.6rem] text-[var(--t3)] shrink-0 w-20 text-right">{timeAgo(new Date(ioc.last_seen).getTime())}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {deletePBId !== null && (
        <ConfirmModal
          title="Delete Playbook"
          message="Are you sure you want to delete this playbook? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => handleDeletePlaybook(deletePBId)}
          onCancel={() => setDeletePBId(null)}
        />
      )}
    </div>
  );
};

// ─── Incidents Tab — case-management workspace ───────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  OPEN:            'Open',
  IN_PROGRESS:     'Investigating',
  CONTAINED:       'Contained',
  RESOLVED:        'Resolved',
  CLOSED:          'Closed',
  RECLASSIFIED_FP: 'Reclassified FP',
};

const STATUS_COLORS: Record<string, string> = {
  OPEN:            'bg-blue-100 text-blue-700 border-blue-200',
  IN_PROGRESS:     'bg-orange-100 text-orange-700 border-orange-200',
  CONTAINED:       'bg-amber-100 text-amber-700 border-amber-200',
  RESOLVED:        'bg-green-100 text-green-700 border-green-200',
  CLOSED:          'bg-gray-200 text-gray-700 border-gray-300',
  RECLASSIFIED_FP: 'bg-pink-100 text-pink-700 border-pink-200',
};

const SEV_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700 border-red-200',
  HIGH:     'bg-orange-100 text-orange-700 border-orange-200',
  MEDIUM:   'bg-amber-100 text-amber-700 border-amber-200',
  LOW:      'bg-green-100 text-green-700 border-green-200',
};

const PHASE_COLORS: Record<string, string> = {
  detection:     'bg-slate-100 text-slate-700',
  analysis:      'bg-blue-100 text-blue-700',
  containment:   'bg-orange-100 text-orange-700',
  eradication:   'bg-red-100 text-red-700',
  recovery:      'bg-amber-100 text-amber-700',
  post_incident: 'bg-green-100 text-green-700',
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  block_ip:          'Block source IP',
  isolate_host:      'Isolate host',
  disable_user:      'Disable user',
  reset_password:    'Reset password',
  collect_forensics: 'Collect forensic evidence',
  firewall_rule:     'Open firewall rule',
  escalate:          'Escalate to lead',
  other:             'Custom action',
};

const ACTION_STATUS_COLORS: Record<string, string> = {
  pending:  'bg-blue-100 text-blue-700 border-blue-200',
  approved: 'bg-violet-100 text-violet-700 border-violet-200',
  executed: 'bg-green-100 text-green-700 border-green-200',
  failed:   'bg-red-100 text-red-700 border-red-200',
  skipped:  'bg-gray-200 text-gray-600 border-gray-300',
};

const SLA_THRESHOLDS: Record<string, { warn: number; breach: number }> = {
  CRITICAL: { warn: 0.5, breach: 1   },
  HIGH:     { warn: 2,   breach: 4   },
  MEDIUM:   { warn: 12,  breach: 24  },
  LOW:      { warn: 48,  breach: 96  },
};

function computeSla(severity: string, escalatedAt: string): { state: 'on_track' | 'watch' | 'at_risk' | 'breached'; label: string; color: string } {
  const t = SLA_THRESHOLDS[severity] || SLA_THRESHOLDS.MEDIUM;
  const hours = (Date.now() - new Date(escalatedAt).getTime()) / 3600000;
  if (hours >= t.breach)      return { state: 'breached', label: 'Breached',  color: 'bg-red-500'    };
  if (hours >= t.warn)        return { state: 'at_risk',  label: 'At risk',   color: 'bg-amber-500'  };
  if (hours >= t.warn * 0.5)  return { state: 'watch',    label: 'Watch',     color: 'bg-blue-400'   };
  return                              { state: 'on_track',label: 'On track',  color: 'bg-green-500'  };
}

function lastEventLabel(t?: string | null, n?: string | null): string {
  if (!t) return '—';
  if (t === 'created')         return 'Created';
  if (t === 'phase_change')    return 'Phase changed';
  if (t === 'assigned')        return 'Assigned';
  if (t === 'closed')          return 'Closed';
  if (t === 'status_change')   return 'Status changed';
  if (t === 'reclassified_fp') return 'Reclassified as FP';
  if (t === 'note' && n)       return `Note: ${n.slice(0, 40)}${n.length > 40 ? '…' : ''}`;
  return t;
}

function extractAiResults(analysisJson: string | null) {
  if (!analysisJson) return {} as any;
  try {
    const j = JSON.parse(analysisJson);
    const a = j?.phaseData?.analysis || {};
    const intel = j?.phaseData?.intel || {};
    const corr  = j?.phaseData?.correlation || {};
    const valid = j?.phaseData?.validation || {};
    const ticket= j?.ticket || j?.phaseData?.ticket || {};
    return {
      summary:            j?.summary || a?.analysis_summary,
      ticket_summary:     ticket?.report_body,
      confidence:         a?.confidence,
      risk_score:         a?.risk_score,
      fp_confidence:      a?.false_positive_confidence,
      attack_category:    a?.attack_category,
      kill_chain_stage:   a?.kill_chain_stage,
      recommended_action: a?.recommended_action,
      mitre:              intel?.mitre_attack || [],
      ttp_tags:           intel?.ttp_tags || [],
      iocs:               a?.iocs,
      correlation:        corr?.campaign_name,
      correlation_summary:corr?.summary,
      intel_summary:      intel?.intel_summary || j?.intel,
      threat_actor:       intel?.threat_actor,
      validation_status:  valid?.sla_status,
      affected_systems:   ticket?.affected_systems,
      business_impact:    ticket?.business_impact,
    };
  } catch { return {} as any; }
}

function extractObservables(analysisJson: string | null, alerts?: Alert[]): { type: string; value: string; source: string }[] {
  const obs: { type: string; value: string; source: string }[] = [];
  const seen = new Set<string>();
  const add = (type: string, value: string, source: string) => {
    const key = `${type}:${value}`;
    if (!value || seen.has(key)) return;
    seen.add(key);
    obs.push({ type, value, source });
  };
  if (analysisJson) {
    try {
      const j = JSON.parse(analysisJson);
      const a = j?.phaseData?.analysis || {};
      const iocs = a?.iocs || {};
      const mapping: Record<string, string> = { ips: 'ip', domains: 'domain', users: 'username', hosts: 'hostname', hashes: 'hash', urls: 'url', files: 'filename' };
      for (const [k, label] of Object.entries(mapping)) {
        for (const v of (iocs[k] || []) as string[]) add(label, v, 'AI Analysis');
      }
    } catch {}
  }
  if (alerts) {
    for (const a of alerts) {
      if (a.source_ip) add('ip', a.source_ip, `Alert ${a.id.slice(0, 8)}`);
      if (a.dest_ip) add('ip', a.dest_ip, `Alert ${a.id.slice(0, 8)}`);
      if (a.hostname) add('hostname', a.hostname, `Alert ${a.id.slice(0, 8)}`);
      if (a.user) add('username', a.user, `Alert ${a.id.slice(0, 8)}`);
    }
  }
  return obs;
}

const OBSERVABLE_ICONS: Record<string, any> = {
  ip: Globe, domain: Globe, hostname: Laptop, username: User, hash: Hash, url: Link2, filename: FileText,
};

const PhaseStepper = ({ current }: { current: string }) => {
  const idx = INCIDENT_PHASES.indexOf(current as IncidentPhase);
  return (
    <div className="flex items-center w-full">
      {INCIDENT_PHASES.map((p, i) => (
        <React.Fragment key={p}>
          <div className="flex flex-col items-center min-w-0 flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[0.65rem] font-black border-2 ${
              i < idx  ? 'bg-[var(--p1)] border-[var(--p1)] text-white' :
              i === idx ? 'bg-white border-[var(--p1)] text-[var(--p1)] ring-4 ring-blue-100' :
                          'bg-[var(--s1)] border-[var(--b2)] text-[var(--t3)]'
            }`}>{i < idx ? '✓' : i + 1}</div>
            <p className={`text-[0.55rem] font-black uppercase tracking-widest mt-1 truncate ${i === idx ? 'text-[var(--p1)]' : 'text-[var(--t3)]'}`}>
              {PHASE_LABELS[p]}
            </p>
          </div>
          {i < INCIDENT_PHASES.length - 1 && (
            <div className={`h-1 flex-1 -mt-5 mx-1 rounded-full ${i < idx ? 'bg-[var(--p1)]' : 'bg-[var(--s2)]'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

// Editable action row (inline edit + delete + reorder)
interface ActionRowProps {
  action: IncidentAction;
  index: number;
  total: number;
  isClosed: boolean;
  onMoveUp:   () => void | Promise<void>;
  onMoveDown: () => void | Promise<void>;
  onDelete:   () => void | Promise<void>;
  onSave:     (patch: { description?: string; target?: string; priority?: string; action_type?: string; notes?: string }) => void | Promise<void>;
  onStatus:   (s: IncidentActionStatus) => void | Promise<void>;
}
const ActionRow: React.FC<ActionRowProps> = ({
  action, index, total, isClosed,
  onMoveUp, onMoveDown, onDelete, onSave, onStatus
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    description: action.description || '',
    target:      action.target || '',
    priority:    action.priority || 'MEDIUM',
    action_type: action.action_type || 'other',
    notes:       action.notes || '',
  });
  React.useEffect(() => {
    setDraft({
      description: action.description || '',
      target:      action.target || '',
      priority:    action.priority || 'MEDIUM',
      action_type: action.action_type || 'other',
      notes:       action.notes || '',
    });
  }, [action.id, action.description, action.target, action.priority, action.action_type, action.notes]);

  if (editing) {
    return (
      <div className="px-3 py-2.5 bg-blue-50/40 border-l-2 border-blue-400">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[0.6rem] font-mono text-[var(--t3)]">#{index + 1}</span>
          <select value={draft.action_type} onChange={e => setDraft({ ...draft, action_type: e.target.value })}
            className="border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)] flex-1">
            {Object.entries(ACTION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })}
            className="border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)] w-24">
            {['CRITICAL','HIGH','MEDIUM','LOW'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <input value={draft.target} onChange={e => setDraft({ ...draft, target: e.target.value })}
          placeholder="Target (IP/host/user)" className="w-full border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)] font-mono mb-2" />
        <textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} rows={2}
          className="w-full border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)] resize-none mb-2" />
        <textarea value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} rows={2}
          placeholder="Execution notes (optional)" className="w-full border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)] resize-none mb-2" />
        <div className="flex gap-1.5">
          <button onClick={async () => { await onSave(draft); setEditing(false); }}
            className="px-3 py-1 rounded bg-[var(--p1)] text-white text-[0.65rem] font-bold">Save</button>
          <button onClick={() => setEditing(false)} className="px-3 py-1 rounded border border-[var(--b2)] text-[var(--t5)] text-[0.65rem] font-semibold">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5 group hover:bg-[var(--s1)]">
      <div className="flex items-start gap-2">
        {!isClosed && (
          <div className="flex flex-col gap-0.5 shrink-0 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onMoveUp}   disabled={index === 0}        className="text-[var(--t3)] hover:text-[var(--p1)] disabled:opacity-20 leading-none text-[0.65rem]" title="Move up">▲</button>
            <button onClick={onMoveDown} disabled={index === total - 1} className="text-[var(--t3)] hover:text-[var(--p1)] disabled:opacity-20 leading-none text-[0.65rem]" title="Move down">▼</button>
          </div>
        )}
        <span className="text-[0.6rem] font-mono text-[var(--t3)] shrink-0 pt-0.5">#{index + 1}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded text-[0.55rem] font-black uppercase tracking-widest border ${ACTION_STATUS_COLORS[action.status] || 'bg-gray-100 text-gray-700'}`}>{action.status}</span>
            <span className="text-[0.6rem] font-mono text-[var(--t4)]">{ACTION_TYPE_LABELS[action.action_type] || action.action_type}</span>
            <span className={`px-1.5 py-0.5 rounded text-[0.55rem] font-black uppercase ${SEV_COLORS[action.priority] || 'bg-gray-100 text-gray-700'}`}>{action.priority}</span>
            <span className="text-[0.55rem] uppercase font-bold text-[var(--t3)]">{action.source}</span>
          </div>
          <p className="text-[0.7rem] text-[var(--t6)] leading-snug">{action.description}</p>
          {action.target && <p className="text-[0.6rem] text-[var(--t3)] font-mono mt-0.5">target: {action.target}</p>}
          {action.notes  && <p className="text-[0.6rem] text-[var(--t4)] italic mt-0.5">"{action.notes}"</p>}
          {!isClosed && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {action.status === 'pending' && (
                <>
                  <button onClick={() => onStatus('executed')} className="px-2 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200 text-[0.6rem] font-bold">✓ Executed</button>
                  <button onClick={() => onStatus('failed')}   className="px-2 py-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200 text-[0.6rem] font-bold">Failed</button>
                  <button onClick={() => onStatus('skipped')}  className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 text-[0.6rem] font-bold">Skip</button>
                </>
              )}
              {action.status !== 'pending' && (
                <button onClick={() => onStatus('pending')} className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 text-[0.6rem] font-bold">Reopen</button>
              )}
              <button onClick={() => setEditing(true)} className="px-2 py-0.5 rounded border border-[var(--b2)] text-[var(--t5)] hover:bg-[var(--s2)] text-[0.6rem] font-bold">Edit</button>
              <button onClick={onDelete} className="px-2 py-0.5 rounded text-red-600 hover:bg-red-50 text-[0.6rem] font-bold">Delete</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const IncidentsTab = ({ setActiveTab }: { setActiveTab: (t: string) => void }) => {
  const toast = useToast();
  const { user } = useAuth();
  const isAdminOrLead = user?.role === 'ADMIN' || user?.role === 'INCIDENT_LEAD';

  const [list, setList]               = useState<Incident[]>([]);
  const [total, setTotal]             = useState(0);
  const [counts, setCounts]           = useState<Record<string, number>>({});
  const [search, setSearch]           = useState('');
  const [phaseF, setPhaseF]           = useState<string>('');
  const [statusF, setStatusF]         = useState<string>('');
  const [sevF, setSevF]               = useState<string>('');
  const [ownerF, setOwnerF]           = useState<number | ''>('');
  const [slaF, setSlaF]               = useState<string>('');
  const [analysts, setAnalysts]       = useState<{ id: number; username: string; role: string }[]>([]);

  const [activeId, setActiveId]       = useState<string | null>(null);
  const [detail, setDetail]           = useState<Incident | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailTab, setDetailTab]     = useState<'overview'|'observables'|'tasks'|'timeline'|'report'>('overview');
  const [myOnly, setMyOnly]           = useState(false);

  const [showReassign, setShowReassign] = useState(false);
  const [reassignTo, setReassignTo]     = useState<number>(0);
  const [showAddAction, setShowAddAction] = useState(false);
  const [newAction, setNewAction]       = useState({ action_type: 'other', target: '', priority: 'MEDIUM', description: '' });
  const [showReclassify, setShowReclassify] = useState(false);
  const [reclassifyNote, setReclassifyNote] = useState('');
  const [reportDraft, setReportDraft]   = useState('');
  const [reportEditing, setReportEditing] = useState(false);
  const [reportSaving, setReportSaving]   = useState(false);
  const [noteText, setNoteText]         = useState('');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [deleteActionTarget, setDeleteActionTarget] = useState<IncidentAction | null>(null);

  const fetchList = useCallback(() => {
    getIncidents({
      q: search || undefined,
      phase: phaseF || undefined,
      status: statusF || undefined,
      assigned_to: ownerF ? Number(ownerF) : undefined,
      limit: 100,
    }).then(d => { setList(d.rows); setTotal(d.total); setCounts(d.counts || {}); }).catch(() => {});
  }, [search, phaseF, statusF, ownerF]);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { listAnalysts().then(setAnalysts).catch(() => {}); }, []);

  const fetchDetail = useCallback((id: string) => {
    setLoadingDetail(true);
    getIncident(id).then(d => {
      setDetail(d);
      setReportDraft(d?.report_body || '');
    }).finally(() => setLoadingDetail(false));
  }, []);

  useEffect(() => {
    if (activeId) { fetchDetail(activeId); setDetailTab('overview'); }
    else { setDetail(null); setReportEditing(false); }
  }, [activeId, fetchDetail]);

  const filteredList = React.useMemo(() => {
    let out = list;
    if (sevF) out = out.filter(i => i.severity === sevF);
    if (slaF) out = out.filter(i => computeSla(i.severity, i.escalated_at).state === slaF);
    if (myOnly && user) out = out.filter(i => i.assigned_to === user.id);
    return out;
  }, [list, sevF, slaF, myOnly, user]);

  // ── Detail view ──────────────────────────────────────────────────────────
  if (activeId && detail) {
    const isOwner = detail.assigned_to === user?.id;
    const canEdit      = isAdminOrLead || (user?.role === 'TIER2' && isOwner);
    const canReassign  = isAdminOrLead;
    const isClosed     = detail.status === 'CLOSED' || detail.status === 'RECLASSIFIED_FP' || detail.status === 'RESOLVED';
    const currentIdx   = INCIDENT_PHASES.indexOf(detail.phase as IncidentPhase);
    const nextPhase    = currentIdx >= 0 && currentIdx < INCIDENT_PHASES.length - 1 ? INCIDENT_PHASES[currentIdx + 1] : null;

    const ai  = extractAiResults(detail.analysis);
    const sla = computeSla(detail.severity, detail.escalated_at);
    const actions = detail.actions || [];

    const handleNextPhase = async () => {
      if (!nextPhase) return;
      const r = await moveIncidentPhase(detail.id, nextPhase);
      if (r.ok) { toast(`Phase → ${PHASE_LABELS[nextPhase as IncidentPhase]}`, 'success'); fetchDetail(detail.id); fetchList(); }
      else toast(r.error || 'Failed to advance phase', 'error');
    };
    const handleStatusChange = async (newStatus: string) => {
      if (newStatus === detail.status) return;
      if (newStatus === 'RECLASSIFIED_FP') { setShowReclassify(true); return; }
      const r = await updateIncident(detail.id, { status: newStatus });
      if (r.ok) { toast(`Status → ${STATUS_LABELS[newStatus] || newStatus}`, 'success'); fetchDetail(detail.id); fetchList(); }
      else toast(r.error || 'Failed', 'error');
    };
    const handleReclassifyFp = async () => {
      const r = await reclassifyIncidentFp(detail.id, reclassifyNote || undefined);
      if (r.ok) {
        toast(`Reclassified — ${r.alerts_returned_to_archive ?? 0} alert(s) returned to FP archive`, 'success');
        setShowReclassify(false); setReclassifyNote('');
        fetchDetail(detail.id); fetchList();
      } else toast(r.error || 'Failed to reclassify', 'error');
    };
    const handleAddNote = async () => {
      if (!noteText.trim()) return;
      const r = await addIncidentNote(detail.id, noteText.trim());
      if (r.ok) { toast('Note added', 'success'); setNoteText(''); fetchDetail(detail.id); }
      else toast(r.error || 'Failed', 'error');
    };
    const handleReassign = async () => {
      const r = await assignIncident(detail.id, reassignTo || null);
      if (r.ok) {
        toast(reassignTo ? 'Reassigned' : 'Unassigned', 'success');
        setShowReassign(false); fetchDetail(detail.id); fetchList();
      } else toast(r.error || 'Failed', 'error');
    };
    const handleTake = async () => {
      const r = await takeIncident(detail.id);
      if (r.ok) { toast(`Claimed — status → Investigating`, 'success'); fetchDetail(detail.id); fetchList(); }
      else toast(r.error || 'Failed to claim', 'error');
    };
    const handleAddAction = async () => {
      if (!newAction.description.trim()) return;
      const r = await addIncidentAction(detail.id, newAction);
      if (r.ok) {
        toast('Action added', 'success');
        setShowAddAction(false);
        setNewAction({ action_type: 'other', target: '', priority: 'MEDIUM', description: '' });
        fetchDetail(detail.id);
      } else toast(r.error || 'Failed', 'error');
    };
    const handleActionStatus = async (a: IncidentAction, status: IncidentActionStatus) => {
      const r = await updateIncidentAction(detail.id, a.id, { status });
      if (r.ok) { toast(`Action → ${status}`, 'success'); fetchDetail(detail.id); }
      else toast(r.error || 'Failed', 'error');
    };
    const handleActionEdit = async (a: IncidentAction, patch: any) => {
      const r = await updateIncidentAction(detail.id, a.id, patch);
      if (r.ok) { toast('Action saved', 'success'); fetchDetail(detail.id); }
      else toast(r.error || 'Failed', 'error');
    };
    const handleActionDelete = async (a: IncidentAction) => {
      setDeleteActionTarget(null);
      const r = await deleteIncidentAction(detail.id, a.id);
      if (r.ok) { toast('Action deleted', 'info'); fetchDetail(detail.id); }
      else toast(r.error || 'Failed', 'error');
    };
    const handleReorder = async (from: number, to: number) => {
      if (to < 0 || to >= actions.length) return;
      const arr = [...actions];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      // Optimistic update
      setDetail({ ...detail, actions: arr });
      await reorderIncidentActions(detail.id, arr.map(a => a.id));
      fetchDetail(detail.id);
    };
    const handleSaveReport = async () => {
      setReportSaving(true);
      const r = await updateIncident(detail.id, { report_body: reportDraft });
      setReportSaving(false);
      if (r.ok) { toast('Report saved', 'success'); setReportEditing(false); fetchDetail(detail.id); }
      else toast(r.error || 'Failed', 'error');
    };

    const observables = extractObservables(detail.analysis, detail.alerts);
    const DETAIL_TABS = [
      { key: 'overview'     as const, label: 'Overview',     icon: <Eye size={13} /> },
      { key: 'observables'  as const, label: `Observables (${observables.length})`, icon: <Crosshair size={13} /> },
      { key: 'tasks'        as const, label: `Tasks (${actions.length})`, icon: <ListChecks size={13} /> },
      { key: 'timeline'     as const, label: `Timeline (${detail.timeline?.length || 0})`, icon: <MessageSquare size={13} /> },
      { key: 'report'       as const, label: 'Report',      icon: <FileText size={13} /> },
    ];

    return (
      <div className="overflow-y-auto h-full bg-[var(--s3)]">
        <div className="max-w-7xl mx-auto p-5 space-y-4">

          {/* Top bar */}
          <div className="flex items-center justify-between">
            <button onClick={() => setActiveId(null)} className="text-[var(--t4)] hover:text-[var(--p1)] flex items-center gap-1 text-[0.78rem] font-bold">
              <ChevronRight size={14} className="rotate-180" />Back to Incidents
            </button>
            <div className="flex items-center gap-2">
              <code className="text-[0.7rem] font-mono bg-[var(--s1)] text-[var(--t5)] px-2 py-1 rounded">{detail.id}</code>
              <span className={`px-2 py-1 rounded text-[0.6rem] font-black uppercase tracking-widest border ${SEV_COLORS[detail.severity] || 'bg-gray-100 text-gray-700'}`}>{detail.severity}</span>
              <span className={`px-3 py-1 rounded-lg text-[0.65rem] font-black uppercase tracking-widest border ${STATUS_COLORS[detail.status] || 'bg-gray-100 text-gray-700'}`}>
                {STATUS_LABELS[detail.status] || detail.status}
              </span>
              <div className="flex items-center gap-1.5 ml-2">
                <span className={`w-2 h-2 rounded-full ${sla.color}`} />
                <span className="text-[0.65rem] font-bold text-[var(--t5)]">{sla.label}</span>
              </div>
            </div>
          </div>

          {/* Title + assignee */}
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-[1.25rem] font-black text-[var(--t7)]">{detail.title}</h2>
            {detail.assigned_to_username && (
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[var(--p1)] to-[var(--pd)] flex items-center justify-center text-white text-[0.55rem] font-black">
                  {detail.assigned_to_username.substring(0, 2).toUpperCase()}
                </div>
                <span className="text-[0.72rem] font-bold text-[var(--t5)]">{detail.assigned_to_username}</span>
              </div>
            )}
          </div>

          {/* Phase stepper */}
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4">
            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-3">Incident Response Lifecycle</p>
            <PhaseStepper current={detail.phase} />
          </div>

          {/* Two-column body */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">

            {/* Left column — tabbed content */}
            <div className="space-y-4">
              {/* Tab bar */}
              <div className="flex gap-1 bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-1 overflow-x-auto">
                {DETAIL_TABS.map(t => (
                  <button key={t.key} onClick={() => setDetailTab(t.key)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[0.72rem] font-bold whitespace-nowrap transition-all ${
                      detailTab === t.key
                        ? 'bg-[var(--p1)] text-white shadow-sm'
                        : 'text-[var(--t4)] hover:text-[var(--t7)] hover:bg-[var(--s1)]'
                    }`}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>

              {/* ===== OVERVIEW TAB ===== */}
              {detailTab === 'overview' && (
                <div className="space-y-4">
                  {/* Quick metrics row */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3 text-center">
                      <p className="text-[1.1rem] font-black text-[var(--t7)]">{ai.risk_score ?? '—'}</p>
                      <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase tracking-widest">Risk Score</p>
                    </div>
                    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3 text-center">
                      <p className="text-[1.1rem] font-black text-[var(--t7)]">{ai.confidence != null ? `${Math.round(ai.confidence * 100)}%` : '—'}</p>
                      <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase tracking-widest">AI Confidence</p>
                    </div>
                    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3 text-center">
                      <p className="text-[1.1rem] font-black text-[var(--t7)]">{detail.alerts?.length ?? 0}</p>
                      <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase tracking-widest">Linked Alerts</p>
                    </div>
                    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3 text-center">
                      <p className="text-[1.1rem] font-black text-[var(--t7)]">{observables.length}</p>
                      <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase tracking-widest">Observables</p>
                    </div>
                  </div>

                  {/* AI Summary */}
                  {(ai.summary || ai.ticket_summary) && (
                    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                      <div className="px-4 py-2.5 bg-[var(--s1)] border-b border-[var(--b1)] flex items-center gap-2">
                        <Activity size={13} className="text-violet-600" />
                        <p className="text-[0.72rem] font-black text-[var(--t7)]">AI Analysis Summary</p>
                      </div>
                      <div className="p-4 text-[0.78rem] text-[var(--t6)] leading-relaxed whitespace-pre-line">
                        {ai.summary}
                        {ai.recommended_action && (
                          <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <p className="text-[0.55rem] font-black text-blue-800 uppercase tracking-widest mb-0.5">Recommended Next Step</p>
                            <p className="font-mono font-bold text-blue-900 text-[0.72rem]">{ai.recommended_action}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Threat Intelligence */}
                  {(ai.intel_summary || (ai.mitre && ai.mitre.length > 0) || ai.threat_actor || ai.attack_category) && (
                    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                      <div className="px-4 py-2.5 bg-[var(--s1)] border-b border-[var(--b1)] flex items-center gap-2">
                        <Shield size={13} className="text-red-600" />
                        <p className="text-[0.72rem] font-black text-[var(--t7)]">Threat Intelligence</p>
                      </div>
                      <div className="p-4 space-y-3 text-[0.72rem]">
                        {ai.intel_summary && (
                          <p className="text-[var(--t6)] leading-relaxed">{ai.intel_summary}</p>
                        )}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {[
                            { label: 'Attack Category', value: ai.attack_category },
                            { label: 'Kill Chain Stage', value: ai.kill_chain_stage },
                            { label: 'Threat Actor', value: ai.threat_actor },
                            { label: 'Campaign', value: ai.correlation },
                          ].map((item, idx) => (
                            <div key={idx} className="bg-[var(--s1)] rounded-lg p-2.5 border border-[var(--b2)]">
                              <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase tracking-widest mb-0.5">{item.label}</p>
                              <p className="font-mono text-[0.68rem] text-[var(--t6)] truncate">{item.value || '—'}</p>
                            </div>
                          ))}
                        </div>
                        {ai.mitre && ai.mitre.length > 0 && (
                          <div>
                            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">MITRE ATT&CK Techniques</p>
                            <div className="flex gap-1.5 flex-wrap">
                              {ai.mitre.slice(0, 16).map((t: any, i: number) => (
                                <span key={i} className="px-2 py-1 rounded-lg bg-violet-50 text-violet-700 text-[0.6rem] font-mono border border-violet-200">{t}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Linked Alerts */}
                  <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 bg-[var(--s1)] border-b border-[var(--b1)] flex items-center gap-2">
                      <AlertTriangle size={13} className="text-orange-500" />
                      <p className="text-[0.72rem] font-black text-[var(--t7)]">Linked Alerts ({detail.alerts?.length || 0})</p>
                    </div>
                    {(detail.alerts || []).length === 0 ? (
                      <div className="p-6 text-center text-[var(--t3)] text-[0.72rem]">No alerts linked to this incident.</div>
                    ) : (
                      <div className="divide-y divide-[var(--b1)]">
                        {(detail.alerts || []).map(a => (
                          <div key={a.id} className="px-4 py-3 flex items-center gap-3 hover:bg-[var(--s1)] transition-colors">
                            <span className={`px-1.5 py-0.5 rounded text-[0.55rem] font-black uppercase shrink-0 ${a.severity >= 12 ? 'bg-red-100 text-red-700 border border-red-200' : a.severity >= 7 ? 'bg-orange-100 text-orange-700 border border-orange-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>sev {a.severity}</span>
                            <code className="font-mono text-[0.6rem] text-[var(--p1)] bg-[var(--s1)] px-1.5 py-0.5 rounded shrink-0">#{a.id.slice(0, 8).toUpperCase()}</code>
                            <span className="text-[0.72rem] text-[var(--t6)] flex-1 truncate">{a.description}</span>
                            <span className="text-[0.6rem] text-[var(--t3)] font-mono shrink-0">{a.source_ip || '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ===== OBSERVABLES TAB ===== */}
              {detailTab === 'observables' && (
                <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-[var(--s1)] border-b border-[var(--b1)] flex items-center gap-2">
                    <Crosshair size={13} className="text-orange-600" />
                    <p className="text-[0.72rem] font-black text-[var(--t7)]">Observables & Indicators of Compromise</p>
                  </div>
                  {observables.length === 0 ? (
                    <div className="p-10 text-center">
                      <Crosshair size={28} className="mx-auto text-[var(--t3)] mb-2" />
                      <p className="text-[0.82rem] font-semibold text-[var(--t5)]">No observables extracted</p>
                      <p className="text-[0.7rem] text-[var(--t3)] mt-1">IOCs will appear here once the AI analysis identifies indicators.</p>
                    </div>
                  ) : (
                    <div>
                      {/* Summary chips */}
                      <div className="px-4 py-3 border-b border-[var(--b1)] flex gap-2 flex-wrap">
                        {(['ip', 'domain', 'hostname', 'username', 'hash', 'url', 'filename'] as const).map(type => {
                          const count = observables.filter(o => o.type === type).length;
                          if (count === 0) return null;
                          const Ico = OBSERVABLE_ICONS[type] || Globe;
                          return (
                            <span key={type} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--s1)] border border-[var(--b2)] text-[0.62rem] font-bold text-[var(--t5)]">
                              <Ico size={11} /> {type} <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-[var(--p1)] text-white text-[0.5rem] font-black">{count}</span>
                            </span>
                          );
                        })}
                      </div>
                      {/* Table */}
                      <table className="w-full text-[0.72rem]">
                        <thead>
                          <tr className="border-b border-[var(--b1)] text-[var(--t3)]">
                            <th className="text-left px-4 py-2 text-[0.55rem] font-black uppercase tracking-widest">Type</th>
                            <th className="text-left px-4 py-2 text-[0.55rem] font-black uppercase tracking-widest">Value</th>
                            <th className="text-left px-4 py-2 text-[0.55rem] font-black uppercase tracking-widest">Source</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--b1)]">
                          {observables.map((o, idx) => {
                            const Ico = OBSERVABLE_ICONS[o.type] || Globe;
                            return (
                              <tr key={idx} className="hover:bg-[var(--s1)] transition-colors">
                                <td className="px-4 py-2.5">
                                  <span className="flex items-center gap-1.5 text-[var(--t5)]">
                                    <Ico size={12} className="text-[var(--t3)]" />
                                    <span className="font-bold uppercase text-[0.6rem]">{o.type}</span>
                                  </span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <code className="font-mono text-[0.7rem] text-[var(--t7)] bg-[var(--s1)] px-2 py-0.5 rounded select-all">{o.value}</code>
                                </td>
                                <td className="px-4 py-2.5 text-[var(--t4)] text-[0.65rem]">{o.source}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ===== TASKS TAB ===== */}
              {detailTab === 'tasks' && (
                <div className="space-y-4">
                  {/* Task summary cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'Total', value: actions.length, color: 'text-[var(--p1)]' },
                      { label: 'Pending', value: actions.filter(a => a.status === 'pending').length, color: 'text-blue-600' },
                      { label: 'Executed', value: actions.filter(a => a.status === 'executed').length, color: 'text-green-600' },
                      { label: 'Failed', value: actions.filter(a => a.status === 'failed').length, color: 'text-red-600' },
                    ].map((s, i) => (
                      <div key={i} className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3 text-center">
                        <p className={`text-[1.1rem] font-black ${s.color}`}>{s.value}</p>
                        <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase tracking-widest">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Progress bar */}
                  {actions.length > 0 && (
                    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[0.62rem] font-bold text-[var(--t5)]">Completion Progress</p>
                        <p className="text-[0.62rem] font-mono text-[var(--t3)]">{actions.filter(a => a.status === 'executed').length}/{actions.length}</p>
                      </div>
                      <div className="h-2 bg-[var(--s2)] rounded-full overflow-hidden flex">
                        <div className="bg-green-500 transition-all" style={{ width: `${(actions.filter(a => a.status === 'executed').length / actions.length) * 100}%` }} />
                        <div className="bg-red-400 transition-all" style={{ width: `${(actions.filter(a => a.status === 'failed').length / actions.length) * 100}%` }} />
                        <div className="bg-gray-300 transition-all" style={{ width: `${(actions.filter(a => a.status === 'skipped').length / actions.length) * 100}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Response Actions */}
                  <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 bg-[var(--s1)] border-b border-[var(--b1)] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Zap size={13} className="text-amber-600" />
                        <p className="text-[0.72rem] font-black text-[var(--t7)]">Response Actions</p>
                      </div>
                      {!isClosed && canEdit && (
                        <button onClick={() => setShowAddAction(s => !s)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.62rem] font-bold text-white bg-[var(--p1)] hover:bg-[var(--pd)] transition-colors">
                          {showAddAction ? <><X size={11} /> Cancel</> : <><Plus size={11} /> Add Action</>}
                        </button>
                      )}
                    </div>

                    {showAddAction && (
                      <div className="px-4 py-3 bg-[var(--sa)] border-b border-[var(--b1)] space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <select value={newAction.action_type} onChange={e => setNewAction({ ...newAction, action_type: e.target.value })}
                            className="border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)]">
                            {Object.entries(ACTION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                          <select value={newAction.priority} onChange={e => setNewAction({ ...newAction, priority: e.target.value })}
                            className="border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)]">
                            {['CRITICAL','HIGH','MEDIUM','LOW'].map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                        <input value={newAction.target} onChange={e => setNewAction({ ...newAction, target: e.target.value })} placeholder="Target (IP / host / user) — optional"
                          className="w-full border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)] font-mono" />
                        <textarea value={newAction.description} onChange={e => setNewAction({ ...newAction, description: e.target.value })} rows={2} placeholder="Action description..."
                          className="w-full border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)] resize-none" />
                        <div className="flex justify-end">
                          <button onClick={handleAddAction} disabled={!newAction.description.trim()}
                            className="px-3 py-1 rounded bg-[var(--p1)] text-white text-[0.7rem] font-bold disabled:opacity-50">Add</button>
                        </div>
                      </div>
                    )}

                    <div className="divide-y divide-[var(--b1)]">
                      {actions.length === 0 ? (
                        <div className="p-8 text-center">
                          <ListChecks size={28} className="mx-auto text-[var(--t3)] mb-2" />
                          <p className="text-[0.82rem] font-semibold text-[var(--t5)]">No response actions yet</p>
                          {!isClosed && canEdit && <p className="text-[0.7rem] text-[var(--t3)] mt-1">Click <span className="font-bold text-[var(--p1)]">+ Add Action</span> to create one.</p>}
                        </div>
                      ) : actions.map((a, i) => (
                        <ActionRow
                          key={a.id}
                          action={a}
                          index={i}
                          total={actions.length}
                          isClosed={isClosed || !canEdit}
                          onMoveUp={()   => handleReorder(i, i - 1)}
                          onMoveDown={() => handleReorder(i, i + 1)}
                          onDelete={()   => setDeleteActionTarget(a)}
                          onSave={(p)    => handleActionEdit(a, p)}
                          onStatus={(s)  => handleActionStatus(a, s)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ===== TIMELINE TAB ===== */}
              {detailTab === 'timeline' && (
                <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-[var(--s1)] border-b border-[var(--b1)] flex items-center gap-2">
                    <MessageSquare size={13} className="text-green-600" />
                    <p className="text-[0.72rem] font-black text-[var(--t7)]">Activity & Comments</p>
                  </div>
                  {!isClosed && (
                    <div className="px-4 py-3 bg-[var(--sa)] border-b border-[var(--b1)] flex gap-2">
                      <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={2} placeholder="Add a comment..."
                        className="flex-1 border border-[var(--b2)] rounded-lg px-3 py-2 text-[0.72rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)] resize-none" />
                      <button onClick={handleAddNote} disabled={!noteText.trim()}
                        className="px-4 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.7rem] font-bold disabled:opacity-50 self-start flex items-center gap-1">
                        <Send size={11} /> Comment
                      </button>
                    </div>
                  )}
                  <div className="divide-y divide-[var(--b1)]">
                    {(detail.timeline || []).length === 0 ? (
                      <div className="p-8 text-center text-[var(--t3)] text-[0.72rem]">No activity recorded yet.</div>
                    ) : (detail.timeline || []).slice().reverse().map(t => {
                      const eventColor =
                        t.event_type === 'created'         ? 'bg-blue-500' :
                        t.event_type === 'phase_change'    ? 'bg-orange-500' :
                        t.event_type === 'assigned'        ? 'bg-purple-500' :
                        t.event_type === 'closed'          ? 'bg-gray-500' :
                        t.event_type === 'reclassified_fp' ? 'bg-pink-500' :
                        t.event_type === 'status_change'   ? 'bg-indigo-500' :
                        'bg-green-500';
                      const eventIcon =
                        t.event_type === 'created'         ? <Plus size={10} /> :
                        t.event_type === 'phase_change'    ? <ChevronRight size={10} /> :
                        t.event_type === 'assigned'        ? <UserPlus size={10} /> :
                        t.event_type === 'closed'          ? <XCircle size={10} /> :
                        t.event_type === 'reclassified_fp' ? <ThumbsDown size={10} /> :
                        t.event_type === 'status_change'   ? <Activity size={10} /> :
                        <MessageSquare size={10} />;
                      return (
                        <div key={t.id} className="px-4 py-3 flex items-start gap-3 hover:bg-[var(--s1)] transition-colors">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white ${eventColor}`}>
                            {eventIcon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[0.72rem] text-[var(--t6)]">
                              <span className="font-bold">{t.username || 'system'}</span>
                              {t.event_type === 'phase_change'    && <> moved phase <span className="font-mono bg-[var(--s1)] px-1.5 py-0.5 rounded text-[0.6rem]">{t.phase_from} → {t.phase_to}</span></>}
                              {t.event_type === 'status_change'   && <> changed status <span className="font-mono bg-[var(--s1)] px-1.5 py-0.5 rounded text-[0.6rem]">{t.status_from} → {t.status_to}</span></>}
                              {t.event_type === 'assigned'        && <> reassigned the incident</>}
                              {t.event_type === 'closed'          && <> closed the incident</>}
                              {t.event_type === 'reclassified_fp' && <> reclassified as false positive</>}
                              {t.event_type === 'created'         && <> created the incident</>}
                              {t.event_type === 'note'            && <> added a comment</>}
                            </p>
                            {t.note && (
                              <div className="mt-1.5 bg-[var(--s1)] border border-[var(--b2)] rounded-lg px-3 py-2">
                                <p className="text-[0.68rem] text-[var(--t5)] leading-relaxed">{t.note}</p>
                              </div>
                            )}
                          </div>
                          <span className="text-[0.6rem] text-[var(--t3)] shrink-0 mt-0.5">{timeAgo(new Date(t.created_at).getTime())}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ===== REPORT TAB ===== */}
              {detailTab === 'report' && (
                <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-[var(--s1)] border-b border-[var(--b1)] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText size={13} className="text-[var(--p1)]" />
                      <p className="text-[0.72rem] font-black text-[var(--t7)]">Incident Report</p>
                    </div>
                    {!isClosed && canEdit && !reportEditing && (
                      <button onClick={() => setReportEditing(true)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.62rem] font-bold text-[var(--p1)] border border-[var(--p1)] hover:bg-blue-50 transition-colors">
                        <FileText size={11} /> Edit Report
                      </button>
                    )}
                  </div>
                  <div className="p-4">
                    {reportEditing ? (
                      <>
                        <textarea value={reportDraft} onChange={e => setReportDraft(e.target.value)} rows={14}
                          placeholder="Write or refine the incident report..."
                          className="w-full border border-[var(--b2)] rounded-lg px-3 py-2 text-[0.78rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)] resize-y leading-relaxed" />
                        <div className="flex gap-2 mt-3">
                          <button onClick={handleSaveReport} disabled={reportSaving}
                            className="px-4 py-2 rounded-lg bg-[var(--p1)] text-white text-[0.72rem] font-bold disabled:opacity-50 flex items-center gap-1">
                            {reportSaving ? 'Saving...' : <><CheckCircle size={12} /> Save Report</>}
                          </button>
                          <button onClick={() => { setReportEditing(false); setReportDraft(detail.report_body || ''); }}
                            className="px-4 py-2 rounded-lg border border-[var(--b2)] text-[var(--t5)] text-[0.72rem] font-semibold">Cancel</button>
                        </div>
                      </>
                    ) : detail.report_body ? (
                      <div className="prose prose-sm max-w-none">
                        <p className="text-[0.78rem] text-[var(--t6)] leading-relaxed whitespace-pre-line">{detail.report_body}</p>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <FileText size={28} className="mx-auto text-[var(--t3)] mb-2" />
                        <p className="text-[0.82rem] font-semibold text-[var(--t5)]">No report written yet</p>
                        {canEdit && !isClosed && (
                          <button onClick={() => setReportEditing(true)} className="mt-2 px-4 py-2 rounded-lg bg-[var(--p1)] text-white text-[0.72rem] font-bold hover:bg-[var(--pd)]">
                            Write Report
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right sidebar — metadata + quick actions */}
            <div className="space-y-4">
              {/* Status / details card */}
              <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 space-y-3">
                <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest">Case Details</p>

                <div>
                  <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Status</p>
                  {isClosed ? (
                    <span className={`inline-block px-2.5 py-1 rounded-lg text-[0.65rem] font-black uppercase tracking-widest border ${STATUS_COLORS[detail.status] || 'bg-gray-100 text-gray-700'}`}>
                      {STATUS_LABELS[detail.status] || detail.status}
                    </span>
                  ) : (
                    <select value={detail.status} disabled={!canEdit}
                      onChange={e => handleStatusChange(e.target.value)}
                      className={`w-full border rounded-lg px-2 py-1.5 text-[0.72rem] font-bold ${STATUS_COLORS[detail.status]?.replace('border-', 'border ') || 'border-[var(--b2)]'} disabled:opacity-70`}>
                      {(['OPEN','IN_PROGRESS','CONTAINED','RESOLVED','CLOSED','RECLASSIFIED_FP'] as const).map(s =>
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      )}
                    </select>
                  )}
                </div>

                <div>
                  <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Phase</p>
                  <span className={`inline-block px-2 py-0.5 rounded-lg text-[0.6rem] font-black uppercase ${PHASE_COLORS[detail.phase] || 'bg-gray-100 text-gray-700'}`}>
                    {PHASE_LABELS[detail.phase as IncidentPhase] || detail.phase}
                  </span>
                </div>

                <div>
                  <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Severity</p>
                  <span className={`inline-block px-2 py-0.5 rounded-lg text-[0.6rem] font-black uppercase border ${SEV_COLORS[detail.severity] || 'bg-gray-100 text-gray-700'}`}>
                    {detail.severity}
                  </span>
                </div>

                <div>
                  <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Assignee</p>
                  {detail.assigned_to_username ? (
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[var(--p1)] to-[var(--pd)] flex items-center justify-center text-white text-[0.45rem] font-black">
                        {detail.assigned_to_username.substring(0, 2).toUpperCase()}
                      </div>
                      <p className="text-[0.72rem] font-bold text-[var(--t6)]">{detail.assigned_to_username}</p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[0.72rem] font-bold text-amber-700">Unassigned</p>
                      {!isClosed && ['ADMIN', 'INCIDENT_LEAD', 'TIER2'].includes(user?.role || '') && (
                        <button onClick={handleTake}
                          className="px-2 py-0.5 rounded-lg bg-blue-600 text-white text-[0.6rem] font-bold hover:bg-blue-700 flex items-center gap-1">
                          <UserPlus size={10} />Claim
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Reporter</p>
                  <p className="text-[0.72rem] font-bold text-[var(--t6)]">{detail.escalated_by_username || 'system'}</p>
                </div>

                <div>
                  <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">SLA</p>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${sla.color}`} />
                    <span className="text-[0.72rem] font-bold text-[var(--t6)]">{sla.label}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--b1)]">
                  <div>
                    <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-0.5">Risk</p>
                    <p className="text-[0.85rem] font-black text-[var(--t7)]">{ai.risk_score ?? '—'}<span className="text-[0.55rem] text-[var(--t3)]">/100</span></p>
                  </div>
                  <div>
                    <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-0.5">Confidence</p>
                    <p className="text-[0.85rem] font-black text-[var(--t7)]">{ai.confidence != null ? `${Math.round(ai.confidence * 100)}%` : '—'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--b1)]">
                  <div className="text-center">
                    <p className="text-[0.72rem] font-bold text-[var(--t6)]">{detail.alerts?.length ?? 0}</p>
                    <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase">Alerts</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[0.72rem] font-bold text-[var(--t6)]">{observables.length}</p>
                    <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase">IOCs</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[0.72rem] font-bold text-[var(--t6)]">{actions.length}</p>
                    <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase">Actions</p>
                  </div>
                </div>

                <div className="pt-2 border-t border-[var(--b1)] space-y-1">
                  <div className="flex justify-between text-[0.65rem]">
                    <span className="text-[var(--t3)]">Escalated</span>
                    <span className="font-bold text-[var(--t6)]">{timeAgo(new Date(detail.escalated_at).getTime())}</span>
                  </div>
                  {detail.glpi_ticket_id && (
                    <div className="flex justify-between text-[0.65rem]">
                      <span className="text-[var(--t3)]">GLPI Ticket</span>
                      <span className="font-mono text-[var(--p1)]">#{detail.glpi_ticket_id}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick actions */}
              {!isClosed && (
                <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 space-y-2">
                  <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Quick Actions</p>
                  {!detail.assigned_to && ['ADMIN', 'INCIDENT_LEAD', 'TIER2'].includes(user?.role || '') && (
                    <button onClick={handleTake}
                      className="w-full px-3 py-2 rounded-lg bg-blue-600 text-white text-[0.7rem] font-bold hover:bg-blue-700 flex items-center gap-2 transition-colors">
                      <UserPlus size={12} />Claim Incident
                    </button>
                  )}
                  {nextPhase && canEdit && detail.assigned_to && (
                    <button onClick={handleNextPhase}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--p1)] text-white text-[0.7rem] font-bold hover:bg-[var(--pd)] flex items-center gap-2 transition-colors">
                      <ChevronRight size={12} />Advance to {PHASE_LABELS[nextPhase as IncidentPhase]}
                    </button>
                  )}
                  {canReassign && (
                    <button onClick={() => { setReassignTo(detail.assigned_to || 0); setShowReassign(s => !s); }}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--b2)] text-[var(--t6)] text-[0.7rem] font-bold hover:bg-[var(--s1)] flex items-center gap-2 transition-colors">
                      <UserPlus size={12} />Reassign
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => setShowReclassify(s => !s)}
                      className="w-full px-3 py-2 rounded-lg bg-pink-100 text-pink-800 text-[0.7rem] font-bold hover:bg-pink-200 flex items-center gap-2 transition-colors">
                      <ThumbsDown size={12} />Reclassify as FP
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => setShowCloseConfirm(true)}
                      className="w-full px-3 py-2 rounded-lg bg-amber-100 text-amber-800 text-[0.7rem] font-bold hover:bg-amber-200 transition-colors">
                      Close as Resolved
                    </button>
                  )}
                </div>
              )}

              {/* Reassign popover */}
              {showReassign && (
                <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3 space-y-2">
                  <p className="text-[0.6rem] font-black text-[var(--t6)] uppercase tracking-widest">Reassign / Unassign</p>
                  <select value={reassignTo} onChange={e => setReassignTo(Number(e.target.value))}
                    className="w-full border border-[var(--b2)] rounded-lg px-2 py-1.5 text-[0.7rem] bg-[var(--s0)]">
                    <option value={0}>-- Unassign (back to Open) --</option>
                    {analysts.map(a => <option key={a.id} value={a.id}>{a.username} ({a.role})</option>)}
                  </select>
                  <div className="flex gap-1.5">
                    <button onClick={handleReassign} className="flex-1 px-2 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.65rem] font-bold">Confirm</button>
                    <button onClick={() => setShowReassign(false)} className="flex-1 px-2 py-1.5 rounded-lg border border-[var(--b2)] text-[var(--t5)] text-[0.65rem] font-semibold">Cancel</button>
                  </div>
                </div>
              )}

              {/* Reclassify popover */}
              {showReclassify && (
                <div className="bg-pink-50 border border-pink-200 rounded-xl p-3 space-y-2">
                  <p className="text-[0.6rem] font-black text-pink-800 uppercase tracking-widest">Reclassify as FP</p>
                  <p className="text-[0.65rem] text-pink-900">Returns {detail.alerts?.length ?? 0} alert(s) to the FP archive.</p>
                  <textarea value={reclassifyNote} onChange={e => setReclassifyNote(e.target.value)} rows={2}
                    placeholder="Why? (optional)"
                    className="w-full border border-pink-300 rounded-lg px-2 py-1 text-[0.65rem] bg-white resize-none" />
                  <div className="flex gap-1.5">
                    <button onClick={handleReclassifyFp} className="flex-1 px-2 py-1.5 rounded-lg bg-pink-600 text-white text-[0.65rem] font-bold hover:bg-pink-700">Confirm</button>
                    <button onClick={() => { setShowReclassify(false); setReclassifyNote(''); }} className="flex-1 px-2 py-1.5 rounded-lg border border-pink-300 text-pink-800 text-[0.65rem] font-semibold">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Close confirmation modal */}
        {showCloseConfirm && (
          <ConfirmModal
            title="Close Incident"
            message={`Are you sure you want to close "${detail.title}" as Resolved? This action marks the incident as complete.`}
            confirmLabel="Close as Resolved"
            confirmClass="bg-amber-600 hover:bg-amber-700"
            onConfirm={async () => {
              const r = await closeIncident(detail.id);
              if (r.ok) { toast('Incident closed', 'success'); fetchDetail(detail.id); fetchList(); }
              else toast(r.error || 'Failed to close', 'error');
              setShowCloseConfirm(false);
            }}
            onCancel={() => setShowCloseConfirm(false)}
          />
        )}
        {deleteActionTarget && (
          <ConfirmModal
            title="Delete Action"
            message="Are you sure you want to delete this response action? This cannot be undone."
            confirmLabel="Delete"
            onConfirm={() => handleActionDelete(deleteActionTarget)}
            onCancel={() => setDeleteActionTarget(null)}
          />
        )}
      </div>
    );
  }

  if (activeId && loadingDetail) {
    return <div className="p-6"><p className="text-[0.78rem] text-[var(--t3)]">Loading incident...</p></div>;
  }

  // ── List view ───────────────────────────────────────────────────────────
  const openCount = (counts['OPEN'] ?? 0) + (counts['IN_PROGRESS'] ?? 0) + (counts['CONTAINED'] ?? 0);
  const critCount = filteredList.filter(i => i.severity === 'CRITICAL').length;
  const breachedCount = filteredList.filter(i => computeSla(i.severity, i.escalated_at).state === 'breached').length;
  const pendingActCount = filteredList.reduce((s, i) => s + (i.pending_actions ?? 0), 0);

  const STATUS_CARDS: { key: string; label: string; tint: string; icon: any }[] = [
    { key: 'OPEN',        label: 'Open',          tint: 'border-blue-200 bg-blue-50',     icon: AlertOctagon },
    { key: 'IN_PROGRESS', label: 'Investigating', tint: 'border-orange-200 bg-orange-50', icon: Activity },
    { key: 'CONTAINED',   label: 'Contained',     tint: 'border-amber-200 bg-amber-50',   icon: Shield },
    { key: 'RESOLVED',    label: 'Resolved',      tint: 'border-green-200 bg-green-50',   icon: CheckCircle },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 overflow-y-auto h-full">
      <PageHeader eyebrow="Incident Response" title="Incidents"
        description="Manage escalated security incidents through their full lifecycle." />

      {/* Summary dashboard */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Active Incidents', value: openCount,       icon: AlertOctagon,  color: '#3b82f6', bg: 'bg-blue-50 border-blue-100' },
          { label: 'Critical',         value: critCount,       icon: AlertTriangle, color: '#ef4444', bg: 'bg-red-50 border-red-100' },
          { label: 'SLA Breached',     value: breachedCount,   icon: Clock,         color: '#f59e0b', bg: 'bg-amber-50 border-amber-100' },
          { label: 'Pending Actions',  value: pendingActCount, icon: Zap,           color: '#8b5cf6', bg: 'bg-violet-50 border-violet-100' },
        ].map((s, i) => {
          const Ico = s.icon;
          return (
            <div key={i} className={`rounded-xl p-4 border ${s.bg} flex items-center gap-3`}>
              <div className="w-10 h-10 rounded-xl bg-white/80 flex items-center justify-center border border-[var(--b2)] shadow-sm shrink-0">
                <Ico className="w-5 h-5" style={{ color: s.color }} />
              </div>
              <div>
                <p className="text-[1.4rem] font-black tracking-tight leading-none" style={{ color: s.color }}>{s.value}</p>
                <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mt-0.5">{s.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Status filter cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {STATUS_CARDS.map(c => {
          const active = statusF === c.key;
          const Ico = c.icon;
          return (
            <button key={c.key} onClick={() => setStatusF(active ? '' : c.key)}
              className={`text-left rounded-xl p-3 border-2 transition-all ${active ? 'border-[var(--p1)] bg-blue-50 shadow-sm' : `${c.tint} hover:border-[var(--p1)]`}`}>
              <div className="flex items-center gap-2 mb-1">
                <Ico size={13} className="text-[var(--t5)]" />
                <p className="text-[0.55rem] font-black text-[var(--t4)] uppercase tracking-widest">{c.label}</p>
              </div>
              <p className="text-[1.4rem] font-black text-[var(--t7)] tabular-nums leading-none">{counts[c.key] ?? 0}</p>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3 space-y-2.5">
        {/* Row 1: search + owner + SLA + My Incidents */}
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex-1 min-w-[240px] relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--t3)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title or ID…"
              className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-[var(--b2)] bg-[var(--s1)] text-[0.75rem] text-[var(--t1)] placeholder:text-[var(--t3)] focus:outline-none focus:border-[var(--p1)]" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--t3)] hover:text-[var(--t1)]">
                <X size={12} />
              </button>
            )}
          </div>
          <select value={ownerF} onChange={e => setOwnerF(e.target.value === '' ? '' : Number(e.target.value))}
            className="py-1.5 px-2 rounded-lg border border-[var(--b2)] bg-[var(--s1)] text-[0.7rem] font-bold text-[var(--t1)] focus:outline-none focus:border-[var(--p1)]">
            <option value="">All owners</option>
            {analysts.map(a => <option key={a.id} value={a.id}>{a.username} ({a.role})</option>)}
          </select>
          <select value={slaF} onChange={e => setSlaF(e.target.value)}
            className="py-1.5 px-2 rounded-lg border border-[var(--b2)] bg-[var(--s1)] text-[0.7rem] font-bold text-[var(--t1)] focus:outline-none focus:border-[var(--p1)]">
            <option value="">All SLA states</option>
            <option value="on_track">On Track</option>
            <option value="watch">Watch</option>
            <option value="at_risk">At Risk</option>
            <option value="breached">Breached</option>
          </select>
          <button onClick={() => setMyOnly(m => !m)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[0.62rem] font-bold transition-all ${
              myOnly ? 'bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-offset-0 ring-blue-200' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'
            }`}>
            <User size={10} /> My Incidents
          </button>
        </div>

        {/* Row 2: severity chips */}
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Severity:</span>
          {(['CRITICAL','HIGH','MEDIUM','LOW'] as const).map(sv => {
            const isActive = sevF === sv;
            return (
              <button
                key={sv}
                onClick={() => setSevF(isActive ? '' : sv)}
                className={`px-2 py-0.5 rounded-full border text-[0.62rem] font-black uppercase tracking-wider transition-all ${isActive ? severityChipColor(sv) + ' ring-2 ring-offset-0 ring-current' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
              >
                {sv}
              </button>
            );
          })}
        </div>

        {/* Row 3: phase chips + clear */}
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Phase:</span>
          {INCIDENT_PHASES.map(p => {
            const isActive = phaseF === p;
            return (
              <button
                key={p}
                onClick={() => setPhaseF(isActive ? '' : p)}
                className={`px-2 py-0.5 rounded-full border text-[0.62rem] font-black uppercase tracking-wider transition-all ${isActive ? 'bg-[var(--p1)] text-white border-[var(--p1)] ring-2 ring-offset-0 ring-[var(--p1)]/40' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
              >
                {PHASE_LABELS[p]}
              </button>
            );
          })}
          {(search || ownerF !== '' || sevF || slaF || phaseF || myOnly || statusF) && (
            <button
              onClick={() => { setSearch(''); setOwnerF(''); setSevF(''); setSlaF(''); setPhaseF(''); setMyOnly(false); setStatusF(''); }}
              className="ml-auto text-[0.62rem] font-bold text-[var(--p1)] hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Incident cards */}
      {filteredList.length === 0 ? (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-10 text-center">
          <AlertOctagon size={32} className="mx-auto text-[var(--t3)] mb-2" />
          <p className="text-[0.85rem] font-semibold text-[var(--t6)]">No incidents match this filter</p>
          <p className="text-[0.72rem] text-[var(--t3)] mt-1">
            Escalate an alert from the <button onClick={() => setActiveTab('investigation')} className="text-[var(--p1)] font-bold hover:underline">Alerts Queue</button> to create one.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredList.map(inc => {
            const incSla = computeSla(inc.severity, inc.escalated_at);
            const actionTotal = inc.action_count || 0;
            const actionDone = inc.executed_actions || 0;
            const actionPct = actionTotal > 0 ? Math.round((actionDone / actionTotal) * 100) : 0;
            return (
              <button key={inc.id} onClick={() => setActiveId(inc.id)}
                className="w-full bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 text-left hover:border-[var(--p1)] hover:shadow-md transition-all group">
                <div className="flex items-start gap-3 mb-2.5">
                  <span className={`px-2 py-0.5 rounded-lg text-[0.55rem] font-black uppercase tracking-widest border shrink-0 ${SEV_COLORS[inc.severity] || 'bg-gray-100 text-gray-700'}`}>{inc.severity}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[0.85rem] font-bold text-[var(--t7)] truncate group-hover:text-[var(--p1)] transition-colors">{inc.title}</p>
                    <code className="text-[0.58rem] font-mono text-[var(--t3)]">{inc.id}</code>
                  </div>
                  <span className={`px-2.5 py-1 rounded-lg text-[0.55rem] font-black uppercase tracking-widest border shrink-0 ${STATUS_COLORS[inc.status] || 'bg-gray-100 text-gray-700'}`}>
                    {STATUS_LABELS[inc.status] || inc.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[0.65rem] text-[var(--t3)] flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded-lg text-[0.55rem] font-black uppercase ${PHASE_COLORS[inc.phase] || 'bg-gray-100 text-gray-700'}`}>{PHASE_LABELS[inc.phase as IncidentPhase] || inc.phase}</span>
                  <span className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${incSla.color}`} /><span className="font-semibold">{incSla.label}</span></span>
                  <span className="flex items-center gap-1"><AlertTriangle size={11} /> {inc.alert_count || 0} alert{(inc.alert_count || 0) !== 1 ? 's' : ''}</span>
                  {actionTotal > 0 && (
                    <span className="flex items-center gap-1.5">
                      <Zap size={11} />
                      <span>{actionDone}/{actionTotal}</span>
                      <div className="w-12 h-1.5 bg-[var(--s2)] rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${actionPct}%` }} />
                      </div>
                    </span>
                  )}
                  {inc.assigned_to_username && (
                    <span className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[var(--p1)] to-[var(--pd)] flex items-center justify-center text-white text-[0.35rem] font-black">
                        {inc.assigned_to_username.substring(0, 2).toUpperCase()}
                      </div>
                      <span className="font-semibold text-[var(--t5)]">{inc.assigned_to_username}</span>
                    </span>
                  )}
                  {inc.glpi_ticket_id && <span className="font-mono text-[var(--t4)]">GLPI #{inc.glpi_ticket_id}</span>}
                  <span className="ml-auto flex items-center gap-1 text-[var(--t4)]"><Clock size={11} />{timeAgo(new Date(inc.escalated_at).getTime())}</span>
                </div>
              </button>
            );
          })}
          {total > filteredList.length && (
            <p className="text-center text-[0.7rem] text-[var(--t3)] pt-2">Showing {filteredList.length} of {total}</p>
          )}
        </div>
      )}
    </div>
  );
};

const ReportsTab = ({
  alerts,
  setActiveTab,
  setSelectedAlert,
}: {
  alerts: Alert[];
  setActiveTab: (t: string) => void;
  setSelectedAlert: (a: Alert | null) => void;
}) => {
  const [summary,           setSummary]           = useState<ReportSummary | null>(null);
  const [reports,           setReports]           = useState<ReportRow[]>([]);
  const [loading,           setLoading]           = useState(true);
  const [search,            setSearch]            = useState('');
  const [activePriorities,  setActivePriorities]  = useState<Set<string>>(new Set());
  const [activeSentVia,     setActiveSentVia]     = useState<Set<string>>(new Set());
  const [sortBy,            setSortBy]            = useState<'newest'|'oldest'|'severity'|'confidence'>('newest');
  const [viewReport,        setViewReport]        = useState<{ alert: Alert; aiData: any; mitreTags: string[] } | null>(null);

  useEffect(() => {
    getReportSummary().then(setSummary).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    getReports({ page: 1, pageSize: 200 })
      .then(d => { setReports(d.reports as ReportRow[]); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const priColor: Record<string, string> = {
    CRITICAL: 'bg-red-100 text-red-700 border border-red-200',
    HIGH:     'bg-orange-100 text-orange-700 border border-orange-200',
    MEDIUM:   'bg-amber-100 text-amber-700 border border-amber-200',
    LOW:      'bg-green-100 text-green-700 border border-green-200',
  };
  const priBtnActive: Record<string, string> = {
    CRITICAL: 'bg-red-600 text-white border-red-600',
    HIGH:     'bg-orange-500 text-white border-orange-500',
    MEDIUM:   'bg-amber-500 text-white border-amber-500',
    LOW:      'bg-green-600 text-white border-green-600',
  };
  const intgIcon: Record<string, string> = { email: '📧', glpi: '🎫', telegram: '✈' };

  const mitreMapping: Record<string, number> = {};
  alerts.forEach(a => {
    if (!a.mitre_attack) return;
    try {
      const tags = Array.isArray(a.mitre_attack) ? a.mitre_attack : JSON.parse(a.mitre_attack as any);
      tags.forEach((t: string) => { mitreMapping[t] = (mitreMapping[t] || 0) + 1; });
    } catch {}
  });
  const topMitre = Object.entries(mitreMapping).sort(([, a], [, b]) => b - a).slice(0, 5);

  const filtered = React.useMemo(() => {
    let res = [...reports];
    if (search) {
      const q = search.toLowerCase();
      res = res.filter(r =>
        r.title?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.alert_id?.toLowerCase().includes(q) ||
        r.source_ip?.toLowerCase().includes(q)
      );
    }
    if (activePriorities.size > 0)
      res = res.filter(r => activePriorities.has(r.priority ?? 'UNKNOWN'));
    if (activeSentVia.size > 0)
      res = res.filter(r => r.actions_dispatched?.some(a => activeSentVia.has(a)));
    res.sort((a, b) => {
      if (sortBy === 'newest')     return new Date(b.run_at).getTime() - new Date(a.run_at).getTime();
      if (sortBy === 'oldest')     return new Date(a.run_at).getTime() - new Date(b.run_at).getTime();
      if (sortBy === 'severity')   return b.severity - a.severity;
      if (sortBy === 'confidence') return (b.confidence ?? 0) - (a.confidence ?? 0);
      return 0;
    });
    return res;
  }, [reports, search, activePriorities, activeSentVia, sortBy]);

  const hasFilters = search.length > 0 || activePriorities.size > 0 || activeSentVia.size > 0;

  const handleViewReport = (rep: ReportRow) => {
    const alert = alerts.find(a => a.id === rep.alert_id);
    if (!alert) return;
    let aiData: any = null;
    try { aiData = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch {}
    let mitreTags: string[] = [];
    try { mitreTags = alert.mitre_attack ? JSON.parse(alert.mitre_attack as any) : []; } catch {}
    setViewReport({ alert, aiData, mitreTags });
  };

  const togglePriority = (p: string) => setActivePriorities(prev => {
    const n = new Set(prev);
    n.has(p) ? n.delete(p) : n.add(p);
    return n;
  });
  const toggleSentVia = (v: string) => setActiveSentVia(prev => {
    const n = new Set(prev);
    n.has(v) ? n.delete(v) : n.add(v);
    return n;
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-5xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-black text-[var(--t1)]">Incident Reports</h2>
            <p className="text-[0.75rem] text-[var(--t3)] mt-0.5">
              Agent-generated reports across all analyzed alerts
            </p>
          </div>
          <p className="text-xs font-mono text-[var(--t3)] mt-1">AISOC-RPT-{new Date().toISOString().split('T')[0]}</p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total Reports', value: summary?.total ?? reports.length, color: 'text-[var(--p1)]' },
            { label: 'Last 7 Days',   value: summary?.last_7_days ?? '—',      color: 'text-[var(--p1)]' },
            { label: 'Avg Confidence',value: summary?.avg_confidence != null ? `${Math.round(summary.avg_confidence)}%` : '—', color: 'text-[#1e8e3e]' },
            { label: 'Email Notified',value: summary ? `${summary.email_sent_pct}%` : '—', color: summary && summary.email_sent_pct > 0 ? 'text-[#1e8e3e]' : 'text-[var(--t3)]' },
          ].map((s, i) => (
            <div key={i} className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 shadow-sm">
              <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">{s.label}</p>
              <p className={`text-[1.8rem] font-black leading-none ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Secondary stats: 7-day sparkline + MITRE */}
        {(summary?.daily_volume || topMitre.length > 0) && (
          <div className="grid grid-cols-2 gap-3">
            {summary?.daily_volume && (
              <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 shadow-sm">
                <p className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-widest mb-3">7-Day Volume</p>
                <div className="flex items-end gap-0.5 h-10">
                  {summary.daily_volume.map((d: any, i: number) => {
                    const max = Math.max(...(summary.daily_volume?.map((x: any) => x.count) || [1]), 1);
                    return (
                      <div key={i} title={`${d.day}: ${d.count}`} className="flex-1 bg-[var(--p1)] rounded-sm opacity-80 hover:opacity-100 transition-opacity" style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} />
                    );
                  })}
                </div>
              </div>
            )}
            <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 shadow-sm space-y-1.5">
              <p className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-widest mb-2">Top MITRE Techniques</p>
              {topMitre.length > 0 ? topMitre.map(([tech, count]) => (
                <div key={tech} className="space-y-0.5">
                  <div className="flex justify-between text-[0.65rem] font-bold">
                    <span className="font-mono truncate max-w-[160px] text-[var(--t5)]">{tech}</span>
                    <span className="text-[var(--t3)]">{count}×</span>
                  </div>
                  <div className="h-1 bg-[var(--s1)] rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--p1)]" style={{ width: `${alerts.length ? (count / alerts.length) * 100 : 0}%` }} />
                  </div>
                </div>
              )) : <p className="text-[0.72rem] text-[var(--t3)] italic">Run agents to generate MITRE data.</p>}
            </div>
          </div>
        )}

        {/* Filter bar */}
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 shadow-sm space-y-3">
          {/* Row 1: search + sort */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--t3)]" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search title, description, alert ID, source IP…"
                className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-[var(--b2)] bg-[var(--s1)] text-[0.78rem] text-[var(--t7)] placeholder-[var(--t3)] outline-none focus:border-[var(--p1)] transition-colors"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--t3)] hover:text-[var(--t7)]">
                  <X size={12} />
                </button>
              )}
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="text-[0.72rem] border border-[var(--b2)] rounded-lg px-2 py-1.5 bg-[var(--s1)] text-[var(--t6)] outline-none focus:border-[var(--p1)] cursor-pointer"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="severity">Highest severity</option>
              <option value="confidence">Best confidence</option>
            </select>
          </div>

          {/* Row 2: severity chips */}
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)] shrink-0">Severity:</span>
            {(['CRITICAL','HIGH','MEDIUM','LOW'] as const).map(p => (
              <button
                key={p}
                onClick={() => togglePriority(p)}
                className={`px-2 py-0.5 rounded-full border text-[0.62rem] font-black uppercase tracking-wider transition-all ${activePriorities.has(p) ? severityChipColor(p) + ' ring-2 ring-offset-0 ring-current' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Row 3: notification channel chips + clear */}
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)] shrink-0">Notified via:</span>
            {(['email','glpi','telegram'] as const).map(v => (
              <button
                key={v}
                onClick={() => toggleSentVia(v)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[0.62rem] font-bold transition-all ${activeSentVia.has(v) ? 'bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-offset-0 ring-blue-200' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
              >
                <span>{intgIcon[v]}</span> {v}
              </button>
            ))}
            {hasFilters && (
              <button
                onClick={() => { setSearch(''); setActivePriorities(new Set()); setActiveSentVia(new Set()); }}
                className="ml-auto text-[0.62rem] font-bold text-[var(--p1)] hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Result count */}
        <p className="text-[0.72rem] text-[var(--t3)] font-semibold px-1">
          {loading ? 'Loading…' : `${filtered.length} report${filtered.length !== 1 ? 's' : ''} ${hasFilters ? 'matching filters' : 'total'}`}
        </p>

        {/* Cards */}
        {!loading && filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <FileText size={36} className="text-[var(--t3)] opacity-30" />
            <p className="text-[var(--t3)] text-sm font-semibold">
              {reports.length === 0 ? 'No reports yet — run agents on an alert to generate one.' : 'No reports match the current filters.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((rep, idx) => {
              const conf = rep.confidence ?? 0;
              const alertObj = alerts.find(a => a.id === rep.alert_id);
              return (
                <div
                  key={rep.id}
                  className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 shadow-sm hover:border-[var(--b3)] transition-colors"
                >
                  <div className="flex items-start gap-4">
                    {/* Left block */}
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Row 1: rank · priority · inc id · title */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="w-6 h-6 rounded-full bg-[var(--s1)] border border-[var(--b2)] text-[0.6rem] font-black text-[var(--t4)] flex items-center justify-center shrink-0">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        {rep.priority && (
                          <span className={`px-1.5 py-0.5 rounded border text-[0.55rem] font-black uppercase tracking-wider shrink-0 ${priColor[rep.priority] ?? 'bg-[var(--s1)] text-[var(--t5)] border-[var(--b2)]'}`}>
                            {rep.priority}
                          </span>
                        )}
                        <span className="font-mono text-[0.65rem] font-bold text-[var(--p1)] shrink-0">
                          INC-{rep.alert_id?.substring(0, 8).toUpperCase() ?? '?'}
                        </span>
                        <span className="text-[0.82rem] font-semibold text-[var(--t7)] truncate">
                          {rep.title || rep.description?.slice(0, 70) || '—'}
                        </span>
                      </div>

                      {/* Row 2: description */}
                      {rep.description && (
                        <p className="text-[0.72rem] text-[var(--t4)] line-clamp-2 leading-relaxed pl-8">
                          {rep.description}
                        </p>
                      )}

                      {/* Row 3: source IP + alert chip + sent-via + time */}
                      <div className="flex items-center gap-2 flex-wrap pl-8">
                        {rep.source_ip && (
                          <span className="font-mono text-[0.62rem] bg-[var(--s1)] text-[var(--t5)] border border-[var(--b2)] px-1.5 py-0.5 rounded">
                            {rep.source_ip}
                          </span>
                        )}
                        {alertObj && (
                          <button
                            onClick={() => { setSelectedAlert(alertObj); setActiveTab('investigation'); }}
                            className={`font-mono text-[0.62rem] font-bold px-1.5 py-0.5 rounded border transition-colors ${severityChipColor(
                              alertObj.severity >= 12 ? 'CRITICAL' : alertObj.severity >= 7 ? 'HIGH' : alertObj.severity >= 4 ? 'MEDIUM' : 'LOW'
                            )}`}
                            title="Open in Incidents"
                          >
                            #{rep.alert_id?.substring(0, 8).toUpperCase()}
                          </button>
                        )}
                        {rep.actions_dispatched && rep.actions_dispatched.length > 0 && (
                          <span className="flex gap-1 text-sm" title={rep.actions_dispatched.join(', ')}>
                            {rep.actions_dispatched.map(a => <span key={a}>{intgIcon[a] || '•'}</span>)}
                          </span>
                        )}
                        <span className="text-[0.62rem] text-[var(--t3)] font-mono ml-auto">
                          {timeAgo(new Date(rep.run_at).getTime())}
                        </span>
                      </div>
                    </div>

                    {/* Right block: confidence donut + view button */}
                    <div className="shrink-0 flex flex-col items-center gap-2 w-20">
                      <PriorityDonut value={conf} size={44} />
                      <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Confidence</span>
                      <button
                        onClick={() => handleViewReport(rep)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--b2)] text-[0.65rem] font-bold text-[var(--t5)] hover:bg-[var(--s1)] transition-colors w-full justify-center"
                      >
                        <Eye size={11} /> View
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
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

const AuthConsumer = ({ activeTab, setActiveTab, alerts, selectedAlert, setSelectedAlert, onAlertAction, autoFilter, setAutoFilter, refreshAlerts }: any) => {
  const { user } = useAuth();

  if (!user) return <LoginPage />;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
        <main className="flex-1 overflow-hidden bg-[var(--s3)]">
          {activeTab === 'dashboard'      && <DashboardTab alerts={alerts} onAlertClick={(a) => { setSelectedAlert(a); setActiveTab('investigation'); }} setActiveTab={setActiveTab} onRefreshAlerts={refreshAlerts} />}
          {activeTab === 'noise-filter'   && <NoiseFilterTab alerts={alerts} setActiveTab={setActiveTab} autoFilter={autoFilter} setAutoFilter={setAutoFilter} />}
          {activeTab === 'fp-archive'       && <FpArchiveTab />}
          {activeTab === 'reports'          && <ReportsTab alerts={alerts} setActiveTab={setActiveTab} setSelectedAlert={setSelectedAlert} />}
          {activeTab === 'knowledge'        && <KnowledgeBaseTab setActiveTab={setActiveTab} setSelectedAlert={setSelectedAlert} alerts={alerts} />}
          {activeTab === 'response-actions' && <ResponseActionsTab alerts={alerts} setActiveTab={setActiveTab} setSelectedAlert={setSelectedAlert} />}
          {activeTab === 'investigation'    && <InvestigationTab alerts={alerts} selectedAlert={selectedAlert} setSelectedAlert={setSelectedAlert} onAlertAction={onAlertAction} setActiveTab={setActiveTab} />}
          {activeTab === 'incidents'        && <IncidentsTab setActiveTab={setActiveTab} />}
          {activeTab === 'integrations'     && <IntegrationsTab />}
          {activeTab === 'settings'       && <SettingsTab />}
          {activeTab === 'profile'        && <ProfileTab />}
        </main>
      </div>
    </div>
  );
};
