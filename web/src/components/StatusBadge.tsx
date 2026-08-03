const config: Record<string, { label: string; className: string; dot: string }> = {
  online: {
    label: 'Online',
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  offline: {
    label: 'Offline',
    className: 'bg-slate-800 text-slate-400 border-slate-700',
    dot: 'bg-slate-500',
  },
  pairing: {
    label: 'Pairing',
    className: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    dot: 'bg-amber-400 animate-pulse',
  },
};

export function StatusBadge({ status }: { status: string }) {
  const c = config[status] ?? config.offline;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${c.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}
