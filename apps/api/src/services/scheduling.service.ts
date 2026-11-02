/* Orchestrates a roster run:
 *   1. expire stale constraints and re-sync the firewall
 *   2. assemble the solver payload (diagnosis-free by construction)
 *   3. solve (CP-SAT, or the fallback engine)
 *   4. validate the result INDEPENDENTLY
 *   5. persist — as FAILED if validation found a hard-rule breach
 */
import { and, eq, gte, lte, inArray } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import {
  employees, qualifications, shiftRequirements, shiftTemplates, shiftAssignments,
  rosters, leaveRequests, shiftPreferences, departments, overtimeOptIns, notifications,
} from '../db/hr.schema.js';
import * as firewall from './firewall.service.js';
import * as fatigue from './fatigue.service.js';
import * as audit from './audit.service.js';
import * as solverClient from '../solver/client.js';
import { validate } from '../solver/validator.js';
import type { SolveRequest } from '../solver/types.js';
import { eachDay } from '../lib/dates.js';

/* How costly it is to leave a slot unfilled. A night in a critical unit is
 * not interchangeable with an outpatient morning; without this weighting the
 * solver abandons long, critical shifts first, because each one consumes more
 * of a scarce hours budget for the same reduction in unfilled-slot count. */
const CRITICAL_DEPT_CODES = ['SRE', 'NOC'];
let criticalDeptIds: number[] | null = null;
function coverageWeight(isNight: boolean, departmentId: number): number {
  if (criticalDeptIds === null) {
    criticalDeptIds = hrDb.select({ id: departments.id, code: departments.code })
      .from(departments).all()
      .filter((d) => CRITICAL_DEPT_CODES.includes(d.code)).map((d) => d.id);
  }
  const critical = criticalDeptIds.includes(departmentId) ? 1.6 : 1.0;
  return (isNight ? 3.0 : 1.0) * critical;
}

export async function generateRoster(
  actor: { userId: number; email: string; role: string },
  opts: { name: string; periodStart: string; periodEnd: string; departmentIds?: number[]; maxTimeSeconds?: number },
) {
  // ── 1. The firewall is re-evaluated before every solve. An expired or
  //       revoked restriction can never silently persist into a new roster.
  firewall.expireStale();
  const sync = firewall.syncAll(actor);

  // ── 2. Assemble the payload
  const staff = hrDb.select().from(employees).where(eq(employees.status, 'ACTIVE')).all()
    .filter((e) => !opts.departmentIds?.length || opts.departmentIds.includes(e.departmentId));
  const ids = staff.map((e) => e.id);
  if (!ids.length) throw new Error('No active employees for the selected scope');

  const quals = hrDb.select().from(qualifications).where(inArray(qualifications.employeeId, ids)).all();
  const qualBy = new Map<number, string[]>();
  for (const q of quals) {
    if (q.expiresOn && q.expiresOn < opts.periodStart) continue;   // lapsed credential
    if (!qualBy.has(q.employeeId)) qualBy.set(q.employeeId, []);
    qualBy.get(q.employeeId)!.push(q.type);
  }

  const reqs = hrDb.select({
    id: shiftRequirements.id, date: shiftRequirements.date,
    departmentId: shiftRequirements.departmentId,
    requiredCount: shiftRequirements.requiredCount,
    requiredQualification: shiftRequirements.requiredQualification,
    templateId: shiftTemplates.id, templateCode: shiftTemplates.code,
    durationHours: shiftTemplates.durationHours, isNight: shiftTemplates.isNight,
    workloadWeight: shiftTemplates.workloadWeight,
  }).from(shiftRequirements)
    .innerJoin(shiftTemplates, eq(shiftTemplates.id, shiftRequirements.shiftTemplateId))
    .where(and(
      gte(shiftRequirements.date, opts.periodStart),
      lte(shiftRequirements.date, opts.periodEnd),
    )).all()
    .filter((r) => !opts.departmentIds?.length || opts.departmentIds.includes(r.departmentId));

  if (!reqs.length) throw new Error('No shift requirements defined for this period');

  const approvedLeave = hrDb.select().from(leaveRequests).where(and(
    inArray(leaveRequests.employeeId, ids), eq(leaveRequests.status, 'APPROVED'),
  )).all();
  const leave: Array<{ employee_id: number; date: string }> = [];
  for (const l of approvedLeave) {
    for (const d of eachDay(l.startDate, l.endDate)) {
      if (d >= opts.periodStart && d <= opts.periodEnd) leave.push({ employee_id: l.employeeId, date: d });
    }
  }

  const prefs = hrDb.select().from(shiftPreferences).where(inArray(shiftPreferences.employeeId, ids)).all();

  const optIns = hrDb.select().from(overtimeOptIns).where(and(
    inArray(overtimeOptIns.employeeId, ids),
    lte(overtimeOptIns.periodStart, opts.periodEnd),
    gte(overtimeOptIns.periodEnd, opts.periodStart),
  )).all().filter((o) => !o.withdrawnAt);
  const optInBy = new Map(optIns.map((o) => [o.employeeId, o.maxAdditionalHours]));

  // ── The ONLY health-derived input. Type + numbers + dates. Nothing else.
  const constraints = firewall.constraintsForScheduler(ids, opts.periodStart, opts.periodEnd);

  const payload: SolveRequest = {
    period_start: opts.periodStart,
    period_end: opts.periodEnd,
    employees: staff.map((e) => {
      const f = fatigue.computeFatigue(e.id);
      return {
        id: e.id, name: `${e.firstName} ${e.lastName}`, department_id: e.departmentId,
        qualifications: qualBy.get(e.id) ?? [],
        contracted_hours_per_week: e.contractedHoursPerWeek,
        voluntary_extra_cap_hours: f.atCeiling ? 0 : (optInBy.get(e.id) ?? 0),
        fatigue_score: f.score, fatigue_at_ceiling: f.atCeiling,
      };
    }),
    shifts: reqs.map((r) => ({
      requirement_id: r.id, date: r.date, department_id: r.departmentId,
      template_id: r.templateId, template_code: r.templateCode,
      duration_hours: r.durationHours, is_night: !!r.isNight,
      workload_weight: r.workloadWeight, required_count: r.requiredCount,
      required_qualification: r.requiredQualification,
      coverage_weight: coverageWeight(r.isNight, r.departmentId),
    })),
    constraints: constraints.map((c) => ({
      employee_id: c.employeeId, type: c.type, params: c.params,
      effective_from: c.effectiveFrom, effective_to: c.effectiveTo,
    })),
    leave,
    preferences: prefs.map((p) => ({ employee_id: p.employeeId, template_id: p.shiftTemplateId, weight: p.weight })),
    max_time_seconds: opts.maxTimeSeconds ?? 20,
  };

  // ── 3. Solve
  const result = await solverClient.solve(payload);

  // ── 4. Validate independently
  const violations = validate(payload, result.assignments);
  const failed = violations.length > 0;

  // ── 5. Persist
  const roster = hrDb.insert(rosters).values({
    name: opts.name, periodStart: opts.periodStart, periodEnd: opts.periodEnd,
    status: failed ? 'FAILED' : 'DRAFT',
    solverStatus: result.status, solverEngine: result.engine, runtimeMs: result.runtime_ms,
    metrics: JSON.stringify({
      ...result.metrics,
      firewall: { projected: sync.projected, refused: sync.refused.length, expired: sync.expired },
      validation: { violations: violations.length, passed: !failed },
    }),
    explanation: JSON.stringify({
      shortfalls: result.shortfalls,
      violations,
      solverMessage: result.message ?? null,
      firewallRefusals: sync.refused,
    }),
  }).returning().all()[0];

  if (!failed) {
    for (const a of result.assignments) {
      hrDb.insert(shiftAssignments).values({
        rosterId: roster.id, shiftRequirementId: a.requirement_id, employeeId: a.employee_id,
        date: a.date, hours: a.hours, workloadWeight: a.workload_weight,
        isVoluntaryExtra: a.is_voluntary_extra,
      }).run();
    }
    hrDb.update(shiftRequirements).set({ rosterId: roster.id }).where(and(
      gte(shiftRequirements.date, opts.periodStart),
      lte(shiftRequirements.date, opts.periodEnd),
    )).run();
  }

  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'ROSTER_GENERATED', resourceType: 'Roster', resourceId: String(roster.id),
    outcome: failed ? 'ERROR' : 'SUCCESS',
    detail: failed
      ? `Rejected by the independent validator: ${violations.length} hard-rule violation(s)`
      : `${result.engine} ${result.status}, coverage ${result.metrics.coverage_pct}%, ` +
        `${constraints.length} health constraints applied without disclosure`,
  });

  return { roster, result, violations, firewall: sync };
}

export function approveRoster(actor: { userId: number; email: string; role: string }, rosterId: number) {
  const r = hrDb.select().from(rosters).where(eq(rosters.id, rosterId)).all()[0];
  if (!r) throw new Error('Roster not found');
  if (r.status === 'FAILED') throw new Error('A roster that failed validation cannot be approved');

  hrDb.update(rosters).set({
    status: 'APPROVED', approvedById: actor.userId, approvedAt: new Date().toISOString(),
  }).where(eq(rosters.id, rosterId)).run();

  const assigned = hrDb.select().from(shiftAssignments).where(eq(shiftAssignments.rosterId, rosterId)).all();
  const byEmp = new Map<number, number>();
  for (const a of assigned) byEmp.set(a.employeeId, (byEmp.get(a.employeeId) ?? 0) + 1);
  for (const [employeeId, n] of byEmp) {
    hrDb.insert(notifications).values({
      employeeId, kind: 'ROSTER_PUBLISHED', title: `Roster published: ${r.name}`,
      body: `You have ${n} shift${n === 1 ? '' : 's'} in this period. Open My Schedule to review.`,
    }).run();
  }

  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'ROSTER_APPROVED', resourceType: 'Roster', resourceId: String(rosterId),
    detail: `${assigned.length} assignments published to ${byEmp.size} staff`,
  });
  return { ...r, status: 'APPROVED' };
}

export function listRosters() {
  return hrDb.select().from(rosters).orderBy(rosters.id).all().reverse();
}

export function rosterDetail(id: number) {
  const roster = hrDb.select().from(rosters).where(eq(rosters.id, id)).all()[0];
  if (!roster) return null;
  const assignments = hrDb.select({
    id: shiftAssignments.id, date: shiftAssignments.date, hours: shiftAssignments.hours,
    isVoluntaryExtra: shiftAssignments.isVoluntaryExtra,
    employeeId: employees.id, firstName: employees.firstName, lastName: employees.lastName,
    empCode: employees.empCode,
    templateCode: shiftTemplates.code, templateName: shiftTemplates.name,
    startTime: shiftTemplates.startTime, endTime: shiftTemplates.endTime,
    isNight: shiftTemplates.isNight, workloadWeight: shiftTemplates.workloadWeight,
    departmentName: departments.name,
  }).from(shiftAssignments)
    .innerJoin(employees, eq(employees.id, shiftAssignments.employeeId))
    .innerJoin(shiftRequirements, eq(shiftRequirements.id, shiftAssignments.shiftRequirementId))
    .innerJoin(shiftTemplates, eq(shiftTemplates.id, shiftRequirements.shiftTemplateId))
    .innerJoin(departments, eq(departments.id, shiftRequirements.departmentId))
    .where(eq(shiftAssignments.rosterId, id)).all();

  return {
    ...roster,
    metrics: roster.metrics ? JSON.parse(roster.metrics) : {},
    explanation: roster.explanation ? JSON.parse(roster.explanation) : {},
    assignments,
  };
}

export function scheduleForEmployee(employeeId: number, from: string, to: string) {
  return hrDb.select({
    id: shiftAssignments.id, date: shiftAssignments.date, hours: shiftAssignments.hours,
    isVoluntaryExtra: shiftAssignments.isVoluntaryExtra, status: shiftAssignments.status,
    templateCode: shiftTemplates.code, templateName: shiftTemplates.name,
    startTime: shiftTemplates.startTime, endTime: shiftTemplates.endTime,
    isNight: shiftTemplates.isNight,
    departmentName: departments.name,
    rosterStatus: rosters.status, rosterName: rosters.name,
  }).from(shiftAssignments)
    .innerJoin(shiftRequirements, eq(shiftRequirements.id, shiftAssignments.shiftRequirementId))
    .innerJoin(shiftTemplates, eq(shiftTemplates.id, shiftRequirements.shiftTemplateId))
    .innerJoin(departments, eq(departments.id, shiftRequirements.departmentId))
    .innerJoin(rosters, eq(rosters.id, shiftAssignments.rosterId))
    .where(and(
      eq(shiftAssignments.employeeId, employeeId),
      gte(shiftAssignments.date, from), lte(shiftAssignments.date, to),
    )).all().sort((a, b) => a.date.localeCompare(b.date));
}
