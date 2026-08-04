import { query } from '../db/pool.js';

export type ConnectionEvent =
  | 'connected'
  | 'disconnected'
  | 'reconnected'
  | 'heartbeat_timeout';

/**
 * Append a row to the connection log. Errors are swallowed on purpose:
 * monitoring must never break the signaling path.
 */
export async function logConnection(
  deviceId: string,
  event: ConnectionEvent,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await query(
      `INSERT INTO connection_logs (device_id, event, detail) VALUES ($1, $2, $3)`,
      [deviceId, event, JSON.stringify(detail)],
    );
  } catch (err) {
    console.error('[connectionLogs] failed to record event', event, err);
  }
}

export async function listConnectionLogs(
  deviceId: string,
  userId: string,
  limit: number,
): Promise<
  Array<{ id: string; event: string; detail: Record<string, unknown>; created_at: string }>
> {
  return query(
    `SELECT cl.id, cl.event, cl.detail, cl.created_at
       FROM connection_logs cl
       JOIN devices d ON d.id = cl.device_id
      WHERE cl.device_id = $1 AND d.user_id = $2
      ORDER BY cl.created_at DESC
      LIMIT $3`,
    [deviceId, userId, limit],
  );
}
