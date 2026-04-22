import React, { createContext, useContext, useState, useEffect } from 'react';
import { Shield, AlertTriangle, Activity, FileText, Settings, LogOut, Search, Bell, User, CheckCircle, XCircle, Clock, ChevronRight, BarChart3, Terminal, Filter, Plus, X, UserPlus, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { getAgentModelConfig, orchestrateAnalysis, runAgentPhase, updateAgentModel, getAlertRuns, saveAlertRun, type AgentModelConfig, type AgentPhase } from './services/aiService';
import { User as UserType, Alert, AgentRun, Incident, Stats, UserRole } from './types';

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
    iocs.domains?.length ? `**Domains:** ${iocs.domains.join(', ')}` : '',
    iocs.processes?.length ? `**Processes:** ${iocs.processes.join(', ')}` : '',
    iocs.files?.length ? `**Files:** ${iocs.files.join(', ')}` : '',
    iocs.hashes?.length ? `**Hashes:** \`${iocs.hashes.join('`  `')}\`` : '',
    iocs.ports?.length ? `**Ports:** ${iocs.ports.join(', ')}` : '',
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
              const svColor: Record<string, string> = { CRITICAL: 'bg-red-100 text-red-800 border-red-300', HIGH: 'bg-orange-100 text-orange-800 border-orange-300', MEDIUM: 'bg-blue-100 text-blue-800 border-blue-300', LOW: 'bg-green-100 text-green-800 border-green-300' };
              const raColor: Record<string, string> = { IGNORE: 'bg-slate-100 text-slate-600 border-slate-300', MONITOR: 'bg-blue-100 text-blue-700 border-blue-300', INVESTIGATE: 'bg-cyan-100 text-cyan-700 border-cyan-300', ESCALATE: 'bg-amber-100 text-amber-700 border-amber-300', CONTAIN: 'bg-orange-100 text-orange-700 border-orange-300', BLOCK: 'bg-red-100 text-red-700 border-red-300' };
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
                      <div className="flex justify-between text-[0.65rem] text-slate-500 font-semibold">
                        <span>Risk Score</span><span>{rs}/100</span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${rsColor}`} style={{ width: `${rs}%` }} />
                      </div>
                    </div>
                  )}
                  {isFP && fpReason && (
                    <p className="text-[0.72rem] text-slate-500 italic">{fpReason}</p>
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
                <span key={h} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 border border-zinc-300 rounded-lg text-zinc-700 font-mono text-[0.75rem] font-bold" title={h}>
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

const buildInitialHistory = (aiData: any): Record<string, any[]> => {
  const pd = aiData?.phaseData || {};
  const h: Record<string, any[]> = {};
  if (pd.analysis)    h.analysis    = [pd.analysis];
  if (pd.intel)       h.intel       = [pd.intel];
  if (pd.knowledge)   h.knowledge   = [pd.knowledge];
  if (pd.correlation) h.correlation = [pd.correlation];
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
    case 'ticketing':   return result.ticket;
    case 'response':    return result.responsePlan;
    case 'validation':  return result.validation;
    default:            return null;
  }
};

const AlertDetail = ({ alert, onClose, onAction }: { alert: Alert, onClose: () => void, onAction: (id: string, update: any) => void }) => {
  const [showReport, setShowReport] = useState(false);
  const [runningPhase, setRunningPhase] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [isRerunning, setIsRerunning] = useState(false);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);

  // Per-agent run history: phase → array of raw phase results (newest = last)
  const [agentRunHistory, setAgentRunHistory] = useState<Record<string, any[]>>(() => {
    let d: any = null;
    try { d = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch (e) {}
    return buildInitialHistory(d);
  });
  const [agentRunIndex, setAgentRunIndex] = useState<Record<string, number>>({});

  useEffect(() => {
    getAlertRuns(alert.id).then(setRuns).catch(() => {});
  }, [alert.id]);

  // Reset per-agent history when a different alert is opened
  useEffect(() => {
    let d: any = null;
    try { d = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch (e) {}
    setAgentRunHistory(buildInitialHistory(d));
    setAgentRunIndex({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert.id]);

  let aiData: any = null;
  let mitreTags: string[] = [];
  try { aiData = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null; } catch (e) {}
  try { mitreTags = alert.mitre_attack ? JSON.parse(alert.mitre_attack as any) : []; } catch (e) {}

  const isAnalyzing = runningPhase !== null || runningAll;

  const severity = alert.severity >= 13 ? 'CRITICAL' : alert.severity >= 10 ? 'HIGH' : alert.severity >= 7 ? 'MEDIUM' : 'LOW';
  const sevStyle: Record<string, string> = {
    CRITICAL: 'bg-red-50 text-red-700 border-red-200',
    HIGH: 'bg-orange-50 text-orange-700 border-orange-200',
    MEDIUM: 'bg-blue-50 text-blue-700 border-blue-200',
    LOW: 'bg-green-50 text-green-700 border-green-200',
  };

  const agentDefs = [
    { id: 'analysis',    label: 'Alert Triage',    icon: Search,      desc: 'Extracts IOCs and validates severity',  getContent: (d: any) => d?.analysis_summary },
    { id: 'intel',       label: 'Threat Intel',     icon: Shield,      desc: 'MITRE ATT&CK mapping & reputation',     getContent: (d: any) => d?.intel_summary },
    { id: 'knowledge',   label: 'RAG Playbook',     icon: Clock,       desc: 'Retrieves remediation playbooks',       getContent: (d: any) => d?.remediation_steps },
    { id: 'correlation', label: 'Correlation',      icon: Activity,    desc: 'Detects multi-stage campaigns',         getContent: (d: any) => d?.campaign_name },
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
    if (confidence === null) return { label: 'Unknown', cls: 'bg-slate-100 text-slate-500 border-slate-200' };
    if (confidence >= 0.8) return { label: 'High', cls: 'bg-green-50 text-green-700 border-green-200' };
    if (confidence >= 0.6) return { label: 'Medium', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    return { label: 'Low', cls: 'bg-red-50 text-red-700 border-red-200' };
  };

  const applyAgentResult = (phase: string, result: any, base: any) => {
    const updatedAiData = {
      ...base,
      phaseData: { ...(base?.phaseData || {}) },
    };
    const extra: any = {};
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
    if (runningPhase !== null || runningAll) return;
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
      setRunError(err?.message || `Failed to run the ${phase} agent.`);
    } finally {
      setRunningPhase(null);
    }
  };

  const handleRunAll = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (runningPhase !== null || runningAll) return;
    setRunningAll(true);
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
        setRunError(err?.message || `Failed to run the ${agent.label} agent.`);
        break;
      }
    }
    setRunningPhase(null);
    setRunningAll(false);

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
    try {
      await orchestrateAnalysis(alert, [], (update) => onAction(alert.id, update));
      const updated = await getAlertRuns(alert.id);
      setRuns(updated);
    } catch (err: any) {
      setRunError(err?.message || 'Rerun failed.');
    } finally {
      setIsRerunning(false);
    }
  };

  const handleSaveSnapshot = async () => {
    if (!aiData || isSavingSnapshot) return;
    setIsSavingSnapshot(true);
    try {
      await saveAlertRun(alert.id, {
        ai_analysis: alert.ai_analysis,
        mitre_attack: Array.isArray(alert.mitre_attack)
          ? JSON.stringify(alert.mitre_attack)
          : (alert.mitre_attack as any),
        remediation_steps: alert.remediation_steps,
        status: alert.status,
      });
      const updated = await getAlertRuns(alert.id);
      setRuns(updated);
      setShowHistory(true);
    } catch (err: any) {
      setRunError(err?.message || 'Failed to save snapshot.');
    } finally {
      setIsSavingSnapshot(false);
    }
  };

  const completedCount = agentDefs.filter(a => (agentRunHistory[a.id]?.length || 0) > 0).length;

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
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => setShowReport(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[0.75rem] font-bold transition-colors border border-slate-200"
          >
            <FileText size={14} />
            Report
          </button>
          <button
            type="button"
            onClick={() => { setShowHistory(h => !h); if (!showHistory) getAlertRuns(alert.id).then(setRuns).catch(() => {}); }}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[0.75rem] font-bold transition-colors border ${showHistory ? 'bg-[#004a99] text-white border-[#004a99]' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'}`}
          >
            <Clock size={14} />
            History {runs.length > 0 ? `(${runs.length})` : ''}
          </button>
          {aiData && (
            <button
              type="button"
              onClick={handleSaveSnapshot}
              disabled={isSavingSnapshot || isAnalyzing}
              title="Save current agent results as a snapshot for later comparison"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[0.75rem] font-bold transition-colors border border-slate-200 disabled:opacity-50"
            >
              {isSavingSnapshot ? <div className="w-3 h-3 rounded-full border-2 border-slate-400/40 border-t-slate-600 animate-spin" /> : <Plus size={14} />}
              Save Snapshot
            </button>
          )}
          <button
            type="button"
            onClick={handleRerunFresh}
            disabled={isAnalyzing || isRerunning}
            title="Re-run all 7 agents from scratch and save to history"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[0.75rem] font-bold transition-colors border border-slate-200 disabled:opacity-50"
          >
            {isRerunning ? (
              <><div className="w-3 h-3 rounded-full border-2 border-slate-400/40 border-t-slate-600 animate-spin" /> Rerunning...</>
            ) : (
              <><Activity size={14} /> Rerun All</>
            )}
          </button>
          <button
            type="button"
            onClick={handleRunAll}
            disabled={isAnalyzing || isRerunning}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#004a99] hover:bg-[#003a7a] text-white text-[0.75rem] font-bold transition-colors disabled:opacity-60 shadow-sm"
          >
            {runningAll ? (
              <><div className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" /> Running Swarm...</>
            ) : (
              <><Activity size={14} /> Run Agents</>
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

      {runError && (
        <div className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[0.75rem] text-red-700">
          {runError}
        </div>
      )}

      {/* Main scrollable content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* Run History Panel */}
        {showHistory && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[0.65rem] font-black text-slate-400 uppercase tracking-widest">
                Run History — {runs.length} saved run{runs.length !== 1 ? 's' : ''}
              </p>
              <button type="button" onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            </div>
            {runs.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#d1d9e6] p-6 text-center text-[0.8rem] text-slate-400">
                No saved runs yet. Use <span className="font-bold text-slate-600">Rerun All</span> to run all agents fresh, or <span className="font-bold text-slate-600">Save Snapshot</span> to record the current state.
              </div>
            ) : (
              runs.map((run) => {
                let runAiData: any = null;
                let runMitre: string[] = [];
                try { runAiData = run.ai_analysis ? JSON.parse(run.ai_analysis) : null; } catch (e) {}
                try { runMitre = run.mitre_attack ? JSON.parse(run.mitre_attack) : []; } catch (e) {}
                const runPhaseData = runAiData?.phaseData || {};
                const agentScores = ['analysis','intel','knowledge','correlation','ticketing','response','validation'].map(p => {
                  const raw = p === 'ticketing' ? runPhaseData?.ticket?.confidence : runPhaseData?.[p]?.confidence;
                  return typeof raw === 'number' ? raw : null;
                }).filter((v): v is number => v !== null);
                const avgConf = agentScores.length ? Math.round(agentScores.reduce((a, b) => a + b, 0) / agentScores.length * 100) : null;
                const completedAgents = agentScores.length;
                const isFP = runPhaseData?.analysis?.is_false_positive;
                const isExpanded = expandedRunId === run.id;

                return (
                  <div key={run.id} className="bg-white rounded-xl border border-[#d1d9e6] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[0.72rem] font-mono text-slate-500">
                          {new Date(run.run_at).toLocaleString()}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full border text-[0.6rem] font-black uppercase tracking-wide ${
                          run.status === 'TRIAGED' ? 'bg-green-50 text-green-700 border-green-200' :
                          run.status === 'FALSE_POSITIVE' ? 'bg-slate-100 text-slate-500 border-slate-200' :
                          'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>{run.status || 'TRIAGED'}</span>
                        {isFP !== undefined && (
                          <span className={`px-2 py-0.5 rounded-full border text-[0.6rem] font-black uppercase tracking-wide ${isFP ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                            FP: {isFP ? 'YES' : 'No'}
                          </span>
                        )}
                        {avgConf !== null && (
                          <span className={`px-2 py-0.5 rounded-full border text-[0.6rem] font-black uppercase tracking-wide ${avgConf >= 80 ? 'bg-green-50 text-green-700 border-green-200' : avgConf >= 60 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                            Avg Conf: {avgConf}%
                          </span>
                        )}
                        <span className="text-[0.65rem] text-slate-400">{completedAgents}/7 agents</span>
                      </div>
                      <ChevronRight size={14} className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </button>

                    {isExpanded && (
                      <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                        {runAiData?.summary && (
                          <div>
                            <p className="text-[0.6rem] font-black text-slate-400 uppercase tracking-widest mb-1">Analysis Summary</p>
                            <p className="text-[0.78rem] text-slate-700 leading-relaxed">{runAiData.summary}</p>
                          </div>
                        )}
                        {runMitre.length > 0 && (
                          <div>
                            <p className="text-[0.6rem] font-black text-slate-400 uppercase tracking-widest mb-1.5">MITRE ATT&CK</p>
                            <div className="flex flex-wrap gap-1.5">
                              {runMitre.map((tag: string) => (
                                <span key={tag} className="px-2 py-1 bg-[#1a1a2e] text-[#e94560] border border-[#e94560]/30 rounded text-[0.65rem] font-black font-mono">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Per-agent confidence row */}
                        <div>
                          <p className="text-[0.6rem] font-black text-slate-400 uppercase tracking-widest mb-2">Agent Confidence</p>
                          <div className="grid grid-cols-7 gap-1">
                            {['analysis','intel','knowledge','correlation','ticketing','response','validation'].map((p) => {
                              const raw = p === 'ticketing' ? runPhaseData?.ticket?.confidence : runPhaseData?.[p]?.confidence;
                              const pct = typeof raw === 'number' ? Math.round(raw * 100) : null;
                              return (
                                <div key={p} className="flex flex-col items-center gap-1">
                                  <div className="h-8 w-full bg-slate-100 rounded-sm overflow-hidden flex flex-col-reverse">
                                    <div
                                      className={`w-full transition-all ${pct === null ? 'h-0' : pct >= 80 ? 'bg-green-400' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
                                      style={{ height: pct !== null ? `${pct}%` : '0%' }}
                                    />
                                  </div>
                                  <span className="text-[0.55rem] text-slate-500 text-center leading-none">{pct !== null ? `${pct}%` : '—'}</span>
                                  <span className="text-[0.5rem] text-slate-400 text-center leading-none capitalize">{p.slice(0,4)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        {run.remediation_steps && (
                          <div>
                            <p className="text-[0.6rem] font-black text-slate-400 uppercase tracking-widest mb-1">Remediation</p>
                            <p className="text-[0.75rem] text-slate-600 whitespace-pre-line leading-relaxed">{run.remediation_steps}</p>
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

        {/* Agent cards grid */}
        <div className="grid grid-cols-2 gap-3">
          {agentDefs.map((agent) => {
            const isRunningThis = runningPhase === agent.id;
            const hist = agentRunHistory[agent.id] || [];
            const runCount = hist.length;
            const isDone = runCount > 0;
            const currentIdx = isDone ? (agentRunIndex[agent.id] ?? runCount - 1) : 0;
            const displayResult = isDone ? hist[Math.min(currentIdx, runCount - 1)] : null;
            const content = displayResult ? agent.getContent(displayResult) : null;
            const confidence = getAgentConfidence(agent.id);
            const confidenceStatus = getConfidenceStatus(confidence);
            const isViewingLatest = currentIdx === runCount - 1;

            return (
              <div
                key={agent.id}
                className={`bg-white rounded-xl border transition-all ${
                  isRunningThis
                    ? 'border-[#004a99] ring-2 ring-[#004a99]/20'
                    : isDone
                    ? isViewingLatest ? 'border-green-200' : 'border-amber-200'
                    : 'border-[#d1d9e6]'
                }`}
              >
                {/* Card header */}
                <div className={`flex items-center justify-between px-4 py-3 rounded-t-xl border-b ${
                  isRunningThis ? 'bg-blue-50 border-blue-100' :
                  isDone ? (isViewingLatest ? 'bg-green-50 border-green-100' : 'bg-amber-50 border-amber-100') :
                  'bg-slate-50 border-slate-100'
                }`}>
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
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

                  {/* Right side: run counter + nav + run/rerun button */}
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {/* Run counter with prev/next navigation */}
                    {runCount > 0 && (
                      <div className="flex items-center gap-0.5 bg-white border border-slate-200 rounded-full px-1.5 py-0.5">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); navigateAgentRun(agent.id, -1); }}
                          disabled={currentIdx <= 0}
                          className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                        >
                          ‹
                        </button>
                        <span className={`text-[0.62rem] font-black font-mono px-0.5 ${isViewingLatest ? 'text-green-600' : 'text-amber-600'}`}>
                          {currentIdx + 1}/{runCount}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); navigateAgentRun(agent.id, 1); }}
                          disabled={currentIdx >= runCount - 1}
                          className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                        >
                          ›
                        </button>
                      </div>
                    )}

                    {/* Run / Rerun button */}
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAgentRun(agent.id); }}
                      disabled={isAnalyzing || isRerunning}
                      className={`flex items-center gap-1 text-[0.65rem] font-black px-3 py-1.5 rounded-full transition-colors disabled:opacity-50 uppercase tracking-wide shadow-sm ${
                        isDone
                          ? 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'
                          : 'bg-[#004a99] text-white hover:bg-[#003a7a]'
                      }`}
                    >
                      {isRunningThis
                        ? <><div className="w-2.5 h-2.5 rounded-full border-2 border-current/40 border-t-current animate-spin" /> Running</>
                        : isDone
                        ? <>↺ Rerun</>
                        : <><ChevronRight size={10} /> Run</>
                      }
                    </button>
                  </div>
                </div>

                {/* Card body */}
                <div className="px-4 py-3 min-h-[56px]">
                  {isRunningThis ? (
                    <div className="flex items-center gap-2 text-[0.75rem] text-blue-600 italic">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                      Running agent via OpenRouter...
                    </div>
                  ) : isDone ? (
                    <div className="space-y-2">
                      {!isViewingLatest && (
                        <div className="flex items-center gap-1.5 text-[0.65rem] text-amber-600 font-semibold">
                          <Clock size={10} />
                          Viewing run {currentIdx + 1} of {runCount} — <button type="button" className="underline" onClick={() => setAgentRunIndex(prev => ({ ...prev, [agent.id]: runCount - 1 }))}>jump to latest</button>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full border text-[0.62rem] font-black uppercase tracking-wide ${confidenceStatus.cls}`}>
                          Confidence: {confidenceStatus.label}
                        </span>
                        <span className="text-[0.68rem] font-mono text-slate-500">
                          {confidence === null ? '--' : `${Math.round(confidence * 100)}%`}
                        </span>
                      </div>
                      {agent.id === 'analysis' && displayResult && (() => {
                        const ac = displayResult.attack_category as string | undefined;
                        const kc = displayResult.kill_chain_stage as string | undefined;
                        const rs = displayResult.risk_score as number | undefined;
                        const ra = displayResult.recommended_action as string | undefined;
                        const isFP = displayResult.is_false_positive as boolean | undefined;
                        const fpReason = displayResult.false_positive_reason as string | undefined;
                        const fpConf = displayResult.false_positive_confidence as number | undefined;
                        const rsColor = rs == null ? 'bg-slate-300' : rs >= 80 ? 'bg-red-500' : rs >= 60 ? 'bg-orange-500' : rs >= 40 ? 'bg-amber-400' : 'bg-emerald-500';
                        const raColor: Record<string, string> = {
                          IGNORE: 'bg-slate-100 text-slate-500 border-slate-200',
                          MONITOR: 'bg-blue-50 text-blue-700 border-blue-200',
                          INVESTIGATE: 'bg-cyan-50 text-cyan-700 border-cyan-200',
                          ESCALATE: 'bg-amber-50 text-amber-700 border-amber-200',
                          CONTAIN: 'bg-orange-50 text-orange-700 border-orange-200',
                          BLOCK: 'bg-red-50 text-red-700 border-red-200',
                        };
                        return (
                          <div className="space-y-1.5">
                            {(ac || kc) && (
                              <div className="flex flex-wrap gap-1">
                                {ac && <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-[0.58rem] font-bold uppercase tracking-wide">{ac.replace(/_/g, ' ')}</span>}
                                {kc && <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[0.58rem] font-bold uppercase tracking-wide">{kc.replace(/_/g, ' ')}</span>}
                              </div>
                            )}
                            {rs != null && (
                              <div className="space-y-0.5">
                                <div className="flex items-center justify-between text-[0.62rem] text-slate-500">
                                  <span>Risk Score</span><span className="font-mono font-bold">{rs}/100</span>
                                </div>
                                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full transition-all ${rsColor}`} style={{ width: `${rs}%` }} />
                                </div>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              {ra && <span className={`px-2 py-0.5 rounded-full border text-[0.6rem] font-black uppercase tracking-wide ${raColor[ra] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>{ra}</span>}
                              <span className={`px-2 py-0.5 rounded-full border font-black uppercase tracking-wide text-[0.6rem] ${isFP ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                FP: {isFP ? 'Yes' : 'No'} ({Math.round(((fpConf ?? 0)) * 100)}%)
                              </span>
                            </div>
                            {isFP && fpReason && (
                              <p className="text-[0.65rem] text-slate-500 italic leading-snug">{fpReason}</p>
                            )}
                          </div>
                        );
                      })()}
                      <p className="text-[0.78rem] text-slate-600 leading-relaxed line-clamp-3">{content}</p>
                    </div>
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
  const { token } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch('/api/stats', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (!data.error) setStats(data); })
      .catch(() => {});
  }, [token]);

  const statCards = [
    { label: 'Critical Alerts',      value: alerts.filter(a => a.severity >= 12).length, icon: AlertTriangle, color: '#d93025' },
    { label: 'Active Incidents',     value: stats ? stats.activeIncidents : '—',          icon: Shield,        color: '#004a99' },
    { label: 'Mean Time to Triage',  value: stats ? stats.mttr : '—',                    icon: Clock,         color: '#1e8e3e' },
    { label: 'AI Automation Rate',   value: stats ? stats.automationRate : '—',           icon: Activity,      color: '#1a73e8' },
  ];

  const swarmAgents = [
    { name: 'Alert Triage Agent',  phaseKey: 'analysis' },
    { name: 'Threat Intel Agent',  phaseKey: 'intel' },
    { name: 'RAG Knowledge Agent', phaseKey: 'knowledge' },
    { name: 'Correlation Agent',   phaseKey: 'correlation' },
    { name: 'Ticketing Agent',     phaseKey: 'ticket' },
    { name: 'Response Agent',      phaseKey: 'response' },
    { name: 'Validation Agent',    phaseKey: 'validation' },
  ];

  const getAgentStatus = (phaseKey: string) => {
    const runCount = alerts.filter(a => {
      if (!a.ai_analysis) return false;
      try { return !!(JSON.parse(a.ai_analysis)?.phaseData?.[phaseKey]); } catch { return false; }
    }).length;
    const isAnalyzing = alerts.some(a => a.status === 'ANALYZING');
    if (isAnalyzing && phaseKey === 'analysis') return { label: 'Analyzing', load: '88%' };
    if (runCount === 0) return { label: 'Standby', load: '0%' };
    const loadPct = Math.min(95, Math.round((runCount / Math.max(alerts.length, 1)) * 100));
    return { label: 'Online', load: `${loadPct}%` };
  };

  return (
    <div className="p-6 flex flex-col gap-6 h-full overflow-y-auto">
      <div className="grid grid-cols-4 gap-5">
        {statCards.map((stat, i) => <StatCard key={i} {...stat} />)}
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

        <div className="bg-white border border-[#d1d9e6] rounded-lg flex flex-col shadow-sm overflow-hidden">
          <div className="p-4 border-b border-[#d1d9e6] bg-slate-50/50">
            <h3 className="text-[0.9rem] font-bold text-[#004a99]">AI AGENT SWARM STATUS</h3>
          </div>
          <div className="p-4 flex flex-col gap-3 flex-1 overflow-y-auto">
            {swarmAgents.map((agent) => {
              const agentStatus = getAgentStatus(agent.phaseKey);
              const loadNum = parseInt(agentStatus.load);
              return (
                <div key={agent.phaseKey} className="flex flex-col gap-1">
                  <div className="flex justify-between text-[0.72rem]">
                    <span className="font-semibold text-[#1a1a1b] truncate">{agent.name}</span>
                    <span className={
                      agentStatus.label === 'Online' ? 'text-[#1e8e3e]' :
                      agentStatus.label === 'Analyzing' ? 'text-[#1a73e8]' :
                      'text-[#5f6368]'
                    }>{agentStatus.label}</span>
                  </div>
                  <div className="h-1.5 w-full bg-[#f0f0f0] rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-1000 ${loadNum > 80 ? 'bg-[#d93025]' : 'bg-[#004a99]'}`}
                      style={{ width: agentStatus.load }}
                    />
                  </div>
                </div>
              );
            })}

            <div className="mt-2 p-3 bg-[#f0f7ff] rounded-lg border border-[#d1d9e6]">
              <div className="text-[0.8rem] font-bold text-[#004a99] mb-1">System Health</div>
              <div className="text-[0.7rem] text-[#5f6368] leading-relaxed">
                All 7 agents operational. Mistral 7B (1-6) · Phi-3 Mini (validation).
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const AlertsTab = ({ alerts, selectedAlert, setSelectedAlert, onAlertAction }: {
  alerts: Alert[];
  selectedAlert: Alert | null;
  setSelectedAlert: (a: Alert | null) => void;
  onAlertAction: (id: string, update: any) => void;
}) => {
  const [filterOpen, setFilterOpen]       = useState(false);
  const [filterSeverity, setFilterSev]    = useState('');
  const [filterStatus, setFilterStatus]   = useState('');
  const [filteredAlerts, setFiltered]     = useState<Alert[]>(alerts);

  useEffect(() => {
    let result = alerts;
    if (filterSeverity) {
      const ranges: Record<string, [number, number]> = {
        CRITICAL: [13, 999], HIGH: [10, 12], MEDIUM: [7, 9], LOW: [0, 6],
      };
      const [lo, hi] = ranges[filterSeverity] || [0, 999];
      result = result.filter(a => a.severity >= lo && a.severity <= hi);
    }
    if (filterStatus) {
      result = result.filter(a => a.status === filterStatus);
    }
    setFiltered(result);
  }, [alerts, filterSeverity, filterStatus]);

  const hasFilters = !!filterSeverity || !!filterStatus;
  const clearFilters = () => { setFilterSev(''); setFilterStatus(''); };

  return (
    <div className="flex h-full overflow-hidden">
      <section className="w-[320px] border-r border-[#d1d9e6] bg-white flex flex-col overflow-hidden">
        <div className="p-[15px] border-b border-[#d1d9e6] font-semibold text-[0.9rem] flex justify-between items-center relative">
          <span>WAZUH ALERTS ({filteredAlerts.length}{hasFilters ? ' filtered' : ''})</span>
          <button
            onClick={() => setFilterOpen(!filterOpen)}
            className={`flex items-center gap-1 text-[0.7rem] font-bold px-2 py-1 rounded transition-colors ${
              hasFilters ? 'bg-[#004a99] text-white' : 'text-[#004a99] hover:bg-[#f0f7ff]'
            }`}
          >
            <Filter className="w-3 h-3" />
            {hasFilters ? 'Filtered ●' : 'Filter'}
          </button>

          {filterOpen && (
            <div className="absolute top-full right-0 z-20 w-56 bg-white border border-[#d1d9e6] rounded-lg shadow-lg p-4 space-y-3">
              <div>
                <label className="text-[0.65rem] font-black text-[#5f6368] uppercase tracking-wider block mb-1">Severity</label>
                <select
                  value={filterSeverity}
                  onChange={e => setFilterSev(e.target.value)}
                  className="w-full text-[0.8rem] border border-[#d1d9e6] rounded px-2 py-1.5 outline-none focus:border-[#004a99]"
                >
                  <option value="">All</option>
                  <option value="CRITICAL">Critical (13+)</option>
                  <option value="HIGH">High (10-12)</option>
                  <option value="MEDIUM">Medium (7-9)</option>
                  <option value="LOW">Low (&lt;7)</option>
                </select>
              </div>
              <div>
                <label className="text-[0.65rem] font-black text-[#5f6368] uppercase tracking-wider block mb-1">Status</label>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="w-full text-[0.8rem] border border-[#d1d9e6] rounded px-2 py-1.5 outline-none focus:border-[#004a99]"
                >
                  <option value="">All</option>
                  {['NEW','ANALYZING','TRIAGED','FALSE_POSITIVE','ESCALATED','CLOSED'].map(s => (
                    <option key={s} value={s}>{s.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="w-full text-[0.75rem] font-bold text-[#d93025] hover:bg-red-50 py-1 rounded transition-colors"
                >
                  Clear Filters
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredAlerts.length > 0 ? (
            filteredAlerts.map(alert => (
              <AlertRow
                key={alert.id}
                alert={alert}
                onClick={() => setSelectedAlert(alert)}
                isSelected={selectedAlert?.id === alert.id}
              />
            ))
          ) : (
            <div className="p-10 text-center text-slate-400 text-sm">No alerts match the current filters.</div>
          )}
        </div>
      </section>
      <section className="flex-1 overflow-hidden">
        {selectedAlert ? (
          <AlertDetail alert={selectedAlert} onClose={() => setSelectedAlert(null)} onAction={onAlertAction} />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400 flex-col gap-4">
            <Shield className="w-16 h-16 opacity-10" />
            <p className="font-semibold text-sm">Select an alert from the queue to start investigation</p>
          </div>
        )}
      </section>
    </div>
  );
};

const InvestigationsTab = () => {
  const { token } = useAuth();
  const [incidents, setIncidents]   = useState<Incident[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [form, setForm]             = useState({ title: '', severity: 'MEDIUM', status: 'OPEN', alert_ids: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError]   = useState('');

  const fetchIncidents = () => {
    if (!token) return;
    setLoading(true);
    fetch('/api/incidents', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setIncidents(data); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchIncidents(); }, [token]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError('');
    try {
      const alert_ids = form.alert_ids ? form.alert_ids.split(',').map(s => s.trim()).filter(Boolean) : [];
      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...form, alert_ids }),
      });
      const data = await res.json();
      if (data.error) { setFormError(data.error); return; }
      setShowModal(false);
      setForm({ title: '', severity: 'MEDIUM', status: 'OPEN', alert_ids: '' });
      fetchIncidents();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create incident');
    } finally {
      setSubmitting(false);
    }
  };

  const sevStyle: Record<string, string> = {
    CRITICAL: 'bg-red-50 text-red-600', HIGH: 'bg-orange-50 text-orange-600',
    MEDIUM: 'bg-blue-50 text-blue-600', LOW: 'bg-green-50 text-green-600',
  };
  const statusStyle: Record<string, string> = {
    OPEN: 'bg-blue-50 text-blue-600', IN_PROGRESS: 'bg-orange-50 text-orange-600',
    RESOLVED: 'bg-green-50 text-green-600', CLOSED: 'bg-slate-100 text-slate-500',
  };

  return (
    <div className="p-8 max-w-6xl mx-auto overflow-y-auto h-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-[#004a99]">Active Investigations</h2>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-[#004a99] text-white px-4 py-2 rounded font-bold text-sm hover:bg-[#003a7a] transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Incident
        </button>
      </div>

      <div className="bg-white border border-[#d1d9e6] rounded-lg overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-[#d1d9e6] text-[#5f6368] font-bold uppercase text-[0.7rem] tracking-wider">
            <tr>
              <th className="p-4">ID</th>
              <th className="p-4">Title</th>
              <th className="p-4">Severity</th>
              <th className="p-4">Status</th>
              <th className="p-4">Alerts</th>
              <th className="p-4">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0]">
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-slate-400">Loading incidents...</td></tr>
            ) : incidents.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-slate-400">No incidents found. Create one with the button above.</td></tr>
            ) : incidents.map(inc => (
              <tr key={inc.id} className="hover:bg-slate-50 cursor-pointer">
                <td className="p-4 font-mono text-[#004a99] text-xs">{inc.id}</td>
                <td className="p-4 font-semibold">{inc.title}</td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${sevStyle[inc.severity] || 'bg-slate-100 text-slate-600'}`}>
                    {inc.severity}
                  </span>
                </td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${statusStyle[inc.status] || 'bg-slate-100 text-slate-600'}`}>
                    {inc.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="p-4 text-[#5f6368]">{inc.alerts?.length ?? 0} linked</td>
                <td className="p-4 text-[#5f6368] text-xs">{new Date(inc.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-7 py-5 bg-[#003a7a] text-white">
              <h3 className="text-[1rem] font-black">Create New Incident</h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-white/10 rounded"><X size={18} /></button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              {formError && (
                <div className="bg-red-50 text-[#d93025] px-4 py-2 rounded border border-red-100 text-sm">{formError}</div>
              )}
              <div>
                <label className="text-[0.7rem] font-black text-[#5f6368] uppercase tracking-wider block mb-1">Title *</label>
                <input
                  required
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  className="w-full border border-[#d1d9e6] rounded px-3 py-2 text-sm outline-none focus:border-[#004a99]"
                  placeholder="e.g. Brute Force Attempt – Web Server 01"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[0.7rem] font-black text-[#5f6368] uppercase tracking-wider block mb-1">Severity</label>
                  <select
                    value={form.severity}
                    onChange={e => setForm({ ...form, severity: e.target.value })}
                    className="w-full border border-[#d1d9e6] rounded px-3 py-2 text-sm outline-none focus:border-[#004a99]"
                  >
                    {['LOW','MEDIUM','HIGH','CRITICAL'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[0.7rem] font-black text-[#5f6368] uppercase tracking-wider block mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={e => setForm({ ...form, status: e.target.value })}
                    className="w-full border border-[#d1d9e6] rounded px-3 py-2 text-sm outline-none focus:border-[#004a99]"
                  >
                    {['OPEN','IN_PROGRESS','RESOLVED','CLOSED'].map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[0.7rem] font-black text-[#5f6368] uppercase tracking-wider block mb-1">Linked Alert IDs (comma-separated, optional)</label>
                <input
                  value={form.alert_ids}
                  onChange={e => setForm({ ...form, alert_ids: e.target.value })}
                  className="w-full border border-[#d1d9e6] rounded px-3 py-2 text-sm outline-none focus:border-[#004a99] font-mono"
                  placeholder="abc123, def456"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-5 py-2 rounded border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded bg-[#004a99] text-white font-bold text-sm hover:bg-[#003a7a] disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting
                    ? <><div className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" /> Creating...</>
                    : 'Create Incident'
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const AgentsTab = () => {
  const { token, user } = useAuth();
  const [promptModal, setPromptModal] = useState<{ name: string; prompt: string } | null>(null);
  const [config, setConfig] = useState<AgentModelConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savingPhase, setSavingPhase] = useState<AgentPhase | null>(null);
  const isAdmin = user?.role === 'ADMIN';

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

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    getAgentModelConfig()
      .then(setConfig)
      .catch((err: any) => setError(err?.message || 'Failed to load agent model configuration.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleModelChange = async (phase: AgentPhase, model: string) => {
    if (!isAdmin) return;
    setSavingPhase(phase);
    setError('');
    try {
      const updated = await updateAgentModel(phase, model);
      setConfig(updated);
    } catch (err: any) {
      setError(err?.message || 'Failed to update model.');
    } finally {
      setSavingPhase(null);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto overflow-y-auto h-full">
      <h2 className="text-2xl font-bold text-[#004a99] mb-1">AI Agent Swarm Configuration</h2>
      <p className="text-sm text-[#5f6368] mb-2">
        Runtime models are now configurable per agent (OpenRouter free-model list), persisted in SQLite, and used by both single-agent and full-orchestration runs.
      </p>
      <p className="text-[0.75rem] text-slate-500 mb-6">
        {isAdmin ? 'You can change model assignments below.' : 'Model selection is admin-only.'}
      </p>

      {error && (
        <div className="mb-4 bg-red-50 text-[#d93025] p-3 rounded border border-red-100 text-[0.8rem] font-semibold">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {agentDefs.map((agent, i) => {
          const currentModel = config?.assignments?.[agent.phase] || config?.defaults?.[agent.phase] || 'unknown';
          const options = config?.availableModels || [currentModel];
          const isSaving = savingPhase === agent.phase;
          return (
            <div key={i} className="bg-white border border-[#d1d9e6] rounded-lg p-5 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-[#004a99]">{agent.name}</h3>
                <span className="bg-green-50 text-green-600 px-2 py-1 rounded text-[10px] font-bold uppercase">Active</span>
              </div>
              <p className="text-sm text-[#5f6368] mb-4">{agent.desc}</p>
              <div className="space-y-2 pt-4 border-t border-[#f0f0f0]">
                <label className="text-[0.62rem] font-black uppercase tracking-wider text-slate-400 block">Model</label>
                <select
                  value={currentModel}
                  disabled={!isAdmin || loading || isSaving}
                  onChange={(e) => handleModelChange(agent.phase, e.target.value)}
                  className="w-full border border-[#d1d9e6] rounded px-2.5 py-2 text-[0.72rem] font-mono outline-none focus:border-[#004a99] disabled:opacity-60"
                >
                  {options.map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
                <div className="flex justify-between items-center">
                  <span className="text-[0.65rem] text-slate-400">{isSaving ? 'Saving model...' : 'OpenRouter model'}</span>
                  <button
                    onClick={() => setPromptModal({ name: agent.name, prompt: agent.prompt })}
                    className="flex items-center gap-1 text-[#004a99] text-xs font-bold hover:underline"
                  >
                    <Eye className="w-3 h-3" />
                    View Prompt
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {promptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-7 py-5 bg-[#003a7a] text-white shrink-0">
              <div>
                <p className="text-[0.65rem] font-black uppercase tracking-widest text-blue-200 mb-0.5">System Prompt</p>
                <h3 className="text-[1rem] font-black">{promptModal.name}</h3>
              </div>
              <button onClick={() => setPromptModal(null)} className="p-1 hover:bg-white/10 rounded"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <pre className="text-[0.78rem] bg-slate-950 text-emerald-400 p-5 rounded-xl font-mono leading-relaxed whitespace-pre-wrap">
                {promptModal.prompt}
              </pre>
            </div>
            <div className="px-6 py-4 border-t bg-slate-50 flex justify-end shrink-0">
              <button onClick={() => setPromptModal(null)} className="px-5 py-2 rounded border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-100">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SettingsTab = () => {
  const { user, token } = useAuth();
  const [users, setUsers]              = useState<UserType[]>([]);
  const [loadingUsers, setLoadingUsers]= useState(false);
  const [showCreateForm, setShowCreate]= useState(false);
  const [form, setForm]                = useState({ username: '', password: '', email: '', role: 'ANALYST' });
  const [createError, setCreateError]  = useState('');
  const [createSuccess, setCreateOk]  = useState('');
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!isAdmin || !token) return;
    setLoadingUsers(true);
    fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setUsers(data); })
      .finally(() => setLoadingUsers(false));
  }, [isAdmin, token]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setCreateOk('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.error) { setCreateError(data.error); return; }
      setCreateOk(`User "${data.username}" created successfully.`);
      setUsers(prev => [...prev, data]);
      setForm({ username: '', password: '', email: '', role: 'ANALYST' });
      setShowCreate(false);
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create user');
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8 overflow-y-auto h-full">
      <h2 className="text-2xl font-bold text-[#004a99]">System Administration</h2>

      <div className="bg-white border border-[#d1d9e6] rounded-lg p-6 shadow-sm">
        <h3 className="text-[0.85rem] font-bold text-[#5f6368] uppercase mb-4">Your Profile</h3>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Username', value: user?.username },
            { label: 'Role',     value: user?.role },
            { label: 'User ID',  value: `#${user?.id}` },
          ].map(f => (
            <div key={f.label} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <p className="text-[0.6rem] font-black text-slate-400 uppercase tracking-wider mb-1">{f.label}</p>
              <p className="font-bold text-[0.9rem] text-slate-800">{f.value}</p>
            </div>
          ))}
        </div>
      </div>

      {isAdmin ? (
        <div className="bg-white border border-[#d1d9e6] rounded-lg overflow-hidden shadow-sm">
          <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
            <h3 className="text-[0.85rem] font-bold text-[#004a99]">User Management</h3>
            <button
              onClick={() => setShowCreate(!showCreateForm)}
              className="flex items-center gap-1.5 bg-[#004a99] text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-[#003a7a] transition-colors"
            >
              <UserPlus className="w-3 h-3" />
              Add User
            </button>
          </div>

          {showCreateForm && (
            <form onSubmit={handleCreateUser} className="p-5 border-b border-[#d1d9e6] bg-[#f0f7ff] space-y-3">
              {createError  && <div className="text-[#d93025] text-sm font-semibold">{createError}</div>}
              {createSuccess && <div className="text-[#1e8e3e] text-sm font-semibold">{createSuccess}</div>}
              <div className="grid grid-cols-2 gap-3">
                <input required placeholder="Username" value={form.username}
                  onChange={e => setForm({...form, username: e.target.value})}
                  className="border border-[#d1d9e6] rounded px-3 py-2 text-sm outline-none focus:border-[#004a99]" />
                <input required type="password" placeholder="Password" value={form.password}
                  onChange={e => setForm({...form, password: e.target.value})}
                  className="border border-[#d1d9e6] rounded px-3 py-2 text-sm outline-none focus:border-[#004a99]" />
                <input placeholder="Email (optional)" value={form.email}
                  onChange={e => setForm({...form, email: e.target.value})}
                  className="border border-[#d1d9e6] rounded px-3 py-2 text-sm outline-none focus:border-[#004a99]" />
                <select value={form.role} onChange={e => setForm({...form, role: e.target.value})}
                  className="border border-[#d1d9e6] rounded px-3 py-2 text-sm outline-none focus:border-[#004a99]">
                  <option value="ANALYST">ANALYST</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="bg-[#004a99] text-white px-4 py-1.5 rounded text-sm font-bold hover:bg-[#003a7a]">Create</button>
                <button type="button" onClick={() => setShowCreate(false)} className="border border-slate-200 text-slate-600 px-4 py-1.5 rounded text-sm font-semibold hover:bg-slate-50">Cancel</button>
              </div>
            </form>
          )}

          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-[#d1d9e6] text-[#5f6368] font-bold uppercase text-[0.7rem] tracking-wider">
              <tr>
                <th className="p-4">ID</th>
                <th className="p-4">Username</th>
                <th className="p-4">Email</th>
                <th className="p-4">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {loadingUsers ? (
                <tr><td colSpan={4} className="p-6 text-center text-slate-400">Loading users...</td></tr>
              ) : users.map(u => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="p-4 font-mono text-slate-400">#{u.id}</td>
                  <td className="p-4 font-semibold">{u.username}</td>
                  <td className="p-4 text-slate-500">{u.email || '—'}</td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${u.role === 'ADMIN' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'}`}>
                      {u.role}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 text-amber-800 text-sm font-semibold">
          User management is restricted to ADMIN role. Contact your SOC administrator.
        </div>
      )}
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
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('soc_active_tab') || 'dashboard');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(() => localStorage.getItem('soc_selected_alert_id'));
  const [socket, setSocket] = useState<Socket | null>(null);

  const selectedAlert = alerts.find((alert) => alert.id === selectedAlertId) || null;

  useEffect(() => {
    localStorage.setItem('soc_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (selectedAlertId) {
      localStorage.setItem('soc_selected_alert_id', selectedAlertId);
    } else {
      localStorage.removeItem('soc_selected_alert_id');
    }
  }, [selectedAlertId]);

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
    });

    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    if (!selectedAlertId) return;
    if (!alerts.some((alert) => alert.id === selectedAlertId)) {
      setSelectedAlertId(null);
    }
  }, [alerts, selectedAlertId]);

  const handleAlertAction = (id: string, update: any) => {
    const socToken = localStorage.getItem('soc_token');
    // Update local state
    setAlerts(prev => Array.isArray(prev) ? prev.map(a => a.id === id ? { ...a, ...update } : a) : prev);
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
        setSelectedAlert={(alert: Alert | null) => setSelectedAlertId(alert?.id || null)}
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

  // Compute real efficiency metrics from alert data
  const triagedAlerts = alerts.filter(a => (a.status === 'TRIAGED' || a.status === 'CLOSED') && a.ai_analysis);
  const mttrMs = triagedAlerts.length > 0
    ? triagedAlerts.reduce((sum, a) => sum + (Date.now() - new Date(a.timestamp).getTime()), 0) / triagedAlerts.length
    : null;
  const mttrDisplay = mttrMs !== null
    ? mttrMs < 120000 ? `${(mttrMs / 1000).toFixed(1)}s` : `${(mttrMs / 60000).toFixed(1)}m`
    : 'N/A';

  const confidenceScores: number[] = [];
  alerts.forEach(a => {
    if (!a.ai_analysis) return;
    try {
      const pd = JSON.parse(a.ai_analysis)?.phaseData || {};
      Object.values(pd).forEach((phase: any) => {
        if (typeof phase?.confidence === 'number' && !isNaN(phase.confidence)) confidenceScores.push(phase.confidence);
      });
    } catch {}
  });
  const avgConsensus = confidenceScores.length > 0
    ? `${Math.round((confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length) * 100)}%`
    : 'N/A';

  const withResponse = alerts.filter(a => {
    if (!a.ai_analysis) return false;
    try { return (JSON.parse(a.ai_analysis)?.response?.actions?.length ?? 0) > 0; } catch { return false; }
  }).length;
  const autoContainment = alerts.length > 0 ? `${Math.round((withResponse / alerts.length) * 100)}%` : 'N/A';

  const withValidation = alerts.filter(a => {
    if (!a.ai_analysis) return false;
    try { return !!JSON.parse(a.ai_analysis)?.phaseData?.validation?.sla_status; } catch { return false; }
  });
  const slaMet = withValidation.filter(a => {
    try { return JSON.parse(a.ai_analysis!)?.phaseData?.validation?.sla_status === 'SLA_MET'; } catch { return false; }
  }).length;
  const slaAdherence = withValidation.length > 0 ? `${Math.round((slaMet / withValidation.length) * 100)}%` : 'N/A';

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
            {(triaged + closed) > 0 && (
              <span className="text-sm text-[#1e8e3e] mb-1 font-bold">{triaged + closed} resolved total</span>
            )}
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
            { label: 'Avg Analysis Time', val: mttrDisplay,    unit: 'per alert' },
            { label: 'Agent Consensus',   val: avgConsensus,   unit: 'confidence' },
            { label: 'Auto-Containment',  val: autoContainment, unit: 'success rate' },
            { label: 'SLA Adherence',     val: slaAdherence,   unit: 'validation target' }
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
          {activeTab === 'dashboard'  && <Dashboard alerts={alerts} onAlertClick={setSelectedAlert} />}
          {activeTab === 'alerts'     && <AlertsTab alerts={alerts} selectedAlert={selectedAlert} setSelectedAlert={setSelectedAlert} onAlertAction={onAlertAction} />}
          {activeTab === 'incidents'  && <InvestigationsTab />}
          {activeTab === 'agents'     && <AgentsTab />}
          {activeTab === 'reports'    && <Reports alerts={alerts} />}
          {activeTab === 'settings'   && <SettingsTab />}
        </main>
      </div>
    </div>
  );
};
