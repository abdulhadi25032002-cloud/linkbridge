export interface User {
  id: string;
  username: string;
}

export interface Device {
  id: string;
  name: string;
  model: string | null;
  manufacturer: string | null;
  android_version: string | null;
  app_version: string | null;
  status: 'pairing' | 'online' | 'offline';
  connection_status: 'online' | 'offline';
  paired_at: string;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
  connection_changed_at: string | null;
  reconnect_count: number;
}

export type ConnectionEvent =
  | 'connected'
  | 'disconnected'
  | 'reconnected'
  | 'heartbeat_timeout';

export interface ConnectionLog {
  id: string;
  event: ConnectionEvent;
  detail: Record<string, unknown>;
  created_at: string;
}

export type SessionKind = 'screen' | 'camera' | 'gallery';
export type SessionStatus =
  | 'pending'
  | 'consent_required'
  | 'active'
  | 'ended'
  | 'denied'
  | 'expired';

export interface RemoteSession {
  id: string;
  user_id: string;
  device_id: string;
  kind: SessionKind;
  status: SessionStatus;
  consent_granted_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface TurnCredentials {
  url: string;
  username: string;
  credential: string;
}

export interface PairingPayload {
  pairToken: string;
  expiresIn: number;
  deepLink: string;
  qrContent: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

/** Control messages exchanged over the WebRTC data channel. */
export type ControlMessage =
  | { type: 'gesture'; action: 'down' | 'move' | 'up'; x: number; y: number; durationMs?: number }
  | { type: 'camera'; action: 'start' | 'stop' }
  | { type: 'gallery'; action: 'list' | 'open' | 'close' }
  | { type: 'gallery.open'; id: string }
  | { type: 'ping' };

export type DeviceMessage =
  | { type: 'pong' }
  | { type: 'status'; screen: 'on' | 'off' }
  | { type: 'gallery.list'; images: GalleryImage[] }
  | { type: 'gallery.image'; id: string; dataUrl: string }
  | { type: 'error'; message: string };

export interface GalleryImage {
  id: string;
  name: string;
  uri: string;
  width: number;
  height: number;
  sizeBytes: number;
  dateTaken: string;
}
