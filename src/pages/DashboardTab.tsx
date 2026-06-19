import React, { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from 'react';
import { Shield, AlertTriangle, AlertOctagon, Activity, FileText, Settings, LogOut, Search, Bell, User, CheckCircle, XCircle, Clock, ChevronRight, BarChart3, Terminal, Filter, Plus, X, UserPlus, Eye, ThumbsUp, ThumbsDown, ChevronDown, BookOpen, Trash2, Send, Zap, Mail, ExternalLink, ToggleLeft, ToggleRight, RefreshCw, PanelLeftOpen, PanelLeftClose, Database, Copy, Key, Webhook, Hash, Globe, Crosshair, ListChecks, MessageSquare, Laptop, Link2, ChevronUp, Lock, Palette, MapPin, Edit3, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getAgentModelConfig, orchestrateAnalysis, runAgentPhase, updateAgentModel, getAlertRuns, saveAlertRun, getIntegrations, updateIntegration, testIntegration, getActionLogs, getReports, getReportSummary, getLocalLLMConfig, updateLocalLLMConfig, testLocalLLM, getLocalLLMModels, getAgentStats, getRiskSeries, getFpReduction, getFpOverTime, getNoisySources, getSuppressionRules, createSuppressionRule, updateSuppressionRule, deleteSuppressionRule, getAssets, upsertAsset, deleteAsset, getFpSuggestions, acceptFpSuggestion, fpScan, fpScanBatch, investigateAlert, escalateAlert, confirmFp, overrideFp, getFpArchive, getPipelineFunnel, getDetectionEffectiveness, getSourceDistribution, listApiKeys, createApiKey, revokeApiKey, updateApiKey, getInsights, getIocs, getPlaybooks, createPlaybook, updatePlaybook, deletePlaybook, listAnalysts, getIncidents, getIncident, getIncidentReasoning, reinvestigateIncident, createIncident, assignIncident, takeIncident, moveIncidentPhase, closeIncident, addIncidentNote, reclassifyIncidentFp, addIncidentAction, updateIncidentAction, deleteIncidentAction, reorderIncidentActions, updateIncident, getResponseActions, type ResponseActionRow, type ReasoningRow, testLdapConnection, getIntegration, createUser, updateUser, adminResetPassword, getAuditLogs, getAuditLogActions, auditLogsExportUrl, getFailedLogins, estimatePasswordStrength, verifyPassword, getLlmProviders, createLlmProvider, updateLlmProvider, deleteLlmProvider, testLlmProvider, type AgentModelConfig, type AgentPhase, type AgentStat, type LocalModel, type Insight, type IocRow, type Playbook, type LlmProvidersResponse, type LlmProviderRow } from '../services/aiService';
import { INCIDENT_PHASES, PHASE_LABELS, INCIDENT_STATUS_LABELS, type Incident, type IncidentPhase, type IncidentStatus, type IncidentAction, type IncidentActionStatus } from '../types';
import { User as UserType, Alert, AgentRun, Stats, UserRole, Integration, ActionLog, ReportRow, ReportSummary, ROLE_LABELS, ROLE_LEVEL } from '../types';
import PageHeader from '../components/ui/PageHeader';
import { AGENT_PHASES_UI, parseAlertAi, parseMitreTags, getPhaseData, getAlertRiskScore, getConfidenceValues, percent } from '../features/alerts/alertUtils';
import { ToastContext, ToastContainer, useToast, type ToastItem } from '../lib/toast';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { ConfirmModal } from '../components/ConfirmModal';
import { severityChipColor, timeAgo } from '../lib/format';
import { GlobalRiskDonut, PipelineRiskTimeSeries, AlertRow, type RiskSeriesPoint, type RiskChartGranularity } from '../features/alerts/AlertWorkspace';
import { StatCard } from '../components/layout/StatCard';
import { Dashboard, ResearchOverview, NoiseReductionDashboard, SkeletonVal } from '../features/dashboard/DashboardWidgets';

type DashboardIncidentCounts = {
  OPEN: number;
  IN_PROGRESS: number;
  CONTAINED: number;
  RESOLVED: number;
  CLOSED: number;
  RECLASSIFIED_FP: number;
};

const toDashboardIncidentCounts = (counts?: Record<string, number>): DashboardIncidentCounts => ({
  OPEN: counts?.OPEN ?? 0,
  IN_PROGRESS: counts?.IN_PROGRESS ?? 0,
  CONTAINED: counts?.CONTAINED ?? 0,
  RESOLVED: counts?.RESOLVED ?? 0,
  CLOSED: counts?.CLOSED ?? 0,
  RECLASSIFIED_FP: counts?.RECLASSIFIED_FP ?? 0,
});

const computeDashboardRiskScore = ({
  activeCritical,
  activeHigh,
  activeMedium,
  openIncidentCount,
  aiRiskPressure,
  containedIncidents,
  resolvedIncidents,
  closedIncidents,
}: {
  activeCritical: number;
  activeHigh: number;
  activeMedium: number;
  openIncidentCount: number;
  aiRiskPressure: number;
  containedIncidents: number;
  resolvedIncidents: number;
  closedIncidents: number;
}) => {
  const rawRisk =
    activeCritical * 5 +
    activeHigh * 2 +
    activeMedium +
    openIncidentCount * 2 +
    aiRiskPressure;
  const mitigation =
    containedIncidents * 2 +
    resolvedIncidents * 3 +
    closedIncidents * 4;
  const bounded = Math.max(0, Math.min(100, Math.round(rawRisk - mitigation)));
  // Keep 100 reserved for sustained critical pressure (>20 critical alerts).
  return activeCritical <= 20 && bounded === 100 ? 99 : bounded;
};

const DashboardTab = ({ alerts, onAlertClick, setActiveTab, onRefreshAlerts }: { alerts: Alert[]; onAlertClick: (a: Alert) => void; setActiveTab: (t: string) => void; onRefreshAlerts?: () => void }) => {
  const { token } = useAuth();
  const [funnel, setFunnel] = useState<any>(null);
  const [trends, setTrends] = useState<Array<{ day: string; count: number }> | null>(null);
  const [agentStats, setAgentStatsState] = useState<AgentStat[]>([]);
  const [incidentCounts, setIncidentCounts] = useState<DashboardIncidentCounts>(() => toDashboardIncidentCounts());
  const [refreshing, setRefreshing] = useState(false);
  const [riskGranularity, setRiskGranularity] = useState<RiskChartGranularity>('days');
  const [riskSeries, setRiskSeries] = useState<RiskSeriesPoint[]>([]);

  const handleRefresh = () => {
    if (!onRefreshAlerts || refreshing) return;
    setRefreshing(true);
    onRefreshAlerts();
    getIncidents({ limit: 1, offset: 0 })
      .then(data => setIncidentCounts(toDashboardIncidentCounts(data?.counts)))
      .catch(() => setIncidentCounts(toDashboardIncidentCounts()));
    setTimeout(() => setRefreshing(false), 800);
  };

  useEffect(() => {
    if (!token) return;
    getPipelineFunnel().then(setFunnel).catch(() => {});
    fetch('/api/stats/trends', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(data => { if (Array.isArray(data)) setTrends(data); }).catch(() => {});
    getAgentStats().then(setAgentStatsState).catch(() => setAgentStatsState([]));
    getIncidents({ limit: 1, offset: 0 })
      .then(data => setIncidentCounts(toDashboardIncidentCounts(data?.counts)))
      .catch(() => setIncidentCounts(toDashboardIncidentCounts()));
  }, [token]);

  // Risk & pipeline series comes from the server (aggregated over the full alerts
  // table) so it reflects real history, not just the page of alerts loaded client-side.
  useEffect(() => {
    if (!token) return;
    getRiskSeries(riskGranularity).then(setRiskSeries).catch(() => setRiskSeries([]));
  }, [token, riskGranularity]);

  const analyzed = alerts.filter(a => !!a.ai_analysis || ['TRIAGED','FALSE_POSITIVE','ESCALATED','CLOSED','FP_CONFIRMED','FILTERED'].includes(a.status)).length;
  const topThreats = [...alerts]
    .filter(a => !['CLOSED','FALSE_POSITIVE','FP_CONFIRMED'].includes(a.status) && a.status !== 'NEW')
    .sort((a, b) => (getAlertRiskScore(b) ?? b.severity * 6) - (getAlertRiskScore(a) ?? a.severity * 6))
    .slice(0, 6);
  const trendMax = trends ? Math.max(...trends.map(t => t.count), 1) : 1;
  const fallbackAgents = agentStats.filter(s => s.total_runs > 0 && (s.fallback_count / s.total_runs) > 0.2);
  const resolvedStatuses = new Set(['CLOSED', 'FALSE_POSITIVE', 'FP_CONFIRMED', 'FILTERED']);
  const fpStatuses = new Set(['FALSE_POSITIVE', 'FP_CONFIRMED', 'FILTERED']);
  const activeAlerts = alerts.filter(a => !resolvedStatuses.has(a.status));
  const activeCritical = activeAlerts.filter(a => a.severity >= 13).length;
  const activeHigh = activeAlerts.filter(a => a.severity >= 10 && a.severity < 13).length;
  const activeMedium = activeAlerts.filter(a => a.severity >= 7 && a.severity < 10).length;
  const activeEscalated = activeAlerts.filter(a => a.status === 'ESCALATED' || a.status === 'INCIDENT').length;
  const totalAlerts = alerts.length;
  const fpFiltered = alerts.filter(a => fpStatuses.has(a.status) || parseAlertAi(a)?.phaseData?.analysis?.is_false_positive).length;
  const openIncidentCount = incidentCounts.OPEN + incidentCounts.IN_PROGRESS;
  const activeIncidents = openIncidentCount;
  const resolvedHighCritical = alerts.filter(a => resolvedStatuses.has(a.status) && a.severity >= 10).length;
  const aiRiskPressure = activeAlerts.reduce((sum, alert) => {
    const risk = getAlertRiskScore(alert);
    if (risk == null) return sum;
    if (risk >= 80) return sum + 2;
    if (risk >= 60) return sum + 1;
    return sum;
  }, 0);
  const globalRiskScore = computeDashboardRiskScore({
    activeCritical,
    activeHigh,
    activeMedium,
    openIncidentCount,
    aiRiskPressure,
    containedIncidents: incidentCounts.CONTAINED,
    resolvedIncidents: incidentCounts.RESOLVED,
    closedIncidents: incidentCounts.CLOSED,
  });

  // Series is aggregated server-side over the full alerts table (see
  // GET /api/stats/risk-series). We only overlay the live global risk on the
  // most-recent bucket so "now" matches the GlobalRiskDonut exactly.
  const riskSeriesPoints: RiskSeriesPoint[] = riskSeries.map((point, idx) =>
    idx === riskSeries.length - 1 ? { ...point, risk: globalRiskScore } : point
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 overflow-y-auto h-full">
      <PageHeader eyebrow="Overview" title="Aegis SOC Dashboard" description="Real-time alert pipeline, FP filtering efficiency, and system health." />

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Alerts', value: totalAlerts, sub: `${analyzed} processed`, icon: AlertTriangle, color: '#004a99' },
          { label: 'FP Filtered', value: fpFiltered, sub: `${totalAlerts ? Math.round((fpFiltered / totalAlerts) * 100) : 0}% of all alerts`, icon: Filter, color: '#f29900' },
          { label: 'Active Incidents', value: activeIncidents, sub: 'open incident pipeline', icon: Search, color: '#7c3aed' },
          { label: 'Escalated', value: activeEscalated, sub: 'incident queue depth', icon: Shield, color: '#d93025' },
        ].map(card => (
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

      <div className="grid grid-cols-[minmax(0,2fr)_320px] gap-5 items-stretch">
        <div className="space-y-3">
          <PipelineRiskTimeSeries
            points={riskSeriesPoints}
            granularity={riskGranularity}
            setGranularity={setRiskGranularity}
          />
        </div>
        <GlobalRiskDonut
          score={globalRiskScore}
          critical={activeCritical}
          high={activeHigh}
          resolvedHighCritical={resolvedHighCritical}
        />
      </div>

      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-[var(--b1)] flex justify-between items-center bg-[var(--s1)]/50">
          <h3 className="text-[0.82rem] font-black text-[var(--p1)] flex items-center gap-2"><Activity className="w-4 h-4" />LIVE ALERT STREAM (WAZUH)</h3>
          <div className="flex items-center gap-3">
            <span className="text-[0.65rem] text-[var(--t2)] font-mono">{alerts.length} ALERTS</span>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh alert list"
              className="flex items-center gap-1.5 px-2 py-1 rounded border border-[var(--b2)] text-[0.65rem] font-bold text-[var(--t4)] hover:bg-[var(--s1)] hover:text-[var(--p1)] transition-colors disabled:opacity-50"
            >
              <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {alerts.length > 0 ? (
            [...alerts].sort((a, b) => new Date(b.timestamp.replace(' ', 'T')).getTime() - new Date(a.timestamp.replace(' ', 'T')).getTime()).slice(0, 30).map(alert => {
              const sevLabel = alert.severity >= 13 ? 'CRIT' : alert.severity >= 10 ? 'HIGH' : alert.severity >= 7 ? 'MED' : 'LOW';
              const sevColor = alert.severity >= 13 ? 'text-red-500 bg-red-50' : alert.severity >= 10 ? 'text-orange-500 bg-orange-50' : alert.severity >= 7 ? 'text-amber-500 bg-amber-50' : 'text-green-500 bg-green-50';
              return (
                <div key={alert.id} onClick={() => onAlertClick(alert)} className="px-4 py-2.5 border-b border-[var(--b1)] cursor-pointer hover:bg-[var(--sa)] flex items-center gap-3">
                  <span className="text-[0.58rem] text-[var(--t3)] font-mono shrink-0 w-14">{new Date(alert.timestamp.replace(' ', 'T')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[0.55rem] font-black shrink-0 ${sevColor}`}>L{alert.severity} {sevLabel}</span>
                  <p className="text-[0.72rem] text-[var(--t7)] truncate flex-1">{alert.description}</p>
                  <span className="text-[0.6rem] text-[var(--t3)] font-mono shrink-0">{alert.source_ip || '—'}</span>
                  <span className="text-[0.58rem] text-[var(--t2)] shrink-0 w-16 truncate text-right">{alert.agent_name}</span>
                </div>
              );
            })
          ) : (
            <div className="h-32 flex items-center justify-center text-[var(--t3)] text-sm opacity-50">
              <Activity className="w-8 h-8 animate-pulse mr-2" /> Waiting for Wazuh alerts...
            </div>
          )}
        </div>
      </div>



      {/* Top Active Threats */}
      {topThreats.length > 0 && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-[var(--s1)] flex items-center justify-between">
            <p className="text-[0.82rem] font-black text-[var(--p1)] uppercase tracking-wide">Top Active Threats</p>
            <button onClick={() => setActiveTab('investigation')} className="text-[0.68rem] font-bold text-[var(--p1)] hover:underline">View all</button>
          </div>
          <div className="divide-y divide-slate-100">
            {topThreats.map(alert => {
              const risk = getAlertRiskScore(alert);
              return (
                <button key={alert.id} onClick={() => onAlertClick(alert)} className="w-full px-5 py-3 text-left hover:bg-[var(--s1)] flex items-center gap-4">
                  <span className={`w-2 h-8 rounded-full ${alert.severity >= 12 ? 'bg-red-500' : alert.severity >= 10 ? 'bg-orange-500' : alert.severity >= 7 ? 'bg-amber-500' : 'bg-green-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[0.82rem] font-bold text-[var(--t7)] truncate">{alert.description}</p>
                    <p className="text-[0.62rem] text-[var(--t3)] font-mono mt-0.5">{alert.source_ip} · {alert.agent_name} · {alert.status}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[0.72rem] font-black text-[var(--t6)]">{risk != null ? `${risk}%` : `L${alert.severity}`}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};


// ── Noise Filter Tab ────────────────────────────────────────────────────────

export { DashboardTab };
