import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-800 bg-surface-800 shadow-lg ${className}`}
    >
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-100">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
