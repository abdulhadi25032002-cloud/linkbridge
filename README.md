# LinkBridge

Secure remote access for **your own** Android devices — with explicit
on-device consent for every session, end-to-end encryption, and cross-network
support.

> Scope: LinkBridge manages only the owner's own devices. Every remote session
> requires the device user to explicitly Accept it on the device. Features that
> could be used for covert surveillance are deliberately **not** built
> (see [Security](docs/SECURITY.md)).

## What it does

- Pair an Android device by scanning a QR code / opening a deep link
- Stream the device **screen** live, and **control touch** from a web
  dashboard
- View the device **camera** (permission-gated, granted on first open)
- Browse the device **gallery** (permission-gated)
- WebRTC with DTLS-SRTP encryption and a TURN relay fallback; signaling over
  TLS; auto-reconnect after network changes

## Repository layout

```
server/   Node.js + TypeScript + Express + PostgreSQL + WebSocket signaling
web/      React + TypeScript + Tailwind dashboard (Vite)
android/  Kotlin Android app (pairing, screen/camera streaming, touch)
docs/     ARCHITECTURE.md, SECURITY.md, API.md, ANDROID.md, SETUP.md
Dockerfile / docker-compose.yml
```

## Quick start (dev)

```bash
npm install
# 1) start PostgreSQL and create the linkbridge / linkbridge_test DBs (see docs/SETUP.md)
cd server && cp .env.example .env && npm run migrate && npm run dev   # :8080
cd web && npx vite --port 5173                                       # dashboard
```

Log in with the bootstrap admin, then pair a device with the Android app.

Full setup, production deployment (TLS, coturn relay, Docker) and
troubleshooting: **[docs/SETUP.md](docs/SETUP.md)**.

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | components, data model, pairing/session flows, connection model |
| [docs/API.md](docs/API.md) | REST endpoints + WebSocket signaling protocol |
| [docs/ANDROID.md](docs/ANDROID.md) | Android app layout, permission model, WebRTC, building |
| [docs/SECURITY.md](docs/SECURITY.md) | threat model, auth, consent, data-at-rest, hardening |
| [docs/SETUP.md](docs/SETUP.md) | database, env vars, dev run, production, coturn |

## Security model (summary)

- Consent-gated sessions: `consent_required` → device user Accept → `active`
- Scrypt password hashing; rotating refresh-token families with reuse
  detection; one-time pairing tokens (hashed at rest)
- Keystore-encrypted credentials on the device; media never touches disk
- No microphone, location, SMS, contacts, clipboard, or notification access

## Development status

Implemented: backend (auth, pairing, sessions, signaling, TURN creds, tests),
web dashboard (auth, device list, pairing, remote room), Android app
(pairing + permission flow, screen/touch/camera/gallery). The Android project
is source-complete and builds with AGP 8.7 / JDK 17 in Android Studio or CI.
