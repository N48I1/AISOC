import React, { createContext, useContext, useState, useEffect } from 'react';
import { Shield, AlertTriangle, Activity, FileText, Settings, LogOut, Search, Bell, User, CheckCircle, XCircle, Clock, ChevronRight, BarChart3, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { orchestrateAnalysis, runAgentPhase } from './services/aiService';
import { User as UserType, Alert, UserRole } from './types';

// --- Auth Context ---
interface AuthContextType {
  user: UserType | null;
  token: string | null;
  login: (token: string, user: UserType) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserType | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('soc_token'));

  useEffect(() => {
    if (token) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      }).then(res => res.json())
        .then(data => {
          if (data.error) logout();
          else setUser(data);
        })
        .catch(() => logout());
    }
  }, [token]);

  const login = (newToken: string, newUser: UserType) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('soc_token', newToken);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('soc_token');
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

// --- Components ---

const Sidebar = ({ activeTab, setActiveTab }: { activeTab: string, setActiveTab: (t: string) => void }) => {
  const { logout, user } = useAuth();
  
  const menuItems = [
    { id: 'dashboard', icon: BarChart3, label: 'Dashboard' },
    { id: 'alerts', icon: AlertTriangle, label: 'Alerts Queue' },
    { id: 'incidents', icon: Shield, label: 'Investigations' },
    { id: 'agents', icon: Activity, label: 'AI Agents' },
    { id: 'reports', icon: FileText, label: 'Incident Reports' },
    { id: 'settings', icon: Settings, label: 'System Admin' },
  ];

  return (
    <aside className="w-[200px] bg-white border-r border-[#d1d9e6] h-screen flex flex-col py-5">
      <nav className="flex-1 flex flex-col gap-1">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`flex items-center gap-3 px-5 py-3 text-[0.9rem] cursor-pointer transition-all ${
              activeTab === item.id 
                ? 'text-[#004a99] bg-[#f0f7ff] border-r-3 border-[#004a99] font-semibold' 
                : 'text-[#5f6368] hover:bg-[#f0f7ff] hover:text-[#004a99]'
            }`}
          >
            <item.icon className="w-4 h-4" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="px-5 pt-4 border-t border-[#d1d9e6]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-[#003366] flex items-center justify-center text-white text-xs font-bold border border-white/30">
            {user?.username?.substring(0, 2).toUpperCase()}
          </div>
          <div className="overflow-hidden">
            <p className="text-xs font-semibold text-[#1a1a1b] truncate">{user?.username}</p>
            <p className="text-[10px] text-[#5f6368] uppercase">{user?.role}</p>
          </div>
        </div>
        <button 
          onClick={logout}
          className="w-full flex items-center gap-2 text-[0.8rem] font-semibold text-[#5f6368] hover:text-[#d93025] transition-all"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};

const Header = () => {
  return (
    <header className="h-[60px] bg-[#004a99] text-white flex items-center justify-between px-5 shadow-md z-[100]">
      <div className="flex items-center gap-2 font-bold text-[1.2rem] tracking-tight">
        🛡️ AEGIS SOC PLATFORM
      </div>
      
      <div className="flex items-center gap-4 text-[0.85rem] opacity-90">
        <span className="flex items-center gap-2">
          <div className="w-2 h-2 bg-[#1e8e3e] rounded-full" />
          Wazuh Cluster: Healthy
        </span>
        <span className="opacity-40">|</span>
        <span>ga.tr.na.el.6@gmail.com (SOC Analyst)</span>
      </div>
    </header>
  );
};

const StatCard = ({ label, value, icon: Icon, trend, color }: any) => (
  <div className="bg-white border border-[#d1d9e6] rounded-lg p-5 flex flex-col gap-2 shadow-sm">
    <div className="flex justify-between items-start">
      <div className="text-[0.75rem] font-bold text-[#5f6368] uppercase tracking-wider">{label}</div>
      <Icon className="w-5 h-5 opacity-20" style={{ color }} />
    </div>
    <div className="text-[1.8rem] font-bold text-[#1a1a1b] leading-none">{value}</div>
    {trend && (
      <div className={`text-[0.7rem] font-bold flex items-center gap-1 ${trend > 0 ? 'text-[#d93025]' : 'text-[#1e8e3e]'}`}>
        {trend > 0 ? '+' : ''}{trend}% from last 24h
      </div>
    )}
  </div>
);

const AlertRow = ({ alert, onClick, isSelected }: { alert: Alert, onClick: () => void, isSelected?: boolean, key?: any }) => {
  const getSeverityColor = (level: number) => {
    if (level >= 12) return '#d93025';
    if (level >= 7) return '#f29900';
    return '#1a73e8';
  };

  return (
    <motion.div 
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClick}
      className={`alert-item p-[12px_15px] border-b border-[#f0f0f0] cursor-pointer transition-colors ${isSelected ? 'bg-[#f0f7ff]' : 'hover:bg-slate-50'}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className="w-1 h-3 rounded-sm" style={{ backgroundColor: getSeverityColor(alert.severity) }} />
        <h4 className="text-[0.85rem] font-semibold text-[#1a1a1b] truncate">{alert.description}</h4>
      </div>
      
      <div className="flex justify-between text-[0.75rem] text-[#5f6368]">
        <span>{alert.source_ip || alert.agent_name}</span>
        <span>{new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </motion.div>
  );
};

const DetailedReport = ({ alert, aiData, mitreTags, onClose }: { alert: Alert, aiData: any, mitreTags: string[], onClose: () => void }) => {
  const severity = alert.severity >= 13 ? 'CRITICAL' : alert.severity >= 10 ? 'HIGH' : alert.severity >= 7 ? 'MEDIUM' : 'LOW';
  const sevColor: Record<string, string> = { CRITICAL: '#d93025', HIGH: '#f29900', MEDIUM: '#1a73e8', LOW: '#1e8e3e' };

  const responseActions = aiData?.response?.actions || [];
  const iocs = aiData?.iocs || {};

  const markdownReport = [
    `# AEGIS SOC — Incident Report`,
    `**Incident ID:** ${alert.id.toUpperCase()}`,
    `**Generated:** ${new Date().toLocaleString()}`,
    `**Status:** ${alert.status}${alert.email_sent === 1 ? '  |  📧 Email Notification Sent' : ''}`,
    ``,
    `---`,
    `## 1. Executive Summary`,
    `| Field | Value |`,
    `|---|---|`,
    `| Description | ${alert.description} |`,
    `| Severity | **${severity}** (Level ${alert.severity}) |`,
    `| Source IP | ${alert.source_ip || 'N/A'} |`,
    `| Hostname | ${alert.agent_name || 'N/A'} |`,
    `| Timestamp | ${new Date(alert.timestamp).toLocaleString()} |`,
    `| Rule ID | ${alert.rule_id || 'N/A'} |`,
    ``,
    aiData?.summary ? `> ${aiData.summary}` : `> No AI analysis available yet.`,
    ``,
    `---`,
    `## 2. Indicators of Compromise (IOCs)`,
    iocs.ips?.length ? `**IPs:** \`${iocs.ips.join('`  `')}\`` : `**IPs:** ${alert.source_ip || 'N/A'}`,
    iocs.users?.length ? `**Users:** ${iocs.users.join(', ')}` : '',
    iocs.hosts?.length ? `**Hosts:** ${iocs.hosts.join(', ')}` : `**Hosts:** ${alert.agent_name || 'N/A'}`,
    ``,
    `---`,
    `## 3. MITRE ATT&CK Mapping`,
    mitreTags.length
      ? mitreTags.map(t => `- \`${t}\``).join('\n')
      : `- No MITRE techniques mapped yet.`,
    ``,
    `---`,
    `## 4. Threat Intelligence`,
    aiData?.intel || `_Threat intel not yet retrieved. Run the Threat Intel agent._`,
    ``,
    `---`,
    `## 5. Remediation & Playbook`,
    alert.remediation_steps || `_Remediation steps not yet retrieved. Run the RAG Knowledge agent._`,
    ``,
    `---`,
    `## 6. Campaign Correlation`,
    aiData?.correlation
      ? `**Campaign:** ${aiData.correlation}`
      : `_No correlation data. Run the Correlation agent._`,
    ``,
    `---`,
    `## 7. Response Plan`,
    responseActions.length
      ? responseActions.map((a: any) => `- **${a.type}** → \`${a.target}\`\n  _${a.reason}_`).join('\n')
      : `_No response plan generated yet. Run the Response agent._`,
    aiData?.response?.approval_required !== undefined
      ? `\n**Analyst Approval Required:** ${aiData.response.approval_required ? 'YES' : 'NO'}`
      : '',
    ``,
    `---`,
    `## 8. SLA & Validation`,
    aiData?.validation || `_SLA validation pending._`,
    ``,
    `---`,
    `## 9. Raw Wazuh Log`,
    `\`\`\``,
    alert.full_log || 'No log data.',
    `\`\`\``,
  ].filter(l => l !== null && l !== undefined).join('\n');

  const downloadReport = () => {
    const blob = new Blob([markdownReport], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `incident-${alert.id}-report.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const Section = ({ title, children }: { title: string, children: React.ReactNode }) => (
    <section>
      <h3 className="text-[0.7rem] font-black text-[#004a99] uppercase tracking-widest mb-3 pb-2 border-b border-[#e8eef7]">
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
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 bg-[#003a7a] text-white shrink-0">
          <div>
            <p className="text-[0.65rem] font-black uppercase tracking-widest text-blue-200 mb-0.5">Aegis SOC — Final Incident Report</p>
            <h2 className="text-[1.1rem] font-black tracking-tight">INC-{alert.id.substring(0, 8).toUpperCase()}</h2>
            <p className="text-[0.75rem] text-blue-200 mt-0.5 truncate max-w-sm">{alert.description}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={downloadReport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[0.75rem] font-bold transition-colors border border-white/20"
            >
              <ChevronRight size={13} className="rotate-90" />
              .md
            </button>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
              <XCircle size={20} />
            </button>
          </div>
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-3 px-7 py-2.5 bg-slate-50 border-b border-slate-200 text-[0.7rem] font-bold shrink-0">
          <span
            className="px-2.5 py-1 rounded-full uppercase tracking-wide"
            style={{ background: `${sevColor[severity]}18`, color: sevColor[severity] }}
          >
            {severity}
          </span>
          <span className="text-slate-400">|</span>
          <span className={`px-2.5 py-1 rounded-full uppercase tracking-wide ${
            alert.status === 'TRIAGED' ? 'bg-green-50 text-green-700' :
            alert.status === 'ANALYZING' ? 'bg-blue-50 text-blue-700' :
            'bg-slate-100 text-slate-600'
          }`}>{alert.status}</span>
          {alert.email_sent === 1 && (
            <>
              <span className="text-slate-400">|</span>
              <span className="flex items-center gap-1 text-green-600"><Bell size={11} fill="currentColor" /> Email sent</span>
            </>
          )}
          <span className="ml-auto text-slate-400">{new Date(alert.timestamp).toLocaleString()}</span>
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
                <div key={f.label} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <p className="text-[0.6rem] font-black text-slate-400 uppercase tracking-wider mb-1">{f.label}</p>
                  <p className="font-mono font-bold text-[0.8rem] text-slate-800 truncate">{f.value}</p>
                </div>
              ))}
            </div>
            <div className="bg-[#f0f7ff] border border-[#c8ddf7] rounded-xl p-4 text-slate-700 leading-relaxed italic text-[0.85rem]">
              {aiData?.summary || 'No AI summary available. Run the Alert Triage agent first.'}
            </div>
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
              {!iocs.ips?.length && !alert.source_ip && !iocs.users?.length && !iocs.hosts?.length && !alert.agent_name && (
                <p className="text-slate-400 text-xs italic">No IOCs extracted yet.</p>
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
              <p className="text-slate-400 text-xs italic">No techniques mapped. Run Threat Intel agent.</p>
            )}
          </Section>

          <Section title="4 — Threat Intelligence">
            <div className="bg-slate-900 rounded-xl p-4 text-slate-200 text-[0.8rem] leading-relaxed whitespace-pre-wrap font-mono">
              {aiData?.intel || <span className="italic text-slate-500">No intel data. Run the Threat Intel agent.</span>}
            </div>
          </Section>

          <Section title="5 — Remediation & Playbook">
            {alert.remediation_steps ? (
              <div className="space-y-2">
                {alert.remediation_steps.split('\n').filter(Boolean).map((step, i) => (
                  <div key={i} className="flex gap-3 items-start p-3 bg-green-50 border border-green-100 rounded-lg">
                    <span className="w-5 h-5 shrink-0 rounded-full bg-green-200 text-green-800 font-black text-[0.65rem] flex items-center justify-center mt-0.5">{i + 1}</span>
                    <p className="text-[0.82rem] text-slate-700 leading-relaxed">{step.replace(/^\d+[\.\)]\s*/, '').replace(/^[-•]\s*/, '')}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-xs italic">No playbook retrieved. Run the RAG Knowledge agent.</p>
            )}
          </Section>

          <Section title="6 — Campaign Correlation">
            <div className={`rounded-xl p-4 border text-[0.82rem] leading-relaxed ${aiData?.correlation && aiData.correlation !== 'None detected' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-500 italic'}`}>
              {aiData?.correlation || 'No correlation data. Run the Correlation agent.'}
            </div>
          </Section>

          <Section title="7 — Response Plan">
            {responseActions.length > 0 ? (
              <div className="space-y-2">
                {responseActions.map((action: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-3.5 border border-slate-200 rounded-xl bg-white">
                    <span className={`px-2 py-0.5 rounded text-[0.6rem] font-black uppercase tracking-wide shrink-0 mt-0.5 ${
                      action.type === 'BLOCK_IP' ? 'bg-red-100 text-red-700' :
                      action.type === 'ISOLATE_HOST' ? 'bg-orange-100 text-orange-700' :
                      action.type === 'DISABLE_USER' ? 'bg-purple-100 text-purple-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>{action.type?.replace('_', ' ')}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-bold text-[0.8rem] text-slate-800 truncate">{action.target}</p>
                      <p className="text-[0.75rem] text-slate-500 mt-0.5">{action.reason}</p>
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
              <p className="text-slate-400 text-xs italic">No response plan generated. Run the Response agent.</p>
            )}
          </Section>

          <Section title="8 — SLA & Validation">
            <div className={`rounded-xl p-4 border text-[0.82rem] ${aiData?.validation ? 'bg-green-50 border-green-200 text-green-900' : 'bg-slate-50 border-slate-200 text-slate-500 italic'}`}>
              {aiData?.validation || 'SLA validation pending. Run the Validation agent.'}
            </div>
          </Section>

          <Section title="9 — Raw Wazuh Log">
            <pre className="text-[0.7rem] bg-slate-950 text-emerald-400 p-5 rounded-xl overflow-x-auto font-mono leading-relaxed">
              {alert.full_log || 'No log data.'}
            </pre>
          </Section>
        </div>

        <div className="px-7 py-4 border-t bg-slate-50 flex justify-end shrink-0">
          <button onClick={onClose} className="px-6 py-2.5 rounded-lg font-bold text-slate-600 hover:bg-slate-100 transition-colors border border-slate-200 text-sm">
            Close Report
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const AlertDetail = ({ alert, onClose, onAction }: { alert: Alert, onClose: () => void, onAction: (id: string, update: any) => void }) => {
  const [showReport, setShowReport] = useState(false);
  const [runningPhase, setRunningPhase] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  let aiData: any = null;
  let mitreTags: string[] = [];
  try { aiData = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch (e) {}
  try { mitreTags = alert.mitre_attack ? JSON.parse(alert.mitre_attack as any) : []; } catch (e) {}

  const isAnalyzing = alert.status === 'ANALYZING' || runningPhase !== null || runningAll;

  const severity = alert.severity >= 13 ? 'CRITICAL' : alert.severity >= 10 ? 'HIGH' : alert.severity >= 7 ? 'MEDIUM' : 'LOW';
  const sevStyle: Record<string, string> = {
    CRITICAL: 'bg-red-50 text-red-700 border-red-200',
    HIGH: 'bg-orange-50 text-orange-700 border-orange-200',
    MEDIUM: 'bg-blue-50 text-blue-700 border-blue-200',
    LOW: 'bg-green-50 text-green-700 border-green-200',
  };

  const agentDefs = [
    { id: 'analysis',   label: 'Alert Triage',       icon: Search,      content: aiData?.summary,                                                                   desc: 'Extracts IOCs and validates severity' },
    { id: 'intel',      label: 'Threat Intel',        icon: Shield,      content: aiData?.intel,                                                                     desc: 'MITRE ATT&CK mapping & reputation' },
    { id: 'knowledge',  label: 'RAG Playbook',        icon: Clock,       content: alert.remediation_steps,                                                           desc: 'Retrieves remediation playbooks' },
    { id: 'correlation',label: 'Correlation',         icon: Activity,    content: aiData?.correlation,                                                               desc: 'Detects multi-stage campaigns' },
    { id: 'ticketing',  label: 'Incident Report',     icon: FileText,    content: aiData?.ticket?.title ? `${aiData.ticket.title}` : null,                          desc: 'Generates structured ticket & email' },
    { id: 'response',   label: 'Response Plan',       icon: Terminal,    content: aiData?.response?.actions?.map((a: any) => `${a.type} → ${a.target}`).join('\n'), desc: 'Recommends containment actions' },
    { id: 'validation', label: 'SLA Validation',      icon: CheckCircle, content: aiData?.validation,                                                               desc: 'Verifies completeness & SLA' },
  ];

  const applyAgentResult = (phase: string, result: any, base: any) => {
    const updatedAiData = { ...base };
    const extra: any = {};
    if (phase === 'analysis' && result.analysis) {
      updatedAiData.summary = result.analysis.analysis_summary;
      updatedAiData.iocs = result.analysis.iocs;
      if (result.analysis.is_false_positive) extra.status = 'FALSE_POSITIVE';
    }
    if (phase === 'intel' && result.intel) {
      updatedAiData.intel = result.intel.intel_summary;
      extra.mitre_attack = JSON.stringify(result.intel.mitre_attack);
    }
    if (phase === 'knowledge' && result.knowledge) {
      extra.remediation_steps = result.knowledge.remediation_steps;
    }
    if (phase === 'correlation' && result.correlation) {
      updatedAiData.correlation = result.correlation.campaign_name;
    }
    if (phase === 'ticketing' && result.ticket) {
      updatedAiData.ticket = result.ticket;
      extra.email_sent = result.ticket.email_notification_sent ? 1 : 0;
    }
    if (phase === 'response' && result.responsePlan) {
      updatedAiData.response = result.responsePlan;
    }
    if (phase === 'validation' && result.validation) {
      updatedAiData.validation = result.validation.sla_status;
    }
    return { updatedAiData, extra };
  };

  const handleAgentRun = async (phase: string) => {
    if (runningPhase !== null || runningAll) return; // prevent double-trigger
    setRunningPhase(phase);
    // Snapshot aiData now — don't touch parent state until the agent finishes.
    // Calling onAction mid-run triggers a server PATCH → socket.io emit → Vite HMR
    // WebSocket interference on the same port → full page reload.
    const baseAiData = aiData || {};
    try {
      const state = {
        alert,
        recentAlerts: [],
        analysis: baseAiData,
        intel: baseAiData?.intel,
        knowledge: alert.remediation_steps,
        correlation: baseAiData?.correlation,
        ticket: baseAiData?.ticket,
        responsePlan: baseAiData?.response,
      };
      const result = await runAgentPhase(phase, state) as any;
      const { updatedAiData, extra } = applyAgentResult(phase, result, baseAiData);
      // Single onAction call only after the agent completes
      onAction(alert.id, {
        ...extra,
        ai_analysis: JSON.stringify(updatedAiData),
        status: extra.status || (alert.status === 'NEW' ? 'TRIAGED' : alert.status),
      });
    } catch (err) {
      console.error('[Agent run failed]', err);
    } finally {
      setRunningPhase(null);
    }
  };

  const handleRunAll = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (runningPhase !== null || runningAll) return;
    setRunningAll(true);
    let currentAiData = aiData || {};
    let cumulativeExtra: any = {};
    for (const agent of agentDefs) {
      if (agent.content) continue; // skip already-completed agents
      setRunningPhase(agent.id);
      try {
        const state = {
          alert,
          recentAlerts: [],
          analysis: currentAiData,
          intel: currentAiData?.intel,
          knowledge: cumulativeExtra.remediation_steps || alert.remediation_steps,
          correlation: currentAiData?.correlation,
          ticket: currentAiData?.ticket,
          responsePlan: currentAiData?.response,
        };
        const result = await runAgentPhase(agent.id, state) as any;
        const { updatedAiData, extra } = applyAgentResult(agent.id, result, currentAiData);
        currentAiData = updatedAiData;
        cumulativeExtra = { ...cumulativeExtra, ...extra };
      } catch (err) {
        console.error(`[Agent ${agent.id} failed]`, err);
      }
    }
    setRunningPhase(null);
    setRunningAll(false);
    // Single onAction call after all agents finish
    onAction(alert.id, {
      ...cumulativeExtra,
      ai_analysis: JSON.stringify(currentAiData),
      status: cumulativeExtra.status || 'TRIAGED',
    });
  };

  const completedCount = agentDefs.filter(a => a.content).length;

  return (
    <div className="flex flex-col h-full bg-[#f0f4f9] overflow-hidden">

      {/* Top bar */}
      <div className="bg-white border-b border-[#d1d9e6] px-6 py-4 flex items-start justify-between gap-4 shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className={`px-2.5 py-1 rounded-full text-[0.65rem] font-black uppercase tracking-wide border ${sevStyle[severity]}`}>
              {severity}
            </span>
            <span className={`px-2.5 py-1 rounded-full text-[0.65rem] font-black uppercase tracking-wide border ${
              alert.status === 'TRIAGED' ? 'bg-green-50 text-green-700 border-green-200' :
              alert.status === 'ANALYZING' ? 'bg-blue-50 text-blue-700 border-blue-200' :
              alert.status === 'FALSE_POSITIVE' ? 'bg-gray-50 text-gray-500 border-gray-200' :
              'bg-slate-50 text-slate-600 border-slate-200'
            }`}>{alert.status}</span>
            {alert.email_sent === 1 && (
              <span className="flex items-center gap-1 text-[0.65rem] font-bold text-green-600 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full uppercase">
                <Bell size={10} fill="currentColor" /> Email Sent
              </span>
            )}
          </div>
          <h2 className="text-[0.95rem] font-bold text-[#1a1a1b] mt-2 leading-snug">
            {alert.description}
          </h2>
          <div className="flex items-center gap-4 mt-1.5 text-[0.72rem] text-[#5f6368]">
            <span className="font-mono font-bold text-slate-500">#{alert.id.substring(0, 10).toUpperCase()}</span>
            {alert.source_ip && <span>SRC: <span className="font-mono font-bold text-slate-700">{alert.source_ip}</span></span>}
            <span>Host: <span className="font-mono font-bold text-slate-700">{alert.agent_name}</span></span>
            <span>{new Date(alert.timestamp).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowReport(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[0.75rem] font-bold transition-colors border border-slate-200"
          >
            <FileText size={14} />
            View Report
          </button>
          <button
            type="button"
            onClick={handleRunAll}
            disabled={isAnalyzing}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#004a99] hover:bg-[#003a7a] text-white text-[0.75rem] font-bold transition-colors disabled:opacity-60 shadow-sm"
          >
            {runningAll ? (
              <><div className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" /> Running Swarm...</>
            ) : (
              <><Activity size={14} /> Run All Agents</>
            )}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-white border-b border-[#d1d9e6] px-6 py-2 flex items-center gap-3 shrink-0">
        <span className="text-[0.65rem] font-black text-slate-400 uppercase tracking-widest shrink-0">Swarm Progress</span>
        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#004a99] rounded-full transition-all duration-700"
            style={{ width: `${(completedCount / agentDefs.length) * 100}%` }}
          />
        </div>
        <span className="text-[0.65rem] font-bold text-slate-500 shrink-0">{completedCount}/{agentDefs.length} agents</span>
      </div>

      {/* Main scrollable content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* Agent cards grid */}
        <div className="grid grid-cols-2 gap-3">
          {agentDefs.map((agent) => {
            const isRunningThis = runningPhase === agent.id;
            const isDone = !!agent.content;

            return (
              <div
                key={agent.id}
                className={`bg-white rounded-xl border transition-all ${
                  isRunningThis
                    ? 'border-[#004a99] ring-2 ring-[#004a99]/20'
                    : isDone
                    ? 'border-green-200'
                    : 'border-[#d1d9e6]'
                }`}
              >
                {/* Card header */}
                <div className={`flex items-center justify-between px-4 py-3 rounded-t-xl border-b ${
                  isRunningThis ? 'bg-blue-50 border-blue-100' :
                  isDone ? 'bg-green-50 border-green-100' :
                  'bg-slate-50 border-slate-100'
                }`}>
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                      isRunningThis ? 'bg-[#004a99]' : isDone ? 'bg-green-600' : 'bg-slate-200'
                    }`}>
                      {isRunningThis
                        ? <div className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        : <agent.icon size={14} className={isDone ? 'text-white' : 'text-slate-500'} />
                      }
                    </div>
                    <div>
                      <p className="text-[0.8rem] font-bold text-slate-800">{agent.label}</p>
                      <p className="text-[0.65rem] text-slate-400">{agent.desc}</p>
                    </div>
                  </div>
                  {isDone ? (
                    <span className="flex items-center gap-1 text-[0.6rem] font-black text-green-600 bg-white border border-green-200 px-2 py-1 rounded-full uppercase tracking-wide">
                      <CheckCircle size={9} /> Done
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAgentRun(agent.id); }}
                      disabled={isAnalyzing}
                      className="flex items-center gap-1 text-[0.65rem] font-black bg-[#004a99] text-white px-3 py-1.5 rounded-full hover:bg-[#003a7a] transition-colors disabled:opacity-50 uppercase tracking-wide shadow-sm"
                    >
                      {isRunningThis ? 'Running...' : <><ChevronRight size={10} /> Run</>}
                    </button>
                  )}
                </div>
                {/* Card body */}
                <div className="px-4 py-3 min-h-[56px]">
                  {isRunningThis ? (
                    <div className="flex items-center gap-2 text-[0.75rem] text-blue-600 italic">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                      Running agent via OpenRouter...
                    </div>
                  ) : isDone ? (
                    <p className="text-[0.78rem] text-slate-600 leading-relaxed line-clamp-3">{agent.content}</p>
                  ) : (
                    <p className="text-[0.75rem] text-slate-400 italic">Waiting — click Run to execute this agent.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* MITRE tags */}
        {mitreTags.length > 0 && (
          <div className="bg-white rounded-xl border border-[#d1d9e6] p-4">
            <p className="text-[0.65rem] font-black text-slate-400 uppercase tracking-widest mb-3">MITRE ATT&CK</p>
            <div className="flex flex-wrap gap-2">
              {mitreTags.map((tag: string) => (
                <span key={tag} className="px-3 py-1.5 bg-[#1a1a2e] text-[#e94560] border border-[#e94560]/30 rounded-lg text-[0.7rem] font-black font-mono tracking-wide">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Raw log */}
        <div className="bg-white rounded-xl border border-[#d1d9e6] p-4">
          <p className="text-[0.65rem] font-black text-slate-400 uppercase tracking-widest mb-3">Raw Wazuh Log</p>
          <pre className="text-[0.68rem] bg-slate-950 text-emerald-400 p-4 rounded-xl overflow-x-auto font-mono leading-relaxed">
            {alert.full_log || 'No log data.'}
          </pre>
        </div>
      </div>

      {/* Action footer */}
      <div className="bg-white border-t border-[#d1d9e6] px-6 py-3.5 flex items-center justify-between shrink-0">
        <div className="text-[0.72rem] text-slate-500">
          {aiData?.response?.actions?.length
            ? <span className="font-semibold text-slate-700">Recommended: {aiData.response.actions[0]?.type?.replace('_', ' ')} → <span className="font-mono">{aiData.response.actions[0]?.target}</span></span>
            : 'Run agents to generate recommended actions.'
          }
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onAction(alert.id, { status: 'FALSE_POSITIVE' })}
            className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-semibold text-[0.8rem] bg-white hover:bg-slate-50 transition-colors"
          >
            False Positive
          </button>
          <button
            type="button"
            onClick={() => onAction(alert.id, { status: 'ESCALATED' })}
            className="px-4 py-2 rounded-lg border border-[#004a99] text-[#004a99] font-semibold text-[0.8rem] bg-white hover:bg-blue-50 transition-colors"
          >
            Escalate
          </button>
          <button
            type="button"
            onClick={() => onAction(alert.id, { status: 'CLOSED' })}
            className="px-4 py-2 rounded-lg bg-[#004a99] text-white font-bold text-[0.8rem] hover:bg-[#003a7a] transition-colors shadow-sm"
          >
            Close Incident
          </button>
        </div>
      </div>

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

const Dashboard = ({ alerts, onAlertClick }: { alerts: Alert[], onAlertClick: (a: Alert) => void }) => {
  const stats = [
    { label: 'Critical Alerts', value: alerts.filter(a => a.severity >= 12).length, icon: AlertTriangle, trend: 12, color: '#d93025' },
    { label: 'Active Incidents', value: '24', icon: Shield, trend: 2, color: '#004a99' },
    { label: 'Mean Time to Triage', value: '1.4m', icon: Clock, trend: -15, color: '#1e8e3e' },
    { label: 'AI Automation Rate', value: '88%', icon: Activity, trend: 5, color: '#1a73e8' },
  ];

  return (
    <div className="p-6 flex flex-col gap-6 h-full overflow-y-auto">
      <div className="grid grid-cols-4 gap-5">
        {stats.map((stat, i) => <StatCard key={i} {...stat} />)}
      </div>

      <div className="grid grid-cols-3 gap-5 flex-1 min-h-0">
        <div className="col-span-2 bg-white border border-[#d1d9e6] rounded-lg flex flex-col overflow-hidden shadow-sm">
          <div className="p-4 border-b border-[#d1d9e6] flex justify-between items-center bg-slate-50/50">
            <h3 className="text-[0.9rem] font-bold text-[#004a99] flex items-center gap-2">
              <Activity className="w-4 h-4" />
              LIVE ALERT STREAM (WAZUH)
            </h3>
            <span className="text-[0.7rem] text-[#5f6368] font-mono">REFRESH: 5S</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {alerts.length > 0 ? (
              alerts.slice(0, 10).map(alert => (
                <AlertRow key={alert.id} alert={alert} onClick={() => onAlertClick(alert)} />
              ))
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3 opacity-50">
                <Activity className="w-12 h-12 animate-pulse" />
                <p className="text-sm font-medium">Waiting for incoming alerts...</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-[#d1d9e6] rounded-lg flex flex-col shadow-sm">
          <div className="p-4 border-b border-[#d1d9e6] bg-slate-50/50">
            <h3 className="text-[0.9rem] font-bold text-[#004a99]">AI AGENT SWARM STATUS</h3>
          </div>
          <div className="p-4 flex flex-col gap-4">
            {[
              { name: 'Alert Analysis Agent', status: 'Online', load: '12%' },
              { name: 'Threat Intel Agent', status: 'Online', load: '45%' },
              { name: 'RAG Knowledge Agent', status: 'Online', load: '8%' },
              { name: 'Correlation Agent', status: 'Analyzing', load: '92%' },
              { name: 'Response Agent', status: 'Standby', load: '0%' },
            ].map((agent, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex justify-between text-[0.75rem]">
                  <span className="font-semibold text-[#1a1a1b]">{agent.name}</span>
                  <span className={agent.status === 'Online' ? 'text-[#1e8e3e]' : 'text-[#1a73e8]'}>{agent.status}</span>
                </div>
                <div className="h-1.5 w-full bg-[#f0f0f0] rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-1000 ${parseInt(agent.load) > 80 ? 'bg-[#d93025]' : 'bg-[#004a99]'}`}
                    style={{ width: agent.load }}
                  />
                </div>
              </div>
            ))}
            
            <div className="mt-4 p-4 bg-[#f0f7ff] rounded-lg border border-[#d1d9e6]">
              <div className="text-[0.8rem] font-bold text-[#004a99] mb-1">System Health</div>
              <div className="text-[0.7rem] text-[#5f6368] leading-relaxed">
                All 7 agents are operational. Latency is within SLA (avg 1.2s). Wazuh integration active.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const LoginPage = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else login(data.token, data.user);
    } catch (err) {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f7fa] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-lg shadow-xl border border-[#d1d9e6] overflow-hidden"
      >
        <div className="bg-[#004a99] p-8 text-white text-center">
          <div className="bg-white/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-white/20">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-[1.4rem] font-bold tracking-tight">AEGIS SOC PLATFORM</h1>
          <p className="text-blue-100/70 text-[0.85rem] mt-1 uppercase tracking-widest font-semibold">Secure Access Gateway</p>
        </div>
        
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {error && (
            <div className="bg-red-50 text-[#d93025] p-4 rounded border border-red-100 text-[0.85rem] font-semibold">
              {error}
            </div>
          )}
          
          <div className="space-y-1.5">
            <label className="text-[0.7rem] font-bold text-[#5f6368] uppercase tracking-wider">Operator ID</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5f6368]" />
              <input 
                type="text" 
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-[#d1d9e6] rounded outline-none focus:border-[#004a99] transition-colors text-[0.9rem]"
                placeholder="Enter username"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[0.7rem] font-bold text-[#5f6368] uppercase tracking-wider">Access Key</label>
            <div className="relative">
              <Terminal className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5f6368]" />
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-[#d1d9e6] rounded outline-none focus:border-[#004a99] transition-colors text-[0.9rem]"
                placeholder="Enter password"
              />
            </div>
          </div>

          <button 
            disabled={loading}
            className="w-full bg-[#004a99] text-white font-bold py-4 rounded hover:bg-[#003366] transition-all shadow-md disabled:opacity-50 text-[0.9rem] uppercase tracking-widest"
          >
            {loading ? 'Verifying Credentials...' : 'Initialize Session'}
          </button>
          
          <div className="text-center space-y-2">
            <p className="text-[0.7rem] text-[#5f6368] font-semibold">
              SYSTEM ID: SOC-ALPHA-01 • REGION: EU-WEST-2
            </p>
            <p className="text-[0.65rem] text-[#5f6368] opacity-50">
              Unauthorized access is strictly prohibited and monitored.
            </p>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const socToken = localStorage.getItem('soc_token');
    if (!socToken) return;

    fetch('/api/alerts', {
      headers: { Authorization: `Bearer ${socToken}` }
    }).then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        setAlerts(data);
        // Trigger analysis for any NEW alerts found on load
        data.forEach((alert: any) => {
          if (alert.status === 'NEW') {
            const recent = data.filter((a: any) => a.id !== alert.id).slice(0, 50);
            orchestrateAnalysis(alert, recent, (update) => {
              setAlerts(prev => Array.isArray(prev) ? prev.map(a => a.id === alert.id ? { ...a, ...update } : a) : prev);
              fetch(`/api/alerts/${alert.id}`, {
                method: 'PATCH',
                headers: { 
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${socToken}`
                },
                body: JSON.stringify(update)
              });
            });
          }
        });
      });

    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('new_alert', (data) => {
      // Fetch the full alert to analyze it
      fetch('/api/alerts', {
        headers: { Authorization: `Bearer ${socToken}` }
      }).then(res => res.json())
        .then(dataList => {
          if (!Array.isArray(dataList)) return;
          setAlerts(dataList);
          const newAlert = dataList.find((a: any) => a.id === data.id);
          if (newAlert && newAlert.status === 'NEW') {
            const recent = dataList.filter((a: any) => a.id !== newAlert.id).slice(0, 50);
            orchestrateAnalysis(newAlert, recent, (update) => {
              // Update local state
              setAlerts(prev => Array.isArray(prev) ? prev.map(a => a.id === newAlert.id ? { ...a, ...update } : a) : prev);
              // Sync with server
              fetch(`/api/alerts/${newAlert.id}`, {
                method: 'PATCH',
                headers: { 
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${socToken}`
                },
                body: JSON.stringify(update)
              });
            });
          }
        });
    });

    newSocket.on('alert_updated', (data) => {
      setAlerts(prev => Array.isArray(prev) ? prev.map(a => a.id === data.id ? { ...a, ...data } : a) : prev);
      setSelectedAlert(prev => prev?.id === data.id ? { ...prev, ...data } : prev);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  const handleAlertAction = (id: string, update: any) => {
    const socToken = localStorage.getItem('soc_token');
    // Update local state
    setAlerts(prev => Array.isArray(prev) ? prev.map(a => a.id === id ? { ...a, ...update } : a) : prev);
    // Update selected alert if it matches
    setSelectedAlert(prev => prev?.id === id ? { ...prev, ...update } : prev);
    // Sync with server
    fetch(`/api/alerts/${id}`, {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${socToken}`
      },
      body: JSON.stringify(update)
    }).catch(err => console.error('Failed to sync alert action:', err));
  };

  return (
    <AuthProvider>
      <AuthConsumer 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        alerts={alerts}
        selectedAlert={selectedAlert}
        setSelectedAlert={setSelectedAlert}
        onAlertAction={handleAlertAction}
      />
    </AuthProvider>
  );
}

const Reports = ({ alerts }: { alerts: Alert[] }) => {
  const triaged = alerts.filter(a => a.status === 'TRIAGED').length;
  const closed = alerts.filter(a => a.status === 'CLOSED').length;
  const falsePositives = alerts.filter(a => a.status === 'FALSE_POSITIVE').length;
  
  const severityStats = {
    critical: alerts.filter(a => a.severity >= 12).length,
    high: alerts.filter(a => a.severity >= 7 && a.severity < 12).length,
    medium: alerts.filter(a => a.severity < 7).length,
  };

  // Group by MITRE techniques
  const mitreMapping: Record<string, number> = {};
  alerts.forEach(a => {
    if (a.mitre_attack) {
      try {
        const tags = Array.isArray(a.mitre_attack) ? a.mitre_attack : JSON.parse(a.mitre_attack as any);
        tags.forEach((tag: string) => {
          mitreMapping[tag] = (mitreMapping[tag] || 0) + 1;
        });
      } catch (e) {}
    }
  });

  const topTechniques = Object.entries(mitreMapping)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 overflow-y-auto h-full">
      <div className="flex justify-between items-end pb-4 border-b">
        <div>
          <h2 className="text-2xl font-bold text-[#004a99]">Aegis Intelligence Reports</h2>
          <p className="text-sm text-[#5f6368]">Consolidated SOC Performance & Threat Landscape</p>
        </div>
        <div className="text-right">
          <p className="text-[0.7rem] font-bold text-[#5f6368] uppercase tracking-wider">Report Internal ID</p>
          <p className="text-xs font-mono text-[#004a99]">REP-ALPHA-{new Date().toISOString().split('T')[0]}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="bg-white p-6 border rounded-lg shadow-sm space-y-4">
          <h3 className="text-[0.85rem] font-bold text-[#5f6368] uppercase">Analysis Throughput</h3>
          <div className="flex items-end gap-2">
            <span className="text-4xl font-bold text-[#004a99]">{alerts.length}</span>
            <span className="text-sm text-[#1e8e3e] mb-1 font-bold">+14% vs Last 24h</span>
          </div>
          <div className="space-y-2 pt-2">
            <div className="flex justify-between text-xs">
              <span>Triaged (Ready)</span>
              <span className="font-bold">{triaged}</span>
            </div>
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#004a99]" style={{ width: `${(triaged/alerts.length)*100}%` }} />
            </div>
            <div className="flex justify-between text-xs pt-1">
              <span>False Positives</span>
              <span className="font-bold">{falsePositives}</span>
            </div>
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-slate-400" style={{ width: `${(falsePositives/alerts.length)*100}%` }} />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 border rounded-lg shadow-sm space-y-4">
          <h3 className="text-[0.85rem] font-bold text-[#5f6368] uppercase">Severity Distribution</h3>
          <div className="pt-2 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-[#d93025]" />
              <div className="flex-1 text-sm">Critical Severity</div>
              <div className="font-bold text-sm">{severityStats.critical}</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-[#f29900]" />
              <div className="flex-1 text-sm">High Severity</div>
              <div className="font-bold text-sm">{severityStats.high}</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-[#1a73e8]" />
              <div className="flex-1 text-sm">Informational/Med</div>
              <div className="font-bold text-sm">{severityStats.medium}</div>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 border rounded-lg shadow-sm space-y-4">
          <h3 className="text-[0.85rem] font-bold text-[#5f6368] uppercase">MITRE Heatmap (Top 5)</h3>
          <div className="pt-2 space-y-3">
            {topTechniques.length > 0 ? topTechniques.map(([tech, count]) => (
              <div key={tech} className="space-y-1">
                <div className="flex justify-between text-[0.7rem] font-bold">
                  <span className="truncate max-w-[150px]">{tech}</span>
                  <span>{count} Instances</span>
                </div>
                <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-[#004a99]" style={{ width: `${(count/alerts.length)*100}%` }} />
                </div>
              </div>
            )) : (
              <p className="text-center text-slate-400 text-xs py-10">No MITRE data available</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
          <h3 className="text-[0.85rem] font-bold text-[#004a99]">Swarm Orchestration Efficiency</h3>
          <span className="text-xs bg-[#e8f0fe] text-[#1967d2] px-2 py-0.5 rounded font-bold">Live Monitoring</span>
        </div>
        <div className="p-8 flex items-center justify-around h-[200px]">
          {[
            { label: 'Avg Analysis Time', val: '12.4s', unit: 'per alert' },
            { label: 'Agent Consensus', val: '98.2%', unit: 'confidence' },
            { label: 'Auto-Containment', val: '42%', unit: 'success rate' },
            { label: 'SLA Adherence', val: '99.9%', unit: 'validation target' }
          ].map((m, i) => (
            <div key={i} className="text-center">
              <div className="text-xs text-[#5f6368] font-bold mb-1 uppercase">{m.label}</div>
              <div className="text-3xl font-bold text-[#004a99]">{m.val}</div>
              <div className="text-[0.65rem] text-slate-400 mt-1 uppercase font-semibold">{m.unit}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const AuthConsumer = ({ activeTab, setActiveTab, alerts, selectedAlert, setSelectedAlert, onAlertAction }: any) => {
  const { user } = useAuth();

  if (!user) return <LoginPage />;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
        <main className="flex-1 overflow-hidden bg-[#f4f7fa]">
          {activeTab === 'dashboard' && <Dashboard alerts={alerts} onAlertClick={setSelectedAlert} />}
          {activeTab === 'alerts' && (
            <div className="flex h-full overflow-hidden">
              <section className="w-[320px] border-r border-[#d1d9e6] bg-white flex flex-col overflow-hidden">
                <div className="p-[15px] border-b border-[#d1d9e6] font-semibold text-[0.9rem] flex justify-between items-center">
                  <span>WAZUH ALERTS ({alerts.length})</span>
                  <span className="text-[0.7rem] text-[#004a99] cursor-pointer hover:underline">Filter</span>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {alerts.length > 0 ? (
                    alerts.map(alert => (
                      <AlertRow 
                        key={alert.id} 
                        alert={alert} 
                        onClick={() => setSelectedAlert(alert)} 
                        isSelected={selectedAlert?.id === alert.id}
                      />
                    ))
                  ) : (
                    <div className="p-10 text-center text-slate-400 text-sm">No alerts found.</div>
                  )}
                </div>
              </section>
              <section className="flex-1 overflow-hidden">
                {selectedAlert ? (
                  <AlertDetail 
                    alert={selectedAlert} 
                    onClose={() => setSelectedAlert(null)} 
                    onAction={onAlertAction}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-400 flex-col gap-4">
                    <Shield className="w-16 h-16 opacity-10" />
                    <p className="font-semibold text-sm">Select an alert from the queue to start investigation</p>
                  </div>
                )}
              </section>
            </div>
          )}
          {activeTab === 'incidents' && (
            <div className="p-8 max-w-6xl mx-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-[#004a99]">Active Investigations</h2>
                <button className="bg-[#004a99] text-white px-4 py-2 rounded font-bold text-sm">New Incident</button>
              </div>
              <div className="bg-white border border-[#d1d9e6] rounded-lg overflow-hidden shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-[#d1d9e6] text-[#5f6368] font-bold uppercase text-[0.7rem] tracking-wider">
                    <tr>
                      <th className="p-4">ID</th>
                      <th className="p-4">Title</th>
                      <th className="p-4">Severity</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Assigned</th>
                      <th className="p-4">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f0f0]">
                    <tr className="hover:bg-slate-50 cursor-pointer">
                      <td className="p-4 font-mono text-[#004a99]">INC-8291</td>
                      <td className="p-4 font-semibold">Brute Force Attempt - Web Server 01</td>
                      <td className="p-4"><span className="bg-red-50 text-red-600 px-2 py-1 rounded text-[10px] font-bold uppercase">Critical</span></td>
                      <td className="p-4"><span className="bg-blue-50 text-blue-600 px-2 py-1 rounded text-[10px] font-bold uppercase">Open</span></td>
                      <td className="p-4">SOC Analyst Alpha</td>
                      <td className="p-4 text-[#5f6368]">2h ago</td>
                    </tr>
                    <tr className="hover:bg-slate-50 cursor-pointer">
                      <td className="p-4 font-mono text-[#004a99]">INC-8288</td>
                      <td className="p-4 font-semibold">Unauthorized File Access - HR Share</td>
                      <td className="p-4"><span className="bg-orange-50 text-orange-600 px-2 py-1 rounded text-[10px] font-bold uppercase">High</span></td>
                      <td className="p-4"><span className="bg-orange-50 text-orange-600 px-2 py-1 rounded text-[10px] font-bold uppercase">In Progress</span></td>
                      <td className="p-4">SOC Analyst Beta</td>
                      <td className="p-4 text-[#5f6368]">5h ago</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {activeTab === 'agents' && (
            <div className="p-8 max-w-6xl mx-auto">
              <h2 className="text-2xl font-bold text-[#004a99] mb-6">AI Agent Swarm Configuration</h2>
              <div className="grid grid-cols-2 gap-6">
                {[
                  { name: 'Alert Analysis Agent', desc: 'Interprets Wazuh alerts, extracts IOCs, validates severity.', model: 'Gemini 3 Flash' },
                  { name: 'Threat Intel Agent', desc: 'Enriches IOCs, maps to MITRE ATT&CK, assesses risk.', model: 'Gemini 3 Flash' },
                  { name: 'RAG Knowledge Agent', desc: 'Suggests remediation steps and references playbooks.', model: 'Gemini 3 Flash' },
                  { name: 'Correlation Agent', desc: 'Detects patterns across alerts and identifies campaigns.', model: 'Gemini 3 Flash' },
                  { name: 'Ticketing Agent', desc: 'Generates structured incident reports for GLPI.', model: 'Gemini 3 Flash' },
                  { name: 'Response Agent', desc: 'Recommends containment actions (IP block, user disable).', model: 'Gemini 3 Flash' },
                  { name: 'Validation Agent', desc: 'Verifies completeness and SLA compliance.', model: 'Gemini 3 Flash' },
                ].map((agent, i) => (
                  <div key={i} className="bg-white border border-[#d1d9e6] rounded-lg p-5 shadow-sm">
                    <div className="flex justify-between items-start mb-3">
                      <h3 className="font-bold text-[#004a99]">{agent.name}</h3>
                      <span className="bg-green-50 text-green-600 px-2 py-1 rounded text-[10px] font-bold uppercase">Active</span>
                    </div>
                    <p className="text-sm text-[#5f6368] mb-4">{agent.desc}</p>
                    <div className="flex justify-between items-center pt-4 border-t border-[#f0f0f0]">
                      <span className="text-xs font-mono text-slate-400">{agent.model}</span>
                      <button className="text-[#004a99] text-xs font-bold hover:underline">Configure Prompt</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {activeTab === 'reports' && <Reports alerts={alerts} />}
          {activeTab === 'settings' && (
            <div className="flex items-center justify-center h-full text-slate-400 flex-col gap-4">
              <Terminal className="w-12 h-12 opacity-20" />
              <p className="font-medium">Module "settings" is currently under development.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
