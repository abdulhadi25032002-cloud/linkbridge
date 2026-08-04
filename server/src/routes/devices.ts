import { Router, type Request as ExpressRequest } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { requireAuth, requireDevice, authUserId } from '../auth/middleware.js';
import { createPairingToken, completePairing, PairingError } from '../services/pairing.js';
import { listConnectionLogs } from '../services/connectionLogs.js';

export const devicesRouter = Router();

interface DeviceRow {
  id: string;
  name: string;
  model: string | null;
  manufacturer: string | null;
  android_version: string | null;
  app_version: string | null;
  status: 'pairing' | 'online' | 'offline';
  connection_status: 'online' | 'offline';
  paired_at: string;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
  connection_changed_at: string | null;
  reconnect_count: number;
}

/** List the owner's paired devices with live status. */
devicesRouter.get('/', requireAuth, async (req: ExpressRequest, res, next) => {
  try {
    const rows = await query<DeviceRow>(
      `SELECT id, name, model, manufacturer, android_version, app_version,
              status, connection_status, paired_at, last_seen_at,
              last_heartbeat_at, connection_changed_at, reconnect_count
         FROM devices
        WHERE user_id = $1
        ORDER BY paired_at DESC`,
      [authUserId(req)],
    );
    res.json({ devices: rows });
  } catch (err) {
    next(err);
  }
});

/** Connection log for a single device (heartbeat/reconnect diagnostics). */
devicesRouter.get('/:deviceId/logs', requireAuth, async (req: ExpressRequest, res, next) => {
  try {
    const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(req.params);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const logs = await listConnectionLogs(deviceId, authUserId(req), limit);
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

/** Create a new pairing token and return the deep link/QR payload. */
devicesRouter.post('/pair', requireAuth, async (req: ExpressRequest, res, next) => {
  try {
    const payload = await createPairingToken(authUserId(req));
    res.status(201).json(payload);
  } catch (err) {
    next(err);
  }
});

/** Rename a device. */
devicesRouter.patch('/:deviceId', requireAuth, async (req: ExpressRequest, res, next) => {
  try {
    const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(req.params);
    const { name } = z.object({ name: z.string().min(1).max(64) }).parse(req.body);
    const updated = await queryOne<DeviceRow>(
      `UPDATE devices SET name = $1
        WHERE id = $2 AND user_id = $3
        RETURNING id, name, status`,
      [name, deviceId, authUserId(req)],
    );
    if (!updated) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    res.json({ device: updated });
  } catch (err) {
    next(err);
  }
});

/** Unpair (remove) a device from the owner's account. */
devicesRouter.delete('/:deviceId', requireAuth, async (req: ExpressRequest, res, next) => {
  try {
    const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(req.params);
    const result = await query(
      `DELETE FROM devices WHERE id = $1 AND user_id = $2 RETURNING id`,
      [deviceId, authUserId(req)],
    );
    if (result.length === 0) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Android app: complete pairing using a one-time token. */
devicesRouter.post('/pair/complete', async (req: ExpressRequest, res, next) => {
  try {
    const body = z
      .object({
        token: z.string().startsWith('lbpair_'),
        device: z.object({
          name: z.string().min(1).max(64),
          model: z.string().max(64).optional(),
          manufacturer: z.string().max(64).optional(),
          androidVersion: z.string().max(32).optional(),
          appVersion: z.string().max(32).optional(),
          publicKey: z.string().max(2048).optional(),
        }),
      })
      .parse(req.body);

    const result = await completePairing(body.token, body.device);
    res.status(201).json({
      deviceId: result.deviceId,
      deviceToken: result.deviceToken,
    });
  } catch (err) {
    if (err instanceof PairingError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/** Android app: report device state changes (online/offline). */
devicesRouter.post('/state', requireDevice, async (req: ExpressRequest, res, next) => {
  try {
    const body = z.object({ status: z.enum(['online', 'offline']) }).parse(req.body);
    await query(
      `UPDATE devices
          SET status = $1,
              connection_status = $1,
              last_seen_at = now(),
              last_heartbeat_at = now(),
              connection_changed_at = now()
        WHERE id = $2`,
      [body.status, req.deviceId],
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
