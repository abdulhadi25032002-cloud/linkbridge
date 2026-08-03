import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { resetDatabase } from './db.js';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

const stubSignaling = { requestConsent: () => {} } as never;

let app: Express;

beforeAll(async () => {
  await resetDatabase();
  app = createApp(() => stubSignaling);
});

afterAll(async () => {
  await pool.end();
});

async function register(username: string, password: string) {
  return request(app).post('/api/auth/register').send({ username, password });
}

describe('auth API', () => {
  it('registers a user and returns token pair', async () => {
    const res = await register('alice', 'supersecret1');
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.username).toBe('alice');
  });

  it('rejects duplicate usernames', async () => {
    const res = await register('alice', 'anotherpass1');
    expect(res.status).toBe(409);
  });

  it('rejects weak passwords', async () => {
    const res = await register('bob', 'short');
    expect(res.status).toBe(400);
  });

  it('logs in with valid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'supersecret1' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('rejects wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'wrongpass1' });
    expect(res.status).toBe(401);
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const login = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'supersecret1' });
    const refreshToken = login.body.refreshToken;

    const first = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.accessToken).toBeTruthy();
    expect(first.body.refreshToken).not.toBe(refreshToken);

    // Reusing the presented (now-rotated) token must be rejected and revoke the family.
    const replay = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(replay.status).toBe(401);

    // The rotated token from the first refresh is also now revoked (family revoked).
    const afterReplay = await request(app).post('/api/auth/refresh').send({ refreshToken: first.body.refreshToken });
    expect(afterReplay.status).toBe(401);
  });

  it('guards /api/auth/me with a valid token', async () => {
    const login = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'supersecret1' });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('alice');

    const denied = await request(app).get('/api/auth/me');
    expect(denied.status).toBe(401);
  });
});

describe('device pairing + sessions API', () => {
  let ownerToken: string;
  let pairToken: string;

  beforeAll(async () => {
    const login = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'supersecret1' });
    ownerToken = login.body.accessToken;
  });

  it('creates a pairing token with a deep link', async () => {
    const res = await request(app)
      .post('/api/devices/pair')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(201);
    expect(res.body.pairToken).toMatch(/^lbpair_/);
    expect(res.body.deepLink).toContain('/pair?t=');
    pairToken = res.body.pairToken;
  });

  it('rejects pairing with a bad token', async () => {
    const res = await request(app)
      .post('/api/devices/pair/complete')
      .send({ token: 'lbpair_notarealtoken', device: { name: 'Xiaomi 13' } });
    expect(res.status).toBe(404);
  });

  it('completes pairing from the device side', async () => {
    const res = await request(app).post('/api/devices/pair/complete').send({
      token: pairToken,
      device: {
        name: 'Pixel 7',
        model: 'Pixel 7',
        manufacturer: 'Google',
        androidVersion: '14',
        appVersion: '1.0.0',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.deviceId).toBeTruthy();
    expect(res.body.deviceToken).toBeTruthy();
  });

  it('lists paired devices', async () => {
    const res = await request(app).get('/api/devices').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.devices).toHaveLength(1);
    expect(res.body.devices[0].name).toBe('Pixel 7');
  });

  it('cannot create a session while the device is not connected', async () => {
    const devices = await request(app).get('/api/devices').set('Authorization', `Bearer ${ownerToken}`);
    const deviceId = devices.body.devices[0].id;

    const res = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ deviceId, kind: 'screen' });
    expect(res.status).toBe(409);
  });

  it('marks the device online via its device token, then creates a session', async () => {
    const devices = await request(app).get('/api/devices').set('Authorization', `Bearer ${ownerToken}`);
    const deviceId = devices.body.devices[0].id;

    const login = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'supersecret1' });
    const pairRes = await request(app).post('/api/devices/pair').set('Authorization', `Bearer ${login.body.accessToken}`);
    const devicePair = await request(app).post('/api/devices/pair/complete').send({
      token: pairRes.body.pairToken,
      device: { name: 'Test Device' },
    });
    const deviceToken = devicePair.body.deviceToken;
    const secondDeviceId = devicePair.body.deviceId;

    const state = await request(app)
      .post('/api/devices/state')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({ status: 'online' });
    expect(state.status).toBe(200);

    const created = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ deviceId: secondDeviceId, kind: 'screen' });
    expect(created.status).toBe(201);
    expect(created.body.session.kind).toBe('screen');
    expect(created.body.session.status).toBe('consent_required');

    const detail = await request(app)
      .get(`/api/sessions/${created.body.session.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.turn).toBeDefined();

    const ended = await request(app)
      .delete(`/api/sessions/${created.body.session.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ended.status).toBe(200);
  });

  it('rejects unknown session kinds', async () => {
    const devices = await request(app).get('/api/devices').set('Authorization', `Bearer ${ownerToken}`);
    const deviceId = devices.body.devices[0].id;
    const res = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ deviceId, kind: 'microphone' });
    expect(res.status).toBe(400);
  });
});
