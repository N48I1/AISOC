import React, { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from 'react';
import { Shield, AlertTriangle, AlertOctagon, Activity, FileText, Settings, LogOut, Search, Bell, User, CheckCircle, XCircle, Clock, ChevronRight, BarChart3, Terminal, Filter, Plus, X, UserPlus, Eye, ThumbsUp, ThumbsDown, ChevronDown, BookOpen, Trash2, Send, Zap, Mail, ExternalLink, ToggleLeft, ToggleRight, RefreshCw, PanelLeftOpen, PanelLeftClose, Database, Copy, Key, Webhook, Hash, Globe, Crosshair, ListChecks, MessageSquare, Laptop, Link2, ChevronUp, Lock, Palette, MapPin, Edit3, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getAgentModelConfig, orchestrateAnalysis, runAgentPhase, updateAgentModel, getAlertRuns, saveAlertRun, getIntegrations, updateIntegration, testIntegration, getActionLogs, getReports, getReportSummary, getLocalLLMConfig, updateLocalLLMConfig, testLocalLLM, getLocalLLMModels, getAgentStats, getFpReduction, getFpOverTime, getNoisySources, getSuppressionRules, createSuppressionRule, updateSuppressionRule, deleteSuppressionRule, getAssets, upsertAsset, deleteAsset, getFpSuggestions, acceptFpSuggestion, fpScan, fpScanBatch, investigateAlert, escalateAlert, confirmFp, overrideFp, getFpArchive, getPipelineFunnel, getDetectionEffectiveness, getSourceDistribution, listApiKeys, createApiKey, revokeApiKey, updateApiKey, getInsights, getIocs, getPlaybooks, createPlaybook, updatePlaybook, deletePlaybook, listAnalysts, getIncidents, getIncident, getIncidentReasoning, reinvestigateIncident, createIncident, assignIncident, takeIncident, moveIncidentPhase, closeIncident, addIncidentNote, reclassifyIncidentFp, addIncidentAction, updateIncidentAction, deleteIncidentAction, reorderIncidentActions, updateIncident, getResponseActions, type ResponseActionRow, type ReasoningRow, testLdapConnection, getIntegration, createUser, updateUser, adminResetPassword, getAuditLogs, getAuditLogActions, auditLogsExportUrl, getFailedLogins, estimatePasswordStrength, verifyPassword, getLlmProviders, createLlmProvider, updateLlmProvider, deleteLlmProvider, testLlmProvider, type AgentModelConfig, type AgentPhase, type AgentStat, type LocalModel, type Insight, type IocRow, type Playbook, type LlmProvidersResponse, type LlmProviderRow } from '../services/aiService';
import { INCIDENT_PHASES, PHASE_LABELS, INCIDENT_STATUS_LABELS, type Incident, type IncidentPhase, type IncidentStatus, type IncidentAction, type IncidentActionStatus } from '../types';
import { User as UserType, Alert, AgentRun, Stats, UserRole, Integration, ActionLog, ReportRow, ReportSummary, ROLE_LABELS, ROLE_LEVEL } from '../types';
import PageHeader from '../components/ui/PageHeader';
import { PeriodFilter, PERIOD_OPTIONS } from '../components/PeriodFilter';
import { AGENT_PHASES_UI, parseAlertAi, parseMitreTags, getPhaseData, getAlertRiskScore, getConfidenceValues, percent } from '../features/alerts/alertUtils';
import { ToastContext, ToastContainer, useToast, type ToastItem } from '../lib/toast';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { ConfirmModal } from '../components/ConfirmModal';
import { severityChipColor, timeAgo } from '../lib/format';
import { ConfidenceDonut } from '../features/alerts/AlertWorkspace';

const FpArchiveTab = () => {
  const toast = useToast();
  const { user, token } = useAuth();
  const isAdmin = (ROLE_LEVEL[user?.role || ''] ?? 0) >= ROLE_LEVEL.ADMIN;
  const [data, setData] = useState<{ alerts: any[]; total: number }>({ alerts: [], total: 0 });
  const [page, setPage] = useState(1);
  const [methodFilter, setMethodFilter] = useState('');
  const [period, setPeriod] = useState('all');
  const [effectiveness, setEffectiveness] = useState<any>(null);
  const [fpTimeline, setFpTimeline] = useState<any[]>([]);
  const [noisySources, setNoisySources] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const reload = useCallback(() => {
    getFpArchive({ page, pageSize: 25, method: methodFilter || undefined, period }).then(setData).catch(() => {});
    getDetectionEffectiveness(period).then(setEffectiveness).catch(() => {});
    getFpOverTime(period).then(setFpTimeline).catch(() => {});
    getNoisySources().then(setNoisySources).catch(() => {});
  }, [page, methodFilter, period]);
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
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader eyebrow="History" title="False Positive Archive" description="Browse all detected false positives with reasoning, analytics, and audit trail." />
        <div className="flex items-center gap-2 shrink-0 pt-1">
          <span className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest">Period</span>
          <PeriodFilter value={period} onChange={(v) => { setPeriod(v); setPage(1); }} />
        </div>
      </div>

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

export { FpArchiveTab };
