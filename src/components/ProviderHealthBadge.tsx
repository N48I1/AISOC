import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { getAiHealth, testLlmProvider, testLocalLLM, type AiHealth } from '../services/aiService';
import { useAuth } from '../contexts/AuthContext';
import { ROLE_LEVEL } from '../types';
import { useToast } from '../lib/toast';

// ─── ProviderHealthBadge ─────────────────────────────────────────────────────
// On-demand LLM provider health pill. Reads GET /api/ai/health (cached, no live
// calls). Admins get a "Test" button that actually probes each provider, then
// re-reads health. Tells operators whether it's the LLM that's down vs the app.

type Tone = 'green' | 'red' | 'amber' | 'gray';

function deriveState(h: AiHealth | null): { tone: Tone; label: string; detail: string } {
  if (!h) return { tone: 'gray', label: 'LLM …', detail: 'Checking LLM provider health…' };
  if (!h.anyConfigured) return { tone: 'gray', label: 'No LLM configured', detail: 'No enabled LLM provider or local fallback is configured.' };
  if (h.anyOk) {
    const ok = h.providers.find(p => p.enabled && p.last_test_ok === 1);
    const via = ok ? ok.name : (h.local.enabled ? `local::${h.local.model}` : 'provider');
    return { tone: 'green', label: 'LLM ready', detail: `LLM reachable via ${via}.` };
  }
  if (h.down) {
    const bad = h.providers.find(p => p.enabled && p.last_test_ok === 0);
    return { tone: 'red', label: 'LLM unreachable', detail: bad ? `${bad.name}: ${bad.last_test_error || 'last test failed'}` : 'All providers failed their last test.' };
  }
  return { tone: 'amber', label: 'LLM untested', detail: 'Providers are configured but have not been tested yet.' };
}

const DOT: Record<Tone, string> = {
  green: 'bg-emerald-500', red: 'bg-red-500', amber: 'bg-amber-500', gray: 'bg-gray-400',
};
const RING: Record<Tone, string> = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  red:   'border-red-200 bg-red-50 text-red-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  gray:  'border-[var(--b2)] bg-[var(--s1)] text-[var(--t5)]',
};

export const ProviderHealthBadge: React.FC<{ className?: string }> = ({ className }) => {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = (ROLE_LEVEL[user?.role || ''] ?? -1) >= ROLE_LEVEL.ADMIN;
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(() => {
    getAiHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Admin: actively probe every enabled provider (+ local), then re-read health.
  const runTest = useCallback(async () => {
    if (!health || testing) return;
    setTesting(true);
    try {
      const enabled = health.providers.filter(p => p.enabled);
      const results = await Promise.allSettled(enabled.map(p => testLlmProvider(p.id)));
      if (health.local.enabled) { await testLocalLLM().catch(() => {}); }
      const okCount = results.filter(r => r.status === 'fulfilled' && (r.value as any)?.ok).length;
      load();
      toast(
        okCount > 0 ? `LLM test: ${okCount}/${enabled.length} provider(s) OK` : 'LLM test: all providers failed',
        okCount > 0 ? 'success' : 'error',
      );
    } catch (e: any) {
      toast(e?.message || 'Provider test failed', 'error');
    } finally {
      setTesting(false);
    }
  }, [health, testing, load, toast]);

  const { tone, label, detail } = deriveState(health);

  return (
    <div className={`inline-flex items-center gap-2 ${className || ''}`}>
      <span title={detail}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[0.62rem] font-bold ${RING[tone]}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${DOT[tone]} ${tone === 'green' ? 'animate-pulse' : ''}`} />
        {label}
      </span>
      {isAdmin && (
        <button type="button" onClick={runTest} disabled={testing || !health?.anyConfigured} title="Test LLM providers"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--b2)] bg-[var(--s0)] text-[var(--t5)] text-[0.6rem] font-bold hover:bg-[var(--s1)] transition-colors disabled:opacity-50">
          {testing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Test
        </button>
      )}
    </div>
  );
};

export default ProviderHealthBadge;
