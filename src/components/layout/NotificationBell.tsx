import React, { useState, useEffect, useRef } from 'react';
import { Shield, AlertTriangle, AlertOctagon, Activity, FileText, Settings, LogOut, Search, Bell, User, CheckCircle, XCircle, Clock, ChevronRight, BarChart3, Terminal, Filter, Plus, X, UserPlus, Eye, ThumbsUp, ThumbsDown, ChevronDown, BookOpen, Trash2, Send, Zap, Mail, ExternalLink, ToggleLeft, ToggleRight, RefreshCw, PanelLeftOpen, PanelLeftClose, Database, Copy, Key, Webhook, Hash, Globe, Crosshair, ListChecks, MessageSquare, Laptop, Link2, ChevronUp, Lock, Palette, MapPin, Edit3, Camera } from 'lucide-react';
import { motion } from 'motion/react';
import { useNotifications } from '../../contexts/NotificationContext';
import { type ToastItem } from '../../lib/toast';

const NotificationBell: React.FC = () => {
  const { notifications, unreadCount, markAllRead, clearAll, remove } = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const formatRelative = (ts: number) => {
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  };

  const iconFor = (type: ToastItem['type']) =>
    type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';

  const colorFor = (type: ToastItem['type']) =>
    type === 'success' ? 'text-green-600 bg-green-50 border-green-200'
    : type === 'error' ? 'text-red-600 bg-red-50 border-red-200'
    : 'text-blue-600 bg-blue-50 border-blue-200';

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => { setOpen(o => !o); if (!open) markAllRead(); }}
        className="relative w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[var(--s1)] border border-[var(--b2)] transition-colors"
        aria-label="Notifications"
      >
        <Bell size={16} className="text-[var(--t3)]" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[0.6rem] font-black flex items-center justify-center shadow-sm">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="absolute right-0 top-[calc(100%+8px)] w-[360px] max-h-[480px] bg-[var(--s0)] border border-[var(--b1)] rounded-xl shadow-2xl flex flex-col z-[150]"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--b1)]">
            <div>
              <p className="text-[0.85rem] font-black text-[var(--t7)]">Notifications</p>
              <p className="text-[0.65rem] text-[var(--t3)]">
                {notifications.length === 0 ? 'No notifications yet' : `${notifications.length} total`}
              </p>
            </div>
            {notifications.length > 0 && (
              <button onClick={clearAll} className="text-[0.7rem] font-bold text-[var(--t3)] hover:text-red-600 transition-colors">
                Clear all
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell size={28} className="text-[var(--t3)] mx-auto mb-2 opacity-40" />
                <p className="text-[0.75rem] text-[var(--t3)]">Toasts you see in the app appear here.</p>
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={`group px-4 py-3 border-b border-[var(--b1)] last:border-b-0 hover:bg-[var(--s1)] transition-colors ${!n.read ? 'bg-[var(--s1)]/50' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 w-6 h-6 rounded-full border flex items-center justify-center text-[0.7rem] font-black shrink-0 ${colorFor(n.type)}`}>
                      {iconFor(n.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[0.78rem] text-[var(--t1)] leading-snug break-words">{n.message}</p>
                      <p className="text-[0.6rem] text-[var(--t3)] mt-1">{formatRelative(n.timestamp)}</p>
                    </div>
                    <button
                      onClick={() => remove(n.id)}
                      className="opacity-0 group-hover:opacity-100 text-[var(--t3)] hover:text-red-600 transition-opacity"
                      aria-label="Dismiss"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
};


export { NotificationBell };
