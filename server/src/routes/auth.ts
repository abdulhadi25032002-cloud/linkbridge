import { Router, type Request as ExpressRequest } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import {
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
} from '../auth/tokens.js';
import { requireAuth, authUserId } from '../auth/middleware.js';
import { config } from '../config.js';

export const authRouter = Router();

const credentialsSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/, 'username may only contain letters, numbers and underscores'),
  password: z.string().min(8).max(128),
});

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  salt: string;
}

function refreshOptions(req: ExpressRequest) {
  return {
    userAgent: req.headers['user-agent'] ?? undefined,
    ip: req.ip,
  };
}

authRouter.post('/register', async (req: ExpressRequest, res, next) => {
  try {
    const { username, password } = credentialsSchema.parse(req.body);
    const existing = await queryOne('SELECT 1 FROM users WHERE username = $1', [username]);
    if (existing) {
      res.status(409).json({ error: 'Username already taken' });
      return;
    }
    const { hash, salt } = await hashPassword(password);
    const user = await queryOne<UserRow>(
      `INSERT INTO users (username, password_hash, salt)
       VALUES ($1, $2, $3) RETURNING id, username`,
      [username, hash, salt],
    );
    const pair = await issueTokenPair(user!.id, user!.username, refreshOptions(req));
    res.status(201).json({ user: { id: user!.id, username: user!.username }, ...pair });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', async (req: ExpressRequest, res, next) => {
  try {
    const { username, password } = credentialsSchema.parse(req.body);
    const user = await queryOne<UserRow>(
      'SELECT id, username, password_hash, salt FROM users WHERE username = $1',
      [username],
    );
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }
    const ok = await verifyPassword(password, user.password_hash, user.salt);
    if (!ok) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }
    const pair = await issueTokenPair(user.id, user.username, refreshOptions(req));
    res.json({ user: { id: user.id, username: user.username }, ...pair });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', async (req: ExpressRequest, res, next) => {
  try {
    const body = z.object({ refreshToken: z.string().min(20) }).parse(req.body);
    const rotated = await rotateRefreshToken(body.refreshToken, refreshOptions(req));
    if (!rotated) {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }
    const user = await queryOne<{ id: string; username: string }>(
      'SELECT id, username FROM users WHERE id = $1',
      [rotated.userId],
    );
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }
    const pair = await issueTokenPair(user.id, user.username);
    res.json({
      accessToken: pair.accessToken,
      refreshToken: rotated.token,
      expiresAt: rotated.expiresAt,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', async (req: ExpressRequest, res, next) => {
  try {
    const body = z.object({ refreshToken: z.string().min(20) }).parse(req.body);
    await revokeRefreshToken(body.refreshToken);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req: ExpressRequest, res) => {
  res.json({ id: authUserId(req), username: req.username });
});

// Bootstrap admin account on startup (idempotent).
export async function ensureAdminAccount(): Promise<void> {
  const existing = await queryOne<{ id: string }>('SELECT id FROM users LIMIT 1');
  if (existing) return;
  const { username, password } = config.admin;
  const { hash, salt } = await hashPassword(password);
  await query(
    `INSERT INTO users (username, password_hash, salt) VALUES ($1, $2, $3)`,
    [username, hash, salt],
  );
  console.warn('[bootstrap] Created admin account — change the password immediately.');
}
