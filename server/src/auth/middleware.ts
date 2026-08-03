import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, type DeviceTokenPayload } from './jwt.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      username?: string;
      deviceId?: string;
      authType?: 'owner' | 'device';
    }
  }
}

export function authUserId(req: Request): string {
  if (!req.userId) throw new Error('requireAuth must run before handler');
  return req.userId;
}

function unauthorized(res: Response) {
  res.status(401).json({ error: 'Unauthorized' });
}

/** Require a valid owner access token. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return unauthorized(res);
  try {
    const payload = verifyAccessToken(header.slice(7));
    if (payload.type !== 'access') return unauthorized(res);
    req.userId = payload.sub;
    req.username = payload.username;
    req.authType = 'owner';
    next();
  } catch {
    unauthorized(res);
  }
}

/** Require a valid device token (used by the Android app for pairing/registration calls). */
export function requireDevice(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return unauthorized(res);
  try {
    const payload = verifyAccessToken(header.slice(7)) as DeviceTokenPayload;
    if (payload.type !== 'device') return unauthorized(res);
    req.deviceId = payload.sub;
    req.userId = payload.userId;
    req.authType = 'device';
    next();
  } catch {
    unauthorized(res);
  }
}
