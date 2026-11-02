import { Router } from 'express';
import { and, eq, desc, isNull } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import {
  employees, departments, facilities, qualifications, leaveRequests,
  leaveBalances, attendance, notifications, policies,
} from '../db/hr.schema.js';
import { authenticate, requireRole, requireRoleOrSelf, actor } from '../middleware/auth.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { DIRECTORY_ROLES } from '../lib/roles.js';
import * as firewall from '../services/firewall.service.js';
import * as audit from '../services/audit.service.js';

export const hrRoutes = Router();
hrRoutes.use(authenticate);

/* ─── Directory ──────────────────────────────────────────────────────────── */

hrRoutes.get('/employees', requireRole(...DIRECTORY_ROLES), (_req, res) => {
  const rows = hrDb.select({
    id: employees.id, empCode: employees.empCode, firstName: employees.firstName,
    lastName: employees.lastName, email: employees.email, designation: employees.designation,
    employmentType: employees.employmentType, contractedFte: employees.contractedFte,
    contractedHoursPerWeek: employees.contractedHoursPerWeek, status: employees.status,
    departmentId: employees.departmentId, departmentName: departments.name,
    facilityName: facilities.name,
  }).from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .innerJoin(facilities, eq(facilities.id, employees.facilityId))
    .all();
  // Attach only the neutral constraint labels — never a reason.
  res.json(rows.map((r) => ({ ...r, restrictions: firewall.constraintsForManager(r.id) })));
});

hrRoutes.get('/employees/:id', requireRoleOrSelf('id', ...DIRECTORY_ROLES), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const e = hrDb.select().from(employees).where(eq(employees.id, id)).all()[0];
    if (!e) throw notFound('Employee not found');
    const dept = hrDb.select().from(departments).where(eq(departments.id, e.departmentId)).all()[0];
    const fac = hrDb.select().from(facilities).where(eq(facilities.id, e.facilityId)).all()[0];
    res.json({
      ...e,
      departmentName: dept?.name, facilityName: fac?.name,
      qualifications: hrDb.select().from(qualifications).where(eq(qualifications.employeeId, id)).all(),
      /* Managers and the employee themselves see the SAME thing here: a
       * neutral label and a date window. No reason is available to anyone
       * outside occupational health. */
      restrictions: firewall.constraintsForManager(id),
    });
  } catch (e) { next(e); }
});

hrRoutes.patch('/employees/:id', requireRole('HR_ADMIN', 'SYSTEM_ADMIN'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const allowed = ['firstName', 'lastName', 'phone', 'designation', 'employmentType',
      'contractedFte', 'contractedHoursPerWeek', 'baseHourlyRate', 'status'] as const;
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in (req.body ?? {})) patch[k] = req.body[k];
    if (!Object.keys(patch).length) throw badRequest('No updatable fields supplied');
    hrDb.update(employees).set(patch).where(eq(employees.id, id)).run();
    audit.record({ ...actor(req), action: 'EMPLOYEE_UPDATED', resourceType: 'Employee',
      resourceId: String(id), subjectEmployeeId: id, detail: Object.keys(patch).join(', ') });
    res.json(hrDb.select().from(employees).where(eq(employees.id, id)).all()[0]);
  } catch (e) { next(e); }
});

hrRoutes.get('/departments', (_req, res) => {
  res.json(hrDb.select({
    id: departments.id, code: departments.code, name: departments.name,
    facilityId: departments.facilityId, facilityName: facilities.name,
  }).from(departments).innerJoin(facilities, eq(facilities.id, departments.facilityId)).all());
});

hrRoutes.get('/facilities', (_req, res) => res.json(hrDb.select().from(facilities).all()));

/* ─── Credentials ────────────────────────────────────────────────────────── */

hrRoutes.get('/qualifications/expiring', requireRole(...DIRECTORY_ROLES), (_req, res) => {
  const horizon = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  res.json(hrDb.select({
    id: qualifications.id, type: qualifications.type, expiresOn: qualifications.expiresOn,
    registrationNo: qualifications.registrationNo, verified: qualifications.verified,
    employeeId: employees.id, firstName: employees.firstName, lastName: employees.lastName,
    empCode: employees.empCode,
  }).from(qualifications)
    .innerJoin(employees, eq(employees.id, qualifications.employeeId))
    .all()
    .filter((q) => q.expiresOn && q.expiresOn <= horizon)
    .sort((a, b) => (a.expiresOn ?? '').localeCompare(b.expiresOn ?? '')));
});

/* ─── Leave ──────────────────────────────────────────────────────────────── */

hrRoutes.get('/leave', (req, res) => {
  const u = req.user!;
  const mine = !DIRECTORY_ROLES.includes(u.role);
  const rows = hrDb.select({
    id: leaveRequests.id, leaveType: leaveRequests.leaveType, startDate: leaveRequests.startDate,
    endDate: leaveRequests.endDate, days: leaveRequests.days, reason: leaveRequests.reason,
    status: leaveRequests.status, createdAt: leaveRequests.createdAt,
    employeeId: employees.id, firstName: employees.firstName, lastName: employees.lastName,
    empCode: employees.empCode,
  }).from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .orderBy(desc(leaveRequests.id)).all();
  res.json(mine ? rows.filter((r) => r.employeeId === u.employeeId) : rows);
});

hrRoutes.post('/leave', (req, res, next) => {
  try {
    const u = req.user!;
    const { leaveType, startDate, endDate, reason } = req.body ?? {};
    if (!leaveType || !startDate || !endDate) throw badRequest('leaveType, startDate and endDate are required');
    const employeeId = req.body.employeeId ?? u.employeeId;
    if (!employeeId) throw badRequest('No employee is linked to this account');
    if (employeeId !== u.employeeId && !['HR_ADMIN', 'LINE_MANAGER', 'SYSTEM_ADMIN'].includes(u.role)) {
      throw forbidden('You may only request leave for yourself');
    }
    const days = Math.max(1,
      Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000) + 1);
    const row = hrDb.insert(leaveRequests).values({
      employeeId, leaveType, startDate, endDate, days, reason: reason ?? null,
    }).returning().all()[0];
    res.status(201).json(row);
  } catch (e) { next(e); }
});

hrRoutes.post('/leave/:id/decide', requireRole('LINE_MANAGER', 'HR_ADMIN', 'SYSTEM_ADMIN'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { decision } = req.body ?? {};
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw badRequest('decision must be APPROVED or REJECTED');
    const row = hrDb.select().from(leaveRequests).where(eq(leaveRequests.id, id)).all()[0];
    if (!row) throw notFound('Leave request not found');

    hrDb.update(leaveRequests).set({
      status: decision, decidedById: req.user!.userId, decidedAt: new Date().toISOString(),
    }).where(eq(leaveRequests.id, id)).run();

    if (decision === 'APPROVED') {
      const bal = hrDb.select().from(leaveBalances).where(and(
        eq(leaveBalances.employeeId, row.employeeId),
        eq(leaveBalances.leaveType, row.leaveType),
        eq(leaveBalances.year, new Date(row.startDate).getUTCFullYear()),
      )).all()[0];
      if (bal) hrDb.update(leaveBalances).set({ taken: bal.taken + row.days })
        .where(eq(leaveBalances.id, bal.id)).run();
    }

    hrDb.insert(notifications).values({
      employeeId: row.employeeId, kind: 'LEAVE_DECIDED',
      title: `Leave ${decision.toLowerCase()}`,
      body: `Your ${row.leaveType.toLowerCase()} leave for ${row.startDate} to ${row.endDate} was ${decision.toLowerCase()}.`,
    }).run();

    audit.record({ ...actor(req), action: 'LEAVE_DECIDED', resourceType: 'LeaveRequest',
      resourceId: String(id), subjectEmployeeId: row.employeeId, detail: decision });
    res.json({ ...row, status: decision });
  } catch (e) { next(e); }
});

hrRoutes.get('/leave/balances/:employeeId', requireRoleOrSelf('employeeId', ...DIRECTORY_ROLES), (req, res) => {
  res.json(hrDb.select().from(leaveBalances)
    .where(eq(leaveBalances.employeeId, Number(req.params.employeeId))).all());
});

/* ─── Attendance ─────────────────────────────────────────────────────────── */

hrRoutes.get('/attendance/:employeeId', requireRoleOrSelf('employeeId', ...DIRECTORY_ROLES), (req, res) => {
  res.json(hrDb.select().from(attendance)
    .where(eq(attendance.employeeId, Number(req.params.employeeId)))
    .orderBy(desc(attendance.date)).limit(60).all());
});

/* ─── Notifications & policies ───────────────────────────────────────────── */

hrRoutes.get('/notifications', (req, res) => {
  const id = req.user!.employeeId;
  if (!id) return res.json([]);
  res.json(hrDb.select().from(notifications)
    .where(eq(notifications.employeeId, id)).orderBy(desc(notifications.id)).limit(50).all());
});

hrRoutes.post('/notifications/:id/read', (req, res) => {
  hrDb.update(notifications).set({ readAt: new Date().toISOString() })
    .where(and(eq(notifications.id, Number(req.params.id)), isNull(notifications.readAt))).run();
  res.json({ ok: true });
});

hrRoutes.get('/policies', (_req, res) => res.json(hrDb.select().from(policies).all()));
