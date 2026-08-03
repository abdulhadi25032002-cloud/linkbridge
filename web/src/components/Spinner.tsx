export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-brand-500 ${className}`}
    />
  );
}
