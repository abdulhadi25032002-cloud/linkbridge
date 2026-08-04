import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Device } from '../lib/types.js';
import { StatusBadge } from './StatusBadge.js';
import { Button } from './Button.js';
import { ConnectionLogsModal } from './ConnectionLogsModal.js';

interface Props {
  device: Device;
  onRename: (id: string, name: string) => void;
  onUnpair: (id: string) => void;
}

function heartbeatFreshness(device: Device): string {
  if (device.status !== 'online' || !device.last_heartbeat_at) return 'No heartbeat';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(device.last_heartbeat_at).getTime()) / 1000));
  return `Heartbeat ${seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`} ago`;
}

export function DeviceCard({ device, onRename, onUnpair }: Props) {
  const navigate = useNavigate();
  const online = device.status === 'online';
  const [showLogs, setShowLogs] = useState(false);

  return (
    <div className="rounded-2xl border border-slate-800 bg-surface-800 p-5 shadow-lg transition-colors hover:border-slate-700">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-700/60 text-slate-300">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="7" y="2" width="10" height="20" rx="2" />
              <path d="M11 18.5h2" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-white">{device.name}</h3>
            <p className="text-xs text-slate-400">
              {[device.manufacturer, device.model].filter(Boolean).join(' ') || 'Android device'}
              {device.android_version ? ` · Android ${device.android_version}` : ''}
            </p>
          </div>
        </div>
        <StatusBadge status={device.status} />
      </div>

      <dl className="mb-4 grid grid-cols-2 gap-2 text-xs text-slate-400">
        <div>
          <dt className="text-slate-500">Paired</dt>
          <dd className="text-slate-300">{new Date(device.paired_at).toLocaleDateString()}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Last seen</dt>
          <dd className="text-slate-300">
            {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : 'Never'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Heartbeat</dt>
          <dd className={online ? 'text-emerald-400' : 'text-slate-300'}>{heartbeatFreshness(device)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Reconnects</dt>
          <dd className="text-slate-300">{device.reconnect_count}</dd>
        </div>
      </dl>

      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={!online}
          className="flex-1"
          onClick={() => navigate(`/devices/${device.id}`)}
        >
          Connect
        </Button>
        <Button variant="ghost" onClick={() => setShowLogs(true)}>
          Logs
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            const name = window.prompt('Rename device', device.name);
            if (name) onRename(device.id, name);
          }}
        >
          Rename
        </Button>
        <Button variant="ghost" onClick={() => onUnpair(device.id)}>
          Unpair
        </Button>
      </div>

      {showLogs && <ConnectionLogsModal device={device} onClose={() => setShowLogs(false)} />}
    </div>
  );
}
