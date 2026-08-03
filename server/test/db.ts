import { Pool } from 'pg';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://linkbridge:linkbridge_dev@localhost:5432/linkbridge_test';

async function ensureTestDb(): Promise<void> {
  const admin = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? 'postgres://linkbridge:linkbridge_dev@localhost:5432/postgres',
  });
  const res = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', ['linkbridge_test']);
  if (res.rowCount === 0) {
    await admin.query('CREATE DATABASE linkbridge_test OWNER linkbridge');
  }
  await admin.end();
}

async function runMigrations(): Promise<void> {
  const { pool } = await import('../src/db/pool.js');
  const { runMigrations } = await import('../src/db/migrate.js');
  await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await runMigrations();
}

export async function resetDatabase(): Promise<void> {
  const { pool } = await import('../src/db/pool.js');
  await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  const { runMigrations } = await import('../src/db/migrate.js');
  await runMigrations();
}
