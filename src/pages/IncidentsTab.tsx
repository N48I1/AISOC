import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, AlertTriangle, AlertOctagon, Activity, FileText, Search, User, CheckCircle, XCircle, X,
  Clock, ChevronRight, Filter, Plus, UserPlus, Eye, ThumbsUp, ThumbsDown, BookOpen, Send, Zap,
  RefreshCw, Hash, Globe, Crosshair, ListChecks, MessageSquare, Laptop, Link2, Terminal,
} from 'lucide-react';
import {
  getIncidents, getIncident, getIncidentReasoning, reinvestigateIncident, createIncident,
  assignIncident, takeIncident, moveIncidentPhase, closeIncident, addIncidentNote,
  reclassifyIncidentFp, addIncidentAction, updateIncidentAction, deleteIncidentAction,
  reorderIncidentActions, updateIncident, listAnalysts, type ReasoningRow,
} from '../services/aiService';
import {
  INCIDENT_PHASES, PHASE_LABELS, ROLE_LEVEL,
  type Incident, type IncidentPhase, type IncidentAction, type IncidentActionStatus, type Alert,
} from '../types';
import PageHeader from '../components/ui/PageHeader';
import { parseMitreTags } from '../features/alerts/alertUtils';
import { AgentRunStatus } from '../components/AgentRunStatus';
import { ProviderHealthBadge } from '../components/ProviderHealthBadge';
import { CopyButton } from '../components/CopyButton';
import { Markdown } from '../components/Markdown';
import { useToast } from '../lib/toast';
import { useAuth } from '../contexts/AuthContext';
import { ConfirmModal } from '../components/ConfirmModal';
import { severityChipColor, timeAgo } from '../lib/format';

// ─── Incidents Tab — case-management workspace ───────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  OPEN:            'Open',
  IN_PROGRESS:     'Investigating',
  CONTAINED:       'Contained',
  RESOLVED:        'Resolved',
  CLOSED:          'Closed',
  RECLASSIFIED_FP: 'Reclassified FP',
};

const STATUS_COLORS: Record<string, string> = {
  OPEN:            'bg-blue-100 text-blue-700 border-blue-200',
  IN_PROGRESS:     'bg-orange-100 text-orange-700 border-orange-200',
  CONTAINED:       'bg-amber-100 text-amber-700 border-amber-200',
  RESOLVED:        'bg-green-100 text-green-700 border-green-200',
  CLOSED:          'bg-gray-200 text-gray-700 border-gray-300',
  RECLASSIFIED_FP: 'bg-pink-100 text-pink-700 border-pink-200',
};

const SEV_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700 border-red-200',
  HIGH:     'bg-orange-100 text-orange-700 border-orange-200',
  MEDIUM:   'bg-amber-100 text-amber-700 border-amber-200',
  LOW:      'bg-green-100 text-green-700 border-green-200',
};

const PHASE_COLORS: Record<string, string> = {
  detection:     'bg-slate-100 text-slate-700',
  analysis:      'bg-blue-100 text-blue-700',
  containment:   'bg-orange-100 text-orange-700',
  eradication:   'bg-red-100 text-red-700',
  recovery:      'bg-amber-100 text-amber-700',
  post_incident: 'bg-green-100 text-green-700',
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  block_ip:          'Block source IP',
  isolate_host:      'Isolate host',
  disable_user:      'Disable user',
  reset_password:    'Reset password',
  collect_forensics: 'Collect forensic evidence',
  firewall_rule:     'Open firewall rule',
  escalate:          'Escalate to lead',
  other:             'Custom action',
};

const ACTION_STATUS_COLORS: Record<string, string> = {
  pending:  'bg-blue-100 text-blue-700 border-blue-200',
  approved: 'bg-violet-100 text-violet-700 border-violet-200',
  executed: 'bg-green-100 text-green-700 border-green-200',
  failed:   'bg-red-100 text-red-700 border-red-200',
  skipped:  'bg-gray-200 text-gray-600 border-gray-300',
};

const SLA_THRESHOLDS: Record<string, { warn: number; breach: number }> = {
  CRITICAL: { warn: 0.5, breach: 1   },
  HIGH:     { warn: 2,   breach: 4   },
  MEDIUM:   { warn: 12,  breach: 24  },
  LOW:      { warn: 48,  breach: 96  },
};

function computeSla(severity: string, escalatedAt: string): { state: 'on_track' | 'watch' | 'at_risk' | 'breached'; label: string; color: string } {
  const t = SLA_THRESHOLDS[severity] || SLA_THRESHOLDS.MEDIUM;
  const hours = (Date.now() - new Date(escalatedAt).getTime()) / 3600000;
  if (hours >= t.breach)      return { state: 'breached', label: 'Breached',  color: 'bg-red-500'    };
  if (hours >= t.warn)        return { state: 'at_risk',  label: 'At risk',   color: 'bg-amber-500'  };
  if (hours >= t.warn * 0.5)  return { state: 'watch',    label: 'Watch',     color: 'bg-blue-400'   };
  return                              { state: 'on_track',label: 'On track',  color: 'bg-green-500'  };
}

function lastEventLabel(t?: string | null, n?: string | null): string {
  if (!t) return '—';
  if (t === 'created')         return 'Created';
  if (t === 'phase_change')    return 'Phase changed';
  if (t === 'assigned')        return 'Assigned';
  if (t === 'closed')          return 'Closed';
  if (t === 'status_change')   return 'Status changed';
  if (t === 'reclassified_fp') return 'Reclassified as FP';
  if (t === 'note' && n)       return `Note: ${n.slice(0, 40)}${n.length > 40 ? '…' : ''}`;
  return t;
}

// Placeholder reason stamped on incidents created by the legacy migration
// backfill — it isn't a real escalation rationale, so we suppress it in the UI.
const BACKFILL_REASON = 'Backfilled from existing escalated alert';
const realReason = (r?: string | null): string | null => {
  const t = (r || '').trim();
  return !t || t === BACKFILL_REASON ? null : t;
};

function extractAiResults(analysisJson: string | null) {
  if (!analysisJson) return {} as any;
  try {
    const j = JSON.parse(analysisJson);
    const a = j?.phaseData?.analysis || {};
    const intel = j?.phaseData?.intel || {};
    const corr  = j?.phaseData?.correlation || {};
    const valid = j?.phaseData?.validation || {};
    const know  = j?.phaseData?.knowledge || {};
    const resp  = j?.phaseData?.response || {};
    const ticket= j?.ticket || j?.phaseData?.ticket || {};
    return {
      summary:            j?.summary || a?.analysis_summary,
      ticket_summary:     ticket?.report_body,
      confidence:         a?.confidence,
      risk_score:         a?.risk_score,
      fp_confidence:      a?.false_positive_confidence,
      attack_category:    a?.attack_category,
      kill_chain_stage:   a?.kill_chain_stage,
      recommended_action: a?.recommended_action,
      mitre:              intel?.mitre_attack || [],
      ttp_tags:           intel?.ttp_tags || [],
      iocs:               a?.iocs,
      correlation:        corr?.campaign_name,
      correlation_summary:corr?.summary,
      intel_summary:      intel?.intel_summary || j?.intel,
      threat_actor:       intel?.threat_actor,
      threat_actor_type:  intel?.threat_actor_type,
      campaign_family:    intel?.campaign_family,
      validation_status:  valid?.sla_status || valid?.recommendation,
      affected_systems:   ticket?.affected_systems,
      business_impact:    ticket?.business_impact,
      response_actions:   Array.isArray(resp?.actions) ? resp.actions : (Array.isArray(ticket?.actions) ? ticket.actions : []),
      remediation:        know?.playbook || know?.remediation || know?.summary || j?.remediation,
    };
  } catch { return {} as any; }
}

function extractObservables(analysisJson: string | null, alerts?: Alert[]): { type: string; value: string; source: string }[] {
  const obs: { type: string; value: string; source: string }[] = [];
  const seen = new Set<string>();
  const add = (type: string, value: string, source: string) => {
    const key = `${type}:${value}`;
    if (!value || seen.has(key)) return;
    seen.add(key);
    obs.push({ type, value, source });
  };
  if (analysisJson) {
    try {
      const j = JSON.parse(analysisJson);
      const a = j?.phaseData?.analysis || {};
      const iocs = a?.iocs || {};
      const mapping: Record<string, string> = { ips: 'ip', domains: 'domain', users: 'username', hosts: 'hostname', hashes: 'hash', urls: 'url', files: 'filename' };
      for (const [k, label] of Object.entries(mapping)) {
        for (const v of (iocs[k] || []) as string[]) add(label, v, 'AI Analysis');
      }
    } catch {}
  }
  if (alerts) {
    for (const a of alerts) {
      if (a.source_ip) add('ip', a.source_ip, `Alert ${a.id.slice(0, 8)}`);
      if (a.dest_ip) add('ip', a.dest_ip, `Alert ${a.id.slice(0, 8)}`);
      if (a.hostname) add('hostname', a.hostname, `Alert ${a.id.slice(0, 8)}`);
      if (a.user) add('username', a.user, `Alert ${a.id.slice(0, 8)}`);
    }
  }
  return obs;
}

const OBSERVABLE_ICONS: Record<string, any> = {
  ip: Globe, domain: Globe, hostname: Laptop, username: User, hash: Hash, url: Link2, filename: FileText,
};

// Wazuh severity level → badge color (Wazuh rule levels are 0–15).
const sevLevelColor = (sev: number): string =>
  sev >= 12 ? 'bg-red-100 text-red-700 border-red-200'
  : sev >= 7 ? 'bg-orange-100 text-orange-700 border-orange-200'
  : sev >= 4 ? 'bg-amber-100 text-amber-700 border-amber-200'
  :            'bg-green-100 text-green-700 border-green-200';

// Wazuh's ingest fills missing fields with placeholders ("unknown", null, …).
// Treat those as "no value" so we can drop the row instead of showing junk.
const NO_VALUE = new Set(['unknown', 'n/a', 'na', 'none', 'null', '-', '—']);
const cleanVal = (v?: string | null): string | null => {
  if (v == null) return null;
  const t = String(v).trim();
  return !t || NO_VALUE.has(t.toLowerCase()) ? null : t;
};

// ── Wazuh alert card — the raw event rendered as a clean field/value table ────
const WazuhAlertCard: React.FC<{ alert: Alert; index: number; total: number }> = ({ alert, index, total }) => {
  const [showRaw, setShowRaw] = useState(false);
  const mitre = parseMitreTags(alert);

  // Pretty-print the raw Wazuh log when it's JSON; otherwise show it verbatim.
  const rawLog = (() => {
    if (!alert.full_log || !alert.full_log.trim()) return null;
    try { return JSON.stringify(JSON.parse(alert.full_log), null, 2); } catch { return alert.full_log; }
  })();

  const ruleId = cleanVal(alert.rule_id);
  const srcIp  = cleanVal(alert.source_ip);
  const dstIp  = cleanVal(alert.dest_ip);
  const host   = cleanVal(alert.hostname);
  const usr    = cleanVal(alert.user);
  const agent  = cleanVal(alert.agent_name);
  const desc   = cleanVal(alert.description);
  const status = cleanVal(alert.status);

  // Only push rows that actually carry a value — empty/"unknown" fields are omitted.
  const mono = (v: string) => <span className="font-mono text-[0.72rem] text-[var(--t6)]">{v}</span>;
  const rows: Array<{ label: string; node: React.ReactNode }> = [];
  rows.push({ label: 'Event ID', node: <code className="font-mono text-[0.7rem] text-[var(--p1)] font-bold">#{alert.id.slice(0, 12).toUpperCase()}</code> });
  if (ruleId) rows.push({ label: 'Wazuh Rule', node: <span className="font-mono text-[0.72rem] text-[var(--t7)] font-bold">{ruleId}</span> });
  rows.push({ label: 'Severity', node: <span className={`px-1.5 py-0.5 rounded text-[0.55rem] font-black uppercase border ${sevLevelColor(alert.severity)}`}>level {alert.severity}</span> });
  if (desc)   rows.push({ label: 'Description',     node: <span className="text-[var(--t6)]">{desc}</span> });
  if (srcIp)  rows.push({ label: 'Source IP',       node: mono(srcIp) });
  if (dstIp)  rows.push({ label: 'Destination IP',  node: mono(dstIp) });
  if (host)   rows.push({ label: 'Host',            node: mono(host) });
  if (usr)    rows.push({ label: 'User',            node: mono(usr) });
  if (agent)  rows.push({ label: 'Wazuh Agent',     node: mono(agent) });
  if (alert.timestamp) rows.push({ label: 'Detected', node: <span className="text-[var(--t6)]">{new Date(alert.timestamp).toLocaleString()}</span> });
  if (status) rows.push({ label: 'Status', node: <span className="font-mono text-[0.66rem] uppercase tracking-wide text-[var(--t5)]">{status}</span> });
  if (mitre.length) {
    rows.push({
      label: 'MITRE ATT&CK',
      node: (
        <div className="flex gap-1 flex-wrap">
          {mitre.slice(0, 14).map((t, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 text-[0.58rem] font-mono border border-violet-200">{t}</span>
          ))}
        </div>
      ),
    });
  }

  return (
    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-[var(--s1)] border-b border-[var(--b1)] flex items-center gap-2">
        <Shield size={13} className="text-[var(--p1)]" />
        <p className="text-[0.72rem] font-black text-[var(--t7)]">
          Wazuh Alert{total > 1 ? ` — ${index + 1} of ${total}` : ''}
        </p>
        {ruleId && <code className="font-mono text-[0.58rem] text-[var(--t3)]">rule {ruleId}</code>}
        {rawLog && (
          <button onClick={() => setShowRaw(s => !s)}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--p1)] bg-blue-50 hover:bg-blue-100 text-[0.62rem] font-bold text-[var(--p1)] transition-colors">
            <Terminal size={12} />
            {showRaw ? 'Hide' : 'View'} Raw JSON
            <ChevronRight size={12} className={`transition-transform ${showRaw ? 'rotate-90' : ''}`} />
          </button>
        )}
      </div>
      <table className="w-full text-[0.72rem]">
        <tbody className="divide-y divide-[var(--b1)]">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-[var(--s1)] transition-colors">
              <td className="px-4 py-2 w-40 align-top bg-[var(--s1)]/40">
                <span className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest">{r.label}</span>
              </td>
              <td className="px-4 py-2 align-top break-all">{r.node}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rawLog && showRaw && (
        <div className="border-t border-[var(--b1)] p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest">Raw Wazuh Alert (JSON)</p>
            <CopyButton text={rawLog} />
          </div>
          <pre className="text-[0.7rem] bg-slate-950 text-emerald-400 p-5 rounded-xl overflow-x-auto font-mono leading-relaxed max-h-96 overflow-y-auto">{rawLog}</pre>
        </div>
      )}
    </div>
  );
};

// Compact, scrollable table of the alerts correlated into an incident. Each row
// expands to the full Wazuh detail (field/value table + raw JSON) so analysts
// don't have to scroll past large cards to reach the AI summary.
const sevRowBadge = (sev: number): string =>
  sev >= 12 ? 'bg-red-100 text-red-700 border-red-200'
  : sev >= 7 ? 'bg-orange-100 text-orange-700 border-orange-200'
  : sev >= 4 ? 'bg-amber-100 text-amber-700 border-amber-200'
  :            'bg-green-100 text-green-700 border-green-200';

const CorrelatedAlertsTable: React.FC<{ alerts: Alert[] }> = ({ alerts }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-[var(--s1)] border-b border-[var(--b1)] flex items-center gap-2">
        <AlertTriangle size={13} className="text-orange-500" />
        <p className="text-[0.72rem] font-black text-[var(--t7)]">Correlated Wazuh Alerts ({alerts.length})</p>
        <span className="ml-auto text-[0.55rem] text-[var(--t3)] font-semibold">click a row to expand</span>
      </div>
      {/* Column header */}
      <div className="px-4 py-1.5 bg-[var(--s1)]/50 border-b border-[var(--b1)] hidden md:flex items-center gap-3 text-[0.5rem] font-black text-[var(--t3)] uppercase tracking-widest">
        <span className="w-4" />
        <span className="w-14">Sev</span>
        <span className="w-24">Event</span>
        <span className="w-16">Rule</span>
        <span className="flex-1">Description</span>
        <span className="w-28">Source IP</span>
        <span className="w-16 text-right">When</span>
      </div>
      <div className="max-h-[26rem] overflow-y-auto divide-y divide-[var(--b1)]">
        {alerts.map(a => {
          const isOpen = openId === a.id;
          return (
            <div key={a.id}>
              <button onClick={() => setOpenId(isOpen ? null : a.id)}
                className={`w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors ${isOpen ? 'bg-[var(--s1)]' : 'hover:bg-[var(--s1)]'}`}>
                <ChevronRight size={13} className={`text-[var(--t3)] shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                <span className={`w-14 shrink-0 text-center px-1 py-0.5 rounded text-[0.5rem] font-black uppercase border ${sevRowBadge(a.severity)}`}>lvl {a.severity}</span>
                <code className="w-24 shrink-0 font-mono text-[0.6rem] text-[var(--p1)] truncate">#{a.id.slice(0, 10).toUpperCase()}</code>
                <code className="w-16 shrink-0 font-mono text-[0.62rem] text-[var(--t6)] font-bold truncate">{a.rule_id || '—'}</code>
                <span className="flex-1 min-w-0 text-[0.7rem] text-[var(--t6)] truncate">{a.description || '—'}</span>
                <span className="w-28 shrink-0 font-mono text-[0.62rem] text-[var(--t4)] truncate hidden md:block">{a.source_ip || '—'}</span>
                <span className="w-16 shrink-0 text-right text-[0.58rem] text-[var(--t3)] hidden md:block">{a.timestamp ? timeAgo(new Date(a.timestamp).getTime()) : '—'}</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pt-1 bg-[var(--s1)]/30">
                  <WazuhAlertCard alert={a} index={0} total={1} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const PhaseStepper = ({ current }: { current: string }) => {
  const idx = INCIDENT_PHASES.indexOf(current as IncidentPhase);
  return (
    <div className="flex items-center w-full">
      {INCIDENT_PHASES.map((p, i) => (
        <React.Fragment key={p}>
          <div className="flex flex-col items-center min-w-0 flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[0.65rem] font-black border-2 ${
              i < idx  ? 'bg-[var(--p1)] border-[var(--p1)] text-white' :
              i === idx ? 'bg-white border-[var(--p1)] text-[var(--p1)] ring-4 ring-blue-100' :
                          'bg-[var(--s1)] border-[var(--b2)] text-[var(--t3)]'
            }`}>{i < idx ? '✓' : i + 1}</div>
            <p className={`text-[0.55rem] font-black uppercase tracking-widest mt-1 truncate ${i === idx ? 'text-[var(--p1)]' : 'text-[var(--t3)]'}`}>
              {PHASE_LABELS[p]}
            </p>
          </div>
          {i < INCIDENT_PHASES.length - 1 && (
            <div className={`h-1 flex-1 -mt-5 mx-1 rounded-full ${i < idx ? 'bg-[var(--p1)]' : 'bg-[var(--s2)]'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

// Editable action row (inline edit + delete + reorder)
interface ActionRowProps {
  action: IncidentAction;
  index: number;
  total: number;
  isClosed: boolean;
  onMoveUp:   () => void | Promise<void>;
  onMoveDown: () => void | Promise<void>;
  onDelete:   () => void | Promise<void>;
  onSave:     (patch: { description?: string; target?: string; priority?: string; action_type?: string; notes?: string }) => void | Promise<void>;
  onStatus:   (s: IncidentActionStatus) => void | Promise<void>;
}
const ActionRow: React.FC<ActionRowProps> = ({
  action, index, total, isClosed,
  onMoveUp, onMoveDown, onDelete, onSave, onStatus
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    description: action.description || '',
    target:      action.target || '',
    priority:    action.priority || 'MEDIUM',
    action_type: action.action_type || 'other',
    notes:       action.notes || '',
  });
  React.useEffect(() => {
    setDraft({
      description: action.description || '',
      target:      action.target || '',
      priority:    action.priority || 'MEDIUM',
      action_type: action.action_type || 'other',
      notes:       action.notes || '',
    });
  }, [action.id, action.description, action.target, action.priority, action.action_type, action.notes]);

  if (editing) {
    return (
      <div className="px-3 py-2.5 bg-blue-50/40 border-l-2 border-blue-400">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[0.6rem] font-mono text-[var(--t3)]">#{index + 1}</span>
          <select value={draft.action_type} onChange={e => setDraft({ ...draft, action_type: e.target.value })}
            className="border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)] flex-1">
            {Object.entries(ACTION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })}
            className="border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)] w-24">
            {['CRITICAL','HIGH','MEDIUM','LOW'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <input value={draft.target} onChange={e => setDraft({ ...draft, target: e.target.value })}
          placeholder="Target (IP/host/user)" className="w-full border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)] font-mono mb-2" />
        <textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} rows={2}
          className="w-full border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)] resize-none mb-2" />
        <textarea value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} rows={2}
          placeholder="Execution notes (optional)" className="w-full border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)] resize-none mb-2" />
        <div className="flex gap-1.5">
          <button onClick={async () => { await onSave(draft); setEditing(false); }}
            className="px-3 py-1 rounded bg-[var(--p1)] text-white text-[0.65rem] font-bold">Save</button>
          <button onClick={() => setEditing(false)} className="px-3 py-1 rounded border border-[var(--b2)] text-[var(--t5)] text-[0.65rem] font-semibold">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5 group hover:bg-[var(--s1)]">
      <div className="flex items-start gap-2">
        {!isClosed && (
          <div className="flex flex-col gap-0.5 shrink-0 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onMoveUp}   disabled={index === 0}        className="text-[var(--t3)] hover:text-[var(--p1)] disabled:opacity-20 leading-none text-[0.65rem]" title="Move up">▲</button>
            <button onClick={onMoveDown} disabled={index === total - 1} className="text-[var(--t3)] hover:text-[var(--p1)] disabled:opacity-20 leading-none text-[0.65rem]" title="Move down">▼</button>
          </div>
        )}
        <span className="text-[0.6rem] font-mono text-[var(--t3)] shrink-0 pt-0.5">#{index + 1}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded text-[0.55rem] font-black uppercase tracking-widest border ${ACTION_STATUS_COLORS[action.status] || 'bg-gray-100 text-gray-700'}`}>{action.status}</span>
            <span className="text-[0.6rem] font-mono text-[var(--t4)]">{ACTION_TYPE_LABELS[action.action_type] || action.action_type}</span>
            <span className={`px-1.5 py-0.5 rounded text-[0.55rem] font-black uppercase ${SEV_COLORS[action.priority] || 'bg-gray-100 text-gray-700'}`}>{action.priority}</span>
            <span className="text-[0.55rem] uppercase font-bold text-[var(--t3)]">{action.source}</span>
          </div>
          <p className="text-[0.7rem] text-[var(--t6)] leading-snug">{action.description}</p>
          {action.target && <p className="text-[0.6rem] text-[var(--t3)] font-mono mt-0.5">target: {action.target}</p>}
          {action.notes  && <p className="text-[0.6rem] text-[var(--t4)] italic mt-0.5">"{action.notes}"</p>}
          {!isClosed && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {action.status === 'pending' && (
                <>
                  <button onClick={() => onStatus('executed')} className="px-2 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200 text-[0.6rem] font-bold">✓ Executed</button>
                  <button onClick={() => onStatus('failed')}   className="px-2 py-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200 text-[0.6rem] font-bold">Failed</button>
                  <button onClick={() => onStatus('skipped')}  className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 text-[0.6rem] font-bold">Skip</button>
                </>
              )}
              {action.status !== 'pending' && (
                <button onClick={() => onStatus('pending')} className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 text-[0.6rem] font-bold">Reopen</button>
              )}
              <button onClick={() => setEditing(true)} className="px-2 py-0.5 rounded border border-[var(--b2)] text-[var(--t5)] hover:bg-[var(--s2)] text-[0.6rem] font-bold">Edit</button>
              <button onClick={onDelete} className="px-2 py-0.5 rounded text-red-600 hover:bg-red-50 text-[0.6rem] font-bold">Delete</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const IncidentsTab = ({ setActiveTab, initialIncidentId, clearInitialIncidentId }: { setActiveTab: (t: string) => void; initialIncidentId?: string | null; clearInitialIncidentId?: () => void }) => {
  const toast = useToast();
  const { user } = useAuth();
  const isAdminOrLead = (ROLE_LEVEL[user?.role || ''] ?? 0) >= ROLE_LEVEL.ADMIN || user?.role === 'INCIDENT_LEAD';

  const [list, setList]               = useState<Incident[]>([]);
  const [total, setTotal]             = useState(0);
  const [counts, setCounts]           = useState<Record<string, number>>({});
  const [search, setSearch]           = useState('');
  const [phaseF, setPhaseF]           = useState<string>('');
  const [statusF, setStatusF]         = useState<string>('');
  const [sevF, setSevF]               = useState<string>('');
  const [ownerF, setOwnerF]           = useState<number | ''>('');
  const [slaF, setSlaF]               = useState<string>('');
  const [analysts, setAnalysts]       = useState<{ id: number; username: string; role: string }[]>([]);

  const [activeId, setActiveId]       = useState<string | null>(null);
  const [detail, setDetail]           = useState<Incident | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailTab, setDetailTab]     = useState<'overview'|'observables'|'tasks'|'reasoning'|'timeline'|'report'>('overview');
  const [reasoning, setReasoning]     = useState<ReasoningRow[]>([]);
  const [loadingReasoning, setLoadingReasoning] = useState(false);
  const [reinvestigating, setReinvestigating]   = useState(false);
  const [myOnly, setMyOnly]           = useState(false);

  const [showReassign, setShowReassign] = useState(false);
  const [reassignTo, setReassignTo]     = useState<number>(0);
  const [showAddAction, setShowAddAction] = useState(false);
  const [newAction, setNewAction]       = useState({ action_type: 'other', target: '', priority: 'MEDIUM', description: '' });
  const [showReclassify, setShowReclassify] = useState(false);
  const [reclassifyNote, setReclassifyNote] = useState('');
  const [reportDraft, setReportDraft]   = useState('');
  const [reportEditing, setReportEditing] = useState(false);
  const [reportSaving, setReportSaving]   = useState(false);
  const [noteText, setNoteText]         = useState('');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [deleteActionTarget, setDeleteActionTarget] = useState<IncidentAction | null>(null);

  const fetchList = useCallback(() => {
    getIncidents({
      q: search || undefined,
      phase: phaseF || undefined,
      status: statusF || undefined,
      assigned_to: ownerF ? Number(ownerF) : undefined,
      limit: 100,
    }).then(d => { setList(d.rows); setTotal(d.total); setCounts(d.counts || {}); }).catch(() => {});
  }, [search, phaseF, statusF, ownerF]);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { listAnalysts().then(setAnalysts).catch(() => {}); }, []);

  // Deep-link from the Response Actions page or a clicked notification: open the
  // requested incident. Runs on mount and whenever a new incident id is requested
  // (so it also works when the Incidents tab is already open).
  useEffect(() => {
    if (initialIncidentId) {
      setActiveId(initialIncidentId);
      clearInitialIncidentId?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIncidentId]);

  const fetchDetail = useCallback((id: string) => {
    setLoadingDetail(true);
    getIncident(id).then(d => {
      setDetail(d);
      setReportDraft(d?.report_body || '');
    }).finally(() => setLoadingDetail(false));
  }, []);

  useEffect(() => {
    if (activeId) { fetchDetail(activeId); setDetailTab('overview'); setReasoning([]); }
    else { setDetail(null); setReportEditing(false); setReasoning([]); }
  }, [activeId, fetchDetail]);

  // Lazy-load the reasoning timeline only when the user opens that tab.
  // Cheap (a single GET on a small table) but no need to fetch eagerly.
  useEffect(() => {
    if (detailTab !== 'reasoning' || !activeId) return;
    setLoadingReasoning(true);
    getIncidentReasoning(activeId)
      .then(d => setReasoning(d.reasoning || []))
      .catch(() => setReasoning([]))
      .finally(() => setLoadingReasoning(false));
  }, [detailTab, activeId]);

  // Re-run the agents on this incident's alert to capture (missing) reasoning.
  const handleRunInvestigation = async () => {
    if (!activeId || reinvestigating) return;
    setReinvestigating(true);
    try {
      const r = await reinvestigateIncident(activeId);
      const d = await getIncidentReasoning(activeId);
      setReasoning(d.reasoning || []);
      fetchDetail(activeId);
      if (r.queued) {
        toast(r.already_running ? 'Investigation is already running' : 'Investigation started — agents are running in the background', 'success');
        window.setTimeout(() => fetchDetail(activeId), 5000);
        window.setTimeout(() => fetchDetail(activeId), 20000);
      } else {
        toast(
          r.reasoning_steps
            ? `Investigation complete — ${r.reasoning_steps} reasoning step(s) recorded`
            : 'Investigation ran but produced no reasoning — check the LLM provider/quota',
          r.reasoning_steps ? 'success' : 'error',
        );
      }
    } catch (e: any) {
      toast(e?.message || 'Re-investigation failed', 'error');
    } finally {
      setReinvestigating(false);
    }
  };

  const filteredList = React.useMemo(() => {
    let out = list;
    if (sevF) out = out.filter(i => i.severity === sevF);
    if (slaF) out = out.filter(i => computeSla(i.severity, i.escalated_at).state === slaF);
    if (myOnly && user) out = out.filter(i => i.assigned_to === user.id);
    return out;
  }, [list, sevF, slaF, myOnly, user]);

  // ── Detail view ──────────────────────────────────────────────────────────
  if (activeId && detail) {
    const isOwner = detail.assigned_to === user?.id;
    const canEdit      = isAdminOrLead || (user?.role === 'TIER2' && isOwner);
    const canReassign  = isAdminOrLead;
    const isClosed     = detail.status === 'CLOSED' || detail.status === 'RECLASSIFIED_FP' || detail.status === 'RESOLVED';
    const currentIdx   = INCIDENT_PHASES.indexOf(detail.phase as IncidentPhase);
    const nextPhase    = currentIdx >= 0 && currentIdx < INCIDENT_PHASES.length - 1 ? INCIDENT_PHASES[currentIdx + 1] : null;

    // Prefer the latest linked alert's ai_analysis — re-investigation writes the
    // fresh result onto the alert, while incident.analysis is a snapshot from
    // creation that can go stale (showing old fallback data). Fall back to the
    // incident's analysis only if the alert has none.
    const aiSource = detail.alerts?.[0]?.ai_analysis || detail.analysis || null;
    const ai  = extractAiResults(aiSource);
    const sla = computeSla(detail.severity, detail.escalated_at);
    const actions = detail.actions || [];

    // Surface agent-run failures: the persisted last_error on any linked alert,
    // plus quota/fallback signals parsed from the analysis JSON.
    const erroredAlert = (detail.alerts || []).find(a => a.last_error);
    let incidentAiMeta: { quota_exhausted?: boolean; fallback_phases?: string[]; phase_errors?: Record<string,string> } = {};
    try { incidentAiMeta = aiSource ? JSON.parse(aiSource) : {}; } catch { incidentAiMeta = {}; }

    const handleNextPhase = async () => {
      if (!nextPhase) return;
      const r = await moveIncidentPhase(detail.id, nextPhase);
      if (r.ok) { toast(`Phase → ${PHASE_LABELS[nextPhase as IncidentPhase]}`, 'success'); fetchDetail(detail.id); fetchList(); }
      else toast(r.error || 'Failed to advance phase', 'error');
    };
    const handleStatusChange = async (newStatus: string) => {
      if (newStatus === detail.status) return;
      if (newStatus === 'RECLASSIFIED_FP') { setShowReclassify(true); return; }
      const r = await updateIncident(detail.id, { status: newStatus });
      if (r.ok) { toast(`Status → ${STATUS_LABELS[newStatus] || newStatus}`, 'success'); fetchDetail(detail.id); fetchList(); }
      else toast(r.error || 'Failed', 'error');
    };
    const handleReclassifyFp = async () => {
      const r = await reclassifyIncidentFp(detail.id, reclassifyNote || undefined);
      if (r.ok) {
        toast(`Reclassified — ${r.alerts_returned_to_archive ?? 0} alert(s) returned to FP archive`, 'success');
        setShowReclassify(false); setReclassifyNote('');
        fetchDetail(detail.id); fetchList();
      } else toast(r.error || 'Failed to reclassify', 'error');
    };
    const handleAddNote = async () => {
      if (!noteText.trim()) return;
      const r = await addIncidentNote(detail.id, noteText.trim());
      if (r.ok) { toast('Note added', 'success'); setNoteText(''); fetchDetail(detail.id); }
      else toast(r.error || 'Failed', 'error');
    };
    const handleReassign = async () => {
      const r = await assignIncident(detail.id, reassignTo || null);
      if (r.ok) {
        toast(reassignTo ? 'Reassigned' : 'Unassigned', 'success');
        setShowReassign(false); fetchDetail(detail.id); fetchList();
      } else toast(r.error || 'Failed', 'error');
    };
    const handleTake = async () => {
      const r = await takeIncident(detail.id);
      if (r.ok) { toast(`Claimed — status → Investigating`, 'success'); fetchDetail(detail.id); fetchList(); }
      else toast(r.error || 'Failed to claim', 'error');
    };
    const handleAddAction = async () => {
      if (!newAction.description.trim()) return;
      const r = await addIncidentAction(detail.id, newAction);
      if (r.ok) {
        toast('Action added', 'success');
        setShowAddAction(false);
        setNewAction({ action_type: 'other', target: '', priority: 'MEDIUM', description: '' });
        fetchDetail(detail.id);
      } else toast(r.error || 'Failed', 'error');
    };
    const handleActionStatus = async (a: IncidentAction, status: IncidentActionStatus) => {
      const r = await updateIncidentAction(detail.id, a.id, { status });
      if (r.ok) { toast(`Action → ${status}`, 'success'); fetchDetail(detail.id); }
      else toast(r.error || 'Failed', 'error');
    };
    const handleActionEdit = async (a: IncidentAction, patch: any) => {
      const r = await updateIncidentAction(detail.id, a.id, patch);
      if (r.ok) { toast('Action saved', 'success'); fetchDetail(detail.id); }
      else toast(r.error || 'Failed', 'error');
    };
    const handleActionDelete = async (a: IncidentAction) => {
      setDeleteActionTarget(null);
      const r = await deleteIncidentAction(detail.id, a.id);
      if (r.ok) { toast('Action deleted', 'info'); fetchDetail(detail.id); }
      else toast(r.error || 'Failed', 'error');
    };
    const handleReorder = async (from: number, to: number) => {
      if (to < 0 || to >= actions.length) return;
      const arr = [...actions];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      // Optimistic update
      setDetail({ ...detail, actions: arr });
      await reorderIncidentActions(detail.id, arr.map(a => a.id));
      fetchDetail(detail.id);
    };
    const handleSaveReport = async () => {
      setReportSaving(true);
      const r = await updateIncident(detail.id, { report_body: reportDraft });
      setReportSaving(false);
      if (r.ok) { toast('Report saved', 'success'); setReportEditing(false); fetchDetail(detail.id); }
      else toast(r.error || 'Failed', 'error');
    };

    const observables = extractObservables(detail.analysis, detail.alerts);
    const DETAIL_TABS = [
      { key: 'overview'     as const, label: 'Overview',     icon: <Eye size={13} /> },
      { key: 'observables'  as const, label: `Observables (${observables.length})`, icon: <Crosshair size={13} /> },
      { key: 'tasks'        as const, label: `Tasks (${actions.length})`, icon: <ListChecks size={13} /> },
      { key: 'reasoning'    as const, label: 'Reasoning',    icon: <Activity size={13} /> },
      { key: 'timeline'     as const, label: `Timeline (${detail.timeline?.length || 0})`, icon: <MessageSquare size={13} /> },
      { key: 'report'       as const, label: 'Report',      icon: <FileText size={13} /> },
    ];

    return (
      <div className="overflow-y-auto h-full bg-[var(--s3)]">
        <div className="max-w-7xl mx-auto p-5 space-y-4">

          {/* Top bar */}
          <div className="flex items-center justify-between">
            <button onClick={() => setActiveId(null)} className="text-[var(--t4)] hover:text-[var(--p1)] flex items-center gap-1 text-[0.78rem] font-bold">
              <ChevronRight size={14} className="rotate-180" />Back to Incidents
            </button>
            <div className="flex items-center gap-2">
              <ProviderHealthBadge className="mr-1" />
              <code className="text-[0.7rem] font-mono bg-[var(--s1)] text-[var(--t5)] px-2 py-1 rounded">{detail.id}</code>
              <span className={`px-2 py-1 rounded text-[0.6rem] font-black uppercase tracking-widest border ${SEV_COLORS[detail.severity] || 'bg-gray-100 text-gray-700'}`}>{detail.severity}</span>
              <span className={`px-3 py-1 rounded-lg text-[0.65rem] font-black uppercase tracking-widest border ${STATUS_COLORS[detail.status] || 'bg-gray-100 text-gray-700'}`}>
                {STATUS_LABELS[detail.status] || detail.status}
              </span>
              <div className="flex items-center gap-1.5 ml-2">
                <span className={`w-2 h-2 rounded-full ${sla.color}`} />
                <span className="text-[0.65rem] font-bold text-[var(--t5)]">{sla.label}</span>
              </div>
            </div>
          </div>

          {/* Title + assignee */}
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-[1.25rem] font-black text-[var(--t7)]">{detail.title}</h2>
            {detail.assigned_to_username && (
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[var(--p1)] to-[var(--pd)] flex items-center justify-center text-white text-[0.55rem] font-black">
                  {detail.assigned_to_username.substring(0, 2).toUpperCase()}
                </div>
                <span className="text-[0.72rem] font-bold text-[var(--t5)]">{detail.assigned_to_username}</span>
              </div>
            )}
          </div>

          {/* Phase stepper */}
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4">
            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-3">Incident Response Lifecycle</p>
            <PhaseStepper current={detail.phase} />
          </div>

          {/* Two-column body */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">

            {/* Left column — tabbed content */}
            <div className="space-y-4">
              {/* Tab bar */}
              <div className="flex gap-1 bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-1 overflow-x-auto">
                {DETAIL_TABS.map(t => (
                  <button key={t.key} onClick={() => setDetailTab(t.key)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[0.72rem] font-bold whitespace-nowrap transition-all ${
                      detailTab === t.key
                        ? 'bg-[var(--p1)] text-white shadow-sm'
                        : 'text-[var(--t4)] hover:text-[var(--t7)] hover:bg-[var(--s1)]'
                    }`}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>

              {/* ===== OVERVIEW TAB ===== */}
              {detailTab === 'overview' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => fetchDetail(detail.id)} disabled={loadingDetail || reinvestigating}
                      title="Re-fetch this incident's latest data"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--b2)] bg-[var(--s0)] text-[var(--t6)] text-[0.7rem] font-bold hover:bg-[var(--s1)] disabled:opacity-50 transition-colors">
                      <RefreshCw size={13} className={loadingDetail ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <button onClick={handleRunInvestigation} disabled={reinvestigating}
                      title="Re-run all AI agents on this incident's alert"
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-violet-600 text-white text-[0.7rem] font-bold hover:bg-violet-700 disabled:opacity-60 transition-colors shadow-sm">
                      {reinvestigating
                        ? <><RefreshCw size={13} className="animate-spin" /> Running investigation...</>
                        : <><Zap size={13} /> Re-run investigation</>}
                    </button>
                  </div>

                  {/* Agent-run health: shows a failure reason + retry/refresh when the
                      incident's alert investigation failed or fell back. */}
                  <AgentRunStatus
                    loading={reinvestigating}
                    lastError={erroredAlert?.last_error}
                    lastErrorAt={erroredAlert?.last_error_at}
                    quotaExhausted={incidentAiMeta.quota_exhausted === true}
                    fallbackPhases={Array.isArray(incidentAiMeta.fallback_phases) ? incidentAiMeta.fallback_phases : []}
                    phaseErrors={incidentAiMeta.phase_errors || {}}
                    busy={reinvestigating}
                    onRetry={handleRunInvestigation}
                    onRefresh={() => fetchDetail(detail.id)}
                    retryLabel="Re-run investigation"
                  />

                  {/* ===== AI ANALYSIS & CONCLUSION — first, so analysts don't scroll past alerts ===== */}
                  {(ai.summary || ai.ticket_summary || realReason(detail.reason) || ai.intel_summary || ai.recommended_action || ai.business_impact || (ai.mitre && ai.mitre.length > 0) || (ai.response_actions && ai.response_actions.length > 0)) ? (
                    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                      <div className="px-4 py-2.5 bg-gradient-to-r from-violet-50 to-[var(--s1)] border-b border-[var(--b1)] flex items-center gap-2 flex-wrap">
                        <Activity size={14} className="text-violet-600" />
                        <p className="text-[0.75rem] font-black text-[var(--t7)]">AI Analysis &amp; Conclusion</p>
                        <div className="ml-auto flex items-center gap-1.5">
                          {ai.risk_score != null && <span className="text-[0.55rem] font-black text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full uppercase tracking-widest">Risk {ai.risk_score}</span>}
                          {ai.confidence != null && <span className="text-[0.55rem] font-black text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full uppercase tracking-widest">{Math.round(ai.confidence * 100)}% conf</span>}
                        </div>
                      </div>
                      <div className="p-4 space-y-4 text-[0.78rem] text-[var(--t6)] leading-relaxed">
                        {/* Why escalated (real reasons only — legacy backfill placeholder suppressed) */}
                        {realReason(detail.reason) && (
                          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                            <p className="text-[0.55rem] font-black text-orange-800 uppercase tracking-widest mb-1">Why this was escalated</p>
                            <p className="text-orange-900 text-[0.74rem] whitespace-pre-line">{realReason(detail.reason)}</p>
                          </div>
                        )}

                        {/* AI report — the rich, synthesised markdown report (preferred),
                            else the triage summary. Rendered as Markdown. */}
                        {(ai.ticket_summary || ai.summary) ? (
                          <div>
                            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">AI Report</p>
                            <Markdown>{String(ai.ticket_summary || ai.summary)}</Markdown>
                          </div>
                        ) : (
                          <p className="text-[0.74rem] text-[var(--t4)] italic">No AI summary recorded yet. Use the Re-run investigation button above to generate one.</p>
                        )}

                        {/* Key facts grid */}
                        {(() => {
                          const stats = [
                            { label: 'Verdict / Category', value: ai.attack_category },
                            { label: 'Kill Chain Stage',   value: ai.kill_chain_stage },
                            { label: 'Threat Actor',       value: ai.threat_actor || ai.threat_actor_type },
                            { label: 'Campaign',           value: ai.correlation || ai.campaign_family },
                            { label: 'Risk Score',         value: ai.risk_score != null ? String(ai.risk_score) : null },
                            { label: 'FP Likelihood',      value: ai.fp_confidence != null ? `${Math.round(ai.fp_confidence * 100)}%` : null },
                            { label: 'SLA / Validation',   value: ai.validation_status },
                          ].filter(x => x.value);
                          return stats.length ? (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                              {stats.map((item, idx) => (
                                <div key={idx} className="bg-[var(--s1)] rounded-lg p-2.5 border border-[var(--b2)]">
                                  <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase tracking-widest mb-0.5">{item.label}</p>
                                  <p className="font-mono text-[0.7rem] text-[var(--t7)] font-bold truncate" title={String(item.value)}>{item.value}</p>
                                </div>
                              ))}
                            </div>
                          ) : null;
                        })()}

                        {/* Threat-intel narrative — only when there's no full report (else it's covered) */}
                        {ai.intel_summary && !ai.ticket_summary && (
                          <div>
                            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">Threat Intelligence</p>
                            <Markdown>{String(ai.intel_summary)}</Markdown>
                          </div>
                        )}

                        {/* MITRE + TTP chips */}
                        {((ai.mitre && ai.mitre.length > 0) || (ai.ttp_tags && ai.ttp_tags.length > 0)) && (
                          <div>
                            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">MITRE ATT&CK / TTPs</p>
                            <div className="flex gap-1.5 flex-wrap">
                              {(ai.mitre || []).slice(0, 20).map((t: any, i: number) => (
                                <span key={`m${i}`} className="px-2 py-1 rounded-lg bg-violet-50 text-violet-700 text-[0.6rem] font-mono border border-violet-200">{t}</span>
                              ))}
                              {(ai.ttp_tags || []).slice(0, 12).map((t: any, i: number) => (
                                <span key={`t${i}`} className="px-2 py-1 rounded-lg bg-[var(--s1)] text-[var(--t5)] text-[0.6rem] border border-[var(--b2)]">{String(t)}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* IOCs */}
                        {ai.iocs && Object.values(ai.iocs).some((v: any) => Array.isArray(v) && v.length) && (
                          <div>
                            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">Indicators of Compromise</p>
                            <div className="space-y-1.5">
                              {Object.entries(ai.iocs).filter(([, v]) => Array.isArray(v) && (v as any[]).length).map(([k, v]) => (
                                <div key={k} className="flex items-start gap-2">
                                  <span className="text-[0.5rem] font-black text-[var(--t3)] uppercase tracking-widest w-16 shrink-0 mt-1">{k}</span>
                                  <div className="flex gap-1.5 flex-wrap">
                                    {(v as any[]).slice(0, 12).map((x, i) => (
                                      <code key={i} className="px-1.5 py-0.5 rounded bg-[var(--s1)] text-[var(--t6)] text-[0.6rem] font-mono border border-[var(--b2)] break-all">{String(x)}</code>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Recommended response */}
                        {(ai.recommended_action || (ai.response_actions && ai.response_actions.length > 0)) && (
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <p className="text-[0.55rem] font-black text-blue-800 uppercase tracking-widest mb-1">Recommended Response</p>
                            {ai.recommended_action && <p className="font-mono font-bold text-blue-900 text-[0.72rem] whitespace-pre-line mb-1.5">{ai.recommended_action}</p>}
                            {ai.response_actions && ai.response_actions.length > 0 && (
                              <ul className="space-y-1">
                                {ai.response_actions.slice(0, 8).map((act: any, i: number) => (
                                  <li key={i} className="text-[0.68rem] text-blue-900 flex items-start gap-1.5">
                                    <span className="text-blue-500 mt-0.5">▸</span>
                                    <span>
                                      <span className="font-bold">{String(act.type || act.action || 'action').replace(/_/g, ' ')}</span>
                                      {act.target ? <> → <span className="font-mono">{String(act.target)}</span></> : null}
                                      {act.description ? <> — {String(act.description)}</> : null}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}

                        {/* Remediation / playbook — only when there's no full report */}
                        {ai.remediation && !ai.ticket_summary && (
                          <div>
                            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">Remediation / Playbook</p>
                            <Markdown>{typeof ai.remediation === 'string' ? ai.remediation : JSON.stringify(ai.remediation)}</Markdown>
                          </div>
                        )}

                        {/* Business impact — only when there's no full report */}
                        {ai.business_impact && !ai.ticket_summary && (
                          <div>
                            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">Business Impact</p>
                            <Markdown>{typeof ai.business_impact === 'string' ? ai.business_impact : JSON.stringify(ai.business_impact)}</Markdown>
                          </div>
                        )}

                        {/* Affected systems */}
                        {ai.affected_systems && (Array.isArray(ai.affected_systems) ? ai.affected_systems.length > 0 : true) && (
                          <div>
                            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">Affected Systems</p>
                            {Array.isArray(ai.affected_systems) ? (
                              <div className="flex gap-1.5 flex-wrap">
                                {ai.affected_systems.map((s: any, i: number) => (
                                  <span key={i} className="px-2 py-1 rounded-lg bg-[var(--s1)] text-[var(--t6)] text-[0.66rem] font-mono border border-[var(--b2)]">{String(s)}</span>
                                ))}
                              </div>
                            ) : (
                              <p className="whitespace-pre-line">{String(ai.affected_systems)}</p>
                            )}
                          </div>
                        )}

                        {/* Correlation narrative — only when there's no full report */}
                        {ai.correlation_summary && !ai.ticket_summary && (
                          <div>
                            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">
                              Correlation{ai.correlation ? ` — ${ai.correlation}` : ''}
                            </p>
                            <Markdown>{String(ai.correlation_summary)}</Markdown>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-8 text-center">
                      <Activity size={26} className="mx-auto text-[var(--t3)] opacity-50 mb-2" />
                      <p className="text-[0.82rem] font-bold text-[var(--t6)]">No AI analysis recorded for this incident yet</p>
                      <p className="text-[0.7rem] text-[var(--t3)] mt-1 max-w-md mx-auto">
                        This incident was escalated without a full agent investigation. Run the agents now to generate the AI summary, threat intel, IOCs and recommended actions.
                      </p>
                      <button
                        onClick={handleRunInvestigation}
                        disabled={reinvestigating}
                        className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-[0.74rem] font-bold hover:bg-violet-700 disabled:opacity-60 transition-colors"
                      >
                        {reinvestigating
                          ? <><RefreshCw size={13} className="animate-spin" /> Running investigation…</>
                          : <><Zap size={13} /> Run AI Investigation</>}
                      </button>
                    </div>
                  )}

                  {/* ===== Correlated alerts — compact, scrollable, expandable (after the AI summary) ===== */}
                  {(detail.alerts && detail.alerts.length > 0) ? (
                    <CorrelatedAlertsTable alerts={detail.alerts} />
                  ) : (
                    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-6 text-center text-[var(--t3)] text-[0.72rem]">
                      No Wazuh alerts linked to this incident.
                    </div>
                  )}

                </div>
              )}

              {/* ===== OBSERVABLES TAB ===== */}
              {detailTab === 'observables' && (
                <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-[var(--s1)] border-b border-[var(--b1)] flex items-center gap-2">
                    <Crosshair size={13} className="text-orange-600" />
                    <p className="text-[0.72rem] font-black text-[var(--t7)]">Observables & Indicators of Compromise</p>
                  </div>
                  {observables.length === 0 ? (
                    <div className="p-10 text-center">
                      <Crosshair size={28} className="mx-auto text-[var(--t3)] mb-2" />
                      <p className="text-[0.82rem] font-semibold text-[var(--t5)]">No observables extracted</p>
                      <p className="text-[0.7rem] text-[var(--t3)] mt-1">IOCs will appear here once the AI analysis identifies indicators.</p>
                    </div>
                  ) : (
                    <div>
                      {/* Summary chips */}
                      <div className="px-4 py-3 border-b border-[var(--b1)] flex gap-2 flex-wrap">
                        {(['ip', 'domain', 'hostname', 'username', 'hash', 'url', 'filename'] as const).map(type => {
                          const count = observables.filter(o => o.type === type).length;
                          if (count === 0) return null;
                          const Ico = OBSERVABLE_ICONS[type] || Globe;
                          return (
                            <span key={type} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--s1)] border border-[var(--b2)] text-[0.62rem] font-bold text-[var(--t5)]">
                              <Ico size={11} /> {type} <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-[var(--p1)] text-white text-[0.5rem] font-black">{count}</span>
                            </span>
                          );
                        })}
                      </div>
                      {/* Table */}
                      <table className="w-full text-[0.72rem]">
                        <thead>
                          <tr className="border-b border-[var(--b1)] text-[var(--t3)]">
                            <th className="text-left px-4 py-2 text-[0.55rem] font-black uppercase tracking-widest">Type</th>
                            <th className="text-left px-4 py-2 text-[0.55rem] font-black uppercase tracking-widest">Value</th>
                            <th className="text-left px-4 py-2 text-[0.55rem] font-black uppercase tracking-widest">Source</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--b1)]">
                          {observables.map((o, idx) => {
                            const Ico = OBSERVABLE_ICONS[o.type] || Globe;
                            return (
                              <tr key={idx} className="hover:bg-[var(--s1)] transition-colors">
                                <td className="px-4 py-2.5">
                                  <span className="flex items-center gap-1.5 text-[var(--t5)]">
                                    <Ico size={12} className="text-[var(--t3)]" />
                                    <span className="font-bold uppercase text-[0.6rem]">{o.type}</span>
                                  </span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <code className="font-mono text-[0.7rem] text-[var(--t7)] bg-[var(--s1)] px-2 py-0.5 rounded select-all">{o.value}</code>
                                </td>
                                <td className="px-4 py-2.5 text-[var(--t4)] text-[0.65rem]">{o.source}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ===== TASKS TAB ===== */}
              {detailTab === 'tasks' && (
                <div className="space-y-4">
                  {/* Task summary cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'Total', value: actions.length, color: 'text-[var(--p1)]' },
                      { label: 'Pending', value: actions.filter(a => a.status === 'pending').length, color: 'text-blue-600' },
                      { label: 'Executed', value: actions.filter(a => a.status === 'executed').length, color: 'text-green-600' },
                      { label: 'Failed', value: actions.filter(a => a.status === 'failed').length, color: 'text-red-600' },
                    ].map((s, i) => (
                      <div key={i} className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3 text-center">
                        <p className={`text-[1.1rem] font-black ${s.color}`}>{s.value}</p>
                        <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase tracking-widest">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Progress bar */}
                  {actions.length > 0 && (
                    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[0.62rem] font-bold text-[var(--t5)]">Completion Progress</p>
                        <p className="text-[0.62rem] font-mono text-[var(--t3)]">{actions.filter(a => a.status === 'executed').length}/{actions.length}</p>
                      </div>
                      <div className="h-2 bg-[var(--s2)] rounded-full overflow-hidden flex">
                        <div className="bg-green-500 transition-all" style={{ width: `${(actions.filter(a => a.status === 'executed').length / actions.length) * 100}%` }} />
                        <div className="bg-red-400 transition-all" style={{ width: `${(actions.filter(a => a.status === 'failed').length / actions.length) * 100}%` }} />
                        <div className="bg-gray-300 transition-all" style={{ width: `${(actions.filter(a => a.status === 'skipped').length / actions.length) * 100}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Response Actions */}
                  <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 bg-[var(--s1)] border-b border-[var(--b1)] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Zap size={13} className="text-amber-600" />
                        <p className="text-[0.72rem] font-black text-[var(--t7)]">Response Actions</p>
                      </div>
                      {!isClosed && canEdit && (
                        <button onClick={() => setShowAddAction(s => !s)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.62rem] font-bold text-white bg-[var(--p1)] hover:bg-[var(--pd)] transition-colors">
                          {showAddAction ? <><X size={11} /> Cancel</> : <><Plus size={11} /> Add Action</>}
                        </button>
                      )}
                    </div>

                    {showAddAction && (
                      <div className="px-4 py-3 bg-[var(--sa)] border-b border-[var(--b1)] space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <select value={newAction.action_type} onChange={e => setNewAction({ ...newAction, action_type: e.target.value })}
                            className="border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)]">
                            {Object.entries(ACTION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                          <select value={newAction.priority} onChange={e => setNewAction({ ...newAction, priority: e.target.value })}
                            className="border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)]">
                            {['CRITICAL','HIGH','MEDIUM','LOW'].map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                        <input value={newAction.target} onChange={e => setNewAction({ ...newAction, target: e.target.value })} placeholder="Target (IP / host / user) — optional"
                          className="w-full border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)] font-mono" />
                        <textarea value={newAction.description} onChange={e => setNewAction({ ...newAction, description: e.target.value })} rows={2} placeholder="Action description..."
                          className="w-full border border-[var(--b2)] rounded px-2 py-1 text-[0.7rem] bg-[var(--s0)] resize-none" />
                        <div className="flex justify-end">
                          <button onClick={handleAddAction} disabled={!newAction.description.trim()}
                            className="px-3 py-1 rounded bg-[var(--p1)] text-white text-[0.7rem] font-bold disabled:opacity-50">Add</button>
                        </div>
                      </div>
                    )}

                    <div className="divide-y divide-[var(--b1)]">
                      {actions.length === 0 ? (
                        <div className="p-8 text-center">
                          <ListChecks size={28} className="mx-auto text-[var(--t3)] mb-2" />
                          <p className="text-[0.82rem] font-semibold text-[var(--t5)]">No response actions yet</p>
                          {!isClosed && canEdit && <p className="text-[0.7rem] text-[var(--t3)] mt-1">Click <span className="font-bold text-[var(--p1)]">+ Add Action</span> to create one.</p>}
                        </div>
                      ) : actions.map((a, i) => (
                        <ActionRow
                          key={a.id}
                          action={a}
                          index={i}
                          total={actions.length}
                          isClosed={isClosed || !canEdit}
                          onMoveUp={()   => handleReorder(i, i - 1)}
                          onMoveDown={() => handleReorder(i, i + 1)}
                          onDelete={()   => setDeleteActionTarget(a)}
                          onSave={(p)    => handleActionEdit(a, p)}
                          onStatus={(s)  => handleActionStatus(a, s)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ===== REASONING TAB =====
                  Visual chain-of-thought across every AI agent that touched
                  this incident. Grouped into Triage / Investigation / Composition
                  with per-agent cards showing decision, evidence, and rejected
                  hypotheses. */}
              {detailTab === 'reasoning' && (() => {
                const AGENT_META: Record<string, { icon: any; label: string; tagline: string; color: string; ring: string; bg: string; dot: string }> = {
                  analysis:    { icon: Search,      label: 'Triage Analyst',  tagline: 'Extracts IOCs, validates severity, flags false positives', color: 'text-violet-700 dark:text-violet-300',  ring: 'ring-violet-200 dark:ring-violet-900',  bg: 'from-violet-50 to-transparent dark:from-violet-950/40',  dot: 'bg-violet-500' },
                  intel:       { icon: Crosshair,   label: 'Threat Intel',    tagline: 'Maps IOCs to MITRE ATT&CK and assesses reputation',    color: 'text-blue-700 dark:text-blue-300',      ring: 'ring-blue-200 dark:ring-blue-900',      bg: 'from-blue-50 to-transparent dark:from-blue-950/40',      dot: 'bg-blue-500' },
                  knowledge:   { icon: BookOpen,    label: 'Knowledge / RAG', tagline: 'Pulls relevant playbooks and remediation steps',       color: 'text-amber-700 dark:text-amber-300',    ring: 'ring-amber-200 dark:ring-amber-900',    bg: 'from-amber-50 to-transparent dark:from-amber-950/40',    dot: 'bg-amber-500' },
                  correlation: { icon: Link2,       label: 'Correlation',     tagline: 'Detects multi-alert campaigns and kill-chain stages',  color: 'text-pink-700 dark:text-pink-300',      ring: 'ring-pink-200 dark:ring-pink-900',      bg: 'from-pink-50 to-transparent dark:from-pink-950/40',      dot: 'bg-pink-500' },
                  recall:      { icon: Clock,       label: 'Memory Recall',   tagline: 'Finds semantically similar prior incidents',           color: 'text-indigo-700 dark:text-indigo-300',  ring: 'ring-indigo-200 dark:ring-indigo-900',  bg: 'from-indigo-50 to-transparent dark:from-indigo-950/40',  dot: 'bg-indigo-500' },
                  ioc_check:   { icon: Hash,        label: 'IOC History',     tagline: 'Checks indicators against historical IOC memory',      color: 'text-teal-700 dark:text-teal-300',      ring: 'ring-teal-200 dark:ring-teal-900',      bg: 'from-teal-50 to-transparent dark:from-teal-950/40',      dot: 'bg-teal-500' },
                  ticketing:   { icon: FileText,    label: 'Ticketing',       tagline: 'Authors the incident ticket and sets priority',        color: 'text-cyan-700 dark:text-cyan-300',      ring: 'ring-cyan-200 dark:ring-cyan-900',      bg: 'from-cyan-50 to-transparent dark:from-cyan-950/40',      dot: 'bg-cyan-500' },
                  response:    { icon: Zap,         label: 'Response',        tagline: 'Recommends containment actions and target assets',    color: 'text-orange-700 dark:text-orange-300',  ring: 'ring-orange-200 dark:ring-orange-900',  bg: 'from-orange-50 to-transparent dark:from-orange-950/40',  dot: 'bg-orange-500' },
                  validation:  { icon: CheckCircle, label: 'Validation',      tagline: 'Verifies plan completeness and SLA alignment',         color: 'text-emerald-700 dark:text-emerald-300',ring: 'ring-emerald-200 dark:ring-emerald-900',bg: 'from-emerald-50 to-transparent dark:from-emerald-950/40',dot: 'bg-emerald-500' },
                };
                const fallbackMeta = { icon: Activity, label: 'Agent', tagline: '', color: 'text-[var(--t6)]', ring: 'ring-[var(--b1)]', bg: 'from-[var(--s1)] to-transparent', dot: 'bg-slate-400' };

                const PHASES: Array<{ key: 'triage' | 'investigation' | 'composition'; label: string; sub: string; agents: string[] }> = [
                  { key: 'triage',        label: 'Triage',        sub: 'Initial verdict',                agents: ['analysis'] },
                  { key: 'investigation', label: 'Investigation', sub: 'Parallel evidence gathering',    agents: ['intel', 'knowledge', 'correlation', 'recall', 'ioc_check'] },
                  { key: 'composition',   label: 'Composition',   sub: 'Ticket, response, validation',   agents: ['ticketing', 'response', 'validation'] },
                ];

                const groupedByPhase = PHASES.map(p => ({
                  ...p,
                  rows: reasoning.filter(r => p.agents.includes(r.agent)),
                })).filter(p => p.rows.length > 0);

                const otherRows = reasoning.filter(r => !PHASES.some(p => p.agents.includes(r.agent)));
                if (otherRows.length > 0) {
                  groupedByPhase.push({ key: 'composition', label: 'Other', sub: 'Misc agent reasoning', agents: [], rows: otherRows });
                }

                const totalAgents = new Set(reasoning.map(r => r.agent)).size;
                const avgConfidence = reasoning.length > 0
                  ? Math.round((reasoning.reduce((s, r) => s + (r.confidence || 0), 0) / reasoning.length) * 100)
                  : 0;
                const firstAt = reasoning[0]?.created_at;
                const lastAt  = reasoning[reasoning.length - 1]?.created_at;
                const elapsedMs = (firstAt && lastAt) ? (new Date(lastAt).getTime() - new Date(firstAt).getTime()) : 0;
                const elapsedLabel = elapsedMs < 1000 ? '< 1s'
                                   : elapsedMs < 60_000  ? `${Math.round(elapsedMs / 1000)}s`
                                   : elapsedMs < 3600_000 ? `${Math.round(elapsedMs / 60_000)}m`
                                   : `${(elapsedMs / 3600_000).toFixed(1)}h`;

                const overallVerdictColor =
                  avgConfidence >= 85 ? 'text-emerald-600 dark:text-emerald-400' :
                  avgConfidence >= 60 ? 'text-amber-600 dark:text-amber-400'     :
                                        'text-red-500 dark:text-red-400';
                const overallBarColor =
                  avgConfidence >= 85 ? 'bg-emerald-500' :
                  avgConfidence >= 60 ? 'bg-amber-500'   :
                                        'bg-red-500';

                return (
                  <div className="space-y-4">
                    {/* ── Hero summary card ─────────────────────────────────────── */}
                    <div className="bg-gradient-to-br from-violet-50 via-[var(--s0)] to-blue-50 dark:from-violet-950/30 dark:via-[var(--s0)] dark:to-blue-950/30 border border-[var(--b1)] rounded-2xl shadow-sm overflow-hidden">
                      <div className="px-5 py-4 flex items-center gap-3 border-b border-[var(--b1)]">
                        <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center shadow-sm">
                          <Activity size={17} className="text-white" />
                        </div>
                        <div className="flex-1">
                          <p className="text-[0.95rem] font-black text-[var(--t7)] leading-tight">Reasoning Timeline</p>
                          <p className="text-[0.66rem] text-[var(--t3)] mt-0.5">How the AI agents thought through this incident, step by step</p>
                        </div>
                      </div>

                      {loadingReasoning ? (
                        <div className="p-10 text-center">
                          <RefreshCw size={18} className="inline animate-spin text-violet-500 mb-2" />
                          <p className="text-[0.72rem] text-[var(--t3)]">Loading reasoning trace…</p>
                        </div>
                      ) : reasoning.length === 0 ? (
                        <div className="p-10 text-center space-y-3">
                          <Activity size={28} className="inline text-[var(--t3)] opacity-50" />
                          <p className="text-[0.85rem] font-bold text-[var(--t6)]">No reasoning recorded yet</p>
                          <p className="text-[0.7rem] text-[var(--t3)] max-w-md mx-auto">
                            This incident's alerts were escalated without a full agent investigation
                            (e.g. auto-escalated or imported), so there's nothing to show. Run the agents
                            now to capture per-agent reasoning for this incident.
                          </p>
                          <button
                            onClick={handleRunInvestigation}
                            disabled={reinvestigating}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-[0.72rem] font-bold hover:bg-violet-700 disabled:opacity-60"
                          >
                            {reinvestigating
                              ? <><RefreshCw size={13} className="animate-spin" /> Running investigation…</>
                              : <><Activity size={13} /> Run Investigation</>}
                          </button>
                        </div>
                      ) : (
                        <div className="px-5 py-5 grid grid-cols-1 sm:grid-cols-4 gap-4">
                          {/* Overall confidence */}
                          <div>
                            <p className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)] mb-1.5">Avg confidence</p>
                            <div className="flex items-baseline gap-1">
                              <span className={`text-[1.85rem] font-black tabular-nums leading-none ${overallVerdictColor}`}>{avgConfidence}</span>
                              <span className={`text-[0.85rem] font-bold ${overallVerdictColor}`}>%</span>
                            </div>
                            <div className="mt-2 h-1.5 rounded-full bg-[var(--s2)] overflow-hidden">
                              <div className={`h-full ${overallBarColor} transition-all duration-500`} style={{ width: `${avgConfidence}%` }} />
                            </div>
                          </div>

                          {/* Agents that contributed */}
                          <div>
                            <p className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)] mb-1.5">Agents</p>
                            <div className="flex items-baseline gap-1">
                              <span className="text-[1.85rem] font-black tabular-nums leading-none text-[var(--t7)]">{totalAgents}</span>
                              <span className="text-[0.7rem] text-[var(--t3)] font-bold">distinct</span>
                            </div>
                            <div className="mt-2 flex items-center gap-1 flex-wrap">
                              {Array.from(new Set(reasoning.map(r => r.agent))).slice(0, 9).map((a: string) => {
                                const m = AGENT_META[a] ?? fallbackMeta;
                                const Icon = m.icon;
                                return (
                                  <span key={a} title={m.label} className={`w-5 h-5 rounded-md flex items-center justify-center ring-1 ${m.ring} bg-[var(--s0)]`}>
                                    <Icon size={11} className={m.color} />
                                  </span>
                                );
                              })}
                            </div>
                          </div>

                          {/* Steps */}
                          <div>
                            <p className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)] mb-1.5">Reasoning steps</p>
                            <div className="flex items-baseline gap-1">
                              <span className="text-[1.85rem] font-black tabular-nums leading-none text-[var(--t7)]">{reasoning.length}</span>
                              <span className="text-[0.7rem] text-[var(--t3)] font-bold">total</span>
                            </div>
                            <p className="text-[0.6rem] text-[var(--t3)] mt-2">
                              across <span className="font-bold text-[var(--t6)]">{groupedByPhase.length}</span> phase{groupedByPhase.length === 1 ? '' : 's'}
                            </p>
                          </div>

                          {/* Elapsed */}
                          <div>
                            <p className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)] mb-1.5">Time elapsed</p>
                            <div className="flex items-baseline gap-1">
                              <span className="text-[1.85rem] font-black tabular-nums leading-none text-[var(--t7)]">{elapsedLabel}</span>
                            </div>
                            <p className="text-[0.6rem] text-[var(--t3)] mt-2 truncate" title={firstAt ? new Date(firstAt).toLocaleString() : ''}>
                              start: <span className="font-mono">{firstAt ? new Date(firstAt).toLocaleTimeString() : '—'}</span>
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ── Phase-grouped reasoning cards ─────────────────────────── */}
                    {!loadingReasoning && reasoning.length > 0 && groupedByPhase.map((phase, phaseIdx) => (
                      <div key={`${phase.key}-${phaseIdx}`} className="space-y-3">
                        {/* Phase header */}
                        <div className="flex items-center gap-3 px-1">
                          <div className="flex items-center gap-2">
                            <span className="w-7 h-7 rounded-lg bg-[var(--p1)] text-white flex items-center justify-center text-[0.7rem] font-black shadow-sm">
                              {phaseIdx + 1}
                            </span>
                            <div>
                              <p className="text-[0.85rem] font-black text-[var(--t7)] leading-tight">{phase.label}</p>
                              <p className="text-[0.6rem] text-[var(--t3)] font-semibold">{phase.sub}</p>
                            </div>
                          </div>
                          <div className="flex-1 h-px bg-gradient-to-r from-[var(--b1)] to-transparent" />
                          <span className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest">
                            {phase.rows.length} agent{phase.rows.length === 1 ? '' : 's'}
                          </span>
                        </div>

                        {/* Agent cards inside this phase */}
                        <div className="relative space-y-3 pl-3">
                          {/* Vertical connector line */}
                          <div className="absolute left-[18px] top-3 bottom-3 w-px bg-gradient-to-b from-[var(--b1)] via-[var(--b1)] to-transparent" />

                          {phase.rows.map((r, rowIdx) => {
                            const meta = AGENT_META[r.agent] ?? fallbackMeta;
                            const Icon = meta.icon;
                            const conf = Math.round((r.confidence || 0) * 100);
                            const confColor =
                              conf >= 85 ? 'text-emerald-600 dark:text-emerald-400' :
                              conf >= 60 ? 'text-amber-600 dark:text-amber-400'     :
                                           'text-red-500 dark:text-red-400';
                            const confBar =
                              conf >= 85 ? 'bg-emerald-500' :
                              conf >= 60 ? 'bg-amber-500'   :
                                           'bg-red-500';
                            const isLast = rowIdx === phase.rows.length - 1;

                            return (
                              <div key={r.id} className="relative">
                                {/* Connector dot */}
                                <span className={`absolute left-[10px] top-5 w-3 h-3 rounded-full ${meta.dot} ring-4 ring-[var(--s0)] z-10`} />

                                <div className={`ml-8 relative overflow-hidden border border-[var(--b1)] rounded-xl bg-gradient-to-br ${meta.bg} hover:shadow-md transition-shadow`}>
                                  {/* Card header */}
                                  <div className="px-4 py-3 flex items-start gap-3 border-b border-[var(--b1)]/60 bg-[var(--s0)]/70 backdrop-blur-sm">
                                    <div className={`shrink-0 w-10 h-10 rounded-xl ring-1 ${meta.ring} bg-[var(--s0)] flex items-center justify-center shadow-sm`}>
                                      <Icon size={18} className={meta.color} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <p className={`text-[0.82rem] font-black ${meta.color}`}>{meta.label}</p>
                                        <span className="text-[0.55rem] font-bold text-[var(--t3)] uppercase tracking-widest">
                                          step {r.step}
                                        </span>
                                      </div>
                                      <p className="text-[0.62rem] text-[var(--t3)] mt-0.5 truncate">{meta.tagline}</p>
                                    </div>
                                    <div className="shrink-0 text-right">
                                      <p className={`text-[1.05rem] font-black tabular-nums leading-none ${confColor}`}>{conf}%</p>
                                      <p className="text-[0.55rem] font-bold text-[var(--t3)] uppercase tracking-wider mt-0.5">confidence</p>
                                    </div>
                                  </div>

                                  {/* Confidence bar */}
                                  <div className="h-1 bg-[var(--s2)] overflow-hidden">
                                    <div className={`h-full ${confBar} transition-all duration-700`} style={{ width: `${conf}%` }} />
                                  </div>

                                  {/* Body */}
                                  <div className="p-4 space-y-3">
                                    {/* Decision — hero text */}
                                    {r.decision && (
                                      <div className="flex gap-2.5">
                                        <span className={`shrink-0 w-1 rounded-full ${meta.dot}`} />
                                        <p className="text-[0.85rem] text-[var(--t7)] leading-relaxed font-medium italic">
                                          “{r.decision}”
                                        </p>
                                      </div>
                                    )}

                                    {/* Evidence for / against — visual two-column */}
                                    {(r.evidence_for?.length > 0 || r.evidence_against?.length > 0) && (
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                        {r.evidence_for?.length > 0 && (
                                          <div className="group bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 rounded-xl p-3 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-950/50">
                                            <div className="flex items-center gap-1.5 mb-2">
                                              <ThumbsUp size={11} className="text-emerald-600 dark:text-emerald-400" />
                                              <p className="text-[0.58rem] font-black text-emerald-700 dark:text-emerald-300 uppercase tracking-widest">
                                                Evidence for ({r.evidence_for.length})
                                              </p>
                                            </div>
                                            <ul className="space-y-1.5">
                                              {r.evidence_for.map((e, i) => (
                                                <li key={i} className="text-[0.74rem] text-[var(--t7)] leading-relaxed flex gap-2">
                                                  <span className="text-emerald-600 dark:text-emerald-400 shrink-0 font-bold mt-0.5">＋</span>
                                                  <span className="flex-1">{e}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                        {r.evidence_against?.length > 0 && (
                                          <div className="group bg-red-50/80 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 rounded-xl p-3 transition-colors hover:bg-red-50 dark:hover:bg-red-950/50">
                                            <div className="flex items-center gap-1.5 mb-2">
                                              <ThumbsDown size={11} className="text-red-600 dark:text-red-400" />
                                              <p className="text-[0.58rem] font-black text-red-700 dark:text-red-300 uppercase tracking-widest">
                                                Evidence against ({r.evidence_against.length})
                                              </p>
                                            </div>
                                            <ul className="space-y-1.5">
                                              {r.evidence_against.map((e, i) => (
                                                <li key={i} className="text-[0.74rem] text-[var(--t7)] leading-relaxed flex gap-2">
                                                  <span className="text-red-500 dark:text-red-400 shrink-0 font-bold mt-0.5">−</span>
                                                  <span className="flex-1">{e}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* Rejected hypotheses — considered & discarded */}
                                    {r.rejected_hypotheses?.length > 0 && (
                                      <div className="bg-[var(--s1)] border border-[var(--b1)] rounded-xl p-3">
                                        <div className="flex items-center gap-1.5 mb-2">
                                          <XCircle size={11} className="text-[var(--t3)]" />
                                          <p className="text-[0.58rem] font-black text-[var(--t3)] uppercase tracking-widest">
                                            Considered &amp; rejected ({r.rejected_hypotheses.length})
                                          </p>
                                        </div>
                                        <ul className="space-y-1.5">
                                          {r.rejected_hypotheses.map((h, i) => (
                                            <li key={i} className="text-[0.72rem] text-[var(--t4)] leading-relaxed flex gap-2">
                                              <span className="shrink-0 text-[var(--t3)] mt-0.5">✗</span>
                                              <span className="line-through decoration-[var(--t3)]/40 flex-1">{h}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {/* Empty body fallback */}
                                    {!r.decision && !(r.evidence_for?.length) && !(r.evidence_against?.length) && !(r.rejected_hypotheses?.length) && (
                                      <p className="text-[0.7rem] text-[var(--t3)] italic">This agent ran but did not emit structured reasoning.</p>
                                    )}
                                  </div>

                                  {/* Footer — subtle metadata */}
                                  <div className="px-4 py-2 border-t border-[var(--b1)]/60 bg-[var(--s1)]/40 flex items-center gap-2 flex-wrap">
                                    <span className="text-[0.55rem] text-[var(--t3)] tabular-nums">
                                      {new Date(r.created_at).toLocaleString()}
                                    </span>
                                    <span className="text-[var(--t3)] text-[0.5rem]">•</span>
                                    <span className="text-[0.55rem] text-[var(--t3)] font-mono" title={`alert ${r.alert_id} · trace ${r.trace_id}`}>
                                      alert {r.alert_id.slice(0, 8)}… · trace {r.trace_id.slice(0, 6)}…
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ===== TIMELINE TAB ===== */}
              {detailTab === 'timeline' && (
                <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-[var(--s1)] border-b border-[var(--b1)] flex items-center gap-2">
                    <MessageSquare size={13} className="text-green-600" />
                    <p className="text-[0.72rem] font-black text-[var(--t7)]">Activity & Comments</p>
                  </div>
                  {!isClosed && (
                    <div className="px-4 py-3 bg-[var(--sa)] border-b border-[var(--b1)] flex gap-2">
                      <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={2} placeholder="Add a comment..."
                        className="flex-1 border border-[var(--b2)] rounded-lg px-3 py-2 text-[0.72rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)] resize-none" />
                      <button onClick={handleAddNote} disabled={!noteText.trim()}
                        className="px-4 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.7rem] font-bold disabled:opacity-50 self-start flex items-center gap-1">
                        <Send size={11} /> Comment
                      </button>
                    </div>
                  )}
                  <div className="divide-y divide-[var(--b1)]">
                    {(detail.timeline || []).length === 0 ? (
                      <div className="p-8 text-center text-[var(--t3)] text-[0.72rem]">No activity recorded yet.</div>
                    ) : (detail.timeline || []).slice().reverse().map(t => {
                      const eventColor =
                        t.event_type === 'created'         ? 'bg-blue-500' :
                        t.event_type === 'phase_change'    ? 'bg-orange-500' :
                        t.event_type === 'assigned'        ? 'bg-purple-500' :
                        t.event_type === 'closed'          ? 'bg-gray-500' :
                        t.event_type === 'reclassified_fp' ? 'bg-pink-500' :
                        t.event_type === 'status_change'   ? 'bg-indigo-500' :
                        'bg-green-500';
                      const eventIcon =
                        t.event_type === 'created'         ? <Plus size={10} /> :
                        t.event_type === 'phase_change'    ? <ChevronRight size={10} /> :
                        t.event_type === 'assigned'        ? <UserPlus size={10} /> :
                        t.event_type === 'closed'          ? <XCircle size={10} /> :
                        t.event_type === 'reclassified_fp' ? <ThumbsDown size={10} /> :
                        t.event_type === 'status_change'   ? <Activity size={10} /> :
                        <MessageSquare size={10} />;
                      return (
                        <div key={t.id} className="px-4 py-3 flex items-start gap-3 hover:bg-[var(--s1)] transition-colors">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white ${eventColor}`}>
                            {eventIcon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[0.72rem] text-[var(--t6)]">
                              <span className="font-bold">{t.username || 'system'}</span>
                              {t.event_type === 'phase_change'    && <> moved phase <span className="font-mono bg-[var(--s1)] px-1.5 py-0.5 rounded text-[0.6rem]">{t.phase_from} → {t.phase_to}</span></>}
                              {t.event_type === 'status_change'   && <> changed status <span className="font-mono bg-[var(--s1)] px-1.5 py-0.5 rounded text-[0.6rem]">{t.status_from} → {t.status_to}</span></>}
                              {t.event_type === 'assigned'        && <> reassigned the incident</>}
                              {t.event_type === 'closed'          && <> closed the incident</>}
                              {t.event_type === 'reclassified_fp' && <> reclassified as false positive</>}
                              {t.event_type === 'created'         && <> created the incident</>}
                              {t.event_type === 'note'            && <> added a comment</>}
                            </p>
                            {t.note && (
                              <div className="mt-1.5 bg-[var(--s1)] border border-[var(--b2)] rounded-lg px-3 py-2">
                                <p className="text-[0.68rem] text-[var(--t5)] leading-relaxed">{t.note}</p>
                              </div>
                            )}
                          </div>
                          <span className="text-[0.6rem] text-[var(--t3)] shrink-0 mt-0.5">{timeAgo(new Date(t.created_at).getTime())}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ===== REPORT TAB ===== */}
              {detailTab === 'report' && (
                <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-[var(--s1)] border-b border-[var(--b1)] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText size={13} className="text-[var(--p1)]" />
                      <p className="text-[0.72rem] font-black text-[var(--t7)]">Incident Report</p>
                    </div>
                    {!isClosed && canEdit && !reportEditing && (
                      <button onClick={() => setReportEditing(true)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.62rem] font-bold text-[var(--p1)] border border-[var(--p1)] hover:bg-blue-50 transition-colors">
                        <FileText size={11} /> Edit Report
                      </button>
                    )}
                  </div>
                  <div className="p-4">
                    {reportEditing ? (
                      <>
                        <textarea value={reportDraft} onChange={e => setReportDraft(e.target.value)} rows={14}
                          placeholder="Write or refine the incident report..."
                          className="w-full border border-[var(--b2)] rounded-lg px-3 py-2 text-[0.78rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)] resize-y leading-relaxed" />
                        <div className="flex gap-2 mt-3">
                          <button onClick={handleSaveReport} disabled={reportSaving}
                            className="px-4 py-2 rounded-lg bg-[var(--p1)] text-white text-[0.72rem] font-bold disabled:opacity-50 flex items-center gap-1">
                            {reportSaving ? 'Saving...' : <><CheckCircle size={12} /> Save Report</>}
                          </button>
                          <button onClick={() => { setReportEditing(false); setReportDraft(detail.report_body || ''); }}
                            className="px-4 py-2 rounded-lg border border-[var(--b2)] text-[var(--t5)] text-[0.72rem] font-semibold">Cancel</button>
                        </div>
                      </>
                    ) : detail.report_body ? (
                      <div className="prose prose-sm max-w-none">
                        <p className="text-[0.78rem] text-[var(--t6)] leading-relaxed whitespace-pre-line">{detail.report_body}</p>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <FileText size={28} className="mx-auto text-[var(--t3)] mb-2" />
                        <p className="text-[0.82rem] font-semibold text-[var(--t5)]">No report written yet</p>
                        {canEdit && !isClosed && (
                          <button onClick={() => setReportEditing(true)} className="mt-2 px-4 py-2 rounded-lg bg-[var(--p1)] text-white text-[0.72rem] font-bold hover:bg-[var(--pd)]">
                            Write Report
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right sidebar — metadata + quick actions */}
            <div className="space-y-4">
              {/* Status / details card */}
              <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 space-y-3">
                <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest">Case Details</p>

                <div>
                  <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Status</p>
                  {isClosed ? (
                    <span className={`inline-block px-2.5 py-1 rounded-lg text-[0.65rem] font-black uppercase tracking-widest border ${STATUS_COLORS[detail.status] || 'bg-gray-100 text-gray-700'}`}>
                      {STATUS_LABELS[detail.status] || detail.status}
                    </span>
                  ) : (
                    <select value={detail.status} disabled={!canEdit}
                      onChange={e => handleStatusChange(e.target.value)}
                      className={`w-full border rounded-lg px-2 py-1.5 text-[0.72rem] font-bold ${STATUS_COLORS[detail.status]?.replace('border-', 'border ') || 'border-[var(--b2)]'} disabled:opacity-70`}>
                      {(['OPEN','IN_PROGRESS','CONTAINED','RESOLVED','CLOSED','RECLASSIFIED_FP'] as const).map(s =>
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      )}
                    </select>
                  )}
                </div>

                <div>
                  <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Phase</p>
                  <span className={`inline-block px-2 py-0.5 rounded-lg text-[0.6rem] font-black uppercase ${PHASE_COLORS[detail.phase] || 'bg-gray-100 text-gray-700'}`}>
                    {PHASE_LABELS[detail.phase as IncidentPhase] || detail.phase}
                  </span>
                </div>

                <div>
                  <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Severity</p>
                  <span className={`inline-block px-2 py-0.5 rounded-lg text-[0.6rem] font-black uppercase border ${SEV_COLORS[detail.severity] || 'bg-gray-100 text-gray-700'}`}>
                    {detail.severity}
                  </span>
                </div>

                <div>
                  <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Assignee</p>
                  {detail.assigned_to_username ? (
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[var(--p1)] to-[var(--pd)] flex items-center justify-center text-white text-[0.45rem] font-black">
                        {detail.assigned_to_username.substring(0, 2).toUpperCase()}
                      </div>
                      <p className="text-[0.72rem] font-bold text-[var(--t6)]">{detail.assigned_to_username}</p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[0.72rem] font-bold text-amber-700">Unassigned</p>
                      {!isClosed && ['SUPER_ADMIN', 'ADMIN', 'INCIDENT_LEAD', 'TIER2'].includes(user?.role || '') && (
                        <button onClick={handleTake}
                          className="px-2 py-0.5 rounded-lg bg-blue-600 text-white text-[0.6rem] font-bold hover:bg-blue-700 flex items-center gap-1">
                          <UserPlus size={10} />Claim
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Reporter</p>
                  <p className="text-[0.72rem] font-bold text-[var(--t6)]">{detail.escalated_by_username || 'system'}</p>
                </div>

                <div>
                  <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">SLA</p>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${sla.color}`} />
                    <span className="text-[0.72rem] font-bold text-[var(--t6)]">{sla.label}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--b1)]">
                  <div>
                    <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-0.5">Risk</p>
                    <p className="text-[0.85rem] font-black text-[var(--t7)]">{ai.risk_score ?? '—'}<span className="text-[0.55rem] text-[var(--t3)]">/100</span></p>
                  </div>
                  <div>
                    <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-0.5">Confidence</p>
                    <p className="text-[0.85rem] font-black text-[var(--t7)]">{ai.confidence != null ? `${Math.round(ai.confidence * 100)}%` : '—'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--b1)]">
                  <div className="text-center">
                    <p className="text-[0.72rem] font-bold text-[var(--t6)]">{detail.alerts?.length ?? 0}</p>
                    <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase">Alerts</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[0.72rem] font-bold text-[var(--t6)]">{observables.length}</p>
                    <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase">IOCs</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[0.72rem] font-bold text-[var(--t6)]">{actions.length}</p>
                    <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase">Actions</p>
                  </div>
                </div>

                <div className="pt-2 border-t border-[var(--b1)] space-y-1">
                  <div className="flex justify-between text-[0.65rem]">
                    <span className="text-[var(--t3)]">Escalated</span>
                    <span className="font-bold text-[var(--t6)]">{timeAgo(new Date(detail.escalated_at).getTime())}</span>
                  </div>
                  {detail.glpi_ticket_id && (
                    <div className="flex justify-between text-[0.65rem]">
                      <span className="text-[var(--t3)]">GLPI Ticket</span>
                      <span className="font-mono text-[var(--p1)]">#{detail.glpi_ticket_id}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick actions */}
              {!isClosed && (
                <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 space-y-2">
                  <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Quick Actions</p>
                  {!detail.assigned_to && ['SUPER_ADMIN', 'ADMIN', 'INCIDENT_LEAD', 'TIER2'].includes(user?.role || '') && (
                    <button onClick={handleTake}
                      className="w-full px-3 py-2 rounded-lg bg-blue-600 text-white text-[0.7rem] font-bold hover:bg-blue-700 flex items-center gap-2 transition-colors">
                      <UserPlus size={12} />Claim Incident
                    </button>
                  )}
                  {nextPhase && canEdit && detail.assigned_to && (
                    <button onClick={handleNextPhase}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--p1)] text-white text-[0.7rem] font-bold hover:bg-[var(--pd)] flex items-center gap-2 transition-colors">
                      <ChevronRight size={12} />Advance to {PHASE_LABELS[nextPhase as IncidentPhase]}
                    </button>
                  )}
                  {canReassign && (
                    <button onClick={() => { setReassignTo(detail.assigned_to || 0); setShowReassign(s => !s); }}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--b2)] text-[var(--t6)] text-[0.7rem] font-bold hover:bg-[var(--s1)] flex items-center gap-2 transition-colors">
                      <UserPlus size={12} />Reassign
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => setShowReclassify(s => !s)}
                      className="w-full px-3 py-2 rounded-lg bg-pink-100 text-pink-800 text-[0.7rem] font-bold hover:bg-pink-200 flex items-center gap-2 transition-colors">
                      <ThumbsDown size={12} />Reclassify as FP
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => setShowCloseConfirm(true)}
                      className="w-full px-3 py-2 rounded-lg bg-amber-100 text-amber-800 text-[0.7rem] font-bold hover:bg-amber-200 transition-colors">
                      Close as Resolved
                    </button>
                  )}
                </div>
              )}

              {/* Reassign popover */}
              {showReassign && (
                <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3 space-y-2">
                  <p className="text-[0.6rem] font-black text-[var(--t6)] uppercase tracking-widest">Reassign / Unassign</p>
                  <select value={reassignTo} onChange={e => setReassignTo(Number(e.target.value))}
                    className="w-full border border-[var(--b2)] rounded-lg px-2 py-1.5 text-[0.7rem] bg-[var(--s0)]">
                    <option value={0}>-- Unassign (back to Open) --</option>
                    {analysts.map(a => <option key={a.id} value={a.id}>{a.username} ({a.role})</option>)}
                  </select>
                  <div className="flex gap-1.5">
                    <button onClick={handleReassign} className="flex-1 px-2 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.65rem] font-bold">Confirm</button>
                    <button onClick={() => setShowReassign(false)} className="flex-1 px-2 py-1.5 rounded-lg border border-[var(--b2)] text-[var(--t5)] text-[0.65rem] font-semibold">Cancel</button>
                  </div>
                </div>
              )}

              {/* Reclassify popover */}
              {showReclassify && (
                <div className="bg-pink-50 border border-pink-200 rounded-xl p-3 space-y-2">
                  <p className="text-[0.6rem] font-black text-pink-800 uppercase tracking-widest">Reclassify as FP</p>
                  <p className="text-[0.65rem] text-pink-900">Returns {detail.alerts?.length ?? 0} alert(s) to the FP archive.</p>
                  <textarea value={reclassifyNote} onChange={e => setReclassifyNote(e.target.value)} rows={2}
                    placeholder="Why? (optional)"
                    className="w-full border border-pink-300 rounded-lg px-2 py-1 text-[0.65rem] bg-white resize-none" />
                  <div className="flex gap-1.5">
                    <button onClick={handleReclassifyFp} className="flex-1 px-2 py-1.5 rounded-lg bg-pink-600 text-white text-[0.65rem] font-bold hover:bg-pink-700">Confirm</button>
                    <button onClick={() => { setShowReclassify(false); setReclassifyNote(''); }} className="flex-1 px-2 py-1.5 rounded-lg border border-pink-300 text-pink-800 text-[0.65rem] font-semibold">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Close confirmation modal */}
        {showCloseConfirm && (
          <ConfirmModal
            title="Close Incident"
            message={`Are you sure you want to close "${detail.title}" as Resolved? This action marks the incident as complete.`}
            confirmLabel="Close as Resolved"
            confirmClass="bg-amber-600 hover:bg-amber-700"
            onConfirm={async () => {
              const r = await closeIncident(detail.id);
              if (r.ok) { toast('Incident closed', 'success'); fetchDetail(detail.id); fetchList(); }
              else toast(r.error || 'Failed to close', 'error');
              setShowCloseConfirm(false);
            }}
            onCancel={() => setShowCloseConfirm(false)}
          />
        )}
        {deleteActionTarget && (
          <ConfirmModal
            title="Delete Action"
            message="Are you sure you want to delete this response action? This cannot be undone."
            confirmLabel="Delete"
            onConfirm={() => handleActionDelete(deleteActionTarget)}
            onCancel={() => setDeleteActionTarget(null)}
          />
        )}
      </div>
    );
  }

  if (activeId && loadingDetail) {
    return <div className="p-6"><p className="text-[0.78rem] text-[var(--t3)]">Loading incident...</p></div>;
  }

  // ── List view ───────────────────────────────────────────────────────────
  const openCount = (counts['OPEN'] ?? 0) + (counts['IN_PROGRESS'] ?? 0) + (counts['CONTAINED'] ?? 0);
  const critCount = filteredList.filter(i => i.severity === 'CRITICAL').length;
  const breachedCount = filteredList.filter(i => computeSla(i.severity, i.escalated_at).state === 'breached').length;
  const pendingActCount = filteredList.reduce((s, i) => s + (i.pending_actions ?? 0), 0);

  const STATUS_CARDS: { key: string; label: string; tint: string; icon: any }[] = [
    { key: 'OPEN',        label: 'Open',          tint: 'border-blue-200 bg-blue-50',     icon: AlertOctagon },
    { key: 'IN_PROGRESS', label: 'Investigating', tint: 'border-orange-200 bg-orange-50', icon: Activity },
    { key: 'CONTAINED',   label: 'Contained',     tint: 'border-amber-200 bg-amber-50',   icon: Shield },
    { key: 'RESOLVED',    label: 'Resolved',      tint: 'border-green-200 bg-green-50',   icon: CheckCircle },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 overflow-y-auto h-full">
      <PageHeader eyebrow="Incident Response" title="Incidents"
        description="Manage escalated security incidents through their full lifecycle." />

      {/* Summary dashboard */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Active Incidents', value: openCount,       icon: AlertOctagon,  color: '#3b82f6', bg: 'bg-blue-50 border-blue-100' },
          { label: 'Critical',         value: critCount,       icon: AlertTriangle, color: '#ef4444', bg: 'bg-red-50 border-red-100' },
          { label: 'SLA Breached',     value: breachedCount,   icon: Clock,         color: '#f59e0b', bg: 'bg-amber-50 border-amber-100' },
          { label: 'Pending Actions',  value: pendingActCount, icon: Zap,           color: '#8b5cf6', bg: 'bg-violet-50 border-violet-100' },
        ].map((s, i) => {
          const Ico = s.icon;
          return (
            <div key={i} className={`rounded-xl p-4 border ${s.bg} flex items-center gap-3`}>
              <div className="w-10 h-10 rounded-xl bg-white/80 flex items-center justify-center border border-[var(--b2)] shadow-sm shrink-0">
                <Ico className="w-5 h-5" style={{ color: s.color }} />
              </div>
              <div>
                <p className="text-[1.4rem] font-black tracking-tight leading-none" style={{ color: s.color }}>{s.value}</p>
                <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mt-0.5">{s.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Status filter cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {STATUS_CARDS.map(c => {
          const active = statusF === c.key;
          const Ico = c.icon;
          return (
            <button key={c.key} onClick={() => setStatusF(active ? '' : c.key)}
              className={`text-left rounded-xl p-3 border-2 transition-all ${active ? 'border-[var(--p1)] bg-blue-50 shadow-sm' : `${c.tint} hover:border-[var(--p1)]`}`}>
              <div className="flex items-center gap-2 mb-1">
                <Ico size={13} className="text-[var(--t5)]" />
                <p className="text-[0.55rem] font-black text-[var(--t4)] uppercase tracking-widest">{c.label}</p>
              </div>
              <p className="text-[1.4rem] font-black text-[var(--t7)] tabular-nums leading-none">{counts[c.key] ?? 0}</p>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-3 space-y-2.5">
        {/* Row 1: search + owner + SLA + My Incidents */}
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex-1 min-w-[240px] relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--t3)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title or ID…"
              className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-[var(--b2)] bg-[var(--s1)] text-[0.75rem] text-[var(--t1)] placeholder:text-[var(--t3)] focus:outline-none focus:border-[var(--p1)]" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--t3)] hover:text-[var(--t1)]">
                <X size={12} />
              </button>
            )}
          </div>
          <select value={ownerF} onChange={e => setOwnerF(e.target.value === '' ? '' : Number(e.target.value))}
            className="py-1.5 px-2 rounded-lg border border-[var(--b2)] bg-[var(--s1)] text-[0.7rem] font-bold text-[var(--t1)] focus:outline-none focus:border-[var(--p1)]">
            <option value="">All owners</option>
            {analysts.map(a => <option key={a.id} value={a.id}>{a.username} ({a.role})</option>)}
          </select>
          <select value={slaF} onChange={e => setSlaF(e.target.value)}
            className="py-1.5 px-2 rounded-lg border border-[var(--b2)] bg-[var(--s1)] text-[0.7rem] font-bold text-[var(--t1)] focus:outline-none focus:border-[var(--p1)]">
            <option value="">All SLA states</option>
            <option value="on_track">On Track</option>
            <option value="watch">Watch</option>
            <option value="at_risk">At Risk</option>
            <option value="breached">Breached</option>
          </select>
          <button onClick={() => setMyOnly(m => !m)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[0.62rem] font-bold transition-all ${
              myOnly ? 'bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-offset-0 ring-blue-200' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'
            }`}>
            <User size={10} /> My Incidents
          </button>
        </div>

        {/* Row 2: severity chips */}
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Severity:</span>
          {(['CRITICAL','HIGH','MEDIUM','LOW'] as const).map(sv => {
            const isActive = sevF === sv;
            return (
              <button
                key={sv}
                onClick={() => setSevF(isActive ? '' : sv)}
                className={`px-2 py-0.5 rounded-full border text-[0.62rem] font-black uppercase tracking-wider transition-all ${isActive ? severityChipColor(sv) + ' ring-2 ring-offset-0 ring-current' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
              >
                {sv}
              </button>
            );
          })}
        </div>

        {/* Row 3: phase chips + clear */}
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Phase:</span>
          {INCIDENT_PHASES.map(p => {
            const isActive = phaseF === p;
            return (
              <button
                key={p}
                onClick={() => setPhaseF(isActive ? '' : p)}
                className={`px-2 py-0.5 rounded-full border text-[0.62rem] font-black uppercase tracking-wider transition-all ${isActive ? 'bg-[var(--p1)] text-white border-[var(--p1)] ring-2 ring-offset-0 ring-[var(--p1)]/40' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] hover:bg-[var(--s2)]'}`}
              >
                {PHASE_LABELS[p]}
              </button>
            );
          })}
          {(search || ownerF !== '' || sevF || slaF || phaseF || myOnly || statusF) && (
            <button
              onClick={() => { setSearch(''); setOwnerF(''); setSevF(''); setSlaF(''); setPhaseF(''); setMyOnly(false); setStatusF(''); }}
              className="ml-auto text-[0.62rem] font-bold text-[var(--p1)] hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Incident cards */}
      {filteredList.length === 0 ? (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-10 text-center">
          <AlertOctagon size={32} className="mx-auto text-[var(--t3)] mb-2" />
          <p className="text-[0.85rem] font-semibold text-[var(--t6)]">No incidents match this filter</p>
          <p className="text-[0.72rem] text-[var(--t3)] mt-1">
            Escalate an alert from the <button onClick={() => setActiveTab('investigation')} className="text-[var(--p1)] font-bold hover:underline">Alerts Queue</button> to create one.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredList.map(inc => {
            const incSla = computeSla(inc.severity, inc.escalated_at);
            const actionTotal = inc.action_count || 0;
            const actionDone = inc.executed_actions || 0;
            const actionPct = actionTotal > 0 ? Math.round((actionDone / actionTotal) * 100) : 0;
            return (
              <button key={inc.id} onClick={() => setActiveId(inc.id)}
                className="w-full bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-4 text-left hover:border-[var(--p1)] hover:shadow-md transition-all group">
                <div className="flex items-start gap-3 mb-2.5">
                  <span className={`px-2 py-0.5 rounded-lg text-[0.55rem] font-black uppercase tracking-widest border shrink-0 ${SEV_COLORS[inc.severity] || 'bg-gray-100 text-gray-700'}`}>{inc.severity}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[0.85rem] font-bold text-[var(--t7)] truncate group-hover:text-[var(--p1)] transition-colors">{inc.title}</p>
                    <code className="text-[0.58rem] font-mono text-[var(--t3)]">{inc.id}</code>
                  </div>
                  <span className={`px-2.5 py-1 rounded-lg text-[0.55rem] font-black uppercase tracking-widest border shrink-0 ${STATUS_COLORS[inc.status] || 'bg-gray-100 text-gray-700'}`}>
                    {STATUS_LABELS[inc.status] || inc.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[0.65rem] text-[var(--t3)] flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded-lg text-[0.55rem] font-black uppercase ${PHASE_COLORS[inc.phase] || 'bg-gray-100 text-gray-700'}`}>{PHASE_LABELS[inc.phase as IncidentPhase] || inc.phase}</span>
                  <span className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${incSla.color}`} /><span className="font-semibold">{incSla.label}</span></span>
                  <span className="flex items-center gap-1"><AlertTriangle size={11} /> {inc.alert_count || 0} alert{(inc.alert_count || 0) !== 1 ? 's' : ''}</span>
                  {actionTotal > 0 && (
                    <span className="flex items-center gap-1.5">
                      <Zap size={11} />
                      <span>{actionDone}/{actionTotal}</span>
                      <div className="w-12 h-1.5 bg-[var(--s2)] rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${actionPct}%` }} />
                      </div>
                    </span>
                  )}
                  {inc.assigned_to_username && (
                    <span className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[var(--p1)] to-[var(--pd)] flex items-center justify-center text-white text-[0.35rem] font-black">
                        {inc.assigned_to_username.substring(0, 2).toUpperCase()}
                      </div>
                      <span className="font-semibold text-[var(--t5)]">{inc.assigned_to_username}</span>
                    </span>
                  )}
                  {inc.glpi_ticket_id && <span className="font-mono text-[var(--t4)]">GLPI #{inc.glpi_ticket_id}</span>}
                  <span className="ml-auto flex items-center gap-1 text-[var(--t4)]"><Clock size={11} />{timeAgo(new Date(inc.escalated_at).getTime())}</span>
                </div>
              </button>
            );
          })}
          {total > filteredList.length && (
            <p className="text-center text-[0.7rem] text-[var(--t3)] pt-2">Showing {filteredList.length} of {total}</p>
          )}
        </div>
      )}
    </div>
  );
};
