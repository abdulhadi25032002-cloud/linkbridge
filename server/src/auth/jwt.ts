import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface AccessTokenPayload {
  sub: string; // user id
  username: string;
  type: 'access';
  role: 'owner';
  iat: number;
  exp: number;
}

export interface DeviceTokenPayload {
  sub: string; // device id
  userId: string;
  type: 'device';
  role: 'device';
  iat: number;
  exp: number;
}

export function signAccessToken(userId: string, username: string): string {
  return jwt.sign(
    { type: 'access', role: 'owner', username },
    config.jwt.accessSecret,
    { subject: userId, expiresIn: config.jwt.accessTtl as jwt.SignOptions['expiresIn'] },
  );
}

/** Device-scoped token used to authenticate the Android app on the WebSocket. */
export function signDeviceToken(deviceId: string, userId: string): string {
  return jwt.sign(
    { type: 'device', role: 'device', userId },
    config.jwt.accessSecret,
    { subject: deviceId, expiresIn: '365d' as jwt.SignOptions['expiresIn'] },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload | DeviceTokenPayload {
  const payload = jwt.verify(token, config.jwt.accessSecret) as
    | AccessTokenPayload
    | DeviceTokenPayload;
  if (payload.type !== 'access' && payload.type !== 'device') {
    throw new jwt.JsonWebTokenError('unexpected token type');
  }
  return payload;
}
