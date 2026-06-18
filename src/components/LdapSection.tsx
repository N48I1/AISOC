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

const LdapSection = () => {
  const toast    = useToast();
  const { user } = useAuth();
  const isAdmin  = (ROLE_LEVEL[user?.role || ''] ?? 0) >= ROLE_LEVEL.ADMIN;

  type LdapCfg = {
    url:                  string;
    bind_dn:              string;
    bind_password:        string;
    base_dn:              string;
    user_filter:          string;
    username_attr:        string;
    email_attr:           string;
    display_name_attr:    string;
    default_role:         string;
    allow_local_fallback: string;
  };
  const DEFAULT_CFG: LdapCfg = {
    url:                  '',
    bind_dn:              '',
    bind_password:        '',
    base_dn:              '',
    user_filter:          '(sAMAccountName={{username}})',
    username_attr:        'sAMAccountName',
    email_attr:           'mail',
    display_name_attr:    'displayName',
    default_role:         'ANALYST',
    allow_local_fallback: 'true',
  };

  const [enabled, setEnabled] = useState(false);
  const [cfg, setCfg]         = useState<LdapCfg>(DEFAULT_CFG);
  const [showPw, setShowPw]   = useState(false);
  const [saving, setSaving]   = useState(false);
  const [testing, setTesting] = useState(false);
  const [testUser, setTestUser]     = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; user?: any; error?: string } | null>(null);

  const load = useCallback(() => {
    getIntegration('ldap').then(row => {
      if (row) {
        setEnabled(!!row.enabled);
        setCfg({ ...DEFAULT_CFG, ...(row.config || {}) } as LdapCfg);
      }
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!isAdmin) return;
    setSaving(true);
    try {
      await updateIntegration('ldap', { enabled, config: cfg as any });
      toast('LDAP settings saved', 'success');
    } catch (e: any) {
      toast(e?.message || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testUser.trim()) { toast('Enter a username to look up', 'error'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testLdapConnection(testUser.trim());
      setTestResult(r);
      if (r.ok) toast(`Found ${r.user?.dn || testUser}`, 'success');
      else      toast(r.error || 'LDAP test failed', 'error');
    } finally {
      setTesting(false);
    }
  };

  const Field = ({ label, k, type = 'text', mono = false, placeholder, hint }: {
    label: string; k: keyof LdapCfg; type?: string; mono?: boolean; placeholder?: string; hint?: string;
  }) => (
    <div>
      <label className="text-[0.62rem] font-black uppercase tracking-widest text-[var(--t3)]">{label}</label>
      <input
        type={type === 'password' && showPw ? 'text' : type}
        value={cfg[k]}
        onChange={e => setCfg({ ...cfg, [k]: e.target.value })}
        placeholder={placeholder}
        disabled={!isAdmin}
        className={`w-full mt-1 border border-[var(--b2)] rounded-lg px-2.5 py-1.5 text-[0.75rem] bg-[var(--s0)] focus:outline-none focus:border-[var(--p1)] ${mono ? 'font-mono' : ''}`}
      />
      {hint && <p className="text-[0.6rem] text-[var(--t3)] mt-1">{hint}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
          <User size={18} className="text-indigo-600" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[0.95rem] font-black text-[var(--t1)]">LDAP / Active Directory SSO</h3>
            <span className={`px-1.5 py-0.5 rounded text-[0.55rem] font-black uppercase tracking-widest ${enabled ? 'bg-emerald-50 text-emerald-700 border border-emerald-300' : 'bg-[var(--s1)] text-[var(--t3)] border border-[var(--b2)]'}`}>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <p className="text-[0.72rem] text-[var(--t3)] mt-1">
            Let analysts sign in with their AD credentials. On first successful login, a local mirror account is auto-created with the default role; admins can promote later.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setEnabled(v => !v)}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.7rem] font-bold border transition-colors ${enabled ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100' : 'bg-[var(--s1)] border-[var(--b2)] text-[var(--t5)] hover:bg-[var(--s2)]'}`}
          >
            {enabled ? <><ToggleRight size={14} /> On</> : <><ToggleLeft size={14} /> Off</>}
          </button>
        )}
      </div>

      {/* Connection */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 space-y-3">
        <p className="text-[0.72rem] font-black text-[var(--t7)]">Connection</p>
        <Field label="Server URL" k="url" mono placeholder="ldaps://dc01.bbs.local:636" hint="Use ldaps:// for TLS (port 636) or ldap:// for plaintext (port 389)." />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bind DN" k="bind_dn" mono placeholder="CN=svc-aisoc,OU=Service Accounts,DC=bbs,DC=local" />
          <div>
            <label className="text-[0.62rem] font-black uppercase tracking-widest text-[var(--t3)]">Bind Password</label>
            <div className="relative mt-1">
              <input
                type={showPw ? 'text' : 'password'}
                value={cfg.bind_password}
                onChange={e => setCfg({ ...cfg, bind_password: e.target.value })}
                disabled={!isAdmin}
                className="w-full border border-[var(--b2)] rounded-lg pl-2.5 pr-8 py-1.5 text-[0.75rem] bg-[var(--s0)] font-mono focus:outline-none focus:border-[var(--p1)]"
              />
              <button onClick={() => setShowPw(s => !s)} type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--t3)] hover:text-[var(--t1)]">
                <Eye size={13} />
              </button>
            </div>
          </div>
        </div>
        <Field label="Base DN" k="base_dn" mono placeholder="DC=bbs,DC=local" />
      </div>

      {/* User search */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 space-y-3">
        <p className="text-[0.72rem] font-black text-[var(--t7)]">User search & attributes</p>
        <Field label="User filter" k="user_filter" mono placeholder="(sAMAccountName={{username}})" hint="Use {{username}} as the placeholder. AD: sAMAccountName · OpenLDAP: uid." />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Username attr" k="username_attr"     mono />
          <Field label="Email attr"    k="email_attr"        mono />
          <Field label="Display name"  k="display_name_attr" mono />
        </div>
      </div>

      {/* Provisioning */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 space-y-3">
        <p className="text-[0.72rem] font-black text-[var(--t7)]">Provisioning & fallback</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[0.62rem] font-black uppercase tracking-widest text-[var(--t3)]">Default role on first login</label>
            <select
              value={cfg.default_role}
              onChange={e => setCfg({ ...cfg, default_role: e.target.value })}
              disabled={!isAdmin}
              className="w-full mt-1 border border-[var(--b2)] rounded-lg px-2.5 py-1.5 text-[0.75rem] bg-[var(--s0)] focus:outline-none focus:border-[var(--p1)]"
            >
              <option value="ANALYST">ANALYST</option>
              <option value="TIER1">TIER1 (SOC Analyst L1)</option>
              <option value="TIER2">TIER2 (SOC Analyst L2)</option>
              <option value="INCIDENT_LEAD">INCIDENT_LEAD</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <p className="text-[0.6rem] text-[var(--t3)] mt-1">Admins can change individual roles after the account is auto-created.</p>
          </div>
          <div>
            <label className="text-[0.62rem] font-black uppercase tracking-widest text-[var(--t3)]">Allow local fallback</label>
            <button
              onClick={() => isAdmin && setCfg({ ...cfg, allow_local_fallback: cfg.allow_local_fallback === 'true' ? 'false' : 'true' })}
              disabled={!isAdmin}
              className={`w-full mt-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[0.7rem] font-bold border transition-colors ${cfg.allow_local_fallback === 'true' ? 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100' : 'bg-[var(--s1)] border-[var(--b2)] text-[var(--t5)] hover:bg-[var(--s2)]'}`}
            >
              {cfg.allow_local_fallback === 'true' ? <><ToggleRight size={14} /> Local fallback ON</> : <><ToggleLeft size={14} /> Local fallback OFF</>}
            </button>
            <p className="text-[0.6rem] text-[var(--t3)] mt-1">When ON, local password is tried if LDAP rejects the user. Useful for the seed admin.</p>
          </div>
        </div>
      </div>

      {/* Test connection */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 space-y-3">
        <p className="text-[0.72rem] font-black text-[var(--t7)]">Test connection</p>
        <p className="text-[0.65rem] text-[var(--t3)]">
          Binds with the service account above and searches for the username you enter — verifies URL, bind, base DN, and filter without checking the user's password.
        </p>
        <div className="flex gap-2">
          <input
            value={testUser}
            onChange={e => setTestUser(e.target.value)}
            placeholder="username to look up (e.g. nelhilali)"
            className="flex-1 border border-[var(--b2)] rounded-lg px-2.5 py-1.5 text-[0.75rem] bg-[var(--s0)] focus:outline-none focus:border-[var(--p1)]"
          />
          <button
            onClick={handleTest}
            disabled={!isAdmin || testing || !cfg.url}
            className="px-3 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.7rem] font-bold disabled:opacity-50 flex items-center gap-1.5"
          >
            {testing ? <><RefreshCw size={11} className="animate-spin" /> Testing…</> : <><Zap size={11} /> Test lookup</>}
          </button>
        </div>
        {testResult && (
          <div className={`rounded-lg border p-2.5 text-[0.7rem] ${testResult.ok ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-red-50 border-red-300 text-red-800'}`}>
            {testResult.ok ? (
              <div>
                <p className="font-bold mb-1">✓ Found in directory</p>
                <p className="font-mono text-[0.65rem] break-all">{testResult.user?.dn}</p>
                {testResult.user?.email        && <p className="font-mono text-[0.65rem] mt-0.5">email: {testResult.user.email}</p>}
                {testResult.user?.display_name && <p className="font-mono text-[0.65rem] mt-0.5">name: {testResult.user.display_name}</p>}
              </div>
            ) : (
              <div>
                <p className="font-bold mb-1">✗ Lookup failed</p>
                <p className="font-mono text-[0.65rem] break-all">{testResult.error}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Save */}
      {isAdmin && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-[var(--p1)] text-white text-[0.75rem] font-bold disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <><RefreshCw size={12} className="animate-spin" /> Saving…</> : <>Save settings</>}
          </button>
        </div>
      )}
    </div>
  );
};


export { LdapSection };
