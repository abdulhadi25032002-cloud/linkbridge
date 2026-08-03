# LinkBridge — API

Base path: `/api` (e.g. `POST /api/auth/login`).

All endpoints are JSON. Owner endpoints require `Authorization: Bearer
<accessToken>`. The token is issued at login/register and refreshed via
`/api/auth/refresh` (the web client does this automatically with retry on
401).

Errors use the shape `{ "error": "message" }` with an appropriate HTTP status
(`400`, `401`, `403`, `404`, `429`, `500`).

---

## Health

### `GET /api/health`
Public. Returns service status.

```json
{ "status": "ok", "uptime": 123.4 }
```

---

## Auth

### `POST /api/auth/register`
Body: `{ "username": "alice", "password": "…" }`. Creates the owner account
and logs them in.

### `POST /api/auth/login`
Body: `{ "username": "alice", "password": "…" }`.

Both return:

```json
{
  "user": { "id": "…", "username": "alice" },
  "accessToken": "eyJ…",
  "refreshToken": "abc…"
}
```

### `POST /api/auth/refresh`
Body: `{ "refreshToken": "abc…" }`. Rotates the refresh token and returns new
`accessToken` + `refreshToken`. Reuse of a rotated token revokes the family.

### `POST /api/auth/logout`
Bearer required. Body: `{ "refreshToken": "abc…" }`. Revokes the family.

### `GET /api/auth/me`
Bearer required. Returns `{ "user": { "id", "username" } }`.

---

## Devices

### `POST /api/devices/pair`
Bearer required. Creates a one-time pairing token (10-minute TTL) and returns
everything needed to render a QR / deep link:

```json
{
  "pairToken": "lbpair_…",
  "expiresAt": "2026-08-03T10:00:00Z",
  "deepLink": "linkbridge://pair?token=…",
  "qr": "linkbridge://pair?token=…"
}
```

### `POST /api/devices/pair/complete`
Public (no auth). Body: `{ "pairToken": "…", "deviceName": "Pixel 8" }`.

```json
{
  "device": { "id": "…", "name": "Pixel 8", "createdAt": "…" },
  "deviceToken": "eyJ…"
}
```
The `deviceToken` is the Android app's long-lived credential (rotate via a
future re-pair).

### `GET /api/devices`
Bearer required. Lists owned devices with live presence:

```json
{
  "devices": [
    {
      "id": "…",
      "name": "Pixel 8",
      "platform": "android",
      "createdAt": "…",
      "lastSeenAt": "…",
      "online": true
    }
  ]
}
```

### `PATCH /api/devices/:deviceId`
Bearer required. Body: `{ "name": "New name" }`. Renames the device.

### `DELETE /api/devices/:deviceId`
Bearer required. Removes the device and its consent log.

### `POST /api/devices/state`
Device token required. Android reports presence + capabilities when its
WebSocket connects/disconnects:

```json
{ "online": true, "capabilities": ["screen", "touch", "camera", "gallery"] }
```

---

## Remote sessions

### `POST /api/sessions`
Bearer required. Body: `{ "deviceId": "…", "kind": "screen" }`
(`kind` ∈ `screen` | `camera` | `gallery`). Returns `403` if the device is
offline. On success:

```json
{
  "session": {
    "id": "…",
    "deviceId": "…",
    "kind": "screen",
    "status": "consent_required",
    "createdAt": "…"
  }
}
```

### `GET /api/sessions`
Bearer required. Lists the owner's sessions.

### `GET /api/sessions/:sessionId`
Bearer required. Session detail **including TURN credentials** for the media
relay fallback:

```json
{
  "session": {
    "id": "…",
    "deviceId": "…",
    "kind": "screen",
    "status": "consent_required",
    "createdAt": "…"
  },
  "turn": {
    "urls": ["turn:turn.example.com:3478?transport=udp"],
    "username": "…",
    "credential": "…"
  }
}
```
`turn` is omitted when TURN is not configured.

### `DELETE /api/sessions/:sessionId`
Bearer required. Ends the session; the signaling server notifies both peers.

---

## WebSocket signaling — `WSS /ws`

Authenticated by query parameter (`?token=<accessToken|deviceToken>`).

Message envelope:

```json
{ "type": "…", "sessionId": "…", "payload": { } }
```

Messages:

| type | from | purpose |
|---|---|---|
| `presence` | server | `{ online: true }` device presence broadcast |
| `consent.request` | server → device | asks device user for consent; payload includes `{ kind, turn }` |
| `consent.response` | device → server | `{ granted: true, kind }` |
| `session.status` | server → owner | `{ status: "active" }` |
| `signal` | both | WebRTC offer/answer/ICE (payload forwarded verbatim) |
| `relay.data` | both | control fallback when the data channel is down |
| `session.end` | server → both | teardown |

Signaling messages are forwarded **only** between the owner and device
involved in an `active` (or consenting) session, matched by `sessionId`.
