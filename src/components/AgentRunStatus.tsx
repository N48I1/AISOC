import React from 'react';
import { AlertTriangle, AlertOctagon, RefreshCw, X, Zap, Loader2 } from 'lucide-react';
import { AGENT_PHASES_UI } from '../features/alerts/alertUtils';

// ─── AgentRunStatus ──────────────────────────────────────────────────────────
// One reusable section that disambiguates loading / errored / quota / fallback
// for an AI agent run, and offers Retry + Refresh. Used by the Alert Queue and
// the Incidents view so a failed/incomplete LLM run is never silent.

export interface AgentRunStatusProps {
  loading?: boolean;
  /** Transient error from a call that failed in this session. */
  error?: string | null;
  /** Persisted failure reason from the DB (survives refresh). */
  lastError?: string | null;
  lastErrorAt?: string | null;
  quotaExhausted?: boolean;
  fallbackPhases?: string[];
  phaseErrors?: Record<string, string>;
  /** Retry / refresh in flight → disable the buttons + spin. */
  busy?: boolean;
  onRetry?: () => void;
  onRefresh?: () => void;
  onDismiss?: () => void;
  retryLabel?: string;
}

const phaseLabel = (phase: string): string => {
  const base = phase.replace(/:.*$/, ''); // strip ":local-fallback"
  return AGENT_PHASES_UI.find(a => a.phase === base)?.label || base;
};

const ActionButtons: React.FC<{
  busy?: boolean; onRetry?: () => void; onRefresh?: () => void; retryLabel?: string; tone: 'red' | 'amber';
}> = ({ busy, onRetry, onRefresh, retryLabel, tone }) => {
  const retryCls = tone === 'red'
    ? 'bg-[#d93025] hover:bg-[#b3261e] text-white'
    : 'bg-amber-500 hover:bg-amber-600 text-white';
  return (
    <div className="flex items-center gap-2 mt-2.5">
      {onRetry && (
        <button type="button" onClick={onRetry} disabled={busy}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.7rem] font-bold transition-colors disabled:opacity-60 ${retryCls}`}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
          {retryLabel || 'Retry agents'}
        </button>
      )}
      {onRefresh && (
        <button type="button" onClick={onRefresh} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--b2)] bg-[var(--s0)] text-[var(--t6)] text-[0.7rem] font-bold hover:bg-[var(--s1)] transition-colors disabled:opacity-60">
          <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Refresh
        </button>
      )}
    </div>
  );
};

export const AgentRunStatus: React.FC<AgentRunStatusProps> = ({
  loading, error, lastError, lastErrorAt, quotaExhausted, fallbackPhases = [],
  phaseErrors = {}, busy, onRetry, onRefresh, onDismiss, retryLabel,
}) => {
  // 1. Loading — a run is in flight.
  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--b1)] bg-[var(--s1)] px-4 py-3 flex items-center gap-3">
        <Loader2 size={16} className="text-[var(--p1)] animate-spin shrink-0" />
        <p className="text-[0.78rem] font-semibold text-[var(--t5)]">Agents are running… analyzing this alert.</p>
      </div>
    );
  }

  const reason = error || lastError;
  const phaseErrEntries = Object.entries(phaseErrors);
  const agentFallbacks = fallbackPhases.filter(p => AGENT_PHASES_UI.some(a => a.phase === p.replace(/:.*$/, '')));

  // 2. Hard error — the run failed and we have a reason.
  if (reason) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 flex items-start gap-3">
        <AlertOctagon size={18} className="text-red-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="font-black uppercase tracking-wider text-[0.7rem] text-red-800">Agent run failed</p>
            {onDismiss && (
              <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-red-400 hover:text-red-700 shrink-0">
                <X size={14} />
              </button>
            )}
          </div>
          <p className="text-[0.78rem] text-red-800 leading-relaxed mt-0.5 break-words">{reason}</p>
          {lastErrorAt && !error && (
            <p className="text-[0.62rem] text-red-500 mt-0.5">Last failure: {new Date(lastErrorAt).toLocaleString()}</p>
          )}
          {phaseErrEntries.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {phaseErrEntries.map(([phase, msg]) => (
                <li key={phase} className="text-[0.66rem] text-red-700 flex gap-1.5">
                  <span className="font-bold shrink-0">{phaseLabel(phase)}:</span>
                  <span className="break-words">{msg}</span>
                </li>
              ))}
            </ul>
          )}
          <ActionButtons busy={busy} onRetry={onRetry} onRefresh={onRefresh} retryLabel={retryLabel} tone="red" />
        </div>
      </div>
    );
  }

  // 3. Quota exhausted — providers are up but out of budget.
  if (quotaExhausted) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 flex items-start gap-3">
        <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-black uppercase tracking-wider text-[0.7rem] text-red-800">LLM daily quota exhausted</p>
          <p className="text-[0.78rem] text-red-800 leading-relaxed mt-0.5">
            Real analysis could not run — the provider's daily limit is used up. Add credits / switch provider, or wait for the quota to reset, then retry.
          </p>
          <ActionButtons busy={busy} onRetry={onRetry} onRefresh={onRefresh} retryLabel={retryLabel} tone="red" />
        </div>
      </div>
    );
  }

  // 4. Partial fallback — some agents returned placeholder data.
  if (agentFallbacks.length > 0) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-black uppercase tracking-wider text-[0.7rem] text-amber-800">
            {agentFallbacks.length}/{AGENT_PHASES_UI.length} agents returned fallback data
          </p>
          <p className="text-[0.78rem] text-amber-800 leading-relaxed mt-0.5">
            Some agents could not produce a real assessment — the data below is partly placeholder. Retry to re-run them.
          </p>
          {phaseErrEntries.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {phaseErrEntries.map(([phase, msg]) => (
                <li key={phase} className="text-[0.66rem] text-amber-800 flex gap-1.5">
                  <span className="font-bold shrink-0">{phaseLabel(phase)}:</span>
                  <span className="break-words">{msg}</span>
                </li>
              ))}
            </ul>
          )}
          <ActionButtons busy={busy} onRetry={onRetry} onRefresh={onRefresh} retryLabel={retryLabel} tone="amber" />
        </div>
      </div>
    );
  }

  return null;
};

export default AgentRunStatus;
