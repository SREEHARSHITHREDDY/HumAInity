/* ═══════════════════════════════════════════════════════════════════════════
 *  PERFORMANCE MANAGEMENT
 *
 *  Ethics rule 11: performance metrics must never penalise an approved
 *  accommodation. Three structural defences, not one policy sentence:
 *
 *   1. CLOSED COMPETENCIES. Ratings are keyed by a fixed vocabulary that
 *      contains no measure of hours, availability or attendance. A key
 *      outside it is rejected by the API.
 *
 *   2. RATE, NOT TOTAL. Every quantitative goal is scored per hour actually
 *      worked. Someone rostered 30 hours is measured on the same basis as
 *      someone rostered 40, so fewer hours cannot produce a lower score.
 *
 *   3. FREE-TEXT GUARD. Narrative fields are scanned for language that marks
 *      someone down for their working pattern, and matches are flagged on the
 *      review where the employee and compliance can both see them.
 *
 *  This module NEVER imports the firewall or reads schedulingConstraints. It
 *  cannot know who holds a restriction, which is the strongest guarantee
 *  available that it cannot act on one.
 * ═════════════════════════════════════════════════════════════════════════ */
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import {
  goals, performanceReviews, reviewCycles, employees, shiftAssignments,
} from '../db/hr.schema.js';
import {
  COMPETENCY_CODES, COMPETENCIES, guardFreeText, type GuardFlag,
} from '../lib/competencies.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import * as audit from './audit.service.js';

export interface Actor { userId: number; email: string; role: string; employeeId?: number | null }

/* ─── Cycles ─────────────────────────────────────────────────────────────── */

export const listCycles = () =>
  hrDb.select().from(reviewCycles).orderBy(desc(reviewCycles.id)).all();

export function createCycle(actor: Actor, input: { name: string; periodStart: string; periodEnd: string }) {
  const row = hrDb.insert(reviewCycles).values(input).returning().all()[0];
  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'EMPLOYEE_UPDATED', resourceType: 'ReviewCycle', resourceId: String(row.id),
    detail: `Review cycle "${input.name}" opened`,
  });
  return row;
}

/* ─── Goals ──────────────────────────────────────────────────────────────── */

export const listGoals = (employeeId: number) =>
  hrDb.select().from(goals).where(eq(goals.employeeId, employeeId))
    .orderBy(desc(goals.id)).all();

export function createGoal(actor: Actor, input: {
  employeeId: number; title: string; description?: string;
  targetValue?: number; unit?: string; dueDate?: string; cycleId?: number;
}) {
  if (!input.title?.trim()) throw badRequest('A goal needs a title');
  return hrDb.insert(goals).values({
    employeeId: input.employeeId, cycleId: input.cycleId ?? null,
    title: input.title, description: input.description ?? null,
    targetValue: input.targetValue ?? null, unit: input.unit ?? null,
    dueDate: input.dueDate ?? null,
  }).returning().all()[0];
}

export function updateGoal(actor: Actor, id: number, patch: {
  actualValue?: number; status?: string; description?: string;
}) {
  const row = hrDb.select().from(goals).where(eq(goals.id, id)).all()[0];
  if (!row) throw notFound('Goal not found');
  hrDb.update(goals).set({
    actualValue: patch.actualValue ?? row.actualValue,
    status: patch.status ?? row.status,
    description: patch.description ?? row.description,
  }).where(eq(goals.id, id)).run();
  return hrDb.select().from(goals).where(eq(goals.id, id)).all()[0];
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Defence 2: normalise by hours actually worked.
 *
 *  A goal of "complete 40 care plans" is scored as a RATE — care plans per
 *  hour worked — against the same rate target derived for a full-time
 *  colleague. Someone who worked 120 hours in the period is not compared
 *  against someone who worked 160.
 * ═════════════════════════════════════════════════════════════════════════ */

export function hoursWorkedInPeriod(employeeId: number, from: string, to: string) {
  return hrDb.select({ hours: shiftAssignments.hours }).from(shiftAssignments)
    .where(and(
      eq(shiftAssignments.employeeId, employeeId),
      gte(shiftAssignments.date, from),
      lte(shiftAssignments.date, to),
    )).all().reduce((s, r) => s + r.hours, 0);
}

export interface GoalScore {
  goalId: number; title: string; unit: string | null;
  target: number | null; actual: number | null;
  hoursWorked: number;
  /** actual ÷ hours worked — the figure that is actually compared. */
  ratePerHour: number | null;
  targetRatePerHour: number | null;
  attainmentPct: number | null;
  basis: string;
}

export function scoreGoals(employeeId: number, cycleId: number): GoalScore[] {
  const cycle = hrDb.select().from(reviewCycles).where(eq(reviewCycles.id, cycleId)).all()[0];
  if (!cycle) throw notFound('Review cycle not found');

  const emp = hrDb.select().from(employees).where(eq(employees.id, employeeId)).all()[0];
  if (!emp) throw notFound('Employee not found');

  const worked = hoursWorkedInPeriod(employeeId, cycle.periodStart, cycle.periodEnd);

  /* The reference is a FULL-TIME equivalent for the same period, so the
   * target rate is identical for everyone regardless of contract or cap. */
  const weeks = Math.max(1,
    (new Date(cycle.periodEnd).getTime() - new Date(cycle.periodStart).getTime()) / (7 * 86_400_000) + 1 / 7);
  const referenceHours = 40 * weeks;

  return hrDb.select().from(goals).where(and(
    eq(goals.employeeId, employeeId), eq(goals.cycleId, cycleId),
  )).all().map((g) => {
    if (g.targetValue == null || g.actualValue == null) {
      return {
        goalId: g.id, title: g.title, unit: g.unit, target: g.targetValue, actual: g.actualValue,
        hoursWorked: round1(worked), ratePerHour: null, targetRatePerHour: null,
        attainmentPct: null,
        basis: 'Not a measured goal — assessed in the narrative instead.',
      };
    }
    /* No hours worked means there is nothing to compute a rate from. A new
     * starter, someone who was on leave for the whole cycle, or a period with
     * no published roster must read as "not assessable" — reporting 0% would
     * be the naive total-based penalty arriving by a different route. */
    if (worked <= 0) {
      return {
        goalId: g.id, title: g.title, unit: g.unit,
        target: g.targetValue, actual: g.actualValue,
        hoursWorked: 0, ratePerHour: null,
        targetRatePerHour: round3(g.targetValue / referenceHours),
        attainmentPct: null,
        basis:
          'No hours were worked in this period, so there is no rate to assess. ' +
          'This is not a score of zero — it is not assessable, and should be ' +
          'discussed rather than counted.',
      };
    }

    const rate = g.actualValue / worked;
    const targetRate = g.targetValue / referenceHours;
    return {
      goalId: g.id, title: g.title, unit: g.unit,
      target: g.targetValue, actual: g.actualValue,
      hoursWorked: round1(worked),
      ratePerHour: round3(rate),
      targetRatePerHour: round3(targetRate),
      attainmentPct: targetRate > 0 ? Math.round((rate / targetRate) * 100) : null,
      basis:
        `Scored as ${g.unit ?? 'units'} per hour worked (${round1(worked)}h in this period), ` +
        `against the same per-hour target applied to every employee. ` +
        `Working fewer hours cannot lower this figure.`,
    };
  });
}

/* ─── Reviews ────────────────────────────────────────────────────────────── */

export const competencyCatalogue = () => COMPETENCIES;

export function listReviews(cycleId?: number) {
  const q = cycleId
    ? hrDb.select().from(performanceReviews).where(eq(performanceReviews.cycleId, cycleId))
    : hrDb.select().from(performanceReviews);
  return q.orderBy(desc(performanceReviews.id)).all().map(hydrate);
}

export function reviewFor(employeeId: number, cycleId: number) {
  const r = hrDb.select().from(performanceReviews).where(and(
    eq(performanceReviews.employeeId, employeeId),
    eq(performanceReviews.cycleId, cycleId),
  )).all()[0];
  return r ? hydrate(r) : null;
}

const hydrate = (r: any) => ({
  ...r,
  ratings: JSON.parse(r.ratings || '{}') as Record<string, number>,
  guardFlags: JSON.parse(r.guardFlags || '[]') as GuardFlag[],
});

export function saveReview(actor: Actor, input: {
  cycleId: number; employeeId: number;
  ratings: Record<string, number>;
  strengths?: string; development?: string; submit?: boolean;
}) {
  /* Defence 1: a rating key outside the closed vocabulary is refused.
   * This is where "availability: 2" would be rejected. */
  for (const key of Object.keys(input.ratings ?? {})) {
    if (!COMPETENCY_CODES.includes(key as any)) {
      throw badRequest(
        `"${key}" is not a competency that can be rated. Performance is assessed on ` +
        `quality of work, not on working pattern or availability. ` +
        `Permitted competencies: ${COMPETENCY_CODES.join(', ')}.`,
      );
    }
    const v = input.ratings[key];
    if (typeof v !== 'number' || v < 1 || v > 5) {
      throw badRequest(`Rating for ${key} must be a number from 1 to 5.`);
    }
  }

  /* Defence 3: scan the narrative. */
  const flags = [
    ...guardFreeText('strengths', input.strengths),
    ...guardFreeText('development', input.development),
  ];

  const values = Object.values(input.ratings ?? {});
  const overall = values.length
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    : null;

  const existing = hrDb.select().from(performanceReviews).where(and(
    eq(performanceReviews.cycleId, input.cycleId),
    eq(performanceReviews.employeeId, input.employeeId),
  )).all()[0];

  const row = {
    cycleId: input.cycleId, employeeId: input.employeeId, reviewerId: actor.userId,
    ratings: JSON.stringify(input.ratings ?? {}),
    overallRating: overall,
    strengths: input.strengths ?? null,
    development: input.development ?? null,
    guardFlags: JSON.stringify(flags),
    status: input.submit ? 'SUBMITTED' : 'DRAFT',
    submittedAt: input.submit ? new Date().toISOString() : null,
  };

  if (existing) {
    hrDb.update(performanceReviews).set(row).where(eq(performanceReviews.id, existing.id)).run();
  } else {
    hrDb.insert(performanceReviews).values(row).run();
  }

  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'EMPLOYEE_UPDATED', resourceType: 'PerformanceReview',
    subjectEmployeeId: input.employeeId,
    outcome: flags.length ? 'DENIED' : 'SUCCESS',
    detail: flags.length
      ? `Review saved with ${flags.length} fairness flag(s): ${flags.map((f) => f.phrase).join(', ')}`
      : `Review ${input.submit ? 'submitted' : 'saved as draft'}, overall ${overall ?? '—'}`,
  });

  return { ...reviewFor(input.employeeId, input.cycleId)!, flags };
}

export function acknowledgeReview(actor: Actor, id: number, comment?: string) {
  const r = hrDb.select().from(performanceReviews).where(eq(performanceReviews.id, id)).all()[0];
  if (!r) throw notFound('Review not found');
  if (r.employeeId !== actor.employeeId) throw forbidden('You can only acknowledge your own review.');
  hrDb.update(performanceReviews).set({
    status: 'ACKNOWLEDGED', acknowledgedAt: new Date().toISOString(),
    employeeComment: comment ?? null,
  }).where(eq(performanceReviews.id, id)).run();
  return hydrate(hrDb.select().from(performanceReviews).where(eq(performanceReviews.id, id)).all()[0]);
}

/* ── Compliance view: every flagged review, for the auditor. ─────────────── */
export function flaggedReviews() {
  return hrDb.select({
    id: performanceReviews.id, employeeId: performanceReviews.employeeId,
    firstName: employees.firstName, lastName: employees.lastName,
    empCode: employees.empCode, cycleId: performanceReviews.cycleId,
    guardFlags: performanceReviews.guardFlags, status: performanceReviews.status,
    overallRating: performanceReviews.overallRating,
  }).from(performanceReviews)
    .innerJoin(employees, eq(employees.id, performanceReviews.employeeId))
    .all()
    .map((r) => ({ ...r, guardFlags: JSON.parse(r.guardFlags || '[]') as GuardFlag[] }))
    .filter((r) => r.guardFlags.length > 0);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
