import { randomBytes } from 'node:crypto';
import { config } from './config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold = LEVELS[config.logLevel as Level] ?? LEVELS.info;

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;
  const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, msg, ...fields };
  const line =
    config.nodeEnv === 'production'
      ? JSON.stringify(entry)
      : `[${entry.ts}] ${level.toUpperCase()} ${msg}${fields ? ' ' + JSON.stringify(fields) : ''}`;
  const out = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
  out.write(line + '\n');
}

/**
 * Structured logger. In production every line is JSON so it can be shipped
 * to a log aggregator as-is; in development it prints human-readable lines.
 */
export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};

export type LogFields = {
  requestId?: string;
  userId?: string;
  deviceId?: string;
  sessionId?: string;
};

/** Short unique id for correlating a request through logs. */
export function newRequestId(): string {
  return randomBytes(6).toString('hex');
}
