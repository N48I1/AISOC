import React from 'react';

const tierFor = (score: number) =>
  score >= 80 ? { label: 'CRITICAL', text: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-300',     stroke: '#dc2626' } :
  score >= 60 ? { label: 'HIGH',     text: 'text-orange-700',  bg: 'bg-orange-50',  border: 'border-orange-300',  stroke: '#ea580c' } :
  score >= 40 ? { label: 'MEDIUM',   text: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-300',   stroke: '#d97706' } :
                { label: 'LOW',      text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300', stroke: '#10b981' };

const PriorityDonut = ({ value, size = 40 }: { value: number; size?: number }) => {
  const stroke      = 4;
  const radius      = (size - stroke) / 2;
  const circ        = 2 * Math.PI * radius;
  const pct         = Math.max(0, Math.min(100, value));
  const dashOffset  = circ - (pct / 100) * circ;
  const color       = tierFor(pct).stroke;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#e2e8f0" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
          className="transition-[stroke-dashoffset,stroke] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[0.62rem] font-black tabular-nums" style={{ color }}>
        {pct}
      </div>
    </div>
  );
};


// ─── Response Actions ───────────────────────────────────────────────────────

export { PriorityDonut, tierFor };
