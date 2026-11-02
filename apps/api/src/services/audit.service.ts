/* Append-only, hash-chained audit log.
 * There is no update or delete function exported from this module, and none
 * anywhere else in the codebase. Each row carries the hash of the previous
 * row, so removing or editing a row breaks the chain and is detectable. */
import crypto from 'node:crypto';
import { desc, eq, and, gte, sql } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import { auditLog } from '../db/hr.schema.js';

export type AuditAction =
  | 'LOGIN' | 'LOGIN_FAILED' | 'LOGOUT'
  | 'HEALTH_ASSESSMENT_READ' | 'HEALTH_ASSESSMENT_CREATED'
  | 'HEALTH_RESTRICTION_CREATED' | 'HEALTH_RESTRICTION_REVOKED'
  | 'HEALTH_ACCESS_DENIED'
  | 'FIREWALL_PROJECTED' | 'FIREWALL_REFUSED' | 'FIREWALL_EXPIRED'
  | 'ROSTER_GENERATED' | 'ROSTER_APPROVED' | 'ROSTER_PUBLISHED'
  | 'LEAVE_DECIDED' | 'EMPLOYEE_UPDATED' | 'PAY_CALCULATED'
  | 'WELLBEING_SUBMITTED' | 'FAIRNESS_SNAPSHOT' | 'OVERTIME_OPTIN';

export interface AuditEntry {
  actorUserId?: number | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  subjectEmployeeId?: number | null;
  outcome?: 'SUCCESS' | 'DENIED' | 'ERROR';
  detail?: string | null;
  ip?: string | null;
}

const rowHash = (payload: string, prev: string | null) =>
  crypto.createHash('sha256').update((prev ?? '') + payload).digest('hex');

export function record(entry: AuditEntry) {
  const last = hrDb.select({ hash: auditLog.hash }).from(auditLog)
    .orderBy(desc(auditLog.id)).limit(1).all()[0];
  const at = new Date().toISOString();
  const payload = JSON.stringify({
    at, action: entry.action, resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null, actorEmail: entry.actorEmail ?? null,
    subjectEmployeeId: entry.subjectEmployeeId ?? null, outcome: entry.outcome ?? 'SUCCESS',
    detail: entry.detail ?? null,
  });
  const prevHash = last?.hash ?? null;
  hrDb.insert(auditLog).values({
    at,
    actorUserId: entry.actorUserId ?? null,
    actorEmail: entry.actorEmail ?? null,
    actorRole: entry.actorRole ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    subjectEmployeeId: entry.subjectEmployeeId ?? null,
    outcome: entry.outcome ?? 'SUCCESS',
    detail: entry.detail ?? null,
    ip: entry.ip ?? null,
    prevHash,
    hash: rowHash(payload, prevHash),
  }).run();
}

/** Recompute the whole chain and report the first broken link, if any. */
export function verifyChain() {
  const rows = hrDb.select().from(auditLog).orderBy(auditLog.id).all();
  let prev: string | null = null;
  for (const r of rows) {
    const payload = JSON.stringify({
      at: r.at, action: r.action, resourceType: r.resourceType,
      resourceId: r.resourceId, actorEmail: r.actorEmail,
      subjectEmployeeId: r.subjectEmployeeId, outcome: r.outcome, detail: r.detail,
    });
    const expected = rowHash(payload, prev);
    if (r.hash !== expected || r.prevHash !== prev) {
      return { valid: false, brokenAtId: r.id, checked: rows.length };
    }
    prev = r.hash;
  }
  return { valid: true, brokenAtId: null, checked: rows.length };
}

export function list(opts: { limit?: number; action?: string; subjectEmployeeId?: number; since?: string } = {}) {
  const where = [] as any[];
  if (opts.action) where.push(eq(auditLog.action, opts.action));
  if (opts.subjectEmployeeId) where.push(eq(auditLog.subjectEmployeeId, opts.subjectEmployeeId));
  if (opts.since) where.push(gte(auditLog.at, opts.since));
  let q = hrDb.select().from(auditLog).$dynamic();
  if (where.length) q = q.where(and(...where));
  return q.orderBy(desc(auditLog.id)).limit(opts.limit ?? 200).all();
}

export function countByAction() {
  return hrDb.select({ action: auditLog.action, n: sql<number>`count(*)` })
    .from(auditLog).groupBy(auditLog.action).all();
}
