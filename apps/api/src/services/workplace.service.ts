/* ═══════════════════════════════════════════════════════════════════════════
 *  ONBOARDING · DOCUMENTS · OFFBOARDING · HELPDESK
 *
 *  Ordinary HR workflow, built against the boundary already established.
 *  Two places where it would be easy to leak and deliberately does not:
 *
 *   • The document library refuses clinical content. Someone uploading a fit
 *     note "so the manager has it on file" is exactly how a separate health
 *     store gets quietly bypassed, so the upload is blocked and explained.
 *
 *   • Offboarding revokes application access but does NOT touch health
 *     records. Their retention is occupational health's decision under their
 *     own rules, and the case records who is handling it rather than letting
 *     an HR workflow delete clinical data it cannot see.
 * ═════════════════════════════════════════════════════════════════════════ */
import { and, eq, desc } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import {
  onboardingTasks, offboardingCases, documents,
  documentAcknowledgements, tickets, employees, users, notifications,
} from '../db/hr.schema.js';
import { containsClinicalLanguage } from '../lib/constraint-vocabulary.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import * as auth from './auth.service.js';
import * as audit from './audit.service.js';
import { dayKey, addDays } from '../lib/dates.js';

export interface Actor { userId: number; email: string; role: string; employeeId?: number | null }

/* ─── Onboarding ─────────────────────────────────────────────────────────── */

const DEFAULT_TASKS = [
  { title: 'Sign employment contract',               category: 'PAPERWORK',   dayOffset: 0,  mandatory: true,  assigneeRole: 'EMPLOYEE' },
  { title: 'Submit identity and address proof',      category: 'PAPERWORK',   dayOffset: 1,  mandatory: true,  assigneeRole: 'EMPLOYEE' },
  { title: 'Verify professional registration',       category: 'CREDENTIAL',  dayOffset: 2,  mandatory: true,  assigneeRole: 'HR_ADMIN' },
  { title: 'Issue ID badge and system access',       category: 'IT',          dayOffset: 2,  mandatory: true,  assigneeRole: 'SYSTEM_ADMIN' },
  { title: 'Workplace induction and fire safety',       category: 'ORIENTATION', dayOffset: 3,  mandatory: true,  assigneeRole: 'LINE_MANAGER' },
  { title: 'Infection control training',             category: 'TRAINING',    dayOffset: 5,  mandatory: true,  assigneeRole: 'EMPLOYEE' },
  { title: 'Read and acknowledge privacy policy',    category: 'TRAINING',    dayOffset: 5,  mandatory: true,  assigneeRole: 'EMPLOYEE' },
  { title: 'Occupational health baseline appointment', category: 'CREDENTIAL', dayOffset: 7, mandatory: true,  assigneeRole: 'OH_OFFICER' },
  { title: 'Set shift preferences',                  category: 'ORIENTATION', dayOffset: 10, mandatory: false, assigneeRole: 'EMPLOYEE' },
  { title: 'First roster planning conversation',     category: 'ORIENTATION', dayOffset: 10, mandatory: false, assigneeRole: 'ROSTER_PLANNER' },
];

export function startOnboarding(actor: Actor, employeeId: number, startDate?: string) {
  const emp = hrDb.select().from(employees).where(eq(employees.id, employeeId)).all()[0];
  if (!emp) throw notFound('Employee not found');
  const existing = hrDb.select().from(onboardingTasks)
    .where(eq(onboardingTasks.employeeId, employeeId)).all();
  if (existing.length) throw badRequest('Onboarding has already been started for this employee');

  const base = startDate ?? dayKey(new Date());
  hrDb.insert(onboardingTasks).values(DEFAULT_TASKS.map((t) => ({
    employeeId, title: t.title, category: t.category, mandatory: t.mandatory,
    dueDate: dayKey(addDays(base, t.dayOffset)), assigneeRole: t.assigneeRole,
  }))).run();

  hrDb.insert(notifications).values({
    employeeId, kind: 'SHIFT_ASSIGNED',
    title: 'Welcome — your onboarding checklist is ready',
    body: `${DEFAULT_TASKS.length} items to work through. Open Onboarding to start.`,
  }).run();

  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'EMPLOYEE_UPDATED', resourceType: 'Onboarding', subjectEmployeeId: employeeId,
    detail: `Onboarding started with ${DEFAULT_TASKS.length} tasks`,
  });
  return listOnboarding(employeeId);
}

export const listOnboarding = (employeeId: number) =>
  hrDb.select().from(onboardingTasks)
    .where(eq(onboardingTasks.employeeId, employeeId))
    .orderBy(onboardingTasks.dueDate).all();

export function allOnboarding() {
  const rows = hrDb.select({
    employeeId: onboardingTasks.employeeId, status: onboardingTasks.status,
    firstName: employees.firstName, lastName: employees.lastName,
    empCode: employees.empCode, designation: employees.designation,
  }).from(onboardingTasks)
    .innerJoin(employees, eq(employees.id, onboardingTasks.employeeId)).all();

  const by = new Map<number, { name: string; empCode: string; designation: string; total: number; done: number }>();
  for (const r of rows) {
    if (!by.has(r.employeeId))
      by.set(r.employeeId, {
        name: `${r.firstName} ${r.lastName}`, empCode: r.empCode,
        designation: r.designation, total: 0, done: 0,
      });
    const e = by.get(r.employeeId)!;
    e.total++;
    if (r.status === 'DONE' || r.status === 'WAIVED') e.done++;
  }
  return [...by.entries()].map(([employeeId, v]) => ({
    employeeId, ...v, percent: v.total ? Math.round((v.done / v.total) * 100) : 0,
  }));
}

export function updateOnboardingTask(actor: Actor, id: number, status: string, notes?: string) {
  const row = hrDb.select().from(onboardingTasks).where(eq(onboardingTasks.id, id)).all()[0];
  if (!row) throw notFound('Task not found');
  if (!['PENDING', 'IN_PROGRESS', 'DONE', 'WAIVED'].includes(status)) throw badRequest('Unknown status');
  if (status === 'WAIVED' && row.mandatory && !['HR_ADMIN', 'SYSTEM_ADMIN'].includes(actor.role)) {
    throw forbidden('Only HR can waive a mandatory onboarding task.');
  }
  hrDb.update(onboardingTasks).set({
    status, notes: notes ?? row.notes,
    completedAt: status === 'DONE' ? new Date().toISOString() : null,
  }).where(eq(onboardingTasks.id, id)).run();
  return hrDb.select().from(onboardingTasks).where(eq(onboardingTasks.id, id)).all()[0];
}

/* ─── Documents ──────────────────────────────────────────────────────────── */

export function listDocuments(actor: Actor) {
  return hrDb.select().from(documents).orderBy(desc(documents.id)).all()
    .filter((d) => {
      const roles = JSON.parse(d.visibleToRoles || '[]') as string[];
      return roles.length === 0 || roles.includes(actor.role);
    })
    .map((d) => ({
      ...d,
      visibleToRoles: JSON.parse(d.visibleToRoles || '[]'),
      acknowledged: actor.employeeId
        ? hrDb.select().from(documentAcknowledgements).where(and(
            eq(documentAcknowledgements.documentId, d.id),
            eq(documentAcknowledgements.employeeId, actor.employeeId),
            eq(documentAcknowledgements.version, d.version),
          )).all().length > 0
        : false,
      acknowledgementCount: hrDb.select().from(documentAcknowledgements)
        .where(and(eq(documentAcknowledgements.documentId, d.id),
                   eq(documentAcknowledgements.version, d.version))).all().length,
    }));
}

export function createDocument(actor: Actor, input: {
  title: string; category: string; body?: string; version?: string;
  requiresAcknowledgement?: boolean; visibleToRoles?: string[];
}) {
  if (!input.title?.trim()) throw badRequest('A document needs a title');

  /* The library is for operational documents. A fit note or an assessment
   * belongs in the health store, where it is access-controlled and logged.
   * Allowing it here would route clinical content straight into a file that
   * managers can open. */
  const token = containsClinicalLanguage(`${input.title} ${input.body ?? ''}`);
  if (token) {
    audit.record({
      actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
      action: 'HEALTH_ACCESS_DENIED', resourceType: 'Document', outcome: 'DENIED',
      detail: `Upload blocked: clinical language ("${token}") in a general document`,
    });
    throw badRequest(
      `This document appears to contain clinical content (matched "${token}"). ` +
      `Medical records and fitness certificates go to occupational health, not the ` +
      `general document library, where managers could open them. ` +
      `If this is an operational document, reword it and try again.`);
  }

  const row = hrDb.insert(documents).values({
    title: input.title, category: input.category ?? 'POLICY',
    body: input.body ?? null, version: input.version ?? '1.0',
    requiresAcknowledgement: input.requiresAcknowledgement ?? false,
    visibleToRoles: JSON.stringify(input.visibleToRoles ?? []),
    uploadedById: actor.userId,
  }).returning().all()[0];

  if (row.requiresAcknowledgement) {
    for (const e of hrDb.select({ id: employees.id }).from(employees)
      .where(eq(employees.status, 'ACTIVE')).all()) {
      hrDb.insert(notifications).values({
        employeeId: e.id, kind: 'CREDENTIAL_EXPIRING',
        title: `Please read: ${row.title}`,
        body: 'A document needs your acknowledgement. Open Documents to read it.',
      }).run();
    }
  }

  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'EMPLOYEE_UPDATED', resourceType: 'Document', resourceId: String(row.id),
    detail: `Published "${row.title}" v${row.version}`,
  });
  return row;
}

export function acknowledgeDocument(actor: Actor, documentId: number) {
  if (!actor.employeeId) throw badRequest('No employee is linked to this account');
  const doc = hrDb.select().from(documents).where(eq(documents.id, documentId)).all()[0];
  if (!doc) throw notFound('Document not found');
  hrDb.insert(documentAcknowledgements).values({
    documentId, employeeId: actor.employeeId, version: doc.version,
  }).onConflictDoNothing().run();
  return { ok: true, acknowledgedAt: new Date().toISOString(), version: doc.version };
}

export function acknowledgementReport(documentId: number) {
  const doc = hrDb.select().from(documents).where(eq(documents.id, documentId)).all()[0];
  if (!doc) throw notFound('Document not found');
  const done = new Set(hrDb.select().from(documentAcknowledgements).where(and(
    eq(documentAcknowledgements.documentId, documentId),
    eq(documentAcknowledgements.version, doc.version),
  )).all().map((a) => a.employeeId));
  const staff = hrDb.select().from(employees).where(eq(employees.status, 'ACTIVE')).all();
  return {
    document: doc.title, version: doc.version,
    acknowledged: staff.filter((e) => done.has(e.id)).map((e) => ({
      id: e.id, name: `${e.firstName} ${e.lastName}`, empCode: e.empCode })),
    outstanding: staff.filter((e) => !done.has(e.id)).map((e) => ({
      id: e.id, name: `${e.firstName} ${e.lastName}`, empCode: e.empCode })),
  };
}

/* ─── Offboarding ────────────────────────────────────────────────────────── */

const EXIT_CHECKLIST = [
  { key: 'handover',    label: 'Clinical handover completed' },
  { key: 'equipment',   label: 'ID badge, keys and equipment returned' },
  { key: 'access',      label: 'System access revoked' },
  { key: 'roster',      label: 'Removed from future rosters' },
  { key: 'final_pay',   label: 'Final pay and leave encashment calculated' },
  { key: 'exit_talk',   label: 'Exit conversation held' },
  { key: 'oh_referral', label: 'Occupational health notified to apply their own retention rule' },
];

export function startOffboarding(actor: Actor, input: {
  employeeId: number; lastWorkingDay: string; reason: string;
}) {
  const emp = hrDb.select().from(employees).where(eq(employees.id, input.employeeId)).all()[0];
  if (!emp) throw notFound('Employee not found');
  const row = hrDb.insert(offboardingCases).values({
    employeeId: input.employeeId, lastWorkingDay: input.lastWorkingDay,
    reason: input.reason, checklist: JSON.stringify(EXIT_CHECKLIST.map((c) => ({ ...c, done: false }))),
  }).returning().all()[0];
  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'EMPLOYEE_UPDATED', resourceType: 'Offboarding', resourceId: String(row.id),
    subjectEmployeeId: input.employeeId,
    detail: `Exit case opened, last working day ${input.lastWorkingDay}`,
  });
  return hydrateCase(row);
}

const hydrateCase = (c: any) => ({ ...c, checklist: JSON.parse(c.checklist || '[]') });

export const listOffboarding = () =>
  hrDb.select({
    id: offboardingCases.id, employeeId: offboardingCases.employeeId,
    lastWorkingDay: offboardingCases.lastWorkingDay, reason: offboardingCases.reason,
    status: offboardingCases.status, checklist: offboardingCases.checklist,
    accessRevokedAt: offboardingCases.accessRevokedAt,
    healthRecordsHandledBy: offboardingCases.healthRecordsHandledBy,
    firstName: employees.firstName, lastName: employees.lastName, empCode: employees.empCode,
  }).from(offboardingCases)
    .innerJoin(employees, eq(employees.id, offboardingCases.employeeId))
    .orderBy(desc(offboardingCases.id)).all().map(hydrateCase);

export function updateOffboarding(actor: Actor, id: number, key: string, done: boolean) {
  const row = hrDb.select().from(offboardingCases).where(eq(offboardingCases.id, id)).all()[0];
  if (!row) throw notFound('Exit case not found');
  const checklist = JSON.parse(row.checklist || '[]') as Array<{ key: string; label: string; done: boolean }>;
  const item = checklist.find((c) => c.key === key);
  if (!item) throw badRequest('Unknown checklist item');
  item.done = done;

  const patch: Record<string, unknown> = { checklist: JSON.stringify(checklist) };

  /* Revoking access is a real action, not a tick box. */
  if (key === 'access' && done && !row.accessRevokedAt) {
    const user = hrDb.select().from(users).where(eq(users.employeeId, row.employeeId)).all()[0];
    if (user) {
      hrDb.update(users).set({ isActive: false }).where(eq(users.id, user.id)).run();
      auth.revokeAllForUser(user.id);
    }
    patch.accessRevokedAt = new Date().toISOString();
    audit.record({
      actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
      action: 'EMPLOYEE_UPDATED', resourceType: 'User', subjectEmployeeId: row.employeeId,
      detail: 'Account deactivated and all sessions revoked as part of offboarding',
    });
  }

  /* Health records are NOT deleted here. Their retention is occupational
   * health's call under their own rules; HR records who is handling it. */
  if (key === 'oh_referral' && done) {
    patch.healthRecordsHandledBy = 'Referred to occupational health — retention applied under their own policy';
  }

  const allDone = checklist.every((c) => c.done);
  if (allDone) {
    patch.status = 'COMPLETED';
    patch.completedAt = new Date().toISOString();
    hrDb.update(employees).set({ status: 'EXITED' }).where(eq(employees.id, row.employeeId)).run();
  } else {
    patch.status = 'IN_PROGRESS';
  }

  hrDb.update(offboardingCases).set(patch).where(eq(offboardingCases.id, id)).run();
  return hydrateCase(hrDb.select().from(offboardingCases).where(eq(offboardingCases.id, id)).all()[0]);
}

/* ─── Helpdesk ───────────────────────────────────────────────────────────── */

export function createTicket(actor: Actor, input: {
  category: string; subject: string; body: string; priority?: string;
}) {
  if (!actor.employeeId) throw badRequest('No employee is linked to this account');
  if (!input.subject?.trim() || !input.body?.trim()) throw badRequest('A ticket needs a subject and a description');
  const n = hrDb.select().from(tickets).all().length + 1;
  const row = hrDb.insert(tickets).values({
    reference: `TKT-${String(n).padStart(4, '0')}`,
    raisedById: actor.employeeId, category: input.category ?? 'OTHER',
    subject: input.subject, body: input.body, priority: input.priority ?? 'NORMAL',
  }).returning().all()[0];
  return row;
}

export function listTickets(actor: Actor) {
  const canSeeAll = ['HR_ADMIN', 'SYSTEM_ADMIN', 'LINE_MANAGER'].includes(actor.role);
  const rows = hrDb.select({
    id: tickets.id, reference: tickets.reference, category: tickets.category,
    subject: tickets.subject, body: tickets.body, priority: tickets.priority,
    status: tickets.status, resolution: tickets.resolution, createdAt: tickets.createdAt,
    raisedById: tickets.raisedById,
    firstName: employees.firstName, lastName: employees.lastName, empCode: employees.empCode,
  }).from(tickets)
    .innerJoin(employees, eq(employees.id, tickets.raisedById))
    .orderBy(desc(tickets.id)).all();
  return canSeeAll ? rows : rows.filter((r) => r.raisedById === actor.employeeId);
}

export function updateTicket(actor: Actor, id: number, patch: {
  status?: string; resolution?: string; assignedToId?: number;
}) {
  const row = hrDb.select().from(tickets).where(eq(tickets.id, id)).all()[0];
  if (!row) throw notFound('Ticket not found');
  if (!['HR_ADMIN', 'SYSTEM_ADMIN', 'LINE_MANAGER'].includes(actor.role)) {
    throw forbidden('Only HR or a manager can update a ticket.');
  }
  hrDb.update(tickets).set({
    status: patch.status ?? row.status,
    resolution: patch.resolution ?? row.resolution,
    assignedToId: patch.assignedToId ?? row.assignedToId,
    resolvedAt: patch.status === 'RESOLVED' ? new Date().toISOString() : row.resolvedAt,
  }).where(eq(tickets.id, id)).run();

  if (patch.status === 'RESOLVED') {
    hrDb.insert(notifications).values({
      employeeId: row.raisedById, kind: 'LEAVE_DECIDED',
      title: `${row.reference} resolved`,
      body: patch.resolution ?? 'Your request has been resolved.',
    }).run();
  }
  return hrDb.select().from(tickets).where(eq(tickets.id, id)).all()[0];
}
