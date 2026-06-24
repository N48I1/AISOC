import React from 'react';

// Shared time-window options (value matches the backend `period` param).
export const PERIOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '24h', label: '24h' },
  { value: '7d',  label: 'Week' },
  { value: '30d', label: 'Month' },
  { value: '1y',  label: 'Year' },
  { value: 'all', label: 'All time' },
];

// Compact segmented control for picking a time window. Used on the Dashboard
// and the FP Archive to scope their metrics.
export const PeriodFilter: React.FC<{ value: string; onChange: (v: string) => void; className?: string }> = ({ value, onChange, className }) => (
  <div className={`inline-flex items-center rounded-lg border border-[var(--b2)] bg-[var(--s0)] p-0.5 ${className || ''}`}>
    {PERIOD_OPTIONS.map(o => (
      <button
        key={o.value}
        type="button"
        onClick={() => onChange(o.value)}
        className={`px-2.5 py-1 rounded-md text-[0.66rem] font-bold transition-colors ${
          value === o.value ? 'bg-[var(--p1)] text-white shadow-sm' : 'text-[var(--t5)] hover:bg-[var(--s1)]'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export default PeriodFilter;
