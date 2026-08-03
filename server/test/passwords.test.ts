import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, hashToken, randomToken } from '../src/auth/passwords.js';

describe('passwords', () => {
  it('hashes and verifies a password', async () => {
    const { hash, salt } = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', hash, salt)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', hash, salt)).resolves.toBe(false);
  });

  it('produces unique salts per hash', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('hashes tokens deterministically and never stores plaintext', async () => {
    const token = randomToken(32);
    const digest = hashToken(token);
    expect(digest).not.toBe(token);
    expect(hashToken(token)).toBe(digest);
  });
});
