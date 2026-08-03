-- 001_init.sql
-- Core LinkBridge schema. See docs/ARCHITECTURE.md for design rationale.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users of the dashboard (the device owner).
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rotating refresh tokens. Only the hash is stored; families enable
-- reuse detection (token theft detection).
CREATE TABLE refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  family       TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  replaced_by  UUID,
  user_agent   TEXT,
  ip           INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- The owner's Android devices.
CREATE TABLE devices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  model             TEXT,
  manufacturer      TEXT,
  android_version   TEXT,
  app_version       TEXT,
  pairing_token_id  UUID,
  public_key        TEXT,
  status            TEXT NOT NULL DEFAULT 'offline'
                    CHECK (status IN ('pairing', 'online', 'offline')),
  paired_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_devices_user ON devices(user_id);
CREATE INDEX idx_devices_status ON devices(status);

-- One-time pairing tokens exchanged during device pairing.
CREATE TABLE pairing_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  device_id   UUID REFERENCES devices(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pairing_tokens_user ON pairing_tokens(user_id);
CREATE INDEX idx_pairing_tokens_hash ON pairing_tokens(token_hash);

-- Remote sessions (screen/camera/gallery). Every session requires
-- explicit consent from the device user before it can start.
CREATE TABLE remote_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id          UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('screen', 'camera', 'gallery')),
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'consent_required',
                                       'active', 'ended', 'denied', 'expired')),
  consent_granted_at TIMESTAMPTZ,
  consent_ip         INET,
  started_at         TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_remote_sessions_device ON remote_sessions(device_id, created_at DESC);
CREATE INDEX idx_remote_sessions_user ON remote_sessions(user_id, created_at DESC);

-- Audit log for every consent decision.
CREATE TABLE consent_log (
  id         BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES remote_sessions(id) ON DELETE CASCADE,
  device_id  UUID NOT NULL REFERENCES devices(id),
  decision   TEXT NOT NULL CHECK (decision IN ('granted', 'denied')),
  source     TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_consent_log_session ON consent_log(session_id);

-- Cross-reference FKs (added after both tables exist to avoid ordering issues).
ALTER TABLE devices
  ADD CONSTRAINT fk_devices_pairing_token
  FOREIGN KEY (pairing_token_id) REFERENCES pairing_tokens(id);
