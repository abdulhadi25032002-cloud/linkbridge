import WebSocket from 'ws';

const BASE = 'http://localhost:8080/api';

async function j(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

const login = await j('POST', '/auth/login', {
  body: { username: 'admin', password: process.env.ADMIN_PASSWORD || 'change-me-strong-password' },
});
const token = login.data.accessToken;
console.log('login:', login.status);

const pair = await j('POST', '/devices/pair', { token });
console.log('pair:', pair.status);
const pairToken = pair.data.pairToken;

const complete = await j('POST', '/devices/pair/complete', {
  body: { token: pairToken, device: { name: 'Heartbeat Probe', model: 'Pixel 8', manufacturer: 'Google', androidVersion: '14', appVersion: '1.0.0' } },
});
console.log('pair/complete:', complete.status);
const deviceId = complete.data.deviceId;
const deviceToken = complete.data.deviceToken;

const deviceWs = new WebSocket('ws://localhost:8080/ws');
await new Promise((r, rj) => { deviceWs.on('open', r); deviceWs.on('error', rj); });
deviceWs.send(JSON.stringify({ type: 'auth', token: deviceToken }));
await new Promise((r) => deviceWs.on('message', () => r()));

await new Promise((r) => setTimeout(r, 2500));

let dev = await j('GET', '/devices', { token });
const d = dev.data.devices.find((x) => x.id === deviceId);
console.log('device after connect:', JSON.stringify({
  status: d.status, connectionStatus: d.connection_status,
  lastSeenAt: d.last_seen_at ? 'set' : null,
  lastHeartbeatAt: d.last_heartbeat_at ? 'set' : null,
  reconnectCount: d.reconnect_count,
}));

let logs = await j('GET', `/devices/${deviceId}/logs`, { token });
console.log('logs after connect:', logs.data.logs.map((l) => l.event).join(','));

// Simulate a drop and reconnect -> expect reconnected + reconnect_count 1
deviceWs.close();
await new Promise((r) => setTimeout(r, 800));
const deviceWs2 = new WebSocket('ws://localhost:8080/ws');
await new Promise((r, rj) => { deviceWs2.on('open', r); deviceWs2.on('error', rj); });
deviceWs2.send(JSON.stringify({ type: 'auth', token: deviceToken }));
await new Promise((r) => deviceWs2.on('message', () => r()));
await new Promise((r) => setTimeout(r, 800));

dev = await j('GET', '/devices', { token });
const d2 = dev.data.devices.find((x) => x.id === deviceId);
console.log('device after reconnect:', JSON.stringify({ connectionStatus: d2.connection_status, reconnectCount: d2.reconnect_count }));

logs = await j('GET', `/devices/${deviceId}/logs`, { token });
console.log('logs after reconnect:', logs.data.logs.map((l) => `${l.event}`).join(','));

// offline after close
deviceWs2.close();
await new Promise((r) => setTimeout(r, 800));
dev = await j('GET', '/devices', { token });
const d3 = dev.data.devices.find((x) => x.id === deviceId);
console.log('device after close:', JSON.stringify({ status: d3.status, connectionStatus: d3.connection_status }));
process.exit(0);
