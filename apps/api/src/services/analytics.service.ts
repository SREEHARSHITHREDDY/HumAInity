/* ═══════════════════════════════════════════════════════════════════════════
 *  WORKFORCE ANALYTICS
 *
 *  Operational reporting. Like the fairness module, it never reads the
 *  constraint store, so no chart here can be broken down by health status —
 *  and a chart is exactly how such a disclosure would normally happen.
 *
 *  Small groups are suppressed for the same reason as in fairness: a bar with
 *  two people in it names those two people.
 * ═════════════════════════════════════════════════════════════════════════ */
import { and, eq, gte, lte } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import {
  employees, departments, shiftAssignments, shiftRequirements, shiftTemplates,
  leaveRequests, qualifications, applications, jobPostings, onboardingTasks,
  rosters, tickets,
} from '../db/hr.schema.js';
import { env } from '../lib/env.js';
import { dayKey, addDays, eachDay, isWeekend } from '../lib/dates.js';

const r1 = (n: number) => Math.round(n * 10) / 10;

export function overview(from: string, to: string) {
  const staff = hrDb.select().from(employees).where(eq(employees.status, 'ACTIVE')).all();
  const depts = hrDb.select().from(departments).all();

  const assignments = hrDb.select({
    employeeId: shiftAssignments.employeeId, date: shiftAssignments.date,
    hours: shiftAssignments.hours, isVoluntaryExtra: shiftAssignments.isVoluntaryExtra,
    isNight: shiftTemplates.isNight, departmentId: shiftRequirements.departmentId,
    templateCode: shiftTemplates.code,
  }).from(shiftAssignments)
    .innerJoin(shiftRequirements, eq(shiftRequirements.id, shiftAssignments.shiftRequirementId))
    .innerJoin(shiftTemplates, eq(shiftTemplates.id, shiftRequirements.shiftTemplateId))
    .where(and(gte(shiftAssignments.date, from), lte(shiftAssignments.date, to))).all();

  const required = hrDb.select({
    date: shiftRequirements.date, count: shiftRequirements.requiredCount,
    departmentId: shiftRequirements.departmentId,
  }).from(shiftRequirements)
    .where(and(gte(shiftRequirements.date, from), lte(shiftRequirements.date, to))).all();

  const totalRequired = required.reduce((s, r) => s + r.count, 0);
  const totalFilled = assignments.length;

  /* ── Coverage by department ─────────────────────────────────────────── */
  const byDept = depts.map((d) => {
    const req = required.filter((r) => r.departmentId === d.id).reduce((s, r) => s + r.count, 0);
    const got = assignments.filter((a) => a.departmentId === d.id).length;
    const headcount = staff.filter((e) => e.departmentId === d.id).length;
    const suppressed = headcount < env.FAIRNESS_MIN_GROUP_SIZE;
    return {
      departmentId: d.id, department: d.name, headcount,
      suppressed,
      required: suppressed ? null : req,
      filled: suppressed ? null : got,
      coveragePct: suppressed ? null : (req ? r1((got / req) * 100) : 100),
      hours: suppressed ? null : r1(assignments.filter((a) => a.departmentId === d.id)
        .reduce((s, a) => s + a.hours, 0)),
    };
  });

  /* ── Hours per day, for the trend line ──────────────────────────────── */
  const days = eachDay(from, to);
  const trend = days.map((d) => {
    const dayAssign = assignments.filter((a) => a.date === d);
    return {
      date: d,
      hours: r1(dayAssign.reduce((s, a) => s + a.hours, 0)),
      shifts: dayAssign.length,
      nights: dayAssign.filter((a) => a.isNight).length,
      weekend: isWeekend(d),
    };
  });

  /* ── Shift-type mix ─────────────────────────────────────────────────── */
  const mixMap = new Map<string, number>();
  for (const a of assignments) mixMap.set(a.templateCode, (mixMap.get(a.templateCode) ?? 0) + 1);
  const shiftMix = [...mixMap.entries()].map(([code, n]) => ({ code, count: n }))
    .sort((a, b) => b.count - a.count);

  /* ── Leave ──────────────────────────────────────────────────────────── */
  const leave = hrDb.select().from(leaveRequests).all();
  const leaveByType = new Map<string, number>();
  for (const l of leave.filter((l) => l.status === 'APPROVED'))
    leaveByType.set(l.leaveType, (leaveByType.get(l.leaveType) ?? 0) + l.days);

  /* ── Credentials ────────────────────────────────────────────────────── */
  const horizon = dayKey(addDays(dayKey(new Date()), 90));
  const quals = hrDb.select().from(qualifications).all();
  const expiring = quals.filter((q) => q.expiresOn && q.expiresOn <= horizon).length;
  const lapsed = quals.filter((q) => q.expiresOn && q.expiresOn < dayKey(new Date())).length;

  /* ── Recruitment & onboarding ───────────────────────────────────────── */
  const apps = hrDb.select().from(applications).all();
  const stageMap = new Map<string, number>();
  for (const a of apps) stageMap.set(a.stage, (stageMap.get(a.stage) ?? 0) + 1);

  const onboarding = hrDb.select().from(onboardingTasks).all();
  const onbDone = onboarding.filter((t) => t.status === 'DONE' || t.status === 'WAIVED').length;

  const openTickets = hrDb.select().from(tickets).where(eq(tickets.status, 'OPEN')).all().length;
  const rosterRuns = hrDb.select().from(rosters).all();

  return {
    period: { from, to },
    headline: {
      activeStaff: staff.length,
      departments: depts.length,
      totalHours: r1(assignments.reduce((s, a) => s + a.hours, 0)),
      coveragePct: totalRequired ? r1((totalFilled / totalRequired) * 100) : 100,
      slotsRequired: totalRequired,
      slotsFilled: totalFilled,
      nightShifts: assignments.filter((a) => a.isNight).length,
      voluntaryExtraHours: r1(assignments.filter((a) => a.isVoluntaryExtra).reduce((s, a) => s + a.hours, 0)),
      partTimeShare: r1((staff.filter((e) => e.employmentType !== 'FULL_TIME').length / Math.max(1, staff.length)) * 100),
    },
    byDepartment: byDept,
    trend,
    shiftMix,
    leave: {
      pending: leave.filter((l) => l.status === 'PENDING').length,
      approvedDays: r1([...leaveByType.values()].reduce((a, b) => a + b, 0)),
      byType: [...leaveByType.entries()].map(([type, days]) => ({ type, days: r1(days) })),
    },
    credentials: { total: quals.length, expiringSoon: expiring, lapsed },
    recruitment: {
      openPostings: hrDb.select().from(jobPostings).where(eq(jobPostings.status, 'OPEN')).all().length,
      applications: apps.length,
      byStage: [...stageMap.entries()].map(([stage, n]) => ({ stage, count: n })),
    },
    onboarding: {
      tasks: onboarding.length, completed: onbDone,
      percent: onboarding.length ? Math.round((onbDone / onboarding.length) * 100) : 0,
    },
    helpdesk: { open: openTickets },
    scheduling: {
      rosters: rosterRuns.length,
      lastEngine: rosterRuns[rosterRuns.length - 1]?.solverEngine ?? null,
      averageRuntimeMs: rosterRuns.length
        ? Math.round(rosterRuns.reduce((s, r) => s + (r.runtimeMs ?? 0), 0) / rosterRuns.length)
        : null,
    },
    note:
      'Operational figures only. This module does not read the restriction store, so no ' +
      'breakdown here can be produced by health status. Departments below the minimum ' +
      `group size (${env.FAIRNESS_MIN_GROUP_SIZE}) are suppressed.`,
  };
}
