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

const StepUpModal: React.FC<{
  title?: string;
  message?: string;
  destructive?: boolean;
  onVerified: (token: string) => Promise<void> | void;
  onCancel: () => void;
}> = ({ title, message, destructive, onVerified, onCancel }) => {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setVerifying(true);
    setError('');
    try {
      const r = await verifyPassword(password);
      await onVerified(r.token);
    } catch (err: any) {
      setError(err.message || 'Verification failed');
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/55 z-[60] flex items-center justify-center p-4">
      <div className={`bg-[var(--s0)] border rounded-xl shadow-2xl max-w-sm w-full p-6 ${destructive ? 'border-red-300' : 'border-[var(--b1)]'}`}>
        <div className="flex items-center gap-2 mb-1">
          <Lock size={16} className={destructive ? 'text-red-600' : 'text-amber-600'} />
          <h3 className="text-[0.95rem] font-black text-[var(--t7)]">{title || 'Confirm your password'}</h3>
        </div>
        <p className="text-[0.74rem] text-[var(--t4)]">
          {message || 'This sensitive action requires re-authentication.'}
        </p>
        <p className="text-[0.66rem] text-[var(--t3)] mt-1">Signed in as <b>{user?.username}</b>.</p>

        <form onSubmit={submit} className="mt-3 space-y-2">
          {error && <div className="text-[#d93025] text-[0.72rem] font-semibold bg-red-50 border border-red-200 rounded px-3 py-1.5">{error}</div>}
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your current password"
            className="w-full bg-[var(--s1)] border border-[var(--b1)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--p1)]"
          />
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={verifying || !password}
              className={`flex-1 px-3 py-1.5 rounded-lg text-[0.78rem] font-bold text-white disabled:opacity-50 ${destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-[var(--p1)] hover:bg-[var(--pd)]'}`}
            >
              {verifying ? 'Verifying…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="border border-[var(--b2)] text-[var(--t5)] px-3 py-1.5 rounded-lg text-[0.78rem] font-semibold hover:bg-[var(--s1)]"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Admin: edit any user — display_name, email, role, status, force-change toggle, access expiry, reset password.

export { StepUpModal };
