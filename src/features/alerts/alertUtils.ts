import type { Alert } from '../../types';
import type { AgentPhase } from '../../services/aiService';

export const AGENT_PHASES_UI: Array<{ phase: AgentPhase; label: string; short: string }> = [
  { phase: 'analysis', label: 'Alert Triage', short: 'Triage' },
  { phase: 'intel', label: 'Threat Intel', short: 'Intel' },
  { phase: 'knowledge', label: 'RAG Knowledge', short: 'RAG' },
  { phase: 'correlation', label: 'Correlation', short: 'Correlate' },
  { phase: 'recall', label: 'Memory Recall', short: 'Recall' },
  { phase: 'ioc_check', label: 'IOC History', short: 'IOC' },
  { phase: 'ticketing', label: 'Ticketing', short: 'Ticket' },
  { phase: 'response', label: 'Response', short: 'Respond' },
  { phase: 'validation', label: 'SLA Validation', short: 'Validate' },
];

export const parseAlertAi = (alert?: Alert | null): any | null => {
  if (!alert?.ai_analysis) return null;
  try { return JSON.parse(alert.ai_analysis); } catch { return null; }
};

export const parseMitreTags = (alert?: Alert | null): string[] => {
  if (!alert?.mitre_attack) return [];
  try {
    const parsed = Array.isArray(alert.mitre_attack) ? alert.mitre_attack : JSON.parse(alert.mitre_attack as any);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
};

export const getPhaseData = (aiData: any, phase: AgentPhase) => {
  if (!aiData?.phaseData) return null;
  return phase === 'ticketing' ? (aiData.phaseData.ticketing || aiData.phaseData.ticket) : aiData.phaseData[phase];
};

export const getAlertRiskScore = (alert: Alert): number | null => {
  const aiData = parseAlertAi(alert);
  const analysisRisk = aiData?.phaseData?.analysis?.risk_score;
  if (typeof analysisRisk === 'number') return analysisRisk;
  const intelRisk = aiData?.phaseData?.intel?.risk_score;
  if (typeof intelRisk === 'number') return intelRisk <= 10 ? intelRisk * 10 : intelRisk;
  return null;
};

export const getConfidenceValues = (aiData: any): number[] =>
  AGENT_PHASES_UI
    .map(a => getPhaseData(aiData, a.phase))
    .map(v => v?.confidence)
    .filter((v): v is number => typeof v === 'number')
    .map(v => v <= 1 ? Math.round(v * 100) : Math.round(v));

export const percent = (value: number, total: number) => total > 0 ? Math.round((value / total) * 100) : 0;
