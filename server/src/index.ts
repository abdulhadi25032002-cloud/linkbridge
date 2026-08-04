import { createServer } from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { SignalingServer } from './signaling/server.js';
import { runMigrations } from './db/migrate.js';
import { ensureAdminAccount } from './routes/auth.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  logger.info('starting', { nodeEnv: config.nodeEnv, port: config.port });
  await runMigrations();
  await ensureAdminAccount();

  const app = createApp(() => signaling);
  const server = createServer(app);
  let signaling: SignalingServer;
  signaling = new SignalingServer(server);

  server.listen(config.port, () => {
    logger.info('listening', { port: config.port, path: '/ws' });
  });

  server.on('error', (err) => {
    logger.error('http server error', { error: err.message });
  });

  const shutdown = () => {
    logger.info('shutting down');
    signaling.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error('fatal startup error', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
