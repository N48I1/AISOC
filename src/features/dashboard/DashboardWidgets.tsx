import React, { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from 'react';
import { Shield, AlertTriangle, AlertOctagon, Activity, FileText, Settings, LogOut, Search, Bell, User, CheckCircle, XCircle, Clock, ChevronRight, BarChart3, Terminal, Filter, Plus, X, UserPlus, Eye, ThumbsUp, ThumbsDown, ChevronDown, BookOpen, Trash2, Send, Zap, Mail, ExternalLink, ToggleLeft, ToggleRight, RefreshCw, PanelLeftOpen, PanelLeftClose, Database, Copy, Key, Webhook, Hash, Globe, Crosshair, ListChecks, MessageSquare, Laptop, Link2, ChevronUp, Lock, Palette, MapPin, Edit3, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getAgentModelConfig, orchestrateAnalysis, runAgentPhase, updateAgentModel, getAlertRuns, saveAlertRun, getIntegrations, updateIntegration, testIntegration, getActionLogs, getReports, getReportSummary, getLocalLLMConfig, updateLocalLLMConfig, testLocalLLM, getLocalLLMModels, getAgentStats, getFpReduction, getFpOverTime, getNoisySources, getSuppressionRules, createSuppressionRule, updateSuppressionRule, deleteSuppressionRule, getAssets, upsertAsset, deleteAsset, getFpSuggestions, acceptFpSuggestion, fpScan, fpScanBatch, investigateAlert, escalateAlert, confirmFp, overrideFp, getFpArchive, getPipelineFunnel, getDetectionEffectiveness, getSourceDistribution, listApiKeys, createApiKey, revokeApiKey, updateApiKey, getInsights, getIocs, getPlaybooks, createPlaybook, updatePlaybook, deletePlaybook, listAnalysts, getIncidents, getIncident, getIncidentReasoning, reinvestigateIncident, createIncident, assignIncident, takeIncident, moveIncidentPhase, closeIncident, addIncidentNote, reclassifyIncidentFp, addIncidentAction, updateIncidentAction, deleteIncidentAction, reorderIncidentActions, updateIncident, getResponseActions, type ResponseActionRow, type ReasoningRow, testLdapConnection, getIntegration, createUser, updateUser, adminResetPassword, getAuditLogs, getAuditLogActions, auditLogsExportUrl, getFailedLogins, estimatePasswordStrength, verifyPassword, getLlmProviders, createLlmProvider, updateLlmProvider, deleteLlmProvider, testLlmProvider, type AgentModelConfig, type AgentPhase, type AgentStat, type LocalModel, type Insight, type IocRow, type Playbook, type LlmProvidersResponse, type LlmProviderRow } from '../../services/aiService';
import { INCIDENT_PHASES, PHASE_LABELS, INCIDENT_STATUS_LABELS, type Incident, type IncidentPhase, type IncidentStatus, type IncidentAction, type IncidentActionStatus } from '../../types';
import { User as UserType, Alert, AgentRun, Stats, UserRole, Integration, ActionLog, ReportRow, ReportSummary, ROLE_LABELS, ROLE_LEVEL } from '../../types';
import PageHeader from '../../components/ui/PageHeader';
import { AGENT_PHASES_UI, parseAlertAi, parseMitreTags, getPhaseData, getAlertRiskScore, getConfidenceValues, percent } from '../../features/alerts/alertUtils';
import { ToastContext, ToastContainer, useToast, type ToastItem } from '../../lib/toast';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';
import { ConfirmModal } from '../../components/ConfirmModal';
import { severityChipColor, timeAgo } from '../../lib/format';
import { AlertRow, MiniBar, RiskGauge, ConfidenceDonut, GlobalRiskDonut, PipelineRiskTimeSeries } from '../alerts/AlertWorkspace';
import { StatCard } from '../../components/layout/StatCard';

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
                  <span className={`w-2 h-8 rounded-full ${alert.severity >= 12 ? 'bg-red-500' : alert.severity >= 10 ? 'bg-orange-500' : alert.severity >= 7 ? 'bg-amber-500' : 'bg-green-500'}`} />
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

// ─── LDAP / AD Section (replaces former Firewall section in Integrations) ─────

export { SkeletonVal, NoiseReductionDashboard, ResearchOverview, Dashboard };
