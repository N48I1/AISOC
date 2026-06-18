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
import { TACTIC_OPTIONS } from '../lib/mitre';

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
  const isAdmin   = (ROLE_LEVEL[user?.role || ''] ?? 0) >= ROLE_LEVEL.ADMIN;

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


export { KnowledgeBaseTab };
