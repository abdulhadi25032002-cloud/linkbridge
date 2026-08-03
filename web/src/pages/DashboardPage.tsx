import { useCallback, useEffect, useState } from 'react';
import { apiClient, ApiError } from '../lib/api.js';
import type { Device, PairingPayload } from '../lib/types.js';
import { useSignaling } from '../hooks/useSignaling.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { DeviceCard } from '../components/DeviceCard.js';
import { PairingModal } from '../components/PairingModal.js';
import { Spinner } from '../components/Spinner.js';
import { Toast, type ToastData } from '../components/Toast.js';

export default function DashboardPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [pairing, setPairing] = useState<PairingPayload | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const { connected, attach } = useSignaling();

  const toast = useCallback((kind: ToastData['kind'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const { devices: rows } = await apiClient.devices();
      setDevices(rows);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // Keep device status live from the signaling channel.
  useEffect(() => {
    return attach({
      onDevicePresence: (deviceId, status) => {
        setDevices((prev) =>
          prev.map((d) => (d.id === deviceId ? { ...d, status } : d)),
        );
      },
    });
  }, [attach]);

  const createPairing = async () => {
    setPairingBusy(true);
    try {
      const payload = await apiClient.createPairing();
      setPairing(payload);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to create pairing link');
    } finally {
      setPairingBusy(false);
    }
  };

  const rename = async (id: string, name: string) => {
    try {
      const { device } = await apiClient.renameDevice(id, name);
      setDevices((prev) => prev.map((d) => (d.id === id ? { ...d, name: device.name } : d)));
      toast('success', 'Device renamed');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Rename failed');
    }
  };

  const unpair = async (id: string) => {
    if (!window.confirm('Remove this device from your account?')) return;
    try {
      await apiClient.unpairDevice(id);
      setDevices((prev) => prev.filter((d) => d.id !== id));
      toast('success', 'Device removed');
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : 'Unpair failed');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Devices</h1>
          <p className="text-sm text-slate-400">
            {devices.filter((d) => d.status === 'online').length} of {devices.length} connected
            {connected ? '' : ' · signaling offline'}
          </p>
        </div>
        <Button onClick={createPairing} loading={pairingBusy}>
          + Pair new device
        </Button>
      </div>

      {devices.length === 0 ? (
        <Card className="border-dashed p-10 text-center">
          <p className="text-slate-300">No paired devices yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            Click “Pair new device”, then open the link or scan the QR code on your Android phone.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {devices.map((d) => (
            <DeviceCard key={d.id} device={d} onRename={rename} onUnpair={unpair} />
          ))}
        </div>
      )}

      {pairing && <PairingModal pairing={pairing} onClose={() => setPairing(null)} />}
      <Toast toasts={toasts} dismiss={dismissToast} />
    </div>
  );
}
