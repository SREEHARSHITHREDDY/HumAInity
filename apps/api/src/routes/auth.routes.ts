import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import { employees, users } from '../db/hr.schema.js';
import { sign, authenticate as requireAuth, actor } from '../middleware/auth.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { ROLE_LABEL, type Role } from '../lib/roles.js';
import * as auth from '../services/auth.service.js';

export const authRoutes = Router();

const REFRESH_COOKIE = 'humainity_refresh';
const cookieOpts = (maxAgeMs: number) => ({
  httpOnly: true, sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/api/auth', maxAge: maxAgeMs,
});

const profile = (user: any, emp: any) => ({
  userId: user.id, email: user.email, role: user.role as Role, employeeId: user.employeeId,
  roleLabel: ROLE_LABEL[user.role as Role],
  name: emp ? `${emp.firstName} ${emp.lastName}` : ROLE_LABEL[user.role as Role],
  empCode: emp?.empCode ?? null, designation: emp?.designation ?? null,
});

authRoutes.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) throw badRequest('Email and password are required');

    const { user, employee, refresh } = await auth.authenticate(email, password, {
      userAgent: req.headers['user-agent'], ip: req.ip,
    });
    const me = profile(user, employee);
    res.cookie(REFRESH_COOKIE, refresh.raw, cookieOpts(7 * 86_400_000));
    res.json({ token: sign(me), refreshToken: refresh.raw, user: me });
  } catch (e) { next(e); }
});

/** Exchange a refresh token for a new access token. The refresh token itself
 *  is rotated on every use, so a captured one is good for one call at most. */
authRoutes.post('/refresh', (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
    if (!raw) throw unauthorized('No session to refresh');

    const rotated = auth.rotateRefreshToken(raw, {
      userAgent: req.headers['user-agent'], ip: req.ip,
    });

    const user = hrDb.select().from(users).where(eq(users.id, rotated.userId)).all()[0];
    if (!user || !user.isActive) throw unauthorized('This account is no longer active');
    const emp = user.employeeId
      ? hrDb.select().from(employees).where(eq(employees.id, user.employeeId)).all()[0]
      : null;

    const me = profile(user, emp);
    res.cookie(REFRESH_COOKIE, rotated.raw, cookieOpts(7 * 86_400_000));
    res.json({ token: sign(me), refreshToken: rotated.raw, user: me });
  } catch (e) { next(e); }
});

authRoutes.post('/logout', (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
  if (raw) auth.revokeRefreshToken(raw);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.json({ ok: true });
});

authRoutes.get('/me', requireAuth, (req, res) => {
  const u = req.user!;
  const emp = u.employeeId
    ? hrDb.select().from(employees).where(eq(employees.id, u.employeeId)).all()[0]
    : null;
  res.json({
    ...u, roleLabel: ROLE_LABEL[u.role],
    name: emp ? `${emp.firstName} ${emp.lastName}` : ROLE_LABEL[u.role],
    empCode: emp?.empCode ?? null, designation: emp?.designation ?? null,
  });
});

authRoutes.get('/sessions', requireAuth, (req, res) =>
  res.json(auth.listSessions(req.user!.userId)));

authRoutes.post('/sessions/revoke-all', requireAuth, (req, res) => {
  auth.revokeAllForUser(req.user!.userId);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.json({ ok: true, message: 'All sessions signed out. You will need to sign in again.' });
});

authRoutes.post('/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) throw badRequest('Both the current and new password are required');
    await auth.changePassword(actor(req), currentPassword, newPassword);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.json({ ok: true, message: 'Password changed. Every other session has been signed out.' });
  } catch (e) { next(e); }
});

/** Lets the sign-in form give live feedback without a round trip per keypress. */
authRoutes.post('/password/check', (req, res) => {
  const problem = auth.checkPasswordStrength(String(req.body?.password ?? ''));
  res.json({ ok: !problem, problem });
});
