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
import { DetailedReport } from '../features/alerts/AlertWorkspace';
import { PriorityDonut } from '../components/PriorityDonut';

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

// Blocks the entire app until the user changes a temporary/admin-reset password.
// Mounted between LoginPage and the main app shell when user.must_change_password is true.

export { ReportsTab };
