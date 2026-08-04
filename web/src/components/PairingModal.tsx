import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { PairingPayload } from '../lib/types.js';
import { Button } from './Button.js';

interface Props {
  pairing: PairingPayload;
  onClose: () => void;
}

export function PairingModal({ pairing, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(Math.floor(pairing.expiresIn / 1000));

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pairing.deepLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-surface-800 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-white">Pair a new device</h2>
        <p className="mt-1 text-sm text-slate-400">
          Open this link on your Android phone (or scan the QR code) to begin pairing.
        </p>

        <div className="mt-5 flex justify-center rounded-xl bg-white p-4">
          <QRCodeSVG value={pairing.qrContent} size={196} level="M" />
        </div>

        <div className="mt-5">
          <label className="mb-1 block text-xs font-medium text-slate-400">Pairing link</label>
          <div className="flex gap-2">
            <input
              readOnly
              value={pairing.deepLink}
              className="w-full truncate rounded-lg border border-slate-700 bg-surface-900 px-3 py-2 font-mono text-xs text-slate-300 focus:outline-none"
            />
            <Button variant="secondary" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <span>
            Expires in {minutes}:{String(seconds).padStart(2, '0')}
          </span>
          <span className="text-slate-500">Token valid once</span>
        </div>

        <div className="mt-5 rounded-xl border border-slate-700 bg-surface-900/60 p-4">
          <h3 className="text-sm font-semibold text-white">What happens on your phone</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs text-slate-400">
            <li>
              You&apos;re shown a consent screen explaining exactly what LinkBridge needs and why.
            </li>
            <li>
              Only after you accept, Android&apos;s official permission screens open, one at a time:
              notifications, screen capture, and accessibility (touch control).
            </li>
            <li>
              You grant each on the system screen — the app never bypasses them. Pairing completes
              automatically when you&apos;re done.
            </li>
            <li>
              The device appears here as <span className="text-emerald-400">Online</span> and is
              ready for a remote session. Every session still asks for consent on the device first.
            </li>
          </ol>
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
