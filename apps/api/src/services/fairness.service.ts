/* ═══════════════════════════════════════════════════════════════════════════
 *  FAIRNESS MONITORING
 *
 *  Two hard rules, both from the ethics charter:
 *
 *   • AGGREGATE ONLY. Any group smaller than FAIRNESS_MIN_GROUP_SIZE is
 *     suppressed, because a statistic over three people is a statement about
 *     three identifiable people.
 *
 *   • NEVER INFER HEALTH. This module does not read the constraint store at
 *     all. It cannot compare "restricted" against "unrestricted" staff, and
 *     it must not, because publishing that comparison would recreate exactly
 *     the disclosure the firewall prevents.
 *
 *  It measures distribution of burden — nights, weekends, hours, overtime —
 *  and flags when that burden is concentrated.
 * ═════════════════════════════════════════════════════════════════════════ */
import { and, eq, gte, lte } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import {
  employees, departments, shiftAssignments, shiftRequirements,
  shiftTemplates, fairnessSnapshots, payLines,
} from '../db/hr.schema.js';
import { env } from '../lib/env.js';
import { isWeekend } from '../lib/dates.js';
import * as audit from './audit.service.js';

/** Gini coefficient: 0 = perfectly even, 1 = one person carries everything. */
function gini(values: number[]): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return 0;
  const total = v.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (2 * (i + 1) - n - 1) * v[i];
  return Math.round((cum / (n * total)) * 1000) / 1000;
}

const spread = (v: number[]) => (v.length ? Math.max(...v) - Math.min(...v) : 0);
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

export function computeFairness(from: string, to: string, scope: 'ALL' | number = 'ALL') {
  const staff = hrDb.select().from(employees).where(eq(employees.status, 'ACTIVE')).all()
    .filter((e) => scope === 'ALL' || e.departmentId === scope);

  const groupSize = staff.length;
  if (groupSize < env.FAIRNESS_MIN_GROUP_SIZE) {
    return {
      scope: String(scope), groupSize, suppressed: true,
      reason: `Group of ${groupSize} is below the minimum of ${env.FAIRNESS_MIN_GROUP_SIZE}. ` +
              `Statistics on groups this small can identify individuals, so they are withheld.`,
      metrics: null, alerts: [],
    };
  }

  const ids = new Set(staff.map((e) => e.id));
  const rows = hrDb.select({
    employeeId: shiftAssignments.employeeId,
    date: shiftAssignments.date,
    hours: shiftAssignments.hours,
    weight: shiftAssignments.workloadWeight,
    isVoluntaryExtra: shiftAssignments.isVoluntaryExtra,
    isNight: shiftTemplates.isNight,
  }).from(shiftAssignments)
    .innerJoin(shiftRequirements, eq(shiftRequirements.id, shiftAssignments.shiftRequirementId))
    .innerJoin(shiftTemplates, eq(shiftTemplates.id, shiftRequirements.shiftTemplateId))
    .where(and(gte(shiftAssignments.date, from), lte(shiftAssignments.date, to)))
    .all().filter((r) => ids.has(r.employeeId));

  const per = new Map<number, { hours: number; nights: number; weekends: number; weight: number; extra: number }>();
  for (const e of staff) per.set(e.id, { hours: 0, nights: 0, weekends: 0, weight: 0, extra: 0 });
  for (const r of rows) {
    const p = per.get(r.employeeId)!;
    p.hours += r.hours;
    p.weight += r.weight;
    if (r.isNight) p.nights++;
    if (isWeekend(r.date)) p.weekends++;
    if (r.isVoluntaryExtra) p.extra += r.hours;
  }

  const vals = [...per.values()];
  const hours = vals.map((p) => p.hours);
  const nights = vals.map((p) => p.nights);
  const weekends = vals.map((p) => p.weekends);
  const weights = vals.map((p) => p.weight);
  const extras = vals.map((p) => p.extra);

  const metrics = {
    employees: groupSize,
    hours: { mean: r1(mean(hours)), spread: r1(spread(hours)), gini: gini(hours) },
    nights: { mean: r1(mean(nights)), spread: spread(nights), gini: gini(nights) },
    weekends: { mean: r1(mean(weekends)), spread: spread(weekends), gini: gini(weekends) },
    workload: { mean: r1(mean(weights)), spread: r1(spread(weights)), gini: gini(weights) },
    voluntaryExtra: { mean: r1(mean(extras)), spread: r1(spread(extras)), gini: gini(extras) },
  };

  const alerts: Array<{ level: 'INFO' | 'WARN'; metric: string; message: string }> = [];
  if (metrics.nights.gini > 0.35)
    alerts.push({ level: 'WARN', metric: 'nights', message: `Night shifts are unevenly distributed (Gini ${metrics.nights.gini}). Review the rotation.` });
  if (metrics.nights.spread >= 4)
    alerts.push({ level: 'WARN', metric: 'nights', message: `${metrics.nights.spread} nights between the most and least rostered staff member.` });
  if (metrics.hours.gini > 0.25)
    alerts.push({ level: 'WARN', metric: 'hours', message: `Scheduled hours are unevenly distributed (Gini ${metrics.hours.gini}).` });
  if (metrics.weekends.spread >= 4)
    alerts.push({ level: 'INFO', metric: 'weekends', message: `Weekend load varies by ${metrics.weekends.spread} shifts across the team.` });
  if (!alerts.length)
    alerts.push({ level: 'INFO', metric: 'all', message: 'No distribution concerns detected for this period.' });

  return { scope: String(scope), groupSize, suppressed: false, reason: null, metrics, alerts };
}

/** Pay-equity check. Confirms that nobody's BASE pay falls below their
 *  contracted entitlement — i.e. that no accommodation has quietly cost
 *  someone money. It compares contracted-vs-base only, never health. */
export function payEquityCheck(payPeriodId: number) {
  const lines = hrDb.select({
    employeeId: payLines.employeeId, contractedHours: payLines.contractedHours,
    basePay: payLines.basePay, grossPay: payLines.grossPay,
    rate: employees.baseHourlyRate,
  }).from(payLines)
    .innerJoin(employees, eq(employees.id, payLines.employeeId))
    .where(eq(payLines.payPeriodId, payPeriodId)).all();

  const underpaid = lines.filter((l) => l.basePay < l.contractedHours * l.rate - 0.01);
  return {
    checked: lines.length,
    passed: underpaid.length === 0,
    underpaid: underpaid.map((l) => ({ employeeId: l.employeeId, basePay: l.basePay, expected: l.contractedHours * l.rate })),
    statement: underpaid.length === 0
      ? 'Every employee was paid their full contracted hours. No scheduling restriction reduced anyone’s base pay.'
      : `${underpaid.length} employee(s) were paid below their contracted entitlement. Investigate immediately.`,
  };
}

export function snapshot(actor: { userId: number; email: string; role: string }, from: string, to: string) {
  const all = computeFairness(from, to, 'ALL');
  hrDb.insert(fairnessSnapshots).values({
    periodStart: from, periodEnd: to, scope: 'ALL',
    groupSize: all.groupSize, suppressed: all.suppressed,
    metrics: JSON.stringify(all.metrics ?? {}), alerts: JSON.stringify(all.alerts),
  }).run();
  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'FAIRNESS_SNAPSHOT', resourceType: 'FairnessSnapshot',
    detail: `${from}..${to}, ${all.alerts.length} alert(s), aggregate only`,
  });
  return all;
}

export function byDepartment(from: string, to: string) {
  return hrDb.select().from(departments).all()
    .map((d) => ({ department: d.name, departmentId: d.id, ...computeFairness(from, to, d.id) }));
}

const r1 = (n: number) => Math.round(n * 10) / 10;
