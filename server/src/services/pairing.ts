import { query, withTransaction } from '../db/pool.js';
import { config } from '../config.js';
import { hashToken, randomToken } from '../auth/passwords.js';
import { signDeviceToken } from '../auth/jwt.js';

const PAIR_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PAIR_TOKEN_PREFIX = 'lbpair_';

export interface PairingPayload {
  pairToken: string;
  expiresIn: number;
  deepLink: string;
  qrContent: string;
}

/**
 * Create a one-time pairing token for the given user and return the
 * deep link that the Android app will open. The token is never stored
 * in plaintext — only its hash is persisted.
 */
export async function createPairingToken(userId: string): Promise<PairingPayload> {
  const pairToken = `${PAIR_TOKEN_PREFIX}${randomToken(32)}`;
  const expiresAt = new Date(Date.now() + PAIR_TOKEN_TTL_MS);

  await query(
    `INSERT INTO pairing_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashToken(pairToken), expiresAt.toISOString()],
  );

  const deepLink = buildPairingDeepLink(pairToken);
  return {
    pairToken,
    expiresIn: PAIR_TOKEN_TTL_MS,
    deepLink,
    qrContent: deepLink,
  };
}

export function buildPairingDeepLink(pairToken: string): string {
  // App Link (verified https host) preferred; the Android app also declares
  // the "linkbridge" custom scheme as a fallback for non-verified installs.
  return `${config.pairingBaseUrl}/pair?t=${encodeURIComponent(pairToken)}`;
}

export interface CompletedPairing {
  deviceId: string;
  deviceToken: string;
  userId: string;
}

/**
 * Complete a pairing from the Android app. Validates the one-time token,
 * binds a new device record to the token's owner, and returns the
 * device-scoped credentials used for the WebSocket connection.
 */
export async function completePairing(
  pairToken: string,
  deviceInfo: {
    name: string;
    model?: string;
    manufacturer?: string;
    androidVersion?: string;
    appVersion?: string;
    publicKey?: string;
  },
): Promise<CompletedPairing> {
  const tokenHash = hashToken(pairToken);

  return withTransaction(async (q) => {
    const tokenRow = (await q(
      `SELECT id, user_id, device_id, expires_at, used_at
         FROM pairing_tokens WHERE token_hash = $1
         FOR UPDATE`,
      [tokenHash],
    ))[0] as
      | { id: string; user_id: string; device_id: string | null; expires_at: string; used_at: string | null }
      | undefined;

    if (!tokenRow) {
      throw new PairingError(404, 'Pairing token not found');
    }
    if (tokenRow.used_at) {
      throw new PairingError(409, 'Pairing token already used');
    }
    if (new Date(tokenRow.expires_at) < new Date()) {
      throw new PairingError(410, 'Pairing token expired');
    }

    const device = (await q(
      `INSERT INTO devices
         (user_id, name, model, manufacturer, android_version, app_version,
          pairing_token_id, public_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pairing')
       RETURNING id`,
      [tokenRow.user_id, deviceInfo.name, deviceInfo.model ?? null,
       deviceInfo.manufacturer ?? null, deviceInfo.androidVersion ?? null,
       deviceInfo.appVersion ?? null, tokenRow.id, deviceInfo.publicKey ?? null],
    ))[0] as { id: string };

    await q(`UPDATE pairing_tokens SET used_at = now(), device_id = $1 WHERE id = $2`, [
      device.id,
      tokenRow.id,
    ]);

    const deviceToken = signDeviceToken(device.id, tokenRow.user_id);
    return { deviceId: device.id, deviceToken, userId: tokenRow.user_id };
  });
}

export class PairingError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'PairingError';
  }
}
