import { getAccessToken } from './api.js';

export type SignalingPeer = 'owner' | 'device';

export interface SignalData {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface SignalCandidate {
  type: 'candidate';
  candidate: RTCIceCandidateInit;
}

export type InboundSignal =
  | { type: 'authed'; peer: SignalingPeer; userId: string; deviceId?: string }
  | { type: 'device.presence'; deviceId: string; status: 'online' | 'offline' }
  | { type: 'session.status'; sessionId: string; deviceId: string; kind: string; status: string }
  | { type: 'signal'; sessionId: string; from: SignalingPeer; data: SignalData | SignalCandidate }
  | { type: 'session.end'; sessionId: string }
  | { type: 'relay.data'; sessionId: string; from: SignalingPeer; channel: string; payload: string }
  | { type: 'error'; message: string };

export class SignalingClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private manualClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Array<Record<string, unknown>> = [];

  onAuthed: ((info: { peer: SignalingPeer; userId: string }) => void) | null = null;
  onDevicePresence: ((deviceId: string, status: 'online' | 'offline') => void) | null = null;
  onSessionStatus: ((msg: Extract<InboundSignal, { type: 'session.status' }>) => void) | null = null;
  onSignal: ((sessionId: string, from: SignalingPeer, data: SignalData | SignalCandidate) => void) | null =
    null;
  onSessionEnd: ((sessionId: string) => void) | null = null;
  onRelayData: ((sessionId: string, from: SignalingPeer, channel: string, payload: string) => void) | null =
    null;
  onStatusChange: ((connected: boolean) => void) | null = null;

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.manualClose = false;
    this.open();
  }

  private open(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.sendRaw({ type: 'auth', token: getAccessToken() });
      this.onStatusChange?.(true);
    };

    ws.onmessage = (event) => {
      let msg: InboundSignal;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      this.handle(msg);
    };

    ws.onclose = () => {
      this.onStatusChange?.(false);
      if (!this.manualClose) {
        const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15_000);
        this.reconnectAttempts += 1;
        this.reconnectTimer = setTimeout(() => this.open(), delay);
      }
    };

    ws.onerror = () => ws.close();
  }

  private handle(msg: InboundSignal): void {
    switch (msg.type) {
      case 'authed':
        this.onAuthed?.({ peer: msg.peer, userId: msg.userId });
        // Flush any messages queued before auth completed.
        for (const item of this.queue) this.sendRaw(item);
        this.queue = [];
        break;
      case 'device.presence':
        this.onDevicePresence?.(msg.deviceId, msg.status);
        break;
      case 'session.status':
        this.onSessionStatus?.(msg);
        break;
      case 'signal':
        this.onSignal?.(msg.sessionId, msg.from, msg.data);
        break;
      case 'session.end':
        this.onSessionEnd?.(msg.sessionId);
        break;
      case 'relay.data':
        this.onRelayData?.(msg.sessionId, msg.from, msg.channel, msg.payload);
        break;
      case 'error':
        console.error('[signaling] server error:', msg.message);
        break;
    }
  }

  private sendRaw(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else if (!this.manualClose) {
      this.queue.push(payload);
    }
  }

  signal(sessionId: string, to: SignalingPeer, data: SignalData | SignalCandidate): void {
    this.sendRaw({ type: 'signal', sessionId, to, data });
  }

  endSession(sessionId: string): void {
    this.sendRaw({ type: 'session.end', sessionId });
  }

  relay(sessionId: string, to: SignalingPeer, channel: string, payload: string): void {
    this.sendRaw({ type: 'relay.data', sessionId, to, channel, payload });
  }

  close(): void {
    this.manualClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}
