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
import { NoiseReductionDashboard, ResearchOverview } from '../features/dashboard/DashboardWidgets';

const NoiseFilterTab = ({ alerts, setActiveTab, autoFilter, setAutoFilter }: { alerts: Alert[]; setActiveTab: (t: string) => void; autoFilter: boolean; setAutoFilter: (v: boolean) => void }) => {
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [fpResults, setFpResults] = useState<any[]>([]);
  const [fpData, setFpData] = useState<any>(null);
  const [rules, setRules] = useState<any[]>([]);
  const [assets, setAssetsState] = useState<any[]>([]);
  const [showAddRule, setShowAddRule] = useState(false);
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [newRule, setNewRule] = useState({ name: '', reason: '', source_ip_pattern: '', description_pattern: '', max_severity: 15 });
  const [newAsset, setNewAsset] = useState({ value: '', type: 'ip', role: 'scanner', description: '', fp_default: true });
  const [activeSection, setActiveSection] = useState<'filter' | 'rules' | 'assets'>('filter');

  const unscanned = alerts.filter(a => a.status === 'NEW');
  const recentFp = alerts.filter(a => a.status === 'FALSE_POSITIVE' || a.status === 'FP_CONFIRMED').slice(0, 20);
  const [unscannedSearch, setUnscannedSearch] = useState('');
  const [unscannedSevs, setUnscannedSevs] = useState<Set<'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'>>(new Set());

  const reload = useCallback(() => {
    getFpReduction().then(d => d && setFpData(d)).catch(() => {});
    getSuppressionRules().then(setRules).catch(() => {});
    getAssets().then(setAssetsState).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const handleScanAll = async () => {
    setScanning(true);
    try {
      const result: any = await fpScanBatch();
      const fps  = (result.results || []).filter((r: any) => r.status === 'FALSE_POSITIVE');
      const incs = (result.results || []).filter((r: any) => r.status === 'TRIAGED' || r.status === 'ESCALATED');
      setFpResults(fps);
      toast(`Scanned ${result.scanned}: ${fps.length} → FP archive · ${incs.length} → Investigation`, 'success');
    } catch { toast('Batch scan failed', 'error'); }
    setScanning(false);
  };

  const handleScanOne = async (alertId: string) => {
    setScanningId(alertId);
    try {
      const result = await fpScan(alertId);
      if (result.is_fp) {
        setFpResults(prev => [...prev, { id: alertId, ...result }]);
        toast(`FP detected: ${result.fp_reason?.slice(0, 60)}`, 'success');
      } else {
        toast('Not FP — moved to Incidents queue', 'success');
      }
    } catch { toast('Scan failed', 'error'); }
    setScanningId(null);
  };

  const handleConfirmFp = async (alertId: string) => {
    await confirmFp(alertId);
    setFpResults(prev => prev.filter(r => r.id !== alertId));
    toast('FP confirmed', 'success');
  };

  const handleOverrideFp = async (alertId: string) => {
    await overrideFp(alertId);
    setFpResults(prev => prev.filter(r => r.id !== alertId));
    toast('Sent to Incidents queue', 'success');
  };

  const handleCreateRule = async () => {
    if (!newRule.name || !newRule.reason) return;
    await createSuppressionRule({ ...newRule, max_severity: newRule.max_severity });
    setNewRule({ name: '', reason: '', source_ip_pattern: '', description_pattern: '', max_severity: 15 });
    setShowAddRule(false); toast('Rule created', 'success'); reload();
  };

  const handleAddAsset = async () => {
    if (!newAsset.value) return;
    await upsertAsset(newAsset);
    setNewAsset({ value: '', type: 'ip', role: 'scanner', description: '', fp_default: true });
    setShowAddAsset(false); toast('Asset registered', 'success'); reload();
  };

  const fpMethodBadge = (method: string | null) => {
    const styles: Record<string, string> = {
      suppression: 'bg-blue-100 text-blue-800',
      memory: 'bg-green-100 text-green-800',
      triage: 'bg-purple-100 text-purple-800',
    };
    return method ? <span className={`px-2 py-0.5 rounded-full text-[0.58rem] font-black uppercase ${styles[method] || 'bg-gray-100 text-gray-700'}`}>{method}</span> : null;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 overflow-y-auto h-full">
      <PageHeader eyebrow="Pipeline Step 1" title="Noise Filter" description="Scan incoming alerts. Confirmed FPs are archived; real incidents (HIGH/CRITICAL) advance to the Incidents tab and trigger Telegram." />

      {/* Auto-Filter Toggle */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${autoFilter ? 'bg-green-100' : 'bg-gray-100'}`}>
            <Zap size={20} className={autoFilter ? 'text-green-600' : 'text-gray-400'} />
          </div>
          <div>
            <p className="text-[0.82rem] font-black text-[var(--t7)]">Auto-Investigate on Arrival</p>
            <p className="text-[0.65rem] text-[var(--t3)]">
              {autoFilter
                ? 'Enabled — incoming Wazuh alerts run the full agent pipeline. FPs go to archive, real incidents fire Telegram/email/Slack.'
                : 'Disabled — new alerts sit in NEW status until you investigate manually.'}
            </p>
          </div>
        </div>
        <button onClick={() => { setAutoFilter(!autoFilter); toast(autoFilter ? 'Auto-investigate disabled' : 'Auto-investigate enabled — new alerts will run the full pipeline', 'success'); }}
          className={`relative w-14 h-7 rounded-full transition-colors ${autoFilter ? 'bg-green-500' : 'bg-gray-300'}`}>
          <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${autoFilter ? 'translate-x-7' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {/* Data-governance advisory — NIST 800-53 AC-4 (info-flow) / SC-7 (boundary) & AI RMF.
          Auto-investigation auto-sends alert data to the LLM and can auto-archive FPs pre-review. */}
      <div className="bg-amber-50/70 border border-amber-300/60 rounded-xl p-3 flex items-start gap-2.5">
        <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
        <p className="text-[0.68rem] leading-relaxed text-[var(--t5)]">
          <span className="font-bold text-amber-700">Compliance note.</span> While enabled, every incoming
          alert is sent automatically to the configured LLM provider. With a <span className="font-semibold">cloud
          provider</span>, alert content (IPs, hostnames, usernames, log excerpts) leaves your network on each
          alert — use a <span className="font-semibold">local Ollama</span> model (Settings → AI Models) for
          air-gapped, data-resident operation. Alerts may also be <span className="font-semibold">auto-classified
          as false positives and archived before an analyst reviews them</span> (auditable and reversible in the
          FP Archive). Response actions are <span className="font-semibold">never</span> auto-executed.
        </p>
      </div>

      {/* Stats */}
      {fpData && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total FPs', value: fpData.total_fp, color: '#f29900' },
            { label: 'Suppression', value: fpData.suppression_driven_fp, color: '#1a73e8' },
            { label: 'Memory-Driven', value: fpData.memory_driven_fp, color: '#1e8e3e' },
            { label: 'Time Saved', value: `${fpData.time_saved_minutes}m`, color: '#7c3aed' },
          ].map(c => (
            <div key={c.label} className="bg-[var(--s0)] border border-[var(--b1)] rounded-lg p-3">
              <p className="text-[0.58rem] font-black text-[var(--t3)] uppercase tracking-widest">{c.label}</p>
              <p className="text-[1.4rem] font-black mt-1" style={{ color: c.color }}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Section Tabs */}
      <div className="flex gap-2">
        {[
          { id: 'filter' as const, label: `Scan & Filter (${unscanned.length} new)` },
          { id: 'rules' as const, label: `Suppression Rules (${rules.length})` },
          { id: 'assets' as const, label: `Known Assets (${assets.length})` },
        ].map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`px-4 py-2 rounded-lg text-[0.75rem] font-bold transition-colors ${activeSection === s.id ? 'bg-[var(--p1)] text-white' : 'bg-[var(--s0)] text-[var(--t4)] border border-[var(--b2)] hover:bg-[var(--s1)]'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Filter Section ──────────────────────────────────────────────── */}
      {activeSection === 'filter' && (
        <div className="grid grid-cols-2 gap-5">
          {/* Left: Unscanned */}
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
              <p className="text-[0.78rem] font-black text-[var(--t7)]">Unscanned Alerts ({unscanned.length})</p>
              <button onClick={handleScanAll} disabled={scanning || unscanned.length === 0}
                className="px-3 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.68rem] font-bold hover:bg-[var(--pd)] disabled:opacity-50 flex items-center gap-1.5">
                <Zap size={12} />{scanning ? 'Scanning...' : 'Scan All'}
              </button>
            </div>

            {/* Filter bar — search + severity chips */}
            <div className="px-3 py-2.5 border-b border-[var(--b1)] bg-[var(--s0)] space-y-2.5">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--t3)]" />
                <input
                  type="text"
                  placeholder="Search description, IP, agent, or alert ID…"
                  value={unscannedSearch}
                  onChange={e => setUnscannedSearch(e.target.value)}
                  className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-[var(--b2)] bg-[var(--s1)] text-[0.75rem] text-[var(--t1)] placeholder:text-[var(--t3)] focus:outline-none focus:border-[var(--p1)]"
                />
                {unscannedSearch && (
                  <button onClick={() => setUnscannedSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--t3)] hover:text-[var(--t1)]">
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Severity:</span>
                {(['CRITICAL','HIGH','MEDIUM','LOW'] as const).map(sv => {
                  const isActive = unscannedSevs.has(sv);
                  return (
                    <button
                      key={sv}
                      onClick={() => setUnscannedSevs(prev => {
                        const next = new Set(prev);
                        next.has(sv) ? next.delete(sv) : next.add(sv);
                        return next;
                      })}
                      className={`px-2 py-0.5 rounded-full border text-[0.62rem] font-black uppercase tracking-wider transition-all ${isActive ? severityChipColor(sv) + ' ring-2 ring-offset-0 ring-current' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
                    >
                      {sv}
                    </button>
                  );
                })}
                {(unscannedSearch || unscannedSevs.size > 0) && (
                  <button
                    onClick={() => { setUnscannedSearch(''); setUnscannedSevs(new Set()); }}
                    className="ml-auto text-[0.62rem] font-bold text-[var(--p1)] hover:underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 max-h-[480px] overflow-y-auto divide-y divide-[var(--b1)]">
              {(() => {
                const q = unscannedSearch.toLowerCase();
                const sevOf = (s: number) =>
                  s >= 12 ? 'CRITICAL' : s >= 10 ? 'HIGH' : s >= 7 ? 'MEDIUM' : 'LOW';
                const filtered = unscanned.filter(a => {
                  const matchesText = !q ||
                    a.description?.toLowerCase().includes(q) ||
                    a.source_ip?.toLowerCase().includes(q) ||
                    a.agent_name?.toLowerCase().includes(q) ||
                    a.id?.toLowerCase().includes(q);
                  const matchesSev = unscannedSevs.size === 0 || unscannedSevs.has(sevOf(a.severity) as any);
                  return matchesText && matchesSev;
                });
                if (unscanned.length === 0) return (
                  <div className="p-8 text-center text-[var(--t3)] text-[0.78rem]">No unscanned alerts. All clear.</div>
                );
                if (filtered.length === 0) return (
                  <div className="p-6 text-center text-[var(--t3)] text-[0.78rem]">No alerts match the current filters.</div>
                );
                return filtered.map(a => (
                  <div key={a.id} className="px-4 py-3 flex items-center gap-3 hover:bg-[var(--sa)] group">
                    <span className={`w-1.5 h-8 rounded-full shrink-0 ${a.severity >= 12 ? 'bg-red-500' : a.severity >= 10 ? 'bg-orange-400' : a.severity >= 7 ? 'bg-yellow-400' : 'bg-blue-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[0.75rem] font-semibold text-[var(--t7)] truncate">{a.description}</p>
                      <p className="text-[0.6rem] text-[var(--t3)] font-mono">{a.source_ip} · {a.agent_name} · sev {a.severity}</p>
                    </div>
                    <button onClick={() => handleScanOne(a.id)} disabled={scanningId === a.id}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.62rem] font-bold hover:bg-[var(--pd)] disabled:opacity-50 flex items-center gap-1 transition-colors">
                      {scanningId === a.id
                        ? <><div className="w-2.5 h-2.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />Scanning</>
                        : <><Zap size={10} />Scan</>}
                    </button>
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* Right: FP Verdicts */}
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b bg-[var(--s1)]">
              <p className="text-[0.78rem] font-black text-[var(--t7)]">FP Verdicts ({fpResults.length + recentFp.length})</p>
            </div>
            <div className="max-h-[420px] overflow-y-auto divide-y divide-[var(--b1)]">
              {fpResults.length === 0 && recentFp.length === 0 ? (
                <div className="p-8 text-center text-[var(--t3)] text-[0.78rem]">Run a scan to see FP verdicts here.</div>
              ) : (
                <>
                  {fpResults.map(r => (
                    <div key={r.id} className="px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2">
                        {fpMethodBadge(r.fp_method)}
                        <span className="text-[0.65rem] font-bold text-[var(--t7)]">{r.fp_confidence ? `${(r.fp_confidence * 100).toFixed(0)}% confidence` : ''}</span>
                      </div>
                      <p className="text-[0.72rem] text-[var(--t7)]">{r.fp_reason || 'False positive detected'}</p>
                      {r.fp_details && (
                        <div className="text-[0.6rem] text-[var(--t3)] bg-[var(--sa)] rounded p-2">
                          {r.fp_details.rule_name && <span>Rule: {r.fp_details.rule_name}</span>}
                          {r.fp_details.known_asset && <span>Asset: {r.fp_details.known_asset.value} ({r.fp_details.known_asset.role})</span>}
                          {r.fp_details.similar_incident && <span>Similar: {(r.fp_details.similar_incident.similarity * 100).toFixed(0)}% match</span>}
                          {r.fp_details.ioc_pattern && <span>IOC: {r.fp_details.ioc_pattern.value} (fp_ratio={r.fp_details.ioc_pattern.fp_ratio})</span>}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => handleConfirmFp(r.id)} className="px-3 py-1 rounded bg-green-100 text-green-800 text-[0.62rem] font-bold hover:bg-green-200">Confirm FP</button>
                        <button onClick={() => handleOverrideFp(r.id)} className="px-3 py-1 rounded bg-amber-100 text-amber-800 text-[0.62rem] font-bold hover:bg-amber-200">Override → Investigate</button>
                      </div>
                    </div>
                  ))}
                  {recentFp.map(a => (
                    <div key={a.id} className="px-4 py-2.5 flex items-center gap-3 opacity-70">
                      <XCircle size={14} className="text-amber-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[0.7rem] text-[var(--t6)] truncate">{a.description}</p>
                        <p className="text-[0.58rem] text-[var(--t3)] font-mono">{a.source_ip} · {a.status}</p>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Suppression Rules ───────────────────────────────────────────── */}
      {activeSection === 'rules' && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
            <p className="text-[0.78rem] font-black text-[var(--t7)]">Suppression Rules</p>
            <button onClick={() => setShowAddRule(!showAddRule)} className="px-3 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.68rem] font-bold hover:bg-[var(--pd)] flex items-center gap-1"><Plus size={12} />Add Rule</button>
          </div>
          {showAddRule && (
            <div className="p-4 bg-[var(--sa)] border-b border-[var(--b1)] grid grid-cols-2 gap-3">
              <input placeholder="Rule name" value={newRule.name} onChange={e => setNewRule(r => ({ ...r, name: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]" />
              <input placeholder="Reason" value={newRule.reason} onChange={e => setNewRule(r => ({ ...r, reason: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]" />
              <input placeholder="Source IP / CIDR" value={newRule.source_ip_pattern} onChange={e => setNewRule(r => ({ ...r, source_ip_pattern: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]" />
              <input placeholder="Description regex" value={newRule.description_pattern} onChange={e => setNewRule(r => ({ ...r, description_pattern: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]" />
              <button onClick={handleCreateRule} className="col-span-2 px-4 py-2 rounded bg-[var(--p1)] text-white text-[0.72rem] font-bold hover:bg-[var(--pd)]">Create Rule</button>
            </div>
          )}
          <div className="divide-y divide-[var(--b1)]">
            {rules.length === 0 ? (
              <div className="p-6 text-center text-[var(--t3)] text-[0.78rem]">No suppression rules yet.</div>
            ) : rules.map((r: any) => (
              <div key={r.id} className="px-4 py-3 flex items-center gap-4">
                <button onClick={() => updateSuppressionRule(r.id, { enabled: !r.enabled }).then(reload)}
                  className={`w-8 h-5 rounded-full transition-colors ${r.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${r.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-[0.75rem] font-bold text-[var(--t7)]">{r.name}</p>
                  <p className="text-[0.6rem] text-[var(--t3)]">{r.reason} {r.source_ip_pattern && `· IP: ${r.source_ip_pattern}`} {r.description_pattern && `· Regex: ${r.description_pattern}`}</p>
                </div>
                <span className="text-[0.62rem] font-mono text-[var(--t3)]">{r.hit_count} hits</span>
                <button onClick={() => deleteSuppressionRule(r.id).then(reload)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Known Assets ────────────────────────────────────────────────── */}
      {activeSection === 'assets' && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
            <p className="text-[0.78rem] font-black text-[var(--t7)]">Known Assets</p>
            <button onClick={() => setShowAddAsset(!showAddAsset)} className="px-3 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.68rem] font-bold hover:bg-[var(--pd)] flex items-center gap-1"><Plus size={12} />Add Asset</button>
          </div>
          {showAddAsset && (
            <div className="p-4 bg-[var(--sa)] border-b border-[var(--b1)] grid grid-cols-2 gap-3">
              <input placeholder="Value (IP, hostname, user)" value={newAsset.value} onChange={e => setNewAsset(a => ({ ...a, value: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]" />
              <select value={newAsset.type} onChange={e => setNewAsset(a => ({ ...a, type: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]">
                <option value="ip">IP</option><option value="host">Host</option><option value="user">User</option><option value="domain">Domain</option>
              </select>
              <select value={newAsset.role} onChange={e => setNewAsset(a => ({ ...a, role: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]">
                <option value="scanner">Scanner</option><option value="monitoring">Monitoring</option><option value="backup">Backup</option><option value="admin">Admin</option><option value="production">Production</option>
              </select>
              <input placeholder="Description" value={newAsset.description} onChange={e => setNewAsset(a => ({ ...a, description: e.target.value }))} className="px-3 py-2 rounded border border-[var(--b2)] bg-[var(--s0)] text-[0.75rem]" />
              <button onClick={handleAddAsset} className="col-span-2 px-4 py-2 rounded bg-[var(--p1)] text-white text-[0.72rem] font-bold hover:bg-[var(--pd)]">Register Asset</button>
            </div>
          )}
          <div className="divide-y divide-[var(--b1)]">
            {assets.length === 0 ? (
              <div className="p-6 text-center text-[var(--t3)] text-[0.78rem]">No known assets. Run seed-known-assets.ts to populate.</div>
            ) : assets.map((a: any) => (
              <div key={a.value} className="px-4 py-2.5 flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-[0.58rem] font-bold uppercase ${a.fp_default ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{a.type}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[0.72rem] font-bold text-[var(--t7)]">{a.value}</p>
                  <p className="text-[0.58rem] text-[var(--t3)]">{a.role} {a.description && `— ${a.description}`}</p>
                </div>
                {a.fp_default ? <span className="text-[0.58rem] font-bold text-amber-600">FP by default</span> : null}
                <button onClick={() => deleteAsset(a.value).then(reload)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};


// ── FP Archive Tab ──────────────────────────────────────────────────────────

export { NoiseFilterTab };
