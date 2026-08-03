import { useEffect, useRef, useState } from 'react';
import {
  SignalingClient,
  type InboundSignal,
  type SignalingPeer,
  type SignalCandidate,
  type SignalData,
} from '../lib/signaling.js';

type SessionStatusHandler = (msg: Extract<InboundSignal, { type: 'session.status' }>) => void;
type SignalHandler = (sessionId: string, from: SignalingPeer, data: SignalData | SignalCandidate) => void;
type SessionEndHandler = (sessionId: string) => void;
type RelayDataHandler = (sessionId: string, from: SignalingPeer, channel: string, payload: string) => void;

export interface SignalingHandlers {
  onDevicePresence?: (deviceId: string, status: 'online' | 'offline') => void;
  onSessionStatus?: SessionStatusHandler;
  onSignal?: SignalHandler;
  onSessionEnd?: SessionEndHandler;
  onRelayData?: RelayDataHandler;
}

/**
 * Owns a single dashboard signaling connection. Reconnects automatically.
 * Handlers can be registered once via `attach`.
 */
export function useSignaling() {
  const clientRef = useRef<SignalingClient | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const client = new SignalingClient();
    clientRef.current = client;
    client.onStatusChange = setConnected;
    client.connect();
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, []);

  return {
    client: clientRef.current,
    connected,
    attach: (handlers: SignalingHandlers) => {
      const c = clientRef.current;
      if (!c) return () => {};
      const prev = {
        presence: c.onDevicePresence,
        sessionStatus: c.onSessionStatus,
        signal: c.onSignal,
        sessionEnd: c.onSessionEnd,
        relay: c.onRelayData,
      };
      c.onDevicePresence = handlers.onDevicePresence ?? null;
      c.onSessionStatus = handlers.onSessionStatus ?? null;
      c.onSignal = handlers.onSignal ?? null;
      c.onSessionEnd = handlers.onSessionEnd ?? null;
      c.onRelayData = handlers.onRelayData ?? null;
      return () => {
        const cur = clientRef.current;
        if (!cur) return;
        cur.onDevicePresence = prev.presence;
        cur.onSessionStatus = prev.sessionStatus;
        cur.onSignal = prev.signal;
        cur.onSessionEnd = prev.sessionEnd;
        cur.onRelayData = prev.relay;
      };
    },
  };
}
