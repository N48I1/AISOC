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
import { AgentRunStatus } from '../../components/AgentRunStatus';
import { ProviderHealthBadge } from '../../components/ProviderHealthBadge';
import { CopyButton } from '../../components/CopyButton';
import { getAlert } from '../../services/aiService';
import { severityChipColor, timeAgo } from '../../lib/format';

const MANDATORY_PHASES    = ['analysis'];
const INVESTIGATOR_PHASES = ['intel', 'knowledge', 'correlation', 'recall', 'ioc_check'];
const COMPOSER_PHASES     = ['ticketing', 'response', 'validation'];


const AlertRow = ({ alert, onClick, isSelected }: { alert: Alert, onClick: () => void, isSelected?: boolean, key?: any }) => {
  let aiData: any = null;
  try { aiData = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch (e) {}

  const riskScore = aiData?.phaseData?.analysis?.risk_score;
  const isFP = aiData?.phaseData?.analysis?.is_false_positive;
  const summary = aiData?.summary || alert.description;
  const pd = aiData?.phaseData || {};
  const agents = ['analysis', 'intel', 'knowledge', 'correlation', 'recall', 'ioc_check', 'ticketing', 'response', 'validation'];
  const phaseDone = (phase: string) => phase === 'ticketing' ? !!pd.ticket : !!pd[phase];

  const riskColor = riskScore == null ? '#cbd5e1' : riskScore >= 80 ? '#ef4444' : riskScore >= 60 ? '#f97316' : riskScore >= 40 ? '#f59e0b' : '#10b981';

  return (
    <motion.div 
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClick}
      className={`alert-item p-4 border-b border-[var(--b3)] cursor-pointer transition-all ${isSelected ? 'bg-[var(--sa)] border-l-4 border-l-[var(--p1)]' : 'hover:bg-[var(--s1)] border-l-4 border-l-transparent'}`}
    >
      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center gap-1 mt-0.5 shrink-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center border-2 shadow-sm" style={{ borderColor: riskColor, backgroundColor: `${riskColor}10` }}>
            <span className="text-[0.85rem] font-black" style={{ color: riskColor }}>
              {riskScore != null ? riskScore : alert.severity}
            </span>
          </div>
          <span className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest">{riskScore != null ? 'Risk' : 'Lvl'}</span>
        </div>

        <div className="flex-1 min-w-0 py-0.5">
          <div className="flex items-center gap-2 mb-1">
            {isFP && <span className="px-1.5 py-0.5 rounded-lg bg-[var(--s2)] text-[var(--t4)] border border-[var(--b2)] text-[0.55rem] font-black uppercase tracking-wider shrink-0">False Positive</span>}
            <h4 className="text-[0.85rem] font-bold text-[var(--t1)] truncate leading-tight" title={summary}>{summary}</h4>
          </div>
          
          <div className="flex items-center gap-3 text-[0.7rem] text-[var(--t4)] font-medium mb-2">
            <span className="font-mono text-[0.6rem] bg-[var(--s1)] text-[var(--p1)] rounded-md px-1.5 py-0.5 border border-[var(--b2)] select-all">#{alert.id.substring(0,8).toUpperCase()}</span>
            <span className="truncate flex items-center gap-1"><Activity size={10} /> {alert.source_ip || alert.agent_name}</span>
            <span className="shrink-0 flex items-center gap-1 ml-auto"><Clock size={10} /> {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          <div className="flex items-center gap-1.5">
            {agents.map(a => {
              const isDone = phaseDone(a);
              const prev = agents[agents.indexOf(a) - 1];
              const isRunning = alert.status === 'ANALYZING' && !isDone && (a === 'analysis' || phaseDone(prev));
              return (
                <div key={a} title={a} className={`h-1 flex-1 rounded-full transition-all duration-500 ${isDone ? 'bg-[var(--p1)] shadow-[0_0_4px_var(--pa)]' : isRunning ? 'bg-blue-400 animate-pulse' : 'bg-[var(--s2)]'}`} />
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
};


const DetailedReport = ({ alert, aiData, mitreTags, onClose }: { alert: Alert, aiData: any, mitreTags: string[], onClose: () => void }) => {
  const [exportFormat, setExportFormat] = useState<'txt' | 'xml' | 'pdf' | 'md'>('pdf');
  const severity = alert.severity >= 13 ? 'CRITICAL' : alert.severity >= 10 ? 'HIGH' : alert.severity >= 7 ? 'MEDIUM' : 'LOW';
  const sevColor: Record<string, string> = { CRITICAL: '#d93025', HIGH: '#f29900', MEDIUM: '#d97706', LOW: '#1e8e3e' };

  const pd = aiData?.phaseData || {};
  const analysis = pd.analysis || {};
  const intel = pd.intel || {};
  const knowledge = pd.knowledge || {};
  const correlation = pd.correlation || {};
  const ticket = pd.ticket || aiData?.ticket || {};
  const response = pd.response || aiData?.response || {};
  const validation = pd.validation || {};
  const responseActions = response?.actions || [];
  const iocs = aiData?.iocs || analysis?.iocs || {};
  const reportId = `INC-${alert.id.substring(0, 8).toUpperCase()}`;
  const generatedAt = new Date();
  const generatedIso = generatedAt.toISOString();
  const filenameBase = `incident-${alert.id}-report`;

  const asList = (value: any): string[] => Array.isArray(value) ? value.filter(Boolean).map(String) : [];
  const remediationSteps = (alert.remediation_steps || knowledge?.remediation_steps || '')
    .split('\n')
    .map((s: string) => s.trim())
    .filter(Boolean)
    .map((s: string) => s.replace(/^\d+[\.\)]\s*/, '').replace(/^[-*]\s*/, ''));

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const xmlEscape = (value: any) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const htmlEscape = (value: any) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const textReport = [
    `BBS AISOC INCIDENT REPORT`,
    `Report ID: ${reportId}`,
    `Generated: ${generatedAt.toLocaleString()}`,
    `Status: ${alert.status}`,
    `Severity: ${severity} (Wazuh level ${alert.severity})`,
    `Email notification: ${alert.email_sent === 1 ? 'Sent' : 'Not sent'}`,
    ``,
    `1. EXECUTIVE SUMMARY`,
    `Description: ${alert.description}`,
    `AI Summary: ${aiData?.summary || analysis?.analysis_summary || 'No AI summary available.'}`,
    `Risk Score: ${analysis?.risk_score ?? 'N/A'}`,
    `Recommended Action: ${analysis?.recommended_action || validation?.recommendation || 'N/A'}`,
    `False Positive: ${analysis?.is_false_positive === true ? 'Yes' : analysis?.is_false_positive === false ? 'No' : 'Unknown'}`,
    analysis?.false_positive_reason ? `False Positive Reason: ${analysis.false_positive_reason}` : '',
    ``,
    `2. ALERT DETAILS`,
    `Alert ID: ${alert.id}`,
    `Timestamp: ${new Date(alert.timestamp).toLocaleString()}`,
    `Rule ID: ${alert.rule_id || 'N/A'}`,
    `Source IP: ${alert.source_ip || 'N/A'}`,
    `Destination IP: ${alert.dest_ip || 'N/A'}`,
    `User: ${alert.user || 'N/A'}`,
    `Agent: ${alert.agent_name || 'N/A'}`,
    `Hostname: ${alert.hostname || 'N/A'}`,
    ``,
    `3. INDICATORS OF COMPROMISE`,
    `IPs: ${(asList(iocs.ips).length ? asList(iocs.ips) : alert.source_ip ? [alert.source_ip] : ['N/A']).join(', ')}`,
    `Users: ${asList(iocs.users).join(', ') || alert.user || 'N/A'}`,
    `Hosts: ${(asList(iocs.hosts).length ? asList(iocs.hosts) : alert.agent_name ? [alert.agent_name] : ['N/A']).join(', ')}`,
    `Domains: ${asList(iocs.domains).join(', ') || 'N/A'}`,
    `Hashes: ${asList(iocs.hashes).join(', ') || 'N/A'}`,
    `Files: ${asList(iocs.files).join(', ') || 'N/A'}`,
    `Processes: ${asList(iocs.processes).join(', ') || 'N/A'}`,
    `Ports: ${asList(iocs.ports).join(', ') || 'N/A'}`,
    ``,
    `4. MITRE ATT&CK`,
    mitreTags.length ? mitreTags.map(t => `- ${t}`).join('\n') : '- No techniques mapped.',
    ``,
    `5. THREAT INTELLIGENCE`,
    aiData?.intel || intel?.intel_summary || 'No threat intelligence summary available.',
    intel?.misp ? `MISP Hits: ${intel.misp.hits ?? 0}` : '',
    ``,
    `6. CORRELATION`,
    correlation?.campaign_name || aiData?.correlation || 'No campaign correlation available.',
    correlation?.campaign_description || '',
    ``,
    `7. TICKETING / BUSINESS IMPACT`,
    `Title: ${ticket?.title || 'N/A'}`,
    `Priority: ${ticket?.priority || 'N/A'}`,
    `Business Impact: ${ticket?.business_impact || 'N/A'}`,
    ticket?.report_body || '',
    ``,
    `8. REMEDIATION`,
    remediationSteps.length ? remediationSteps.map((s, i) => `${i + 1}. ${s}`).join('\n') : 'No remediation steps available.',
    ``,
    `9. RESPONSE PLAN`,
    responseActions.length
      ? responseActions.map((a: any, i: number) => `${i + 1}. ${a.type || 'ACTION'} -> ${a.target || 'N/A'}\n   Reason: ${a.reason || 'N/A'}\n   Automated: ${a.automated ? 'Yes' : 'No'}`).join('\n')
      : 'No response actions generated.',
    `Approval Required: ${response?.approval_required === true ? 'Yes' : response?.approval_required === false ? 'No' : 'Unknown'}`,
    ``,
    `10. SLA / VALIDATION`,
    `SLA Status: ${validation?.sla_status || aiData?.validation || 'Pending'}`,
    `Completeness Score: ${validation?.completeness_score ?? 'N/A'}`,
    `Recommendation: ${validation?.recommendation || 'N/A'}`,
    ``,
    `11. RAW WAZUH LOG`,
    alert.full_log || 'No log data.',
  ].filter(Boolean).join('\n');

  const xmlReport = `<?xml version="1.0" encoding="UTF-8"?>
<incidentReport id="${xmlEscape(reportId)}" generatedAt="${xmlEscape(generatedIso)}">
  <status>${xmlEscape(alert.status)}</status>
  <severity label="${xmlEscape(severity)}" wazuhLevel="${xmlEscape(alert.severity)}" />
  <emailNotification sent="${alert.email_sent === 1 ? 'true' : 'false'}" />
  <alert>
    <id>${xmlEscape(alert.id)}</id>
    <timestamp>${xmlEscape(alert.timestamp)}</timestamp>
    <ruleId>${xmlEscape(alert.rule_id)}</ruleId>
    <description>${xmlEscape(alert.description)}</description>
    <sourceIp>${xmlEscape(alert.source_ip || '')}</sourceIp>
    <destinationIp>${xmlEscape(alert.dest_ip || '')}</destinationIp>
    <user>${xmlEscape(alert.user || '')}</user>
    <agent>${xmlEscape(alert.agent_name || '')}</agent>
    <hostname>${xmlEscape(alert.hostname || '')}</hostname>
  </alert>
  <analysis>
    <summary>${xmlEscape(aiData?.summary || analysis?.analysis_summary || '')}</summary>
    <riskScore>${xmlEscape(analysis?.risk_score ?? '')}</riskScore>
    <recommendedAction>${xmlEscape(analysis?.recommended_action || validation?.recommendation || '')}</recommendedAction>
    <falsePositive>${analysis?.is_false_positive === true ? 'true' : analysis?.is_false_positive === false ? 'false' : ''}</falsePositive>
    <falsePositiveReason>${xmlEscape(analysis?.false_positive_reason || '')}</falsePositiveReason>
  </analysis>
  <iocs>
${['ips','users','hosts','domains','hashes','files','processes','ports'].map(type =>
  `    <${type}>${asList(iocs[type]).map(v => `<value>${xmlEscape(v)}</value>`).join('')}</${type}>`
).join('\n')}
  </iocs>
  <mitreAttack>
${mitreTags.map(t => `    <technique>${xmlEscape(t)}</technique>`).join('\n')}
  </mitreAttack>
  <threatIntelligence>${xmlEscape(aiData?.intel || intel?.intel_summary || '')}</threatIntelligence>
  <correlation>
    <campaignName>${xmlEscape(correlation?.campaign_name || aiData?.correlation || '')}</campaignName>
    <description>${xmlEscape(correlation?.campaign_description || '')}</description>
  </correlation>
  <ticket>
    <title>${xmlEscape(ticket?.title || '')}</title>
    <priority>${xmlEscape(ticket?.priority || '')}</priority>
    <businessImpact>${xmlEscape(ticket?.business_impact || '')}</businessImpact>
    <body>${xmlEscape(ticket?.report_body || '')}</body>
  </ticket>
  <remediation>
${remediationSteps.map((s, i) => `    <step order="${i + 1}">${xmlEscape(s)}</step>`).join('\n')}
  </remediation>
  <responsePlan approvalRequired="${response?.approval_required === true ? 'true' : response?.approval_required === false ? 'false' : ''}">
${responseActions.map((a: any, i: number) => `    <action order="${i + 1}">
      <type>${xmlEscape(a.type || '')}</type>
      <target>${xmlEscape(a.target || '')}</target>
      <reason>${xmlEscape(a.reason || '')}</reason>
      <automated>${a.automated ? 'true' : 'false'}</automated>
    </action>`).join('\n')}
  </responsePlan>
  <validation>
    <slaStatus>${xmlEscape(validation?.sla_status || aiData?.validation || '')}</slaStatus>
    <completenessScore>${xmlEscape(validation?.completeness_score ?? '')}</completenessScore>
    <recommendation>${xmlEscape(validation?.recommendation || '')}</recommendation>
  </validation>
  <rawLog>${xmlEscape(alert.full_log || '')}</rawLog>
</incidentReport>
`;

  const markdownReport = textReport
    .replace(/^BBS AISOC INCIDENT REPORT/m, '# BBS AISOC Incident Report')
    .replace(/^(\d+)\. ([A-Z /]+)$/gm, '\n---\n## $1. $2');

  const exportText = () => downloadFile(textReport, `${filenameBase}.txt`, 'text/plain;charset=utf-8');
  const exportXml = () => downloadFile(xmlReport, `${filenameBase}.xml`, 'application/xml;charset=utf-8');
  const exportMarkdown = () => downloadFile(markdownReport, `${filenameBase}.md`, 'text/markdown;charset=utf-8');
  const exportPdf = () => {
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${htmlEscape(reportId)} - BBS AISOC Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #1f2937; margin: 32px; line-height: 1.45; }
    h1 { color: #003a7a; margin-bottom: 4px; }
    h2 { color: #004a99; border-bottom: 1px solid #d1d9e6; padding-bottom: 6px; margin-top: 24px; }
    .meta { color: #64748b; font-size: 12px; margin-bottom: 18px; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 6px; background: #f1f5f9; margin-right: 6px; font-size: 12px; font-weight: 700; }
    .sev { background: ${sevColor[severity]}22; color: ${sevColor[severity]}; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; }
    pre { background: #0f172a; color: #34d399; padding: 12px; border-radius: 8px; white-space: pre-wrap; font-size: 11px; }
    @media print { body { margin: 18mm; } button { display: none; } }
  </style>
</head>
<body>
  <button onclick="window.print()" style="float:right;padding:8px 12px">Print / Save PDF</button>
  <h1>BBS AISOC Incident Report</h1>
  <div class="meta">${htmlEscape(reportId)} · Generated ${htmlEscape(generatedAt.toLocaleString())}</div>
  <span class="badge sev">${htmlEscape(severity)}</span><span class="badge">${htmlEscape(alert.status)}</span><span class="badge">Wazuh ${htmlEscape(alert.severity)}</span>
  <h2>Executive Summary</h2>
  <p>${htmlEscape(aiData?.summary || analysis?.analysis_summary || 'No AI summary available.')}</p>
  <table>
    <tr><th>Description</th><td>${htmlEscape(alert.description)}</td></tr>
    <tr><th>Alert ID</th><td>${htmlEscape(alert.id)}</td></tr>
    <tr><th>Rule ID</th><td>${htmlEscape(alert.rule_id || 'N/A')}</td></tr>
    <tr><th>Source IP</th><td>${htmlEscape(alert.source_ip || 'N/A')}</td></tr>
    <tr><th>Agent</th><td>${htmlEscape(alert.agent_name || 'N/A')}</td></tr>
    <tr><th>Risk Score</th><td>${htmlEscape(analysis?.risk_score ?? 'N/A')}</td></tr>
    <tr><th>Recommended Action</th><td>${htmlEscape(analysis?.recommended_action || validation?.recommendation || 'N/A')}</td></tr>
  </table>
  <h2>Indicators of Compromise</h2>
  <p>${htmlEscape(['ips','users','hosts','domains','hashes','files','processes','ports'].map(k => `${k}: ${asList(iocs[k]).join(', ') || 'N/A'}`).join(' | '))}</p>
  <h2>MITRE ATT&CK</h2>
  <p>${htmlEscape(mitreTags.join(', ') || 'No techniques mapped.')}</p>
  <h2>Threat Intelligence</h2>
  <p>${htmlEscape(aiData?.intel || intel?.intel_summary || 'No threat intelligence summary available.')}</p>
  <h2>Correlation</h2>
  <p>${htmlEscape(correlation?.campaign_name || aiData?.correlation || 'No campaign correlation available.')}</p>
  <h2>Remediation</h2>
  <ol>${(remediationSteps.length ? remediationSteps : ['No remediation steps available.']).map(s => `<li>${htmlEscape(s)}</li>`).join('')}</ol>
  <h2>Response Plan</h2>
  <ol>${(responseActions.length ? responseActions : [{ type: 'No response actions generated', target: '', reason: '' }]).map((a: any) => `<li><strong>${htmlEscape(a.type || 'ACTION')}</strong> ${htmlEscape(a.target || '')}<br/>${htmlEscape(a.reason || '')}</li>`).join('')}</ol>
  <h2>SLA / Validation</h2>
  <p>${htmlEscape(validation?.sla_status || aiData?.validation || 'Pending')}</p>
  <h2>Raw Wazuh Log</h2>
  <pre>${htmlEscape(alert.full_log || 'No log data.')}</pre>
</body>
</html>`;
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.setAttribute('aria-hidden', 'true');
    document.body.appendChild(frame);

    const doc = frame.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(frame);
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) return;
      win.focus();
      win.print();
      setTimeout(() => {
        if (document.body.contains(frame)) document.body.removeChild(frame);
      }, 1000);
    };
  };

  const handleDownload = () => {
    if (exportFormat === 'txt') exportText();
    if (exportFormat === 'xml') exportXml();
    if (exportFormat === 'pdf') exportPdf();
    if (exportFormat === 'md') exportMarkdown();
  };

  const Section = ({ title, children }: { title: string, children: React.ReactNode }) => (
    <section>
      <h3 className="text-[0.7rem] font-black text-[var(--p1)] uppercase tracking-widest mb-3 pb-2 border-b border-[#e8eef7]">
        {title}
      </h3>
      {children}
    </section>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[var(--s0)] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 bg-[var(--pd)] text-white shrink-0">
          <div>
            <p className="text-[0.65rem] font-black uppercase tracking-widest text-blue-200 mb-0.5">Aegis SOC — Final Incident Report</p>
            <h2 className="text-[1.1rem] font-black tracking-tight">INC-{alert.id.substring(0, 8).toUpperCase()}</h2>
            <p className="text-[0.75rem] text-blue-200 mt-0.5 truncate max-w-sm">{alert.description}</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as 'txt' | 'xml' | 'pdf' | 'md')}
              className="h-9 rounded-lg bg-[var(--s0)]/10 border border-white/20 text-white text-[0.75rem] font-bold px-2 outline-none hover:bg-[var(--s0)]/20"
              title="Export format"
            >
              <option className="text-[var(--t1)]" value="pdf">PDF</option>
              <option className="text-[var(--t1)]" value="txt">Text</option>
              <option className="text-[var(--t1)]" value="xml">XML</option>
              <option className="text-[var(--t1)]" value="md">Markdown</option>
            </select>
            <button
              onClick={handleDownload}
              aria-label="Download report"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--s0)]/10 hover:bg-[var(--s0)]/20 text-white text-[0.75rem] font-bold transition-colors border border-white/20"
            >
              <ChevronRight size={13} className="rotate-90" />
              Download
            </button>
            <button onClick={onClose} aria-label="Close report modal" className="p-2 hover:bg-[var(--s0)]/10 rounded-lg transition-colors">
              <XCircle size={20} />
            </button>
          </div>
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-3 px-7 py-2.5 bg-[var(--s1)] border-b border-[var(--b2)] text-[0.7rem] font-bold shrink-0">
          <span
            className="px-2.5 py-1 rounded-full uppercase tracking-wide"
            style={{ background: `${sevColor[severity]}18`, color: sevColor[severity] }}
          >
            {severity}
          </span>
          <span className="text-[var(--t3)]">|</span>
          <span className={`px-2.5 py-1 rounded-full uppercase tracking-wide ${
            alert.status === 'TRIAGED' ? 'bg-green-50 text-green-700' :
            alert.status === 'ANALYZING' ? 'bg-blue-50 text-blue-700' :
            'bg-[var(--s1)] text-[var(--t5)]'
          }`}>{alert.status}</span>
          {alert.email_sent === 1 && (
            <>
              <span className="text-[var(--t3)]">|</span>
              <span className="flex items-center gap-1 text-green-600"><Bell size={11} fill="currentColor" /> Email sent</span>
            </>
          )}
          <span className="ml-auto text-[var(--t3)]">{new Date(alert.timestamp).toLocaleString()}</span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-6 text-sm">

          <Section title="1 — Executive Summary">
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'Source IP', value: alert.source_ip || 'N/A' },
                { label: 'Hostname', value: alert.agent_name || 'N/A' },
                { label: 'Rule ID', value: alert.rule_id || 'N/A' },
              ].map(f => (
                <div key={f.label} className="bg-[var(--s1)] border border-[var(--b2)] rounded-lg p-3">
                  <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-wider mb-1">{f.label}</p>
                  <p className="font-mono font-bold text-[0.8rem] text-[var(--t7)] truncate">{f.value}</p>
                </div>
              ))}
            </div>
            <div className="bg-[var(--sa)] border border-[#c8ddf7] rounded-xl p-4 text-[var(--t6)] leading-relaxed italic text-[0.85rem]">
              {aiData?.summary || 'No AI summary available. Run the Alert Triage agent first.'}
            </div>
            {(() => {
              const pd = aiData?.phaseData?.analysis;
              if (!pd) return null;
              const ac = pd.attack_category as string | undefined;
              const kc = pd.kill_chain_stage as string | undefined;
              const rs = pd.risk_score as number | undefined;
              const ra = pd.recommended_action as string | undefined;
              const sv = pd.severity_validation as string | undefined;
              const isFP = pd.is_false_positive as boolean | undefined;
              const fpReason = pd.false_positive_reason as string | undefined;
              if (!ac && !kc && rs == null && !ra) return null;
              const rsColor = rs == null ? 'bg-slate-300' : rs >= 80 ? 'bg-red-500' : rs >= 60 ? 'bg-orange-500' : rs >= 40 ? 'bg-amber-400' : 'bg-emerald-500';
              const svColor: Record<string, string> = { CRITICAL: 'bg-red-100 text-red-800 border-red-300', HIGH: 'bg-orange-100 text-orange-800 border-orange-300', MEDIUM: 'bg-amber-100 text-amber-800 border-amber-300', LOW: 'bg-green-100 text-green-800 border-green-300' };
              const raColor: Record<string, string> = { IGNORE: 'bg-[var(--s1)] text-[var(--t5)] border-[var(--b1)]', MONITOR: 'bg-blue-100 text-blue-700 border-blue-300', INVESTIGATE: 'bg-cyan-100 text-cyan-700 border-cyan-300', ESCALATE: 'bg-amber-100 text-amber-700 border-amber-300', CONTAIN: 'bg-orange-100 text-orange-700 border-orange-300', BLOCK: 'bg-red-100 text-red-700 border-red-300' };
              return (
                <div className="mt-3 space-y-2.5">
                  <div className="flex flex-wrap gap-2 items-center">
                    {ac && <span className="px-2.5 py-1 rounded-lg bg-blue-100 text-blue-800 border border-blue-200 text-[0.68rem] font-bold uppercase tracking-wide">{ac.replace(/_/g, ' ')}</span>}
                    {kc && <span className="px-2.5 py-1 rounded-lg bg-purple-100 text-purple-800 border border-purple-200 text-[0.68rem] font-bold uppercase tracking-wide">{kc.replace(/_/g, ' ')}</span>}
                    {sv && <span className={`px-2.5 py-1 rounded-lg border text-[0.68rem] font-bold uppercase tracking-wide ${svColor[sv] ?? ''}`}>{sv} (validated)</span>}
                    {ra && <span className={`px-2.5 py-1 rounded-lg border text-[0.68rem] font-bold uppercase tracking-wide ${raColor[ra] ?? ''}`}>Action: {ra}</span>}
                    {isFP && <span className="px-2.5 py-1 rounded-lg bg-red-100 text-red-700 border border-red-300 text-[0.68rem] font-bold uppercase tracking-wide">False Positive</span>}
                  </div>
                  {rs != null && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[0.65rem] text-[var(--t4)] font-semibold">
                        <span>Risk Score</span><span>{rs}/100</span>
                      </div>
                      <div className="w-full h-2 bg-[var(--s1)] rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${rsColor}`} style={{ width: `${rs}%` }} />
                      </div>
                    </div>
                  )}
                  {isFP && fpReason && (
                    <p className="text-[0.72rem] text-[var(--t4)] italic">{fpReason}</p>
                  )}
                </div>
              );
            })()}
          </Section>

          <Section title="2 — Indicators of Compromise">
            <div className="flex flex-wrap gap-2">
              {(iocs.ips?.length ? iocs.ips : alert.source_ip ? [alert.source_ip] : []).map((ip: string) => (
                <span key={ip} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-50 border border-red-200 rounded-lg text-red-800 font-mono text-[0.75rem] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />IP: {ip}
                </span>
              ))}
              {(iocs.users || []).map((u: string) => (
                <span key={u} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-orange-50 border border-orange-200 rounded-lg text-orange-800 font-mono text-[0.75rem] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />User: {u}
                </span>
              ))}
              {(iocs.hosts?.length ? iocs.hosts : alert.agent_name ? [alert.agent_name] : []).map((h: string) => (
                <span key={h} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-purple-50 border border-purple-200 rounded-lg text-purple-800 font-mono text-[0.75rem] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />Host: {h}
                </span>
              ))}
              {(iocs.domains || []).map((d: string) => (
                <span key={d} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-sky-50 border border-sky-200 rounded-lg text-sky-800 font-mono text-[0.75rem] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />Domain: {d}
                </span>
              ))}
              {(iocs.processes || []).map((p: string) => (
                <span key={p} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 font-mono text-[0.75rem] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />Proc: {p}
                </span>
              ))}
              {(iocs.files || []).map((f: string) => (
                <span key={f} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 font-mono text-[0.75rem] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />File: {f}
                </span>
              ))}
              {(iocs.hashes || []).map((h: string) => (
                <span key={h} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 border border-zinc-300 rounded-lg text-[var(--t5)] font-mono text-[0.75rem] font-bold" title={h}>
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />Hash: {h.length > 12 ? h.slice(0, 12) + '…' : h}
                </span>
              ))}
              {(iocs.ports || []).length > 0 && (
                <span className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-800 font-mono text-[0.75rem] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />Ports: {iocs.ports.join(', ')}
                </span>
              )}
              {!iocs.ips?.length && !alert.source_ip && !iocs.users?.length && !iocs.hosts?.length && !alert.agent_name &&
               !iocs.domains?.length && !iocs.processes?.length && !iocs.files?.length && !iocs.hashes?.length && !iocs.ports?.length && (
                <p className="text-[var(--t3)] text-xs italic">No IOCs extracted yet.</p>
              )}
            </div>
          </Section>

          <Section title="3 — MITRE ATT&CK Mapping">
            {mitreTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {mitreTags.map(tag => (
                  <span key={tag} className="px-3 py-1.5 bg-[#1a1a2e] text-[#e94560] border border-[#e94560]/30 rounded-lg text-[0.7rem] font-black font-mono tracking-wide">
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[var(--t3)] text-xs italic">No techniques mapped. Run Threat Intel agent.</p>
            )}
          </Section>

          <Section title="4 — Threat Intelligence">
            {(() => {
              const misp = aiData?.phaseData?.intel?.misp;
              if (!misp) return null;
              if (!misp.available) {
                return <div className="mb-3 text-[0.72rem] text-[var(--t4)] italic">MISP: unavailable (no API key configured or instance unreachable)</div>;
              }
              if (misp.hits === 0) {
                return <div className="mb-3 text-[0.72rem] text-[var(--t4)]">MISP: queried — no matches for these IOCs.</div>;
              }
              const lvlColor: Record<string, string> = {
                High: 'bg-red-100 text-red-800 border-red-200',
                Medium: 'bg-orange-100 text-orange-800 border-orange-200',
                Low: 'bg-amber-50 text-amber-700 border-amber-200',
                Undefined: 'bg-[var(--s1)] text-[var(--t5)] border-[var(--b2)]',
              };
              const tagColor = (t: string) => {
                if (t.startsWith('tlp:')) {
                  if (t.includes('red')) return 'bg-red-600 text-white';
                  if (t.includes('amber')) return 'bg-amber-500 text-white';
                  if (t.includes('green')) return 'bg-green-600 text-white';
                  if (t.includes('white')) return 'bg-[var(--s2)] text-[var(--t7)] border border-[var(--b1)]';
                }
                return 'bg-blue-50 text-blue-800 border border-blue-200';
              };
              return (
                <div className="mb-3 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 px-3 py-1 rounded-full bg-blue-600 text-white text-[0.7rem] font-black uppercase tracking-wider">
                      ✓ MISP — {misp.hits} match{misp.hits === 1 ? '' : 'es'}
                    </span>
                    <span className={`px-2.5 py-1 rounded-full border font-black uppercase text-[0.62rem] tracking-wide ${lvlColor[misp.highest_threat_level]}`}>
                      Threat Level: {misp.highest_threat_level}
                    </span>
                  </div>

                  {(misp.threat_actors?.length > 0 || misp.malware_families?.length > 0) && (
                    <div className="grid grid-cols-2 gap-3">
                      {misp.threat_actors?.length > 0 && (
                        <div>
                          <p className="text-[0.6rem] font-black text-[var(--t4)] uppercase tracking-wider mb-1.5">Threat Actors</p>
                          <div className="flex flex-wrap gap-1">
                            {misp.threat_actors.map((a: string) => (
                              <span key={a} className="px-2 py-0.5 rounded bg-red-100 text-red-800 text-[0.7rem] font-bold">{a}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {misp.malware_families?.length > 0 && (
                        <div>
                          <p className="text-[0.6rem] font-black text-[var(--t4)] uppercase tracking-wider mb-1.5">Malware / Tools</p>
                          <div className="flex flex-wrap gap-1">
                            {misp.malware_families.map((m: string) => (
                              <span key={m} className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-[0.7rem] font-bold">{m}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {misp.events?.length > 0 && (
                    <div>
                      <p className="text-[0.6rem] font-black text-[var(--t4)] uppercase tracking-wider mb-1.5">Related MISP Events</p>
                      <div className="space-y-1">
                        {misp.events.slice(0, 5).map((e: any) => (
                          <div key={e.id} className="flex items-center gap-2 text-[0.72rem] bg-[var(--s0)]/60 rounded px-2 py-1 border border-blue-100">
                            <span className="font-mono font-bold text-blue-700">#{e.id}</span>
                            <span className="flex-1 truncate text-[var(--t6)]">{e.info}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[0.6rem] font-bold border ${lvlColor[e.threat_level]}`}>{e.threat_level}</span>
                            {e.date && <span className="text-[0.62rem] text-[var(--t4)] font-mono">{e.date}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {misp.tags?.length > 0 && (
                    <div>
                      <p className="text-[0.6rem] font-black text-[var(--t4)] uppercase tracking-wider mb-1.5">Tags</p>
                      <div className="flex flex-wrap gap-1">
                        {misp.tags.map((t: string) => (
                          <span key={t} className={`px-1.5 py-0.5 rounded text-[0.62rem] font-bold font-mono ${tagColor(t)}`}>{t}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {misp.matched_iocs?.length > 0 && (
                    <div>
                      <p className="text-[0.6rem] font-black text-[var(--t4)] uppercase tracking-wider mb-1.5">Matched IOCs ({misp.matched_iocs.length})</p>
                      <div className="text-[0.68rem] font-mono text-[var(--t5)] bg-[var(--s0)]/50 rounded px-2 py-1 break-all">
                        {misp.matched_iocs.slice(0, 10).join(' · ')}{misp.matched_iocs.length > 10 ? ` +${misp.matched_iocs.length - 10} more` : ''}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="bg-slate-900 rounded-xl p-4 text-[var(--t3)] text-[0.8rem] leading-relaxed whitespace-pre-wrap font-mono">
              {aiData?.intel || <span className="italic text-[var(--t4)]">No intel data. Run the Threat Intel agent.</span>}
            </div>
          </Section>

          <Section title="5 — Remediation & Playbook">
            {alert.remediation_steps ? (
              <div className="space-y-2">
                {alert.remediation_steps.split('\n').filter(Boolean).map((step, i) => (
                  <div key={i} className="flex gap-3 items-start p-3 bg-green-50 border border-green-100 rounded-lg">
                    <span className="w-5 h-5 shrink-0 rounded-full bg-green-200 text-green-800 font-black text-[0.65rem] flex items-center justify-center mt-0.5">{i + 1}</span>
                    <p className="text-[0.82rem] text-[var(--t6)] leading-relaxed">{step.replace(/^\d+[\.\)]\s*/, '').replace(/^[-•]\s*/, '')}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[var(--t3)] text-xs italic">No playbook retrieved. Run the RAG Knowledge agent.</p>
            )}
          </Section>

          <Section title="6 — Campaign Correlation">
            {(() => {
              const corrObj = aiData?.phaseData?.correlation;
              if (!corrObj) return (
                <div className="rounded-xl p-4 border border-[var(--b2)] bg-[var(--s1)] text-[0.82rem] text-[var(--t4)] italic">
                  No correlation data. Run the Correlation agent.
                </div>
              );
              if (!corrObj.campaign_detected) return (
                <div className="rounded-xl p-4 border border-[var(--b2)] bg-[var(--s1)] text-[0.82rem] text-[var(--t4)] italic">
                  {corrObj.campaign_name || 'No campaign pattern detected — isolated incident.'}
                </div>
              );
              return (
                <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden text-[0.82rem]">
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-100 border-b border-amber-200">
                    <span className="font-black text-amber-800 uppercase tracking-wide text-[0.7rem]">⚠ Campaign Detected</span>
                    {corrObj.kill_chain_stage && corrObj.kill_chain_stage !== 'UNKNOWN' && (
                      <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-[0.62rem] font-black uppercase border border-purple-200">{corrObj.kill_chain_stage}</span>
                    )}
                    {corrObj.escalation_needed && (
                      <span className="ml-auto px-2 py-0.5 rounded bg-red-100 text-red-700 text-[0.62rem] font-black uppercase border border-red-200">Escalate</span>
                    )}
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    <p className="font-bold text-amber-900 text-[0.88rem]">{corrObj.campaign_name}</p>
                    {corrObj.campaign_description && (
                      <p className="text-amber-800 leading-relaxed">{corrObj.campaign_description}</p>
                    )}
                    {corrObj.related_alerts?.length > 0 && (
                      <div className="mt-2 pt-3 border-t border-amber-200 space-y-1.5">
                        <p className="text-[0.62rem] font-black text-amber-700 uppercase tracking-widest">{corrObj.related_alerts.length} Related Alert{corrObj.related_alerts.length !== 1 ? 's' : ''}</p>
                        {corrObj.related_alerts.map((ra: { id: string; description: string }) => (
                          <div key={ra.id} className="rounded-lg bg-[var(--s0)]/70 border border-amber-200 px-3 py-2 space-y-1">
                            <span className="font-mono text-[0.68rem] text-amber-700 font-black bg-amber-100 rounded px-1.5 py-0.5 select-all">#{ra.id.toUpperCase()}</span>
                            <p className="text-[0.78rem] text-amber-900 leading-snug">{ra.description}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </Section>

          <Section title="7 — Response Plan">
            {responseActions.length > 0 ? (
              <div className="space-y-2">
                {responseActions.map((action: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-3.5 border border-[var(--b2)] rounded-xl bg-[var(--s0)]">
                    <span className={`px-2 py-0.5 rounded text-[0.6rem] font-black uppercase tracking-wide shrink-0 mt-0.5 ${
                      action.type === 'BLOCK_IP' ? 'bg-red-100 text-red-700' :
                      action.type === 'ISOLATE_HOST' ? 'bg-orange-100 text-orange-700' :
                      action.type === 'DISABLE_USER' ? 'bg-purple-100 text-purple-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>{action.type?.replace('_', ' ')}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-bold text-[0.8rem] text-[var(--t7)] truncate">{action.target}</p>
                      <p className="text-[0.75rem] text-[var(--t4)] mt-0.5">{action.reason}</p>
                    </div>
                  </div>
                ))}
                {aiData?.response?.approval_required && (
                  <p className="text-[0.7rem] text-amber-700 font-bold bg-amber-50 px-3 py-2 rounded-lg border border-amber-200 flex items-center gap-1.5">
                    <span>⚠</span> Analyst approval required before executing response actions.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[var(--t3)] text-xs italic">No response plan generated. Run the Response agent.</p>
            )}
          </Section>

          <Section title="8 — SLA & Validation">
            <div className={`rounded-xl p-4 border text-[0.82rem] ${aiData?.validation ? 'bg-green-50 border-green-200 text-green-900' : 'bg-[var(--s1)] border-[var(--b2)] text-[var(--t4)] italic'}`}>
              {aiData?.validation || 'SLA validation pending. Run the Validation agent.'}
            </div>
          </Section>

          <Section title="9 — Raw Wazuh Log">
            <pre className="text-[0.7rem] bg-slate-950 text-emerald-400 p-5 rounded-xl overflow-x-auto font-mono leading-relaxed">
              {alert.full_log || 'No log data.'}
            </pre>
          </Section>
        </div>

        <div className="px-7 py-4 border-t bg-[var(--s1)] flex justify-end shrink-0">
          <button onClick={onClose} className="px-6 py-2.5 rounded-lg font-bold text-[var(--t5)] hover:bg-[var(--s1)] transition-colors border border-[var(--b2)] text-sm">
            Close Report
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const buildInitialHistory = (aiData: any): Record<string, any[]> => {
  const pd = aiData?.phaseData || {};
  const h: Record<string, any[]> = {};
  if (pd.analysis)    h.analysis    = [pd.analysis];
  if (pd.intel)       h.intel       = [pd.intel];
  if (pd.knowledge)   h.knowledge   = [pd.knowledge];
  if (pd.correlation) h.correlation = [pd.correlation];
  if (pd.recall)      h.recall      = [pd.recall];
  if (pd.ioc_check)   h.ioc_check   = [pd.ioc_check];
  if (pd.ticket)      h.ticketing   = [pd.ticket];
  if (pd.response)    h.response    = [pd.response];
  if (pd.validation)  h.validation  = [pd.validation];
  return h;
};

const getRawPhaseResult = (phase: string, result: any) => {
  switch (phase) {
    case 'analysis':    return result.analysis;
    case 'intel':       return result.intel;
    case 'knowledge':   return result.knowledge;
    case 'correlation': return result.correlation;
    case 'recall':      return result.recall;
    case 'ioc_check':   return result.ioc_check;
    case 'ticketing':   return result.ticket;
    case 'response':    return result.responsePlan;
    case 'validation':  return result.validation;
    default:            return null;
  }
};

// ==== SOC Console components (dense info-dense layout) =====================

const RiskGauge = ({ value, size = 96 }: { value: number | null, size?: number }) => {
  const v = typeof value === 'number' ? Math.max(0, Math.min(100, value)) : 0;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (v / 100) * c;
  const color = value == null ? '#cbd5e1' : v >= 80 ? '#ef4444' : v >= 60 ? '#f97316' : v >= 40 ? '#f59e0b' : '#10b981';
  const label = value == null ? '—' : v >= 80 ? 'CRITICAL' : v >= 60 ? 'HIGH' : v >= 40 ? 'MEDIUM' : 'LOW';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size/2} cy={size/2} r={r} stroke="#e2e8f0" strokeWidth={stroke} fill="none" />
          <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} className="transition-all duration-700" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[1.4rem] font-black" style={{ color }}>{value == null ? '—' : Math.round(v)}</span>
          <span className="text-[0.55rem] font-bold text-[var(--t3)] uppercase tracking-widest">/100</span>
        </div>
      </div>
      <span className="text-[0.6rem] font-black uppercase tracking-widest" style={{ color }}>{label}</span>
    </div>
  );
};

const MiniBar = ({ value, color }: { value: number, color: string }) => (
  <div className="h-1 w-full bg-[var(--s1)] rounded-full overflow-hidden">
    <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

const ConfidenceDonut = ({ value, size = 34 }: { value: number | null; size?: number }) => {
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = typeof value === 'number' ? Math.max(0, Math.min(100, Math.round(value * 100))) : null;
  const progress = pct == null ? 0 : pct;
  const dashOffset = circumference - (progress / 100) * circumference;
  const color =
    pct == null ? '#94a3b8' :
    pct >= 80 ? '#16a34a' :
    pct >= 60 ? '#f59e0b' :
    '#ef4444';

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#e2e8f0" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[0.54rem] font-black tabular-nums" style={{ color }}>
        {pct == null ? '—' : `${pct}`}
      </div>
    </div>
  );
};

const GlobalRiskDonut = ({ score, critical, high, resolvedHighCritical }: { score: number; critical: number; high: number; resolvedHighCritical: number }) => {
  const size = 164;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, Math.round(score)));
  const off = c - (v / 100) * c;
  const color = v >= 80 ? '#d93025' : v >= 60 ? '#f97316' : v >= 35 ? '#f29900' : '#1e8e3e';
  const label = v >= 80 ? 'Critical' : v >= 60 ? 'High' : v >= 35 ? 'Elevated' : 'Stable';

  return (
    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm p-5 h-full flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-[0.72rem] font-black text-[var(--p1)] uppercase tracking-wider">Global Risk Score</p>
          <p className="text-[0.68rem] text-[var(--t4)] mt-1">Driven by active severity and reduced as incidents move to contained, resolved, or closed.</p>
        </div>
        <span className="px-2 py-1 rounded-full text-[0.6rem] font-black uppercase tracking-wider border" style={{ color, borderColor: `${color}55`, backgroundColor: `${color}15` }}>
          {label}
        </span>
      </div>

      <div className="flex items-center justify-center flex-1">
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--s1)" strokeWidth={stroke} fill="none" />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={color}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={off}
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[2.2rem] font-black leading-none" style={{ color }}>{v}</span>
            <span className="text-[0.62rem] font-black text-[var(--t3)] uppercase tracking-widest mt-1">risk / 100</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 pt-4 border-t border-[var(--b1)]">
        <div className="text-center">
          <p className="text-[1.1rem] font-black text-red-500 leading-none">{critical}</p>
          <p className="text-[0.56rem] font-bold text-[var(--t3)] uppercase tracking-wider mt-1">Critical</p>
        </div>
        <div className="text-center">
          <p className="text-[1.1rem] font-black text-orange-500 leading-none">{high}</p>
          <p className="text-[0.56rem] font-bold text-[var(--t3)] uppercase tracking-wider mt-1">High</p>
        </div>
        <div className="text-center">
          <p className="text-[1.1rem] font-black text-green-600 leading-none">{resolvedHighCritical}</p>
          <p className="text-[0.56rem] font-bold text-[var(--t3)] uppercase tracking-wider mt-1">Solved</p>
        </div>
      </div>
    </div>
  );
};

type RiskSeriesPoint = {
  day: string;
  label: string;
  risk: number;
  activeHighCritical: number;
  solvedHighCritical: number;
  newAlerts: number;
};

type RiskChartGranularity = 'hours' | 'days' | 'months' | 'years';

const PipelineRiskTimeSeries = ({
  points,
  granularity,
  setGranularity,
}: {
  points: RiskSeriesPoint[];
  granularity: RiskChartGranularity;
  setGranularity: (value: RiskChartGranularity) => void;
}) => {
  const last = points[points.length - 1] || { risk: 0, activeHighCritical: 0, solvedHighCritical: 0, newAlerts: 0 };
  const series = [
    { key: 'risk' as const, label: 'Risk score', color: '#d93025', value: `${Math.round(last.risk)}/100` },
    { key: 'activeHighCritical' as const, label: 'Active high/critical', color: '#f97316', value: String(last.activeHighCritical) },
    { key: 'solvedHighCritical' as const, label: 'Solved high/critical', color: '#1e8e3e', value: String(last.solvedHighCritical) },
    { key: 'newAlerts' as const, label: 'New alerts', color: '#004a99', value: String(last.newAlerts) },
  ];

  return (
    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-sm p-5 h-full">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-[0.72rem] font-black text-[var(--p1)] uppercase tracking-wider">Risk & Pipeline Over Time</p>
          <p className="text-[0.68rem] text-[var(--t4)] mt-1">Risk is red; choose hourly, daily, monthly, or yearly buckets.</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as RiskChartGranularity)}
            className="rounded-lg border border-[var(--b2)] bg-[var(--s0)] px-2.5 py-1.5 text-[0.7rem] font-bold text-[var(--t6)] outline-none focus:border-[var(--p1)]"
            title="Chart time bucket"
          >
            <option value="hours">Hours</option>
            <option value="days">Days</option>
            <option value="months">Months</option>
            <option value="years">Years</option>
          </select>
          <div className="flex flex-wrap gap-2 justify-end">
            {series.map(s => (
              <div key={s.key} className="flex items-center gap-1.5 text-[0.62rem] font-bold text-[var(--t5)]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span>{s.label}</span>
                <span className="font-mono text-[var(--t3)]">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="w-full h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 18, bottom: 4, left: -8 }}>
            <CartesianGrid stroke="var(--b1)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--t3)', fontSize: 11, fontFamily: 'monospace' }}
              axisLine={{ stroke: 'var(--b1)' }}
              tickLine={{ stroke: 'var(--b1)' }}
              minTickGap={10}
            />
            <YAxis
              yAxisId="risk"
              domain={[0, 100]}
              tick={{ fill: 'var(--t3)', fontSize: 11, fontFamily: 'monospace' }}
              axisLine={{ stroke: 'var(--b1)' }}
              tickLine={{ stroke: 'var(--b1)' }}
              width={36}
            />
            <YAxis
              yAxisId="count"
              orientation="right"
              allowDecimals={false}
              tick={{ fill: 'var(--t3)', fontSize: 11, fontFamily: 'monospace' }}
              axisLine={{ stroke: 'var(--b1)' }}
              tickLine={{ stroke: 'var(--b1)' }}
              width={34}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--s0)',
                border: '1px solid var(--b1)',
                borderRadius: 8,
                color: 'var(--t7)',
                fontSize: 12,
              }}
              labelStyle={{ color: 'var(--t7)', fontWeight: 800 }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: 'var(--t5)', paddingTop: 8 }} />
            <Line yAxisId="risk" type="monotone" dataKey="risk" name="Risk score" stroke="#d93025" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line yAxisId="count" type="monotone" dataKey="activeHighCritical" name="Active high/critical" stroke="#f97316" strokeWidth={2.4} dot={false} />
            <Line yAxisId="count" type="monotone" dataKey="solvedHighCritical" name="Solved high/critical" stroke="#1e8e3e" strokeWidth={2.4} dot={false} />
            <Line yAxisId="count" type="monotone" dataKey="newAlerts" name="New alerts" stroke="#004a99" strokeWidth={2.4} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

type HeroProps = {
  alert: Alert;
  aiData: any;
  mitreTags: string[];
  severity: string;
  sevStyle: Record<string, string>;
  agentDefs: { id: string; label: string; icon: any }[];
  agentConfidence: (id: string) => number | null;
  scrollToAgents: () => void;
};

const AlertHeroStrip = ({ alert, aiData, severity, sevStyle, agentDefs, agentConfidence, scrollToAgents }: HeroProps) => {
  const pd = aiData?.phaseData || {};
  const analysis = pd.analysis;
  const intel = pd.intel;
  const risk = typeof analysis?.risk_score === 'number' ? analysis.risk_score : null;
  const attackCat = analysis?.attack_category;
  const killChain = analysis?.kill_chain_stage;
  const threatActors: string[] = intel?.misp?.threat_actors || [];
  const actorLabel = threatActors[0] || intel?.campaign_family || null;
  const threatLabel = [actorLabel, attackCat?.replace(/_/g,' ')].filter(Boolean).join(' · ') || alert.description;

  return (
    <div className="bg-[var(--s0)] rounded-xl border border-[var(--b1)] shadow-sm overflow-hidden">
      <div className="grid grid-cols-12 gap-0 divide-x divide-slate-100">
        {/* Identity */}
        <div className="col-span-12 md:col-span-6 p-4 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[0.68rem] font-bold text-[var(--t3)]">#{alert.id.substring(0,10).toUpperCase()}</span>
            <span className={`px-2 py-0.5 rounded-full border font-black uppercase text-[0.6rem] tracking-wider ${sevStyle[severity]}`}>{severity}</span>
            {analysis?.is_false_positive && <span className="px-2 py-0.5 rounded-full border bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)] font-black uppercase text-[0.6rem] tracking-wider">FP</span>}
            {killChain && <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-bold text-[0.6rem] uppercase tracking-wide">{killChain.replace(/_/g,' ')}</span>}
            {alert.email_sent === 1 && <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-bold text-[0.6rem] uppercase">✓ Emailed</span>}
          </div>
          <p className="text-[0.95rem] font-bold text-[var(--t7)] leading-snug">{threatLabel}</p>
          <p className="text-[0.78rem] text-[var(--t4)] leading-snug line-clamp-2">{alert.description}</p>
          <div className="flex items-center gap-4 pt-1 text-[0.68rem] text-[var(--t4)]">
            {alert.source_ip && <span>SRC <span className="font-mono font-bold text-[var(--t6)]">{alert.source_ip}</span></span>}
            <span>HOST <span className="font-mono font-bold text-[var(--t6)]">{alert.agent_name}</span></span>
            <span>RULE <span className="font-mono font-bold text-[var(--t6)]">{alert.rule_id}</span></span>
            <span className="font-mono">{new Date(alert.timestamp).toLocaleString()}</span>
          </div>
        </div>

        {/* Risk gauge */}
        <div className="col-span-6 md:col-span-3 p-4 flex items-center justify-center bg-[var(--s1)]/50">
          <RiskGauge value={risk} size={110} />
        </div>

        {/* Agent confidence */}
        <div className="col-span-6 md:col-span-3 p-4">
          <button type="button" onClick={scrollToAgents} className="w-full text-left group">
            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-2">Agents Confidence</p>
            <div className="space-y-1">
              {agentDefs.map((a) => {
                const c = agentConfidence(a.id);
                const pct = c == null ? null : Math.round(c * 100);
                const color = pct == null ? 'bg-[var(--s2)]' : pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400';
                return (
                  <div key={a.id} className="flex items-center gap-2 group-hover:opacity-90">
                    <a.icon size={10} className="text-[var(--t3)] shrink-0" />
                    <span className="text-[0.62rem] text-[var(--t5)] w-20 truncate">{a.label}</span>
                    <div className="flex-1"><MiniBar value={pct ?? 0} color={color} /></div>
                    <span className="text-[0.58rem] font-mono font-bold text-[var(--t4)] w-8 text-right">{pct == null ? '—' : `${pct}%`}</span>
                  </div>
                );
              })}
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

const EvidenceStrip = ({ aiData, mitreTags }: { aiData: any, mitreTags: string[] }) => {
  const pd = aiData?.phaseData || {};
  const misp = pd.intel?.misp;
  const iocs = aiData?.iocs || {};
  const iocCount = ['ips','users','hosts','domains','hashes','files','processes'].reduce((a, k) => a + (Array.isArray(iocs[k]) ? iocs[k].length : 0), 0);
  const iocTypes = ['ips','users','hosts','domains','hashes','files','processes'].filter(k => Array.isArray(iocs[k]) && iocs[k].length > 0).length;
  const actions = pd.response?.actions || aiData?.response?.actions || [];
  const approvalRequired = pd.response?.approval_required ?? aiData?.response?.approval_required;
  const sla = pd.validation?.sla_status || aiData?.validation;
  const slaTone = sla ? (String(sla).toLowerCase().includes('breach') ? 'text-red-700 bg-red-50 border-red-200' : String(sla).toLowerCase().includes('risk') ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-green-700 bg-green-50 border-green-200') : 'text-[var(--t4)] bg-[var(--s1)] border-[var(--b2)]';
  const confidences = ['analysis', 'intel', 'knowledge', 'correlation', 'recall', 'ioc_check', 'ticket', 'response', 'validation']
    .map(k => pd[k]?.confidence)
    .filter((v): v is number => typeof v === 'number');
  const avgConf = confidences.length ? Math.round(confidences.reduce((a,b) => a+b, 0) / confidences.length * 100) : null;
  const mispLevelCls: Record<string,string> = { High: 'text-red-700 bg-red-50 border-red-200', Medium: 'text-orange-700 bg-orange-50 border-orange-200', Low: 'text-amber-700 bg-amber-50 border-amber-200', Undefined: 'text-[var(--t5)] bg-[var(--s1)] border-[var(--b2)]' };

  const Chip = ({ title, value, sub, tone = 'text-[var(--t6)] bg-[var(--s0)] border-[var(--b2)]' }: { title: string, value: React.ReactNode, sub?: React.ReactNode, tone?: string }) => (
    <div className={`rounded-xl border px-3 py-2.5 ${tone} flex flex-col gap-0.5 min-w-0`}>
      <p className="text-[0.55rem] font-black uppercase tracking-widest opacity-70">{title}</p>
      <div className="text-[1rem] font-black leading-tight truncate">{value}</div>
      {sub && <div className="text-[0.62rem] opacity-80 truncate">{sub}</div>}
    </div>
  );

  const riskScore = pd.analysis?.risk_score;
  const riskTone  = riskScore == null ? 'text-[var(--t4)] bg-[var(--s1)] border-[var(--b2)]'
    : riskScore >= 80 ? 'text-red-700 bg-red-50 border-red-200'
    : riskScore >= 60 ? 'text-orange-700 bg-orange-50 border-orange-200'
    : riskScore >= 40 ? 'text-amber-700 bg-amber-50 border-amber-200'
    : 'text-green-700 bg-green-50 border-green-200';

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
      <Chip title="Risk Score"    value={riskScore != null ? `${riskScore}/100` : '—'} sub={pd.analysis?.severity_validation || 'not assessed'} tone={riskTone} />
      <Chip title="MITRE"        value={`${mitreTags.length} technique${mitreTags.length===1?'':'s'}`} sub={mitreTags.slice(0,3).join(' · ') || '—'} />
      <Chip title="MISP"         value={misp?.available ? `${misp.hits || 0} hits` : 'n/a'} sub={misp?.highest_threat_level || (misp?.available ? 'no matches' : 'unavailable')} tone={misp?.available && misp.hits > 0 ? mispLevelCls[misp.highest_threat_level] : 'text-[var(--t5)] bg-[var(--s1)] border-[var(--b2)]'} />
      <Chip title="IOCs"         value={iocCount} sub={`${iocTypes} type${iocTypes===1?'':'s'}`} />
      <Chip title="Actions"      value={actions.length} sub={approvalRequired ? 'approval required' : 'auto-executable'} tone={approvalRequired ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-[var(--t6)] bg-[var(--s0)] border-[var(--b2)]'} />
      <Chip title="Avg Confidence" value={avgConf == null ? '—' : `${avgConf}%`} sub={avgConf == null ? 'no runs' : `${confidences.length}/${AGENT_PHASES_UI.length} agents`} tone={avgConf == null ? 'text-[var(--t4)] bg-[var(--s1)] border-[var(--b2)]' : avgConf >= 80 ? 'text-green-700 bg-green-50 border-green-200' : avgConf >= 60 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-red-700 bg-red-50 border-red-200'} />
    </div>
  );
};

const IocTable = ({ iocs }: { iocs: any }) => {
  const groups = [
    { key: 'ips', label: 'IP', tone: 'text-red-700 bg-red-50' },
    { key: 'users', label: 'User', tone: 'text-orange-700 bg-orange-50' },
    { key: 'hosts', label: 'Host', tone: 'text-purple-700 bg-purple-50' },
    { key: 'domains', label: 'Domain', tone: 'text-sky-700 bg-sky-50' },
    { key: 'processes', label: 'Proc', tone: 'text-emerald-700 bg-emerald-50' },
    { key: 'files', label: 'File', tone: 'text-yellow-700 bg-yellow-50' },
    { key: 'hashes', label: 'Hash', tone: 'text-[var(--t5)] bg-zinc-50' },
  ];
  const rows: { type: string; value: string; tone: string }[] = [];
  for (const g of groups) {
    const arr = Array.isArray(iocs?.[g.key]) ? iocs[g.key] : [];
    for (const v of arr) rows.push({ type: g.label, value: String(v), tone: g.tone });
  }
  if (iocs?.ports?.length) rows.push({ type: 'Ports', value: iocs.ports.join(', '), tone: 'text-indigo-700 bg-indigo-50' });
  if (rows.length === 0) return <p className="text-[0.72rem] text-[var(--t3)] italic">No IOCs extracted yet.</p>;
  return (
    <div className="overflow-hidden rounded border border-[var(--b2)]">
      <table className="w-full text-[0.72rem]">
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-[var(--s1)]">
              <td className={`px-2 py-1 font-black uppercase tracking-wide text-[0.58rem] ${r.tone} w-16`}>{r.type}</td>
              <td className="px-2 py-1 font-mono text-[var(--t6)] break-all">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const InvestigationGrid = ({
  alert, aiData, mitreTags,
  allAlerts = [],
  onAlertSelect,
}: {
  alert: Alert; aiData: any; mitreTags: string[];
  allAlerts?: Alert[];
  onAlertSelect?: (a: Alert) => void;
}) => {
  const pd = aiData?.phaseData || {};
  const misp = pd.intel?.misp;
  const actions = pd.response?.actions || aiData?.response?.actions || [];
  const approvalRequired = pd.response?.approval_required ?? aiData?.response?.approval_required;
  const playbookSteps = (alert.remediation_steps || '').split('\n').map(s => s.trim()).filter(Boolean);
  const correlation = aiData?.correlation;
  const correlationObj = pd.correlation;
  const validation = aiData?.validation;

  const sameActionMap = React.useMemo(() => {
    const map: Record<string, Array<{ id: string; sv: string; alertObj: Alert }>> = {};
    for (const a of allAlerts) {
      if (a.id === alert.id) continue;
      if (['FALSE_POSITIVE','FP_CONFIRMED'].includes(a.status)) continue;
      let ai2: any = null;
      try { ai2 = a.ai_analysis ? JSON.parse(a.ai_analysis) : null; } catch {}
      const pd2 = ai2?.phaseData || {};
      const acts = pd2.response?.actions || ai2?.response?.actions || [];
      const sv: string = pd2.analysis?.severity_validation ?? ai2?.analysis?.severity_validation ?? 'MEDIUM';
      for (const ac of acts) {
        if (!ac.type) continue;
        if (!map[ac.type]) map[ac.type] = [];
        if (!map[ac.type].some(x => x.id === a.id)) {
          map[ac.type].push({ id: a.id, sv, alertObj: a });
        }
      }
    }
    return map;
  }, [allAlerts, alert.id]);

  const lvlColor: Record<string, string> = {
    High: 'bg-red-100 text-red-800 border-red-200',
    Medium: 'bg-orange-100 text-orange-800 border-orange-200',
    Low: 'bg-amber-50 text-amber-700 border-amber-200',
    Undefined: 'bg-[var(--s1)] text-[var(--t5)] border-[var(--b2)]',
  };
  const tagColor = (t: string) => {
    if (t.startsWith('tlp:')) {
      if (t.includes('red')) return 'bg-red-600 text-white';
      if (t.includes('amber')) return 'bg-amber-500 text-white';
      if (t.includes('green')) return 'bg-green-600 text-white';
      if (t.includes('white')) return 'bg-[var(--s2)] text-[var(--t7)] border border-[var(--b1)]';
    }
    return 'bg-blue-50 text-blue-800 border border-blue-200';
  };
  const actionTone: Record<string,string> = {
    BLOCK_IP: 'bg-red-100 text-red-700',
    ISOLATE_HOST: 'bg-orange-100 text-orange-700',
    DISABLE_USER: 'bg-purple-100 text-purple-700',
    KILL_PROCESS: 'bg-red-100 text-red-700',
    RESET_CREDENTIALS: 'bg-indigo-100 text-indigo-700',
  };

  const Panel = ({ title, accent, children, right }: { title: string, accent: string, children: React.ReactNode, right?: React.ReactNode }) => (
    <div className="bg-[var(--s0)] rounded-xl border border-[var(--b1)] shadow-sm overflow-hidden flex flex-col min-h-[220px]">
      <div className={`flex items-center justify-between px-4 py-2 border-b border-[var(--b3)] ${accent}`}>
        <p className="text-[0.62rem] font-black uppercase tracking-widest">{title}</p>
        {right}
      </div>
      <div className="p-4 flex-1 overflow-y-auto space-y-3 text-[0.78rem] text-[var(--t6)]">{children}</div>
    </div>
  );

  return (
    <div className="space-y-3">
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
      {/* Column 1 — Threat Context */}
      <Panel title="Threat Context" accent="bg-[var(--s1)] text-[var(--p1)]">
        {aiData?.summary ? (
          <div className="bg-[var(--sa)] border border-[#c8ddf7] rounded-lg px-3 py-2 text-[0.78rem] text-[var(--p1)] italic leading-snug">
            {aiData.summary}
          </div>
        ) : (
          <p className="text-[var(--t3)] italic text-[0.72rem]">No AI summary yet. Run the Alert Triage agent.</p>
        )}

        <div>
          <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">MITRE ATT&CK</p>
          {mitreTags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {mitreTags.map(t => (
                <span key={t} className="px-2 py-0.5 bg-[#1a1a2e] text-[#e94560] border border-[#e94560]/30 rounded text-[0.62rem] font-black font-mono">{t}</span>
              ))}
            </div>
          ) : <p className="text-[var(--t3)] italic text-[0.68rem]">None mapped. Run Threat Intel agent.</p>}
        </div>

        <div>
          <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">IOCs</p>
          <IocTable iocs={aiData?.iocs || {}} />
        </div>

        {correlationObj && !correlationObj.campaign_detected && (
          <div>
            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">Campaign Correlation</p>
            <div className="rounded-lg border border-[var(--b2)] bg-[var(--s1)] px-3 py-2 text-[0.72rem] text-[var(--t4)] italic">
              {correlationObj.campaign_name || 'No campaign pattern detected — isolated incident.'}
            </div>
          </div>
        )}
      </Panel>

      {/* Column 2 — MISP Enrichment */}
      <Panel
        title="Threat Intelligence"
        accent="bg-gradient-to-r from-blue-50 to-indigo-50 text-[var(--p1)]"
        right={misp?.available && misp.hits > 0 ? (
          <span className={`px-2 py-0.5 rounded-full border font-black uppercase text-[0.55rem] tracking-wider ${lvlColor[misp.highest_threat_level]}`}>{misp.highest_threat_level}</span>
        ) : misp?.available ? (
          <span className="text-[0.58rem] font-semibold text-[var(--t3)]">queried · 0 hits</span>
        ) : (
          <span className="text-[0.58rem] font-semibold text-[var(--t3)]">unavailable</span>
        )}
      >
        {misp?.available && misp.hits > 0 ? (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full bg-blue-600 text-white text-[0.6rem] font-black uppercase tracking-wider">✓ {misp.hits} MISP match{misp.hits === 1 ? '' : 'es'}</span>
              {misp.matched_iocs?.length > 0 && <span className="text-[0.62rem] text-[var(--t4)] font-mono">{misp.matched_iocs.length} IOC{misp.matched_iocs.length===1?'':'s'}</span>}
            </div>

            {misp.threat_actors?.length > 0 && (
              <div>
                <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Threat Actors</p>
                <div className="flex flex-wrap gap-1">
                  {misp.threat_actors.map((a: string) => (
                    <span key={a} className="px-2 py-0.5 rounded bg-red-100 text-red-800 text-[0.68rem] font-bold">{a}</span>
                  ))}
                </div>
              </div>
            )}

            {misp.malware_families?.length > 0 && (
              <div>
                <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Malware / Tools</p>
                <div className="flex flex-wrap gap-1">
                  {misp.malware_families.map((m: string) => (
                    <span key={m} className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-[0.68rem] font-bold">{m}</span>
                  ))}
                </div>
              </div>
            )}

            {misp.events?.length > 0 && (
              <div>
                <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Related Events</p>
                <div className="space-y-1">
                  {misp.events.slice(0, 5).map((e: any) => (
                    <div key={e.id} className="flex items-center gap-2 text-[0.7rem] bg-[var(--s1)] rounded px-2 py-1 border border-[var(--b3)]">
                      <span className="font-mono font-bold text-blue-700">#{e.id}</span>
                      <span className="flex-1 truncate text-[var(--t6)]">{e.info}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[0.56rem] font-bold border ${lvlColor[e.threat_level]}`}>{e.threat_level}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {misp.tags?.length > 0 && (
              <div>
                <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {misp.tags.map((t: string) => (
                    <span key={t} className={`px-1.5 py-0.5 rounded text-[0.58rem] font-bold font-mono ${tagColor(t)}`}>{t}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-[var(--t3)] italic text-[0.72rem]">No MISP matches for these IOCs.</p>
        )}

        {aiData?.intel && (
          <div>
            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">Analyst Summary</p>
            <div className="bg-slate-900 text-emerald-300 rounded-lg p-3 text-[0.72rem] leading-relaxed whitespace-pre-wrap font-mono">
              {aiData.intel}
            </div>
          </div>
        )}
      </Panel>

      {/* Column 3 — Response Pipeline */}
      <Panel title="Response Pipeline" accent="bg-[var(--s1)] text-[var(--p1)]">
        <div>
          <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">Playbook</p>
          {playbookSteps.length > 0 ? (
            <ol className="space-y-1">
              {playbookSteps.map((s, i) => (
                <li key={i} className="flex gap-2 items-start text-[0.74rem] leading-snug">
                  <span className="w-4 h-4 rounded-full bg-green-200 text-green-800 font-black text-[0.58rem] flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
                  <span className="text-[var(--t6)]">{s.replace(/^\d+[\.\)]\s*/, '').replace(/^[-•]\s*/, '')}</span>
                </li>
              ))}
            </ol>
          ) : <p className="text-[var(--t3)] italic text-[0.68rem]">No playbook retrieved. Run RAG Knowledge agent.</p>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest">Response Actions</p>
            {approvalRequired && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[0.56rem] font-black uppercase tracking-wider">⚠ Approval</span>}
          </div>
          {actions.length > 0 ? (
            <div className="space-y-1">
              {actions.map((a: any, i: number) => (
                <div key={i} className="bg-[var(--s1)] rounded border border-[var(--b3)] px-2 py-1.5 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[0.58rem] font-black uppercase tracking-wider ${actionTone[a.type] || 'bg-blue-100 text-blue-700'}`}>{(a.type || '').replace(/_/g,' ')}</span>
                    <span className="flex-1 text-[0.7rem] font-mono font-bold text-[var(--t6)] truncate">{a.target || '—'}</span>
                  </div>
                  {(sameActionMap[a.type]?.length ?? 0) > 0 && onAlertSelect && (
                    <div className="flex flex-wrap gap-1 items-center">
                      <span className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Also in:</span>
                      {sameActionMap[a.type].slice(0, 8).map(x => (
                        <button
                          key={x.id}
                          onClick={() => onAlertSelect(x.alertObj)}
                          className={`font-mono text-[0.58rem] font-bold px-1.5 py-0.5 rounded transition-colors ${severityChipColor(x.sv)}`}
                          title={x.alertObj.description}
                        >
                          #{x.id.substring(0, 8).toUpperCase()}
                        </button>
                      ))}
                      {sameActionMap[a.type].length > 8 && (
                        <span className="text-[0.55rem] text-[var(--t3)]">+{sameActionMap[a.type].length - 8} more</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {actions[0]?.reason && <p className="text-[0.65rem] text-[var(--t4)] italic leading-snug">{actions[0].reason}</p>}
            </div>
          ) : <p className="text-[var(--t3)] italic text-[0.68rem]">No response plan. Run Response agent.</p>}
        </div>

        <div>
          <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">Validation / SLA</p>
          {(() => {
            const v = pd.validation;
            if (!v) return (
              <div className="rounded-lg border px-3 py-2 text-[0.72rem] bg-[var(--s1)] border-[var(--b2)] text-[var(--t4)] italic">
                SLA validation pending. Run Validation agent.
              </div>
            );
            const slaColor =
              v.sla_status === 'SLA_MET'      ? 'bg-green-50 border-green-300 text-green-900' :
              v.sla_status === 'SLA_AT_RISK'  ? 'bg-amber-50 border-amber-300 text-amber-900' :
              'bg-red-50 border-red-300 text-red-900';
            const recColor: Record<string,string> = {
              CLOSE:               'bg-green-100 text-green-800',
              MONITOR:             'bg-blue-100 text-blue-800',
              ESCALATE:            'bg-red-100 text-red-800',
              INVESTIGATE_FURTHER: 'bg-amber-100 text-amber-800',
            };
            return (
              <div className={`rounded-lg border px-3 py-2.5 space-y-1.5 ${slaColor}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[0.72rem] font-black uppercase tracking-wide">{v.sla_status?.replace(/_/g,' ')}</span>
                  {v.recommendation && (
                    <span className={`px-2 py-0.5 rounded text-[0.58rem] font-black uppercase tracking-wide ${recColor[v.recommendation] || 'bg-[var(--s1)] text-[var(--t6)]'}`}>
                      {v.recommendation.replace(/_/g,' ')}
                    </span>
                  )}
                </div>
                {typeof v.completeness_score === 'number' && (
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[0.6rem] font-semibold opacity-70">
                      <span>Completeness</span><span>{v.completeness_score}%</span>
                    </div>
                    <div className="h-1 w-full bg-black/10 rounded-full overflow-hidden">
                      <div className="h-full bg-current rounded-full opacity-50 transition-all duration-700" style={{ width: `${v.completeness_score}%` }} />
                    </div>
                  </div>
                )}
                {v.missing_elements?.length > 0 && (
                  <p className="text-[0.62rem] opacity-75 italic">{v.missing_elements.slice(0,2).join(' · ')}</p>
                )}
              </div>
            );
          })()}
        </div>
      </Panel>
    </div>

    {/* Full-width campaign correlation card — shown below the grid when a campaign is detected */}
    {correlationObj?.campaign_detected && (
      <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-100 border-b border-amber-200">
          <span className="text-[0.65rem] font-black uppercase tracking-widest text-amber-800">⚠ Campaign Detected</span>
          {correlationObj.kill_chain_stage && correlationObj.kill_chain_stage !== 'UNKNOWN' && (
            <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-[0.6rem] font-black uppercase border border-purple-200">{correlationObj.kill_chain_stage}</span>
          )}
          {correlationObj.escalation_needed && (
            <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-[0.6rem] font-black uppercase border border-red-200">Escalate</span>
          )}
          {typeof correlationObj.confidence === 'number' && (
            <span className="ml-auto font-mono text-[0.6rem] text-amber-700">{Math.round(correlationObj.confidence * 100)}% confidence</span>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 divide-y xl:divide-y-0 xl:divide-x divide-amber-200">
          {/* Campaign metadata */}
          <div className="px-4 py-3 space-y-1">
            <p className="font-black text-amber-900 text-[0.88rem]">{correlationObj.campaign_name}</p>
            {correlationObj.campaign_description && (
              <p className="text-[0.78rem] text-amber-800 leading-relaxed">{correlationObj.campaign_description}</p>
            )}
          </div>

          {/* Related alerts list */}
          <div className="px-4 py-3">
            {correlationObj.related_alerts?.length > 0 ? (
              <>
                <p className="text-[0.6rem] font-black text-amber-700 uppercase tracking-widest mb-2">
                  {correlationObj.related_alerts.length} Related Alert{correlationObj.related_alerts.length !== 1 ? 's' : ''}
                </p>
                <div className="space-y-1.5">
                  {correlationObj.related_alerts.map((ra: { id: string; description: string }) => (
                    <div key={ra.id} className="flex items-start gap-2.5 bg-[var(--s0)]/70 rounded-lg border border-amber-200 px-3 py-2">
                      <span className="font-mono text-[0.62rem] text-amber-700 font-black bg-amber-100 rounded px-1.5 py-0.5 select-all shrink-0 mt-0.5 whitespace-nowrap">#{ra.id.toUpperCase()}</span>
                      <p className="text-[0.74rem] text-amber-900 leading-snug">{ra.description}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[0.72rem] text-amber-700 italic">No related alerts identified in the 72-hour window.</p>
            )}
          </div>
        </div>
      </div>
    )}
    </div>
  );
};

const AlertDetail = ({
  alert: alertProp, onClose, onAction, returnTab, setActiveTab,
  allAlerts = [],
  onAlertSelect,
}: {
  alert: Alert;
  onClose: () => void;
  onAction: (id: string, update: any) => void;
  returnTab?: string;
  setActiveTab?: (t: string) => void;
  allAlerts?: Alert[];
  onAlertSelect?: (a: Alert) => void;
}) => {
  const showToast = useToast();
  // Manual "Refresh" re-pulls the persisted alert row (status, ai_analysis,
  // last_error) into this local override, without a page reload. Cleared when
  // the selected alert changes so socket-driven prop updates win.
  const [liveAlert, setLiveAlert] = useState<Alert | null>(null);
  useEffect(() => { setLiveAlert(null); }, [alertProp.id]);
  const alert = liveAlert ?? alertProp;
  const [refreshing, setRefreshing] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [runningPhase, setRunningPhase] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [isRerunning, setIsRerunning] = useState(false);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ status: string; label: string; message: string; cls?: string } | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({ rawlog: true });

  const agentsRef = useRef<HTMLDivElement>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState<Record<string, boolean>>({});
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<Record<string, 'up' | 'down'>>({});

  // ── Run timer ──────────────────────────────────────────────────────────────
  const runStartRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    if (!isRerunning) return;
    runStartRef.current = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => {
      setElapsedMs(Date.now() - runStartRef.current!);
    }, 100);
    return () => clearInterval(id);
  }, [isRerunning]);

  const formatElapsed = (ms: number) => {
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const { user, token } = useAuth();

  const toggleSection = (key: string) =>
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));

  const handleFeedback = async (phase: string, isAccurate: boolean) => {
    if (feedbackSubmitted[phase]) return;
    const key = `${phase}-${isAccurate}`;
    setFeedbackLoading(prev => ({ ...prev, [key]: true }));
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          alert_id:    alert.id,
          phase,
          is_accurate: isAccurate,
          comment:     isAccurate ? 'Confirmed by analyst' : 'Flagged as inaccurate by analyst',
        }),
      });
      setFeedbackSubmitted(prev => ({ ...prev, [phase]: isAccurate ? 'up' : 'down' }));
      showToast(isAccurate ? 'Feedback saved — marked as accurate' : 'Feedback saved — marked as inaccurate', isAccurate ? 'success' : 'info');
    } catch (err) {
      console.error('Feedback failed:', err);
      showToast('Failed to save feedback', 'error');
    } finally {
      setFeedbackLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  // Per-agent run history: phase → array of raw phase results (newest = last)
  const [agentRunHistory, setAgentRunHistory] = useState<Record<string, any[]>>(() => {
    let d: any = null;
    try { d = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch (e) {}
    return buildInitialHistory(d);
  });
  const [agentRunIndex, setAgentRunIndex] = useState<Record<string, number>>({});

  useEffect(() => {
    setRunsLoading(true);
    getAlertRuns(alert.id).then(setRuns).catch(() => {}).finally(() => setRunsLoading(false));
  }, [alert.id]);

  // Rebuild per-agent history whenever ai_analysis changes (new alert OR fresh orchestration result)
  useEffect(() => {
    // Skip during an active rerun — handleRerunFresh will rebuild from the direct response
    if (isRerunning) return;
    let d: any = null;
    try { d = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch (e) {}
    setAgentRunHistory(buildInitialHistory(d));
    setAgentRunIndex({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert.ai_analysis]);

  let aiData: any = null;
  let mitreTags: string[] = [];
  try { aiData = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch (e) {}
  try { mitreTags = alert.mitre_attack ? JSON.parse(alert.mitre_attack as any) : []; } catch (e) {}

  const isAnalyzing = runningPhase !== null || isRerunning;

  const severity = alert.severity >= 13 ? 'CRITICAL' : alert.severity >= 10 ? 'HIGH' : alert.severity >= 7 ? 'MEDIUM' : 'LOW';
  const sevStyle: Record<string, string> = {
    CRITICAL: 'bg-red-50 text-red-700 border-red-200',
    HIGH: 'bg-orange-50 text-orange-700 border-orange-200',
    MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
    LOW: 'bg-green-50 text-green-700 border-green-200',
  };

  const agentDefs = [
    { id: 'analysis',    label: 'Alert Triage',    icon: Search,      desc: 'Extracts IOCs and validates severity',  getContent: (d: any) => d?.analysis_summary },
    { id: 'intel',       label: 'Threat Intel',     icon: Shield,      desc: 'MITRE ATT&CK mapping & reputation',     getContent: (d: any) => d?.intel_summary },
    { id: 'knowledge',   label: 'RAG Playbook',     icon: Clock,       desc: 'Retrieves remediation playbooks',       getContent: (d: any) => d?.remediation_steps },
    { id: 'correlation', label: 'Correlation',      icon: Activity,    desc: 'Detects multi-stage campaigns',         getContent: (d: any) => d?.campaign_name },
    { id: 'recall',      label: 'Memory Recall',    icon: BookOpen,    desc: 'Finds similar past incidents',          getContent: (d: any) => d?.hits?.length ? `${d.hits.length} past incident(s)` : 'No similar hits' },
    { id: 'ioc_check',   label: 'IOC History',      icon: Database,    desc: 'Known IOC observation history',         getContent: (d: any) => d?.hits?.length ? `${d.hits.length} known IOC(s)` : 'No prior observations' },
    { id: 'ticketing',   label: 'Incident Report',  icon: FileText,    desc: 'Generates structured ticket & email',  getContent: (d: any) => d?.title },
    { id: 'response',    label: 'Response Plan',    icon: Terminal,    desc: 'Recommends containment actions',        getContent: (d: any) => d?.actions?.map((a: any) => `${a.type} → ${a.target}`).join('\n') },
    { id: 'validation',  label: 'SLA Validation',   icon: CheckCircle, desc: 'Verifies completeness & SLA',          getContent: (d: any) => d?.sla_status },
  ];

  // Returns the result currently on display for a given phase (may be historical)
  const getAgentDisplay = (phase: string) => {
    const hist = agentRunHistory[phase];
    if (!hist || hist.length === 0) return null;
    const idx = agentRunIndex[phase] ?? hist.length - 1;
    return hist[Math.min(idx, hist.length - 1)];
  };

  const navigateAgentRun = (phase: string, dir: -1 | 1) => {
    const hist = agentRunHistory[phase];
    if (!hist) return;
    const current = agentRunIndex[phase] ?? hist.length - 1;
    setAgentRunIndex(prev => ({ ...prev, [phase]: Math.max(0, Math.min(hist.length - 1, current + dir)) }));
  };

  const getAgentConfidence = (agentId: string): number | null => {
    const raw = getAgentDisplay(agentId)?.confidence;
    if (typeof raw !== 'number' || Number.isNaN(raw)) return null;
    return Math.max(0, Math.min(1, raw));
  };

  const getConfidenceStatus = (confidence: number | null) => {
    if (confidence === null) return { label: 'Unknown', cls: 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)]' };
    if (confidence >= 0.8) return { label: 'High', cls: 'bg-green-50 text-green-700 border-green-200' };
    if (confidence >= 0.6) return { label: 'Medium', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    return { label: 'Low', cls: 'bg-red-50 text-red-700 border-red-200' };
  };

  const applyAgentResult = (phase: string, result: any, base: any) => {
    const updatedAiData = {
      ...base,
      phaseData: { ...(base?.phaseData || {}) },
      agentLogs: [...(base?.agentLogs || [])],
    };
    const extra: any = {};

    if (result.agentLogs && Array.isArray(result.agentLogs)) {
      // Append logs from this phase run
      updatedAiData.agentLogs = [...updatedAiData.agentLogs, ...result.agentLogs];
    }

    if (phase === 'analysis' && result.analysis) {
      updatedAiData.phaseData.analysis = result.analysis;
      updatedAiData.summary = result.analysis.analysis_summary;
      updatedAiData.iocs = result.analysis.iocs;
      if (result.analysis.is_false_positive) extra.status = 'FALSE_POSITIVE';
    }
    if (phase === 'intel' && result.intel) {
      updatedAiData.phaseData.intel = result.intel;
      updatedAiData.intel = result.intel.intel_summary;
      extra.mitre_attack = JSON.stringify(result.intel.mitre_attack);
    }
    if (phase === 'knowledge' && result.knowledge) {
      updatedAiData.phaseData.knowledge = result.knowledge;
      extra.remediation_steps = result.knowledge.remediation_steps;
    }
    if (phase === 'correlation' && result.correlation) {
      updatedAiData.phaseData.correlation = result.correlation;
      updatedAiData.correlation = result.correlation.campaign_name;
    }
    if (phase === 'ticketing' && result.ticket) {
      updatedAiData.phaseData.ticket = result.ticket;
      updatedAiData.ticket = result.ticket;
      extra.email_sent = result.ticket.email_notification_sent ? 1 : 0;
    }
    if (phase === 'response' && result.responsePlan) {
      updatedAiData.phaseData.response = result.responsePlan;
      updatedAiData.response = result.responsePlan;
    }
    if (phase === 'validation' && result.validation) {
      updatedAiData.phaseData.validation = result.validation;
      updatedAiData.validation = result.validation.sla_status;
    }
    if (phase === 'recall' && result.recall) {
      updatedAiData.phaseData.recall = result.recall;
    }
    if (phase === 'ioc_check' && result.ioc_check) {
      updatedAiData.phaseData.ioc_check = result.ioc_check;
    }
    return { updatedAiData, extra };
  };

  const buildAgentState = (currentAiData: any, remediationSteps?: string | null) => {
    const phaseData = currentAiData?.phaseData || {};
    const fallbackAnalysis =
      currentAiData?.summary || currentAiData?.iocs
        ? {
            analysis_summary: currentAiData?.summary || '',
            iocs: currentAiData?.iocs || { ips: [], users: [], hosts: [], hashes: [], files: [], ports: [], domains: [], processes: [] },
          }
        : null;

    return {
      alert,
      recentAlerts: [],
      analysis: phaseData.analysis || fallbackAnalysis,
      intel: phaseData.intel || null,
      knowledge: phaseData.knowledge || (remediationSteps ? { remediation_steps: remediationSteps } : null),
      correlation: phaseData.correlation || null,
      ticket: phaseData.ticket || currentAiData?.ticket || null,
      responsePlan: phaseData.response || currentAiData?.response || null,
      validation: phaseData.validation || null,
    };
  };

  const getNextAlertStatus = (currentStatus: Alert['status'], override?: Alert['status']) => {
    if (override) return override;
    if (currentStatus === 'CLOSED' || currentStatus === 'ESCALATED' || currentStatus === 'FALSE_POSITIVE' || currentStatus === 'INCIDENT') {
      return currentStatus;
    }
    return 'TRIAGED';
  };

  const handleAgentRun = async (phase: string) => {
    if (isAnalyzing) return;
    setRunningPhase(phase);
    setRunError(null);
    const baseAiData = aiData || {};
    try {
      const state = buildAgentState(baseAiData, alert.remediation_steps);
      const result = await runAgentPhase(phase, state) as any;

      // Push raw phase result to per-agent history, point index to new last entry
      const rawResult = getRawPhaseResult(phase, result);
      if (rawResult) {
        const prevLen = agentRunHistory[phase]?.length || 0;
        setAgentRunHistory(prev => ({ ...prev, [phase]: [...(prev[phase] || []), rawResult] }));
        setAgentRunIndex(prev => ({ ...prev, [phase]: prevLen })); // new last index
      }

      const { updatedAiData, extra } = applyAgentResult(phase, result, baseAiData);
      onAction(alert.id, {
        ...extra,
        ai_analysis: JSON.stringify(updatedAiData),
        status: getNextAlertStatus(alert.status, extra.status),
      });
    } catch (err: any) {
      console.error('[Agent run failed]', err);
      const msg = err?.message || `Failed to run the ${phase} agent.`;
      setRunError(msg);
      showToast(`${phase} agent failed: ${msg}`, 'error');
    } finally {
      setRunningPhase(null);
    }
  };

  const handleRunAll = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isAnalyzing) return;
    setIsRerunning(true);
    setRunError(null);
    let currentAiData = aiData || {};
    let cumulativeExtra: any = {};
    let completedAny = false;
    // Track new results and their old history lengths for batched index update
    const newResults: Record<string, any> = {};
    const prevLengths: Record<string, number> = {};

    for (const agent of agentDefs) {
      if ((agentRunHistory[agent.id]?.length || 0) > 0) continue; // skip already-run
      setRunningPhase(agent.id);
      try {
        const state = buildAgentState(currentAiData, cumulativeExtra.remediation_steps || alert.remediation_steps);
        const result = await runAgentPhase(agent.id, state) as any;
        const rawResult = getRawPhaseResult(agent.id, result);
        if (rawResult) {
          prevLengths[agent.id] = agentRunHistory[agent.id]?.length || 0;
          newResults[agent.id] = rawResult;
        }
        const { updatedAiData, extra } = applyAgentResult(agent.id, result, currentAiData);
        currentAiData = updatedAiData;
        cumulativeExtra = { ...cumulativeExtra, ...extra };
        completedAny = true;
      } catch (err: any) {
        console.error(`[Agent ${agent.id} failed]`, err);
        const msg = err?.message || `Failed to run the ${agent.label} agent.`;
        setRunError(msg);
        showToast(`${agent.label} agent failed: ${msg}`, 'error');
        break;
      }
    }
    setRunningPhase(null);
    setIsRerunning(false);

    // Batch-update history for all agents that ran
    if (Object.keys(newResults).length > 0) {
      setAgentRunHistory(prev => {
        const updated = { ...prev };
        for (const [phase, raw] of Object.entries(newResults)) {
          updated[phase] = [...(prev[phase] || []), raw];
        }
        return updated;
      });
      setAgentRunIndex(prev => {
        const updated = { ...prev };
        for (const [phase, oldLen] of Object.entries(prevLengths)) {
          updated[phase] = oldLen; // new entry is at index oldLen
        }
        return updated;
      });
    }

    if (!completedAny && !Object.keys(cumulativeExtra).length) return;
    onAction(alert.id, {
      ...cumulativeExtra,
      ai_analysis: JSON.stringify(currentAiData),
      status: getNextAlertStatus(alert.status, cumulativeExtra.status),
    });
  };

  const handleRerunFresh = async () => {
    if (isAnalyzing || isRerunning) return;
    setIsRerunning(true);
    setRunError(null);
    setLiveAlert(null);
    try {
      const result = await orchestrateAnalysis(alert, [], (update) => onAction(alert.id, update));
      // Rebuild per-phase history from the orchestration result so cards light up immediately
      if (result?.ai_analysis) {
        try {
          const newAiData = JSON.parse(result.ai_analysis);
          setAgentRunHistory(buildInitialHistory(newAiData));
          setAgentRunIndex({});
        } catch (_) {}
      }
      const updated = await getAlertRuns(alert.id);
      setRuns(updated);
      showToast('Agents finished — analysis updated', 'success');
    } catch (err: any) {
      const msg = err?.message || 'Rerun failed.';
      setRunError(msg);
      showToast(`Agent run failed: ${msg}`, 'error');
    } finally {
      setIsRerunning(false);
    }
  };

  // Re-pull the persisted alert (status, ai_analysis, last_error) + run history
  // without re-running agents or reloading the page.
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const [fresh, updatedRuns] = await Promise.all([getAlert(alert.id), getAlertRuns(alert.id)]);
      setLiveAlert(fresh);
      setRuns(updatedRuns);
      setRunError(null);
    } catch (err: any) {
      showToast(err?.message || 'Refresh failed', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const handleSaveSnapshot = async () => {
    if (!aiData || isSavingSnapshot) return;
    setIsSavingSnapshot(true);
    try {
      await saveAlertRun(alert.id, {
        ai_analysis:       alert.ai_analysis,
        mitre_attack:      Array.isArray(alert.mitre_attack) ? JSON.stringify(alert.mitre_attack) : (alert.mitre_attack as any),
        remediation_steps: alert.remediation_steps,
        status:            alert.status,
      });
      const updated = await getAlertRuns(alert.id);
      setRuns(updated);
      setShowHistory(true);
      showToast('Snapshot saved successfully');
    } catch (err: any) {
      setRunError(err?.message || 'Failed to save snapshot.');
      showToast('Failed to save snapshot', 'error');
    } finally {
      setIsSavingSnapshot(false);
    }
  };

  const completedCount = agentDefs.filter(a => (agentRunHistory[a.id]?.length || 0) > 0).length;
  const totalPhases = agentDefs.length;
  const progressPct = Math.round((completedCount / totalPhases) * 100);
  const runningPhaseLabel = runningPhase ? (agentDefs.find(a => a.id === runningPhase)?.label || runningPhase) : null;

  return (
    <div className="flex flex-col h-full bg-[var(--s2)] overflow-hidden">

      {/* Slim top bar — title + pipeline progress only */}
      <div className="bg-[var(--s0)] border-b border-[var(--b1)] px-5 h-11 flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={() => { onClose(); if (returnTab && setActiveTab) setActiveTab(returnTab); }}
          className="text-[0.72rem] font-semibold text-[var(--t4)] hover:text-[var(--p1)] transition-colors shrink-0"
        >
          ← Back
        </button>
        <div className="w-px h-4 bg-[var(--s2)] shrink-0" />
        <p className="text-[0.82rem] font-semibold text-[var(--t7)] truncate flex-1">{alert.description}</p>
        <div className="flex items-center gap-2 shrink-0">
          {runningPhaseLabel && (
            <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[0.62rem] font-black uppercase tracking-wide">
              Running: {runningPhaseLabel}
            </span>
          )}
          <span className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest">Pipeline</span>
          <div className="w-28 h-1.5 bg-[var(--s1)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--p1)] rounded-full transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[0.65rem] font-bold text-[var(--t4)]">{completedCount}/{totalPhases} · {progressPct}%</span>
        </div>
      </div>

      {/* Main scrollable content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* Alert identity + actions card */}
        <div className="bg-[var(--s0)] rounded-xl border border-[var(--b1)] px-5 py-4 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className={`px-2.5 py-0.5 rounded-full text-[0.62rem] font-black uppercase tracking-wide border ${sevStyle[severity]}`}>
                {severity}
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-[0.62rem] font-black uppercase tracking-wide border ${
                alert.status === 'TRIAGED' ? 'bg-green-50 text-green-700 border-green-200' :
                alert.status === 'ANALYZING' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                alert.status === 'FALSE_POSITIVE' ? 'bg-gray-50 text-[var(--t2)] border-gray-200' :
                'bg-[var(--s1)] text-[var(--t5)] border-[var(--b2)]'
              }`}>{alert.status}</span>
              {alert.email_sent === 1 && (
                <span className="flex items-center gap-1 text-[0.62rem] font-bold text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full uppercase">
                  <Bell size={9} fill="currentColor" /> Email Sent
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-[0.7rem] text-[var(--t4)]">
              <span className="font-mono font-bold text-[var(--t3)]">#{alert.id.substring(0, 10).toUpperCase()}</span>
              {alert.source_ip && <span>SRC: <span className="font-mono font-bold text-[var(--t6)]">{alert.source_ip}</span></span>}
              <span>Host: <span className="font-mono font-bold text-[var(--t6)]">{alert.agent_name}</span></span>
              <span>{new Date(alert.timestamp).toLocaleString()}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => setShowReport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--s1)] hover:bg-[var(--s2)] text-[var(--t6)] text-[0.72rem] font-bold transition-colors border border-[var(--b2)]"
            >
              <FileText size={13} /> Report
            </button>
            <button
              type="button"
              onClick={() => {
                setShowHistory(h => !h);
                if (!showHistory) {
                  setRunsLoading(true);
                  getAlertRuns(alert.id).then(setRuns).catch(() => {}).finally(() => setRunsLoading(false));
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.72rem] font-bold transition-colors border ${showHistory ? 'bg-[var(--p1)] text-white border-[var(--p1)]' : 'bg-[var(--s1)] hover:bg-[var(--s2)] text-[var(--t6)] border-[var(--b2)]'}`}
            >
              {runsLoading ? <div className="w-3 h-3 rounded-full border-2 border-current/40 border-t-current animate-spin" /> : <Clock size={13} />}
              History {runs.length > 0 ? `(${runs.length})` : ''}
            </button>
            {aiData && (
              <button
                type="button"
                onClick={handleSaveSnapshot}
                disabled={isSavingSnapshot || isAnalyzing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--s1)] hover:bg-[var(--s2)] text-[var(--t6)] text-[0.72rem] font-bold transition-colors border border-[var(--b2)] disabled:opacity-50"
              >
                {isSavingSnapshot ? <div className="w-3 h-3 rounded-full border-2 border-slate-400/40 border-t-slate-600 animate-spin" /> : <Plus size={13} />}
                Snapshot
              </button>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing || isAnalyzing}
              title="Re-pull this alert's latest state without re-running agents"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--s1)] hover:bg-[var(--s2)] text-[var(--t6)] text-[0.72rem] font-bold transition-colors border border-[var(--b2)] disabled:opacity-50"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
            <button
              type="button"
              onClick={handleRerunFresh}
              disabled={isAnalyzing}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--p1)] hover:bg-[var(--pd)] text-white text-[0.72rem] font-bold transition-colors disabled:opacity-60 shadow-sm"
            >
              {isRerunning ? (
                <><div className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" /> Running...</>
              ) : (
                <><Activity size={13} /> Run Agents</>
              )}
            </button>
          </div>
        </div>

        <div className="flex justify-end">
          <ProviderHealthBadge />
        </div>

        <AgentRunStatus
          loading={isRerunning}
          error={runError}
          lastError={alert.last_error}
          lastErrorAt={alert.last_error_at}
          quotaExhausted={aiData?.quota_exhausted === true}
          fallbackPhases={Array.isArray(aiData?.fallback_phases) ? aiData.fallback_phases : []}
          phaseErrors={aiData?.phase_errors || {}}
          busy={isRerunning || refreshing}
          onRetry={handleRerunFresh}
          onRefresh={handleRefresh}
          onDismiss={() => setRunError(null)}
          retryLabel="Retry all agents"
        />

        {/* Run History Panel */}
        {showHistory && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[0.65rem] font-black text-[var(--t3)] uppercase tracking-widest">
                Run History — {runs.length} saved run{runs.length !== 1 ? 's' : ''}
              </p>
              <button type="button" onClick={() => setShowHistory(false)} aria-label="Close run history" className="text-[var(--t3)] hover:text-[var(--t5)]">
                <X size={14} />
              </button>
            </div>
            {runs.length === 0 ? (
              <div className="bg-[var(--s0)] rounded-xl border border-[var(--b1)] p-6 text-center text-[0.8rem] text-[var(--t3)]">
                No saved runs yet. Use <span className="font-bold text-[var(--t5)]">Run Agents</span> to run all agents, or <span className="font-bold text-[var(--t5)]">Save Snapshot</span> to record the current state.
              </div>
            ) : (
              runs.map((run) => {
                let runAiData: any = null;
                let runMitre: string[] = [];
                try { runAiData = run.ai_analysis ? JSON.parse(run.ai_analysis) : null; } catch (e) {}
                try { runMitre = run.mitre_attack ? JSON.parse(run.mitre_attack) : []; } catch (e) {}
                const runPhaseData = runAiData?.phaseData || {};
                const allPhases: Array<'analysis'|'intel'|'knowledge'|'correlation'|'recall'|'ioc_check'|'ticketing'|'response'|'validation'> = ['analysis','intel','knowledge','correlation','recall','ioc_check','ticketing','response','validation'];
                const agentScores = allPhases.map(p => {
                  const raw = p === 'ticketing' ? runPhaseData?.ticket?.confidence : runPhaseData?.[p]?.confidence;
                  return typeof raw === 'number' ? raw : null;
                }).filter((v): v is number => v !== null);
                const avgConf = agentScores.length ? Math.round(agentScores.reduce((a, b) => a + b, 0) / agentScores.length * 100) : null;
                const completedAgents = agentScores.length;
                const isFP = runPhaseData?.analysis?.is_false_positive;
                const isExpanded = expandedRunId === run.id;

                return (
                  <div key={run.id} className="bg-[var(--s0)] rounded-xl border border-[var(--b1)] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--s1)] transition-colors text-left"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[0.72rem] font-mono text-[var(--t4)]">
                          {new Date(run.run_at).toLocaleString()}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full border text-[0.6rem] font-black uppercase tracking-wide ${
                          run.status === 'TRIAGED' ? 'bg-green-50 text-green-700 border-green-200' :
                          run.status === 'FALSE_POSITIVE' ? 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)]' :
                          'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>{run.status || 'TRIAGED'}</span>
                        {isFP !== undefined && (
                          <span className={`px-2 py-0.5 rounded-full border text-[0.6rem] font-black uppercase tracking-wide ${isFP ? 'bg-red-50 text-red-600 border-red-200' : 'bg-[var(--s1)] text-[var(--t4)] border-[var(--b2)]'}`}>
                            FP: {isFP ? 'YES' : 'No'}
                          </span>
                        )}
                        {avgConf !== null && (
                          <span className={`px-2 py-0.5 rounded-full border text-[0.6rem] font-black uppercase tracking-wide ${avgConf >= 80 ? 'bg-green-50 text-green-700 border-green-200' : avgConf >= 60 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                            Avg Conf: {avgConf}%
                          </span>
                        )}
                        <span className="text-[0.65rem] text-[var(--t3)]">{completedAgents}/{AGENT_PHASES_UI.length} agents</span>
                      </div>
                      <ChevronRight size={14} className={`text-[var(--t3)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </button>

                    {isExpanded && (
                      <div className="border-t border-[var(--b3)] px-4 py-3 space-y-3">
                        {runAiData?.summary && (
                          <div>
                            <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Analysis Summary</p>
                            <p className="text-[0.78rem] text-[var(--t6)] leading-relaxed">{runAiData.summary}</p>
                          </div>
                        )}
                        {runMitre.length > 0 && (
                          <div>
                            <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">MITRE ATT&CK</p>
                            <div className="flex flex-wrap gap-1.5">
                              {runMitre.map((tag: string) => (
                                <span key={tag} className="px-2 py-1 bg-[#1a1a2e] text-[#e94560] border border-[#e94560]/30 rounded text-[0.65rem] font-black font-mono">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest mb-2">Agent Confidence</p>
                          <div className="grid grid-cols-9 gap-1">
                            {['analysis','intel','knowledge','correlation','recall','ioc_check','ticketing','response','validation'].map((p) => {
                              const raw = p === 'ticketing' ? runPhaseData?.ticket?.confidence : runPhaseData?.[p]?.confidence;
                              const pct = typeof raw === 'number' ? Math.round(raw * 100) : null;
                              return (
                                <div key={p} className="flex flex-col items-center gap-1">
                                  <div className="h-8 w-full bg-[var(--s1)] rounded-sm overflow-hidden flex flex-col-reverse">
                                    <div
                                      className={`w-full transition-all ${pct === null ? 'h-0' : pct >= 80 ? 'bg-green-400' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
                                      style={{ height: pct !== null ? `${pct}%` : '0%' }}
                                    />
                                  </div>
                                  <span className="text-[0.55rem] text-[var(--t4)] text-center leading-none">{pct !== null ? `${pct}%` : '—'}</span>
                                  <span className="text-[0.5rem] text-[var(--t3)] text-center leading-none capitalize">{p === 'ioc_check' ? 'ioc' : p.slice(0,4)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        {run.remediation_steps && (
                          <div>
                            <p className="text-[0.6rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Remediation</p>
                            <p className="text-[0.75rem] text-[var(--t5)] whitespace-pre-line leading-relaxed">{run.remediation_steps}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        <EvidenceStrip aiData={aiData} mitreTags={mitreTags} />

        <AlertHeroStrip
          alert={alert}
          aiData={aiData}
          mitreTags={mitreTags}
          severity={severity}
          sevStyle={sevStyle}
          agentDefs={agentDefs}
          agentConfidence={getAgentConfidence}
          scrollToAgents={() => agentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />

        <div ref={agentsRef} className="bg-[var(--s0)] rounded-xl border border-[var(--b1)] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--b3)] bg-[var(--s1)]">
            <p className="text-[0.62rem] font-black uppercase tracking-widest text-[var(--p1)]">Swarm Pipeline</p>
            <div className="flex items-center gap-3">
              {isRerunning && elapsedMs !== null ? (
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[var(--p1)] animate-ping" />
                  <span className="text-[0.65rem] font-mono font-bold text-[var(--p1)] tabular-nums">{formatElapsed(elapsedMs)}</span>
                </div>
              ) : elapsedMs !== null && elapsedMs > 0 ? (
                <span className="text-[0.6rem] font-mono text-green-600 font-semibold">✓ {formatElapsed(elapsedMs)}</span>
              ) : null}
              <span className="text-[0.6rem] font-semibold text-[var(--t3)]">{completedCount}/{agentDefs.length} completed</span>
            </div>
          </div>

          {(() => {
            if (isRerunning) {
              return (
                <div className="px-4 py-3 border-b border-[var(--b3)] bg-[var(--p1)]/5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="skeleton h-2 w-20" style={{ animationDelay: '0ms' }} />
                      <div className="skeleton h-3 w-2/3" style={{ animationDelay: '80ms' }} />
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <div className="skeleton h-5 w-32 rounded-full" style={{ animationDelay: '160ms' }} />
                      <div className="skeleton h-5 w-20" style={{ animationDelay: '240ms' }} />
                    </div>
                  </div>
                </div>
              );
            }
            if (!aiData) return null;
            const plannerLog = (aiData.agentLogs || []).find((l: string) => l.includes('] Planner:'));
            const dispatched = plannerLog ? plannerLog.replace(/.*\] Planner:\s*/, '').trim() : null;
            const isFP = alert.status === 'FALSE_POSITIVE';
            const plannerFallback = Array.isArray(aiData.fallback_phases) && aiData.fallback_phases.includes('planner');
            const traceShort = aiData.trace_id ? aiData.trace_id.slice(0, 8) : null;
            const investigatorCount = INVESTIGATOR_PHASES.filter(p => aiData.phaseData?.[p] != null).length;
            return (
              <div className={`px-4 py-3 border-b border-[var(--b3)] ${isFP ? 'bg-amber-500/10' : 'bg-[var(--p1)]/5'}`}>
                {isFP ? (
                  <div className="flex items-center gap-2">
                    <Zap size={13} className="text-amber-500 shrink-0" />
                    <p className="text-[0.72rem] font-bold text-amber-700 dark:text-amber-400">Short-circuited — high-confidence false positive. Only triage ran; all investigators and composers were skipped.</p>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <p className="text-[0.6rem] font-black uppercase tracking-widest text-[var(--p1)] mb-0.5">Planner Decision</p>
                      {dispatched ? (
                        <p className="text-[0.72rem] text-[var(--t6)] font-mono">{dispatched}</p>
                      ) : (
                        <p className="text-[0.72rem] text-[var(--t3)] italic">{plannerFallback ? 'Planner fell back to defaults (rate-limited)' : 'Run swarm to see planner output'}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      {investigatorCount > 0 && (
                        <span className="text-[0.6rem] font-bold px-2 py-0.5 rounded-full bg-[var(--p1)]/15 text-[var(--p1)] border border-[var(--p1)]/20">
                          {investigatorCount} investigator{investigatorCount !== 1 ? 's' : ''} dispatched
                        </span>
                      )}
                      {plannerFallback && (
                        <span className="text-[0.6rem] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">⚠ fallback</span>
                      )}
                      {traceShort && (
                        <span className="text-[0.58rem] font-mono text-[var(--t3)] px-2 py-0.5 rounded bg-[var(--s1)] border border-[var(--b2)]">trace {traceShort}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {(() => {
            const isFP = alert.status === 'FALSE_POSITIVE';
            const phaseOrder = agentDefs.map(a => a.id);
            const phaseStates = agentDefs.map(agent => {
              const hist = agentRunHistory[agent.id] || [];
              const runCount = hist.length;
              const isDone = runCount > 0;
              const isRunning = runningPhase === agent.id;
              const isFallback = Array.isArray(aiData?.fallback_phases) && aiData.fallback_phases.includes(agent.id);
              const isSkipped = !isFP && aiData?.phaseData && (agent.id in aiData.phaseData) && aiData.phaseData[agent.id] === null;
              return { isDone, isRunning, isFallback, isSkipped };
            });
            const doneCount = phaseStates.filter(p => p.isDone).length;
            const runningCount = phaseStates.filter(p => p.isRunning).length;
            const pendingCount = phaseStates.filter(p => !p.isDone && !p.isRunning && !p.isSkipped).length;
            const fallbackCount = phaseStates.filter(p => p.isFallback).length;

            const getSnippet = (agent: typeof agentDefs[0], result: any) => {
              if (!result) return 'No output yet.';
              const raw = agent.getContent?.(result);
              const text =
                Array.isArray(raw) ? raw.join(', ') :
                typeof raw === 'string' ? raw :
                raw == null ? '' :
                String(raw);
              const compact = text.replace(/\s+/g, ' ').trim();
              if (!compact) return agent.desc;
              return compact.length > 110 ? `${compact.slice(0, 110)}…` : compact;
            };

            const renderPhaseCard = (agent: typeof agentDefs[0]) => {
              const isRunningThis = runningPhase === agent.id;
              const hist = agentRunHistory[agent.id] || [];
              const runCount = hist.length;
              const isDone = runCount > 0;
              const currentIdx = isDone ? (agentRunIndex[agent.id] ?? runCount - 1) : 0;
              const displayResult = isDone ? hist[Math.min(currentIdx, runCount - 1)] : null;
              const confidence = getAgentConfidence(agent.id);
              const confidenceState = getConfidenceStatus(confidence);
              const isViewingLatest = currentIdx === runCount - 1;
              const isExpanded = expandedAgent === agent.id;
              const isFallback = Array.isArray(aiData?.fallback_phases) && aiData.fallback_phases.includes(agent.id);
              const phaseError: string | undefined = aiData?.phase_errors?.[agent.id];
              const isSkipped = !isFP && aiData?.phaseData && (agent.id in aiData.phaseData) && aiData.phaseData[agent.id] === null;
              const memHits = (agent.id === 'recall' || agent.id === 'ioc_check')
                ? (displayResult?.hits?.length ?? aiData?.phaseData?.[agent.id]?.hits?.length ?? null)
                : null;
              const isSkeleton = isRerunning && !isDone && !isRunningThis;
              const staggerDelay = `${phaseOrder.indexOf(agent.id) * 120}ms`;
              const statusText = isFP || isSkipped ? 'Skipped' : isRunningThis ? 'Running' : isDone ? 'Complete' : 'Pending';

              return (
                <div
                  key={agent.id}
                  className={`rounded-lg border border-[var(--b2)] bg-[var(--s0)] overflow-hidden ${
                    isExpanded ? 'ring-1 ring-[var(--p1)]/30 border-[var(--p1)]/30' : ''
                  } ${(isFP || isSkipped) ? 'opacity-45' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                    className={`w-full px-3 py-2.5 text-left transition-colors ${isExpanded ? 'bg-[var(--p1)]/6' : 'hover:bg-[var(--s1)]'} ${isRunningThis ? 'bg-[var(--p1)]/10' : ''}`}
                  >
                    {isSkeleton ? (
                      <div className="flex items-center gap-3">
                        <div className="skeleton w-7 h-7 rounded-md shrink-0" style={{ animationDelay: staggerDelay }} />
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="skeleton h-2.5 w-40" style={{ animationDelay: staggerDelay }} />
                          <div className="skeleton h-2.5 w-2/3" style={{ animationDelay: staggerDelay }} />
                        </div>
                        <div className="skeleton w-8 h-8 rounded-full shrink-0" style={{ animationDelay: staggerDelay }} />
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                          isRunningThis ? 'bg-[var(--p1)]' : isDone ? 'bg-green-600' : 'bg-[var(--s2)]'
                        }`}>
                          {isRunningThis
                            ? <div className="w-2.5 h-2.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                            : <agent.icon size={13} className={isDone ? 'text-white' : 'text-[var(--t4)]'} />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            <p className="text-[0.72rem] font-bold text-[var(--t7)]">{agent.label}</p>
                            <span className="text-[0.52rem] font-bold px-1.5 py-0.5 rounded border border-[var(--b2)] bg-[var(--s1)] text-[var(--t4)] uppercase tracking-wide">{statusText}</span>
                            {isFallback && !isFP && !isSkipped && (
                              <span className="text-[0.52rem] font-bold px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700 uppercase tracking-wide">Fallback</span>
                            )}
                            {memHits !== null && (
                              <span className="text-[0.52rem] font-bold px-1.5 py-0.5 rounded border border-[var(--p1)]/20 bg-[var(--p1)]/10 text-[var(--p1)]">{memHits} hit{memHits !== 1 ? 's' : ''}</span>
                            )}
                          </div>
                          <p className="text-[0.66rem] text-[var(--t5)] leading-relaxed truncate">{getSnippet(agent, displayResult)}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <ConfidenceDonut value={confidence} />
                          <div className={`text-[0.5rem] font-black px-1.5 py-0.5 rounded border ${confidenceState.cls}`}>
                            {confidenceState.label}
                          </div>
                          <ChevronDown size={14} className={`text-[var(--t3)] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </div>
                    )}
                  </button>

                  {isExpanded && (
                    <div className="border-t border-[var(--b2)] bg-[var(--s1)]/60 px-3 py-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[0.58rem] font-bold px-1.5 py-0.5 rounded border border-[var(--b2)] bg-[var(--s0)] text-[var(--t4)]">
                            confidence {confidence == null ? '—' : `${Math.round(confidence * 100)}%`}
                          </span>
                          {runCount > 0 && (
                            <div className="flex items-center gap-0.5 bg-[var(--s0)] border border-[var(--b2)] rounded-full px-1.5 py-0.5">
                              <button type="button" onClick={(e) => { e.stopPropagation(); navigateAgentRun(agent.id, -1); }} disabled={currentIdx <= 0} className="w-4 h-4 flex items-center justify-center text-[var(--t3)] hover:text-[var(--t6)] disabled:opacity-25">‹</button>
                              <span className={`text-[0.62rem] font-black font-mono px-0.5 ${isViewingLatest ? 'text-green-600' : 'text-amber-600'}`}>{currentIdx + 1}/{runCount}</span>
                              <button type="button" onClick={(e) => { e.stopPropagation(); navigateAgentRun(agent.id, 1); }} disabled={currentIdx >= runCount - 1} className="w-4 h-4 flex items-center justify-center text-[var(--t3)] hover:text-[var(--t6)] disabled:opacity-25">›</button>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleFeedback(agent.id, true); }}
                            disabled={feedbackLoading[`${agent.id}-true`] || !!feedbackSubmitted[agent.id]}
                            className={`p-1 rounded transition-colors disabled:opacity-50 ${feedbackSubmitted[agent.id] === 'up' ? 'text-green-600 bg-green-100' : 'hover:bg-green-100 text-[var(--t3)] hover:text-green-600'}`}
                            title="Mark as accurate"
                          >
                            <ThumbsUp size={14} className={feedbackLoading[`${agent.id}-true`] ? 'animate-pulse' : ''} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleFeedback(agent.id, false); }}
                            disabled={feedbackLoading[`${agent.id}-false`] || !!feedbackSubmitted[agent.id]}
                            className={`p-1 rounded transition-colors disabled:opacity-50 ${feedbackSubmitted[agent.id] === 'down' ? 'text-red-600 bg-red-100' : 'hover:bg-red-100 text-[var(--t3)] hover:text-red-600'}`}
                            title="Mark as inaccurate"
                          >
                            <ThumbsDown size={14} className={feedbackLoading[`${agent.id}-false`] ? 'animate-pulse' : ''} />
                          </button>
                        </div>
                      </div>
                      {(isFallback || phaseError) && !isFP && !isSkipped && (
                        <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2">
                          <p className="text-[0.6rem] font-black uppercase tracking-wider text-amber-800 mb-0.5">Fallback — agent did not produce a real result</p>
                          {phaseError && <p className="text-[0.64rem] text-amber-800 break-words leading-relaxed">{phaseError}</p>}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleAgentRun(agent.id); }}
                            disabled={isAnalyzing || isRunningThis}
                            className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[0.64rem] font-bold transition-colors disabled:opacity-60"
                          >
                            {isRunningThis
                              ? <><div className="w-2.5 h-2.5 rounded-full border-2 border-white/40 border-t-white animate-spin" /> Re-running…</>
                              : <><RefreshCw size={11} /> Re-run this agent</>}
                          </button>
                        </div>
                      )}
                      {displayResult ? (
                        <pre className="bg-slate-950 text-emerald-300 rounded p-3 text-[0.65rem] leading-relaxed font-mono overflow-x-auto max-h-64 overflow-y-auto">{JSON.stringify(displayResult, null, 2)}</pre>
                      ) : (
                        <p className="text-[0.68rem] text-[var(--t4)] italic">No result yet for this agent.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            };

            return (
              <div className="divide-y divide-[var(--b3)]">
                <div className="px-3 py-2 bg-[var(--s1)]/60 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[0.55rem] font-bold px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">Complete {doneCount}</span>
                    <span className="text-[0.55rem] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">Running {runningCount}</span>
                    <span className="text-[0.55rem] font-bold px-1.5 py-0.5 rounded bg-[var(--s0)] text-[var(--t5)] border border-[var(--b2)]">Pending {pendingCount}</span>
                    <span className="text-[0.55rem] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">Fallback {fallbackCount}</span>
                  </div>
                  <span className="text-[0.58rem] text-[var(--t4)]">Confidence = model certainty</span>
                </div>

                <div className="px-3 pt-3 pb-2">
                  <p className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)] mb-2">Mandatory</p>
                  <div className="grid gap-2">
                    {agentDefs.filter(a => MANDATORY_PHASES.includes(a.id)).map(renderPhaseCard)}
                  </div>
                </div>

                <div className="px-3 pt-3 pb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Investigators</p>
                    <span className="text-[0.5rem] font-bold px-1.5 py-0.5 rounded bg-[var(--p1)]/10 text-[var(--p1)] border border-[var(--p1)]/20 uppercase tracking-wide">⚡ parallel</span>
                  </div>
                  <div className="grid gap-2">
                    {agentDefs.filter(a => INVESTIGATOR_PHASES.includes(a.id)).map(renderPhaseCard)}
                  </div>
                </div>

                <div className="px-3 pt-3 pb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[0.55rem] font-black uppercase tracking-widest text-[var(--t3)]">Composers</p>
                    <span className="text-[0.5rem] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-[var(--t4)] border border-[var(--b2)] uppercase tracking-wide dark:bg-[var(--s2)] dark:text-[var(--t3)]">→ sequential</span>
                  </div>
                  <div className="grid gap-2">
                    {agentDefs.filter(a => COMPOSER_PHASES.includes(a.id)).map(renderPhaseCard)}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        <InvestigationGrid alert={alert} aiData={aiData} mitreTags={mitreTags} allAlerts={allAlerts} onAlertSelect={onAlertSelect} />

        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-lg">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-2">
              <Terminal size={12} className="text-emerald-500" />
              <p className="text-[0.6rem] font-black uppercase tracking-widest text-emerald-500/80">Agent Logs</p>
            </div>
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-full bg-red-500/20" />
              <div className="w-2 h-2 rounded-full bg-amber-500/20" />
              <div className="w-2 h-2 rounded-full bg-emerald-500/20" />
            </div>
          </div>
          <div className="p-4 h-48 overflow-y-auto font-mono text-[0.7rem] leading-relaxed space-y-1 scrollbar-thin scrollbar-thumb-emerald-500/20 scrollbar-track-transparent">
            {(aiData?.agentLogs || []).length > 0 ? (
              aiData.agentLogs.map((log: string, i: number) => (
                <div key={i} className="flex gap-3 text-emerald-400/90 animate-in fade-in slide-in-from-left-2 duration-300">
                  <span className="text-emerald-500/40 shrink-0 select-none">[{new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                  <span className="flex-1">{log}</span>
                </div>
              ))
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-[var(--t5)] italic gap-2 opacity-50">
                <Activity size={24} className={isAnalyzing ? 'animate-pulse' : ''} />
                <p>{isAnalyzing ? 'Agents are communicating...' : 'Standby — Waiting for swarm activation'}</p>
              </div>
            )}
            <div className="h-1" />
          </div>
        </div>

        <div className="bg-[var(--s0)] rounded-xl border border-[var(--b1)] overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection('rawlog')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--s1)] transition-colors text-left"
          >
            <p className="text-[0.65rem] font-black text-[var(--t3)] uppercase tracking-widest">Raw Wazuh Log</p>
            <ChevronDown size={14} className={`text-[var(--t3)] transition-transform ${collapsedSections.rawlog ? '' : 'rotate-180'}`} />
          </button>
          {!collapsedSections.rawlog && (
            <div className="px-4 pb-4">
              <div className="relative">
                {alert.full_log && <CopyButton text={alert.full_log} className="absolute top-2 right-2 z-10" />}
                <pre className="text-[0.68rem] bg-slate-950 text-emerald-400 p-4 rounded-xl overflow-x-auto font-mono leading-relaxed">
                  {alert.full_log || 'No log data.'}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action footer */}
      <div className="bg-[var(--s0)] border-t border-[var(--b1)] px-6 py-3.5 flex items-center justify-between shrink-0">
        <div className="text-[0.72rem] text-[var(--t4)]">
          {aiData?.response?.actions?.length
            ? <span className="font-semibold text-[var(--t6)]">Recommended: {aiData.response.actions[0]?.type?.replace('_', ' ')} → <span className="font-mono">{aiData.response.actions[0]?.target}</span></span>
            : 'Run agents to generate recommended actions.'
          }
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirmAction({ status: 'FALSE_POSITIVE', label: 'Mark as False Positive', message: 'Mark this alert as a False Positive? This will suppress further notifications for this alert.', cls: 'bg-slate-600 hover:bg-slate-700' })}
            className="px-4 py-2 rounded-lg border border-[var(--b2)] text-[var(--t5)] font-semibold text-[0.8rem] bg-[var(--s0)] hover:bg-[var(--s1)] transition-colors"
          >
            False Positive
          </button>
          <button
            type="button"
            onClick={() => setConfirmAction({ status: 'ESCALATED', label: 'Escalate', message: 'Escalate this alert to the incident queue for immediate analyst attention?', cls: 'bg-[var(--p1)] hover:bg-[var(--pd)]' })}
            className="px-4 py-2 rounded-lg border border-[var(--p1)] text-[var(--p1)] font-semibold text-[0.8rem] bg-[var(--s0)] hover:bg-blue-50 transition-colors"
          >
            Escalate
          </button>
          <button
            type="button"
            onClick={() => setConfirmAction({ status: 'CLOSED', label: 'Close Incident', message: 'Close this incident? This marks the alert as resolved.', cls: 'bg-[#1e8e3e] hover:bg-green-700' })}
            className="px-4 py-2 rounded-lg bg-[var(--p1)] text-white font-bold text-[0.8rem] hover:bg-[var(--pd)] transition-colors shadow-sm"
          >
            Close Incident
          </button>
        </div>
      </div>

      {confirmAction && (
        <ConfirmModal
          title={confirmAction.label}
          message={confirmAction.message}
          confirmLabel={confirmAction.label}
          confirmClass={confirmAction.cls}
          onConfirm={async () => {
            const status = confirmAction.status;
            setConfirmAction(null);
            // Escalation must create an incident row, not just flip a column.
            if (status === 'ESCALATED') {
              try {
                const r = await escalateAlert(alert.id);
                if (r?.ok) {
                  onAction(alert.id, { status: 'ESCALATED' });
                  showToast(`Incident ${r.incident_id || ''} created — see Incidents tab`);
                } else {
                  showToast(r?.error || 'Escalation failed', 'error');
                }
              } catch (err: any) {
                showToast(err?.message || 'Escalation failed', 'error');
              }
              return;
            }
            onAction(alert.id, { status });
            showToast(`Alert marked as ${status.toLowerCase().replace('_', ' ')}`);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {showReport && (
        <DetailedReport
          alert={alert}
          aiData={aiData}
          mitreTags={mitreTags}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
};


export { AlertRow, DetailedReport, RiskGauge, MiniBar, ConfidenceDonut, GlobalRiskDonut, PipelineRiskTimeSeries, AlertHeroStrip, EvidenceStrip, IocTable, InvestigationGrid, AlertDetail };
export type { RiskSeriesPoint, RiskChartGranularity };
