import 'dotenv/config';

function int(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function required(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  if (!value || value.startsWith('change-me')) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Environment variable ${name} must be set in production`);
    }
    console.warn(`[config] Using fallback for ${name} — set it in production.`);
  }
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  port: int(process.env.PORT, 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://linkbridge:linkbridge_dev@localhost:5432/linkbridge',
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret-not-for-production'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-not-for-production'),
    accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTtlDays: int(process.env.REFRESH_TOKEN_TTL_DAYS, 30),
  },
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  pairingBaseUrl: process.env.PAIRING_BASE_URL ?? 'http://localhost:5173',
  appLinkHost: process.env.APP_LINK_HOST ?? 'pair.linkbridge.example',
  ws: {
    heartbeatIntervalMs: int(process.env.WS_HEARTBEAT_INTERVAL_MS, 30_000),
    heartbeatTimeoutMs: int(process.env.WS_HEARTBEAT_TIMEOUT_MS, 60_000),
  },
  turn: {
    url: process.env.TURN_URL ?? '',
    username: process.env.TURN_USERNAME ?? 'linkbridge',
    secret: process.env.TURN_SECRET ?? '',
  },
  admin: {
    username: process.env.ADMIN_USERNAME ?? 'admin',
    password: process.env.ADMIN_PASSWORD ?? 'change-me-strong-password',
  },
} as const;

export type AppConfig = typeof config;
