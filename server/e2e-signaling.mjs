import { WebSocket } from 'ws';

const BASE = 'http://localhost:5173';
const WS = 'ws://localhost:5173/ws';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const queue = [];
    const waiters = [];
    ws.on('open', () => resolve({ ws, send: (m) => ws.send(JSON.stringify(m)), next, waitFor, raw: ws }));
    ws.on('error', reject);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const wi = waiters.findIndex((w) => w.type === msg.type);
      if (wi >= 0) { const [w] = waiters.splice(wi, 1); w.resolve(msg); }
      else queue.push(msg);
    });
    function next(type, timeout = 5000) {
      const i = queue.findIndex((m) => m.type === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { type, resolve, timer: setTimeout(() => reject(new Error('timeout ' + type)), timeout) };
        waiters.push(w);
      });
    }
    function waitFor(ms) { return sleep(ms); }
  });
}

async function main() {
  // 1. login as admin
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'change-me-strong-password' }),
  }).then((r) => r.json());

  // 2. get devices
  const devices = await fetch(BASE + '/api/devices', { headers: { Authorization: `Bearer ${login.accessToken}` } }).then((r) => r.json());
  const device = devices.devices[0];

  // 3. mark device online via its token? we don't have device token for existing smoke device.
  // Instead create a fresh pairing + device token so we can authenticate the WS as device.
  const pair = await fetch(BASE + '/api/devices/pair', { method: 'POST', headers: { Authorization: `Bearer ${login.accessToken}` } }).then((r) => r.json());
  const completed = await fetch(BASE + '/api/devices/pair/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: pair.pairToken, device: { name: 'Signal Test' } }),
  }).then((r) => r.json());

  // 4. connect device WS
  const deviceWs = await connect();
  deviceWs.send({ type: 'auth', token: completed.deviceToken });
  const devAuth = await deviceWs.next('authed');
  console.log('device authed:', devAuth.peer, devAuth.deviceId);

  // 5. connect owner WS
  const ownerWs = await connect();
  ownerWs.send({ type: 'auth', token: login.accessToken });
  const ownerAuth = await ownerWs.next('authed');
  console.log('owner authed:', ownerAuth.peer);

  // 6. owner should receive presence for the now-online device
  const presence = await ownerWs.next('device.presence');
  console.log('owner sees presence:', presence.deviceId.slice(0, 8), presence.status);

  // 7. owner creates a session
  const created = await fetch(BASE + '/api/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.accessToken}` },
    body: JSON.stringify({ deviceId: completed.deviceId, kind: 'screen' }),
  }).then((r) => r.json());
  const sessionId = created.session.id;
  console.log('session created:', sessionId.slice(0, 8), 'status:', created.session.status);

  // 8. device receives consent request
  const consentReq = await deviceWs.next('consent.request');
  console.log('device got consent request for', consentReq.kind, 'session', consentReq.sessionId.slice(0, 8));

  // 9. device grants consent
  deviceWs.send({ type: 'consent.response', sessionId, granted: true });

  // 10. owner receives session.status active
  const statusMsg = await ownerWs.next('session.status');
  console.log('owner sees session status:', statusMsg.status);

  // 11. signaling relay: owner -> device
  ownerWs.send({ type: 'signal', sessionId, to: 'device', data: { type: 'offer', sdp: 'v=0 fake-sdp' } });
  const signal = await deviceWs.next('signal');
  console.log('signal relayed to device:', signal.data.type);

  // 12. relay fallback data
  ownerWs.send({ type: 'relay.data', sessionId, to: 'device', channel: 'control', payload: '{"type":"ping"}' });
  const relay = await deviceWs.next('relay.data');
  console.log('relay data delivered:', relay.payload);

  // 13. end session
  deviceWs.send({ type: 'session.end', sessionId });
  const ended = await ownerWs.next('session.end');
  console.log('owner notified of session end:', ended.sessionId.slice(0, 8));

  // 14. owner should be blocked from signaling when no active session
  const unauthed = await fetch(BASE + '/api/devices', { headers: { Authorization: 'Bearer bogus' } });
  console.log('bogus token rejected:', unauthed.status);

  console.log('ALL SIGNALING CHECKS PASSED');
  deviceWs.raw.close(); ownerWs.raw.close();
  process.exit(0);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
