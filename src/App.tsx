import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Shield, AlertTriangle, AlertOctagon, Activity, FileText, Settings, LogOut, Search, Bell, User, CheckCircle, XCircle, Clock, ChevronRight, BarChart3, Terminal, Filter, Plus, X, UserPlus, Eye, ThumbsUp, ThumbsDown, ChevronDown, BookOpen, Trash2, Send, Zap, Mail, ExternalLink, ToggleLeft, ToggleRight, RefreshCw, PanelLeftOpen, PanelLeftClose, Database, Copy, Key, Webhook, Hash, Globe, Crosshair, ListChecks, MessageSquare, Laptop, Link2, ChevronUp, Lock, Palette, MapPin, Edit3, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getAgentModelConfig, orchestrateAnalysis, runAgentPhase, updateAgentModel, getAlertRuns, saveAlertRun, getIntegrations, updateIntegration, testIntegration, getActionLogs, getReports, getReportSummary, getLocalLLMConfig, updateLocalLLMConfig, testLocalLLM, getLocalLLMModels, getAgentStats, getFpReduction, getFpOverTime, getNoisySources, getSuppressionRules, createSuppressionRule, updateSuppressionRule, deleteSuppressionRule, getAssets, upsertAsset, deleteAsset, getFpSuggestions, acceptFpSuggestion, fpScan, fpScanBatch, investigateAlert, escalateAlert, confirmFp, overrideFp, getFpArchive, getPipelineFunnel, getDetectionEffectiveness, getSourceDistribution, listApiKeys, createApiKey, revokeApiKey, updateApiKey, getInsights, getIocs, getPlaybooks, createPlaybook, updatePlaybook, deletePlaybook, listAnalysts, getIncidents, getIncident, getIncidentReasoning, reinvestigateIncident, createIncident, assignIncident, takeIncident, moveIncidentPhase, closeIncident, addIncidentNote, reclassifyIncidentFp, addIncidentAction, updateIncidentAction, deleteIncidentAction, reorderIncidentActions, updateIncident, getResponseActions, type ResponseActionRow, type ReasoningRow, testLdapConnection, getIntegration, createUser, updateUser, adminResetPassword, getAuditLogs, getAuditLogActions, auditLogsExportUrl, getFailedLogins, estimatePasswordStrength, verifyPassword, getLlmProviders, createLlmProvider, updateLlmProvider, deleteLlmProvider, testLlmProvider, type AgentModelConfig, type AgentPhase, type AgentStat, type LocalModel, type Insight, type IocRow, type Playbook, type LlmProvidersResponse, type LlmProviderRow } from './services/aiService';
import { INCIDENT_PHASES, PHASE_LABELS, INCIDENT_STATUS_LABELS, type Incident, type IncidentPhase, type IncidentStatus, type IncidentAction, type IncidentActionStatus } from './types';
import { User as UserType, Alert, AgentRun, Stats, UserRole, Integration, ActionLog, ReportRow, ReportSummary, ROLE_LABELS, ROLE_LEVEL } from './types';
import PageHeader from './components/ui/PageHeader';
import { AGENT_PHASES_UI, parseAlertAi, parseMitreTags, getPhaseData, getAlertRiskScore, getConfidenceValues, percent } from './features/alerts/alertUtils';
import { ToastContext, ToastContainer, useToast, type ToastItem } from './lib/toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ConfirmModal } from './components/ConfirmModal';
import { severityChipColor, timeAgo } from './lib/format';
import { IncidentsTab } from './pages/IncidentsTab';
import { DarkModeProvider } from './contexts/DarkModeContext';
import { NotificationContext, type NotificationItem, type NotificationContextValue, type NotificationLink } from './contexts/NotificationContext';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { DashboardTab } from './pages/DashboardTab';
import { NoiseFilterTab } from './pages/NoiseFilterTab';
import { FpArchiveTab } from './pages/FpArchiveTab';
import { ReportsTab } from './pages/ReportsTab';
import { KnowledgeBaseTab } from './pages/KnowledgeBaseTab';
import { ResponseActionsTab } from './pages/ResponseActionsTab';
import { InvestigationTab } from './pages/InvestigationTab';
import { IntegrationsTab } from './pages/IntegrationsTab';
import { SettingsTab } from './pages/SettingsTab';
import { ProfileTab } from './pages/ProfileTab';
import { LoginPage } from './pages/LoginPage';

export default function App() {
  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem('soc_active_tab');
    const validTabs = ['dashboard', 'investigation', 'incidents', 'noise-filter', 'fp-archive', 'response-actions', 'reports', 'knowledge', 'integrations', 'settings', 'profile'];
    return (saved && validTabs.includes(saved)) ? saved : 'dashboard';
  });
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(() => localStorage.getItem('soc_selected_alert_id'));
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
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

  // Persistent notification history (capped at 50, persisted to localStorage)
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => {
    try {
      const raw = localStorage.getItem('soc_notifications');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem('soc_notifications', JSON.stringify(notifications)); } catch {}
  }, [notifications]);
  const unreadCount = notifications.filter(n => !n.read).length;
  const markAllRead = useCallback(() => setNotifications(prev => prev.map(n => n.read ? n : { ...n, read: true })), []);
  const clearAllNotifications = useCallback(() => setNotifications([]), []);
  const removeNotification = useCallback((id: string) => setNotifications(prev => prev.filter(n => n.id !== id)), []);
  // Deep-link a clicked notification to its subject: incidents → Incidents tab,
  // alerts → Investigation tab.
  const navigateNotification = useCallback((link: NotificationLink) => {
    if (link.type === 'incident') {
      setSelectedIncidentId(link.id);
      setActiveTab('incidents');
    } else if (link.type === 'alert') {
      setSelectedAlertId(link.id);
      setActiveTab('investigation');
    }
  }, []);
  const notificationCtx = React.useMemo<NotificationContextValue>(
    () => ({ notifications, unreadCount, markAllRead, clearAll: clearAllNotifications, remove: removeNotification, navigate: navigateNotification }),
    [notifications, unreadCount, markAllRead, clearAllNotifications, removeNotification, navigateNotification],
  );

  const showToast = useCallback((msg: string, type: ToastItem['type'] = 'success', link?: NotificationLink) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message: msg, type, link }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
    // Also persist to notification history (cap 50, newest first)
    setNotifications(prev => [{ id, message: msg, type, timestamp: Date.now(), read: false, link }, ...prev].slice(0, 50));
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
        showToast(`📥 New alert ALERT-${String(data.id).slice(0, 8).toUpperCase()} — auto-investigating…`, 'info', { type: 'alert', id: String(data.id) });
      }
    });

    newSocket.on('alert_updated', (data) => {
      const prev = prevStatusRef.current.get(data.id);
      const next = data.status;
      if (next) prevStatusRef.current.set(data.id, next);

      if (next && prev && prev !== next) {
        const shortId = `ALERT-${String(data.id).slice(0, 8).toUpperCase()}`;
        const alertLink: NotificationLink = { type: 'alert', id: String(data.id) };
        if (next === 'FALSE_POSITIVE' || next === 'FP_CONFIRMED' || next === 'FILTERED') {
          showToast(`✅ ${shortId} — auto-archived as FP`, 'success', alertLink);
        } else if (next === 'TRIAGED' || next === 'ESCALATED' || next === 'INCIDENT') {
          let priority = '';
          try {
            const ai = typeof data.ai_analysis === 'string' ? JSON.parse(data.ai_analysis) : data.ai_analysis;
            priority = ai?.ticket?.priority || ai?.phaseData?.ticket?.priority || '';
          } catch {}
          showToast(`🚨 ${shortId} — ${priority ? priority + ' incident' : 'incident detected'}`, 'error', alertLink);
        }
      }

      setAlerts(prevAlerts => Array.isArray(prevAlerts) ? prevAlerts.map(a => a.id === data.id ? { ...a, ...data } : a) : prevAlerts);
    });

    // A real incident row was created (manual escalation / POST /api/incidents).
    // Notify with a deep-link straight into the Incidents tab.
    newSocket.on('incident_created', (data) => {
      const sev = String(data?.severity || '').toUpperCase();
      const title = data?.title ? String(data.title) : `Incident ${String(data?.id || '').slice(0, 8).toUpperCase()}`;
      showToast(`🚨 ${sev ? sev + ' incident' : 'New incident'}: ${title}`, 'error', data?.id ? { type: 'incident', id: String(data.id) } : undefined);
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
        <NotificationContext.Provider value={notificationCtx}>
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
              selectedIncidentId={selectedIncidentId}
              setSelectedIncidentId={setSelectedIncidentId}
            />
          </AuthProvider>
          <ToastContainer toasts={toasts} onNavigate={navigateNotification} />
        </NotificationContext.Provider>
      </ToastContext.Provider>
    </DarkModeProvider>
  );
}

const ForcedPasswordChangeGate: React.FC = () => {
  const { user, token, refreshProfile, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const strength = estimatePasswordStrength(next);
  const strengthColors = ['#dc2626', '#f97316', '#eab308', '#22c55e', '#16a34a'];
  const mismatch = confirm.length > 0 && next !== confirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next !== confirm) { setError('Passwords do not match'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/users/me/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || data.error || 'Failed to update password'); setSaving(false); return; }
      refreshProfile();
    } catch (err: any) {
      setError(err.message || 'Connection error');
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--s2)] flex items-center justify-center p-4">
      <div className="bg-[var(--s0)] border border-amber-300 rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center gap-2 mb-1">
          <Lock size={18} className="text-amber-600" />
          <h2 className="text-[1rem] font-black text-[var(--t7)]">Set a new password</h2>
        </div>
        <p className="text-[0.78rem] text-[var(--t4)]">
          Your account requires a password change before continuing. Welcome, <b>{user?.username}</b>.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {error && <div className="text-[#d93025] text-[0.78rem] font-semibold bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
          <div>
            <label className="text-[0.7rem] font-bold text-[var(--t3)] uppercase">Current password</label>
            <input type="password" required autoFocus value={current} onChange={e => setCurrent(e.target.value)}
              className="w-full mt-1 bg-[var(--s1)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
          </div>
          <div>
            <label className="text-[0.7rem] font-bold text-[var(--t3)] uppercase">New password</label>
            <input type="password" required value={next} onChange={e => setNext(e.target.value)}
              className="w-full mt-1 bg-[var(--s1)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
            {next && (
              <div className="mt-1.5">
                <div className="flex gap-0.5 h-1.5">
                  {[0,1,2,3,4].map(i => (
                    <div key={i} className="flex-1 rounded-sm transition-colors"
                      style={{ backgroundColor: i < strength.score + 1 ? strengthColors[strength.score] : 'var(--b1)' }} />
                  ))}
                </div>
                <p className="text-[0.65rem] text-[var(--t3)] mt-1">Strength: <b style={{ color: strengthColors[strength.score] }}>{strength.label}</b> · {strength.bits} bits</p>
              </div>
            )}
          </div>
          <div>
            <label className="text-[0.7rem] font-bold text-[var(--t3)] uppercase">Confirm new password</label>
            <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)}
              className={`w-full mt-1 bg-[var(--s1)] border rounded-lg px-3 py-2 text-sm outline-none ${mismatch ? 'border-red-500 focus:border-red-500' : 'border-[var(--b1)] focus:border-[var(--p1)]'}`} />
            {mismatch && <p className="text-[0.65rem] text-red-600 mt-1">Passwords do not match</p>}
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving}
              className="flex-1 bg-[var(--p1)] text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-[var(--pd)] disabled:opacity-50">
              {saving ? 'Saving…' : 'Change password'}
            </button>
            <button type="button" onClick={logout}
              className="border border-[var(--b2)] text-[var(--t5)] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--s1)]">
              Sign out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const AuthConsumer = ({ activeTab, setActiveTab, alerts, selectedAlert, setSelectedAlert, onAlertAction, autoFilter, setAutoFilter, refreshAlerts, selectedIncidentId, setSelectedIncidentId }: any) => {
  const { user } = useAuth();

  if (!user) return <LoginPage />;
  if (user.must_change_password) return <ForcedPasswordChangeGate />;

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
          {activeTab === 'response-actions' && <ResponseActionsTab setActiveTab={setActiveTab} setSelectedIncidentId={setSelectedIncidentId} />}
          {activeTab === 'investigation'    && <InvestigationTab alerts={alerts} selectedAlert={selectedAlert} setSelectedAlert={setSelectedAlert} onAlertAction={onAlertAction} setActiveTab={setActiveTab} />}
          {activeTab === 'incidents'        && <IncidentsTab setActiveTab={setActiveTab} initialIncidentId={selectedIncidentId} clearInitialIncidentId={() => setSelectedIncidentId(null)} />}
          {activeTab === 'integrations'     && <IntegrationsTab />}
          {activeTab === 'settings'       && <SettingsTab />}
          {activeTab === 'profile'        && <ProfileTab />}
        </main>
      </div>
    </div>
  );
};
