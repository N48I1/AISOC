import React, { useState, useEffect } from 'react';
import { Shield, AlertTriangle, AlertOctagon, Activity, FileText, Settings, LogOut, Search, Bell, User, CheckCircle, XCircle, Clock, ChevronRight, BarChart3, Terminal, Filter, Plus, X, UserPlus, Eye, ThumbsUp, ThumbsDown, ChevronDown, BookOpen, Trash2, Send, Zap, Mail, ExternalLink, ToggleLeft, ToggleRight, RefreshCw, PanelLeftOpen, PanelLeftClose, Database, Copy, Key, Webhook, Hash, Globe, Crosshair, ListChecks, MessageSquare, Laptop, Link2, ChevronUp, Lock, Palette, MapPin, Edit3, Camera } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { User as UserType, Alert, AgentRun, Stats, UserRole, Integration, ActionLog, ReportRow, ReportSummary, ROLE_LABELS, ROLE_LEVEL } from '../../types';

// --- Confirm Modal ---


// --- Components ---

const Sidebar = ({ activeTab, setActiveTab }: { activeTab: string, setActiveTab: (t: string) => void }) => {
  const { logout, user, hasRole } = useAuth();
  const [expanded, setExpanded] = useState<boolean>(() => {
    const stored = localStorage.getItem('soc_sidebar_expanded');
    return stored === null ? true : stored === 'true';
  });

  useEffect(() => {
    localStorage.setItem('soc_sidebar_expanded', String(expanded));
  }, [expanded]);

  // Role-gated menu: minRole defines the minimum role required to see each item
  const menuSections: Array<{ label: string; items: Array<{ id: string; icon: any; label: string; minRole?: string }> }> = [
    {
      label: 'Operations',
      items: [
        { id: 'dashboard',        icon: BarChart3,     label: 'Dashboard' },
        { id: 'noise-filter',     icon: Filter,        label: 'Noise Filter' },
        { id: 'investigation',    icon: AlertTriangle, label: 'Alerts Queue' },
        { id: 'fp-archive',       icon: XCircle,       label: 'FP Archive' },
      ],
    },
    {
      label: 'Response',
      items: [
        { id: 'incidents',        icon: AlertOctagon,  label: 'Incidents' },
        { id: 'response-actions', icon: Zap,           label: 'Response Actions', minRole: 'TIER2' },
      ],
    },
    {
      label: 'Memory',
      items: [
        { id: 'reports',          icon: FileText,      label: 'Reports' },
        { id: 'knowledge',        icon: BookOpen,      label: 'Knowledge Base' },
      ],
    },
    {
      label: 'Config',
      items: [
        { id: 'integrations',     icon: Send,          label: 'Integrations', minRole: 'INCIDENT_LEAD' },
        { id: 'settings',         icon: Settings,      label: 'Admin Ops', minRole: 'ADMIN' },
      ],
    },
  ];

  return (
    <aside className={`bg-[var(--s0)] border-r border-[var(--b1)] h-full flex flex-col transition-[width] duration-300 ease-in-out overflow-hidden shrink-0 ${expanded ? 'w-[220px]' : 'w-16'}`}>
      <div className="flex items-center justify-between px-4 py-4 shrink-0">
        <div className={`overflow-hidden transition-opacity duration-300 ${expanded ? 'opacity-100' : 'opacity-0'}`}>
          <span className="text-[0.65rem] font-black uppercase tracking-[0.2em] text-[var(--p1)]">Aegis</span>
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--t3)] hover:text-[var(--p1)] hover:bg-[var(--sa)] transition-all"
        >
          {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      </div>

      <nav className="flex-1 flex flex-col gap-1 px-2 overflow-y-auto">
        {menuSections.map((section, sIdx) => {
          const visibleItems = section.items.filter(item => !item.minRole || hasRole(item.minRole));
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.label} className={sIdx > 0 ? 'mt-3' : ''}>
              {expanded ? (
                <p className="px-3 pt-1 pb-1 text-[0.55rem] font-black uppercase tracking-[0.2em] text-[var(--t3)]">
                  {section.label}
                </p>
              ) : (
                sIdx > 0 && <div className="mx-3 my-1 border-t border-[var(--b1)]" />
              )}
              <div className="flex flex-col gap-1">
                {visibleItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`flex items-center gap-3 py-2.5 rounded-xl transition-all ${
                      activeTab === item.id
                        ? 'text-white bg-gradient-to-r from-[var(--p1)] to-[var(--pd)] shadow-lg shadow-blue-500/20 font-semibold'
                        : 'text-[var(--t2)] hover:bg-[var(--sa)] hover:text-[var(--p1)]'
                    } ${expanded ? 'px-4' : 'px-3 justify-center'}`}
                  >
                    <item.icon className="w-[18px] h-[18px] shrink-0" />
                    <span className={`whitespace-nowrap text-[0.85rem] transition-all duration-300 ${expanded ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2 w-0'}`}>
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-[var(--b1)] space-y-2">
        <button
          onClick={() => setActiveTab('profile')}
          className={`w-full flex items-center gap-3 p-2 rounded-xl hover:bg-[var(--sa)] transition-all text-left ${activeTab === 'profile' ? 'bg-[var(--sa)]' : ''} ${!expanded && 'justify-center'}`}
        >
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[0.7rem] font-black shadow-sm shrink-0" style={{ backgroundColor: user?.avatar_color || '#3b82f6' }}>
            {(user?.display_name || user?.username || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
          </div>
          <div className={`overflow-hidden transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>
            <p className="text-[0.75rem] font-bold text-[var(--t1)] truncate">{user?.display_name || user?.username}</p>
            <p className="text-[0.6rem] font-black text-[var(--p1)] uppercase tracking-wider">{ROLE_LABELS[user?.role as UserRole] || user?.role}</p>
          </div>
        </button>
        <button
          onClick={logout}
          className={`w-full flex items-center gap-3 p-2 rounded-xl text-[var(--t4)] hover:text-red-500 hover:bg-red-50 transition-all ${!expanded && 'justify-center'}`}
        >
          <LogOut className="w-[18px] h-[18px] shrink-0" />
          <span className={`whitespace-nowrap text-[0.8rem] font-bold transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};


export { Sidebar };
