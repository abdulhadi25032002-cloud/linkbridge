import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query, queryOne } from '../db/pool.js';
import { hashToken, randomToken } from './passwords.js';
import { signAccessToken } from './jwt.js';

export interface RefreshTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  family: string;
  expires_at: string;
  revoked_at: string | null;
  replaced_by: string | null;
}

/**
 * Issue a new refresh token for a user. Returns the plaintext token
 * (returned to the client once) and persists only the hash.
 */
export async function issueRefreshToken(
  userId: string,
  opts: { userAgent?: string; ip?: string } = {},
): Promise<{ token: string; id: string; expiresAt: Date }> {
  const token = randomToken(48);
  const family = randomUUID();
  const expiresAt = new Date(Date.now() + config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, hashToken(token), family, expiresAt.toISOString(), opts.userAgent ?? null, opts.ip ?? null],
  );
  return { token, id: family, expiresAt };
}

/**
 * Rotate a refresh token. Returns a new token pair. If the presented token
 * was already used (token reuse attack), revokes the whole family.
 */
export async function rotateRefreshToken(
  presentedToken: string,
  opts: { userAgent?: string; ip?: string } = {},
): Promise<{ token: string; expiresAt: Date; userId: string } | null> {
  const hash = hashToken(presentedToken);
  const record = await queryOne<RefreshTokenRecord>(
    `SELECT * FROM refresh_tokens WHERE token_hash = $1`,
    [hash],
  );

  if (!record || record.expires_at < new Date().toISOString() || record.revoked_at) {
    // Unknown / expired / already-revoked token: revoke the entire family
    // to neutralize a leaked or replayed refresh token.
    if (record) {
      await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE family = $1`, [record.family]);
    }
    return null;
  }

  const newToken = randomToken(48);
  const newExpiresAt = new Date(Date.now() + config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000);

  // Revoke the presented token, rotate the family to a new token.
  await query(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`,
    [record.id],
  );
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at, user_agent, ip, replaced_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [record.user_id, hashToken(newToken), record.family, newExpiresAt.toISOString(),
     opts.userAgent ?? null, opts.ip ?? null, record.id],
  );

  return { token: newToken, expiresAt: newExpiresAt, userId: record.user_id };
}

/** Revoke a refresh token (logout). */
export async function revokeRefreshToken(token: string): Promise<void> {
  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, [
    hashToken(token),
  ]);
}

export async function issueTokenPair(
  userId: string,
  username: string,
  opts: { userAgent?: string; ip?: string } = {},
) {
  const refresh = await issueRefreshToken(userId, opts);
  const access = signAccessToken(userId, username);
  return { accessToken: access, refreshToken: refresh.token, expiresAt: refresh.expiresAt };
}
