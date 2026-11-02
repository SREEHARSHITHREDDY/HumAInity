/* ═══════════════════════════════════════════════════════════════════════════
 *  AUTHENTICATION
 *
 *  Short-lived access tokens plus rotating refresh tokens held in the
 *  database as hashes. A refresh token is single-use: presenting one issues a
 *  replacement and marks the old one replaced. Presenting an already-replaced
 *  token is treated as theft and revokes the whole family.
 *
 *  This matters more here than in an ordinary app: a stolen session belonging
 *  to the occupational health officer would open the restricted zone.
 * ═════════════════════════════════════════════════════════════════════════ */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq, and, gte, desc, isNull } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import { users, sessions, loginAttempts, employees } from '../db/hr.schema.js';
import { env } from '../lib/env.js';
import { unauthorized, badRequest, AppError } from '../lib/errors.js';
import * as audit from './audit.service.js';

const REFRESH_DAYS = 7;
const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

/* ─── Brute-force protection ─────────────────────────────────────────────── */

export function recentFailures(email: string) {
  return hrDb.select().from(loginAttempts).where(and(
    eq(loginAttempts.email, email.toLowerCase()),
    eq(loginAttempts.success, false),
    gte(loginAttempts.at, minutesAgo(WINDOW_MINUTES)),
  )).all().length;
}

export function assertNotLockedOut(email: string) {
  const n = recentFailures(email);
  if (n >= MAX_FAILURES) {
    throw new AppError(429,
      `Too many failed sign-in attempts. Try again in ${WINDOW_MINUTES} minutes, ` +
      `or ask an administrator to reset your password.`, 'LOCKED_OUT');
  }
}

function noteAttempt(email: string, success: boolean, ip?: string) {
  hrDb.insert(loginAttempts).values({ email: email.toLowerCase(), success, ip: ip ?? null }).run();
}

/* ─── Password policy ────────────────────────────────────────────────────── */

export function checkPasswordStrength(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.';
  if (!/[a-z]/.test(password)) return 'Include a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Include an uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Include a digit.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Include a symbol.';
  if (/^(password|demo|welcome|admin|qwerty)/i.test(password)) return 'Choose something less predictable.';
  return null;
}

/* ─── Sessions ───────────────────────────────────────────────────────────── */

export function issueRefreshToken(userId: number, meta: { userAgent?: string; ip?: string } = {}) {
  const raw = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 86_400_000).toISOString();
  hrDb.insert(sessions).values({
    userId, tokenHash: sha(raw), expiresAt,
    userAgent: meta.userAgent ?? null, ip: meta.ip ?? null,
  }).run();
  return { raw, expiresAt };
}

export function rotateRefreshToken(raw: string, meta: { userAgent?: string; ip?: string } = {}) {
  const row = hrDb.select().from(sessions).where(eq(sessions.tokenHash, sha(raw))).all()[0];
  if (!row) throw unauthorized('Session not recognised. Sign in again.');

  // Reuse of a token that has already been rotated means it was captured.
  // Revoke every session for this user rather than guessing which is genuine.
  if (row.replacedById) {
    revokeAllForUser(row.userId);
    audit.record({
      actorUserId: row.userId, action: 'LOGIN_FAILED', resourceType: 'Session',
      resourceId: String(row.id), outcome: 'DENIED',
      detail: 'A rotated refresh token was presented again. All sessions for this user were revoked.',
    });
    throw unauthorized('This session has been ended for security reasons. Sign in again.');
  }
  if (row.revokedAt) throw unauthorized('Session has been signed out. Sign in again.');
  if (row.expiresAt < new Date().toISOString()) throw unauthorized('Session expired. Sign in again.');

  const next = issueRefreshToken(row.userId, meta);
  const created = hrDb.select().from(sessions).where(eq(sessions.tokenHash, sha(next.raw))).all()[0];
  hrDb.update(sessions).set({ replacedById: created.id, revokedAt: new Date().toISOString() })
    .where(eq(sessions.id, row.id)).run();

  return { userId: row.userId, ...next };
}

export function revokeRefreshToken(raw: string) {
  hrDb.update(sessions).set({ revokedAt: new Date().toISOString() })
    .where(and(eq(sessions.tokenHash, sha(raw)), isNull(sessions.revokedAt))).run();
}

export function revokeAllForUser(userId: number) {
  hrDb.update(sessions).set({ revokedAt: new Date().toISOString() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt))).run();
}

export function listSessions(userId: number) {
  return hrDb.select({
    id: sessions.id, issuedAt: sessions.issuedAt, expiresAt: sessions.expiresAt,
    revokedAt: sessions.revokedAt, userAgent: sessions.userAgent, ip: sessions.ip,
  }).from(sessions).where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.id)).limit(20).all();
}

/* ─── Sign in ────────────────────────────────────────────────────────────── */

export async function authenticate(email: string, password: string, meta: { userAgent?: string; ip?: string } = {}) {
  const lower = String(email).toLowerCase();
  assertNotLockedOut(lower);

  const user = hrDb.select().from(users).where(eq(users.email, lower)).all()[0];
  const ok = !!user && user.isActive && await bcrypt.compare(password, user.passwordHash);

  if (!ok) {
    noteAttempt(lower, false, meta.ip);
    const left = Math.max(0, MAX_FAILURES - recentFailures(lower));
    audit.record({
      actorEmail: lower, action: 'LOGIN_FAILED', resourceType: 'User',
      outcome: 'DENIED', ip: meta.ip ?? null,
      detail: user ? 'Incorrect password' : 'No such account',
    });
    throw unauthorized(left > 0
      ? `Email or password is incorrect. ${left} attempt${left === 1 ? '' : 's'} left before a temporary lock.`
      : 'Email or password is incorrect.');
  }

  noteAttempt(lower, true, meta.ip);
  hrDb.update(users).set({ lastLoginAt: new Date().toISOString() }).where(eq(users.id, user.id)).run();

  const emp = user.employeeId
    ? hrDb.select().from(employees).where(eq(employees.id, user.employeeId)).all()[0]
    : null;

  audit.record({
    actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
    action: 'LOGIN', resourceType: 'User', resourceId: String(user.id), ip: meta.ip ?? null,
  });

  return { user, employee: emp, refresh: issueRefreshToken(user.id, meta) };
}

export async function changePassword(
  actor: { userId: number; email: string; role: string },
  currentPassword: string, newPassword: string,
) {
  const user = hrDb.select().from(users).where(eq(users.id, actor.userId)).all()[0];
  if (!user) throw unauthorized();
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    audit.record({ ...actor, actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
      action: 'LOGIN_FAILED', resourceType: 'User', outcome: 'DENIED',
      detail: 'Password change refused: current password incorrect' });
    throw badRequest('Your current password is not correct.');
  }
  const weak = checkPasswordStrength(newPassword);
  if (weak) throw badRequest(weak);
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw badRequest('Choose a password you have not used here before.');
  }

  hrDb.update(users).set({ passwordHash: bcrypt.hashSync(newPassword, env.BCRYPT_ROUNDS) })
    .where(eq(users.id, user.id)).run();

  // Changing a password ends every other session. That is the point of it.
  revokeAllForUser(user.id);

  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'EMPLOYEE_UPDATED', resourceType: 'User', resourceId: String(user.id),
    detail: 'Password changed; all sessions revoked',
  });
}
