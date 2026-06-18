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
import { StepUpModal } from '../components/StepUpModal';
import { useDarkMode } from '../contexts/DarkModeContext';
import { TACTIC_OPTIONS } from '../lib/mitre';
import { AgentsTab } from './AgentsTab';


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

// Step-up re-authentication modal. Prompts for the caller's password, exchanges
// it for a 5-min token via /api/auth/verify-password, then hands the token to
// onVerified() so the caller can replay the destructive action with it.
// Used by Danger Zone, Delete User, AI Model changes, Local LLM config save.
const EditUserModal: React.FC<{
  user: any;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (updated: any) => void;
  onResetPassword: (tempPassword: string) => void;
}> = ({ user, isSelf, onClose, onSaved, onResetPassword }) => {
  const showToast = useToast();
  const { user: me } = useAuth();
  // Only a SUPER_ADMIN may assign the ADMIN / SUPER_ADMIN tiers. The current
  // role is always offered so the select renders correctly for any target.
  const canSuper = me?.role === 'SUPER_ADMIN';
  const [form, setForm] = useState({
    display_name: user.display_name || '',
    email: user.email || '',
    role: user.role || 'TIER1',
    status: (user.status as 'active' | 'disabled') || 'active',
    must_change_password: !!user.must_change_password,
    access_expires_at: user.access_expires_at ? user.access_expires_at.slice(0, 10) : '',
  });
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await updateUser(user.id, {
        display_name: form.display_name,
        email: form.email || null as any,
        role: form.role,
        status: form.status,
        must_change_password: form.must_change_password,
        access_expires_at: form.access_expires_at || null,
      });
      onSaved(updated);
    } catch (err: any) {
      setError(err.message || 'Failed to update user');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm(`Reset password for ${user.username}? A new temporary password will be generated.`)) return;
    setResetting(true);
    try {
      const r = await adminResetPassword(user.id);
      onResetPassword(r.temp_password);
    } catch (err: any) {
      showToast(err.message || 'Failed to reset password', 'error');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-[1rem] font-black text-[var(--t7)]">Edit user</h3>
            <p className="text-[0.72rem] text-[var(--t3)] mt-0.5">@{user.username} · #{user.id}{user.auth_source === 'ldap' && <span className="ml-2 text-purple-600 font-bold">LDAP</span>}</p>
          </div>
          <button onClick={onClose} className="text-[var(--t3)] hover:text-[var(--t6)]"><XCircle size={18} /></button>
        </div>

        {error && <div className="mb-3 text-[#d93025] text-[0.78rem] font-semibold bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

        <div className="space-y-3">
          <div>
            <label className="text-[0.7rem] font-bold text-[var(--t3)] uppercase">Display name</label>
            <input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })}
              className="w-full mt-1 bg-[var(--s1)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
          </div>
          <div>
            <label className="text-[0.7rem] font-bold text-[var(--t3)] uppercase">Email</label>
            <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
              className="w-full mt-1 bg-[var(--s1)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[0.7rem] font-bold text-[var(--t3)] uppercase">Role</label>
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                className="w-full mt-1 bg-[var(--s1)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]">
                <option value="TIER1">SOC Analyst L1 (TIER1)</option>
                <option value="TIER2">SOC Analyst L2 (TIER2)</option>
                <option value="INCIDENT_LEAD">Incident Lead</option>
                {(canSuper || form.role === 'ADMIN') && <option value="ADMIN">Administrator</option>}
                {(canSuper || form.role === 'SUPER_ADMIN') && <option value="SUPER_ADMIN">Super Administrator</option>}
              </select>
            </div>
            <div>
              <label className="text-[0.7rem] font-bold text-[var(--t3)] uppercase">Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as 'active' | 'disabled' })}
                disabled={isSelf}
                className="w-full mt-1 bg-[var(--s1)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)] disabled:opacity-50">
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
              {isSelf && <p className="text-[0.6rem] text-[var(--t3)] mt-1">You cannot disable your own account.</p>}
            </div>
          </div>
          <div>
            <label className="text-[0.7rem] font-bold text-[var(--t3)] uppercase">Access expires</label>
            <input type="date" value={form.access_expires_at}
              onChange={e => setForm({ ...form, access_expires_at: e.target.value })}
              className="w-full mt-1 bg-[var(--s1)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
            <p className="text-[0.6rem] text-[var(--t3)] mt-1">Leave empty for no expiry. Disabled automatically when expired.</p>
          </div>
          <label className="flex items-center gap-2 text-[0.78rem] text-[var(--t6)] cursor-pointer">
            <input type="checkbox" checked={form.must_change_password}
              onChange={e => setForm({ ...form, must_change_password: e.target.checked })} />
            <span>Require password change on next login</span>
          </label>

          {user.auth_source !== 'ldap' && (
            <div className="border-t border-[var(--b1)] pt-3">
              <button
                onClick={handleReset}
                disabled={resetting}
                className="text-[0.78rem] font-bold text-amber-700 hover:text-amber-800 hover:bg-amber-50 px-3 py-1.5 rounded border border-amber-300 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Lock size={13} /> {resetting ? 'Resetting…' : 'Reset password (generate temp)'}
              </button>
              <p className="text-[0.6rem] text-[var(--t3)] mt-1">Generates a new one-time password. The user will be required to change it on next login.</p>
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-5 pt-4 border-t border-[var(--b1)]">
          <button onClick={handleSave} disabled={saving}
            className="bg-[var(--p1)] text-white px-4 py-1.5 rounded-lg text-sm font-bold hover:bg-[var(--pd)] disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button onClick={onClose} className="border border-[var(--b2)] text-[var(--t5)] px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-[var(--s1)]">Cancel</button>
        </div>
      </div>
    </div>
  );
};

const SettingsTab = () => {
  const showToast = useToast();
  const { user, token } = useAuth();
  const { dark, toggle: toggleDark } = useDarkMode();
  const isAdmin = (ROLE_LEVEL[user?.role || ''] ?? 0) >= ROLE_LEVEL.ADMIN;
  // Only super admins may create/assign the ADMIN and SUPER_ADMIN tiers.
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  // Sub-tab navigation
  const [section, setSection] = useState<AdminSection>('users');

  // System-wide stats (drives the cards at the top)
  const [stats, setStats] = useState<{ activeIncidents: number; totalAlerts: number; automationRate: string; fpRate: string } | null>(null);

  // Users
  const [users, setUsers]              = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers]= useState(false);
  const [showCreateForm, setShowCreate]= useState(false);
  const [form, setForm]                = useState({
    username: '',
    password: '',
    password_confirm: '',
    email: '',
    role: 'TIER1',
    display_name: '',
    generate_temp_password: false,
    must_change_password: true,
  });
  const [createError, setCreateError]  = useState('');
  const [createSuccess, setCreateOk]   = useState('');
  const [tempPasswordDisplay, setTempPasswordDisplay] = useState<{ username: string; password: string } | null>(null);
  const [editingRole, setEditingRole]  = useState<Record<number, string>>({});
  const [editUserModal, setEditUserModal] = useState<any | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // System ops
  const [confirmOp, setConfirmOp] = useState<SystemOpKey | null>(null);
  const [opRunning, setOpRunning] = useState<SystemOpKey | null>(null);

  // Step-up re-auth: a generic pending action — once the user types the right
  // password, run() is called with the issued step-up token. Used by Danger
  // Zone ops, Delete User, and (further below) AI model changes.
  const [stepUp, setStepUp] = useState<{
    title: string;
    message: string;
    destructive?: boolean;
    run: (token: string) => Promise<void>;
  } | null>(null);

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

  const resetCreateForm = () => setForm({
    username: '',
    password: '',
    password_confirm: '',
    email: '',
    role: 'TIER1',
    display_name: '',
    generate_temp_password: false,
    must_change_password: true,
  });

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setCreateOk('');
    if (!form.username.trim()) { setCreateError('Username is required'); return; }
    if (!form.generate_temp_password) {
      if (!form.password) { setCreateError('Password is required'); return; }
      if (form.password !== form.password_confirm) { setCreateError('Passwords do not match'); return; }
    }
    try {
      const payload: any = {
        username: form.username.trim(),
        email: form.email.trim() || undefined,
        role: form.role,
        display_name: form.display_name.trim() || undefined,
        must_change_password: form.must_change_password,
      };
      if (form.generate_temp_password) {
        payload.generate_temp_password = true;
      } else {
        payload.password = form.password;
        payload.password_confirm = form.password_confirm;
      }
      const data = await createUser(payload);
      setUsers(prev => [...prev, data]);
      if (data.temp_password) {
        setTempPasswordDisplay({ username: data.username, password: data.temp_password });
        setCreateOk('');
      } else {
        setCreateOk(`User "${data.username}" created successfully.`);
        showToast(`User "${data.username}" created`, 'success');
      }
      resetCreateForm();
      setShowCreate(false);
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
    const target = users.find(u => u.id === uid);
    setDeleteConfirm(null);
    setStepUp({
      title: 'Confirm your password to delete user',
      message: `Deleting "${target?.username}" is permanent and will be recorded in the audit trail.`,
      destructive: true,
      run: async (stepUpToken) => {
        setStepUp(null);
        try {
          const res = await fetch(`/api/users/${uid}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}`, 'X-Step-Up-Token': stepUpToken },
          });
          const data = await res.json();
          if (!res.ok) { showToast(data.error || 'Failed to delete user', 'error'); return; }
          setUsers(prev => prev.filter(u => u.id !== uid));
          showToast('User deleted', 'success');
        } catch { showToast('Connection error', 'error'); }
      },
    });
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
    setConfirmOp(null);
    // Gate every Danger Zone action behind a password re-prompt.
    setStepUp({
      title: 'Confirm your password to proceed',
      message: `${op.confirmTitle} — this action is irreversible and will be recorded in the audit trail.`,
      destructive: true,
      run: async (stepUpToken) => {
        setOpRunning(key);
        setStepUp(null);
        try {
          const res = await fetch(op.endpoint, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'X-Step-Up-Token': stepUpToken },
          });
          const data = await res.json();
          if (!res.ok) { showToast(data.error || `${op.title} failed`, 'error'); return; }
          const count = data.deleted ?? data.reset ?? 0;
          showToast(`${op.title} — ${count} record${count !== 1 ? 's' : ''} affected`, 'success');
          loadStats();
        } catch { showToast('Connection error', 'error'); }
        finally { setOpRunning(null); }
      },
    });
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
      {editUserModal && (
        <EditUserModal
          user={editUserModal}
          isSelf={editUserModal.id === user?.id}
          onClose={() => setEditUserModal(null)}
          onSaved={(updated) => {
            setUsers(prev => prev.map(u => u.id === updated.id ? { ...u, ...updated } : u));
            setEditUserModal(null);
            showToast('User updated', 'success');
          }}
          onResetPassword={(tempPassword) => {
            setTempPasswordDisplay({ username: editUserModal.username, password: tempPassword });
            setEditUserModal(null);
            loadUsers();
          }}
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

      {stepUp && (
        <StepUpModal
          title={stepUp.title}
          message={stepUp.message}
          destructive={stepUp.destructive}
          onVerified={stepUp.run}
          onCancel={() => setStepUp(null)}
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

          {showCreateForm && (() => {
            const strength = estimatePasswordStrength(form.password);
            const strengthColors = ['#dc2626', '#f97316', '#eab308', '#22c55e', '#16a34a'];
            const mismatch = !form.generate_temp_password && form.password_confirm.length > 0 && form.password !== form.password_confirm;
            return (
              <form onSubmit={handleCreateUser} className="p-5 border-b border-[var(--b1)] bg-[var(--sa)] space-y-3">
                <p className="text-[0.72rem] text-[var(--t3)]">Password must be at least 8 chars with uppercase, lowercase, digit, and special character — or generate a one-time temporary password the user must change on first login.</p>
                {createError  && <div className="text-[#d93025] text-[0.78rem] font-semibold bg-red-50 border border-red-200 rounded px-3 py-2">{createError}</div>}
                {createSuccess && <div className="text-[#1e8e3e] text-[0.78rem] font-semibold bg-green-50 border border-green-100 rounded px-3 py-2">{createSuccess}</div>}
                <div className="grid grid-cols-2 gap-3">
                  <input required placeholder="Username" value={form.username}
                    onChange={e => setForm({...form, username: e.target.value})}
                    className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
                  <input placeholder="Display name (optional)" value={form.display_name}
                    onChange={e => setForm({...form, display_name: e.target.value})}
                    className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
                  <input placeholder="Email (optional)" value={form.email}
                    onChange={e => setForm({...form, email: e.target.value})}
                    className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
                  <select value={form.role} onChange={e => setForm({...form, role: e.target.value})}
                    className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]">
                    <option value="TIER1">SOC Analyst L1 (TIER1)</option>
                    <option value="TIER2">SOC Analyst L2 (TIER2)</option>
                    <option value="INCIDENT_LEAD">Incident Lead</option>
                    {isSuperAdmin && <option value="ADMIN">Administrator</option>}
                    {isSuperAdmin && <option value="SUPER_ADMIN">Super Administrator</option>}
                  </select>
                </div>

                <label className="flex items-center gap-2 text-[0.78rem] text-[var(--t6)] cursor-pointer">
                  <input type="checkbox" checked={form.generate_temp_password}
                    onChange={e => setForm({ ...form, generate_temp_password: e.target.checked, password: '', password_confirm: '' })} />
                  <span><b>Generate a one-time temporary password</b> — the user must change it on first login.</span>
                </label>

                {!form.generate_temp_password && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <input required type="password" placeholder="Password (min 8 chars)" value={form.password}
                          onChange={e => setForm({...form, password: e.target.value})}
                          className="w-full bg-[var(--s0)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]" />
                        {form.password && (
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
                        <input required type="password" placeholder="Repeat password" value={form.password_confirm}
                          onChange={e => setForm({...form, password_confirm: e.target.value})}
                          className={`w-full bg-[var(--s0)] border rounded-lg px-3 py-2 text-sm outline-none ${mismatch ? 'border-red-500 focus:border-red-500' : 'border-[var(--b1)] focus:border-[var(--p1)]'}`} />
                        {mismatch && <p className="text-[0.65rem] text-red-600 mt-1">Passwords do not match</p>}
                        {!mismatch && form.password_confirm && form.password === form.password_confirm && (
                          <p className="text-[0.65rem] text-green-600 mt-1">✓ Match</p>
                        )}
                      </div>
                    </div>
                  </>
                )}

                <label className="flex items-center gap-2 text-[0.78rem] text-[var(--t6)] cursor-pointer">
                  <input type="checkbox" checked={form.must_change_password}
                    disabled={form.generate_temp_password}
                    onChange={e => setForm({ ...form, must_change_password: e.target.checked })} />
                  <span>Require password change on next login {form.generate_temp_password && <span className="text-[var(--t3)]">(always on for temp passwords)</span>}</span>
                </label>

                <div className="flex gap-2">
                  <button type="submit" className="bg-[var(--p1)] text-white px-4 py-1.5 rounded-lg text-sm font-bold hover:bg-[var(--pd)]">Create User</button>
                  <button type="button" onClick={() => { resetCreateForm(); setShowCreate(false); setCreateError(''); setCreateOk(''); }} className="border border-[var(--b2)] text-[var(--t5)] px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-[var(--s1)]">Cancel</button>
                </div>
              </form>
            );
          })()}

          {tempPasswordDisplay && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-[var(--s0)] border border-amber-300 rounded-xl shadow-2xl max-w-md w-full p-6">
                <h3 className="text-[1rem] font-black text-amber-700 flex items-center gap-2"><Lock size={16} /> One-time password</h3>
                <p className="text-[0.78rem] text-[var(--t5)] mt-2">A temporary password was generated for <b>{tempPasswordDisplay.username}</b>. Copy it now — it will <b>not</b> be shown again. The user must change it on first login.</p>
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded p-3 font-mono text-[0.9rem] text-amber-900 select-all break-all">
                  {tempPasswordDisplay.password}
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => { navigator.clipboard?.writeText(tempPasswordDisplay.password); showToast('Password copied', 'success'); }}
                    className="bg-[var(--p1)] text-white px-3 py-1.5 rounded text-[0.78rem] font-bold hover:bg-[var(--pd)]"
                  >Copy</button>
                  <button
                    onClick={() => setTempPasswordDisplay(null)}
                    className="border border-[var(--b2)] text-[var(--t5)] px-3 py-1.5 rounded text-[0.78rem] font-semibold hover:bg-[var(--s1)]"
                  >Done</button>
                </div>
              </div>
            </div>
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
                            {(isSuperAdmin || currentEditRole === 'ADMIN') && <option value="ADMIN">Administrator</option>}
                            {(isSuperAdmin || currentEditRole === 'SUPER_ADMIN') && <option value="SUPER_ADMIN">Super Administrator</option>}
                          </select>
                          <button onClick={() => handleRoleChange(u.id, currentEditRole)} className="text-green-600 hover:text-green-700 p-0.5"><CheckCircle size={15} /></button>
                          <button onClick={() => setEditingRole(prev => { const n = {...prev}; delete n[u.id]; return n; })} className="text-[var(--t3)] hover:text-[var(--t6)] p-0.5"><XCircle size={15} /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                            u.role === 'SUPER_ADMIN'   ? 'bg-rose-100 text-rose-700'     :
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
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => setEditUserModal(u)} className="text-[var(--t3)] hover:text-[var(--p1)] transition-colors p-1 rounded hover:bg-[var(--s1)]" title="Edit user">
                          <Edit3 size={14} />
                        </button>
                        {!isCurrentUser && (
                          <button onClick={() => setDeleteConfirm(u.id)} className="text-[var(--t3)] hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50" title="Delete user">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
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


export { SettingsTab };
