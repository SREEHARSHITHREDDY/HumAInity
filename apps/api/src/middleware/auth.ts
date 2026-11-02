import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../lib/env.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import type { Role } from '../lib/roles.js';

export interface AuthUser {
  userId: number; email: string; role: Role; employeeId: number | null;
}
/* Express augments its Request type through a global namespace; there is no
 * module-syntax equivalent, so the rule is disabled for these three lines. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser } }
}

export const sign = (u: AuthUser) =>
  jwt.sign(u, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  try {
    req.user = jwt.verify(header.slice(7), env.JWT_SECRET) as AuthUser;
    next();
  } catch {
    next(unauthorized('Session expired or invalid'));
  }
}

export const requireRole = (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden(`This area is restricted to: ${roles.join(', ')}`));
    }
    next();
  };

/** Allow if the caller holds one of `roles`, OR is acting on their own record. */
export const requireRoleOrSelf = (paramName: string, ...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    const target = Number(req.params[paramName]);
    if (roles.includes(req.user.role)) return next();
    if (req.user.employeeId === target) return next();
    next(forbidden('You may only view your own record.'));
  };

export const actor = (req: Request) => ({
  userId: req.user!.userId, email: req.user!.email,
  role: req.user!.role, employeeId: req.user!.employeeId,
});
