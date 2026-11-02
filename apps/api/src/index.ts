import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { log } from './lib/logger.js';
import { keyConfigured } from './lib/crypto.js';
import { REPO_ROOT } from './lib/load-env.js';
import { env } from './lib/env.js';
import { AppError } from './lib/errors.js';
import { authRoutes } from './routes/auth.routes.js';
import { hrRoutes } from './routes/hr.routes.js';
import { scheduleRoutes } from './routes/schedule.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { workforceRoutes } from './routes/workforce.routes.js';
import { portalRoutes } from './routes/portal.routes.js';
import { HR_DB_PATH, HEALTH_DB_PATH, hrConnection, healthConnection } from './db/index.js';
import * as firewall from './services/firewall.service.js';

const VERSION = '1.1.0';

const app = express();
app.set('trust proxy', 1);

/* Security headers. CSP is deliberately strict: this application loads no
 * third-party scripts at all, so there is no reason to permit any. */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

/* Credentials are allowed because the refresh token travels as an httpOnly
 * cookie. The origin list is explicit — never a wildcard with credentials. */
app.use(cors({
  origin: env.WEB_ORIGIN.split(',').map((s) => s.trim()),
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

/* A request id on every request and response, so one line in a log can be
 * traced to one call without guessing from timestamps. */
app.use((req, res, next) => {
  const id = (req.headers['x-request-id'] as string) ?? crypto.randomUUID();
  (req as any).id = id;
  res.setHeader('x-request-id', id);
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log[level]('request', {
      id, method: req.method, path: req.path, status: res.statusCode, ms,
      role: req.user?.role ?? null,
    });
  });
  next();
});

/* A blunt per-IP rate limit on everything, with a tighter one on sign-in.
 * In production this belongs in front of the app, but a prototype that can be
 * trivially hammered is not a prototype anyone should trust. */
const hits = new Map<string, { n: number; resetAt: number }>();
const limit = (max: number, windowMs: number) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = `${req.ip}|${req.path.startsWith('/api/auth/login') ? 'login' : 'general'}`;
    const now = Date.now();
    const cur = hits.get(key);
    if (!cur || cur.resetAt < now) { hits.set(key, { n: 1, resetAt: now + windowMs }); return next(); }
    cur.n++;
    if (cur.n > max) {
      res.setHeader('Retry-After', Math.ceil((cur.resetAt - now) / 1000));
      return res.status(429).json({ error: 'Too many requests. Slow down and try again shortly.' });
    }
    next();
  };
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
}, 60_000).unref();

/* The real brute-force control is the per-ACCOUNT lockout in auth.service
 * (5 failed attempts in 15 minutes). This per-IP limit is only a backstop
 * against a flood, so it is set well above what legitimate use needs —
 * a demo or a shared NAT can produce a lot of sign-ins from one address. */
app.use('/api/auth/login', limit(env.RATE_LIMIT_LOGIN_MAX, env.RATE_LIMIT_LOGIN_WINDOW_MS));
app.use('/api', limit(env.RATE_LIMIT_API_MAX, env.RATE_LIMIT_API_WINDOW_MS));

/* Liveness: is the process up. Kept trivial on purpose — a liveness probe
 * that touches the database restarts the app when the database hiccups. */
app.get('/api/health', (_req, res) => res.json({
  status: 'ok', service: 'humainity-api', version: VERSION, uptimeSeconds: Math.round(process.uptime()),
}));

/* Readiness: can this instance actually serve. Checks both databases and
 * reports the privacy posture, so a deployment that silently lost its
 * encryption key is visible rather than quietly insecure. */
app.get('/api/ready', (_req, res) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  try {
    hrConnection.prepare('select 1').get();
    checks.hrDatabase = { ok: true };
  } catch (e) { checks.hrDatabase = { ok: false, detail: (e as Error).message }; }
  try {
    healthConnection.prepare('select 1').get();
    checks.healthDatabase = { ok: true };
  } catch (e) { checks.healthDatabase = { ok: false, detail: (e as Error).message }; }

  const encrypted = keyConfigured();
  checks.clinicalEncryption = {
    ok: encrypted || env.NODE_ENV !== 'production',
    detail: encrypted ? 'AES-256-GCM' : 'HEALTH_ENCRYPTION_KEY not set',
  };
  checks.firewallStrictMode = {
    ok: env.FIREWALL_STRICT_MODE,
    detail: env.FIREWALL_STRICT_MODE ? undefined : 'strict mode is OFF',
  };

  const ok = Object.values(checks).every((c) => c.ok);
  res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'degraded', version: VERSION, checks });
});

app.use('/api/auth', authRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/oh', healthRoutes);
app.use('/api/workforce', workforceRoutes);
app.use('/api/portal', portalRoutes);

/* In production the API serves the built front end, so a deployment is one
 * process and one port rather than two things that must agree about CORS. */
const WEB_DIST = path.join(REPO_ROOT, 'apps', 'web', 'dist');
if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  app.use(express.static(WEB_DIST, { maxAge: '1h', index: false }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  log.info('serving the built front end', { from: WEB_DIST });
}

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const id = (req as any).id;

  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, code: err.code, requestId: id });
  }
  const anyErr = err as any;
  if (anyErr?.status && anyErr?.message) {
    return res.status(anyErr.status).json({ error: anyErr.message, requestId: id });
  }

  /* An unexpected error may carry a SQL fragment, a file path or a value from
   * the health store in its message. The full error goes to the log; the
   * client gets a reference it can quote instead. */
  log.error('unhandled error', { id, path: req.path, message: (err as Error)?.message, stack: (err as Error)?.stack });
  res.status(500).json({
    error: env.NODE_ENV === 'production'
      ? 'Something went wrong at our end. Quote the reference below if you report it.'
      : (err as Error)?.message ?? 'Internal error',
    requestId: id,
  });
});

/* Rule 6 of the ethics charter: an expired restriction must never remain
 * silently active. Re-checked hourly as well as before every solve. */
setInterval(() => {
  try {
    const n = firewall.expireStale();
    if (n) log.info('firewall expiry sweep', { expired: n });
  } catch (e) { log.error('firewall expiry sweep failed', { message: (e as Error).message }); }
}, 60 * 60 * 1000).unref();

const server = app.listen(env.API_PORT, () => {
  console.log(`\n  HumAInity API v${VERSION}  →  http://localhost:${env.API_PORT}`);
  console.log(`  environment      ${env.NODE_ENV}`);
  console.log(`  HR database      ${HR_DB_PATH}`);
  console.log(`  Health database  ${HEALTH_DB_PATH}  (restricted${keyConfigured() ? ', encrypted' : ', NOT ENCRYPTED'})`);
  console.log(`  Solver           ${env.SOLVER_URL}  (fallback ${env.SOLVER_FALLBACK_ENABLED ? 'on' : 'off'})`);
  console.log(`  Firewall strict  ${env.FIREWALL_STRICT_MODE}\n`);
});

/* Finish in-flight requests, then close both databases cleanly. SQLite in WAL
 * mode is robust to a hard kill, but a clean close checkpoints the WAL and
 * leaves the file tidy for a backup. */
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutting down', { signal });

  const force = setTimeout(() => {
    log.warn('shutdown timed out, exiting anyway');
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close(() => {
    try { hrConnection.close(); healthConnection.close(); } catch { /* already closed */ }
    log.info('stopped cleanly');
    process.exit(0);
  });
}
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => shutdown(sig));

process.on('unhandledRejection', (reason) => {
  log.error('unhandled promise rejection', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  log.error('uncaught exception', { message: err.message, stack: err.stack });
  shutdown('uncaughtException');
});
