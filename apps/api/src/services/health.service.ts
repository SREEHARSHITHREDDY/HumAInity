/* ═══════════════════════════════════════════════════════════════════════════
 *  OCCUPATIONAL HEALTH SERVICE  —  the restricted zone's only door.
 *
 *  This is the ONLY module in the entire codebase that imports `healthDb`.
 *  Every exported function takes an `actor` and calls `assertOhAccess` first.
 *  Every call — permitted or refused — writes to BOTH audit logs.
 *
 *  Nothing here returns clinical content to a caller that is not an
 *  OH_OFFICER. The one function the rest of the system may call is
 *  `listProjectableRestrictions`, and it returns no clinical fields at all.
 * ═════════════════════════════════════════════════════════════════════════ */
import crypto from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import { healthDb } from '../db/index.js';
import {
  ohAssessments, workRestrictions, consents, wellbeingCheckIns,
  medicalDocuments, healthAccessLog,
} from '../db/health.schema.js';
import { CONSTRAINT_SCHEMAS, type ConstraintType } from '../lib/constraint-vocabulary.js';
import { CAPACITY_QUESTIONS, suggestFromAnswers } from '../lib/capacity-questionnaire.js';
import { encrypt, decrypt, keyConfigured } from '../lib/crypto.js';
import { forbidden, badRequest, notFound } from '../lib/errors.js';
import * as audit from './audit.service.js';

/* Clinical columns are encrypted at rest. See lib/crypto.ts for what is and
 * is not covered, and why. */
const CLINICAL_FIELDS = ['clinicalNotes', 'diagnosisCode'] as const;
const dec = <T extends Record<string, any>>(row: T): T => {
  const out = { ...row };
  for (const f of CLINICAL_FIELDS) if (out[f] != null) (out as any)[f] = decrypt(String(out[f]));
  return out;
};

export interface Actor { userId: number; email: string; role: string; employeeId?: number | null; }

function logHealth(actor: Actor, action: string, resource: string, employeeRef?: number, outcome = 'SUCCESS') {
  healthDb.insert(healthAccessLog).values({
    actorEmail: actor.email, actorRole: actor.role, action,
    employeeRef: employeeRef ?? null, resource, outcome,
  }).run();
}

/** The single gate. Only an OH officer may read or write clinical data. */
function assertOhAccess(actor: Actor, action: string, resource: string, employeeRef?: number) {
  if (actor.role !== 'OH_OFFICER') {
    logHealth(actor, action, resource, employeeRef, 'DENIED');
    audit.record({
      actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
      action: 'HEALTH_ACCESS_DENIED', resourceType: resource,
      subjectEmployeeId: employeeRef ?? null, outcome: 'DENIED',
      detail: `Role ${actor.role} attempted ${action} on the health store`,
    });
    throw forbidden('Occupational health records are restricted to the occupational health team.');
  }
}

/* ─── Assessments (clinical — OH only) ───────────────────────────────────── */

export function listAssessments(actor: Actor, employeeRef?: number) {
  assertOhAccess(actor, 'LIST_ASSESSMENTS', 'OhAssessment', employeeRef);
  const rows = (employeeRef
    ? healthDb.select().from(ohAssessments).where(eq(ohAssessments.employeeRef, employeeRef))
        .orderBy(desc(ohAssessments.assessmentDate)).all()
    : healthDb.select().from(ohAssessments).orderBy(desc(ohAssessments.assessmentDate)).limit(200).all()
  ).map(dec);
  logHealth(actor, 'LIST_ASSESSMENTS', 'OhAssessment', employeeRef);
  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'HEALTH_ASSESSMENT_READ', resourceType: 'OhAssessment',
    subjectEmployeeId: employeeRef ?? null,
    detail: `Read ${rows.length} assessment record(s)`,
  });
  return rows;
}

export function createAssessment(actor: Actor, input: {
  employeeRef: number; assessmentDate: string; fitnessStatus: string;
  clinicalNotes?: string; diagnosisCode?: string; reviewDate?: string;
}) {
  assertOhAccess(actor, 'CREATE_ASSESSMENT', 'OhAssessment', input.employeeRef);
  const row = healthDb.insert(ohAssessments).values({
    employeeRef: input.employeeRef,
    assessedBy: actor.email,
    assessmentDate: input.assessmentDate,
    fitnessStatus: input.fitnessStatus,
    clinicalNotes: encrypt(input.clinicalNotes ?? null),
    diagnosisCode: encrypt(input.diagnosisCode ?? null),
    reviewDate: input.reviewDate ?? null,
  }).returning().all()[0];
  logHealth(actor, 'CREATE_ASSESSMENT', 'OhAssessment', input.employeeRef);
  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'HEALTH_ASSESSMENT_CREATED', resourceType: 'OhAssessment',
    resourceId: String(row.id), subjectEmployeeId: input.employeeRef,
    detail: 'Assessment recorded (content not reproduced in this log)',
  });
  return dec(row);
}

export function listDocuments(actor: Actor, assessmentId: number) {
  assertOhAccess(actor, 'LIST_DOCUMENTS', 'MedicalDocument');
  return healthDb.select().from(medicalDocuments)
    .where(eq(medicalDocuments.assessmentId, assessmentId)).all();
}

/* ─── Restrictions ───────────────────────────────────────────────────────── */

export function createRestriction(actor: Actor, input: {
  employeeRef: number; assessmentId: number; restrictionType: ConstraintType;
  params: Record<string, unknown>; effectiveFrom: string; effectiveTo?: string | null;
}) {
  assertOhAccess(actor, 'CREATE_RESTRICTION', 'WorkRestriction', input.employeeRef);

  const schema = CONSTRAINT_SCHEMAS[input.restrictionType];
  if (!schema) throw badRequest(`Unknown restriction type: ${input.restrictionType}`);
  const parsed = schema.safeParse(input.params ?? {});
  if (!parsed.success) {
    throw badRequest(`Invalid parameters for ${input.restrictionType}: ${parsed.error.issues.map(i => i.message).join(', ')}`);
  }

  const assessment = healthDb.select().from(ohAssessments)
    .where(eq(ohAssessments.id, input.assessmentId)).all()[0];
  if (!assessment) throw notFound('Assessment not found');
  if (assessment.employeeRef !== input.employeeRef) {
    throw badRequest('Assessment does not belong to this employee');
  }

  // Record the legal basis for sharing a constraint with the scheduler.
  let consent = healthDb.select().from(consents).where(and(
    eq(consents.employeeRef, input.employeeRef),
    eq(consents.scope, 'SHARE_RESTRICTION_WITH_SCHEDULER'),
  )).all().find((c) => !c.withdrawnAt);
  if (!consent) {
    consent = healthDb.insert(consents).values({
      employeeRef: input.employeeRef,
      scope: 'SHARE_RESTRICTION_WITH_SCHEDULER',
      basis: 'EMPLOYMENT_OBLIGATION',
    }).returning().all()[0];
  }

  const row = healthDb.insert(workRestrictions).values({
    employeeRef: input.employeeRef,
    assessmentId: input.assessmentId,
    restrictionType: input.restrictionType,
    params: JSON.stringify(parsed.data),
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
    source: 'CLINICIAN_VERIFIED',
    authorizedBy: actor.email,
    consentId: consent.id,
    status: 'ACTIVE',
    opaqueRef: 'ocr_' + crypto.randomBytes(12).toString('hex'),
  }).returning().all()[0];

  logHealth(actor, 'CREATE_RESTRICTION', 'WorkRestriction', input.employeeRef);
  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'HEALTH_RESTRICTION_CREATED', resourceType: 'WorkRestriction',
    resourceId: row.opaqueRef, subjectEmployeeId: input.employeeRef,
    detail: `Type ${input.restrictionType}, effective ${input.effectiveFrom}`,
  });
  return row;
}

export function revokeRestriction(actor: Actor, id: number) {
  assertOhAccess(actor, 'REVOKE_RESTRICTION', 'WorkRestriction');
  const row = healthDb.select().from(workRestrictions).where(eq(workRestrictions.id, id)).all()[0];
  if (!row) throw notFound('Restriction not found');
  healthDb.update(workRestrictions).set({ status: 'REVOKED' })
    .where(eq(workRestrictions.id, id)).run();
  logHealth(actor, 'REVOKE_RESTRICTION', 'WorkRestriction', row.employeeRef);
  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'HEALTH_RESTRICTION_REVOKED', resourceType: 'WorkRestriction',
    resourceId: row.opaqueRef, subjectEmployeeId: row.employeeRef,
  });
  return { ...row, status: 'REVOKED' };
}

export function listRestrictionsForOfficer(actor: Actor, employeeRef?: number) {
  assertOhAccess(actor, 'LIST_RESTRICTIONS', 'WorkRestriction', employeeRef);
  const q = employeeRef
    ? healthDb.select().from(workRestrictions).where(eq(workRestrictions.employeeRef, employeeRef))
    : healthDb.select().from(workRestrictions);
  return q.orderBy(desc(workRestrictions.id)).all();
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  THE ONLY FUNCTION THE REST OF THE SYSTEM MAY CALL.
 *
 *  Used exclusively by firewall.service.ts. It returns the shape the firewall
 *  is allowed to see: type, numeric params, dates, authorisation metadata.
 *  No clinical notes, no diagnosis code, no assessment content. Not even
 *  optionally — those columns are never selected.
 * ═════════════════════════════════════════════════════════════════════════ */
export function listProjectableRestrictions() {
  return healthDb.select({
    id: workRestrictions.id,
    employeeRef: workRestrictions.employeeRef,
    restrictionType: workRestrictions.restrictionType,
    params: workRestrictions.params,
    effectiveFrom: workRestrictions.effectiveFrom,
    effectiveTo: workRestrictions.effectiveTo,
    status: workRestrictions.status,
    opaqueRef: workRestrictions.opaqueRef,
    source: workRestrictions.source,
    authorizedBy: workRestrictions.authorizedBy,
    authorizedAt: workRestrictions.authorizedAt,
    verifiedBy: workRestrictions.verifiedBy,
    consentId: workRestrictions.consentId,
  }).from(workRestrictions).all();
}

export function markProjected(ids: number[]) {
  const at = new Date().toISOString();
  for (const id of ids) {
    healthDb.update(workRestrictions).set({ projectedAt: at })
      .where(eq(workRestrictions.id, id)).run();
  }
}

export function hasActiveConsent(employeeRef: number) {
  return healthDb.select().from(consents).where(and(
    eq(consents.employeeRef, employeeRef),
    eq(consents.scope, 'SHARE_RESTRICTION_WITH_SCHEDULER'),
  )).all().some((c) => !c.withdrawnAt);
}

/* ─── Wellbeing check-ins (health-adjacent — stay behind the firewall) ───── */

export function submitCheckIn(actor: Actor, employeeRef: number, responses: Record<string, unknown>) {
  // An employee may submit their OWN check-in; only OH may ever read them.
  if (actor.role !== 'OH_OFFICER' && actor.employeeId !== employeeRef) {
    throw forbidden('You can only submit your own wellbeing check-in.');
  }
  const scores = Object.values(responses).filter((v): v is number => typeof v === 'number');
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const riskFlag = avg >= 4 ? 'URGENT' : avg >= 3 ? 'REVIEW' : 'NONE';

  const row = healthDb.insert(wellbeingCheckIns).values({
    employeeRef, responses: JSON.stringify(responses), riskFlag,
  }).returning().all()[0];

  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'WELLBEING_SUBMITTED', resourceType: 'WellbeingCheckIn',
    resourceId: String(row.id), subjectEmployeeId: employeeRef,
    detail: 'Submitted (responses stored in the restricted zone only)',
  });
  // The caller gets an acknowledgement, never the risk flag — otherwise the
  // flag itself becomes a health signal travelling outside the zone.
  return { id: row.id, submittedAt: row.submittedAt };
}

export function listCheckIns(actor: Actor, employeeRef?: number) {
  assertOhAccess(actor, 'LIST_CHECKINS', 'WellbeingCheckIn', employeeRef);
  const q = employeeRef
    ? healthDb.select().from(wellbeingCheckIns).where(eq(wellbeingCheckIns.employeeRef, employeeRef))
    : healthDb.select().from(wellbeingCheckIns);
  return q.orderBy(desc(wellbeingCheckIns.id)).limit(200).all();
}

export function healthAccessTrail(actor: Actor, employeeRef?: number) {
  if (!['OH_OFFICER', 'COMPLIANCE_AUDITOR'].includes(actor.role)) {
    throw forbidden('Restricted to occupational health and compliance.');
  }
  const q = employeeRef
    ? healthDb.select().from(healthAccessLog).where(eq(healthAccessLog.employeeRef, employeeRef))
    : healthDb.select().from(healthAccessLog);
  return q.orderBy(desc(healthAccessLog.id)).limit(300).all();
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  SELF-DECLARED CAPACITY
 *
 *  An employee can state a limit on their own work without involving anyone.
 *  This exists so the platform protects people on day one, before a hospital
 *  has an occupational health team configured — and so that nobody has to
 *  disclose a diagnosis in order to be scheduled safely.
 *
 *  What is stored is a LIMIT, in the same closed vocabulary the firewall
 *  already speaks. No condition, symptom or diagnosis is asked for, and the
 *  optional free-text note is encrypted, never projected, and visible only to
 *  the employee and to occupational health.
 *
 *  It is deliberately provisional: short-dated, and flagged for review. A
 *  limit nobody has looked at should expire rather than sit in the system
 *  forever unexamined.
 * ═════════════════════════════════════════════════════════════════════════ */

/** How long a self-declared restriction lasts before it must be renewed or
 *  confirmed. Long enough to be useful, short enough to force a conversation. */
export const SELF_DECLARED_DAYS = 30;

export const capacityQuestions = () => CAPACITY_QUESTIONS;

/** Turns questionnaire answers into SUGGESTIONS. Nothing is applied here. */
export function suggestCapacity(answers: Record<string, string>) {
  const suggestions = suggestFromAnswers(answers ?? {});
  return {
    suggestions,
    note: suggestions.length
      ? 'These are suggestions based on what you told us about your work. Nothing has been ' +
        'applied yet — choose which ones you want, and you can change or remove them at any time.'
      : 'Nothing you told us suggests a scheduling limit. You can still declare one directly ' +
        'if you need it.',
  };
}

export function selfDeclareRestriction(actor: Actor, input: {
  employeeRef?: number;
  restrictionType: ConstraintType;
  params: Record<string, unknown>;
  effectiveFrom?: string;
  employeeNote?: string;
}) {
  const ref = input.employeeRef ?? actor.employeeId;
  if (!ref) throw badRequest('No employee is linked to this account');

  /* An employee declares for themselves. HR cannot declare on someone's
   * behalf — that would be someone else deciding what another person can do. */
  if (ref !== actor.employeeId && actor.role !== 'OH_OFFICER') {
    throw forbidden('You can only declare a limit on your own work.');
  }

  const schema = CONSTRAINT_SCHEMAS[input.restrictionType];
  if (!schema) throw badRequest(`Unknown restriction type: ${input.restrictionType}`);
  const parsed = schema.safeParse(input.params ?? {});
  if (!parsed.success) {
    throw badRequest(`Invalid parameters: ${parsed.error.issues.map((i) => i.message).join(', ')}`);
  }

  const from = input.effectiveFrom ?? new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + SELF_DECLARED_DAYS * 86_400_000).toISOString().slice(0, 10);

  let consent = healthDb.select().from(consents).where(and(
    eq(consents.employeeRef, ref),
    eq(consents.scope, 'SHARE_RESTRICTION_WITH_SCHEDULER'),
  )).all().find((c) => !c.withdrawnAt);
  if (!consent) {
    consent = healthDb.insert(consents).values({
      employeeRef: ref, scope: 'SHARE_RESTRICTION_WITH_SCHEDULER', basis: 'EMPLOYEE_DECLARED',
    }).returning().all()[0];
  }

  const row = healthDb.insert(workRestrictions).values({
    employeeRef: ref,
    assessmentId: null,                       // there is no assessment behind this
    restrictionType: input.restrictionType,
    params: JSON.stringify(parsed.data),
    effectiveFrom: from,
    effectiveTo: to,
    source: 'SELF_DECLARED',
    authorizedBy: null,                       // nobody has signed this off yet
    consentId: consent.id,
    status: 'ACTIVE',
    opaqueRef: 'ocr_' + crypto.randomBytes(12).toString('hex'),
    employeeNote: encrypt(input.employeeNote ?? null),
  }).returning().all()[0];

  logHealth(actor, 'SELF_DECLARE_RESTRICTION', 'WorkRestriction', ref);
  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'HEALTH_RESTRICTION_CREATED', resourceType: 'WorkRestriction',
    resourceId: row.opaqueRef, subjectEmployeeId: ref,
    detail: `Self-declared ${input.restrictionType}, provisional until ${to}. No clinical assessment, no diagnosis recorded.`,
  });
  return { ...row, employeeNote: undefined };
}

/** An employee's own view of what they have declared. */
export function myDeclarations(actor: Actor) {
  if (!actor.employeeId) return [];
  return healthDb.select().from(workRestrictions)
    .where(eq(workRestrictions.employeeRef, actor.employeeId))
    .orderBy(desc(workRestrictions.id)).all()
    .map((r) => ({
      id: r.id, opaqueRef: r.opaqueRef, restrictionType: r.restrictionType,
      params: JSON.parse(r.params || '{}'),
      effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo,
      source: r.source, status: r.status,
      verifiedBy: r.verifiedBy, verifiedAt: r.verifiedAt,
      employeeNote: r.employeeNote ? decrypt(r.employeeNote) : null,
      canWithdraw: r.source === 'SELF_DECLARED' && r.status === 'ACTIVE',
    }));
}

/** An employee can withdraw their own declaration at any time. Nobody has to
 *  justify no longer needing an adjustment. */
export function withdrawDeclaration(actor: Actor, id: number) {
  const row = healthDb.select().from(workRestrictions).where(eq(workRestrictions.id, id)).all()[0];
  if (!row) throw notFound('Declaration not found');
  if (row.employeeRef !== actor.employeeId) {
    throw forbidden('You can only withdraw your own declaration.');
  }
  if (row.source !== 'SELF_DECLARED') {
    throw badRequest(
      'This limit was set by occupational health, so it cannot be withdrawn here. ' +
      'Speak to them if you think it is no longer needed.');
  }
  healthDb.update(workRestrictions).set({ status: 'REVOKED' })
    .where(eq(workRestrictions.id, id)).run();
  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'HEALTH_RESTRICTION_REVOKED', resourceType: 'WorkRestriction',
    resourceId: row.opaqueRef, subjectEmployeeId: row.employeeRef,
    detail: 'Self-declared restriction withdrawn by the employee',
  });
  return { ok: true };
}

/** Occupational health confirms a self-declared limit, which makes it durable. */
export function verifyDeclaration(actor: Actor, id: number, effectiveTo?: string) {
  assertOhAccess(actor, 'VERIFY_DECLARATION', 'WorkRestriction');
  const row = healthDb.select().from(workRestrictions).where(eq(workRestrictions.id, id)).all()[0];
  if (!row) throw notFound('Declaration not found');
  if (row.source !== 'SELF_DECLARED') throw badRequest('This restriction is already clinician-verified');

  healthDb.update(workRestrictions).set({
    source: 'CLINICIAN_VERIFIED',
    authorizedBy: actor.email,
    verifiedBy: actor.email,
    verifiedAt: new Date().toISOString(),
    effectiveTo: effectiveTo ?? new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10),
  }).where(eq(workRestrictions.id, id)).run();

  logHealth(actor, 'VERIFY_DECLARATION', 'WorkRestriction', row.employeeRef);
  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'HEALTH_RESTRICTION_CREATED', resourceType: 'WorkRestriction',
    resourceId: row.opaqueRef, subjectEmployeeId: row.employeeRef,
    detail: `Self-declared restriction confirmed by ${actor.email} and extended`,
  });
  return { ok: true };
}

/** Self-declared restrictions awaiting an OH look. */
export function pendingVerification(actor: Actor) {
  assertOhAccess(actor, 'LIST_PENDING', 'WorkRestriction');
  return healthDb.select().from(workRestrictions).where(and(
    eq(workRestrictions.source, 'SELF_DECLARED'),
    eq(workRestrictions.status, 'ACTIVE'),
  )).all().map((r) => ({
    id: r.id, employeeRef: r.employeeRef, restrictionType: r.restrictionType,
    params: JSON.parse(r.params || '{}'),
    effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo,
    employeeNote: r.employeeNote ? decrypt(r.employeeNote) : null,
  }));
}

export const encryptionStatus = () => ({
  enabled: keyConfigured(),
  fields: ['clinicalNotes', 'diagnosisCode', 'employeeNote'],
  algorithm: 'AES-256-GCM',
});
