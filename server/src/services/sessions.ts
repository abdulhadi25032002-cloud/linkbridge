import { query, queryOne, withTransaction } from '../db/pool.js';

export const SESSION_KINDS = ['screen', 'camera', 'gallery'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];
export type SessionStatus =
  | 'pending'
  | 'consent_required'
  | 'active'
  | 'ended'
  | 'denied'
  | 'expired';

const CONSENT_TIMEOUT_MS = 60_000;

export interface SessionRow {
  id: string;
  user_id: string;
  device_id: string;
  kind: SessionKind;
  status: SessionStatus;
  consent_granted_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export class SessionError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

/** Create a remote session. It starts in `consent_required` and only
 *  becomes `active` once the device user explicitly grants consent. */
export async function createSession(
  userId: string,
  deviceId: string,
  kind: SessionKind,
): Promise<SessionRow> {
  return withTransaction(async (q) => {
    const device = (await q(
      `SELECT id, user_id, status FROM devices WHERE id = $1 FOR UPDATE`,
      [deviceId],
    ))[0] as { id: string; user_id: string; status: string } | undefined;

    if (!device) throw new SessionError(404, 'Device not found');
    if (device.user_id !== userId) throw new SessionError(404, 'Device not found');
    if (device.status !== 'online') throw new SessionError(409, 'Device is not online');

    const row = (await q(
      `INSERT INTO remote_sessions (user_id, device_id, kind, status)
       VALUES ($1, $2, $3, 'consent_required')
       RETURNING id, user_id, device_id, kind, status, consent_granted_at,
                 started_at, ended_at, created_at`,
      [userId, deviceId, kind],
    ))[0] as SessionRow;

    return row;
  });
}

/** Record a consent decision coming from the device user. */
export async function resolveConsent(
  sessionId: string,
  deviceId: string,
  granted: boolean,
  source: string = 'user',
): Promise<SessionRow> {
  return withTransaction(async (q) => {
    const session = (await q(
      `SELECT * FROM remote_sessions WHERE id = $1 AND device_id = $2 FOR UPDATE`,
      [sessionId, deviceId],
    ))[0] as SessionRow | undefined;

    if (!session) throw new SessionError(404, 'Session not found');
    if (session.status === 'ended') throw new SessionError(409, 'Session already ended');

    const decision = granted ? 'granted' : 'denied';
    await q(
      `INSERT INTO consent_log (session_id, device_id, decision, source) VALUES ($1, $2, $3, $4)`,
      [sessionId, deviceId, decision, source],
    );

    if (granted) {
      await q(
        `UPDATE remote_sessions
            SET status = 'active', consent_granted_at = now(), started_at = now()
          WHERE id = $1`,
        [sessionId],
      );
    } else {
      await q(`UPDATE remote_sessions SET status = 'denied' WHERE id = $1`, [sessionId]);
    }

    const updated = (await q(
      `SELECT * FROM remote_sessions WHERE id = $1`,
      [sessionId],
    ))[0] as SessionRow;
    return updated;
  });
}

/** Mark a session as ended (called by either peer or on disconnect). */
export async function endSession(sessionId: string): Promise<void> {
  await query(
    `UPDATE remote_sessions
        SET status = 'ended', ended_at = now()
      WHERE id = $1 AND status IN ('active', 'consent_required')`,
    [sessionId],
  );
}

export async function getSession(sessionId: string): Promise<SessionRow | undefined> {
  return queryOne<SessionRow>('SELECT * FROM remote_sessions WHERE id = $1', [sessionId]);
}

export async function listActiveSessionsForDevice(deviceId: string): Promise<SessionRow[]> {
  return query<SessionRow>(
    `SELECT * FROM remote_sessions
      WHERE device_id = $1 AND status = 'active'
      ORDER BY created_at DESC`,
    [deviceId],
  );
}

export const consentTimeoutMs = CONSENT_TIMEOUT_MS;
