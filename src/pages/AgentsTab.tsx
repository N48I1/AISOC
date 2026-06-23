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
import { StepUpModal } from '../components/StepUpModal';

const AgentsTab = () => {
  const showToast = useToast();
  const { token, user } = useAuth();
  const [promptModal, setPromptModal] = useState<{ name: string; prompt: string } | null>(null);
  const [config,       setConfig]      = useState<AgentModelConfig | null>(null);
  const [loading,      setLoading]     = useState(false);
  const [error,        setError]       = useState('');
  const [savingPhase,  setSavingPhase] = useState<AgentPhase | null>(null);
  const [agentStats,   setAgentStats]  = useState<AgentStat[]>([]);
  const isAdmin = (ROLE_LEVEL[user?.role || ''] ?? 0) >= ROLE_LEVEL.ADMIN;

  // ── Local LLM state ────────────────────────────────────────────────────────
  const [localUrl,     setLocalUrl]    = useState('http://localhost:11434');
  const [localEnabled, setLocalEnabled]= useState(false);
  const [localModels,  setLocalModels] = useState<LocalModel[]>([]);
  const [localStatus,  setLocalStatus] = useState<'unknown'|'checking'|'connected'|'unreachable'>('unknown');
  const [savingLocal,  setSavingLocal] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState<AgentPhase>('analysis');
  const [stepUp, setStepUp] = useState<{
    title: string;
    message: string;
    destructive?: boolean;
    run: (token: string) => Promise<void>;
  } | null>(null);

  const agentDefs: Array<{ phase: AgentPhase; name: string; desc: string; prompt: string }> = [
    {
      phase: 'analysis',
      name: 'Alert Triage Agent',
      desc: 'Interprets Wazuh alerts, extracts IOCs (IP, user, host), validates severity, detects false positives.',
      prompt: `You are an expert SOC Alert Analysis Agent. Analyze the Wazuh security alert and respond ONLY with valid JSON — no markdown, no extra text.\n\nRequired JSON:\n{\n  "analysis_summary": "<2-3 sentence technical description of the threat>",\n  "iocs": {\n    "ips":   ["<IP addresses>"],\n    "users": ["<usernames>"],\n    "hosts": ["<hostnames or agent names>"]\n  },\n  "severity_validation": "<CRITICAL|HIGH|MEDIUM|LOW>",\n  "is_false_positive": false,\n  "false_positive_confidence": 0.2,\n  "confidence": 0.9\n}`,
    },
    {
      phase: 'intel',
      name: 'Threat Intelligence Agent',
      desc: 'Enriches IOCs (IP/domain/hash), maps to MITRE ATT&CK, assesses reputation risk.',
      prompt: `You are a Threat Intelligence Agent with deep knowledge of MITRE ATT&CK. Map the IOCs and alert context to MITRE techniques. Respond ONLY with valid JSON:\n\n{\n  "mitre_attack": ["T1190", "T1059.001"],\n  "risk_score": 8,\n  "intel_summary": "<2-3 sentence threat assessment>",\n  "threat_actor_type": "<nation-state|cybercriminal|insider|hacktivist|unknown>",\n  "campaign_family": "<malware or campaign name, or null>"\n}`,
    },
    {
      phase: 'knowledge',
      name: 'RAG Knowledge Agent',
      desc: 'Retrieves relevant playbooks, suggests remediation steps, references internal SOPs.',
      prompt: `You are a Security Playbook Retrieval Agent. Provide numbered remediation steps tailored to the alert. Respond ONLY with valid JSON:\n\n{\n  "remediation_steps": "1. <first step>\\n2. <second step>\\n...",\n  "playbook_reference": "<e.g. NIST IR-2 or internal PB-WEB-001>",\n  "containment_priority": "<IMMEDIATE|HIGH|MEDIUM|LOW>",\n  "estimated_effort_minutes": 15\n}`,
    },
    {
      phase: 'correlation',
      name: 'Correlation Agent',
      desc: 'Detects multi-alert patterns, identifies attack campaigns, escalates risk level.',
      prompt: `You are a Security Correlation Agent. Analyse the current alert against recent alerts to detect multi-stage campaigns. Respond ONLY with valid JSON:\n\n{\n  "campaign_detected": false,\n  "campaign_name": "<descriptive name or 'Isolated Incident'>",\n  "campaign_description": "<what the campaign appears to be>",\n  "related_alert_count": 0,\n  "escalation_needed": false,\n  "kill_chain_stage": "<Reconnaissance|Weaponization|Delivery|Exploitation|Installation|C2|Actions on Objectives>"\n}`,
    },
    {
      phase: 'recall',
      name: 'Memory Recall Agent',
      desc: 'Finds similar past incidents from insight memory for contextual guidance.',
      prompt: `You are a SOC memory recall agent. Find similar prior incidents to the current alert and return ONLY valid JSON:\n\n{\n  "hits": [\n    {\n      "alert_id": "<historical alert id>",\n      "summary": "<short prior incident summary>",\n      "outcome": "<resolved|escalated|false_positive|other>",\n      "similarity": 0.0\n    }\n  ],\n  "confidence": 0.8\n}`,
    },
    {
      phase: 'ioc_check',
      name: 'IOC History Agent',
      desc: 'Checks IOC memory history (first seen, last seen, volume, and threat level).',
      prompt: `You are an IOC history agent. Check extracted indicators against historical IOC memory and return ONLY valid JSON:\n\n{\n  "hits": [\n    {\n      "value": "<ioc value>",\n      "type": "<ip|domain|hash|user|host|process|file>",\n      "first_seen": "<timestamp or null>",\n      "last_seen": "<timestamp or null>",\n      "alert_count": 0,\n      "threat_level": "<low|medium|high|unknown>"\n    }\n  ],\n  "confidence": 0.8\n}`,
    },
    {
      phase: 'ticketing',
      name: 'Ticketing Agent',
      desc: 'Generates structured incident report, creates GLPI ticket, assigns priority.',
      prompt: `You are an Incident Ticketing Agent. Write a professional, concise incident ticket. If priority is CRITICAL or HIGH set email_notification_sent to true. Respond ONLY with valid JSON:\n\n{\n  "title": "<incident title under 80 chars>",\n  "priority": "<CRITICAL|HIGH|MEDIUM|LOW>",\n  "report_body": "<4-5 sentences summary>",\n  "email_notification_sent": true,\n  "affected_systems": ["<hostname or IP>"],\n  "business_impact": "<one sentence>"\n}`,
    },
    {
      phase: 'response',
      name: 'Response Agent',
      desc: 'Recommends containment actions — block IP, disable user (with analyst approval).',
      prompt: `You are the Automated Response Agent. Recommend specific, actionable containment steps. Respond ONLY with valid JSON:\n\n{\n  "actions": [\n    {\n      "type": "<BLOCK_IP|DISABLE_USER|ISOLATE_HOST|QUARANTINE_FILE|RESET_PASSWORD|NOTIFY_TEAM>",\n      "target": "<IP address, username, hostname, or file path>",\n      "reason": "<why this action is necessary>",\n      "priority": 1,\n      "automated": false\n    }\n  ],\n  "approval_required": true,\n  "estimated_containment_time": "15 minutes"\n}`,
    },
    {
      phase: 'validation',
      name: 'SLA Validation Agent',
      desc: 'Verifies action plan completeness, ensures SLA alignment, logs approval trail.',
      prompt: `You are the SLA & Quality Validation Agent. Verify the incident response is thorough and within policy. Respond ONLY with valid JSON:\n\n{\n  "is_valid": true,\n  "sla_status": "<SLA_MET|SLA_AT_RISK|SLA_BREACHED>",\n  "completeness_score": 90,\n  "missing_elements": [],\n  "recommendation": "<CLOSE|ESCALATE|MONITOR|INVESTIGATE_FURTHER>",\n  "confidence": 0.85\n}`,
    },
  ];

  const checkLocalConnection = useCallback(async (url?: string) => {
    setLocalStatus('checking');
    const res = await testLocalLLM();
    if (res.ok) {
      setLocalStatus('connected');
      const modRes = await getLocalLLMModels();
      setLocalModels(modRes.models || []);
    } else {
      setLocalStatus('unreachable');
      setLocalModels([]);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    Promise.all([
      getAgentModelConfig(),
      getAgentStats(),
      getLocalLLMConfig(),
    ]).then(([cfg, stats, local]) => {
      setConfig(cfg);
      setAgentStats(stats);
      setLocalUrl(local.url);
      setLocalEnabled(local.enabled);
      if (local.enabled) {
        // Also fetch local models from the config response
        if (cfg.localModels && cfg.localModels.length > 0) {
          setLocalModels(cfg.localModels);
          setLocalStatus('connected');
        } else {
          checkLocalConnection(local.url);
        }
      }
    }).catch((err: any) => setError(err?.message || 'Failed to load configuration.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleModelChange = async (phase: AgentPhase, model: string) => {
    if (!isAdmin) return;
    setError('');
    const friendly = model.startsWith('local::') ? model.replace('local::','') : (config?.modelLabels?.[model] || model);
    setStepUp({
      title: 'Confirm AI model change',
      message: `Re-authenticate to assign the ${phase} agent to ${friendly}. This change is audited.`,
      run: async (stepUpToken) => {
        setStepUp(null);
        setSavingPhase(phase);
        try {
          const updated = await updateAgentModel(phase, model, stepUpToken);
          setConfig(updated);
          showToast(`${phase} agent → ${friendly}`);
        } catch (err: any) {
          setError(err?.message || 'Failed to update model.');
          showToast(err?.message || 'Failed to save model', 'error');
        } finally {
          setSavingPhase(null);
        }
      },
    });
  };

  const handleSaveLocalConfig = async () => {
    setStepUp({
      title: 'Confirm Local LLM config',
      message: 'Re-authenticate to update the Local LLM endpoint. This change is audited.',
      run: async (stepUpToken) => {
        setStepUp(null);
        setSavingLocal(true);
        try {
          await updateLocalLLMConfig({ url: localUrl, enabled: localEnabled }, stepUpToken);
          showToast('Local LLM config saved');
          if (localEnabled) await checkLocalConnection(localUrl);
          else { setLocalStatus('unknown'); setLocalModels([]); }
          const updated = await getAgentModelConfig();
          setConfig(updated);
        } catch (err: any) {
          showToast(err?.message || 'Failed to save local LLM config', 'error');
        } finally {
          setSavingLocal(false);
        }
      },
    });
  };

  const handleTestLocal = async () => {
    setLocalStatus('checking');
    const res = await testLocalLLM();
    showToast(res.ok ? `${res.message}` : `Unreachable: ${res.error}`, res.ok ? 'success' : 'error');
    if (res.ok) {
      setLocalStatus('connected');
      const modRes = await getLocalLLMModels();
      setLocalModels(modRes.models || []);
    } else {
      setLocalStatus('unreachable');
      setLocalModels([]);
    }
  };

  const getStatForPhase = (phase: AgentPhase): AgentStat | undefined =>
    agentStats.find(s => s.phase === phase);

  const agentIcons: Record<AgentPhase, any> = {
    analysis:    Search,
    intel:       Crosshair,
    knowledge:   BookOpen,
    correlation: Link2,
    recall:      Clock,
    ioc_check:   Hash,
    ticketing:   FileText,
    response:    Zap,
    validation:  CheckCircle,
  };

  const agentGroups: Array<{ label: string; phases: AgentPhase[] }> = [
    { label: 'Triage (mandatory)',         phases: ['analysis'] },
    { label: 'Investigators (parallel)',   phases: ['intel', 'knowledge', 'correlation', 'recall', 'ioc_check'] },
    { label: 'Composers (sequential)',     phases: ['ticketing', 'response', 'validation'] },
  ];

  const selectedAgent = agentDefs.find(a => a.phase === selectedPhase);
  const selectedModel = config?.assignments?.[selectedPhase] || config?.defaults?.[selectedPhase] || '';
  const selectedStat = getStatForPhase(selectedPhase);

  // ── External LLM provider registry ─────────────────────────────────────────
  const [providersData, setProvidersData] = useState<LlmProvidersResponse | null>(null);
  const [providerEditor, setProviderEditor] = useState<{ mode: 'create' | 'edit'; row?: LlmProviderRow } | null>(null);
  const [testingProviderId, setTestingProviderId] = useState<number | null>(null);

  const kindEmoji = (k: string) => k === 'openrouter' ? '☁' : k === 'openai' ? '🟢' : k === 'anthropic' ? '🟣' : k === 'gemini' ? '🔷' : '⚙';

  const describeAssignedModel = (m: string): string => {
    if (!m) return '—';
    if (m.startsWith('local::')) return `🖥 Ollama · ${m.replace('local::', '')}`;
    const idx = m.indexOf('::');
    if (idx > 0) {
      const kind = m.slice(0, idx);
      const bare = m.slice(idx + 2);
      return `${kindEmoji(kind)} ${kind} · ${bare}`;
    }
    return `☁ OpenRouter · ${m}`;
  };

  const reloadProviders = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await getLlmProviders();
      setProvidersData(data);
    } catch (err: any) {
      showToast(err?.message || 'Failed to load providers', 'error');
    }
  }, [isAdmin, showToast]);

  useEffect(() => { reloadProviders(); }, [reloadProviders]);

  const handleProviderTest = async (row: LlmProviderRow) => {
    setTestingProviderId(row.id);
    try {
      const r = await testLlmProvider(row.id);
      if (r.ok) showToast(`${row.name} OK (${r.latency_ms}ms · ${r.model})`);
      else      showToast(`${row.name} failed: ${r.error || 'unknown'}`, 'error');
      await reloadProviders();
      await getAgentModelConfig().then(setConfig).catch(() => {});
    } finally {
      setTestingProviderId(null);
    }
  };

  const handleProviderDelete = (row: LlmProviderRow) => {
    setStepUp({
      title: `Delete provider "${row.name}"?`,
      message: 'Re-authenticate to delete this provider. Any agent using it will fall through to the next provider in the chain.',
      destructive: true,
      run: async (token) => {
        setStepUp(null);
        try {
          await deleteLlmProvider(row.id, token);
          showToast(`Removed ${row.name}`);
          await reloadProviders();
          await getAgentModelConfig().then(setConfig).catch(() => {});
        } catch (err: any) {
          showToast(err?.message || 'Failed to delete', 'error');
        }
      },
    });
  };

  const handleProviderToggle = (row: LlmProviderRow) => {
    const targetEnabled = !row.enabled;
    setStepUp({
      title: targetEnabled ? `Enable "${row.name}"?` : `Disable "${row.name}"?`,
      message: targetEnabled
        ? 'Re-authenticate to enable this provider. It will become part of the active fallback chain.'
        : 'Re-authenticate to disable this provider. Agents pinned to its models will fall back to the next provider.',
      run: async (token) => {
        setStepUp(null);
        try {
          await updateLlmProvider(row.id, { enabled: targetEnabled }, token);
          showToast(targetEnabled ? `Enabled ${row.name}` : `Disabled ${row.name}`);
          await reloadProviders();
          await getAgentModelConfig().then(setConfig).catch(() => {});
        } catch (err: any) {
          showToast(err?.message || 'Failed', 'error');
        }
      },
    });
  };

  const statusColor: Record<string, string> = {
    unknown:     'text-[var(--t3)]',
    checking:    'text-blue-500',
    connected:   'text-[#1e8e3e]',
    unreachable: 'text-[#d93025]',
  };
  const statusLabel: Record<string, string> = {
    unknown:     '● Not checked',
    checking:    '● Checking…',
    connected:   `● Connected — ${localModels.length} model${localModels.length === 1 ? '' : 's'}`,
    unreachable: '● Unreachable',
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 text-[#d93025] p-3 rounded border border-red-100 text-[0.8rem] font-semibold">{error}</div>
      )}

      {/* ── External LLM Providers (API keys) ──────────────────────────────── */}
      {isAdmin && (
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--b1)] bg-[var(--s1)]">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-[var(--p1)]" />
              <p className="text-[0.9rem] font-black text-[var(--t7)]">API Providers</p>
              <span className="text-[0.65rem] text-[var(--t3)] font-semibold">
                {providersData ? `${providersData.providers.filter(p => p.enabled).length} active · ${providersData.providers.length} total` : 'loading…'}
              </span>
            </div>
            <button
              onClick={() => setProviderEditor({ mode: 'create' })}
              className="px-3 py-1.5 rounded-lg bg-[var(--p1)] text-white text-[0.72rem] font-bold hover:bg-[var(--pd)] transition-colors"
            >
              + Add Provider
            </button>
          </div>

          <div className="p-5">
            {!providersData ? (
              <p className="text-[0.78rem] text-[var(--t3)]">Loading providers…</p>
            ) : providersData.providers.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-[0.85rem] font-bold text-[var(--t5)]">No providers configured.</p>
                <p className="text-[0.7rem] text-[var(--t3)] mt-1">Add an OpenRouter, OpenAI, Anthropic or Gemini API key to power the AI agents.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {providersData.providers.map(p => {
                  const ok = p.last_test_ok === 1;
                  const failed = p.last_test_ok === 0;
                  return (
                    <div key={p.id} className={`flex items-center gap-3 px-3 py-2.5 border rounded-lg ${p.enabled ? 'bg-[var(--s0)] border-[var(--b1)]' : 'bg-[var(--s1)] border-[var(--b1)] opacity-60'}`}>
                      <span className="text-lg shrink-0">{kindEmoji(p.kind)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[0.85rem] font-black text-[var(--t7)] truncate">{p.name}</p>
                          <span className="px-1.5 py-0.5 rounded text-[0.55rem] font-black uppercase tracking-wide bg-[var(--sa)] text-[var(--p1)] shrink-0">{p.kind}</span>
                          {!p.enabled && <span className="px-1.5 py-0.5 rounded text-[0.55rem] font-black uppercase bg-slate-200 text-slate-500">Disabled</span>}
                        </div>
                        <p className="text-[0.65rem] text-[var(--t3)] font-mono truncate">
                          {p.base_url} · key: {p.api_key_mask} · priority {p.priority}
                          {p.last_test_at && (
                            <span className={`ml-2 font-bold ${ok ? 'text-green-600' : failed ? 'text-red-600' : 'text-[var(--t3)]'}`}>
                              {ok ? '✓ tested' : failed ? `✗ ${p.last_test_error?.slice(0, 50) || 'failed'}` : ''}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleProviderTest(p)}
                          disabled={testingProviderId === p.id}
                          className="px-2.5 py-1 text-[0.65rem] font-bold rounded border border-[var(--b2)] text-[var(--t5)] hover:bg-[var(--s1)] disabled:opacity-50"
                          title="Send a tiny test request"
                        >
                          {testingProviderId === p.id ? '…' : 'Test'}
                        </button>
                        <button
                          onClick={() => handleProviderToggle(p)}
                          className="px-2.5 py-1 text-[0.65rem] font-bold rounded border border-[var(--b2)] text-[var(--t5)] hover:bg-[var(--s1)]"
                        >
                          {p.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => setProviderEditor({ mode: 'edit', row: p })}
                          className="px-2.5 py-1 text-[0.65rem] font-bold rounded border border-[var(--b2)] text-[var(--t5)] hover:bg-[var(--s1)]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleProviderDelete(p)}
                          className="px-2.5 py-1 text-[0.65rem] font-bold rounded border border-red-200 text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-[0.62rem] text-[var(--t3)] mt-3">
              Providers are tried in priority order (lowest first). When one rate-limits, the next is used automatically.
              Changes here are audited and require re-authentication.
            </p>
          </div>
        </div>
      )}

      {/* ── Local LLM Server Card ──────────────────────────────────────────── */}
      <div className={`bg-[var(--s0)] border rounded-xl shadow-sm overflow-hidden ${localEnabled && localStatus === 'connected' ? 'border-[#1e8e3e]/40' : 'border-[var(--b1)]'}`}>
        <div className={`flex items-center justify-between px-5 py-3 border-b ${localEnabled && localStatus === 'connected' ? 'bg-green-50/50' : 'bg-[var(--s1)]'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${localEnabled && localStatus === 'connected' ? 'bg-[#1e8e3e]' : 'bg-slate-300'}`} />
            <p className="text-[0.9rem] font-black text-[var(--t7)]">Local LLM Server</p>
            <span className="text-[0.65rem] text-[var(--t3)] font-semibold">Ollama · OpenAI-compatible</span>
          </div>
          <span className={`text-[0.7rem] font-bold ${statusColor[localStatus]}`}>{statusLabel[localStatus]}</span>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-wider block mb-1">Ollama Server URL</label>
              <input
                type="text"
                value={localUrl}
                onChange={e => setLocalUrl(e.target.value)}
                disabled={!isAdmin}
                placeholder="http://localhost:11434"
                className="w-full border border-[var(--b2)] rounded px-3 py-2 text-[0.82rem] font-mono outline-none focus:border-[var(--p1)] disabled:opacity-60"
              />
            </div>
            <div className="flex items-center gap-2 pb-0.5">
              <label className="text-[0.7rem] font-bold text-[var(--t5)]">Enable</label>
              <button
                onClick={() => isAdmin && setLocalEnabled(v => !v)}
                disabled={!isAdmin}
                className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-50 ${localEnabled ? 'bg-[#1e8e3e]' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-[var(--s0)] rounded-full shadow transition-all ${localEnabled ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
            {isAdmin && (
              <>
                <button onClick={handleSaveLocalConfig} disabled={savingLocal} className="px-4 py-2 rounded-lg bg-[var(--p1)] text-white text-[0.75rem] font-bold hover:bg-[var(--pd)] disabled:opacity-50 transition-colors">
                  {savingLocal ? 'Saving…' : 'Save'}
                </button>
                <button onClick={handleTestLocal} disabled={localStatus === 'checking'} className="px-4 py-2 rounded-lg border border-[var(--p1)] text-[var(--p1)] text-[0.75rem] font-bold hover:bg-[var(--sa)] disabled:opacity-50 transition-colors">
                  {localStatus === 'checking' ? '…' : 'Test'}
                </button>
              </>
            )}
          </div>

          {/* Available models list */}
          {localStatus === 'connected' && localModels.length > 0 && (
            <div>
              <p className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-wider mb-2">Available Models ({localModels.length})</p>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {localModels.map(m => (
                  <span key={m.name} className="px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-green-800 text-[0.68rem] font-bold font-mono">
                    {m.name}
                    {m.size > 0 && <span className="ml-1 opacity-60">{(m.size / 1e9).toFixed(1)}GB</span>}
                  </span>
                ))}
              </div>
              <p className="text-[0.62rem] text-[var(--t3)] mt-1.5">Select a local model from the dropdown below using the <span className="font-mono bg-[var(--s1)] px-1 rounded">🖥 Local (Ollama)</span> group.</p>
            </div>
          )}
          {localStatus === 'unreachable' && (
            <div className="flex items-center gap-2 text-[0.75rem] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle size={14} />
              <span>Cannot reach Ollama at <span className="font-mono font-bold">{localUrl}</span>. Make sure Ollama is running (<span className="font-mono">ollama serve</span>).</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Agent Configuration: sidebar list + single detail panel ────────── */}
      <div className="grid grid-cols-[280px_1fr] gap-5">
        {/* Left: agent list grouped by orchestration stage */}
        <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm overflow-hidden self-start">
          <div className="px-4 py-3 border-b border-[var(--b1)] bg-[var(--s1)]">
            <h3 className="text-[0.82rem] font-black text-[var(--t7)]">Agents</h3>
            <p className="text-[0.62rem] text-[var(--t3)] mt-0.5">{agentDefs.length} phases · select to configure</p>
          </div>
          <div className="divide-y divide-[var(--b1)]">
            {agentGroups.map(group => (
              <div key={group.label} className="py-2">
                <p className="px-4 pt-1 pb-2 text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-[0.18em]">{group.label}</p>
                {group.phases.map(phase => {
                  const def = agentDefs.find(d => d.phase === phase);
                  if (!def) return null;
                  const Icon = agentIcons[phase];
                  const model = config?.assignments?.[phase] || config?.defaults?.[phase] || '';
                  const isLocal = model.startsWith('local::');
                  const isSelected = selectedPhase === phase;
                  const stat = getStatForPhase(phase);
                  const fallbackPct = stat && stat.total_runs > 0 ? Math.round((stat.fallback_count / stat.total_runs) * 100) : 0;
                  const modelLabel = isLocal ? model.replace('local::', '') : (config?.modelLabels?.[model] || model.split('/').pop() || model);
                  return (
                    <button
                      key={phase}
                      onClick={() => setSelectedPhase(phase)}
                      className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors border-l-2 ${
                        isSelected
                          ? 'bg-[var(--sa)] border-l-[var(--p1)]'
                          : 'border-l-transparent hover:bg-[var(--s1)]'
                      }`}
                    >
                      <Icon size={14} className={isSelected ? 'text-[var(--p1)]' : 'text-[var(--t3)]'} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-[0.76rem] font-bold truncate ${isSelected ? 'text-[var(--p1)]' : 'text-[var(--t7)]'}`}>{def.name}</p>
                        <p className="text-[0.6rem] text-[var(--t3)] truncate font-mono">{model ? modelLabel : '—'}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {fallbackPct > 30 && <AlertTriangle size={10} className="text-amber-600" />}
                        {isLocal && <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Local LLM" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Right: detail panel for the selected agent */}
        {selectedAgent && (() => {
          const isLocalAssigned = selectedModel.startsWith('local::');
          const isSaving = savingPhase === selectedPhase;
          const cloudOptions = config?.availableModels || [];
          const fallbackPct = selectedStat && selectedStat.total_runs > 0 ? Math.round((selectedStat.fallback_count / selectedStat.total_runs) * 100) : 0;
          const Icon = agentIcons[selectedPhase];

          return (
            <div className={`bg-[var(--s0)] border rounded-xl shadow-sm overflow-hidden ${isLocalAssigned ? 'border-green-300' : 'border-[var(--b1)]'}`}>
              {/* Header */}
              <div className={`flex justify-between items-center px-6 py-4 border-b ${isLocalAssigned ? 'bg-green-50/50' : 'bg-[var(--s1)]/50'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isLocalAssigned ? 'bg-green-100' : 'bg-[var(--sa)]'}`}>
                    <Icon size={18} className={isLocalAssigned ? 'text-green-700' : 'text-[var(--p1)]'} />
                  </div>
                  <div>
                    <h3 className="font-black text-[1rem] text-[var(--t7)]">{selectedAgent.name}</h3>
                    <p className="text-[0.6rem] font-mono text-[var(--t3)] uppercase tracking-wider mt-0.5">phase: {selectedPhase}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isLocalAssigned && <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 border border-green-200 text-[0.58rem] font-black uppercase tracking-wide">🖥 LOCAL</span>}
                  <span className="bg-green-50 text-green-600 px-2 py-0.5 rounded text-[0.6rem] font-bold uppercase border border-green-100">Active</span>
                </div>
              </div>

              <div className="p-6 space-y-5">
                {/* Description */}
                <div>
                  <p className="text-[0.62rem] font-black uppercase tracking-wider text-[var(--t3)] block mb-1.5">What this agent does</p>
                  <p className="text-[0.85rem] text-[var(--t5)] leading-relaxed">{selectedAgent.desc}</p>
                </div>

                {/* Model selector */}
                <div className="space-y-1.5">
                  <label className="text-[0.62rem] font-black uppercase tracking-wider text-[var(--t3)] block">Model Assignment</label>
                  <select
                    value={selectedModel}
                    disabled={!isAdmin || loading || isSaving}
                    onChange={(e) => handleModelChange(selectedPhase, e.target.value)}
                    className="w-full border border-[var(--b1)] rounded-lg px-3 py-2.5 text-[0.82rem] outline-none focus:border-[var(--p1)] disabled:opacity-60 bg-[var(--s0)]"
                  >
                    <optgroup label="☁ OpenRouter">
                      {cloudOptions.map((model) => (
                        <option key={model} value={model}>{config?.modelLabels?.[model] || model}</option>
                      ))}
                    </optgroup>
                    {(config?.providerGroups || [])
                      .filter(g => g.kind !== 'openrouter' && g.models.length > 0)
                      .map(g => (
                        <optgroup key={`${g.kind}-${g.providerId}`} label={`${kindEmoji(g.kind)} ${g.providerName} (${g.kind})`}>
                          {g.models.map(m => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    {localStatus === 'connected' && localModels.length > 0 && (
                      <optgroup label="🖥 Local (Ollama)">
                        {localModels.map(m => (
                          <option key={`local::${m.name}`} value={`local::${m.name}`}>{m.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <div className="flex justify-between items-center pt-0.5">
                    <span className="text-[0.65rem] text-[var(--t3)] font-semibold">
                      {isSaving ? 'Saving…' : describeAssignedModel(selectedModel)}
                    </span>
                    {!isAdmin && <span className="text-[0.62rem] text-amber-600 font-bold">Admin-only setting</span>}
                  </div>
                </div>

                {/* Stats strip */}
                <div className="grid grid-cols-3 gap-3 pt-1">
                  <div className="bg-[var(--s1)] border border-[var(--b1)] rounded-lg px-3 py-3 text-center">
                    <p className="text-[0.58rem] font-black text-[var(--t3)] uppercase tracking-wider mb-1">Total Runs</p>
                    <p className="text-[1.1rem] font-black text-[var(--t7)]">{selectedStat?.total_runs ?? '—'}</p>
                  </div>
                  <div className="bg-[var(--s1)] border border-[var(--b1)] rounded-lg px-3 py-3 text-center">
                    <p className="text-[0.58rem] font-black text-[var(--t3)] uppercase tracking-wider mb-1">Avg Confidence</p>
                    <p className={`text-[1.1rem] font-black ${
                      !selectedStat || selectedStat.avg_confidence == null ? 'text-[var(--t3)]' :
                      selectedStat.avg_confidence >= 80 ? 'text-[#1e8e3e]' :
                      selectedStat.avg_confidence >= 60 ? 'text-amber-600' : 'text-[#d93025]'
                    }`}>{selectedStat?.avg_confidence != null ? `${selectedStat.avg_confidence}%` : '—'}</p>
                  </div>
                  <div className="bg-[var(--s1)] border border-[var(--b1)] rounded-lg px-3 py-3 text-center">
                    <p className="text-[0.58rem] font-black text-[var(--t3)] uppercase tracking-wider mb-1">Feedback</p>
                    <p className={`text-[1.1rem] font-black ${
                      !selectedStat || selectedStat.feedback_total === 0 ? 'text-[var(--t3)]' :
                      (selectedStat.feedback_accurate / selectedStat.feedback_total) >= 0.75 ? 'text-[#1e8e3e]' :
                      (selectedStat.feedback_accurate / selectedStat.feedback_total) >= 0.5 ? 'text-amber-600' : 'text-[#d93025]'
                    }`}>{selectedStat && selectedStat.feedback_total > 0 ? `${selectedStat.feedback_accurate}/${selectedStat.feedback_total}` : '—'}</p>
                  </div>
                </div>

                {fallbackPct > 30 && (
                  <div className="flex items-center gap-2 text-[0.72rem] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-bold">
                    <AlertTriangle size={13} />
                    {fallbackPct}% fallback rate — the assigned model may be unavailable. Consider switching providers.
                  </div>
                )}

                {/* System prompt preview */}
                <div className="pt-2 border-t border-[var(--b1)]">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[0.62rem] font-black uppercase tracking-wider text-[var(--t3)]">System Prompt</p>
                    <button onClick={() => setPromptModal({ name: selectedAgent.name, prompt: selectedAgent.prompt })} className="flex items-center gap-1 text-[var(--p1)] text-[0.7rem] font-bold hover:underline">
                      <Eye size={12} />
                      Expand
                    </button>
                  </div>
                  <pre className="text-[0.65rem] bg-slate-950 text-emerald-400 p-3 rounded-lg font-mono leading-relaxed max-h-32 overflow-hidden line-clamp-6 whitespace-pre-wrap">
                    {selectedAgent.prompt}
                  </pre>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Prompt modal */}
      {promptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--s0)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-7 py-5 bg-[var(--pd)] text-white shrink-0">
              <div>
                <p className="text-[0.65rem] font-black uppercase tracking-widest text-blue-200 mb-0.5">System Prompt</p>
                <h3 className="text-[1rem] font-black">{promptModal.name}</h3>
              </div>
              <button onClick={() => setPromptModal(null)} className="p-1 hover:bg-[var(--s0)]/10 rounded"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <pre className="text-[0.78rem] bg-slate-950 text-emerald-400 p-5 rounded-xl font-mono leading-relaxed whitespace-pre-wrap">{promptModal.prompt}</pre>
            </div>
            <div className="px-6 py-4 border-t bg-[var(--s1)] flex justify-end shrink-0">
              <button onClick={() => setPromptModal(null)} className="px-5 py-2 rounded border border-[var(--b2)] text-[var(--t5)] font-semibold text-sm hover:bg-[var(--s1)]">Close</button>
            </div>
          </div>
        </div>
      )}
      {providerEditor && providersData && (
        <ProviderEditorModal
          mode={providerEditor.mode}
          row={providerEditor.row}
          kinds={providersData.kinds}
          onClose={() => setProviderEditor(null)}
          onSave={async (payload) => {
            const isCreate = providerEditor.mode === 'create';
            setStepUp({
              title: isCreate ? `Add provider "${payload.name}"?` : `Update provider "${payload.name}"?`,
              message: 'Re-authenticate to save this provider configuration. This change is audited.',
              run: async (token) => {
                setStepUp(null);
                try {
                  if (isCreate) await createLlmProvider(payload, token);
                  else await updateLlmProvider(providerEditor.row!.id, payload, token);
                  showToast(isCreate ? 'Provider added' : 'Provider updated');
                  setProviderEditor(null);
                  await reloadProviders();
                  await getAgentModelConfig().then(setConfig).catch(() => {});
                } catch (err: any) {
                  showToast(err?.message || 'Failed to save', 'error');
                }
              },
            });
          }}
        />
      )}
      {stepUp && (
        <StepUpModal
          title={stepUp.title}
          message={stepUp.message}
          destructive={stepUp.destructive}
          onVerified={stepUp.run}
          onCancel={() => setStepUp(null)}
        />
      )}
    </div>
  );
};

const ProviderEditorModal: React.FC<{
  mode: 'create' | 'edit';
  row?: LlmProviderRow;
  kinds: Array<{ id: string; label: string; base_url: string }>;
  onClose: () => void;
  onSave: (payload: { name: string; kind: string; base_url: string; api_key: string; priority: number; enabled: boolean; headers_json?: string }) => void;
}> = ({ mode, row, kinds, onClose, onSave }) => {
  const [name, setName]         = useState(row?.name || '');
  const [kind, setKind]         = useState(row?.kind || 'openrouter');
  const [baseUrl, setBaseUrl]   = useState(row?.base_url || '');
  const [apiKey, setApiKey]     = useState('');
  const [priority, setPriority] = useState<number>(row?.priority ?? 100);
  const [enabled, setEnabled]   = useState<boolean>(row ? !!row.enabled : true);
  const [showKey, setShowKey]   = useState(false);

  // When the kind changes, prefill base_url from the catalog default
  useEffect(() => {
    const k = kinds.find(x => x.id === kind);
    if (k && (mode === 'create' || !row?.base_url)) setBaseUrl(k.base_url);
  }, [kind, kinds, mode, row?.base_url]);

  const submit = () => {
    if (!name.trim()) return;
    if (mode === 'create' && !apiKey.trim()) return;
    const payload: any = {
      name: name.trim(),
      kind,
      base_url: baseUrl.trim(),
      priority,
      enabled,
    };
    if (apiKey.trim()) payload.api_key = apiKey.trim();
    onSave(payload);
  };

  const placeholderForKind = (k: string): string => {
    if (k === 'openai')    return 'sk-proj-…';
    if (k === 'anthropic') return 'sk-ant-…';
    if (k === 'openrouter')return 'sk-or-v1-…';
    if (k === 'gemini')    return 'AI…';
    return 'API key';
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-[var(--s0)] rounded-2xl shadow-2xl border border-[var(--b1)] w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--b1)] flex items-center justify-between">
          <h3 className="text-[1rem] font-black text-[var(--t7)]">
            {mode === 'create' ? 'Add LLM Provider' : `Edit "${row?.name}"`}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--s1)] rounded"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-wider block mb-1">Display name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. OpenAI primary"
              className="w-full border border-[var(--b2)] rounded px-3 py-2 text-[0.82rem] outline-none focus:border-[var(--p1)]"
            />
          </div>

          <div>
            <label className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-wider block mb-1">Provider type</label>
            <select
              value={kind}
              onChange={e => setKind(e.target.value)}
              className="w-full border border-[var(--b2)] rounded px-3 py-2 text-[0.82rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)]"
            >
              {kinds.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-wider block mb-1">Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="w-full border border-[var(--b2)] rounded px-3 py-2 text-[0.82rem] font-mono outline-none focus:border-[var(--p1)]"
            />
            <p className="text-[0.6rem] text-[var(--t3)] mt-1">Must speak the OpenAI-compatible REST shape (chat/completions).</p>
          </div>

          <div>
            <label className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-wider block mb-1">
              API key {mode === 'edit' && <span className="font-mono text-[var(--p1)] ml-1">(leave blank to keep current: {row?.api_key_mask})</span>}
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={placeholderForKind(kind)}
                className="w-full border border-[var(--b2)] rounded px-3 py-2 pr-16 text-[0.82rem] font-mono outline-none focus:border-[var(--p1)]"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[0.62rem] font-bold text-[var(--p1)] hover:underline"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-wider block mb-1">Priority</label>
              <input
                type="number"
                value={priority}
                onChange={e => setPriority(Math.max(0, Math.min(9999, parseInt(e.target.value, 10) || 0)))}
                className="w-full border border-[var(--b2)] rounded px-3 py-2 text-[0.82rem] outline-none focus:border-[var(--p1)]"
              />
              <p className="text-[0.6rem] text-[var(--t3)] mt-1">Lower number = tried earlier.</p>
            </div>
            <div className="flex flex-col">
              <label className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-wider block mb-1">Enabled</label>
              <button
                type="button"
                onClick={() => setEnabled(v => !v)}
                className={`flex items-center gap-2 px-3 py-2 rounded border ${enabled ? 'bg-green-50 border-green-300 text-green-800' : 'bg-slate-50 border-slate-300 text-slate-500'} text-[0.78rem] font-bold`}
              >
                <span className={`w-2 h-2 rounded-full ${enabled ? 'bg-green-600' : 'bg-slate-400'}`} />
                {enabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[var(--b1)] bg-[var(--s1)] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded border border-[var(--b2)] text-[var(--t5)] font-bold text-[0.78rem] hover:bg-[var(--s0)]">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim() || (mode === 'create' && !apiKey.trim())}
            className="px-4 py-2 rounded bg-[var(--p1)] text-white font-bold text-[0.78rem] hover:bg-[var(--pd)] disabled:opacity-50"
          >
            {mode === 'create' ? 'Add provider' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
};


export { AgentsTab };
