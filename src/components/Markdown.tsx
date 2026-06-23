import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Themed Markdown renderer for AI-generated reports (GFM: tables, lists, links).
// Styled with the app's CSS variables so it fits light/dark mode.
export const Markdown: React.FC<{ children: string; className?: string }> = ({ children, className }) => (
  <div className={`text-[0.78rem] text-[var(--t6)] leading-relaxed ${className || ''}`}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="text-[0.95rem] font-black text-[var(--t7)] mt-3 mb-1.5 first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="text-[0.85rem] font-black text-[var(--t7)] mt-3 mb-1.5 first:mt-0 flex items-center gap-1.5 before:content-[''] before:w-1 before:h-3.5 before:rounded before:bg-[var(--p1)]">{children}</h2>,
        h3: ({ children }) => <h3 className="text-[0.78rem] font-bold text-[var(--t7)] mt-2.5 mb-1">{children}</h3>,
        p:  ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="font-bold text-[var(--t7)]">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--p1)] font-semibold underline break-all hover:opacity-80">{children}</a>,
        code: ({ children }) => <code className="px-1 py-0.5 rounded bg-[var(--s1)] border border-[var(--b2)] text-[0.72rem] font-mono text-[var(--t7)] break-all">{children}</code>,
        pre: ({ children }) => <pre className="bg-slate-950 text-emerald-300 rounded-lg p-3 text-[0.7rem] font-mono overflow-x-auto my-2">{children}</pre>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-[var(--p1)] pl-3 italic text-[var(--t5)] my-2">{children}</blockquote>,
        hr: () => <hr className="my-3 border-[var(--b1)]" />,
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="w-full text-[0.72rem] border border-[var(--b1)] rounded-lg overflow-hidden">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-[var(--s1)]">{children}</thead>,
        th: ({ children }) => <th className="text-left px-3 py-1.5 font-black text-[0.6rem] uppercase tracking-wider text-[var(--t3)] border-b border-[var(--b1)]">{children}</th>,
        td: ({ children }) => <td className="px-3 py-1.5 align-top text-[var(--t6)] border-b border-[var(--b1)] break-words">{children}</td>,
      }}
    >
      {children}
    </ReactMarkdown>
  </div>
);

export default Markdown;
