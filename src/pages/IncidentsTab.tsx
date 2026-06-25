import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, AlertTriangle, AlertOctagon, Activity, FileText, Search, User, CheckCircle, XCircle, X,
  Clock, ChevronRight, Filter, Plus, UserPlus, Eye, ThumbsUp, ThumbsDown, BookOpen, Send, Zap,
  RefreshCw, Hash, Globe, Crosshair, ListChecks, MessageSquare, Laptop, Link2, Terminal, Download, Lock, Unlock, Sparkles,
} from 'lucide-react';
import {
  getIncidents, getIncident, getIncidentReasoning, reinvestigateIncident, generateIncidentReport,
  lockIncidentReport, getReportHistory, type ReportHistoryRow, createIncident, createManualIncident,
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

// Quick-start templates for manually-created incidents. Picking one pre-fills the
// title, a suggested severity, and a Markdown "Data incident Overview" scaffold the
// analyst then completes. Purely client-side convenience — no AI involved.
type IncidentTemplate = { key: string; label: string; icon: React.ReactNode; tint: string; severity: string; title: string; overview: string };
const INCIDENT_TEMPLATES: IncidentTemplate[] = [
  { key: 'phishing', label: 'Phishing', icon: <Globe size={14} />, tint: 'border-blue-200 bg-blue-50 text-blue-700', severity: 'HIGH',
    title: 'Phishing campaign targeting employees',
    overview: '## Summary\nSuspected phishing email reported / detected in mail flow.\n\n## Indicators\n- Sender address: \n- Subject line: \n- Malicious URL / domain: \n- Attachment hash: \n\n## Affected users / assets\n- \n\n## Impact\n- Confidentiality (credential theft): \n\n## Initial response\n- Quarantine the message\n- Block sender / domain\n- Reset affected credentials' },
  { key: 'malware', label: 'Malware / Ransomware', icon: <Shield size={14} />, tint: 'border-red-200 bg-red-50 text-red-700', severity: 'CRITICAL',
    title: 'Malware detected on endpoint',
    overview: '## Summary\nMalicious binary / ransomware activity detected.\n\n## Indicators\n- Host: \n- File path / hash: \n- C2 domain / IP: \n- Process: \n\n## Impact\n- Availability / Integrity: \n\n## Initial response\n- Isolate the host from the network\n- Capture a forensic image / memory\n- Identify patient zero and lateral movement' },
  { key: 'unauthorized', label: 'Unauthorized Access', icon: <Lock size={14} />, tint: 'border-violet-200 bg-violet-50 text-violet-700', severity: 'HIGH',
    title: 'Unauthorized access / suspicious login',
    overview: '## Summary\nSuspicious authentication or privilege escalation observed.\n\n## Indicators\n- Account: \n- Source IP / geo: \n- Target system: \n- Time window: \n\n## Impact\n- Confidentiality / Integrity: \n\n## Initial response\n- Disable / force-reset the account\n- Review auth logs and active sessions\n- Verify MFA status' },
  { key: 'exfil', label: 'Data Exfiltration', icon: <Crosshair size={14} />, tint: 'border-orange-200 bg-orange-50 text-orange-700', severity: 'CRITICAL',
    title: 'Potential data exfiltration',
    overview: '## Summary\nAnomalous outbound data transfer suspected.\n\n## Indicators\n- Source host / user: \n- Destination IP / domain: \n- Volume / protocol: \n- Data classification: \n\n## Impact\n- Confidentiality: \n\n## Initial response\n- Block the destination\n- Preserve netflow / proxy logs\n- Assess regulatory / notification obligations' },
  { key: 'dos', label: 'Denial of Service', icon: <Zap size={14} />, tint: 'border-amber-200 bg-amber-50 text-amber-700', severity: 'HIGH',
    title: 'Denial of service / availability event',
    overview: '## Summary\nService degradation or outage suspected to be malicious.\n\n## Indicators\n- Targeted service / IP: \n- Traffic source(s): \n- Rate / pattern: \n\n## Impact\n- Availability: \n\n## Initial response\n- Engage upstream / DDoS mitigation\n- Rate-limit or geo-block sources\n- Confirm service health' },
  { key: 'blank', label: 'Blank', icon: <FileText size={14} />, tint: 'border-[var(--b2)] bg-[var(--s1)] text-[var(--t5)]', severity: 'MEDIUM',
    title: '',
    overview: '## Summary\n\n## Affected assets\n- \n\n## Impact\n- \n\n## Initial response\n- ' },
];

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

// ── SOC analysis prompt generator ────────────────────────────────────────────
// Static, AI-free mapping: drops the incident ID, title and the latest raw Wazuh
// alert JSON into a fixed prompt template the analyst can copy into an external
// AI chat. Everything between the backticks is the user-provided prompt verbatim.
const SOC_ANALYSIS_PROMPT_HEAD = `Tu es un analyste SOC senior (niveau 2/3) opérant un SIEM Wazuh dans une infrastructure d'entreprise hétérogène (serveurs Windows et Linux, hyperviseurs, équipements réseau, sauvegarde Veeam, supervision Zabbix). Tu maîtrises les EventChannels Windows, les règles Wazuh, le triage d'alertes et les cadres ITILv4 et ISO/IEC 27035.

À partir de l'alerte SIEM Wazuh brute fournie plus bas, produis une analyse complète et consolidée en 3 étapes, en français, dans un registre professionnel et sobre (sans emoji).

MÉTHODE D'ANALYSE (à appliquer mentalement avant de rédiger, ne pas l'afficher) :
1. Lis et corrèle systématiquement les champs clés du JSON : rule.id, rule.level, rule.description, rule.groups, agent.name/ip, data (srcip, dstip, user), decoder.name, full_log, integration, et surtout le contenu détaillé du message Windows EventChannel (data.win.system.message et data.win.eventdata) lorsqu'il est présent — c'est souvent là que se trouve la cause réelle.
2. Interprète le niveau de sévérité Wazuh sur son échelle 0–15 : 0–3 faible/informatif, 4–7 moyen, 8–11 élevé, 12–15 critique. Ne sur-évalue ni ne sous-évalue par rapport au niveau réellement présent dans le JSON.
3. Tranche explicitement entre vrai positif, faux positif et investigation requise, en justifiant à partir d'indices concrets du JSON (origine de l'IP, nature du processus, légitimité de l'activité, message d'erreur applicatif vs activité malveillante).

ANTI-HALLUCINATION (impératif) :
- N'invente jamais de valeur absente du JSON : ni IP, ni nom de machine, ni CVE, ni nom de service, ni horodatage, ni utilisateur.
- Si une information nécessaire est absente, écris explicitement « non disponible dans l'alerte » plutôt que de la supposer.
- Ne cite aucune référence externe (CVE, KB, lien) qui ne figure pas littéralement dans le JSON.
- Distingue clairement les faits (extraits du JSON) des hypothèses (signalées par « hypothèse à vérifier : … »).

Format de sortie attendu (Markdown standard : "##" pour les titres d'étape, "**texte**" pour le gras, "-" pour les puces) :

## Étape 1 : Détails de l'événement et contexte (Détection — ISO/IEC 27035)
- **Identifiant et gravité :** ID Wazuh, ID de règle, niveau de sévérité et sa signification sur l'échelle 0–15
- **Hôte impacté :** nom de l'agent, adresse IP, rôle de la machine dans l'infrastructure si déductible (sinon « rôle non déductible de l'alerte »)
- **Composant en échec :** application, chemin, processus ou service concerné
- **Impact opérationnel :** disponibilité, confidentialité, intégrité, et qualification initiale (incident réel / faux positif probable / à investiguer)

## Étape 2 : Analyse de la cause racine (Évaluation et gestion des problèmes — ITIL)
- **Symptôme :** description technique précise de ce que la règle Wazuh a détecté et pourquoi elle s'est déclenchée
- **Cause probable :** explication technique détaillée du mécanisme à l'origine de l'alerte, fondée uniquement sur les champs du JSON (en particulier le message EventChannel s'il est présent)
- **Origine :** contexte plausible (activité légitime, dysfonctionnement applicatif, erreur de configuration, activité malveillante), en restant factuel et en marquant les hypothèses à vérifier

## Étape 3 : Plan de résolution complet
**A. Traitement immédiat (Gestion des incidents ITIL & Réponse ISO/IEC 27035)**
- Actions de vérification concrètes à mener immédiatement (commandes, points de contrôle, éléments à corréler)
- Décision de clôture ou d'escalade, avec justification

**B. Actions à long terme (Gestion des problèmes & amélioration continue)**
- Ajustements de configuration ou de règles de détection (tuning, whitelisting, seuils) à envisager
- Actions préventives ou organisationnelles pour réduire la récurrence

Consignes de forme :
- Va à l'essentiel : phrases denses, techniques et actionnables, sans remplissage ni généralités.
- Chaque affirmation technique doit pouvoir se rattacher à un champ du JSON ; à défaut, la signaler comme hypothèse.
- Termine par une ligne de synthèse indiquant la qualification finale recommandée (Incident confirmé / Faux positif / Investigation complémentaire requise).

IMPÉRATIF — Format final de ta réponse :
Convertis impérativement ta réponse finale en Markdown, et colore les titres en gras avec la couleur de base #1C4F61, et la ligne de qualification finale recommandée en gras avec la couleur #2CB701, en utilisant des balises HTML <span style="color:#XXXXXX"><strong>...</strong></span> directement dans le Markdown (pas de blocs de code, le Markdown doit être rendu directement dans ta réponse) :
- Les 3 titres d'étape ("Étape 1 : ...", "Étape 2 : ...", "Étape 3 : ...") : <span style="color:#1C4F61"><strong>Étape 1 : Détails de l'événement et contexte (Détection — ISO/IEC 27035)</strong></span> — même principe pour les Étapes 2 et 3.
- La ligne finale de qualification recommandée : <span style="color:#2CB701"><strong>Qualification finale : ...</strong></span>
- Tout le reste du contenu (sous-titres A./B., puces, labels en gras) reste en Markdown standard sans couleur.

---

Numéro d'incident : __INCIDENT_ID__
Titre : __TITLE__

Raw Wazuh Alert (JSON) :`;

// Pretty-print the most recent alert's raw Wazuh log (mirrors WazuhAlertCard's rawLog).
function latestAlertRawJson(alerts?: Alert[]): string {
  if (!alerts || alerts.length === 0) return '';
  const latest = [...alerts].sort(
    (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime(),
  )[0] || alerts[0];
  if (!latest?.full_log) return '';
  try { return JSON.stringify(JSON.parse(latest.full_log), null, 2); }
  catch { return latest.full_log; }
}

// Pure mapping function — no LLM. Fills the template and appends the raw alert JSON.
function buildSocAnalysisPrompt(incidentId: string, title: string, rawJson: string): string {
  const head = SOC_ANALYSIS_PROMPT_HEAD
    .replace('__INCIDENT_ID__', incidentId || "[Numéro d'incident non renseigné]")
    .replace('__TITLE__', title || '[Titre non renseigné]');
  const json = rawJson || '// Aucune alerte Wazuh brute disponible pour cet incident';
  return head + '\n```json\n' + json + '\n```';
}

// ── Resolution & closure report prompt ───────────────────────────────────────
// Second static, AI-free template: maps only the incident ID and title (it asks
// the AI chat to write the closure report from the prior conversation). Verbatim
// user-provided text between the backticks.
const SOC_RESOLUTION_REPORT_PROMPT = `Sur la base de l'ensemble de notre échange ci-dessus concernant cet incident, rédige maintenant un RAPPORT DE RÉSOLUTION ET DE CLÔTURE D'INCIDENT, professionnel, au format Markdown, structuré selon les cadres ITILv4 (gestion des incidents et des problèmes) et ISO/IEC 27035 (gestion des incidents de sécurité de l'information).

Exigences :
- Reste strictement factuel : appuie-toi uniquement sur les éléments échangés dans cette conversation. N'invente aucune donnée ; si une rubrique manque d'information, indique « non documenté ».
- Registre professionnel et synthétique, exploitable par un responsable SOC ou un auditeur (pas de remplissage, pas d'emoji).
- Reprends le numéro et le titre d'incident indiqués en bas de ce message.

Structure attendue (Markdown : "##" pour les titres de section, "**texte**" pour le gras, "-" pour les puces) :

## 1. Identification de l'incident
- Numéro d'incident, titre, hôte/agent concerné, niveau de sévérité, date/heure de détection, statut final

## 2. Résumé exécutif
- Synthèse en 3 à 4 phrases : nature de l'incident, cause, résolution apportée, impact réel

## 3. Chronologie
- Étapes clés (détection, analyse, actions, clôture) selon ce qui a été échangé, datées si l'information est disponible

## 4. Description et analyse de la cause racine (RCA)
- Description technique de l'incident et cause racine identifiée

## 5. Actions de résolution menées
- Traitement immédiat appliqué et résultat obtenu

## 6. Mesures préventives et amélioration continue
- Tuning SIEM, durcissement, recommandations pour éviter la récurrence (gestion des problèmes ITIL)

## 7. Leçons apprises (ISO/IEC 27035)
- Enseignements et axes d'amélioration du processus de détection et de réponse

## 8. Clôture
- Décision de clôture, puis une ligne distincte commençant par « Statut final : » indiquant la qualification finale (Incident résolu / Faux positif confirmé / Transféré en problème)

IMPÉRATIF — Mise en forme finale (deux couleurs distinctes, ne pas les confondre) :
Rends ta réponse en Markdown (pas dans un bloc de code), et applique des balises HTML inline pour la couleur :
- BLEU #1C4F61 — uniquement pour les titres de section (## 1 à ## 8), en gras : <span style="color:#1C4F61"><strong>1. Identification de l'incident</strong></span> — même principe pour les sections 2 à 8.
- VERT #2CB701 — obligatoirement pour la ligne « Statut final » de la section « 8. Clôture », en gras : <span style="color:#2CB701"><strong>Statut final : ...</strong></span>. Cette ligne NE doit PAS être bleue : même si elle se trouve à l'intérieur de la section 8, elle est toujours en vert #2CB701, exactement comme la ligne de qualification finale d'une analyse d'incident.
- Tout le reste du contenu reste en Markdown standard, sans couleur.

---

Incident concerné : __INCIDENT_ID__
Titre : __TITLE__`;

// Pure mapping function — no LLM. Only the incident ID and title are substituted.
function buildSocResolutionReportPrompt(incidentId: string, title: string): string {
  return SOC_RESOLUTION_REPORT_PROMPT
    .replace('__INCIDENT_ID__', incidentId || "[Numéro d'incident non renseigné]")
    .replace('__TITLE__', title || '[Titre non renseigné]');
}

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
          <div className="ml-auto flex items-center gap-1.5">
            <CopyButton text={rawLog} />
            <button onClick={() => setShowRaw(s => !s)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--p1)] bg-blue-50 hover:bg-blue-100 text-[0.62rem] font-bold text-[var(--p1)] transition-colors">
              <Terminal size={12} />
              {showRaw ? 'Hide' : 'View'} Raw JSON
              <ChevronRight size={12} className={`transition-transform ${showRaw ? 'rotate-90' : ''}`} />
            </button>
          </div>
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

  // Copy helper — used by double-click-to-copy on the incident title/ID.
  const copyText = (text: string, label = 'Copied') => {
    navigator.clipboard.writeText(text)
      .then(() => toast(`${label} to clipboard`, 'success'))
      .catch(() => toast('Copy failed', 'error'));
  };

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
  const [detailTab, setDetailTab]     = useState<'overview'|'observables'|'tasks'|'timeline'|'report'>('overview');
  const [reasoning, setReasoning]     = useState<ReasoningRow[]>([]);
  const [loadingReasoning, setLoadingReasoning] = useState(false);
  const [showOverviewReasoning, setShowOverviewReasoning] = useState(false);
  const [showSocPrompt, setShowSocPrompt] = useState(false);
  const [showResolutionPrompt, setShowResolutionPrompt] = useState(false);
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
  const [overviewDraft, setOverviewDraft] = useState('');
  const [overviewEditing, setOverviewEditing] = useState(false);
  const [overviewSaving, setOverviewSaving]   = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [locking, setLocking] = useState(false);
  const [reportHistory, setReportHistory] = useState<ReportHistoryRow[]>([]);
  const [showReportHistory, setShowReportHistory] = useState(false);
  const [historySnapshot, setHistorySnapshot] = useState<ReportHistoryRow | null>(null);
  const [noteText, setNoteText]         = useState('');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [deleteActionTarget, setDeleteActionTarget] = useState<IncidentAction | null>(null);

  // ── Manual incident creation ──────────────────────────────────────────────
  const [showCreate, setShowCreate]   = useState(false);
  const [creating, setCreating]       = useState(false);
  const [cTitle, setCTitle]           = useState('');
  const [cSeverity, setCSeverity]     = useState('MEDIUM');
  const [cPhase, setCPhase]           = useState<IncidentPhase>('detection');
  const [cAssignee, setCAssignee]     = useState<number | ''>('');
  const [cReason, setCReason]         = useState('');
  const [cOverview, setCOverview]     = useState('');
  const [cTemplate, setCTemplate]     = useState<string>('');
  const [cPreview, setCPreview]       = useState(false);

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
    if (activeId) { fetchDetail(activeId); setDetailTab('overview'); setReasoning([]); setOverviewEditing(false); }
    else { setDetail(null); setReportEditing(false); setOverviewEditing(false); setReasoning([]); }
  }, [activeId, fetchDetail]);

  // Load the report change-history when the Report tab opens.
  useEffect(() => {
    if (detailTab !== 'report' || !activeId) { setShowReportHistory(false); return; }
    getReportHistory(activeId).then(d => setReportHistory(d.history)).catch(() => setReportHistory([]));
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
      toast(
        r.reasoning_steps
          ? `Investigation complete — ${r.reasoning_steps} reasoning step(s) recorded`
          : 'Investigation ran but produced no reasoning — check the LLM provider/quota',
        r.reasoning_steps ? 'success' : 'error',
      );
    } catch (e: any) {
      toast(e?.message || 'Re-investigation failed', 'error');
    } finally {
      setReinvestigating(false);
    }
  };

  // ── Manual incident creation handlers ────────────────────────────────────
  const resetCreateForm = () => {
    setCTitle(''); setCSeverity('MEDIUM'); setCPhase('detection'); setCAssignee('');
    setCReason(''); setCOverview(''); setCTemplate(''); setCPreview(false);
  };
  const applyCreateTemplate = (t: IncidentTemplate) => {
    setCTemplate(t.key);
    setCSeverity(t.severity);
    setCOverview(t.overview);
    if (t.title) setCTitle(t.title);
  };
  const handleCreateManual = async () => {
    const title = cTitle.trim();
    if (!title) { toast('A title is required', 'error'); return; }
    setCreating(true);
    try {
      const r = await createManualIncident({
        title,
        severity:    cSeverity,
        phase:       cPhase,
        assigned_to: cAssignee === '' ? null : Number(cAssignee),
        note:        cReason.trim() || undefined,
        analysis:    cOverview.trim() || undefined,
      });
      if (r.ok && r.id) {
        toast(`Incident ${r.id} created`, 'success');
        setShowCreate(false);
        resetCreateForm();
        fetchList();
        setActiveId(r.id);
      } else {
        toast(r.error || 'Failed to create incident', 'error');
      }
    } catch (e: any) {
      toast(e?.message || 'Failed to create incident', 'error');
    } finally {
      setCreating(false);
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
      if (r.ok) {
        toast('Report saved', 'success'); setReportEditing(false); fetchDetail(detail.id);
        getReportHistory(detail.id).then(d => setReportHistory(d.history)).catch(() => {});
      } else toast(r.error || 'Failed', 'error');
    };

    // Ask the AI to write a formal incident report (Markdown) and save it.
    const handleGenerateReport = async () => {
      if (generatingReport) return;
      setGeneratingReport(true);
      try {
        const r = await generateIncidentReport(detail.id);
        setReportDraft(r.report_body);
        setReportEditing(false);
        fetchDetail(detail.id);
        getReportHistory(detail.id).then(d => setReportHistory(d.history)).catch(() => {});
        toast('AI report generated', 'success');
      } catch (e: any) {
        toast(e?.message || 'Report generation failed', 'error');
      } finally {
        setGeneratingReport(false);
      }
    };

    // ── Report metadata (static — always in the report, not editable) ────────
    const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleString() : '—';
    const reportMeta: Array<{ label: string; value: string }> = [
      { label: 'Incident ID',      value: detail.id },
      { label: 'Severity',         value: detail.severity },
      { label: 'Status',           value: STATUS_LABELS[detail.status] || detail.status },
      { label: 'Phase',            value: PHASE_LABELS[detail.phase as IncidentPhase] || detail.phase },
      { label: 'Assigned Analyst', value: detail.assigned_to_username || 'Unassigned' },
      { label: 'Escalated By',     value: detail.escalated_by_username || '—' },
      { label: 'Escalated At',     value: fmtDate(detail.escalated_at) },
      { label: 'Report Date',      value: new Date().toLocaleString() },
    ];
    const buildReportMarkdown = () => [
      `# Final Incident Report — ${detail.title}`,
      '',
      '| Field | Value |',
      '| --- | --- |',
      ...reportMeta.map(m => `| **${m.label}** | ${m.value} |`),
      `| **Title** | ${detail.title} |`,
      '',
      '---',
      '',
      detail.report_body || '_No report body written yet._',
      '',
    ].join('\n');
    const downloadReport = () => {
      const blob = new Blob([buildReportMarkdown()], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${detail.id}-report.md`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast('Report downloaded', 'success');
    };

    // ── Data incident Overview (editable AI analysis, Markdown) ───────────────
    // Body source: the analyst's saved override on incidents.analysis when it's
    // plain Markdown; otherwise the AI report Markdown from the latest analysis.
    // (incidents.analysis also holds the raw AI JSON snapshot — recognised by a
    // leading { / [ — which we treat as "no override" and fall back to the AI text.)
    const aiReportMd = String(ai.ticket_summary || ai.summary || '');
    const analysisRaw = (detail.analysis || '').trim();
    const savedOverview = analysisRaw && !analysisRaw.startsWith('{') && !analysisRaw.startsWith('[') ? detail.analysis! : '';
    const overviewBody = savedOverview || aiReportMd;
    const hasAnyAi = !!(ai.summary || ai.ticket_summary || realReason(detail.reason) || ai.intel_summary || ai.recommended_action || ai.business_impact || (ai.mitre && ai.mitre.length > 0) || (ai.response_actions && ai.response_actions.length > 0) || (ai.iocs && Object.values(ai.iocs).some((v: any) => Array.isArray(v) && v.length)));
    const handleSaveOverview = async () => {
      setOverviewSaving(true);
      const r = await updateIncident(detail.id, { analysis: overviewDraft });
      setOverviewSaving(false);
      if (r.ok) { toast('Overview saved', 'success'); setOverviewEditing(false); fetchDetail(detail.id); }
      else toast(r.error || 'Failed to save overview', 'error');
    };
    const buildOverviewMarkdown = () => [
      `# Data Incident Overview — ${detail.title}`,
      '',
      '| Field | Value |',
      '| --- | --- |',
      ...reportMeta.map(m => `| **${m.label}** | ${m.value} |`),
      `| **Title** | ${detail.title} |`,
      '',
      '---',
      '',
      overviewBody || '_No overview written yet._',
      '',
    ].join('\n');
    const downloadOverview = () => {
      const blob = new Blob([buildOverviewMarkdown()], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${detail.id}-overview.md`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast('Overview downloaded', 'success');
    };

    // ── Report lock + history ────────────────────────────────────────────────
    const isReportLocked   = !!detail.report_locked;
    const reportLockedByMe = detail.report_locked_by === user?.id;
    const canManageReport  = canEdit && !isClosed && (!isReportLocked || reportLockedByMe || isAdminOrLead);
    const reloadHistory = () => { getReportHistory(detail.id).then(d => setReportHistory(d.history)).catch(() => {}); };
    const handleToggleLock = async () => {
      if (locking) return;
      setLocking(true);
      try {
        const r = await lockIncidentReport(detail.id, !isReportLocked);
        toast(r.locked ? 'Report locked' : 'Report unlocked', 'success');
        fetchDetail(detail.id);
        reloadHistory();
      } catch (e: any) {
        toast(e?.message || 'Lock change failed', 'error');
      } finally {
        setLocking(false);
      }
    };

    const observables = extractObservables(detail.analysis, detail.alerts);
    const DETAIL_TABS = [
      { key: 'overview'     as const, label: 'Overview',     icon: <Eye size={13} /> },
      { key: 'observables'  as const, label: `Observables (${observables.length})`, icon: <Crosshair size={13} /> },
      { key: 'tasks'        as const, label: `Tasks (${actions.length})`, icon: <ListChecks size={13} /> },
      { key: 'timeline'     as const, label: `Timeline (${detail.timeline?.length || 0})`, icon: <MessageSquare size={13} /> },
      { key: 'report'       as const, label: 'Final Report', icon: <FileText size={13} /> },
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
              <code onDoubleClick={() => copyText(detail.id, 'Incident ID copied')}
                title="Double-click to copy incident ID"
                className="text-[0.7rem] font-mono bg-[var(--s1)] text-[var(--t5)] px-2 py-1 rounded cursor-pointer select-none hover:bg-[var(--s2)] transition-colors">{detail.id}</code>
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
            <h2 onDoubleClick={() => copyText(detail.title, 'Title copied')}
              title="Double-click to copy title"
              className="text-[1.25rem] font-black text-[var(--t7)] cursor-pointer select-none">{detail.title}</h2>
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

            {/* Left column — tabbed content (min-w-0 so wide content like raw JSON scrolls
                inside its own box instead of stretching the whole page) */}
            <div className="space-y-4 min-w-0">
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
                  {/* Always-available actions — re-run the AI agents on this incident, or
                      refresh its data. Present on every incident, not just failed ones. */}
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
                        ? <><RefreshCw size={13} className="animate-spin" /> Running investigation…</>
                        : <><Zap size={13} /> Re-run investigation</>}
                    </button>
                  </div>

                  {/* Agent-run health: shows the failure reason when the last run failed
                      or fell back (the actions live in the toolbar above). */}
                  <AgentRunStatus
                    loading={reinvestigating}
                    lastError={erroredAlert?.last_error}
                    lastErrorAt={erroredAlert?.last_error_at}
                    quotaExhausted={incidentAiMeta.quota_exhausted === true}
                    fallbackPhases={Array.isArray(incidentAiMeta.fallback_phases) ? incidentAiMeta.fallback_phases : []}
                    phaseErrors={incidentAiMeta.phase_errors || {}}
                    busy={reinvestigating}
                  />

                  {/* ===== DATA INCIDENT OVERVIEW — editable AI analysis (Markdown), mirrors the Report editor ===== */}
                  <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 bg-gradient-to-r from-violet-50 to-[var(--s1)] border-b border-[var(--b1)] flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Activity size={14} className="text-violet-600" />
                        <p className="text-[0.75rem] font-black text-[var(--t7)]">Data incident Overview</p>
                        <span className="text-[0.48rem] font-black text-[var(--t3)] uppercase tracking-widest bg-[var(--s2)] px-1.5 py-0.5 rounded">Markdown</span>
                        {ai.risk_score != null && <span className="text-[0.55rem] font-black text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full uppercase tracking-widest">Risk {ai.risk_score}</span>}
                        {ai.confidence != null && <span className="text-[0.55rem] font-black text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full uppercase tracking-widest">{Math.round(ai.confidence * 100)}% conf</span>}
                      </div>
                      {!overviewEditing && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {overviewBody && <CopyButton text={overviewBody} />}
                          <button onClick={downloadOverview} title="Download the overview as a Markdown file"
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.62rem] font-bold text-[var(--t6)] border border-[var(--b2)] bg-[var(--s0)] hover:bg-[var(--s1)] transition-colors">
                            <Download size={11} /> Download
                          </button>
                          {canEdit && !isClosed && (
                            <button onClick={handleRunInvestigation} disabled={reinvestigating} title="Re-run the AI agents to (re)generate the analysis"
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.62rem] font-bold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-60 transition-colors">
                              {reinvestigating ? <><RefreshCw size={11} className="animate-spin" /> Generating…</> : <><Activity size={11} /> {overviewBody ? 'Regenerate' : 'Generate'}</>}
                            </button>
                          )}
                          {canEdit && !isClosed && (
                            <button onClick={() => { setOverviewDraft(overviewBody); setOverviewEditing(true); }}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.62rem] font-bold text-[var(--p1)] border border-[var(--p1)] hover:bg-blue-50 transition-colors">
                              <FileText size={11} /> Edit
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="p-4 space-y-4 text-[0.78rem] text-[var(--t6)] leading-relaxed">
                      {overviewEditing ? (
                        <>
                          <p className="text-[0.6rem] text-[var(--t3)]">Edit the incident overview in Markdown. Use “Insert AI analysis” to start from the latest agent output.</p>
                          <div className="grid lg:grid-cols-2 gap-3">
                            <div className="flex flex-col">
                              <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Markdown source</p>
                              <textarea value={overviewDraft} onChange={e => setOverviewDraft(e.target.value)} rows={18}
                                placeholder="Write the incident overview in Markdown — ## headings, **bold**, tables, - lists…"
                                className="w-full flex-1 border border-[var(--b2)] rounded-lg px-3 py-2 text-[0.74rem] font-mono outline-none focus:border-[var(--p1)] bg-[var(--s0)] resize-y leading-relaxed min-h-[18rem]" />
                            </div>
                            <div className="flex flex-col">
                              <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Live preview</p>
                              <div className="border border-[var(--b2)] rounded-lg p-3 bg-[var(--s1)]/30 min-h-[18rem] max-h-[34rem] overflow-y-auto">
                                {overviewDraft.trim() ? <Markdown>{overviewDraft}</Markdown> : <p className="text-[0.74rem] italic text-[var(--t4)]">Nothing to preview yet…</p>}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 mt-1 flex-wrap items-center">
                            <button onClick={handleSaveOverview} disabled={overviewSaving}
                              className="px-4 py-2 rounded-lg bg-[var(--p1)] text-white text-[0.72rem] font-bold disabled:opacity-50 flex items-center gap-1">
                              {overviewSaving ? 'Saving...' : <><CheckCircle size={12} /> Save Overview</>}
                            </button>
                            <button onClick={() => { setOverviewEditing(false); setOverviewDraft(overviewBody); }}
                              className="px-4 py-2 rounded-lg border border-[var(--b2)] text-[var(--t5)] text-[0.72rem] font-semibold">Cancel</button>
                            {aiReportMd && (
                              <button onClick={() => setOverviewDraft(aiReportMd)} title="Replace the draft with the latest AI analysis (Markdown)"
                                className="ml-auto px-3 py-2 rounded-lg border border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100 text-[0.7rem] font-bold flex items-center gap-1.5">
                                <Activity size={12} /> Insert AI analysis
                              </button>
                            )}
                          </div>
                        </>
                      ) : (overviewBody || hasAnyAi) ? (
                        <>
                        {/* Why escalated (real reasons only — legacy backfill placeholder suppressed) */}
                        {realReason(detail.reason) && (
                          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                            <p className="text-[0.55rem] font-black text-orange-800 uppercase tracking-widest mb-1">Why this was escalated</p>
                            <p className="text-orange-900 text-[0.74rem] whitespace-pre-line">{realReason(detail.reason)}</p>
                          </div>
                        )}

                        {/* Editable analysis body (Markdown) — saved override or the AI report. */}
                        {overviewBody ? (
                          <Markdown>{overviewBody}</Markdown>
                        ) : (
                          <p className="text-[0.74rem] text-[var(--t4)] italic">No written overview yet — use Generate above, or Edit to write one.</p>
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
                        </>
                      ) : (
                        <div className="text-center py-8">
                          <Activity size={26} className="mx-auto text-[var(--t3)] opacity-50 mb-2" />
                          <p className="text-[0.82rem] font-bold text-[var(--t6)]">No overview recorded for this incident yet</p>
                          <p className="text-[0.7rem] text-[var(--t3)] mt-1 max-w-md mx-auto">
                            Run the AI agents to generate the analysis, threat intel, IOCs and recommended actions — or write the overview yourself in Markdown.
                          </p>
                          <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                            {canEdit && !isClosed && (
                              <button onClick={handleRunInvestigation} disabled={reinvestigating}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-[0.74rem] font-bold hover:bg-violet-700 disabled:opacity-60 transition-colors">
                                {reinvestigating ? <><RefreshCw size={13} className="animate-spin" /> Running investigation…</> : <><Zap size={13} /> Run AI Investigation</>}
                              </button>
                            )}
                            {canEdit && !isClosed && (
                              <button onClick={() => { setOverviewDraft(''); setOverviewEditing(true); }}
                                className="px-4 py-2 rounded-lg border border-[var(--b2)] text-[var(--t5)] text-[0.74rem] font-bold hover:bg-[var(--s1)]">
                                Write manually
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ===== Correlated alerts — compact, scrollable, expandable (after the AI summary) ===== */}
                  {(detail.alerts && detail.alerts.length > 0) ? (
                    <CorrelatedAlertsTable alerts={detail.alerts} />
                  ) : (
                    <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl p-6 text-center text-[var(--t3)] text-[0.72rem]">
                      No Wazuh alerts linked to this incident.
                    </div>
                  )}

                  {/* ===== Agent reasoning — collapsed by default, expand to view ===== */}
                  <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                    <button
                      onClick={() => {
                        const next = !showOverviewReasoning;
                        setShowOverviewReasoning(next);
                        if (next && reasoning.length === 0 && !loadingReasoning) {
                          setLoadingReasoning(true);
                          getIncidentReasoning(detail.id).then(d => setReasoning(d.reasoning || [])).catch(() => {}).finally(() => setLoadingReasoning(false));
                        }
                      }}
                      className="w-full px-4 py-2.5 bg-[var(--s1)] flex items-center gap-2 hover:bg-[var(--s2)] transition-colors text-left">
                      <Activity size={13} className="text-violet-600" />
                      <p className="text-[0.72rem] font-black text-[var(--t7)]">Agent Reasoning{reasoning.length ? ` (${reasoning.length})` : ''}</p>
                      <span className="ml-auto text-[0.6rem] text-[var(--t3)] font-semibold">{showOverviewReasoning ? 'Hide' : 'Show'}</span>
                      <ChevronRight size={14} className={`text-[var(--t3)] transition-transform ${showOverviewReasoning ? 'rotate-90' : ''}`} />
                    </button>
                    {showOverviewReasoning && (
                      <div className="border-t border-[var(--b1)] p-4">
                        {loadingReasoning ? (
                          <p className="text-[0.72rem] text-[var(--t3)] text-center py-4"><RefreshCw size={14} className="inline animate-spin mr-1" /> Loading reasoning…</p>
                        ) : reasoning.length === 0 ? (
                          <div className="text-center py-4">
                            <p className="text-[0.74rem] text-[var(--t5)]">No agent reasoning recorded yet.</p>
                            <button onClick={handleRunInvestigation} disabled={reinvestigating}
                              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-[0.7rem] font-bold hover:bg-violet-700 disabled:opacity-60">
                              {reinvestigating ? <><RefreshCw size={12} className="animate-spin" /> Running…</> : <><Zap size={12} /> Run investigation</>}
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-[28rem] overflow-y-auto">
                            {reasoning.map((r, i) => (
                              <div key={i} className="border border-[var(--b2)] rounded-lg p-2.5 bg-[var(--s1)]/40">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[0.6rem] font-black text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded uppercase tracking-wide">{r.agent}</span>
                                  {typeof r.confidence === 'number' && r.confidence > 0 && (
                                    <span className="text-[0.58rem] text-[var(--t4)] font-mono">{Math.round(r.confidence <= 1 ? r.confidence * 100 : r.confidence)}% conf</span>
                                  )}
                                </div>
                                {r.decision && <p className="text-[0.72rem] text-[var(--t6)] leading-relaxed">{r.decision}</p>}
                                {r.evidence_for?.length > 0 && <p className="text-[0.64rem] text-emerald-700 mt-1">✓ {r.evidence_for.slice(0, 3).join(' · ')}</p>}
                                {r.evidence_against?.length > 0 && <p className="text-[0.64rem] text-red-700 mt-0.5">✗ {r.evidence_against.slice(0, 3).join(' · ')}</p>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ===== SOC Analysis Prompt — static template (no AI), copy into an external AI chat ===== */}
                  {(() => {
                    const socPrompt = buildSocAnalysisPrompt(detail.id, detail.title, latestAlertRawJson(detail.alerts));
                    return (
                      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                        <div className="px-4 py-2.5 bg-[var(--s1)] flex items-center gap-2 flex-wrap">
                          <Sparkles size={13} className="text-[var(--p1)]" />
                          <p className="text-[0.72rem] font-black text-[var(--t7)]">SOC Analysis Prompt</p>
                          <span className="text-[0.55rem] text-[var(--t3)] font-semibold hidden md:inline">incident ID + title + latest raw alert → ready-to-paste prompt</span>
                          <div className="ml-auto flex items-center gap-1.5">
                            <CopyButton text={socPrompt} />
                            <button onClick={() => setShowSocPrompt(s => !s)}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--b2)] bg-[var(--s0)] hover:bg-[var(--s1)] text-[0.62rem] font-bold text-[var(--t5)] transition-colors">
                              {showSocPrompt ? 'Hide' : 'Show'} prompt
                              <ChevronRight size={12} className={`transition-transform ${showSocPrompt ? 'rotate-90' : ''}`} />
                            </button>
                          </div>
                        </div>
                        {showSocPrompt && (
                          <div className="border-t border-[var(--b1)] p-3">
                            <pre className="text-[0.68rem] bg-slate-950 text-slate-200 p-4 rounded-xl overflow-x-auto font-mono leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap break-words">{socPrompt}</pre>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* ===== Resolution & Closure Report Prompt — static template (no AI) ===== */}
                  {(() => {
                    const reportPrompt = buildSocResolutionReportPrompt(detail.id, detail.title);
                    return (
                      <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl overflow-hidden">
                        <div className="px-4 py-2.5 bg-[var(--s1)] flex items-center gap-2 flex-wrap">
                          <FileText size={13} className="text-emerald-600" />
                          <p className="text-[0.72rem] font-black text-[var(--t7)]">Resolution Report Prompt</p>
                          <span className="text-[0.55rem] text-[var(--t3)] font-semibold hidden md:inline">incident ID + title → ITILv4 / ISO 27035 closure report prompt</span>
                          <div className="ml-auto flex items-center gap-1.5">
                            <CopyButton text={reportPrompt} />
                            <button onClick={() => setShowResolutionPrompt(s => !s)}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--b2)] bg-[var(--s0)] hover:bg-[var(--s1)] text-[0.62rem] font-bold text-[var(--t5)] transition-colors">
                              {showResolutionPrompt ? 'Hide' : 'Show'} prompt
                              <ChevronRight size={12} className={`transition-transform ${showResolutionPrompt ? 'rotate-90' : ''}`} />
                            </button>
                          </div>
                        </div>
                        {showResolutionPrompt && (
                          <div className="border-t border-[var(--b1)] p-3">
                            <pre className="text-[0.68rem] bg-slate-950 text-slate-200 p-4 rounded-xl overflow-x-auto font-mono leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap break-words">{reportPrompt}</pre>
                          </div>
                        )}
                      </div>
                    );
                  })()}

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
                  <div className="px-4 py-2.5 bg-[var(--s1)] border-b border-[var(--b1)] flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <FileText size={13} className="text-[var(--p1)]" />
                      <p className="text-[0.72rem] font-black text-[var(--t7)]">Final Incident Report</p>
                      <span className="text-[0.48rem] font-black text-[var(--t3)] uppercase tracking-widest bg-[var(--s2)] px-1.5 py-0.5 rounded">Markdown</span>
                    </div>
                    {!reportEditing && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button onClick={() => setShowReportHistory(s => !s)} title="View report change history"
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.62rem] font-bold border transition-colors ${showReportHistory ? 'bg-[var(--p1)] text-white border-[var(--p1)]' : 'text-[var(--t6)] border-[var(--b2)] bg-[var(--s0)] hover:bg-[var(--s1)]'}`}>
                          <Clock size={11} /> History{reportHistory.length ? ` (${reportHistory.length})` : ''}
                        </button>
                        {detail.report_body && <CopyButton text={detail.report_body} />}
                        <button onClick={downloadReport} title="Download the report as a Markdown file"
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.62rem] font-bold text-[var(--t6)] border border-[var(--b2)] bg-[var(--s0)] hover:bg-[var(--s1)] transition-colors">
                          <Download size={11} /> Download
                        </button>
                        {!isClosed && canEdit && (
                          <button onClick={handleToggleLock} disabled={locking || (isReportLocked && !reportLockedByMe && !isAdminOrLead)}
                            title={isReportLocked ? (reportLockedByMe || isAdminOrLead ? 'Unlock the report' : `Locked by ${detail.report_locked_by_username || 'another analyst'}`) : 'Lock the report so only you can edit it'}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.62rem] font-bold border transition-colors disabled:opacity-60 ${isReportLocked ? 'text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100' : 'text-[var(--t6)] border-[var(--b2)] bg-[var(--s0)] hover:bg-[var(--s1)]'}`}>
                            {locking ? <RefreshCw size={11} className="animate-spin" /> : isReportLocked ? <Unlock size={11} /> : <Lock size={11} />}
                            {isReportLocked ? 'Unlock' : 'Lock'}
                          </button>
                        )}
                        {canManageReport && (
                          <button onClick={handleGenerateReport} disabled={generatingReport} title="Have the AI write the incident report"
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.62rem] font-bold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-60 transition-colors">
                            {generatingReport ? <><RefreshCw size={11} className="animate-spin" /> Generating…</> : <><Activity size={11} /> {detail.report_body ? 'Regenerate' : 'Generate'}</>}
                          </button>
                        )}
                        {canManageReport && (
                          <button onClick={() => setReportEditing(true)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.62rem] font-bold text-[var(--p1)] border border-[var(--p1)] hover:bg-blue-50 transition-colors">
                            <FileText size={11} /> Edit
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    {/* Static report header — always present, never editable */}
                    <div className="mb-4 rounded-lg border border-[var(--b1)] bg-[var(--s1)]/40 p-4">
                      <h3 className="text-[0.98rem] font-black text-[var(--t7)] leading-tight">{detail.title}</h3>
                      <p className="text-[0.6rem] font-mono text-[var(--t3)] mt-0.5 mb-3">Final / Post-Incident Report · {detail.id}</p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2.5">
                        {reportMeta.map((m, i) => (
                          <div key={i}>
                            <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase tracking-widest mb-0.5">{m.label}</p>
                            <p className="text-[0.72rem] font-semibold text-[var(--t6)] truncate" title={m.value}>{m.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Locked banner */}
                    {isReportLocked && (
                      <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
                        <Lock size={13} className="text-amber-700 shrink-0" />
                        <p className="text-[0.72rem] text-amber-900 flex-1">
                          Report <span className="font-bold">locked</span> by <span className="font-bold">{detail.report_locked_by_username || 'an analyst'}</span>
                          {detail.report_locked_at ? ` · ${new Date(detail.report_locked_at).toLocaleString()}` : ''}
                          {!reportLockedByMe && !isAdminOrLead ? ' — editing is disabled until they unlock it.' : ''}
                        </p>
                      </div>
                    )}

                    {/* Change history */}
                    {showReportHistory && (
                      <div className="mb-4 rounded-lg border border-[var(--b1)] bg-[var(--s1)]/30 overflow-hidden">
                        <div className="px-3 py-2 border-b border-[var(--b1)] flex items-center gap-2">
                          <Clock size={12} className="text-[var(--t4)]" />
                          <p className="text-[0.6rem] font-black text-[var(--t4)] uppercase tracking-widest">Report Change History</p>
                        </div>
                        {reportHistory.length === 0 ? (
                          <p className="px-3 py-3 text-[0.7rem] text-[var(--t3)] italic">No changes recorded yet.</p>
                        ) : (
                          <div className="max-h-72 overflow-y-auto divide-y divide-[var(--b1)]">
                            {reportHistory.map(h => {
                              const verb = h.action === 'edited' ? 'edited the report' : h.action === 'generated' ? 'generated the report (AI)' : h.action === 'locked' ? 'locked the report' : h.action === 'unlocked' ? 'unlocked the report' : h.action;
                              const dot = h.action === 'locked' ? 'bg-amber-500' : h.action === 'unlocked' ? 'bg-emerald-500' : h.action === 'generated' ? 'bg-violet-500' : 'bg-[var(--p1)]';
                              return (
                                <div key={h.id} className="px-3 py-2 flex items-center gap-2.5 text-[0.7rem]">
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                                  <span className="text-[var(--t6)] flex-1 min-w-0 truncate">
                                    <span className="font-bold">{h.username || 'system'}</span> {verb}
                                  </span>
                                  {h.snapshot && (h.action === 'edited' || h.action === 'generated') && (
                                    <button onClick={() => setHistorySnapshot(h)} className="text-[0.62rem] font-bold text-[var(--p1)] hover:underline shrink-0">view</button>
                                  )}
                                  <span className="text-[0.62rem] text-[var(--t3)] shrink-0" title={new Date(h.created_at).toLocaleString()}>{new Date(h.created_at).toLocaleString()}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {reportEditing ? (
                      <>
                        <p className="text-[0.6rem] text-[var(--t3)] mb-2">The header above is generated automatically. Edit only the report body below.</p>
                        <div className="grid lg:grid-cols-2 gap-3">
                          <div className="flex flex-col">
                            <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Markdown source (body)</p>
                            <textarea value={reportDraft} onChange={e => setReportDraft(e.target.value)} rows={20}
                              placeholder="Write the report in Markdown — ## headings, **bold**, tables, - lists, [links](url)…"
                              className="w-full flex-1 border border-[var(--b2)] rounded-lg px-3 py-2 text-[0.74rem] font-mono outline-none focus:border-[var(--p1)] bg-[var(--s0)] resize-y leading-relaxed min-h-[20rem]" />
                          </div>
                          <div className="flex flex-col">
                            <p className="text-[0.5rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1">Live preview</p>
                            <div className="border border-[var(--b2)] rounded-lg p-3 bg-[var(--s1)]/30 min-h-[20rem] max-h-[34rem] overflow-y-auto">
                              {reportDraft.trim() ? <Markdown>{reportDraft}</Markdown> : <p className="text-[0.74rem] italic text-[var(--t4)]">Nothing to preview yet…</p>}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3 flex-wrap items-center">
                          <button onClick={handleSaveReport} disabled={reportSaving}
                            className="px-4 py-2 rounded-lg bg-[var(--p1)] text-white text-[0.72rem] font-bold disabled:opacity-50 flex items-center gap-1">
                            {reportSaving ? 'Saving...' : <><CheckCircle size={12} /> Save Report</>}
                          </button>
                          <button onClick={() => { setReportEditing(false); setReportDraft(detail.report_body || ''); }}
                            className="px-4 py-2 rounded-lg border border-[var(--b2)] text-[var(--t5)] text-[0.72rem] font-semibold">Cancel</button>
                          {(ai.ticket_summary || ai.summary) && (
                            <button onClick={() => setReportDraft(String(ai.ticket_summary || ai.summary))} title="Replace the draft with the AI analysis (Markdown)"
                              className="ml-auto px-3 py-2 rounded-lg border border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100 text-[0.7rem] font-bold flex items-center gap-1.5">
                              <Activity size={12} /> Insert AI analysis
                            </button>
                          )}
                        </div>
                      </>
                    ) : detail.report_body ? (
                      <Markdown>{detail.report_body}</Markdown>
                    ) : (
                      <div className="text-center py-8">
                        <FileText size={28} className="mx-auto text-[var(--t3)] mb-2" />
                        <p className="text-[0.82rem] font-semibold text-[var(--t5)]">No report written yet</p>
                        <p className="text-[0.68rem] text-[var(--t3)] mt-1 mb-3">Let the AI write it, or start from scratch in Markdown.</p>
                        {canEdit && !isClosed && (
                          <div className="flex items-center justify-center gap-2 flex-wrap">
                            <button onClick={handleGenerateReport} disabled={generatingReport}
                              className="px-4 py-2 rounded-lg bg-violet-600 text-white text-[0.72rem] font-bold hover:bg-violet-700 disabled:opacity-60 flex items-center gap-1.5">
                              {generatingReport ? <><RefreshCw size={12} className="animate-spin" /> Generating…</> : <><Activity size={12} /> Generate Report</>}
                            </button>
                            <button onClick={() => setReportEditing(true)} className="px-4 py-2 rounded-lg border border-[var(--b2)] text-[var(--t5)] text-[0.72rem] font-bold hover:bg-[var(--s1)]">
                              Write manually
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Report snapshot viewer (from history) */}
              {historySnapshot && (
                <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-6" onClick={() => setHistorySnapshot(null)}>
                  <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                    <div className="px-4 py-2.5 bg-[var(--s1)] border-b border-[var(--b1)] flex items-center justify-between">
                      <div>
                        <p className="text-[0.72rem] font-black text-[var(--t7)]">Report snapshot</p>
                        <p className="text-[0.6rem] text-[var(--t3)]">{historySnapshot.username || 'system'} · {new Date(historySnapshot.created_at).toLocaleString()}</p>
                      </div>
                      <button onClick={() => setHistorySnapshot(null)} className="text-[var(--t3)] hover:text-[var(--t6)]"><X size={16} /></button>
                    </div>
                    <div className="p-4 overflow-y-auto">
                      <Markdown>{historySnapshot.snapshot || '(empty)'}</Markdown>
                    </div>
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
        description="Manage escalated security incidents through their full lifecycle."
        right={
          <button onClick={() => { resetCreateForm(); setShowCreate(true); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--p1)] text-white text-[0.78rem] font-bold shadow-sm hover:opacity-90 transition-opacity">
            <Plus size={15} /> New Incident
          </button>
        } />

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

      {/* ===== Create Incident modal — manual incident, no Wazuh alert required ===== */}
      {showCreate && (
        <div className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !creating && setShowCreate(false)}>
          <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="sticky top-0 z-10 px-5 py-3.5 bg-gradient-to-r from-[var(--p1)] to-[var(--pd)] flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center shrink-0"><Plus size={16} className="text-white" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-[0.85rem] font-black text-white leading-tight">Create Incident</p>
                <p className="text-[0.6rem] text-white/80">Open an incident manually — no Wazuh alert required</p>
              </div>
              <button onClick={() => !creating && setShowCreate(false)} className="text-white/80 hover:text-white transition-colors"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Quick-start templates */}
              <div>
                <p className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">Quick start (optional)</p>
                <div className="flex flex-wrap gap-1.5">
                  {INCIDENT_TEMPLATES.map(t => (
                    <button key={t.key} type="button" onClick={() => applyCreateTemplate(t)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[0.66rem] font-bold transition-all ${t.tint} ${cTemplate === t.key ? 'ring-2 ring-[var(--p1)]' : 'hover:brightness-95'}`}>
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest">Title <span className="text-red-500">*</span></label>
                <input value={cTitle} onChange={e => setCTitle(e.target.value)} autoFocus maxLength={200}
                  placeholder="e.g. Suspicious PowerShell execution on SRV-DC-01"
                  className="mt-1 w-full border border-[var(--b2)] rounded-lg px-3 py-2 text-[0.78rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)]" />
              </div>

              {/* Severity segmented control */}
              <div>
                <label className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest">Severity</label>
                <div className="mt-1 flex gap-1.5">
                  {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(s => (
                    <button key={s} type="button" onClick={() => setCSeverity(s)}
                      className={`flex-1 px-2 py-1.5 rounded-lg border text-[0.62rem] font-black uppercase tracking-wider transition-all ${cSeverity === s ? `${SEV_COLORS[s]} ring-2 ring-[var(--p1)]` : 'border-[var(--b2)] text-[var(--t4)] bg-[var(--s0)] hover:bg-[var(--s1)]'}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Phase + assignee */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest">Phase</label>
                  <select value={cPhase} onChange={e => setCPhase(e.target.value as IncidentPhase)}
                    className="mt-1 w-full border border-[var(--b2)] rounded-lg px-3 py-2 text-[0.74rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)]">
                    {INCIDENT_PHASES.map(p => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest">Assign to</label>
                  <select value={cAssignee} onChange={e => setCAssignee(e.target.value === '' ? '' : Number(e.target.value))}
                    className="mt-1 w-full border border-[var(--b2)] rounded-lg px-3 py-2 text-[0.74rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)]">
                    <option value="">Unassigned</option>
                    {analysts.map(a => <option key={a.id} value={a.id}>{a.username} ({a.role})</option>)}
                  </select>
                </div>
              </div>

              {/* Why / context */}
              <div>
                <label className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest">Why / context (optional)</label>
                <textarea value={cReason} onChange={e => setCReason(e.target.value)} rows={2}
                  placeholder="Short reason this incident was opened (recorded on the timeline)…"
                  className="mt-1 w-full border border-[var(--b2)] rounded-lg px-3 py-2 text-[0.74rem] outline-none focus:border-[var(--p1)] bg-[var(--s0)] resize-y" />
              </div>

              {/* Overview (Markdown) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[0.55rem] font-black text-[var(--t3)] uppercase tracking-widest">Incident overview (Markdown, optional)</label>
                  {cOverview.trim() && (
                    <button type="button" onClick={() => setCPreview(p => !p)} className="text-[0.6rem] font-bold text-[var(--p1)] hover:underline">
                      {cPreview ? 'Edit' : 'Preview'}
                    </button>
                  )}
                </div>
                {cPreview ? (
                  <div className="border border-[var(--b2)] rounded-lg p-3 bg-[var(--s1)]/30 min-h-[8rem] max-h-64 overflow-y-auto">
                    {cOverview.trim() ? <Markdown>{cOverview}</Markdown> : <p className="text-[0.72rem] italic text-[var(--t4)]">Nothing to preview…</p>}
                  </div>
                ) : (
                  <textarea value={cOverview} onChange={e => setCOverview(e.target.value)} rows={7}
                    placeholder="## Summary&#10;…"
                    className="w-full border border-[var(--b2)] rounded-lg px-3 py-2 text-[0.72rem] font-mono outline-none focus:border-[var(--p1)] bg-[var(--s0)] resize-y leading-relaxed" />
                )}
                <p className="text-[0.58rem] text-[var(--t3)] mt-1">Seeds the editable “Data incident Overview” card on the new incident.</p>
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 px-5 py-3 bg-[var(--s0)] border-t border-[var(--b1)] flex items-center justify-end gap-2">
              <button type="button" onClick={() => !creating && setShowCreate(false)}
                className="px-4 py-2 rounded-lg border border-[var(--b2)] text-[var(--t5)] text-[0.74rem] font-semibold hover:bg-[var(--s1)]">Cancel</button>
              <button type="button" onClick={handleCreateManual} disabled={creating || !cTitle.trim()}
                className="px-5 py-2 rounded-lg bg-[var(--p1)] text-white text-[0.74rem] font-bold disabled:opacity-50 flex items-center gap-1.5">
                {creating ? <><RefreshCw size={13} className="animate-spin" /> Creating…</> : <><Plus size={14} /> Create Incident</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

