import { useEffect, useState } from 'react';
import { apiClient, ApiError } from '../lib/api.js';
import type { ConnectionEvent, ConnectionLog, Device } from '../lib/types.js';
import { Button } from './Button.js';
import { Spinner } from './Spinner.js';

const eventMeta: Record<ConnectionEvent, { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'text-emerald-400' },
  reconnected: { label: 'Reconnected', className: 'text-sky-400' },
  disconnected: { label: 'Disconnected', className: 'text-slate-400' },
  heartbeat_timeout: { label: 'Heartbeat timeout', className: 'text-rose-400' },
};

function relative(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString();
}

interface Props {
  device: Device;
  onClose: () => void;
}

export function ConnectionLogsModal({ device, onClose }: Props) {
  const [logs, setLogs] = useState<ConnectionLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .deviceLogs(device.id, 50)
      .then(({ logs: rows }) => {
        if (!cancelled) setLogs(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load logs');
      });
    return () => {
      cancelled = true;
    };
  }, [device.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-surface-800 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-white">Connection history · {device.name}</h2>
        <p className="mt-1 text-sm text-slate-400">
          Heartbeat {device.last_heartbeat_at ? relative(device.last_heartbeat_at) : 'never'} ·{' '}
          {device.reconnect_count} reconnect{device.reconnect_count === 1 ? '' : 's'}
        </p>

        <div className="mt-5 max-h-80 space-y-2 overflow-y-auto pr-1">
          {error && <p className="text-sm text-rose-400">{error}</p>}
          {!error && !logs && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          {logs && logs.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">No connection events yet.</p>
          )}
          {logs?.map((log) => {
            const meta = eventMeta[log.event] ?? eventMeta.disconnected;
            return (
              <div
                key={log.id}
                className="flex items-center justify-between rounded-lg border border-slate-700/60 bg-surface-900/50 px-3 py-2"
              >
                <span className={`text-sm font-medium ${meta.className}`}>{meta.label}</span>
                <span className="text-xs text-slate-500">{relative(log.created_at)}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
