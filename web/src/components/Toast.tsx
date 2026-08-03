import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface ToastData {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

export function Toast({ toasts, dismiss }: { toasts: ToastData[]; dismiss: (id: number) => void }) {
  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), 5000));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  return createPortal(
    <div className="fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-lg border px-4 py-3 text-sm shadow-xl ${
            t.kind === 'success'
              ? 'border-emerald-500/40 bg-emerald-950/80 text-emerald-200'
              : t.kind === 'error'
                ? 'border-rose-500/40 bg-rose-950/80 text-rose-200'
                : 'border-slate-700 bg-slate-800 text-slate-200'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>,
    document.body,
  );
}
