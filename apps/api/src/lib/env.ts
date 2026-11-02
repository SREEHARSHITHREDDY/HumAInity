import './load-env.js';

const int = (v: string | undefined, d: number) => (v ? parseInt(v, 10) : d);
const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : v === 'true');

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  API_PORT: int(process.env.API_PORT, 4000),
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev_only_change_me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '8h',
  BCRYPT_ROUNDS: int(process.env.BCRYPT_ROUNDS, 10),
  SOLVER_URL: process.env.SOLVER_URL ?? 'http://localhost:8000',
  SOLVER_TIMEOUT_MS: int(process.env.SOLVER_TIMEOUT_MS, 30000),
  SOLVER_FALLBACK_ENABLED: bool(process.env.SOLVER_FALLBACK_ENABLED, true),
  FIREWALL_STRICT_MODE: bool(process.env.FIREWALL_STRICT_MODE, true),
  FAIRNESS_MIN_GROUP_SIZE: int(process.env.FAIRNESS_MIN_GROUP_SIZE, 5),
  FATIGUE_CEILING: int(process.env.FATIGUE_CEILING, 80),
  FATIGUE_WARN_THRESHOLD: int(process.env.FATIGUE_WARN_THRESHOLD, 65),

  /* Rate limits. Tunable because the right value depends on deployment: one
   * hospital behind a single NAT address looks very different from a load
   * balancer passing through client addresses. The per-ACCOUNT lockout in
   * auth.service.ts is the real brute-force control; these are a flood
   * backstop. */
  RATE_LIMIT_LOGIN_MAX: int(process.env.RATE_LIMIT_LOGIN_MAX, 60),
  RATE_LIMIT_LOGIN_WINDOW_MS: int(process.env.RATE_LIMIT_LOGIN_WINDOW_MS, 15 * 60_000),
  RATE_LIMIT_API_MAX: int(process.env.RATE_LIMIT_API_MAX, 600),
  RATE_LIMIT_API_WINDOW_MS: int(process.env.RATE_LIMIT_API_WINDOW_MS, 60_000),
};

if (env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('dev_only')) {
  throw new Error('JWT_SECRET must be set to a real secret in production');
}
