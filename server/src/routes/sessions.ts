import { Router, type Request as ExpressRequest } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, authUserId } from '../auth/middleware.js';
import {
  createSession,
  endSession,
  getSession,
  SESSION_KINDS,
  SessionError,
  type SessionRow,
} from '../services/sessions.js';
import { issueTurnCredentials } from '../relay/turn.js';
import type { SignalingServer } from '../signaling/server.js';

export function sessionsRouter(getSignaling: () => SignalingServer): Router {
  const router = Router();

  /** Create a remote session. Triggers a consent request to the device. */
  router.post('/', requireAuth, async (req: ExpressRequest, res, next) => {
    try {
      const { deviceId, kind } = z
        .object({ deviceId: z.string().uuid(), kind: z.enum(SESSION_KINDS) })
        .parse(req.body);

      const session = await createSession(authUserId(req), deviceId, kind);
      getSignaling().requestConsent(session);
      res.status(201).json({ session });
    } catch (err) {
      if (err instanceof SessionError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  /** List sessions for the current user (optionally filtered by device). */
  router.get('/', requireAuth, async (req: ExpressRequest, res, next) => {
    try {
      const { deviceId } = z
        .object({ deviceId: z.string().uuid().optional() })
        .parse(req.query);
      const userId = authUserId(req);
      const rows = await query<SessionRow>(
        `SELECT * FROM remote_sessions
          WHERE user_id = $1 ${deviceId ? 'AND device_id = $2' : ''}
          ORDER BY created_at DESC LIMIT 100`,
        deviceId ? [userId, deviceId] : [userId],
      );
      res.json({ sessions: rows });
    } catch (err) {
      next(err);
    }
  });

  /** Session detail plus TURN relay credentials for the WebRTC connection. */
  router.get('/:sessionId', requireAuth, async (req: ExpressRequest, res, next) => {
    try {
      const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(req.params);
      const session = await getSession(sessionId);
      if (!session || session.user_id !== authUserId(req)) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      res.json({ session, turn: issueTurnCredentials(sessionId) });
    } catch (err) {
      next(err);
    }
  });

  /** End a session from the dashboard side. */
  router.delete('/:sessionId', requireAuth, async (req: ExpressRequest, res, next) => {
    try {
      const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(req.params);
      const session = await getSession(sessionId);
      if (!session || session.user_id !== authUserId(req)) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      await endSession(sessionId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
