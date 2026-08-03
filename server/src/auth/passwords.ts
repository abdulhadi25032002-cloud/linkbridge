import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

export interface PasswordRecord {
  hash: string;
  salt: string;
}

/** Hash a password using scrypt (OWASP-recommended KDF) with a random per-user salt. */
export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return { hash: derived.toString('hex'), salt };
}

/** Verify a password against a stored hash + salt. Constant-time compare. */
export async function verifyPassword(
  password: string,
  storedHash: string,
  salt: string,
): Promise<boolean> {
  const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  const expected = Buffer.from(storedHash, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Generate a cryptographically secure random token (for refresh & pairing tokens). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Hash a token before persisting, so a DB leak never exposes usable tokens. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
