/* ═══════════════════════════════════════════════════════════════════════════
 *  HEALTH DATABASE — the restricted zone.
 *
 *  A SEPARATE physical database file with its own connection and its own
 *  Drizzle client. Application code does not import this module; only
 *  `services/health.service.ts` does, and every exported function there is
 *  guarded by the OH_OFFICER role.
 *
 *  There is NO foreign key to the HR database. Employees are referenced by a
 *  bare integer (`employeeRef`), so the two stores cannot be joined by the
 *  query planner — the separation survives even a mistaken query.
 * ═════════════════════════════════════════════════════════════════════════ */
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

const pk = () => integer('id').primaryKey({ autoIncrement: true });
const ts = (c: string) => text(c).notNull().$defaultFn(() => new Date().toISOString());

export const ohAssessments = sqliteTable('oh_assessments', {
  id: pk(),
  /** NOT a foreign key. Different database. */
  employeeRef: integer('employee_ref').notNull(),
  assessedBy: text('assessed_by').notNull(),
  assessmentDate: text('assessment_date').notNull(),
  fitnessStatus: text('fitness_status').notNull(),   // FIT | FIT_WITH_RESTRICTIONS | TEMPORARILY_UNFIT

  /* ─── The sensitive payload. Never leaves this database. ─── */
  clinicalNotes: text('clinical_notes'),
  diagnosisCode: text('diagnosis_code'),             // ICD-10 style

  reviewDate: text('review_date'),
  createdAt: ts('created_at'),
}, (t) => ({ byEmp: index('oha_emp_idx').on(t.employeeRef) }));

export const medicalDocuments = sqliteTable('medical_documents', {
  id: pk(),
  assessmentId: integer('assessment_id').notNull().references(() => ohAssessments.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  storageKey: text('storage_key').notNull(),
  uploadedAt: ts('uploaded_at'),
});

/** The authorised SOURCE restriction. The firewall reads this, strips
 *  everything clinical, and projects only type + numeric params + dates. */
export const workRestrictions = sqliteTable('work_restrictions', {
  id: pk(),
  employeeRef: integer('employee_ref').notNull(),
  /** Null for a self-declared restriction: there is no assessment behind it. */
  assessmentId: integer('assessment_id').references(() => ohAssessments.id, { onDelete: 'cascade' }),
  restrictionType: text('restriction_type').notNull(),
  params: text('params').notNull().default('{}'),
  effectiveFrom: text('effective_from').notNull(),
  effectiveTo: text('effective_to'),

  /* ── Where this restriction came from ───────────────────────────────────
   * SELF_DECLARED      the employee stated a limit on their own work. No
   *                    diagnosis was given and none was asked for. Provisional
   *                    and short-dated, so it cannot sit unreviewed forever.
   * CLINICIAN_VERIFIED an occupational health officer assessed and authorised
   *                    it. Can be long-dated.
   *
   * The scheduler treats both identically — a limit is a limit. The
   * distinction exists for governance, not for scheduling.                */
  source: text('source').notNull().default('CLINICIAN_VERIFIED'),
  /** Null for a self-declared restriction: nobody has signed it off yet. */
  authorizedBy: text('authorized_by'),
  authorizedAt: ts('authorized_at'),
  consentId: integer('consent_id').references(() => consents.id),
  status: text('status').notNull().default('ACTIVE'),
  /** The opaque handle shared with the HR database. One-way: HR can display
   *  it, only this service can resolve it back to an assessment. */
  opaqueRef: text('opaque_ref').notNull().unique(),
  projectedAt: text('projected_at'),
  /** Set when an OH officer confirms a self-declared restriction. */
  verifiedBy: text('verified_by'),
  verifiedAt: text('verified_at'),
  /** The employee's own words for why they need it, if they chose to give a
   *  reason. Optional, encrypted, and visible ONLY to them and to OH. It is
   *  never required, never prompted for a diagnosis, and never projected. */
  employeeNote: text('employee_note'),
}, (t) => ({ byEmp: index('wr_emp_idx').on(t.employeeRef, t.status) }));

export const consents = sqliteTable('consents', {
  id: pk(),
  employeeRef: integer('employee_ref').notNull(),
  scope: text('scope').notNull(),   // SHARE_RESTRICTION_WITH_SCHEDULER | OH_ASSESSMENT | WELLBEING_CHECKIN
  grantedAt: ts('granted_at'),
  withdrawnAt: text('withdrawn_at'),
  basis: text('basis').notNull().default('EMPLOYMENT_OBLIGATION'),
}, (t) => ({ byEmp: index('consent_emp_idx').on(t.employeeRef) }));

/** Voluntary wellbeing check-ins. Health-adjacent, so they live HERE, behind
 *  the firewall. Managers never see a response or a score. The only thing
 *  that can ever leave is a formally authorised WorkRestriction. */
export const wellbeingCheckIns = sqliteTable('wellbeing_check_ins', {
  id: pk(),
  employeeRef: integer('employee_ref').notNull(),
  submittedAt: ts('submitted_at'),
  responses: text('responses').notNull(),
  riskFlag: text('risk_flag').notNull().default('NONE'),  // NONE | REVIEW | URGENT
  reviewedBy: text('reviewed_by'),
  reviewedAt: text('reviewed_at'),
}, (t) => ({ byEmp: index('wci_emp_idx').on(t.employeeRef) }));

/** The restricted zone keeps its own independent access record, so the HR
 *  audit log and this log can be cross-checked against each other. */
export const healthAccessLog = sqliteTable('health_access_log', {
  id: pk(),
  at: ts('at'),
  actorEmail: text('actor_email').notNull(),
  actorRole: text('actor_role').notNull(),
  action: text('action').notNull(),
  employeeRef: integer('employee_ref'),
  resource: text('resource').notNull(),
  outcome: text('outcome').notNull().default('SUCCESS'),
}, (t) => ({ byAt: index('hal_at_idx').on(t.at), byEmp: index('hal_emp_idx').on(t.employeeRef) }));
