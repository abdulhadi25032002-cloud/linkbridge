import type { SignalingClient } from './signaling.js';
import type { ControlMessage, DeviceMessage } from './types.js';

export interface PeerOptions {
  iceServers?: RTCIceServer[];
  onTrack: (stream: MediaStream) => void;
  onControlMessage: (msg: DeviceMessage) => void;
  onConnectionState: (state: RTCPeerConnectionState | 'relay') => void;
  onDataChannelOpen: (open: boolean) => void;
}

const RELAY_TIMEOUT_MS = 12_000;
const CONTROL_CHANNEL = 'control';

/**
 * Browser-side WebRTC peer. The dashboard is the offerer; the Android app
 * answers. Gestures and camera/gallery commands flow over a data channel,
 * while the screen/camera video track flows over the media transport.
 * If P2P connectivity fails, control messages transparently fall back to
 * the secure WebSocket relay.
 */
export class PeerSession {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private pendingCandidates: RTCIceCandidate[] = [];
  private relayFallback = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private sessionId: string,
    private signaling: SignalingClient,
    private options: PeerOptions,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: options.iceServers ?? [] });
    this.pc.ontrack = (event) => {
      if (event.streams[0]) this.options.onTrack(event.streams[0]);
    };
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({ type: 'candidate', candidate: event.candidate.toJSON() });
      }
    };
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      this.options.onConnectionState(state);
      if (state === 'connected') this.clearRelayTimer();
      if (state === 'failed') this.enableRelayFallback();
    };

    this.dc = this.pc.createDataChannel(CONTROL_CHANNEL, { ordered: true });
    this.dc.onopen = () => {
      this.options.onDataChannelOpen(true);
      this.clearRelayTimer();
    };
    this.dc.onclose = () => this.options.onDataChannelOpen(false);
    this.dc.onmessage = (event) => this.handleData(String(event.data));

    // If neither data channel nor connection establishes in time, fall back
    // to the signaling WebSocket relay for control traffic.
    this.connectTimer = setTimeout(() => {
      if (this.pc.connectionState !== 'connected') this.enableRelayFallback();
    }, RELAY_TIMEOUT_MS);
  }

  async createOffer(): Promise<void> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.send({ type: 'offer', sdp: offer.sdp ?? '' });
  }

  handleRemoteSignal(data: { type: 'offer' | 'answer'; sdp: string } | { type: 'candidate'; candidate: RTCIceCandidateInit }): void {
    if (data.type === 'candidate') {
      const candidate = new RTCIceCandidate(data.candidate);
      if (this.pc.remoteDescription) {
        void this.pc.addIceCandidate(candidate).catch(() => {});
      } else {
        this.pendingCandidates.push(candidate);
      }
      return;
    }
    void this.pc.setRemoteDescription({ type: data.type, sdp: data.sdp }).then(() => {
      for (const c of this.pendingCandidates) {
        void this.pc.addIceCandidate(c).catch(() => {});
      }
      this.pendingCandidates = [];
    });
  }

  sendGesture(action: 'down' | 'move' | 'up', x: number, y: number, durationMs?: number): void {
    const msg: ControlMessage = { type: 'gesture', action, x, y, durationMs };
    this.sendControl(msg);
  }

  sendControl(msg: ControlMessage): void {
    if (this.dc?.readyState === 'open') {
      this.dc.send(JSON.stringify(msg));
    } else {
      // Relay fallback: wrap control messages over the signaling channel.
      this.signaling.relay(this.sessionId, 'device', 'control', JSON.stringify(msg));
    }
  }

  get usingRelay(): boolean {
    return this.relayFallback;
  }

  private send(data: { type: 'offer'; sdp: string } | { type: 'answer'; sdp: string } | { type: 'candidate'; candidate: RTCIceCandidateInit }): void {
    this.signaling.signal(this.sessionId, 'device', data);
  }

  private handleData(raw: string): void {
    try {
      const msg = JSON.parse(raw) as DeviceMessage;
      this.options.onControlMessage(msg);
    } catch {
      /* ignore malformed messages */
    }
  }

  private clearRelayTimer(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private enableRelayFallback(): void {
    if (this.relayFallback) return;
    this.relayFallback = true;
    this.options.onConnectionState('relay');
    console.warn('[peer] P2P failed — control traffic via WebSocket relay');
  }

  close(): void {
    this.clearRelayTimer();
    try {
      this.dc?.close();
    } catch {
      /* ignore */
    }
    this.pc.close();
  }
}
