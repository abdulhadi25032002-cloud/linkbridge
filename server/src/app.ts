import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { config } from './config.js';
import { logger, newRequestId, type LogFields } from './logger.js';
import { authRouter } from './routes/auth.js';
import { devicesRouter } from './routes/devices.js';
import { sessionsRouter } from './routes/sessions.js';
import type { SignalingServer } from './signaling/server.js';

const WEB_DIST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../web/dist',
);

export function createApp(getSignaling: () => SignalingServer): express.Express {
  const app = express();
  app.disable('x-powered-by');

  // Request correlation id + structured access log.
  app.use((req, res, next) => {
    const requestId = (req.headers['x-request-id'] as string) || newRequestId();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const startedAt = performance.now();
    res.on('finish', () => {
      const durationMs = Math.round(performance.now() - startedAt);
      const fields: LogFields & { method: string; path: string; status: number; durationMs: number } = {
        requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs,
      };
      if (req.userId) fields.userId = req.userId;
      if (req.deviceId) fields.deviceId = req.deviceId;
      if (res.statusCode >= 500) logger.error('request failed', fields);
      else if (res.statusCode >= 400) logger.warn('request rejected', fields);
      else logger.info('request handled', fields);
    });
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: false, // managed by the SPA build
    }),
  );
  app.use(
    cors({
      origin: config.webOrigin,
      credentials: false,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });
  app.use('/api/auth', authLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/devices', devicesRouter);
  app.use('/api/sessions', sessionsRouter(getSignaling));

  if (existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get(/^(?!\/api|\/ws).*/, (_req, res) => {
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Centralized error handler. Zod errors are surfaced as 400s; everything
  // else is logged with a correlation id and kept opaque to the client.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.issues });
      return;
    }
    logger.error('unhandled error', {
      requestId: res.locals.requestId,
      path: req.originalUrl,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
