import { createHmac } from 'node:crypto';
import { config } from '../config.js';

export interface TurnCredentials {
  url: string;
  username: string;
  credential: string;
}

/**
 * Issue short-lived TURN credentials compatible with the coturn REST API
 * (RFC 8656 style time-limited usernames). Used as the secure relay
 * fallback when direct WebRTC (P2P) connectivity fails.
 *
 * username format: <unix-expiry>:<client-id>
 * credential      : base64(HMAC-SHA1(secret, username))
 */
export function issueTurnCredentials(clientId: string): TurnCredentials {
  if (!config.turn.url || !config.turn.secret) {
    // Relay disabled: clients fall back to the WebSocket relay or fail closed.
    return { url: '', username: '', credential: '' };
  }

  const ttl = 3600; // 1 hour
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiry}:${clientId}`;
  const credential = createHmac('sha1', config.turn.secret)
    .update(username)
    .digest('base64');

  return { url: config.turn.url, username, credential };
}
