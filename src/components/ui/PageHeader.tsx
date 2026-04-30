import React from 'react';

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  right?: React.ReactNode;
};

export default function PageHeader({ eyebrow, title, description, right }: PageHeaderProps) {
  return (
    <div className="flex items-end justify-between border-b border-[var(--b2)] pb-6 mb-6">
      <div className="space-y-1">
        {eyebrow && (
          <p className="text-[0.65rem] font-black uppercase tracking-[0.2em] text-[var(--p1)] opacity-80 mb-1">
            {eyebrow}
          </p>
        )}
        <h2 className="text-3xl font-black text-[var(--t1)] tracking-tight leading-tight">
          {title}
        </h2>
        {description && (
          <p className="text-[0.9rem] text-[var(--t4)] max-w-2xl leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {right && (
        <div className="pb-1">
          {right}
        </div>
      )}
    </div>
  );
}
