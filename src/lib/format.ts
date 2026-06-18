// Shared presentational helpers used across pages/components.

export const severityChipColor = (sv: string) =>
  sv === 'CRITICAL' ? 'bg-red-100 text-red-700 border border-red-200 hover:bg-red-200' :
  sv === 'HIGH'     ? 'bg-orange-100 text-orange-700 border border-orange-200 hover:bg-orange-200' :
  sv === 'MEDIUM'   ? 'bg-amber-100 text-amber-700 border border-amber-200 hover:bg-amber-200' :
                      'bg-[var(--s1)] text-[var(--t5)] border border-[var(--b2)] hover:bg-[var(--s2)]';

export const timeAgo = (ts: number) => {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};
