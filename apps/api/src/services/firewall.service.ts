/* ═══════════════════════════════════════════════════════════════════════════
 *  THE CONSTRAINT FIREWALL
 *
 *  The single, narrow channel between the restricted health zone and the rest
 *  of the platform. Everything that crosses is checked five times:
 *
 *    1. AUTHORISATION   the source restriction is signed off and consented
 *    2. VALIDITY        it is in date, not revoked, not expired
 *    3. VOCABULARY      its type is in the closed vocabulary
 *    4. SHAPE           its params validate against that type's strict schema
 *    5. LEAK SCAN       the serialised payload contains no clinical language
 *
 *  Anything that fails is refused, audited, and never reaches the HR store.
 *  What crosses is a type, a few numbers, two dates and an opaque handle.
 * ═════════════════════════════════════════════════════════════════════════ */
import crypto from 'node:crypto';
import { eq, and, inArray, lte, or, isNull, gte } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import { schedulingConstraints, employees } from '../db/hr.schema.js';
import {
  CONSTRAINT_SCHEMAS, CONSTRAINT_TYPES, containsClinicalLanguage,
  describeConstraint, type ConstraintType,
} from '../lib/constraint-vocabulary.js';
import { env } from '../lib/env.js';
import * as health from './health.service.js';
import * as audit from './audit.service.js';

export interface ProjectionResult {
  projected: number;
  refused: Array<{ opaqueRef: string; reason: string }>;
  expired: number;
}

const digest = (r: {
  restrictionType: string; params: string; effectiveFrom: string;
  effectiveTo: string | null; authorizedBy: string | null; source?: string;
}) =>
  crypto.createHash('sha256')
    .update([r.restrictionType, r.params, r.effectiveFrom, r.effectiveTo ?? '',
             r.authorizedBy ?? '', r.source ?? ''].join('|'))
    .digest('hex');

/* ── The five checks ─────────────────────────────────────────────────────── */

function inspect(r: ReturnType<typeof health.listProjectableRestrictions>[number], today: string):
  { ok: true; params: Record<string, unknown> } | { ok: false; reason: string } {

  /* 1. authorisation — the bar differs by where the restriction came from.
   *
   * A clinician-verified restriction must name the officer who signed it off.
   * A self-declared one has no officer by definition: the employee is the
   * author, which is why it is short-dated and flagged for review rather than
   * trusted indefinitely. Requiring an officer here would mean an employee
   * could not protect themselves until a hospital had staffed an OH team. */
  if (r.source === 'SELF_DECLARED') {
    if (!r.effectiveTo) {
      return { ok: false, reason: 'A self-declared limit must carry a review date' };
    }
  } else if (!r.authorizedBy) {
    return { ok: false, reason: 'No authorising officer recorded' };
  }
  if (!r.consentId) return { ok: false, reason: 'No recorded legal basis for sharing' };
  if (!health.hasActiveConsent(r.employeeRef)) {
    return { ok: false, reason: 'Consent for sharing has been withdrawn' };
  }

  // 2. validity
  if (r.status !== 'ACTIVE') return { ok: false, reason: `Source status is ${r.status}` };
  if (r.effectiveFrom > today) return { ok: false, reason: 'Not yet effective' };
  if (r.effectiveTo && r.effectiveTo < today) return { ok: false, reason: 'Past its end date' };

  // 3. vocabulary
  if (!CONSTRAINT_TYPES.includes(r.restrictionType as ConstraintType)) {
    return { ok: false, reason: `Type "${r.restrictionType}" is not in the permitted vocabulary` };
  }

  // 4. shape
  let raw: unknown;
  try { raw = JSON.parse(r.params || '{}'); }
  catch { return { ok: false, reason: 'Parameters are not valid JSON' }; }
  const parsed = CONSTRAINT_SCHEMAS[r.restrictionType as ConstraintType].safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: `Parameters failed schema: ${parsed.error.issues.map(i => i.path.join('.') + ' ' + i.message).join('; ')}` };
  }

  // 5. leak scan — defence in depth
  const token = containsClinicalLanguage(parsed.data);
  if (token && env.FIREWALL_STRICT_MODE) {
    return { ok: false, reason: `Payload contains clinical language ("${token}") and was blocked` };
  }

  return { ok: true, params: parsed.data as Record<string, unknown> };
}

/* ── Projection ──────────────────────────────────────────────────────────── */

/** Re-derive the whole HR-side constraint set from the authorised source.
 *  Idempotent: safe to run on a schedule or before every solve. */
export function syncAll(actor?: { userId?: number; email?: string; role?: string }): ProjectionResult {
  const today = new Date().toISOString().slice(0, 10);
  const sources = health.listProjectableRestrictions();
  const refused: ProjectionResult['refused'] = [];
  const projectedIds: number[] = [];
  let projected = 0;

  const seenRefs = new Set<string>();

  for (const r of sources) {
    const verdict = inspect(r, today);
    if (!verdict.ok) {
      refused.push({ opaqueRef: r.opaqueRef, reason: verdict.reason });
      // Anything already in HR that no longer passes is retired immediately.
      hrDb.update(schedulingConstraints)
        .set({ status: r.status === 'REVOKED' ? 'REVOKED' : 'EXPIRED' })
        .where(and(eq(schedulingConstraints.opaqueRef, r.opaqueRef), eq(schedulingConstraints.status, 'ACTIVE')))
        .run();
      audit.record({
        actorUserId: actor?.userId ?? null, actorEmail: actor?.email ?? 'system',
        actorRole: actor?.role ?? 'SYSTEM', action: 'FIREWALL_REFUSED',
        resourceType: 'SchedulingConstraint', resourceId: r.opaqueRef,
        subjectEmployeeId: r.employeeRef, outcome: 'DENIED', detail: verdict.reason,
      });
      continue;
    }

    seenRefs.add(r.opaqueRef);
    const sourceDigest = digest(r as any);
    const existing = hrDb.select().from(schedulingConstraints)
      .where(eq(schedulingConstraints.opaqueRef, r.opaqueRef)).all()[0];

    const values = {
      opaqueRef: r.opaqueRef,
      employeeId: r.employeeRef,
      constraintType: r.restrictionType,
      params: JSON.stringify(verdict.params),
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      status: 'ACTIVE' as const,
      source: r.source ?? 'CLINICIAN_VERIFIED',
      sourceDigest,
    };

    if (!existing) {
      hrDb.insert(schedulingConstraints).values(values).run();
      projected++; projectedIds.push(r.id);
      audit.record({
        actorUserId: actor?.userId ?? null, actorEmail: actor?.email ?? 'system',
        actorRole: actor?.role ?? 'SYSTEM', action: 'FIREWALL_PROJECTED',
        resourceType: 'SchedulingConstraint', resourceId: r.opaqueRef,
        subjectEmployeeId: r.employeeRef,
        detail: `${r.restrictionType} projected to the scheduling store (diagnosis-free)`,
      });
    } else if (existing.sourceDigest !== sourceDigest || existing.status !== 'ACTIVE') {
      hrDb.update(schedulingConstraints).set(values)
        .where(eq(schedulingConstraints.id, existing.id)).run();
      projected++; projectedIds.push(r.id);
      audit.record({
        actorUserId: actor?.userId ?? null, actorEmail: actor?.email ?? 'system',
        actorRole: actor?.role ?? 'SYSTEM', action: 'FIREWALL_PROJECTED',
        resourceType: 'SchedulingConstraint', resourceId: r.opaqueRef,
        subjectEmployeeId: r.employeeRef, detail: 'Re-projected after source change',
      });
    }
  }

  // Retire HR-side rows whose source has vanished entirely.
  const orphans = hrDb.select().from(schedulingConstraints)
    .where(eq(schedulingConstraints.status, 'ACTIVE')).all()
    .filter((c) => !seenRefs.has(c.opaqueRef));
  for (const o of orphans) {
    hrDb.update(schedulingConstraints).set({ status: 'EXPIRED' })
      .where(eq(schedulingConstraints.id, o.id)).run();
  }

  health.markProjected(projectedIds);
  return { projected, refused, expired: orphans.length };
}

/** Rule 6 of the ethics charter: an expired restriction must never stay
 *  silently active. Run on a timer and before every solve. */
export function expireStale(): number {
  const today = new Date().toISOString().slice(0, 10);
  const stale = hrDb.select().from(schedulingConstraints).where(and(
    eq(schedulingConstraints.status, 'ACTIVE'),
    lte(schedulingConstraints.effectiveTo, today),
  )).all().filter((c) => c.effectiveTo && c.effectiveTo < today);

  for (const c of stale) {
    hrDb.update(schedulingConstraints).set({ status: 'EXPIRED' })
      .where(eq(schedulingConstraints.id, c.id)).run();
    audit.record({
      actorEmail: 'system', actorRole: 'SYSTEM', action: 'FIREWALL_EXPIRED',
      resourceType: 'SchedulingConstraint', resourceId: c.opaqueRef,
      subjectEmployeeId: c.employeeId,
      detail: `Expired automatically on ${today}; no longer applied to schedules`,
    });
  }
  return stale.length;
}

/* ── Consumers ───────────────────────────────────────────────────────────── */

/** What the scheduling engine receives. Note the absence of anything that
 *  could identify a cause: a type, numbers, and a window. */
export function constraintsForScheduler(employeeIds: number[], from: string, to: string) {
  if (!employeeIds.length) return [];
  return hrDb.select({
    employeeId: schedulingConstraints.employeeId,
    constraintType: schedulingConstraints.constraintType,
    params: schedulingConstraints.params,
    effectiveFrom: schedulingConstraints.effectiveFrom,
    effectiveTo: schedulingConstraints.effectiveTo,
  }).from(schedulingConstraints).where(and(
    eq(schedulingConstraints.status, 'ACTIVE'),
    inArray(schedulingConstraints.employeeId, employeeIds),
    lte(schedulingConstraints.effectiveFrom, to),
    or(isNull(schedulingConstraints.effectiveTo), gte(schedulingConstraints.effectiveTo, from)),
  )).all().map((c) => ({
    employeeId: c.employeeId,
    type: c.constraintType,
    params: JSON.parse(c.params) as Record<string, number | number[]>,
    effectiveFrom: c.effectiveFrom,
    effectiveTo: c.effectiveTo,
  }));
}

/** What a manager or planner sees on a person's profile. A neutral label and
 *  a date window — never a reason, and never a link to an assessment. */
export function constraintsForManager(employeeId: number) {
  return hrDb.select().from(schedulingConstraints).where(and(
    eq(schedulingConstraints.employeeId, employeeId),
    eq(schedulingConstraints.status, 'ACTIVE'),
  )).all().map((c) => ({
    opaqueRef: c.opaqueRef,
    type: c.constraintType,
    description: describeConstraint(c.constraintType as ConstraintType, JSON.parse(c.params)),
    effectiveFrom: c.effectiveFrom,
    effectiveTo: c.effectiveTo,
    /* `source` is deliberately absent. Whether a limit was self-declared or
     * clinically assessed is not a manager's business, and showing it would
     * invite pressure to "get it verified". */
    note: 'A scheduling restriction applies. The reason is held by occupational health and is not available here.',
  }));
}

/** The employee's OWN view, which does include provenance — they are entitled
 *  to know what the system records about them and who, if anyone, confirmed it. */
export function constraintsForSelfDetailed(employeeId: number) {
  return hrDb.select().from(schedulingConstraints).where(and(
    eq(schedulingConstraints.employeeId, employeeId),
    eq(schedulingConstraints.status, 'ACTIVE'),
  )).all().map((c) => ({
    opaqueRef: c.opaqueRef,
    type: c.constraintType,
    description: describeConstraint(c.constraintType as ConstraintType, JSON.parse(c.params)),
    effectiveFrom: c.effectiveFrom,
    effectiveTo: c.effectiveTo,
    source: c.source,
    provisional: c.source === 'SELF_DECLARED',
    note: c.source === 'SELF_DECLARED'
      ? 'You declared this yourself. Your manager sees only the limit and the dates, never that you set it. It expires on the review date unless occupational health confirms it or you renew it.'
      : 'Set by occupational health. Your manager sees only the limit and the dates.',
  }));
}

/** An employee's own view — identical content. Transparency about what the
 *  system holds on you is an ethics requirement, not a nicety. */
export const constraintsForSelf = constraintsForManager;

export function allActive() {
  return hrDb.select({
    id: schedulingConstraints.id,
    opaqueRef: schedulingConstraints.opaqueRef,
    employeeId: schedulingConstraints.employeeId,
    employeeName: employees.firstName,
    constraintType: schedulingConstraints.constraintType,
    params: schedulingConstraints.params,
    effectiveFrom: schedulingConstraints.effectiveFrom,
    effectiveTo: schedulingConstraints.effectiveTo,
    status: schedulingConstraints.status,
  }).from(schedulingConstraints)
    .leftJoin(employees, eq(employees.id, schedulingConstraints.employeeId))
    .all();
}

/** Self-test used by the dashboard and by the test suite: assert that nothing
 *  in the HR constraint store carries clinical language. */
export function verifyNoLeakage() {
  const rows = hrDb.select().from(schedulingConstraints).all();
  const findings: Array<{ opaqueRef: string; token: string }> = [];
  for (const r of rows) {
    const token = containsClinicalLanguage({ type: r.constraintType, params: JSON.parse(r.params || '{}') });
    if (token) findings.push({ opaqueRef: r.opaqueRef, token });
  }
  return { checked: rows.length, clean: findings.length === 0, findings };
}
