import { createContext, useContext } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export interface ToastItem { id: string; message: string; type: 'success' | 'error' | 'info'; }

export const ToastContext = createContext<(msg: string, type?: ToastItem['type']) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export const ToastContainer = ({ toasts }: { toasts: ToastItem[] }) => (
  <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
    <AnimatePresence>
      {toasts.map(t => (
        <motion.div
          key={t.id}
          initial={{ opacity: 0, x: 60, scale: 0.9 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 60, scale: 0.9 }}
          transition={{ duration: 0.2 }}
          className={`px-4 py-3 rounded-lg shadow-lg text-[0.82rem] font-semibold text-white max-w-[320px] pointer-events-auto ${
            t.type === 'success' ? 'bg-[#1e8e3e]' :
            t.type === 'error'   ? 'bg-[#d93025]' :
            'bg-[var(--p1)]'
          }`}
        >
          {t.type === 'success' ? '✓ ' : t.type === 'error' ? '✕ ' : 'ℹ '}{t.message}
        </motion.div>
      ))}
    </AnimatePresence>
  </div>
);
