/* ═══════════════════════════════════════════════════════════════════════════
 *  CAPACITY & PAY
 *
 *  Three things are kept strictly apart, and that separation is the whole
 *  reason the system is safe:
 *
 *   • CONTRACTED HOURS (FTE) — an employment-contract fact. Payroll sees it.
 *     A person may be part-time for any reason: choice, study, caregiving,
 *     phased return, an accommodation. Payroll cannot tell which.
 *
 *   • DAILY / WEEKLY CAP — a scheduling constraint from the firewall.
 *     The SCHEDULER sees it. Payroll NEVER does.
 *
 *   • VOLUNTARY EXTRA HOURS — opt-in only, same premium rate for everybody.
 *
 *  Consequence: base pay is ALWAYS computed on contracted hours. A health
 *  accommodation therefore costs the employee nothing, and — just as
 *  important — produces no payroll anomaly anyone could reason backwards
 *  from. Nobody has a financial reason to hide a restriction.
 * ═════════════════════════════════════════════════════════════════════════ */
import { and, eq, gte, lte, isNull } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import {
  employees, shiftAssignments, shiftRequirements, shiftTemplates,
  overtimeOptIns, payPeriods, payLines,
} from '../db/hr.schema.js';
import * as firewall from './firewall.service.js';
import * as fatigue from './fatigue.service.js';
import * as audit from './audit.service.js';
import { dayKey } from '../lib/dates.js';
import { notFound } from '../lib/errors.js';

export interface Capacity {
  employeeId: number;
  contractedHoursPerWeek: number;
  contractedFte: number;
  /** Lowest of: contract-implied daily hours, and any MAX_DAILY_HOURS cap. */
  effectiveDailyCapHours: number;
  effectiveWeeklyCapHours: number;
  maxDailyWorkload: number | null;
  excludesNights: boolean;
  excludesWeekends: boolean;
  minRestHours: number | null;
  maxConsecutiveDays: number | null;
  /** True only if the employee opted in AND is below the fatigue ceiling. */
  eligibleForVoluntaryExtra: boolean;
  voluntaryExtraCapHours: number;
  blockedReason: string | null;
}

const DEFAULT_DAILY = 8;

export function capacityFor(employeeId: number, from: string, to: string): Capacity {
  const emp = hrDb.select().from(employees).where(eq(employees.id, employeeId)).all()[0];
  if (!emp) throw new Error(`Employee ${employeeId} not found`);

  const cons = firewall.constraintsForScheduler([employeeId], from, to);
  const num = (t: string, k: string) => {
    const c = cons.find((x) => x.type === t);
    return c ? Number((c.params as any)[k]) : null;
  };

  const dailyCap = num('MAX_DAILY_HOURS', 'hours');
  const weeklyCap = num('MAX_WEEKLY_HOURS', 'hours');

  const effectiveDailyCapHours = dailyCap !== null ? Math.min(dailyCap, DEFAULT_DAILY) : DEFAULT_DAILY;
  const effectiveWeeklyCapHours = weeklyCap !== null
    ? Math.min(weeklyCap, emp.contractedHoursPerWeek)
    : emp.contractedHoursPerWeek;

  const optIn = hrDb.select().from(overtimeOptIns).where(and(
    eq(overtimeOptIns.employeeId, employeeId),
    lte(overtimeOptIns.periodStart, to),
    gte(overtimeOptIns.periodEnd, from),
    isNull(overtimeOptIns.withdrawnAt),
  )).all()[0];

  const f = fatigue.computeFatigue(employeeId, dayKey(new Date()));

  // An employee who has a daily-hours cap is never offered extra hours —
  // not because of any health reason the system can see, but because extra
  // hours would breach a constraint the scheduler must respect.
  let blockedReason: string | null = null;
  if (!optIn) blockedReason = 'Has not opted in to additional hours';
  else if (f.atCeiling) blockedReason = `Fatigue score ${f.score} is at or above the ceiling`;
  else if (dailyCap !== null && dailyCap < DEFAULT_DAILY) blockedReason = 'An active scheduling cap applies';

  return {
    employeeId,
    contractedHoursPerWeek: emp.contractedHoursPerWeek,
    contractedFte: emp.contractedFte,
    effectiveDailyCapHours,
    effectiveWeeklyCapHours,
    maxDailyWorkload: num('MAX_DAILY_WORKLOAD', 'weight'),
    excludesNights: cons.some((c) => c.type === 'NO_NIGHT_SHIFTS'),
    excludesWeekends: cons.some((c) => c.type === 'NO_WEEKEND_SHIFTS'),
    minRestHours: num('MIN_REST_HOURS', 'hours'),
    maxConsecutiveDays: num('MAX_CONSECUTIVE_DAYS', 'days'),
    eligibleForVoluntaryExtra: !blockedReason,
    voluntaryExtraCapHours: blockedReason ? 0 : (optIn?.maxAdditionalHours ?? 0),
    blockedReason,
  };
}

export function optInToExtraHours(
  actor: { userId: number; email: string; role: string },
  employeeId: number, periodStart: string, periodEnd: string, maxAdditionalHours: number,
) {
  if (fatigue.isBlockedByFatigue(employeeId)) {
    throw Object.assign(new Error(
      'Additional hours cannot be taken on while your fatigue score is at the ceiling. ' +
      'This limit applies to everyone and cannot be waived.'), { status: 422 });
  }
  const row = hrDb.insert(overtimeOptIns).values({
    employeeId, periodStart, periodEnd, maxAdditionalHours,
  }).returning().all()[0];
  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'OVERTIME_OPTIN', resourceType: 'OvertimeOptIn', resourceId: String(row.id),
    subjectEmployeeId: employeeId, detail: `Up to ${maxAdditionalHours}h, ${periodStart}..${periodEnd}`,
  });
  return row;
}

/* ─── Pay ────────────────────────────────────────────────────────────────── */

export function calculatePayPeriod(actor: { userId: number; email: string; role: string }, payPeriodId: number) {
  const period = hrDb.select().from(payPeriods).where(eq(payPeriods.id, payPeriodId)).all()[0];
  if (!period) throw notFound('Pay period not found');

  // Inclusive of both end dates: 26 Oct to 8 Nov is 14 days, i.e. 2.0 weeks.
  const days = Math.round(
    (new Date(period.endDate).getTime() - new Date(period.startDate).getTime()) / 86_400_000) + 1;
  const weeks = Math.max(1, days / 7);

  const staff = hrDb.select().from(employees).where(eq(employees.status, 'ACTIVE')).all();
  const out = [];

  for (const emp of staff) {
    const rows = hrDb.select({
      hours: shiftAssignments.hours,
      isVoluntaryExtra: shiftAssignments.isVoluntaryExtra,
      isNight: shiftTemplates.isNight,
    }).from(shiftAssignments)
      .innerJoin(shiftRequirements, eq(shiftRequirements.id, shiftAssignments.shiftRequirementId))
      .innerJoin(shiftTemplates, eq(shiftTemplates.id, shiftRequirements.shiftTemplateId))
      .where(and(
        eq(shiftAssignments.employeeId, emp.id),
        gte(shiftAssignments.date, period.startDate),
        lte(shiftAssignments.date, period.endDate),
      )).all();

    const contractedHours = round2(emp.contractedHoursPerWeek * weeks);

    /* ── THE RULE ───────────────────────────────────────────────────────────
     * Base pay is contracted hours × rate. Always. We do NOT look at how many
     * hours were actually scheduled. If a scheduling cap meant fewer hours
     * were worked, the employee is still paid in full, and payroll never
     * learns that anything was different about this person.              */
    const basePay = contractedHours * emp.baseHourlyRate;

    const voluntaryExtraHours = rows.filter(r => r.isVoluntaryExtra).reduce((s, r) => s + r.hours, 0);
    const overtimePay = voluntaryExtraHours * emp.baseHourlyRate * emp.overtimeMultiplier;

    const nightHours = rows.filter(r => r.isNight).reduce((s, r) => s + r.hours, 0);
    const nightPremiumPay = nightHours * emp.baseHourlyRate * emp.nightPremiumRate;

    const grossPay = basePay + overtimePay + nightPremiumPay;

    hrDb.insert(payLines).values({
      payPeriodId, employeeId: emp.id, contractedHours,
      basePay: round2(basePay), voluntaryExtraHours: round2(voluntaryExtraHours),
      overtimePay: round2(overtimePay), nightHours,
      nightPremiumPay: round2(nightPremiumPay), grossPay: round2(grossPay),
    }).onConflictDoUpdate({
      target: [payLines.payPeriodId, payLines.employeeId],
      set: {
        contractedHours, basePay: round2(basePay), voluntaryExtraHours: round2(voluntaryExtraHours),
        overtimePay: round2(overtimePay), nightHours,
        nightPremiumPay: round2(nightPremiumPay), grossPay: round2(grossPay),
        calculatedAt: new Date().toISOString(),
      },
    }).run();
    out.push({ employeeId: emp.id, grossPay: round2(grossPay) });
  }

  hrDb.update(payPeriods).set({ status: 'CALCULATED' }).where(eq(payPeriods.id, payPeriodId)).run();
  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'PAY_CALCULATED', resourceType: 'PayPeriod', resourceId: String(payPeriodId),
    detail: `${out.length} pay lines; base pay computed on contracted hours for every employee`,
  });
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** An employee's OWN view of their pay. This is the only place the
 *  "accommodation protected" figure is ever derived — it is computed on the
 *  fly for the person themselves and is never stored, never shown to a
 *  manager, and never present in payroll's own view. */
export function selfPayView(employeeId: number, payPeriodId: number) {
  const line = hrDb.select().from(payLines).where(and(
    eq(payLines.payPeriodId, payPeriodId), eq(payLines.employeeId, employeeId),
  )).all()[0];
  if (!line) return null;
  const period = hrDb.select().from(payPeriods).where(eq(payPeriods.id, payPeriodId)).all()[0];

  const scheduled = hrDb.select({ hours: shiftAssignments.hours }).from(shiftAssignments)
    .where(and(
      eq(shiftAssignments.employeeId, employeeId),
      gte(shiftAssignments.date, period.startDate),
      lte(shiftAssignments.date, period.endDate),
    )).all().reduce((s, r) => s + r.hours, 0);

  const protectedHours = Math.max(0, line.contractedHours - scheduled);
  return {
    ...line,
    scheduledHours: round2(scheduled),
    accommodationProtectedHours: round2(protectedHours),
    explanation: protectedHours > 0
      ? `You were scheduled ${round2(scheduled)}h against ${line.contractedHours}h contracted, and you are paid for all ${line.contractedHours}h. A scheduling restriction never reduces your pay.`
      : `You were scheduled ${round2(scheduled)}h against ${line.contractedHours}h contracted.`,
  };
}
