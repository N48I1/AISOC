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
import { AlertDetail, AlertRow } from '../features/alerts/AlertWorkspace';

const InvestigationTab = ({ alerts, selectedAlert, setSelectedAlert, onAlertAction, setActiveTab }: {
  alerts: Alert[];
  selectedAlert: Alert | null;
  setSelectedAlert: (a: Alert | null) => void;
  onAlertAction: (id: string, update: any) => void;
  setActiveTab: (t: string) => void;
}) => {
  const toast = useToast();
  const { user, token } = useAuth();
  const isAdmin = (ROLE_LEVEL[user?.role || ''] ?? 0) >= ROLE_LEVEL.ADMIN;
  const [investigating, setInvestigating] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleClearQueue = async () => {
    setShowClearConfirm(false);
    setClearing(true);
    try {
      const res = await fetch('/api/admin/clear-investigation', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      toast(`Deleted ${data.deleted ?? 0} alerts from Incidents`, 'success');
      // Force a page-data refresh
      window.location.reload();
    } catch (err: any) {
      toast(err?.message || 'Failed to clear queue', 'error');
    } finally {
      setClearing(false);
    }
  };

  // Alerts Queue: alerts that passed FP filtering and need Tier-1 review.
  // Once escalated, they move to the dedicated Incidents tab.
  const investigationAlerts = alerts.filter(a =>
    ['TRIAGED', 'ANALYZING'].includes(a.status)
  );

  const handleInvestigate = async (alertId: string) => {
    setInvestigating(alertId);
    try {
      const result = await investigateAlert(alertId);
      toast(`Investigation complete → ${result.status}`, 'success');
      onAlertAction(alertId, result);
    } catch (err: any) { toast(err?.message || 'Investigation failed', 'error'); }
    setInvestigating(null);
  };

  // ── Escalate-to-Incident modal state ─────────────────────────────────────
  const [escAlert, setEscAlert]     = useState<Alert | null>(null);
  const [analysts, setAnalysts]     = useState<{ id: number; username: string; role: string }[]>([]);
  const [escForm, setEscForm]       = useState({ title: '', severity: 'HIGH', phase: 'analysis' as IncidentPhase, assigned_to: 0, note: '', create_glpi: true });
  const [escSubmitting, setEscSubmitting] = useState(false);

  const openEscalateModal = async (alert: Alert) => {
    let title = alert.description || 'Untitled';
    let severity: string = 'HIGH';
    try {
      const j = JSON.parse(alert.ai_analysis || '{}');
      title    = j?.ticket?.title || j?.phaseData?.ticket?.title || title;
      severity = j?.ticket?.priority || j?.phaseData?.ticket?.priority || 'HIGH';
    } catch {}
    setEscAlert(alert);
    // Default to UNASSIGNED — incident starts at status=OPEN until someone takes it
    setEscForm({ title, severity, phase: 'analysis', assigned_to: 0, note: '', create_glpi: true });
    try {
      const list = await listAnalysts();
      setAnalysts(list);
    } catch { setAnalysts([]); }
  };

  const submitEscalation = async () => {
    if (!escAlert) return;
    setEscSubmitting(true);
    try {
      const r = await createIncident({
        alert_id:    escAlert.id,
        title:       escForm.title || undefined,
        severity:    escForm.severity,
        phase:       escForm.phase,
        assigned_to: escForm.assigned_to || null,  // 0 = unassigned (incident starts OPEN)
        note:        escForm.note || undefined,
        create_glpi: escForm.create_glpi,
      });
      if (!r.ok || !r.id) { toast(r.error || 'Failed to create incident', 'error'); return; }
      const assigneeText = escForm.assigned_to
        ? `→ ${analysts.find(a => a.id === escForm.assigned_to)?.username || 'analyst'}`
        : '(unassigned, status=Open)';
      const glpiNote = r.glpi_ticket_id ? ` · GLPI #${r.glpi_ticket_id}` : '';
      toast(`Incident ${r.id} created ${assigneeText}${glpiNote}`, 'success');
      onAlertAction(escAlert.id, { status: 'ESCALATED' });
      setEscAlert(null);
      setSelectedAlert(null);
    } catch (err: any) { toast(err?.message || 'Escalation failed', 'error'); }
    finally { setEscSubmitting(false); }
  };

  const handleMarkFp = async (alertId: string) => {
    try {
      await confirmFp(alertId);
      toast('Marked as false positive', 'success');
    } catch { toast('Failed', 'error'); }
  };

  // The escalate modal must render in BOTH views (queue list AND alert detail),
  // since clicking the red "Escalate to Incident" button in either spot sets
  // escAlert. Defining it here lets both return paths include it.
  const escalateModalEl = escAlert && (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--b1)] bg-[var(--s1)]">
          <div className="flex items-center gap-2">
            <AlertOctagon size={16} className="text-red-600" />
            <p className="text-[0.85rem] font-black text-[var(--t7)]">Escalate to Incident</p>
          </div>
          <button onClick={() => setEscAlert(null)} className="text-[var(--t3)] hover:text-[var(--t6)]"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-[0.62rem] font-black text-[var(--t4)] uppercase tracking-widest block mb-1">Title</label>
            <input value={escForm.title} onChange={e => setEscForm({ ...escForm, title: e.target.value })}
              className="w-full border border-[var(--b2)] rounded px-3 py-2 text-[0.78rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)]" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[0.62rem] font-black text-[var(--t4)] uppercase tracking-widest block mb-1">Severity</label>
              <select value={escForm.severity} onChange={e => setEscForm({ ...escForm, severity: e.target.value })}
                className="w-full border border-[var(--b2)] rounded px-3 py-2 text-[0.78rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)]">
                {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[0.62rem] font-black text-[var(--t4)] uppercase tracking-widest block mb-1">Initial Phase</label>
              <select value={escForm.phase} onChange={e => setEscForm({ ...escForm, phase: e.target.value as IncidentPhase })}
                className="w-full border border-[var(--b2)] rounded px-3 py-2 text-[0.78rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)]">
                {INCIDENT_PHASES.map(p => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[0.62rem] font-black text-[var(--t4)] uppercase tracking-widest block mb-1">Assign To</label>
            <p className="text-[0.62rem] text-[var(--t3)] mb-1.5">
              If left unassigned, the incident starts as <span className="font-bold text-blue-700">Open</span> and any TIER2+ user can claim it.
              Assigning it directly auto-promotes it to <span className="font-bold text-orange-700">Investigating</span>.
            </p>
            <div className="border border-[var(--b2)] rounded divide-y divide-[var(--b1)] max-h-44 overflow-y-auto">
              <label className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[var(--s1)] ${escForm.assigned_to === 0 ? 'bg-blue-50' : ''}`}>
                <input type="radio" name="assignee" checked={escForm.assigned_to === 0} onChange={() => setEscForm({ ...escForm, assigned_to: 0 })} />
                <span className="text-[0.78rem] font-semibold text-[var(--t6)] flex-1">— Leave unassigned —</span>
                <span className="px-2 py-0.5 rounded text-[0.55rem] font-black uppercase tracking-widest bg-blue-100 text-blue-700">Open</span>
              </label>
              {analysts.length === 0 ? (
                <p className="text-[0.72rem] text-[var(--t4)] px-3 py-2 italic">
                  No TIER2 / INCIDENT_LEAD users available. Create one in Admin Ops → Users.
                </p>
              ) : (
                analysts.map(a => (
                  <label key={a.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[var(--s1)] ${escForm.assigned_to === a.id ? 'bg-blue-50' : ''}`}>
                    <input type="radio" name="assignee" checked={escForm.assigned_to === a.id} onChange={() => setEscForm({ ...escForm, assigned_to: a.id })} />
                    <span className="text-[0.78rem] font-semibold text-[var(--t7)] flex-1">{a.username}</span>
                    <span className={`px-2 py-0.5 rounded text-[0.55rem] font-black uppercase tracking-widest ${
                      a.role === 'SUPER_ADMIN' ? 'bg-rose-100 text-rose-700' :
                      a.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' :
                      a.role === 'INCIDENT_LEAD' ? 'bg-indigo-100 text-indigo-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>{a.role}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div>
            <label className="text-[0.62rem] font-black text-[var(--t4)] uppercase tracking-widest block mb-1">Escalation Note (optional)</label>
            <textarea value={escForm.note} onChange={e => setEscForm({ ...escForm, note: e.target.value })} rows={2}
              placeholder="Why is this a real incident? Any context for the assignee?"
              className="w-full border border-[var(--b2)] rounded px-3 py-2 text-[0.78rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)] resize-none" />
          </div>

          <label className="flex items-center gap-2 text-[0.78rem] text-[var(--t6)]">
            <input type="checkbox" checked={escForm.create_glpi} onChange={e => setEscForm({ ...escForm, create_glpi: e.target.checked })} />
            Also create GLPI ticket
          </label>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--b1)] bg-[var(--s1)]">
          <button onClick={() => setEscAlert(null)}
            className="px-4 py-2 rounded border border-[var(--b2)] text-[var(--t5)] text-[0.75rem] font-semibold hover:bg-[var(--s2)]">Cancel</button>
          <button onClick={submitEscalation} disabled={escSubmitting}
            className="px-4 py-2 rounded bg-red-600 text-white text-[0.75rem] font-bold hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5">
            <AlertOctagon size={13} />{escSubmitting ? 'Escalating…' : 'Escalate'}
          </button>
        </div>
      </div>
    </div>
  );

  if (selectedAlert) {
    return (
      <>
        <div className="flex h-full">
          <div className="flex-1 overflow-y-auto">
            <AlertDetail
              alert={selectedAlert}
              onClose={() => setSelectedAlert(null)}
              onAction={onAlertAction}
              returnTab="investigation"
              setActiveTab={setActiveTab}
              allAlerts={investigationAlerts}
              onAlertSelect={setSelectedAlert}
            />
            {/* Action bar */}
            <div className="sticky bottom-0 bg-[var(--s0)] border-t border-[var(--b1)] px-6 py-3 flex gap-3">
              {selectedAlert.status === 'FILTERED' && (
                <button onClick={() => handleInvestigate(selectedAlert.id)} disabled={investigating === selectedAlert.id}
                  className="px-5 py-2.5 rounded-lg bg-[var(--p1)] text-white text-[0.78rem] font-bold hover:bg-[var(--pd)] disabled:opacity-50 flex items-center gap-2">
                  <Zap size={14} />{investigating === selectedAlert.id ? 'Running...' : 'Run Investigation'}
                </button>
              )}
              {['TRIAGED', 'FILTERED'].includes(selectedAlert.status) && (
                <>
                  <button onClick={() => openEscalateModal(selectedAlert)}
                    className="px-4 py-2.5 rounded-lg bg-red-600 text-white text-[0.75rem] font-bold hover:bg-red-700 flex items-center gap-2">
                    <AlertOctagon size={14} />Escalate to Incident
                  </button>
                  <button onClick={() => handleMarkFp(selectedAlert.id)}
                    className="px-4 py-2.5 rounded-lg bg-amber-100 text-amber-800 text-[0.75rem] font-bold hover:bg-amber-200">
                    Mark as FP
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        {escalateModalEl}
      </>
    );
  }

  // No alert selected — show queue
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 overflow-y-auto h-full">
      <PageHeader eyebrow="Tier-1 Triage" title="Alerts Queue" description="Alerts that passed FP filtering, awaiting Tier-1 analyst review. Click Escalate to promote a real threat into the Incidents tab with an assigned owner." />

      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
          <p className="text-[0.78rem] font-black text-[var(--t7)]">Alerts Queue ({investigationAlerts.length})</p>
          {isAdmin && investigationAlerts.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={clearing}
              className="px-3 py-1 rounded text-[0.65rem] font-bold bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 disabled:opacity-50 flex items-center gap-1.5"
              title="Permanently delete all alerts in this queue (FP Archive is not affected)"
            >
              <Trash2 size={11} />{clearing ? 'Clearing…' : 'Clear Queue'}
            </button>
          )}
        </div>
        <div className="divide-y divide-[var(--b1)]">
          {investigationAlerts.length === 0 ? (
            <div className="p-8 text-center text-[var(--t3)]">
              <p className="text-[0.85rem] font-semibold mb-2">✅ No incidents need attention</p>
              <p className="text-[0.72rem]">The FP-reduction pipeline is filtering noise to the <button onClick={() => setActiveTab('fp-archive')} className="text-[var(--p1)] font-bold hover:underline">FP Archive</button> — check there for archived items, or tune the <button onClick={() => setActiveTab('noise-filter')} className="text-[var(--p1)] font-bold hover:underline">Noise Filter</button>.</p>
            </div>
          ) : investigationAlerts.map(a => {
            const risk = getAlertRiskScore(a);
            const hasAnalysis = !!a.ai_analysis;
            return (
              <button key={a.id} onClick={() => setSelectedAlert(a)} className="w-full px-4 py-3 text-left hover:bg-[var(--sa)] flex items-center gap-4">
                <span className={`w-2 h-8 rounded-full ${a.severity >= 12 ? 'bg-red-500' : a.severity >= 10 ? 'bg-orange-400' : a.severity >= 7 ? 'bg-amber-400' : 'bg-green-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[0.78rem] font-semibold text-[var(--t7)] truncate">{a.description}</p>
                  <p className="text-[0.62rem] text-[var(--t3)] font-mono">{a.source_ip} · {a.agent_name} · {a.timestamp?.slice(0, 16)}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-[0.6rem] font-bold uppercase ${
                  a.status === 'FILTERED' ? 'bg-purple-100 text-purple-700' :
                  a.status === 'TRIAGED' ? 'bg-green-100 text-green-700' :
                  a.status === 'ESCALATED' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-600'
                }`}>{a.status}</span>
                {risk != null && <span className="text-[0.68rem] font-black text-[var(--t6)]">{risk}%</span>}
                {!hasAnalysis && a.status === 'FILTERED' && (
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 text-[0.58rem] font-bold">Needs investigation</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Escalate-to-Incident modal (defined above so it renders in both views) ─── */}
      {escalateModalEl}
      {showClearConfirm && (
        <ConfirmModal
          title="Clear Incidents Queue"
          message="Delete all alerts in the Incidents queue? This permanently removes alerts with status TRIAGED, ESCALATED, CLOSED, or ANALYZING. The FP Archive is NOT affected."
          confirmLabel="Delete All"
          onConfirm={handleClearQueue}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </div>
  );
};


// ── Integrations Tab (merge Notifications + Response Controls) ──────────────

export { InvestigationTab };
