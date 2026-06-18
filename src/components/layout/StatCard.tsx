import React from 'react';

const StatCard = ({ label, value, icon: Icon, trend, color }: any) => (
  <div className="bg-[var(--s0)] border border-[var(--b1)] rounded-2xl p-6 flex flex-col gap-3 shadow-sm card-hover">
    <div className="flex justify-between items-start">
      <div className="w-10 h-10 rounded-xl bg-[var(--s1)] flex items-center justify-center border border-[var(--b2)]">
        <Icon className="w-5 h-5" style={{ color: color || 'var(--p1)' }} />
      </div>
      {trend && (
        <div className={`px-2 py-1 rounded-lg text-[0.65rem] font-black flex items-center gap-1 ${trend > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
          {trend > 0 ? '+' : ''}{trend}%
        </div>
      )}
    </div>
    <div>
      <div className="text-[1.8rem] font-black text-[var(--t1)] tracking-tight">{value}</div>
      <div className="text-[0.7rem] font-black text-[var(--t3)] uppercase tracking-[0.1em] mt-1">{label}</div>
    </div>
  </div>
);


export { StatCard };
