# LinkBridge — Setup & Deployment

## Prerequisites

- Node.js 20+ and npm
- PostgreSQL 15+
- (For the full system) a domain with TLS, and coturn for the relay fallback
- JDK 17+ and Android SDK to build the app

## 1. Repository layout

```
server/   Node.js + TypeScript + Express + WebSocket signaling
web/      React + Vite + TypeScript dashboard
android/  Kotlin Android app
docs/     architecture, security, API, Android docs
```

`npm install` at the root installs the `server` and `web` workspaces.

## 2. Database

```bash
sudo service postgresql start
sudo -u postgres psql -c "CREATE ROLE linkbridge LOGIN PASSWORD 'linkbridge_dev';"
sudo -u postgres psql -c "CREATE DATABASE linkbridge OWNER linkbridge;"
sudo -u postgres psql -c "CREATE DATABASE linkbridge_test OWNER linkbridge;"
```

## 3. Backend

```bash
cd server
cp .env.example .env   # then edit secrets — see below
npm install
npm run migrate
npm run typecheck
npm test               # runs against linkbridge_test
npm run dev            # dev, or: npm start
```

Server listens on `:8080` by default.

### Environment variables (`server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://linkbridge:linkbridge_dev@localhost:5432/linkbridge` | primary DB |
| `TEST_DATABASE_URL` | `…linkbridge_test` | test DB |
| `JWT_SECRET` | generated | signs access/device tokens |
| `PAIRING_SALT` | generated | hashes pairing + refresh tokens |
| `REFRESH_TOKEN_TTL_DAYS` | 30 | refresh token lifetime |
| `WEB_ORIGIN` | `http://localhost:5173` | CORS allowlist |
| `TURN_URL` | unset | `turn:host:3478?transport=udp` |
| `TURN_SECRET` | unset | HMAC key for coturn REST creds |
| `TURN_TTL` | 3600 | credential validity (seconds) |
| `BOOTSTRAP_ADMIN` / `BOOTSTRAP_ADMIN_PASSWORD` | `admin` / `change-me` | create the owner on first boot (dev) |

> Rotate `JWT_SECRET`, `PAIRING_SALT`, `TURN_SECRET` before exposing the
> server publicly. `.env` is git-ignored.

## 4. Web dashboard

```bash
cd web
npm install
npm run typecheck
npx vite --port 5173   # dev, proxies /api and /ws to :8080
npx vite build         # production build -> dist/
```

## 5. Full local run

```bash
# terminal 1
sudo service postgresql start
cd server && npm run migrate && npm run dev

# terminal 2
cd web && npx vite --port 5173
```

Open `http://localhost:5173`, log in with the bootstrap admin
(`admin` / the password from `.env`), and pair a device.

## 6. Production deployment

A reference `docker-compose.yml` is included at the repo root:

```bash
docker compose up -d --build
```

It runs **PostgreSQL** and the **LinkBridge server** (which also serves the
built dashboard). For the relay fallback, add a `coturn` service and set
`TURN_URL` + `TURN_SECRET` on the server.

Recommended production topology:

```mermaid
graph LR
    U["Browser / Android app"] -->|HTTPS/WSS| P["Reverse proxy (Caddy/Nginx + TLS)"]
    P -->|"localhost:8080"| S["LinkBridge server"]
    S -->|SQL| DB["PostgreSQL"]
    U -->|"WebRTC/TURN"| C["coturn"]
    S -->|REST TURN creds| C
```

### coturn example

```ini
# /etc/coturn/turnserver.conf
listening-port=3478
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=<same value as TURN_SECRET>
realm=turn.example.com
no-cli
```

Point `TURN_URL` at `turn:turn.example.com:3478?transport=udp`. Credentials
are issued by the backend via the coturn REST API convention and expire after
`TURN_TTL` seconds.

## 7. Android app

See `docs/ANDROID.md`. Point the app at your server with
`-Plinkbridge.serverUrl=https://…` when building; the default dev value is
`http://10.0.2.2:8080`.

## 8. Verification

```bash
# backend
cd server && npm run typecheck && npm test
node e2e-signaling.mjs   # consent flow + relay + teardown end-to-end

# web
cd web && npm run typecheck && npx vite build

# health
curl -s http://localhost:8080/api/health
```

## Troubleshooting

- **Postgres not connecting**: `sudo service postgresql start`; confirm the
  role/db exist (`\l`).
- **401 on refresh**: clear the stored token and re-login; a rotated refresh
  token revokes the family by design.
- **Device shows offline**: ensure the Android app started `RemoteService` and
  the backend can reach the device (check the WSS connection in logs).
- **No P2P media**: TURN is the fallback; if unset, both peers must be on the
  same reachable network.
