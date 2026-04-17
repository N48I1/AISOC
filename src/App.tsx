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

const DetailedReport = ({ alert, aiData, mitreTags, onClose, onAgentTrigger }: { alert: Alert, aiData: any, mitreTags: string[], onClose: () => void, onAgentTrigger: (phase: string) => void }) => {
  const isAnalyzing = alert.status === 'ANALYZING';

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-10 bg-black/50 backdrop-blur-sm"
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-[#004a99] text-white">
          <div>
            <h2 className="text-xl font-bold">Comprehensive Security Incident Report</h2>
            <p className="text-sm opacity-80">Incident #{alert.id.toUpperCase()} • Generated by Aegis AI Swarm</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <XCircle size={24} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          <section>
            <div className="flex justify-between items-center border-b-2 border-[#004a99] pb-1 mb-4">
              <h3 className="text-lg font-bold text-[#004a99]">1. EXECUTIVE SUMMARY</h3>
              <div className="flex gap-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${alert.status === 'TRIAGED' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                  {alert.status}
                </span>
                {alert.email_sent === 1 && <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Email Sent</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <p><span className="font-bold">Description:</span> {alert.description}</p>
                <p><span className="font-bold">Severity:</span> {alert.severity >= 12 ? 'CRITICAL' : 'HIGH'}</p>
                <p><span className="font-bold">Source Host:</span> {alert.agent_name || 'N/A'}</p>
              </div>
              <div className="space-y-2">
                <p><span className="font-bold">Timestamp:</span> {new Date(alert.timestamp).toLocaleString()}</p>
                <p><span className="font-bold">Incident Manager:</span> SOC AI Swarm</p>
                <p><span className="font-bold">Correlation ID:</span> {aiData?.correlation?.substring(0, 12) || 'N/A'}</p>
              </div>
            </div>
            <p className="mt-4 p-4 bg-gray-50 rounded-lg border italic text-gray-700 text-sm leading-relaxed">
              {aiData?.summary || (isAnalyzing ? 'Analyzing incident summary...' : 'Waiting for analyst to start analysis swarm...')}
            </p>
          </section>

          <section>
            <div className="flex justify-between items-center border-b-2 border-[#004a99] pb-1 mb-4">
              <h3 className="text-lg font-bold text-[#004a99]">2. AGENT EVALUATIONS (HUMAN-IN-THE-LOOP)</h3>
              <p className="text-[0.65rem] text-slate-500 font-bold uppercase">Manual Execution Required</p>
            </div>
            <div className="space-y-4">
              {[
                { id: 'analysis', name: 'Alert Triage & IOC Extraction', content: aiData?.summary, icon: Search },
                { id: 'intel', name: 'MITRE ATT&CK & Threat Intel', content: aiData?.intel, icon: Shield },
                { id: 'knowledge', name: 'Playbook Retrieval (RAG)', content: alert.remediation_steps, icon: Clock },
                { id: 'correlation', name: 'Campaign Correlation', content: aiData?.correlation, icon: Activity },
                { id: 'ticketing', name: 'Incident Reporting & Email', content: aiData?.ticket?.report_body, icon: FileText },
                { id: 'response', name: 'Orchestrated Response Plan', content: aiData?.response?.actions?.map((a: any) => `${a.type}: ${a.reason}`).join('\n'), icon: Terminal },
                { id: 'validation', name: 'SLA & Policy Validation', content: aiData?.validation, icon: CheckCircle }
              ].map(agent => (
                <div key={agent.id} className={`border rounded-xl overflow-hidden transition-all ${agent.content ? 'border-green-100' : 'border-gray-200'}`}>
                  <div className={`px-4 py-3 font-bold text-sm flex justify-between items-center ${agent.content ? 'bg-green-50 text-green-900' : 'bg-gray-50 text-gray-700'}`}>
                    <div className="flex items-center gap-2">
                      <agent.icon size={16} className={agent.content ? 'text-green-600' : 'text-gray-400'} />
                      <span>{agent.name}</span>
                    </div>
                    {agent.content ? (
                      <span className="flex items-center gap-1 text-[10px] text-green-600 bg-white px-2 py-0.5 rounded-full border border-green-200 uppercase tracking-tighter shadow-sm">
                        <CheckCircle size={10} /> Verified
                      </span>
                    ) : (
                      <button 
                        onClick={() => onAgentTrigger(agent.id)}
                        disabled={isAnalyzing}
                        className="text-[10px] bg-[#004a99] text-white px-3 py-1 rounded-full font-bold uppercase tracking-wider hover:bg-[#003366] transition-all disabled:opacity-50 shadow-sm flex items-center gap-1"
                      >
                        {isAnalyzing ? <div className="w-2 h-2 rounded-full bg-white animate-pulse" /> : <ChevronRight size={10} />}
                        Run Agent
                      </button>
                    )}
                  </div>
                  <div className="p-4 text-xs whitespace-pre-wrap text-gray-600 italic bg-white min-h-[60px] flex items-center">
                    {agent.content || (isAnalyzing ? 'Agent is communicating with Gemini...' : 'Analyst must trigger this agent phase manually.')}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {mitreTags.length > 0 && (
            <section>
              <h3 className="text-lg font-bold text-[#004a99] border-b-2 border-[#004a99] pb-1 mb-4">3. MITRE ATT&CK TARGETING</h3>
              <div className="flex flex-wrap gap-2">
                {mitreTags.map(tag => (
                  <span key={tag} className="px-3 py-1 bg-red-50 text-red-700 border border-red-200 rounded-full text-xs font-bold font-mono">
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-lg font-bold text-[#004a99] border-b-2 border-[#004a99] pb-1 mb-4">4. RAW SYSTEM LOGS (WAZUH)</h3>
            <pre className="text-[10px] bg-slate-900 text-green-400 p-5 rounded-xl overflow-x-auto font-mono custom-scrollbar">
              {alert.full_log}
            </pre>
          </section>
        </div>

        <div className="p-6 border-t bg-gray-50 flex justify-end gap-3">
           <button onClick={onClose} className="px-8 py-2.5 rounded-lg font-bold text-gray-600 hover:bg-gray-100 transition-colors border shadow-sm">Dismiss</button>
        </div>
      </div>
    </motion.div>
  );
};

const AlertDetail = ({ alert, onClose, onAction }: { alert: Alert, onClose: () => void, onAction: (id: string, update: any) => void }) => {
  const [showReport, setShowReport] = useState(false);
  let aiData: any = null;
  let mitreTags: string[] = [];

  try {
    aiData = alert.ai_analysis ? JSON.parse(alert.ai_analysis) : null;
  } catch (e) {
    console.error('Failed to parse ai_analysis', e);
  }

  try {
    mitreTags = alert.mitre_attack ? JSON.parse(alert.mitre_attack as any) : [];
  } catch (e) {
    console.error('Failed to parse mitre_attack', e);
  }

  const agents = [
    { name: '1. Alert Analysis', result: aiData?.summary || (alert.status === 'ANALYZING' ? 'Analyzing...' : 'Waiting...'), status: alert.status === 'NEW' ? 'Pending' : alert.status === 'ANALYZING' ? 'Processing' : 'Completed' },
    { name: '2. Threat Intel', result: aiData?.intel || (alert.status === 'ANALYZING' ? 'Enriching...' : 'Waiting...'), status: alert.status === 'NEW' ? 'Pending' : alert.status === 'ANALYZING' ? 'Processing' : 'Completed' },
    { name: '3. RAG Knowledge', result: alert.remediation_steps || (alert.status === 'ANALYZING' ? 'Searching playbooks...' : 'Waiting...'), status: alert.status === 'NEW' ? 'Pending' : alert.status === 'ANALYZING' ? 'Processing' : 'Completed' },
    { name: '4. Correlation', result: aiData?.correlation || (alert.status === 'ANALYZING' ? 'Correlating...' : 'Waiting...'), status: alert.status === 'NEW' ? 'Pending' : alert.status === 'ANALYZING' ? 'Processing' : 'Completed' },
    { name: '5. Ticketing', result: aiData?.ticket?.title ? `${aiData.ticket.title}: ${aiData.ticket.report_body}` : (alert.status === 'TRIAGED' ? 'Incident Draft Ready' : 'Pending...'), status: alert.status === 'TRIAGED' ? 'Completed' : 'Pending' },
    { name: '6. Response', result: aiData?.response?.actions?.map((r: any) => `${r.type}: ${r.target}`).join(', ') || 'Awaiting analyst approval...', status: aiData?.response ? 'Completed' : 'Pending' },
    { name: '7. Validation', result: aiData?.validation || 'Pending...', status: aiData?.validation ? 'Completed' : 'Pending' },
  ];

  const handleAgentTrigger = async (phase: string) => {
    onAction(alert.id, { status: 'ANALYZING' });
    try {
      // Mock state for individual runs
      const state = {
        alert: alert,
        recentAlerts: [], // In real app, we'd pass recent alerts
        analysis: aiData,
        intel: aiData?.intel,
        knowledge: alert.remediation_steps,
        correlation: aiData?.correlation,
        ticket: aiData?.ticket,
        responsePlan: aiData?.response,
      };

      const result = await runAgentPhase(phase, state) as any;
      
      let updatedAiData = { ...aiData };
      let updatedOtherFields: any = {};

      if (phase === 'analysis' && result.analysis) {
        updatedAiData.summary = result.analysis.analysis_summary;
        if (result.analysis.is_false_positive) updatedOtherFields.status = 'FALSE_POSITIVE';
      }
      if (phase === 'intel' && result.intel) {
        updatedAiData.intel = result.intel.intel_summary;
        updatedOtherFields.mitre_attack = JSON.stringify(result.intel.mitre_attack);
      }
      if (phase === 'knowledge' && result.knowledge) {
        updatedOtherFields.remediation_steps = result.knowledge.remediation_steps;
      }
      if (phase === 'correlation' && result.correlation) {
        updatedAiData.correlation = result.correlation.campaign_name;
      }
      if (phase === 'ticketing' && result.ticket) {
        updatedAiData.ticket = result.ticket;
        updatedOtherFields.email_sent = result.ticket.email_notification_sent ? 1 : 0;
      }
      if (phase === 'response' && result.responsePlan) {
        updatedAiData.response = result.responsePlan;
      }
      if (phase === 'validation' && result.validation) {
        updatedAiData.validation = result.validation.sla_status;
      }

      onAction(alert.id, { 
        ...updatedOtherFields,
        ai_analysis: JSON.stringify(updatedAiData),
        status: updatedOtherFields.status || 'TRIAGED'
      });
    } catch (error) {
      console.error('Agent Trigger Error:', error);
      onAction(alert.id, { status: 'TRIAGED' });
    }
  };

  const handleAction = (status: string) => {
    onAction(alert.id, { status });
  };

  const downloadReport = () => {
    const report = {
      incidentId: alert.id,
      timestamp: alert.timestamp,
      description: alert.description,
      aiAnalysis: aiData,
      mitreAttack: mitreTags,
      status: alert.status
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `incident-report-${alert.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-[#f4f7fa] p-5 gap-5 overflow-y-auto">
      <div className="bg-white p-5 border border-[#d1d9e6] rounded-lg">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-[1.1rem] font-bold">Incident #{alert.id.substring(0, 8).toUpperCase()}: {alert.description}</h2>
              <button 
                onClick={() => setShowReport(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#004a99] text-white hover:bg-[#003366] transition-colors text-[0.7rem] font-bold uppercase"
              >
                <FileText size={14} />
                View Detailed Report
              </button>
              <button 
                onClick={downloadReport}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#e8f0fe] text-[#1967d2] hover:bg-[#d2e3fc] transition-colors text-[0.7rem] font-bold uppercase"
              >
                <ChevronRight size={14} />
                Json
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              <span className={`px-[10px] py-[4px] rounded-[4px] text-[0.7rem] font-bold uppercase ${alert.severity >= 12 ? 'bg-[#ffebee] text-[#d93025]' : 'bg-orange-50 text-orange-600'}`}>
                {alert.severity >= 12 ? 'Critical Severity' : 'High Severity'}
              </span>
              <span className="px-[10px] py-[4px] rounded-[4px] text-[0.7rem] font-bold uppercase bg-[#e8f0fe] text-[#1967d2]">
                Triage Phase
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[0.75rem] text-[#5f6368] mb-1">Assigned to AI Swarm (7 Agents)</div>
            {alert.email_sent === 1 && (
              <div className="flex items-center justify-end gap-1.5 text-[0.7rem] text-[#1e8e3e] font-bold uppercase mb-2">
                <Bell size={12} fill="currentColor" />
                Email Alert Sent
              </div>
            )}
            <div className="text-[0.9rem] font-bold text-[#1e8e3e]">94% Analysis Confidence</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-[15px]">
        {agents.map((agent, i) => (
          <div key={i} className={`bg-white border border-[#d1d9e6] rounded-lg p-3 flex flex-col gap-2 ${agent.status === 'Processing' ? 'border-[#004a99] ring-1 ring-[#004a99]' : ''}`}>
            <div className="text-[0.65rem] uppercase font-bold flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${agent.status === 'Completed' ? 'bg-[#1e8e3e]' : agent.status === 'Processing' ? 'bg-[#004a99]' : 'bg-[#ccc]'}`} />
              {agent.status}
            </div>
            <div className="text-[0.85rem] font-bold text-[#004a99]">{agent.name}</div>
            <div className="text-[0.75rem] text-[#5f6368] line-height-[1.3]">{agent.result}</div>
          </div>
        ))}
        <div className="bg-transparent border border-dashed border-[#d1d9e6] rounded-lg p-3 flex items-center justify-center">
          <span className="text-[0.7rem] text-[#5f6368]">+ Add Custom Agent</span>
        </div>
      </div>

      {mitreTags.length > 0 && (
        <div className="bg-white p-5 border border-[#d1d9e6] rounded-lg">
          <h3 className="text-[0.85rem] font-bold mb-3">MITRE ATT&CK Mapping</h3>
          <div className="flex flex-wrap gap-2">
            {mitreTags.map((tag: string) => (
              <span key={tag} className="bg-[#004a99] text-white px-2 py-1 rounded text-[10px] font-bold">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto bg-[#eef2f6] border border-[#d1d9e6] rounded-lg p-[15px] flex justify-between items-center">
        <div>
          <div className="text-[0.85rem] font-bold mb-0.5">Recommended Action: IP Isolation</div>
          <div className="text-[0.75rem] text-[#5f6368]">Auto-generated workflow ready for approval</div>
        </div>
        <div className="flex gap-2.5">
          <button 
            onClick={() => handleAction('FALSE_POSITIVE')}
            className="px-4 py-2 rounded-[4px] border border-[#004a99] text-[#004a99] font-semibold text-[0.85rem] bg-white hover:bg-slate-50 transition-colors"
          >
            False Positive
          </button>
          <button 
            onClick={() => handleAction('ESCALATED')}
            className="px-4 py-2 rounded-[4px] border border-[#004a99] text-[#004a99] font-semibold text-[0.85rem] bg-white hover:bg-slate-50 transition-colors"
          >
            Escalate Tier 2
          </button>
          <button 
            onClick={() => handleAction('CLOSED')}
            className="px-4 py-2 rounded-[4px] bg-[#004a99] text-white font-semibold text-[0.85rem] hover:bg-[#003366] transition-colors"
          >
            Approve Isolation (Agent 6)
          </button>
        </div>
      </div>
      {showReport && (
        <DetailedReport 
          alert={alert} 
          aiData={aiData} 
          mitreTags={mitreTags} 
          onClose={() => setShowReport(false)} 
          onAgentTrigger={handleAgentTrigger}
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
