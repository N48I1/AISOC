import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// Small copy-to-clipboard button with a transient "Copied" confirmation.
// Self-contained (local state, no toast dependency) so it can drop into any
// code/log block.
export const CopyButton: React.FC<{ text: string; className?: string; label?: boolean }> = ({ text, className, label = true }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard API unavailable (e.g. insecure context) — silently ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy to clipboard"
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[0.6rem] font-bold transition-colors ${
        copied
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
          : 'border-[var(--b2)] bg-[var(--s0)] text-[var(--t5)] hover:bg-[var(--s1)]'
      } ${className || ''}`}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {label && (copied ? 'Copied' : 'Copy')}
    </button>
  );
};

export default CopyButton;
