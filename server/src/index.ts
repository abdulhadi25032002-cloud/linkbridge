import { createServer } from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { SignalingServer } from './signaling/server.js';
import { runMigrations } from './db/migrate.js';
import { ensureAdminAccount } from './routes/auth.js';

async function main(): Promise<void> {
  await runMigrations();
  await ensureAdminAccount();

  const app = createApp(() => signaling);
  const server = createServer(app);
  let signaling: SignalingServer;
  signaling = new SignalingServer(server);

  server.listen(config.port, () => {
    console.log(`[linkbridge] API + WebSocket listening on :${config.port}`);
  });

  const shutdown = () => {
    console.log('[linkbridge] shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[linkbridge] fatal startup error', err);
  process.exit(1);
});
