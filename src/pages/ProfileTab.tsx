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


export { ProfileTab };
