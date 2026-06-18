import React, { useState, useEffect } from 'react';
import { Shield, AlertTriangle, AlertOctagon, Activity, FileText, Settings, LogOut, Search, Bell, User, CheckCircle, XCircle, Clock, ChevronRight, BarChart3, Terminal, Filter, Plus, X, UserPlus, Eye, ThumbsUp, ThumbsDown, ChevronDown, BookOpen, Trash2, Send, Zap, Mail, ExternalLink, ToggleLeft, ToggleRight, RefreshCw, PanelLeftOpen, PanelLeftClose, Database, Copy, Key, Webhook, Hash, Globe, Crosshair, ListChecks, MessageSquare, Laptop, Link2, ChevronUp, Lock, Palette, MapPin, Edit3, Camera } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { User as UserType, Alert, AgentRun, Stats, UserRole, Integration, ActionLog, ReportRow, ReportSummary, ROLE_LABELS, ROLE_LEVEL } from '../../types';
import { NotificationBell } from './NotificationBell';
import logoBBS from '../../assets/logo-BBS.png';

const Header = () => {
  const { user, token, logout } = useAuth();
  const [ingestInfo, setIngestInfo] = useState<{
    lastHeartbeatAt: string | null;
    lastIngestAt: string | null;
    lastAlertAt: string | null;
    alertsLast5m: number;
    alertsLastHour: number;
    totalKeys: number;
    activeKeys: number;
  } | null>(null);

  useEffect(() => {
    if (!token) return;
    const fetchStatus = () => {
      fetch('/api/ingest/status', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setIngestInfo(d); })
        .catch(() => {});
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 30_000);
    return () => clearInterval(id);
  }, [token]);

  // Liveness signal priority:
  //   1. heartbeat — definitive, fires every 60s from the Wazuh-side forwarder
  //   2. ingest    — every alert hits /api/ingest, but quiet networks have none
  //   3. alert ts  — same as ingest, just a different timestamp source
  // We rank by heartbeat first because "no alerts" ≠ "Wazuh broken" on a quiet net.
  const minsSince = (ts: string | null | undefined) =>
    ts ? (Date.now() - new Date(ts).getTime()) / 60_000 : Infinity;

  const minsSinceHeartbeat = minsSince(ingestInfo?.lastHeartbeatAt);
  const minsSinceIngest    = minsSince(ingestInfo?.lastIngestAt || ingestInfo?.lastAlertAt);
  const heartbeatConfigured = isFinite(minsSinceHeartbeat);

  // 'unknown' means "no heartbeat configured yet AND no recent ingest" — quiet
  // network, can't claim broken. Show as amber/info, not red.
  // Pill must hold green for at least 5 min after the last heartbeat. After
  // that, a short amber "Lagging" band gives a visible warning before red.
  // <5 min  = Live
  // <10 min = Lagging (multiple beats missed but possibly transient)
  // >10 min = Offline (definitive failure)
  const wazuhStatus: 'healthy' | 'degraded' | 'offline' | 'unknown' =
    !ingestInfo || ingestInfo.activeKeys === 0     ? 'offline' :
    heartbeatConfigured && minsSinceHeartbeat < 5  ? 'healthy' :
    heartbeatConfigured && minsSinceHeartbeat < 10 ? 'degraded' :
    heartbeatConfigured                            ? 'offline' :
    minsSinceIngest < 5                            ? 'healthy' :
    minsSinceIngest < 30                           ? 'degraded' :
                                                     'unknown';

  const formatAgo = (mins: number) => {
    if (!isFinite(mins)) return 'never';
    if (mins < 1) return 'just now';
    if (mins < 60) return `${Math.floor(mins)}m ago`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  const tooltipText = (() => {
    if (!ingestInfo) return 'Checking ingest status…';
    if (ingestInfo.activeKeys === 0) return 'No active API keys — Wazuh cannot push alerts. Create a key in Integrations.';
    const parts: string[] = [];
    if (heartbeatConfigured)         parts.push(`Heartbeat ${formatAgo(minsSinceHeartbeat)}`);
    else                              parts.push('Heartbeat: not configured');
    parts.push(`Last alert ${formatAgo(minsSinceIngest)}`);
    parts.push(`${ingestInfo.alertsLast5m} in 5m · ${ingestInfo.alertsLastHour} in 1h`);
    parts.push(`${ingestInfo.activeKeys} active key${ingestInfo.activeKeys !== 1 ? 's' : ''}`);
    return parts.join(' · ');
  })();

  const statusColors = {
    healthy:  'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]',
    degraded: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]',
    offline:  'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]',
    unknown:  'bg-slate-400 shadow-[0_0_8px_rgba(148,163,184,0.4)]',
  };
  const statusTextColors = {
    healthy:  'text-green-700',
    degraded: 'text-amber-700',
    offline:  'text-red-700',
    unknown:  'text-slate-600',
  };
  const statusLabels = {
    healthy:  ingestInfo ? `Wazuh: Live (${ingestInfo.alertsLast5m}/5m)` : 'Wazuh: Live',
    degraded: heartbeatConfigured ? `Wazuh: Lagging ${formatAgo(minsSinceHeartbeat)}` : `Wazuh: Idle ${formatAgo(minsSinceIngest)}`,
    offline:  ingestInfo?.activeKeys === 0 ? 'Wazuh: No API Key' : 'Wazuh: Offline',
    unknown:  'Wazuh: Awaiting events',
  };
  return (
    <header className="h-[60px] bg-[var(--s0)] border-b border-[var(--b1)] text-[var(--t1)] flex items-center justify-between px-6 z-[100] sticky top-0 transition-all">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--p1)] to-[var(--pd)] flex items-center justify-center shadow-lg shadow-blue-500/20 shrink-0">
          <img src={logoBBS} className="h-5 w-5 object-contain brightness-0 invert" alt="BBS Logo" />
        </div>
        <div className="flex flex-col -space-y-1">
          <span className="text-[0.6rem] font-black uppercase tracking-[0.3em] text-[var(--t4)]">Security Operations</span>
          <div className="flex items-center">
            <span className="font-black text-xl text-[var(--t1)] tracking-tighter">BBS</span>
            <span className="font-black text-xl text-[var(--p1)] tracking-tighter ml-1">AISOC</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div
          className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--s1)] border border-[var(--b2)] cursor-help"
          title={tooltipText}
        >
          <div className={`w-2 h-2 rounded-full ${wazuhStatus === 'healthy' ? 'animate-pulse' : ''} ${statusColors[wazuhStatus]}`} />
          <span className={`text-[0.7rem] font-black uppercase tracking-wider ${statusTextColors[wazuhStatus]}`}>{statusLabels[wazuhStatus]}</span>
        </div>

        <div className="h-6 w-px bg-[var(--b2)]" />

        <div className="flex items-center gap-3 pl-2">
          <div className="flex flex-col items-end hidden sm:block">
            <p className="text-[0.8rem] font-bold text-[var(--t1)]">{user?.display_name || user?.username}</p>
            <p className="text-[0.6rem] font-black text-[var(--p1)] uppercase tracking-widest">{ROLE_LABELS[user?.role as UserRole] || user?.role}</p>
          </div>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[0.75rem] font-black shadow-sm" style={{ backgroundColor: user?.avatar_color || '#3b82f6' }}>
            {(user?.display_name || user?.username || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
          </div>
        </div>

        <NotificationBell />
      </div>
    </header>
  );
};


export { Header };
