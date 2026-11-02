import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import { employees, payPeriods, payLines, rosters, departments, leaveRequests } from '../db/hr.schema.js';
import { authenticate, requireRole, requireRoleOrSelf, actor } from '../middleware/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { DIRECTORY_ROLES } from '../lib/roles.js';
import * as capacity from '../services/capacity.service.js';
import * as fatigue from '../services/fatigue.service.js';
import * as fairness from '../services/fairness.service.js';
import * as firewall from '../services/firewall.service.js';
import * as audit from '../services/audit.service.js';
import * as solverClient from '../solver/client.js';
import { dayKey, addDays } from '../lib/dates.js';

export const workforceRoutes = Router();
workforceRoutes.use(authenticate);

/* ─── Capacity ───────────────────────────────────────────────────────────── */

workforceRoutes.get('/capacity/:employeeId', requireRoleOrSelf('employeeId', ...DIRECTORY_ROLES), (req, res, next) => {
  try {
    const from = String(req.query.from ?? dayKey(new Date()));
    const to = String(req.query.to ?? dayKey(addDays(new Date(), 27)));
    res.json(capacity.capacityFor(Number(req.params.employeeId), from, to));
  } catch (e) { next(e); }
});

workforceRoutes.post('/overtime/opt-in', (req, res, next) => {
  try {
    const a = actor(req);
    const employeeId = Number(req.body?.employeeId ?? a.employeeId);
    if (!employeeId) throw badRequest('No employee linked to this account');
    if (employeeId !== a.employeeId && !['HR_ADMIN', 'SYSTEM_ADMIN'].includes(a.role)) {
      throw badRequest('You may only opt in for yourself');
    }
    const { periodStart, periodEnd, maxAdditionalHours } = req.body ?? {};
    if (!periodStart || !periodEnd || maxAdditionalHours === undefined) {
      throw badRequest('periodStart, periodEnd and maxAdditionalHours are required');
    }
    res.status(201).json(capacity.optInToExtraHours(
      a, employeeId, periodStart, periodEnd, Number(maxAdditionalHours)));
  } catch (e) { next(e); }
});

/* ─── Pay ────────────────────────────────────────────────────────────────── */

workforceRoutes.get('/pay/periods', requireRole(...DIRECTORY_ROLES), (_req, res) =>
  res.json(hrDb.select().from(payPeriods).orderBy(desc(payPeriods.id)).all()));

workforceRoutes.post('/pay/periods/:id/calculate', requireRole('HR_ADMIN', 'SYSTEM_ADMIN'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const out = capacity.calculatePayPeriod(actor(req), id);
    res.json({
      calculated: out.length,
      equity: fairness.payEquityCheck(id),
      note: 'Base pay was computed from contracted hours for every employee. ' +
            'No scheduling restriction reduced anyone’s pay, and payroll holds no field that could reveal one.',
    });
  } catch (e) { next(e); }
});

/* Payroll's view. Deliberately contains no restriction information at all. */
workforceRoutes.get('/pay/periods/:id/lines', requireRole('HR_ADMIN', 'SYSTEM_ADMIN', 'COMPLIANCE_AUDITOR'), (req, res) => {
  res.json(hrDb.select({
    id: payLines.id, employeeId: payLines.employeeId,
    firstName: employees.firstName, lastName: employees.lastName, empCode: employees.empCode,
    contractedHours: payLines.contractedHours, basePay: payLines.basePay,
    voluntaryExtraHours: payLines.voluntaryExtraHours, overtimePay: payLines.overtimePay,
    nightHours: payLines.nightHours, nightPremiumPay: payLines.nightPremiumPay,
    grossPay: payLines.grossPay,
  }).from(payLines)
    .innerJoin(employees, eq(employees.id, payLines.employeeId))
    .where(eq(payLines.payPeriodId, Number(req.params.id))).all());
});

workforceRoutes.get('/pay/periods/:id/equity', requireRole('HR_ADMIN', 'COMPLIANCE_AUDITOR', 'SYSTEM_ADMIN'), (req, res) =>
  res.json(fairness.payEquityCheck(Number(req.params.id))));

/* An employee's own payslip, including the accommodation-protection line
 * that only they ever see. */
workforceRoutes.get('/pay/my/:payPeriodId', (req, res, next) => {
  try {
    const id = req.user!.employeeId;
    if (!id) throw badRequest('No employee linked to this account');
    const view = capacity.selfPayView(id, Number(req.params.payPeriodId));
    if (!view) throw notFound('No pay line for this period yet');
    res.json(view);
  } catch (e) { next(e); }
});

/* ─── Fatigue ────────────────────────────────────────────────────────────── */

workforceRoutes.get('/fatigue/:employeeId', requireRoleOrSelf('employeeId', ...DIRECTORY_ROLES), (req, res) =>
  res.json(fatigue.computeFatigue(Number(req.params.employeeId), String(req.query.asOf ?? dayKey(new Date())))));

workforceRoutes.get('/fatigue', requireRole(...DIRECTORY_ROLES), (req, res) => {
  const asOf = String(req.query.asOf ?? dayKey(new Date()));
  const scores = fatigue.computeAll(asOf);
  const staff = new Map(hrDb.select({
    id: employees.id, firstName: employees.firstName, lastName: employees.lastName,
    empCode: employees.empCode, departmentId: employees.departmentId,
  }).from(employees).all().map((e) => [e.id, e]));
  res.json(scores.map((s) => ({ ...s, employee: staff.get(s.employeeId) ?? null }))
    .sort((a, b) => b.score - a.score));
});

/* ─── Fairness ───────────────────────────────────────────────────────────── */

workforceRoutes.get('/fairness', requireRole(...DIRECTORY_ROLES), (req, res) => {
  const from = String(req.query.from ?? dayKey(addDays(new Date(), -27)));
  const to = String(req.query.to ?? dayKey(new Date()));
  res.json({
    overall: fairness.computeFairness(from, to, 'ALL'),
    byDepartment: fairness.byDepartment(from, to),
    period: { from, to },
    note: 'Aggregate only. Groups below the minimum size are suppressed. ' +
          'This module never reads the constraint store, so it cannot compare staff by health status.',
  });
});

workforceRoutes.post('/fairness/snapshot', requireRole('HR_ADMIN', 'COMPLIANCE_AUDITOR', 'SYSTEM_ADMIN'), (req, res) => {
  const from = String(req.body?.from ?? dayKey(addDays(new Date(), -27)));
  const to = String(req.body?.to ?? dayKey(new Date()));
  res.json(fairness.snapshot(actor(req), from, to));
});

/* ─── Firewall & audit ───────────────────────────────────────────────────── */

workforceRoutes.get('/firewall/constraints', requireRole(...DIRECTORY_ROLES), (_req, res) =>
  res.json(firewall.allActive()));

workforceRoutes.post('/firewall/sync', requireRole('OH_OFFICER', 'HR_ADMIN', 'SYSTEM_ADMIN'), (req, res) => {
  const expired = firewall.expireStale();
  res.json({ ...firewall.syncAll(actor(req)), expiredOnSync: expired });
});

/** The live privacy self-test shown on the dashboard. */
workforceRoutes.get('/firewall/verify', (_req, res) => res.json(firewall.verifyNoLeakage()));

workforceRoutes.get('/audit', requireRole('COMPLIANCE_AUDITOR', 'HR_ADMIN', 'SYSTEM_ADMIN', 'OH_OFFICER'), (req, res) => {
  res.json(audit.list({
    limit: req.query.limit ? Number(req.query.limit) : 200,
    action: req.query.action ? String(req.query.action) : undefined,
    subjectEmployeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
  }));
});

workforceRoutes.get('/audit/verify', requireRole('COMPLIANCE_AUDITOR', 'HR_ADMIN', 'SYSTEM_ADMIN'), (_req, res) =>
  res.json(audit.verifyChain()));

/** Every employee may see who looked at their own record. Transparency is an
 *  ethics requirement, not an administrative feature. */
workforceRoutes.get('/audit/my-record', (req, res) => {
  const id = req.user!.employeeId;
  if (!id) return res.json([]);
  res.json(audit.list({ subjectEmployeeId: id, limit: 100 }));
});

/* ─── Dashboard ──────────────────────────────────────────────────────────── */

workforceRoutes.get('/dashboard', async (req, res) => {
  const u = req.user!;
  const today = dayKey(new Date());
  const from = dayKey(addDays(new Date(), -27));

  const base = {
    role: u.role,
    solver: await solverClient.solverHealth(),
    privacy: firewall.verifyNoLeakage(),
    auditChain: audit.verifyChain(),
  };

  if (u.role === 'EMPLOYEE' && u.employeeId) {
    const f = fatigue.computeFatigue(u.employeeId);
    return res.json({
      ...base,
      myFatigue: f,
      myRestrictions: firewall.constraintsForSelf(u.employeeId),
      myCapacity: capacity.capacityFor(u.employeeId, today, dayKey(addDays(new Date(), 27))),
      upcomingShifts: (await import('../services/scheduling.service.js'))
        .scheduleForEmployee(u.employeeId, today, dayKey(addDays(new Date(), 13))),
    });
  }

  const staff = hrDb.select().from(employees).where(eq(employees.status, 'ACTIVE')).all();
  const scores = fatigue.computeAll(today);
  const latestRoster = hrDb.select().from(rosters).orderBy(desc(rosters.id)).limit(1).all()[0];

  res.json({
    ...base,
    headcount: staff.length,
    departments: hrDb.select().from(departments).all().length,
    activeConstraints: firewall.allActive().filter((c) => c.status === 'ACTIVE').length,
    pendingLeave: hrDb.select().from(leaveRequests).where(eq(leaveRequests.status, 'PENDING')).all().length,
    fatigue: {
      critical: scores.filter((s) => s.band === 'CRITICAL').length,
      high: scores.filter((s) => s.band === 'HIGH').length,
      elevated: scores.filter((s) => s.band === 'ELEVATED').length,
      ok: scores.filter((s) => s.band === 'OK').length,
      topRisk: scores.sort((a, b) => b.score - a.score).slice(0, 5).map((s) => {
        const e = staff.find((x) => x.id === s.employeeId);
        return { employeeId: s.employeeId, name: e ? `${e.firstName} ${e.lastName}` : '—', score: s.score, band: s.band };
      }),
    },
    latestRoster: latestRoster ? {
      id: latestRoster.id, name: latestRoster.name, status: latestRoster.status,
      solverStatus: latestRoster.solverStatus, engine: latestRoster.solverEngine,
      metrics: latestRoster.metrics ? JSON.parse(latestRoster.metrics) : {},
    } : null,
    fairness: fairness.computeFairness(from, today, 'ALL'),
  });
});
