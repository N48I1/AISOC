import React, { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from 'react';
import { Shield, AlertTriangle, AlertOctagon, Activity, FileText, Settings, LogOut, Search, Bell, User, CheckCircle, XCircle, Clock, ChevronRight, BarChart3, Terminal, Filter, Plus, X, UserPlus, Eye, ThumbsUp, ThumbsDown, ChevronDown, BookOpen, Trash2, Send, Zap, Mail, ExternalLink, ToggleLeft, ToggleRight, RefreshCw, PanelLeftOpen, PanelLeftClose, Database, Copy, Key, Webhook, Hash, Globe, Crosshair, ListChecks, MessageSquare, Laptop, Link2, ChevronUp, Lock, Palette, MapPin, Edit3, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getAgentModelConfig, orchestrateAnalysis, runAgentPhase, updateAgentModel, getAlertRuns, saveAlertRun, getIntegrations, updateIntegration, testIntegration, getActionLogs, getReports, getReportSummary, getLocalLLMConfig, updateLocalLLMConfig, testLocalLLM, getLocalLLMModels, getAgentStats, getFpReduction, getFpOverTime, getNoisySources, getSuppressionRules, createSuppressionRule, updateSuppressionRule, deleteSuppressionRule, getAssets, upsertAsset, deleteAsset, getFpSuggestions, acceptFpSuggestion, fpScan, fpScanBatch, investigateAlert, escalateAlert, confirmFp, overrideFp, getFpArchive, getPipelineFunnel, getDetectionEffectiveness, getSourceDistribution, listApiKeys, createApiKey, revokeApiKey, updateApiKey, getInsights, getIocs, getPlaybooks, createPlaybook, updatePlaybook, deletePlaybook, listAnalysts, getIncidents, getIncident, getIncidentReasoning, reinvestigateIncident, createIncident, assignIncident, takeIncident, moveIncidentPhase, closeIncident, addIncidentNote, reclassifyIncidentFp, addIncidentAction, updateIncidentAction, deleteIncidentAction, reorderIncidentActions, updateIncident, getResponseActions, type ResponseActionRow, type ReasoningRow, testLdapConnection, getIntegration, createUser, updateUser, adminResetPassword, getAuditLogs, getAuditLogActions, auditLogsExportUrl, getFailedLogins, estimatePasswordStrength, verifyPassword, getLlmProviders, createLlmProvider, updateLlmProvider, deleteLlmProvider, testLlmProvider, type AgentModelConfig, type AgentPhase, type AgentStat, type LocalModel, type Insight, type IocRow, type Playbook, type LlmProvidersResponse, type LlmProviderRow } from '../services/aiService';
import { INCIDENT_PHASES, PHASE_LABELS, INCIDENT_STATUS_LABELS, type Incident, type IncidentPhase, type IncidentStatus, type IncidentAction, type IncidentActionStatus } from '../types';
import { User as UserType, Alert, AgentRun, Stats, UserRole, Integration, ActionLog, ReportRow, ReportSummary, ROLE_LABELS, ROLE_LEVEL } from '../types';
import PageHeader from '../components/ui/PageHeader';
import { AGENT_PHASES_UI, parseAlertAi, parseMitreTags, getPhaseData, getAlertRiskScore, getConfidenceValues, percent } from '../features/alerts/alertUtils';
import { ToastContext, ToastContainer, useToast, type ToastItem } from '../lib/toast';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { ConfirmModal } from '../components/ConfirmModal';
import { severityChipColor, timeAgo } from '../lib/format';
import { LdapSection } from '../components/LdapSection';

const EMAIL_CONFIG_DEFAULTS: Record<string, string> = {
  smtp_provider: '',
  auth_method: '',
  smtp_user: '',
  smtp_pass: '',
  to: '',
  from: '',
  smtp_host: 'smtp.gmail.com',
  smtp_port: '587',
  ms_tenant_id: '',
  ms_client_id: '',
  ms_client_secret: '',
  ms_mailbox: '',
};

function inferEmailProvider(cfg: Record<string, string>, user: string): string {
  const configured = (cfg.smtp_provider || '').trim().toLowerCase();
  if (['gmail', 'office365', 'custom'].includes(configured)) return configured;
  const host = (cfg.smtp_host || '').trim().toLowerCase();
  if (host === 'smtp.gmail.com' || /@gmail\.com$/i.test(user)) return 'gmail';
  if (host === 'smtp.office365.com' || /@(outlook|hotmail|live|msn)\.com$/i.test(user)) return 'office365';
  return 'custom';
}

function normalizeEmailConfig(raw: Record<string, string> = {}): Record<string, string> {
  const cfg = { ...EMAIL_CONFIG_DEFAULTS, ...raw };
  const user = (cfg.smtp_user || cfg.from || '').trim();
  const provider = inferEmailProvider(cfg, user);
  const gmailMode = provider === 'gmail';
  const office365Mode = provider === 'office365';
  const requestedAuthMethod = (cfg.auth_method || '').trim();
  const authMethod = office365Mode
    ? (requestedAuthMethod === 'smtp_password' ? 'smtp_password' : 'microsoft_graph')
    : 'smtp_password';
  return {
    ...cfg,
    smtp_provider: provider,
    auth_method: authMethod,
    smtp_user: user,
    smtp_pass: gmailMode ? (cfg.smtp_pass || '').replace(/\s+/g, '') : (cfg.smtp_pass || ''),
    smtp_host: (cfg.smtp_host || '').trim() || (gmailMode ? 'smtp.gmail.com' : office365Mode ? 'smtp.office365.com' : ''),
    smtp_port: (cfg.smtp_port || '').trim() || (gmailMode || office365Mode ? '587' : ''),
    from: (cfg.from || '').trim() || user,
    to: (cfg.to || '').trim(),
    ms_tenant_id: (cfg.ms_tenant_id || '').trim(),
    ms_client_id: (cfg.ms_client_id || '').trim(),
    ms_client_secret: cfg.ms_client_secret || '',
    ms_mailbox: (cfg.ms_mailbox || user || cfg.from || '').trim(),
  };
}

// Admin: filtered, paginated viewer of the audit_logs table with CSV export.
// Replaces the placeholder "Recent Actions" panel (which only shows integration dispatch logs).
const AuditLogViewer: React.FC = () => {
  const { token } = useAuth();
  const showToast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [actions, setActions] = useState<string[]>([]);
  const [filterAction, setFilterAction] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ total: number; byUser: Array<{ username: string; count: number }>; sparkline: Array<{ count: number }> } | null>(null);

  useEffect(() => {
    getAuditLogActions().then(setActions).catch(() => {});
    fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setUsers(d); })
      .catch(() => {});
    getFailedLogins('24h').then(setStats).catch(() => {});
  }, [token]);

  const fetchRows = useCallback(() => {
    setLoading(true);
    getAuditLogs({
      page,
      pageSize,
      action: filterAction || undefined,
      user_id: filterUserId || undefined,
      from: filterFrom || undefined,
      to: filterTo || undefined,
      q: searchQ || undefined,
    })
      .then(res => { setRows(res.rows || []); setTotal(res.total || 0); })
      .catch(() => showToast('Failed to load audit logs', 'error'))
      .finally(() => setLoading(false));
  }, [page, filterAction, filterUserId, filterFrom, filterTo, searchQ, showToast]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setPage(1); setSearchQ(searchInput); };
  const clearFilters = () => { setFilterAction(''); setFilterUserId(''); setFilterFrom(''); setFilterTo(''); setSearchQ(''); setSearchInput(''); setPage(1); };

  const exportCsv = () => {
    const url = auditLogsExportUrl({
      action: filterAction || undefined,
      user_id: filterUserId || undefined,
      from: filterFrom || undefined,
      to: filterTo || undefined,
      q: searchQ || undefined,
    });
    // Use fetch+blob so we can pass the bearer token (browser navigation can't)
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => showToast('Export failed', 'error'));
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const actionColor = (a: string) => {
    if (a === 'LOGIN_FAILED' || a === 'ACCOUNT_LOCKED') return 'bg-red-100 text-red-700';
    if (a === 'LOGIN' || a === 'PASSWORD_CHANGED') return 'bg-green-100 text-green-700';
    if (a.startsWith('USER_') || a === 'PASSWORD_RESET') return 'bg-blue-100 text-blue-700';
    return 'bg-slate-100 text-slate-700';
  };

  return (
    <div className="space-y-4">
      {/* Failed-login mini-dashboard */}
      {stats && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-[0.82rem] font-black text-[var(--t7)]">Failed logins · last 24h</h3>
              <p className="text-[0.65rem] text-[var(--t3)] mt-0.5">{stats.total} failed login attempt{stats.total !== 1 ? 's' : ''}</p>
            </div>
            <span className={`text-[1.2rem] font-black ${stats.total > 10 ? 'text-red-600' : stats.total > 0 ? 'text-amber-600' : 'text-green-600'}`}>{stats.total}</span>
          </div>
          {stats.sparkline.length > 0 && (
            <div className="flex items-end gap-0.5 h-10">
              {stats.sparkline.map((b, i) => {
                const max = Math.max(1, ...stats.sparkline.map(x => x.count));
                const h = Math.max(2, Math.round((b.count / max) * 38));
                return <div key={i} className={`flex-1 rounded-t-sm ${b.count > 0 ? 'bg-red-400' : 'bg-[var(--b1)]'}`} style={{ height: h }} title={`${b.count} fails`} />;
              })}
            </div>
          )}
          {stats.byUser.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {stats.byUser.slice(0, 8).map(u => (
                <span key={u.username} className="text-[0.65rem] bg-red-50 border border-red-200 rounded px-2 py-0.5 text-red-700 font-semibold">
                  {u.username} <b>×{u.count}</b>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl">
        <div className="px-4 py-3 border-b border-[var(--b1)] bg-[var(--s1)] flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-[0.82rem] font-black text-[var(--t7)]">Audit trail <span className="text-[0.65rem] text-[var(--t3)] font-semibold">({total} matching)</span></h3>
          <div className="flex gap-2">
            <button onClick={clearFilters} className="text-[0.7rem] font-semibold text-[var(--t4)] hover:text-[var(--t6)] px-2 py-1 rounded hover:bg-[var(--s2)]">Clear filters</button>
            <button onClick={exportCsv} className="text-[0.7rem] font-bold text-[var(--p1)] border border-[var(--p1)] px-2.5 py-1 rounded hover:bg-[var(--p1)] hover:text-white transition-colors">Export CSV</button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-[var(--b1)] flex flex-wrap gap-2 items-center">
          <select value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(1); }}
            className="bg-[var(--s1)] border border-[var(--b1)] rounded px-2 py-1 text-[0.72rem]">
            <option value="">All actions</option>
            {actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filterUserId} onChange={e => { setFilterUserId(e.target.value); setPage(1); }}
            className="bg-[var(--s1)] border border-[var(--b1)] rounded px-2 py-1 text-[0.72rem]">
            <option value="">All users</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
          <input type="date" value={filterFrom} onChange={e => { setFilterFrom(e.target.value); setPage(1); }}
            className="bg-[var(--s1)] border border-[var(--b1)] rounded px-2 py-1 text-[0.72rem]" />
          <span className="text-[0.7rem] text-[var(--t3)]">to</span>
          <input type="date" value={filterTo} onChange={e => { setFilterTo(e.target.value); setPage(1); }}
            className="bg-[var(--s1)] border border-[var(--b1)] rounded px-2 py-1 text-[0.72rem]" />
          <form onSubmit={handleSearch} className="flex gap-1 flex-1 min-w-[160px]">
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search details / action / user"
              className="flex-1 bg-[var(--s1)] border border-[var(--b1)] rounded px-2 py-1 text-[0.72rem]" />
            <button type="submit" className="bg-[var(--p1)] text-white text-[0.7rem] font-bold px-3 py-1 rounded hover:bg-[var(--pd)]">Search</button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[0.75rem]">
            <thead className="bg-[var(--s1)] border-b border-[var(--b1)] text-[0.62rem] uppercase tracking-wider text-[var(--t3)]">
              <tr>
                <th className="px-4 py-2">Timestamp</th>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--b1)]">
              {loading ? (
                <tr><td colSpan={4} className="p-6 text-center text-[var(--t3)]">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center text-[var(--t3)]">No audit events match the current filters.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="hover:bg-[var(--s1)]">
                  <td className="px-4 py-2 font-mono text-[0.65rem] text-[var(--t3)] whitespace-nowrap">{(r.timestamp || '').replace('T', ' ').slice(0, 19)}</td>
                  <td className="px-4 py-2 text-[var(--t6)]">{r.username || <span className="text-[var(--t3)] italic">—</span>}</td>
                  <td className="px-4 py-2"><span className={`text-[0.62rem] font-bold uppercase px-1.5 py-0.5 rounded ${actionColor(r.action)}`}>{r.action}</span></td>
                  <td className="px-4 py-2 text-[var(--t5)] break-words max-w-[400px]">{r.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-[var(--b1)] flex items-center justify-between text-[0.72rem] text-[var(--t4)]">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 py-1 rounded border border-[var(--b2)] disabled:opacity-30 hover:bg-[var(--s1)]">Prev</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="px-3 py-1 rounded border border-[var(--b2)] disabled:opacity-30 hover:bg-[var(--s1)]">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const IntegrationsTab = () => {
  const toast = useToast();
  const { user, token } = useAuth();
  const isAdmin = (ROLE_LEVEL[user?.role || ''] ?? 0) >= ROLE_LEVEL.ADMIN;
  const [activeSection, setActiveSection] = useState<'notifications' | 'ldap' | 'logs' | 'audit' | 'ingest'>('notifications');
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

  const handleEmailProviderChange = (provider: string) => {
    setEditConfig((current: Record<string, string>) => {
      const next: Record<string, string> = { ...current, smtp_provider: provider };
      if (provider === 'gmail') {
        next.auth_method = 'smtp_password';
        next.smtp_host = 'smtp.gmail.com';
        next.smtp_port = '587';
      } else if (provider === 'office365') {
        next.auth_method = current.auth_method || 'microsoft_graph';
        next.smtp_host = 'smtp.office365.com';
        next.smtp_port = '587';
        next.ms_mailbox = current.ms_mailbox || current.smtp_user || current.from || '';
      } else {
        next.auth_method = 'smtp_password';
        next.smtp_host = current.smtp_host || '';
        next.smtp_port = current.smtp_port || '587';
      }
      return next;
    });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5 overflow-y-auto h-full">
      <PageHeader eyebrow="External Systems" title="Integrations" description="GLPI ticketing, Telegram alerts, email notifications, and firewall controls." />

      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'notifications' as const, label: 'Notifications' },
          { id: 'ldap' as const, label: 'LDAP / AD' },
          { id: 'logs' as const, label: 'Activity Log' },
          ...(isAdmin ? [{ id: 'audit' as const, label: 'Audit Trail' }] : []),
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
            const emailProvider = (cfg?.smtp_provider || '').trim();
            const emailAuthMethod = (cfg?.auth_method || '').trim();
            const emailSender = (cfg?.smtp_user || cfg?.from || '').trim();
            const isGraphEmail = intg.name === 'email' && emailProvider === 'office365' && emailAuthMethod === 'microsoft_graph';
            const isEmailUnconfigured = intg.name === 'email' && (isGraphEmail
              ? !(cfg?.ms_tenant_id && cfg?.ms_client_id && cfg?.ms_client_secret && cfg?.ms_mailbox && cfg?.to)
              : !(emailSender && cfg?.smtp_pass && cfg?.to));
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
              smtp_provider: 'Email Provider',
              auth_method: 'Auth Method',
              smtp_host: 'SMTP Host', smtp_port: 'SMTP Port', smtp_user: 'Mailbox / SMTP Username',
              smtp_pass: 'App Password / SMTP Password', from: 'From Address', to: 'Destination Email',
              ms_tenant_id: 'Azure Tenant ID',
              ms_client_id: 'Azure Client ID',
              ms_client_secret: 'Azure Client Secret',
              ms_mailbox: 'Sender Mailbox',
              bot_token: 'Bot Token', chat_id: 'Chat ID',
              url: 'GLPI URL', app_token: 'App Token', user_token: 'User Token',
              webhook_url: 'Webhook URL',
            };
            const editCfgForCard = intg.name === 'email' ? getEmailConfigWithDefaults(editConfig) : editConfig;
            const editKeys = intg.name === 'email'
              ? editCfgForCard.smtp_provider === 'office365' && editCfgForCard.auth_method !== 'smtp_password'
                ? ['smtp_provider', 'auth_method', 'ms_tenant_id', 'ms_client_id', 'ms_client_secret', 'ms_mailbox', 'to']
                : editCfgForCard.smtp_provider === 'office365'
                  ? ['smtp_provider', 'auth_method', 'smtp_user', 'smtp_pass', 'to', 'from', 'smtp_host', 'smtp_port']
                  : ['smtp_provider', 'smtp_user', 'smtp_pass', 'to', 'from', 'smtp_host', 'smtp_port']
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
                            {k === 'smtp_provider' ? (
                              <select
                                value={editCfgForCard[k] || 'custom'}
                                onChange={e => handleEmailProviderChange(e.target.value)}
                                className="w-full px-2 py-1.5 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.72rem] outline-none focus:border-[var(--p1)] font-mono"
                              >
                                <option value="gmail">Gmail</option>
                                <option value="office365">Office 365 / Microsoft 365</option>
                                <option value="custom">Custom SMTP</option>
                              </select>
                            ) : k === 'auth_method' ? (
                              <select
                                value={editCfgForCard[k] || 'microsoft_graph'}
                                onChange={e => setEditConfig((c: any) => ({ ...c, auth_method: e.target.value }))}
                                className="w-full px-2 py-1.5 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.72rem] outline-none focus:border-[var(--p1)] font-mono"
                              >
                                <option value="microsoft_graph">Microsoft Graph OAuth</option>
                                <option value="smtp_password">SMTP password / app password</option>
                              </select>
                            ) : (
                              <input
                                value={editCfgForCard[k] || ''}
                                onChange={e => setEditConfig((c: any) => ({ ...c, [k]: e.target.value }))}
                                type={isSecret ? 'password' : 'text'}
                                placeholder={isSecret ? '••••••••' : undefined}
                                className="w-full px-2 py-1.5 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.72rem] outline-none focus:border-[var(--p1)] font-mono"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {intg.name === 'email' && (
                      <p className="text-[0.62rem] text-[var(--t3)]">
                        For Microsoft 365, use Microsoft Graph OAuth with an Azure app that has Microsoft Graph Mail.Send application permission and admin consent. Gmail and custom SMTP still use mailbox/app-password SMTP.
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

      {/* LDAP / AD */}
      {activeSection === 'ldap' && <LdapSection />}

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

      {/* Audit Trail (admin only) */}
      {activeSection === 'audit' && isAdmin && <AuditLogViewer />}

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
                  <p className="text-[0.68rem] text-[var(--t3)] mt-0.5">Immediately run AI agents on every alert received via API. Sends alert data to the configured LLM provider automatically — prefer a local Ollama model for air-gapped operation (NIST AC-4/SC-7).</p>
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



export { IntegrationsTab };
