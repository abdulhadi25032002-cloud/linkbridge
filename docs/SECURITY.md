# LinkBridge — Security

## Scope

LinkBridge is designed to give **one user** (the owner) remote access to
**their own** Android devices, with explicit per-session consent from the
device user. It is not a mass surveillance tool and does not attempt to hide
from the device user.

## Threat model

| Threat | Mitigation |
|---|---|
| Credential theft (API) | Scrypt password hashing, rotating refresh-token families with reuse detection, short-lived JWTs |
| Pairing token theft | Single-use tokens, 10-minute TTL, only SHA-256 stored at rest |
| Device impersonation | Device-scoped JWT issued only at pairing completion; tokens encrypted on device |
| Eavesdropping on media | WebRTC DTLS-SRTP; signaling over TLS |
| Unauthorized session start | Sessions are `consent_required` until the device user explicitly approves |
| Compromised dashboard session | Refresh token rotation; logout invalidates the family; new sessions require fresh login |
| DB dump | Passwords/tokens never stored in plaintext; refresh tokens and pairing tokens hashed |
| Stolen Android device | Keystore-backed AES-GCM encryption of stored credentials; app cannot silently grant sessions |

## Authentication

### Passwords
- Hashed with scrypt (N=2^15, r=8, p=1, 32-byte key), unique 16-byte salt per
  user, stored as `salt + hash` hex in `users.salt` / `users.password`.
- Constant-time comparison via `crypto.timingSafeEqual`.

### Access tokens
- JWT, `type: "access"`, signed with HS256 using `JWT_SECRET`.
- Owner tokens carry `sub: userId, type: "access"`; device tokens carry
  `sub: deviceId, type: "device"`.
- Short-lived (default 30 min) so a stolen token has a small window.

### Refresh tokens
- Opaque 48-byte random values; only their SHA-256 hash is stored.
- Each login/refresh mints a new refresh token and stores its
  `familyId`; refreshing rotates the token and advances `familySeq`.
- If an already-rotated token is used again, the whole family is revoked —
  this detects replay/theft.

## Pairing
- `POST /api/devices/pair` returns a one-time `lbpair_…` token with a
  10-minute TTL. Only the hash is stored.
- Completion requires the raw token, exchanges it for a device JWT, and the
  token row is deleted atomically.
- Pairing links use `linkbridge://` (plus verified HTTPS App Links where a
  domain is configured). Nothing ever pairs without the user opening the link
  and confirming.

## Session consent
- Sessions start in `consent_required`. `resolveConsent` re-checks that the
  session still exists, the device is the expected one, and that the grant is
  valid before moving to `active`.
- Consent requests expire after 60 seconds; a stale grant is rejected.
- Every accept/deny/expiry is appended to `consent_log` (who, what kind,
  when, and whether it was granted).

## Data at rest on Android
- API base URL and device token are stored in a `SharedPreferences`-backed
  store encrypted with AES-256-GCM; the key lives in the Android Keystore
  (`SecureStore.kt`).
- Media never touches disk: screen/camera frames stream straight to WebRTC.
  Gallery thumbs are read on demand via MediaStore and never persisted.

## Transport
- Backend serves TLS-terminated HTTPS/WSS behind the reverse proxy.
- WebRTC media is always DTLS-SRTP; when P2P fails, a TURN relay with
  time-limited HMAC credentials is used (never a plaintext proxy).
- Control fallback messages over the WebSocket carry a signed session ID and
  are only accepted for `active` sessions.

## Explicit non-goals (never built)
File transfer, clipboard sync, SMS, contacts, call logs, notification
access, microphone, and location are intentionally **not** part of LinkBridge.
The Android manifest requests only the permissions required for the shipped
features.

## Operational hardening
- Keep `JWT_SECRET`, `PAIRING_SALT`, and `TURN_SECRET` long, random, and out
  of version control (see `.env.example`).
- Terminate TLS with a trusted certificate; do not expose plain HTTP.
- Add rate limiting / fail2ban at the reverse proxy for `/api/auth` if the
  instance is internet-facing.
- Rotate `TURN_SECRET` and DB credentials regularly.
