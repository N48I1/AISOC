import { motion } from 'motion/react';

export interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmClass?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal = ({ title, message, confirmLabel = 'Confirm', confirmClass = 'bg-[#d93025] hover:bg-red-700', onConfirm, onCancel }: ConfirmModalProps) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm">
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-[var(--s0)] rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4"
    >
      <h3 className="text-[1rem] font-black text-[var(--t7)]">{title}</h3>
      <p className="text-[0.85rem] text-[var(--t5)] leading-relaxed">{message}</p>
      <div className="flex gap-3 pt-2 justify-end">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-[var(--b2)] text-[var(--t5)] font-semibold text-[0.82rem] hover:bg-[var(--s1)] transition-colors">Cancel</button>
        <button onClick={onConfirm} className={`px-4 py-2 rounded-lg text-white font-bold text-[0.82rem] transition-colors ${confirmClass}`}>{confirmLabel}</button>
      </div>
    </motion.div>
  </div>
);

export default ConfirmModal;
