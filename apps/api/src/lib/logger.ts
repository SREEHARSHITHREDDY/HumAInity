/* Structured logging.
 *
 * One line of JSON per event in production so a log shipper can parse it;
 * readable text in development so a human can. Nothing clinical is ever
 * logged — not a diagnosis, not a note, not a wellbeing answer. When an error
 * touches the health store, the message is logged and the payload is not. */
import { env } from './env.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? (env.NODE_ENV === 'production' ? 'info' : 'debug')] ?? 20;

/* Keys whose values are never written to a log, wherever they appear. */
const REDACT = new Set([
  'password', 'passwordHash', 'currentPassword', 'newPassword', 'token', 'refreshToken',
  'authorization', 'cookie', 'clinicalNotes', 'diagnosisCode', 'employeeNote',
  'responses', 'resumeText', 'HEALTH_ENCRYPTION_KEY', 'JWT_SECRET',
]);

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT.has(k) ? '[redacted]' : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: Level, message: string, context?: Record<string, unknown>) {
  if (ORDER[level] < threshold) return;
  const payload = { ts: new Date().toISOString(), level, message, ...(context ? scrub(context) as object : {}) };
  const line = env.NODE_ENV === 'production'
    ? JSON.stringify(payload)
    : `  ${level.toUpperCase().padEnd(5)} ${message}` +
      (context ? ` ${JSON.stringify(scrub(context))}` : '');
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

export const log = {
  debug: (m: string, c?: Record<string, unknown>) => emit('debug', m, c),
  info:  (m: string, c?: Record<string, unknown>) => emit('info', m, c),
  warn:  (m: string, c?: Record<string, unknown>) => emit('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => emit('error', m, c),
};
