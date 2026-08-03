/**
 * Signaling protocol shared by the dashboard (owner) and the Android app (device).
 * All messages are JSON objects. Every message has a `type`.
 */

/** ICE candidate shape (kept independent of any WebRTC runtime types). */
export interface IceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type SignalData =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'candidate'; candidate: IceCandidate };

export type InboundMessage =
  | { type: 'auth'; token: string }
  | { type: 'signal'; sessionId: string; to: 'owner' | 'device'; data: SignalData }
  | { type: 'consent.response'; sessionId: string; granted: boolean }
  | { type: 'session.end'; sessionId: string }
  | { type: 'relay.data'; sessionId: string; to: 'owner' | 'device'; channel: string; payload: string };

export type OutboundMessage =
  | { type: 'authed'; peer: 'owner' | 'device'; userId: string; deviceId?: string }
  | { type: 'device.presence'; deviceId: string; status: 'online' | 'offline' }
  | { type: 'session.status'; sessionId: string; deviceId: string; kind: string; status: string }
  | { type: 'consent.request'; sessionId: string; kind: string; requestedAt: string }
  | { type: 'signal'; sessionId: string; from: 'owner' | 'device'; data: SignalData }
  | { type: 'session.end'; sessionId: string }
  | { type: 'relay.data'; sessionId: string; from: 'owner' | 'device'; channel: string; payload: string }
  | { type: 'error'; message: string };
