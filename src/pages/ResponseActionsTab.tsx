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
import { PriorityDonut, tierFor } from '../components/PriorityDonut';

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



type ResponseActionStatus = 'pending' | 'approved' | 'executed' | 'failed' | 'skipped';

const ACTION_STATUS_META: Record<ResponseActionStatus, { label: string; chip: string }> = {
  pending:  { label: 'Pending',  chip: 'bg-amber-50 text-amber-800 border-amber-300' },
  approved: { label: 'Approved', chip: 'bg-blue-50 text-blue-800 border-blue-300' },
  executed: { label: 'Executed', chip: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  failed:   { label: 'Failed',   chip: 'bg-red-50 text-red-800 border-red-300' },
  skipped:  { label: 'Skipped',  chip: 'bg-[var(--s1)] text-[var(--t3)] border-[var(--b2)]' },
};

const incSeverityScore = (s: string | null): number =>
  s === 'CRITICAL' ? 100 : s === 'HIGH' ? 80 : s === 'MEDIUM' ? 55 : s === 'LOW' ? 30 : 40;

const actionPriorityScore = (p: string | null | undefined): number => {
  const v = (p || '').toUpperCase();
  return v === 'CRITICAL' ? 100 : v === 'HIGH' ? 80 : v === 'MEDIUM' ? 55 : v === 'LOW' ? 30 : 0;
};

type ActionPriorityBreakdown = { score: number; threat: number; reach: number; urgency: number };

const ResponseActionsTab = ({
  setActiveTab,
  setSelectedIncidentId,
}: {
  setActiveTab: (t: string) => void;
  setSelectedIncidentId: (id: string | null) => void;
}) => {
  const [rows, setRows]                 = useState<ResponseActionRow[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [activeCats, setActiveCats]     = useState<Set<ActionCategory>>(new Set());
  const [activeTypes, setActiveTypes]   = useState<Set<string>>(new Set());
  const [activeSevs, setActiveSevs]     = useState<Set<string>>(new Set());
  const [activeStatuses, setActiveStatuses] = useState<Set<ResponseActionStatus>>(new Set());
  const [sortBy, setSortBy]             = useState<'priority' | 'count' | 'latest' | 'threat'>('priority');
  const [showDone, setShowDone]         = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    getResponseActions().then(d => setRows(d.actions || [])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  type Entry = {
    actionId: number;
    status: ResponseActionStatus;
    incidentId: string;
    incidentTitle: string | null;
    incidentSeverity: string | null;
    incidentStatus: string | null;
    incidentPhase: string | null;
    timestamp: number;
    actionPriority: string | null;
  };

  type ActionGroup = {
    key: string;
    type: string;
    target: string;
    category: ActionCategory;
    entries: Entry[];
    distinctIncidents: number;
    statusCounts: Record<ResponseActionStatus, number>;
    severityCounts: Record<string, number>;
    latestTimestamp: number;
    priority: ActionPriorityBreakdown;
    isAllDone: boolean;
  };

  // Each card represents one (action_type, target) pair across all incidents.
  const groups: ActionGroup[] = React.useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const a of rows) {
      const key = `${a.action_type}::${(a.target || '').trim() || '__no_target__'}`;
      const e: Entry = {
        actionId:         a.id,
        status:           (a.status as ResponseActionStatus) || 'pending',
        incidentId:       a.incident_id,
        incidentTitle:    a.incident_title,
        incidentSeverity: a.incident_severity,
        incidentStatus:   a.incident_status,
        incidentPhase:    a.incident_phase,
        timestamp:        new Date(a.created_at).getTime(),
        actionPriority:   a.priority,
      };
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }

    const out: ActionGroup[] = [];
    for (const [key, entries] of map.entries()) {
      const [type, targetRaw] = key.split('::');
      const target = targetRaw === '__no_target__' ? '' : targetRaw;

      const statusCounts: Record<ResponseActionStatus, number> = { pending:0, approved:0, executed:0, failed:0, skipped:0 };
      const severityCounts: Record<string, number> = {};
      const incSet = new Set<string>();
      let latest = 0;
      for (const e of entries) {
        statusCounts[e.status]++;
        if (e.incidentSeverity) severityCounts[e.incidentSeverity] = (severityCounts[e.incidentSeverity] || 0) + 1;
        incSet.add(e.incidentId);
        if (e.timestamp > latest) latest = e.timestamp;
      }

      // Priority — weigh only entries that still need work; fall back to all entries if none.
      const live = entries.filter(e => e.status === 'pending' || e.status === 'approved' || e.status === 'failed');
      const sample = live.length ? live : entries;

      const threat = Math.min(100, Math.max(...sample.map(e =>
        Math.max(incSeverityScore(e.incidentSeverity), actionPriorityScore(e.actionPriority))
      )));
      const reach  = Math.min(100, incSet.size * 25);
      const newest = Math.max(...sample.map(e => e.timestamp));
      const ageH   = (Date.now() - newest) / 3_600_000;
      let urgency  = ageH < 1 ? 100 : ageH < 6 ? 75 : ageH < 24 ? 55 : ageH < 168 ? 35 : 15;
      if (statusCounts.pending > 0) urgency = Math.min(100, urgency + 10);
      if (statusCounts.failed > 0)  urgency = Math.min(100, urgency + 15);
      const score = Math.round(threat * 0.6 + reach * 0.25 + urgency * 0.15);

      out.push({
        key, type, target,
        category: categorize(type),
        entries,
        distinctIncidents: incSet.size,
        statusCounts,
        severityCounts,
        latestTimestamp: latest,
        priority: { score, threat, reach, urgency },
        isAllDone: entries.every(e => e.status === 'executed' || e.status === 'skipped'),
      });
    }
    return out;
  }, [rows]);

  const availableTypes = React.useMemo(
    () => Array.from(new Set(groups.map(g => g.type))).sort(),
    [groups],
  );

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .filter(g => {
        if (!showDone && g.isAllDone) return false;
        if (activeCats.size  > 0 && !activeCats.has(g.category)) return false;
        if (activeTypes.size > 0 && !activeTypes.has(g.type))    return false;
        if (activeSevs.size  > 0 && !g.entries.some(e => e.incidentSeverity && activeSevs.has(e.incidentSeverity))) return false;
        if (activeStatuses.size > 0 && !g.entries.some(e => activeStatuses.has(e.status))) return false;
        if (q) {
          const inType   = g.type.toLowerCase().includes(q);
          const inTarget = g.target.toLowerCase().includes(q);
          const inInc    = g.entries.some(e => e.incidentId.toLowerCase().includes(q) || (e.incidentTitle || '').toLowerCase().includes(q));
          if (!inType && !inTarget && !inInc) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'count')  return b.distinctIncidents - a.distinctIncidents;
        if (sortBy === 'latest') return b.latestTimestamp - a.latestTimestamp;
        if (sortBy === 'threat') return b.priority.threat - a.priority.threat;
        return b.priority.score - a.priority.score;
      });
  }, [groups, activeCats, activeTypes, activeSevs, activeStatuses, search, sortBy, showDone]);

  const stats = React.useMemo(() => {
    const liveGroups = groups.filter(g => !g.isAllDone);
    return {
      items:    liveGroups.length,
      total:    rows.length,
      critical: liveGroups.filter(g => g.priority.score >= 80).length,
      pending:  rows.filter(r => r.status === 'pending').length,
    };
  }, [rows, groups]);

  const toggleSet = <T,>(set: Set<T>, val: T): Set<T> => {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    return next;
  };

  const filtersActive =
    activeCats.size > 0 || activeTypes.size > 0 || activeSevs.size > 0 ||
    activeStatuses.size > 0 || !!search || showDone;

  const openIncident = (id: string) => {
    setSelectedIncidentId(id);
    setActiveTab('incidents');
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-16 text-center h-full">
        <div>
          <RefreshCw size={28} className="mx-auto text-[var(--t3)] mb-3 animate-spin" />
          <p className="text-[var(--t3)] text-sm font-semibold">Loading response actions…</p>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-16 text-center h-full">
        <div>
          <Shield size={40} className="mx-auto text-[var(--t3)] mb-4 opacity-30" />
          <p className="text-[var(--t3)] text-sm font-semibold">No response actions yet</p>
          <p className="text-[var(--t4)] text-xs mt-1">Escalate an alert to create an incident — its action plan will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-[var(--t1)]">Response Actions</h2>
            <p className="text-[0.75rem] text-[var(--t3)] mt-1">
              One card per <span className="font-mono text-[var(--t5)]">action × target</span>, ranked so the highest-impact work is first. Priority blends incident severity, reach, and urgency.
            </p>
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 text-[0.7rem] font-bold px-2.5 py-1.5 rounded-lg border border-[var(--b2)] bg-[var(--s0)] text-[var(--t4)] hover:bg-[var(--s1)]"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Action Items',  value: stats.items,    icon: Zap,         tone: 'text-[var(--t1)]' },
            { label: 'Total Actions', value: stats.total,    icon: ListChecks,  tone: 'text-[var(--t1)]' },
            { label: 'Critical',      value: stats.critical, icon: Shield,      tone: 'text-red-600' },
            { label: 'Pending',       value: stats.pending,  icon: Clock,       tone: 'text-amber-600' },
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
                placeholder="Search action type, target, or incident…"
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
              <option value="count">Sort: Most incidents</option>
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

            <span className="ml-3 text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Status:</span>
            {(Object.keys(ACTION_STATUS_META) as ResponseActionStatus[]).map(s => {
              const m = ACTION_STATUS_META[s];
              const isActive = activeStatuses.has(s);
              return (
                <button
                  key={s}
                  onClick={() => setActiveStatuses(toggleSet(activeStatuses, s))}
                  className={`px-2 py-0.5 rounded-full border text-[0.62rem] font-black uppercase tracking-wider transition-all ${isActive ? `${m.chip} ring-2 ring-offset-0 ring-current` : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
                >
                  {m.label}
                </button>
              );
            })}

            <button
              onClick={() => setShowDone(!showDone)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[0.62rem] font-bold transition-all ${showDone ? 'bg-emerald-50 text-emerald-700 border-emerald-300 ring-2 ring-offset-0 ring-emerald-200' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
            >
              <CheckCircle size={10} /> {showDone ? 'Showing done' : 'Hide done'}
            </button>
            {filtersActive && (
              <button
                onClick={() => { setActiveCats(new Set()); setActiveTypes(new Set()); setActiveSevs(new Set()); setActiveStatuses(new Set()); setSearch(''); setShowDone(false); }}
                className="ml-auto text-[0.62rem] font-bold text-[var(--p1)] hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="text-[0.65rem] font-bold text-[var(--t3)]">
          Showing <span className="text-[var(--t1)]">{filtered.length}</span> of <span className="text-[var(--t1)]">{groups.length}</span> action item{groups.length !== 1 ? 's' : ''}
        </div>

        {/* Ranked action cards */}
        {filtered.length === 0 ? (
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-10 text-center">
            <Filter size={28} className="mx-auto text-[var(--t3)] mb-2 opacity-40" />
            <p className="text-[0.78rem] font-semibold text-[var(--t3)]">No actions match your filters.</p>
          </div>
        ) : (
          filtered.map((g, rank) => {
            const cat   = ACTION_CATEGORIES[g.category];
            const Icon  = cat.icon;
            const tier  = tierFor(g.priority.score);

            return (
              <div key={g.key} className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 space-y-3">
                  {/* Top row: rank, category icon, type, target, priority */}
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
                          {g.type.replace(/_/g, ' ')}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[0.55rem] font-black uppercase tracking-wider ${cat.bg} ${cat.tint}`}>
                          {cat.label}
                        </span>
                        {g.isAllDone && (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[0.55rem] font-black uppercase tracking-wider">
                            <CheckCircle size={9} /> All done
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[0.85rem] font-bold text-[var(--t7)] truncate" title={g.target || 'no target specified'}>
                        {g.target || <span className="italic text-[var(--t3)] font-sans font-normal text-[0.75rem]">no target specified</span>}
                      </div>
                      <div className="flex items-center gap-3 text-[0.62rem] text-[var(--t4)] font-medium mt-1">
                        <span><span className="font-mono font-bold text-[var(--t6)]">{g.distinctIncidents}</span> incident{g.distinctIncidents !== 1 ? 's' : ''}</span>
                        <span className="text-[var(--t3)]">·</span>
                        <span><span className="font-mono font-bold text-[var(--t6)]">{g.entries.length}</span> action{g.entries.length !== 1 ? 's' : ''}</span>
                        <span className="text-[var(--t3)]">·</span>
                        <span className="flex items-center gap-1"><Clock size={9} /> Latest {timeAgo(g.latestTimestamp)}</span>
                      </div>
                    </div>

                    {/* Priority tier + donut */}
                    <div className="text-right shrink-0 space-y-2">
                      <div className="flex items-center justify-end gap-2">
                        <span className={`px-1.5 py-0.5 rounded border text-[0.55rem] font-black uppercase tracking-wider ${tier.bg} ${tier.text} ${tier.border}`}>
                          {tier.label}
                        </span>
                        <PriorityDonut value={g.priority.score} size={40} />
                      </div>
                    </div>
                  </div>

                  {/* Severity + status distribution */}
                  <div className="flex items-center gap-1.5 flex-wrap pl-[3.75rem]">
                    {(['CRITICAL','HIGH','MEDIUM','LOW'] as const).filter(sv => g.severityCounts[sv]).map(sv => (
                      <span key={sv} className={`px-1.5 py-0.5 rounded text-[0.55rem] font-black uppercase tracking-wider ${severityChipColor(sv)} pointer-events-none`}>
                        {g.severityCounts[sv]} {sv}
                      </span>
                    ))}
                    <span className="text-[var(--t3)] text-[0.55rem] px-1">|</span>
                    {(Object.keys(ACTION_STATUS_META) as ResponseActionStatus[]).filter(s => g.statusCounts[s]).map(s => (
                      <span key={s} className={`px-1.5 py-0.5 rounded border text-[0.55rem] font-black uppercase tracking-wider ${ACTION_STATUS_META[s].chip}`}>
                        {g.statusCounts[s]} {ACTION_STATUS_META[s].label}
                      </span>
                    ))}
                  </div>

                  {/* Incident chips + urgency bar */}
                  <div className="flex items-end justify-between gap-6 pl-[3.75rem]">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Incidents:</span>
                      {g.entries.slice(0, 16).map(e => (
                        <button
                          key={e.actionId}
                          onClick={() => openIncident(e.incidentId)}
                          className={`font-mono text-[0.6rem] font-bold px-1.5 py-0.5 rounded transition-colors ${severityChipColor(e.incidentSeverity || 'LOW')} ${e.status === 'executed' || e.status === 'skipped' ? 'opacity-60' : ''}`}
                          title={`${e.incidentTitle || e.incidentId} — ${e.incidentSeverity || '?'} · ${e.status} · ${timeAgo(e.timestamp)}`}
                        >
                          {e.incidentId}
                        </button>
                      ))}
                      {g.entries.length > 16 && (
                        <span className="text-[0.58rem] text-[var(--t3)]">+{g.entries.length - 16} more</span>
                      )}
                    </div>

                    <div className="shrink-0 w-32 space-y-1 pb-0.5" title="Urgency = recency of latest action + pending/failed pressure">
                      <div className="flex items-center justify-between text-[0.55rem]">
                        <span className="font-black uppercase tracking-widest text-[var(--t3)]">Urgency</span>
                        <span className="font-mono font-bold text-[var(--t6)] tabular-nums">{g.priority.urgency}%</span>
                      </div>
                      <div className="relative h-1 w-full rounded-full overflow-hidden bg-[var(--s1)]">
                        <div
                          className="absolute inset-0"
                          style={{ background: 'linear-gradient(to right, #10b981, #84cc16, #facc15, #f97316, #ef4444)' }}
                        />
                        <div
                          className="absolute inset-y-0 right-0 bg-[var(--s1)] transition-[width] duration-500"
                          style={{ width: `${100 - g.priority.urgency}%` }}
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

export { ResponseActionsTab };
