import { execSync } from 'node:child_process';

export default function globalSetup() {
  // Point the app at the isolated test database.
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ??
    'postgres://linkbridge:linkbridge_dev@localhost:5432/linkbridge_test';
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-not-for-prod';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-not-for-prod';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'test-admin-password';

  // Ensure the test database exists (idempotent).
  try {
    execSync(
      `su postgres -c "psql -tc \\"SELECT 1 FROM pg_database WHERE datname='linkbridge_test'\\" | grep -q 1 || psql -c \\"CREATE DATABASE linkbridge_test OWNER linkbridge\\""`,
      { stdio: 'ignore' },
    );
  } catch {
    // fall through — database may already exist
  }
}
