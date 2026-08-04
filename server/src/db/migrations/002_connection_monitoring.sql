-- 002_connection_monitoring.sql
-- Connection monitoring: heartbeat tracking, reconnect counters and an
-- append-only log of connection state changes per device.

ALTER TABLE devices
  ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'offline'
    CHECK (connection_status IN ('online', 'offline')),
  ADD COLUMN last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN connection_changed_at TIMESTAMPTZ,
  ADD COLUMN reconnect_count INT NOT NULL DEFAULT 0;

-- Append-only connection log used for diagnostics and the dashboard timeline.
CREATE TABLE connection_logs (
  id         BIGSERIAL PRIMARY KEY,
  device_id  UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  event      TEXT NOT NULL
             CHECK (event IN ('connected', 'disconnected', 'reconnected',
                              'heartbeat_timeout')),
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_connection_logs_device ON connection_logs(device_id, created_at DESC);
