import { WebSocket, WebSocketServer } from 'ws';
import { verifyAccessToken } from '../auth/jwt.js';
import { query } from '../db/pool.js';
import {
  consentTimeoutMs,
  endSession,
  getSession,
  resolveConsent,
  type SessionRow,
} from '../services/sessions.js';
import type { InboundMessage, OutboundMessage, SignalData } from './protocol.js';

interface OwnerClient {
  ws: WebSocket;
  type: 'owner';
  userId: string;
}

interface DeviceClient {
  ws: WebSocket;
  type: 'device';
  deviceId: string;
  userId: string;
}

type Client = OwnerClient | DeviceClient;

interface SessionParticipants {
  owner?: { userId: string; ws: WebSocket };
  device?: { deviceId: string; ws: WebSocket };
  kind: string;
  consentTimer?: NodeJS.Timeout;
}

export class SignalingServer {
  private wss: WebSocketServer;
  private clients = new Set<Client>();
  private sessions = new Map<string, SessionParticipants>();

  constructor(server: ReturnType<typeof import('node:http').createServer>) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
  }

  private handleConnection(ws: WebSocket): void {
    ws.on('message', (raw) => this.handleMessage(ws, raw));
    ws.on('close', () => this.handleClose(ws));
    ws.on('error', () => ws.terminate());
  }

  private async handleMessage(ws: WebSocket, raw: WebSocket.RawData): Promise<void> {
    let msg: InboundMessage;
    try {
      msg = JSON.parse(raw.toString()) as InboundMessage;
    } catch {
      this.send(ws, { type: 'error', message: 'Malformed message' });
      ws.close(1008, 'Malformed message');
      return;
    }

    if (msg.type === 'auth') {
      await this.authenticate(ws, msg.token);
      return;
    }

    const client = this.findClient(ws);
    if (!client) {
      this.send(ws, { type: 'error', message: 'Not authenticated' });
      ws.close(1008, 'Not authenticated');
      return;
    }

    switch (msg.type) {
      case 'signal':
        this.relaySignal(client, msg.sessionId, msg.to, msg.data);
        break;
      case 'consent.response':
        await this.handleConsentResponse(client, msg.sessionId, msg.granted);
        break;
      case 'session.end':
        await this.endSessionForPeer(client, msg.sessionId);
        break;
      case 'relay.data':
        this.relayData(client, msg.sessionId, msg.to, msg.channel, msg.payload);
        break;
    }
  }

  // --- Authentication & presence -------------------------------------

  private async authenticate(ws: WebSocket, token: string): Promise<void> {
    try {
      const payload = verifyAccessToken(token);
      if (payload.type === 'access') {
        const client: OwnerClient = { ws, type: 'owner', userId: payload.sub };
        this.clients.add(client);
        this.send(ws, { type: 'authed', peer: 'owner', userId: payload.sub });
        this.pushPresenceSnapshot(client);
      } else {
        // Device token
        const client: DeviceClient = { ws, type: 'device', deviceId: payload.sub, userId: payload.userId };
        // Only one live device connection is allowed; supersede a stale one.
        for (const existing of this.clients) {
          if (existing.type === 'device' && existing.deviceId === payload.sub) {
            existing.ws.close(4001, 'Replaced by new connection');
            this.clients.delete(existing);
          }
        }
        this.clients.add(client);
        this.send(ws, { type: 'authed', peer: 'device', userId: payload.userId, deviceId: payload.sub });
        await query(
          `UPDATE devices SET status = 'online', last_seen_at = now() WHERE id = $1`,
          [payload.sub],
        );
        this.broadcastPresence(client.userId, payload.sub, 'online');
      }
    } catch {
      this.send(ws, { type: 'error', message: 'Invalid token' });
      ws.close(1008, 'Invalid token');
    }
  }

  private async pushPresenceSnapshot(client: OwnerClient): Promise<void> {
    const rows = await query<{ id: string; status: string }>(
      `SELECT id, status FROM devices WHERE user_id = $1 AND status = 'online'`,
      [client.userId],
    );
    for (const row of rows) {
      this.send(client.ws, { type: 'device.presence', deviceId: row.id, status: 'online' });
    }
  }

  private broadcastPresence(userId: string, deviceId: string, status: 'online' | 'offline'): void {
    for (const client of this.clients) {
      if (client.type === 'owner' && client.userId === userId) {
        this.send(client.ws, { type: 'device.presence', deviceId, status });
      }
    }
  }

  // --- Consent flow -----------------------------------------------------

  /** Called by the REST layer right after a session is created. */
  requestConsent(session: SessionRow): void {
    const device = this.findDevice(session.device_id);
    if (!device) {
      void endSession(session.id);
      return;
    }

    const participants: SessionParticipants = { kind: session.kind };
    participants.consentTimer = setTimeout(() => {
      void this.expireSession(session.id);
    }, consentTimeoutMs);

    this.sessions.set(session.id, participants);
    this.send(device.ws, {
      type: 'consent.request',
      sessionId: session.id,
      kind: session.kind,
      requestedAt: new Date().toISOString(),
    });
  }

  private async handleConsentResponse(client: Client, sessionId: string, granted: boolean): Promise<void> {
    if (client.type !== 'device') return;
    const participants = this.sessions.get(sessionId);
    if (!participants) return;
    if (participants.device && participants.device.deviceId !== client.deviceId) return;

    if (participants.consentTimer) clearTimeout(participants.consentTimer);

    const session = await resolveConsent(sessionId, client.deviceId, granted);
    participants.device = { deviceId: client.deviceId, ws: client.ws };

    if (session.status === 'active') {
      this.broadcastSessionStatus(session, 'active');
    } else {
      this.notifyOwnerOfDenial(session);
      this.sessions.delete(sessionId);
    }
  }

  private async expireSession(sessionId: string): Promise<void> {
    const participants = this.sessions.get(sessionId);
    if (!participants) return;
    const session = await getSession(sessionId);
    if (!session || session.status !== 'consent_required') return;
    await query(`UPDATE remote_sessions SET status = 'expired' WHERE id = $1`, [sessionId]);
    this.notifyOwnerOfDenial(session);
    this.sessions.delete(sessionId);
  }

  private notifyOwnerOfDenial(session: SessionRow): void {
    this.broadcastSessionStatus(session, session.status === 'expired' ? 'expired' : 'denied');
  }

  private broadcastSessionStatus(session: SessionRow, status: string): void {
    for (const client of this.clients) {
      if (client.type === 'owner' && client.userId === session.user_id) {
        this.send(client.ws, {
          type: 'session.status',
          sessionId: session.id,
          deviceId: session.device_id,
          kind: session.kind,
          status,
        });
      }
    }
  }

  // --- Signaling relay ---------------------------------------------------

  private relaySignal(client: Client, sessionId: string, to: 'owner' | 'device', data: SignalData): void {
    const participants = this.sessions.get(sessionId);
    if (!participants) return;

    // Only an active session can carry signaling/media.
    if (to === 'device') {
      if (client.type !== 'owner') return;
      if (participants.owner && participants.owner.ws !== client.ws) return;
      const device = participants.device;
      if (!device) return;
      participants.owner = { userId: client.userId, ws: client.ws };
      this.send(device.ws, { type: 'signal', sessionId, from: 'owner', data });
    } else {
      if (client.type !== 'device') return;
      if (participants.device && participants.device.ws !== client.ws) return;
      const owner = participants.owner;
      if (!owner) return;
      participants.device = { deviceId: client.deviceId, ws: client.ws };
      this.send(owner.ws, { type: 'signal', sessionId, from: 'device', data });
    }
  }

  private async relayData(
    client: Client,
    sessionId: string,
    to: 'owner' | 'device',
    channel: string,
    payload: string,
  ): Promise<void> {
    const participants = this.sessions.get(sessionId);
    if (!participants) return;
    const target = to === 'device' ? participants.device : participants.owner;
    if (!target) return;
    if (to === 'device' && client.type !== 'owner') return;
    if (to === 'owner' && client.type !== 'device') return;
    this.send(target.ws, {
      type: 'relay.data',
      sessionId,
      from: to === 'device' ? 'owner' : 'device',
      channel,
      payload,
    });
  }

  // --- Session teardown ---------------------------------------------------

  private async endSessionForPeer(client: Client, sessionId: string): Promise<void> {
    const session = await getSession(sessionId);
    if (!session) return;
    if (client.type === 'owner' && session.user_id !== client.userId) return;
    if (client.type === 'device' && session.device_id !== client.deviceId) return;
    await endSession(sessionId);
    this.teardownSession(sessionId);
  }

  private teardownSession(sessionId: string): void {
    const participants = this.sessions.get(sessionId);
    if (!participants) return;
    if (participants.consentTimer) clearTimeout(participants.consentTimer);
    this.sessions.delete(sessionId);

    const endMsg: OutboundMessage = { type: 'session.end', sessionId };
    if (participants.owner) this.send(participants.owner.ws, endMsg);
    if (participants.device) this.send(participants.device.ws, endMsg);
  }

  // --- Connection lifecycle -----------------------------------------------

  private handleClose(ws: WebSocket): void {
    const client = this.findClient(ws);
    if (!client) return;
    this.clients.delete(client);

    // End sessions this client was part of, then tear them down.
    for (const [sessionId, participants] of this.sessions) {
      const involved =
        (participants.owner && participants.owner.ws === ws) ||
        (participants.device && participants.device.ws === ws);
      if (involved) {
        void endSession(sessionId);
        this.teardownSession(sessionId);
      }
    }

    if (client.type === 'device') {
      void query(`UPDATE devices SET status = 'offline' WHERE id = $1`, [client.deviceId]);
      this.broadcastPresence(client.userId, client.deviceId, 'offline');
    }
  }

  private findClient(ws: WebSocket): Client | undefined {
    for (const client of this.clients) {
      if (client.ws === ws) return client;
    }
    return undefined;
  }

  private findDevice(deviceId: string): DeviceClient | undefined {
    for (const client of this.clients) {
      if (client.type === 'device' && client.deviceId === deviceId) return client;
    }
    return undefined;
  }

  private send(ws: WebSocket, msg: OutboundMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}
