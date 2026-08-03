import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiClient, ApiError } from '../lib/api.js';
import type {
  ControlMessage,
  Device,
  DeviceMessage,
  GalleryImage,
  RemoteSession,
  SessionKind,
} from '../lib/types.js';
import { useSignaling } from '../hooks/useSignaling.js';
import { PeerSession } from '../lib/peer.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { Spinner } from '../components/Spinner.js';

type SessionPhase = 'idle' | 'creating' | 'consent' | 'connecting' | 'active' | 'denied' | 'expired' | 'ended' | 'error';

const KIND_LABEL: Record<SessionKind, string> = {
  screen: 'Live Screen',
  camera: 'Camera',
  gallery: 'Gallery',
};

export default function RemotePage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const [device, setDevice] = useState<Device | null>(null);
  const [phase, setPhase] = useState<SessionPhase>('idle');
  const [error, setError] = useState('');
  const [activeSession, setActiveSession] = useState<RemoteSession | null>(null);
  const [peerState, setPeerState] = useState<string>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<{ id: string; dataUrl: string } | null>(null);
  const [isScreenOn, setIsScreenOn] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<PeerSession | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const touchSurfaceRef = useRef<HTMLDivElement>(null);

  const { client, attach } = useSignaling();

  useEffect(() => {
    if (deviceId) {
      apiClient.devices().then(({ devices }) => {
        const found = devices.find((d) => d.id === deviceId);
        setDevice(found ?? null);
        if (!found) setError('Device not found');
      });
    }
  }, [deviceId]);

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const teardown = useCallback(async () => {
    peerRef.current?.close();
    peerRef.current = null;
    if (sessionIdRef.current) {
      try {
        await apiClient.endSession(sessionIdRef.current);
      } catch {
        /* ignore */
      }
      client?.endSession(sessionIdRef.current);
    }
    sessionIdRef.current = null;
    setStream(null);
    setActiveSession(null);
    setGallery([]);
    setSelectedImage(null);
    setPeerState('idle');
  }, [client]);

  const handleSessionEnd = useCallback(async () => {
    peerRef.current?.close();
    peerRef.current = null;
    sessionIdRef.current = null;
    setStream(null);
    setActiveSession(null);
    setGallery([]);
    setSelectedImage(null);
    setPeerState('idle');
    setPhase('ended');
  }, []);

  useEffect(() => {
    return attach({
      onSessionStatus: (msg) => {
        if (msg.sessionId !== sessionIdRef.current) return;
        if (msg.status === 'active') {
          setPhase('connecting');
          void establishPeer(msg.sessionId);
        } else if (msg.status === 'denied') {
          setPhase('denied');
          peerRef.current?.close();
          peerRef.current = null;
        } else if (msg.status === 'expired') {
          setPhase('expired');
        }
      },
      onSignal: (sessionId, from, data) => {
        if (sessionId !== sessionIdRef.current) return;
        if (from === 'device') peerRef.current?.handleRemoteSignal(data);
      },
      onSessionEnd: (sessionId) => {
        if (sessionId === sessionIdRef.current) void handleSessionEnd();
      },
    });
  });

  const establishPeer = useCallback(async (sessionId: string) => {
    try {
      const { turn } = await apiClient.sessionDetail(sessionId);
      const signaling = client!;
      const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
      if (turn.url && turn.username && turn.credential) {
        iceServers.push({ urls: turn.url, username: turn.username, credential: turn.credential });
      }

      const peer = new PeerSession(sessionId, signaling, {
        iceServers,
        onTrack: (s) => {
          setStream(s);
          setPhase('active');
        },
        onControlMessage: (msg: DeviceMessage) => {
          if (msg.type === 'gallery.list') setGallery(msg.images);
          if (msg.type === 'gallery.image') setSelectedImage({ id: msg.id, dataUrl: msg.dataUrl });
          if (msg.type === 'status') setIsScreenOn(msg.screen === 'on');
        },
        onConnectionState: (state) => setPeerState(state),
        onDataChannelOpen: () => {
          // When the control channel opens on a gallery session, request the list.
          if (activeSession?.kind === 'gallery') {
            peerRef.current?.sendControl({ type: 'gallery', action: 'list' });
          }
        },
      });
      peerRef.current = peer;
      await peer.createOffer();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to establish connection');
      setPhase('error');
    }
  }, [client, activeSession?.kind]);

  const startSession = async (kind: SessionKind) => {
    if (!deviceId || phase !== 'idle') return;
    setError('');
    setPhase('creating');
    try {
      const { session } = await apiClient.createSession(deviceId, kind);
      sessionIdRef.current = session.id;
      setActiveSession(session);
      setPhase('consent');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start session');
      setPhase('error');
    }
  };

  const sendControl = (msg: ControlMessage) => {
    peerRef.current?.sendControl(msg);
  };

  // --- Touch control ---
  const sendTouch = useCallback((e: React.PointerEvent, action: 'down' | 'move' | 'up') => {
    const el = touchSurfaceRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    sendControl({ type: 'gesture', action, x, y });
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-slate-400 hover:text-white">
            ← Devices
          </Link>
          <h1 className="text-2xl font-semibold text-white">{device?.name ?? 'Device'}</h1>
          <p className="text-sm text-slate-400">
            {device?.model ?? 'Android device'} · every connection requires approval on the phone
          </p>
        </div>
        {activeSession && (
          <Button variant="danger" onClick={teardown}>
            Disconnect
          </Button>
        )}
      </div>

      {/* Session status banner */}
      {phase === 'consent' && (
        <Card className="border-amber-500/30 bg-amber-500/5 p-5">
          <div className="flex items-center gap-3">
            <Spinner className="h-5 w-5 border-amber-500 border-t-transparent" />
            <div>
              <p className="font-medium text-amber-300">Waiting for approval on your phone</p>
              <p className="text-sm text-amber-200/70">
                Accept the “{activeSession?.kind && KIND_LABEL[activeSession.kind]}” request that appeared on the device.
              </p>
            </div>
          </div>
        </Card>
      )}
      {phase === 'denied' && (
        <Card className="border-rose-500/30 bg-rose-500/5 p-5 text-rose-300">
          The request was denied on the phone.
        </Card>
      )}
      {phase === 'expired' && (
        <Card className="border-rose-500/30 bg-rose-500/5 p-5 text-rose-300">
          The request expired. Try again.
        </Card>
      )}
      {phase === 'ended' && (
        <Card className="border-slate-700 bg-slate-800/50 p-5 text-slate-300">
          Connection closed.
        </Card>
      )}
      {phase === 'error' && (
        <Card className="border-rose-500/30 bg-rose-500/5 p-5 text-rose-300">{error}</Card>
      )}

      {phase === 'idle' && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="p-6">
            <h3 className="font-semibold text-white">Live Screen</h3>
            <p className="mt-1 text-sm text-slate-400">
              See the phone screen in real time and control it with your mouse.
            </p>
            <Button className="mt-4 w-full" disabled={device?.status !== 'online'} onClick={() => startSession('screen')}>
              Start
            </Button>
          </Card>
          <Card className="p-6">
            <h3 className="font-semibold text-white">Camera</h3>
            <p className="mt-1 text-sm text-slate-400">
              Stream the phone camera. The phone asks for permission on first use.
            </p>
            <Button className="mt-4 w-full" disabled={device?.status !== 'online'} onClick={() => startSession('camera')}>
              Start
            </Button>
          </Card>
          <Card className="p-6">
            <h3 className="font-semibold text-white">Gallery</h3>
            <p className="mt-1 text-sm text-slate-400">
              Browse the phone gallery. Permission is requested only when first opened.
            </p>
            <Button className="mt-4 w-full" disabled={device?.status !== 'online'} onClick={() => startSession('gallery')}>
              Start
            </Button>
          </Card>
        </div>
      )}

      {(phase === 'creating' || phase === 'connecting') && (
        <div className="flex flex-col items-center gap-3 py-16">
          <Spinner />
          <p className="text-sm text-slate-400">Establishing encrypted connection…</p>
        </div>
      )}

      {/* Live screen + touch overlay */}
      {phase === 'active' && activeSession?.kind === 'screen' && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
            <span className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${isScreenOn ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              {isScreenOn ? 'Live' : 'Screen off'}
            </span>
            <span>
              {peerState === 'relay'
                ? 'Relay mode'
                : peerState === 'connected'
                  ? 'P2P · encrypted'
                  : 'Connecting…'}
            </span>
          </div>
          <div
            ref={touchSurfaceRef}
            className="relative mx-auto max-h-[70vh] w-full max-w-md cursor-crosshair select-none touch-none"
            onPointerDown={(e) => sendTouch(e, 'down')}
            onPointerMove={(e) => e.buttons === 1 && sendTouch(e, 'move')}
            onPointerUp={(e) => sendTouch(e, 'up')}
          >
            <video ref={videoRef} autoPlay playsInline muted className="w-full bg-black" />
          </div>
          <p className="border-t border-slate-800 px-4 py-2 text-center text-xs text-slate-500">
            Drag on the video to control the phone screen
          </p>
        </Card>
      )}

      {/* Camera view */}
      {phase === 'active' && activeSession?.kind === 'camera' && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
            <span>Camera stream</span>
            <span>{peerState === 'connected' ? 'P2P · encrypted' : peerState === 'relay' ? 'Relay mode' : 'Connecting…'}</span>
          </div>
          <div className="mx-auto max-w-lg">
            <video ref={videoRef} autoPlay playsInline muted className="w-full bg-black" />
          </div>
        </Card>
      )}

      {/* Gallery */}
      {phase === 'active' && activeSession?.kind === 'gallery' && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Gallery</h2>
            <Button variant="secondary" onClick={() => sendControl({ type: 'gallery', action: 'list' })}>
              Refresh
            </Button>
          </div>
          {selectedImage ? (
            <div>
              <img src={selectedImage.dataUrl} alt="Selected" className="mx-auto max-h-[60vh] rounded-lg" />
              <div className="mt-3 text-center">
                <Button variant="ghost" onClick={() => setSelectedImage(null)}>
                  Back to gallery
                </Button>
              </div>
            </div>
          ) : gallery.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              {peerState === 'connected' ? 'No images loaded — grant the permission prompt on your phone.' : 'Loading gallery…'}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {gallery.map((img) => (
                <button
                  key={img.id}
                  onClick={() => sendControl({ type: 'gallery.open', id: img.id })}
                  className="group relative aspect-square overflow-hidden rounded-lg bg-slate-900"
                  title={img.name}
                >
                  <img
                    src={img.uri}
                    alt={img.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Connecting indicator when session active but stream not yet up */}
      {phase === 'active' && !stream && activeSession?.kind !== 'gallery' && (
        <div className="flex flex-col items-center gap-3 py-16">
          <Spinner />
          <p className="text-sm text-slate-400">Waiting for media…</p>
        </div>
      )}
    </div>
  );
}
