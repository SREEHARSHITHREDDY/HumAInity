/* ═══════════════════════════════════════════════════════════════════════════
 *  HR DATABASE — the ordinary operational store.
 *
 *  Readable by HR, managers, planners and the scheduling engine.
 *  CONTAINS NO DIAGNOSES, NO CLINICAL NOTES, NO MEDICAL DOCUMENTS, EVER.
 *
 *  The only health-derived object here is `schedulingConstraints`, which is
 *  the firewall's diagnosis-free projection of an authorised work restriction.
 * ═════════════════════════════════════════════════════════════════════════ */
import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

const pk = () => integer('id').primaryKey({ autoIncrement: true });
const now = () => text('created_at').notNull().$defaultFn(() => new Date().toISOString());

/* ─── Identity & access ──────────────────────────────────────────────────── */

export const users = sqliteTable('users', {
  id: pk(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** EMPLOYEE | LINE_MANAGER | ROSTER_PLANNER | HR_ADMIN | OH_OFFICER | COMPLIANCE_AUDITOR | SYSTEM_ADMIN */
  role: text('role').notNull(),
  employeeId: integer('employee_id'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastLoginAt: text('last_login_at'),
  createdAt: now(),
});

/* ─── Organisation ───────────────────────────────────────────────────────── */

export const facilities = sqliteTable('facilities', {
  id: pk(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  city: text('city').notNull(),
});

export const departments = sqliteTable('departments', {
  id: pk(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  facilityId: integer('facility_id').notNull().references(() => facilities.id),
});

/* ─── People ─────────────────────────────────────────────────────────────── */

export const employees = sqliteTable('employees', {
  id: pk(),
  empCode: text('emp_code').notNull().unique(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  designation: text('designation').notNull(),
  departmentId: integer('department_id').notNull().references(() => departments.id),
  facilityId: integer('facility_id').notNull().references(() => facilities.id),
  managerId: integer('manager_id'),

  /* ── Employment CONTRACT facts — not health facts. ──────────────────────
   * A person may hold a part-time contract for any reason whatsoever:
   * choice, study, caregiving, phased return, or an occupational-health
   * accommodation. Payroll sees these numbers and never learns which.     */
  employmentType: text('employment_type').notNull(),          // FULL_TIME | PART_TIME | CONTRACT
  contractedFte: real('contracted_fte').notNull().default(1),
  contractedHoursPerWeek: real('contracted_hours_per_week').notNull().default(40),
  baseHourlyRate: real('base_hourly_rate').notNull(),
  overtimeMultiplier: real('overtime_multiplier').notNull().default(1.5),
  nightPremiumRate: real('night_premium_rate').notNull().default(0.15),

  joinDate: text('join_date').notNull(),
  status: text('status').notNull().default('ACTIVE'),          // ACTIVE | ON_LEAVE | EXITED
  createdAt: now(),
}, (t) => ({
  byDept: index('emp_dept_idx').on(t.departmentId),
  byFacility: index('emp_facility_idx').on(t.facilityId),
}));

export const qualifications = sqliteTable('qualifications', {
  id: pk(),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),                 // RN | RMO | SPECIALIST | BLS | ACLS | ...
  registrationNo: text('registration_no'),
  issuedOn: text('issued_on').notNull(),
  expiresOn: text('expires_on'),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  verifiedBy: text('verified_by'),
}, (t) => ({ byEmp: index('qual_emp_idx').on(t.employeeId), byType: index('qual_type_idx').on(t.type) }));

/* ─── Leave & attendance ─────────────────────────────────────────────────── */

export const leaveRequests = sqliteTable('leave_requests', {
  id: pk(),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  leaveType: text('leave_type').notNull(),      // ANNUAL | CASUAL | SICK | UNPAID | MATERNITY | COMPENSATORY
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  days: real('days').notNull(),
  /** Operational note only. The UI blocks clinical detail; see privacy.ts */
  reason: text('reason'),
  status: text('status').notNull().default('PENDING'),
  decidedById: integer('decided_by_id'),
  decidedAt: text('decided_at'),
  createdAt: now(),
}, (t) => ({ byEmp: index('leave_emp_idx').on(t.employeeId), byStatus: index('leave_status_idx').on(t.status) }));

export const leaveBalances = sqliteTable('leave_balances', {
  id: pk(),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  leaveType: text('leave_type').notNull(),
  year: integer('year').notNull(),
  entitled: real('entitled').notNull(),
  taken: real('taken').notNull().default(0),
}, (t) => ({ uniq: uniqueIndex('leave_bal_uniq').on(t.employeeId, t.leaveType, t.year) }));

export const attendance = sqliteTable('attendance', {
  id: pk(),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  clockIn: text('clock_in'),
  clockOut: text('clock_out'),
  hoursWorked: real('hours_worked').notNull().default(0),
  status: text('status').notNull().default('PRESENT'),
}, (t) => ({ uniq: uniqueIndex('att_uniq').on(t.employeeId, t.date), byDate: index('att_date_idx').on(t.date) }));

/* ─── Scheduling ─────────────────────────────────────────────────────────── */

export const shiftTemplates = sqliteTable('shift_templates', {
  id: pk(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  durationHours: real('duration_hours').notNull(),
  isNight: integer('is_night', { mode: 'boolean' }).notNull().default(false),
  /** An 8h ICU shift is heavier than an 8h records shift. Capacity is
   *  enforced on WEIGHTED load, not raw hours. */
  workloadWeight: real('workload_weight').notNull().default(1),
});

export const rosters = sqliteTable('rosters', {
  id: pk(),
  name: text('name').notNull(),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  status: text('status').notNull().default('DRAFT'),   // DRAFT | PENDING_APPROVAL | APPROVED | PUBLISHED | FAILED
  solverStatus: text('solver_status'),                 // OPTIMAL | FEASIBLE | INFEASIBLE
  solverEngine: text('solver_engine'),                 // cp-sat | heuristic-fallback
  runtimeMs: integer('runtime_ms'),
  metrics: text('metrics'),                            // JSON
  explanation: text('explanation'),                    // JSON: infeasibility + alternatives
  generatedAt: text('generated_at').notNull().$defaultFn(() => new Date().toISOString()),
  approvedById: integer('approved_by_id'),
  approvedAt: text('approved_at'),
});

export const shiftRequirements = sqliteTable('shift_requirements', {
  id: pk(),
  rosterId: integer('roster_id').references(() => rosters.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  departmentId: integer('department_id').notNull().references(() => departments.id),
  shiftTemplateId: integer('shift_template_id').notNull().references(() => shiftTemplates.id),
  requiredCount: integer('required_count').notNull(),
  requiredQualification: text('required_qualification'),
}, (t) => ({ byDate: index('req_date_idx').on(t.date), byRoster: index('req_roster_idx').on(t.rosterId) }));

export const shiftAssignments = sqliteTable('shift_assignments', {
  id: pk(),
  rosterId: integer('roster_id').notNull().references(() => rosters.id, { onDelete: 'cascade' }),
  shiftRequirementId: integer('shift_requirement_id').notNull().references(() => shiftRequirements.id, { onDelete: 'cascade' }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  hours: real('hours').notNull(),
  workloadWeight: real('workload_weight').notNull().default(1),
  /** Hours above contracted weekly hours. Only ever true for employees who
   *  VOLUNTARILY opted in. Never assigned without consent. */
  isVoluntaryExtra: integer('is_voluntary_extra', { mode: 'boolean' }).notNull().default(false),
  status: text('status').notNull().default('SCHEDULED'),
}, (t) => ({ byEmpDate: index('asg_emp_date_idx').on(t.employeeId, t.date), byRoster: index('asg_roster_idx').on(t.rosterId) }));

export const shiftPreferences = sqliteTable('shift_preferences', {
  id: pk(),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  shiftTemplateId: integer('shift_template_id').notNull().references(() => shiftTemplates.id),
  weight: integer('weight').notNull().default(0),   // -2 strongly dislike .. +2 strongly prefer
}, (t) => ({ uniq: uniqueIndex('pref_uniq').on(t.employeeId, t.shiftTemplateId) }));

/* ═══════════════════════════════════════════════════════════════════════════
 *  THE FIREWALL OUTPUT
 *
 *  The ONLY health-derived object in the HR database. It carries a constraint
 *  type, machine-readable numeric parameters and a validity window — plus an
 *  opaque handle that ONLY the occupational-health service can resolve.
 *
 *  There is deliberately no `reason`, `diagnosis`, `assessmentId` or `notes`
 *  column. The SCHEMA makes the leak impossible, not merely the code.
 * ═════════════════════════════════════════════════════════════════════════ */

export const schedulingConstraints = sqliteTable('scheduling_constraints', {
  id: pk(),
  /** Opaque, non-reversible handle. Resolvable only inside the health service. */
  opaqueRef: text('opaque_ref').notNull().unique(),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  constraintType: text('constraint_type').notNull(),
  params: text('params').notNull().default('{}'),   // JSON, schema-validated, numbers only
  effectiveFrom: text('effective_from').notNull(),
  effectiveTo: text('effective_to'),
  status: text('status').notNull().default('ACTIVE'),  // ACTIVE | EXPIRED | REVOKED
  /* Governance metadata, NOT shown to managers. Knowing that a limit is
   * self-declared rather than clinically assessed tells a manager something
   * about the person, and could be used to pressure them into "getting it
   * verified". The scheduler and the manager both see an identical label
   * either way; only the employee, occupational health and compliance see
   * this field. */
  source: text('source').notNull().default('CLINICIAN_VERIFIED'),
  issuedAt: text('issued_at').notNull().$defaultFn(() => new Date().toISOString()),
  /** Hash of the source restriction, so an auditor can prove the projection
   *  matches an authorised source WITHOUT ever reading that source. */
  sourceDigest: text('source_digest').notNull(),
}, (t) => ({ byEmp: index('sc_emp_idx').on(t.employeeId, t.status) }));

/* ─── Capacity, pay & fatigue ────────────────────────────────────────────── */

export const overtimeOptIns = sqliteTable('overtime_opt_ins', {
  id: pk(),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  maxAdditionalHours: real('max_additional_hours').notNull(),
  optedInAt: text('opted_in_at').notNull().$defaultFn(() => new Date().toISOString()),
  withdrawnAt: text('withdrawn_at'),
}, (t) => ({ byEmp: index('oti_emp_idx').on(t.employeeId) }));

export const payPeriods = sqliteTable('pay_periods', {
  id: pk(),
  name: text('name').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  status: text('status').notNull().default('OPEN'),
});

/* Payroll's COMPLETE view of a person. Note what is absent: no field here can
 * reveal a health restriction. Base pay is always computed on CONTRACTED
 * hours, so an accommodation never reduces income and therefore never shows
 * up as a payroll anomaly that someone could reason backwards from. */
export const payLines = sqliteTable('pay_lines', {
  id: pk(),
  payPeriodId: integer('pay_period_id').notNull().references(() => payPeriods.id, { onDelete: 'cascade' }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  contractedHours: real('contracted_hours').notNull(),
  basePay: real('base_pay').notNull(),
  voluntaryExtraHours: real('voluntary_extra_hours').notNull().default(0),
  overtimePay: real('overtime_pay').notNull().default(0),
  nightHours: real('night_hours').notNull().default(0),
  nightPremiumPay: real('night_premium_pay').notNull().default(0),
  grossPay: real('gross_pay').notNull(),
  calculatedAt: text('calculated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({ uniq: uniqueIndex('payline_uniq').on(t.payPeriodId, t.employeeId) }));

/* Fatigue is computed from OPERATIONAL exposure only — hours, nights, rest
 * gaps, consecutive days. No health data is an input, so none can leak out. */
export const fatigueScores = sqliteTable('fatigue_scores', {
  id: pk(),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  asOfDate: text('as_of_date').notNull(),
  score: real('score').notNull(),                 // 0 rested .. 100 critical
  band: text('band').notNull(),                   // OK | ELEVATED | HIGH | CRITICAL
  components: text('components').notNull(),       // JSON breakdown — explainable
  computedAt: text('computed_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({ uniq: uniqueIndex('fatigue_uniq').on(t.employeeId, t.asOfDate) }));

/* ─── Fairness, audit & notifications ────────────────────────────────────── */

export const fairnessSnapshots = sqliteTable('fairness_snapshots', {
  id: pk(),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  scope: text('scope').notNull(),
  groupSize: integer('group_size').notNull(),
  /** true when groupSize < k threshold — small groups are suppressed so an
   *  aggregate can never be narrowed down to one identifiable person. */
  suppressed: integer('suppressed', { mode: 'boolean' }).notNull().default(false),
  metrics: text('metrics').notNull(),
  alerts: text('alerts').notNull().default('[]'),
  generatedAt: text('generated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

/* Append-only. No update or delete path to this table exists anywhere in the
 * codebase. Every read of health data writes a row here. */
export const auditLog = sqliteTable('audit_log', {
  id: pk(),
  at: text('at').notNull().$defaultFn(() => new Date().toISOString()),
  actorUserId: integer('actor_user_id'),
  actorEmail: text('actor_email'),
  actorRole: text('actor_role'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  subjectEmployeeId: integer('subject_employee_id'),
  outcome: text('outcome').notNull().default('SUCCESS'),
  detail: text('detail'),
  ip: text('ip'),
  /** Chain hash: each row hashes the previous, making silent tampering
   *  detectable. Verified by GET /api/audit/verify. */
  prevHash: text('prev_hash'),
  hash: text('hash'),
}, (t) => ({ byAt: index('audit_at_idx').on(t.at), bySubject: index('audit_subject_idx').on(t.subjectEmployeeId), byAction: index('audit_action_idx').on(t.action) }));

export const notifications = sqliteTable('notifications', {
  id: pk(),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  readAt: text('read_at'),
  createdAt: now(),
}, (t) => ({ byEmp: index('notif_emp_idx').on(t.employeeId, t.readAt) }));

export const policies = sqliteTable('policies', {
  id: pk(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  category: text('category').notNull(),
  body: text('body').notNull(),
  version: text('version').notNull().default('1.0'),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

/* ═══════════════════════════════════════════════════════════════════════════
 *  TIER 2 — the standard HR portal.
 *  Added after the privacy core, deliberately: these modules are where a
 *  careless design would leak health status back in through the side door,
 *  so each one is built against the boundary already established above.
 * ═════════════════════════════════════════════════════════════════════════ */

/* ─── Auth sessions (refresh-token rotation) ─────────────────────────────── */

export const sessions = sqliteTable('sessions', {
  id: pk(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** SHA-256 of the refresh token. The raw token is never stored. */
  tokenHash: text('token_hash').notNull().unique(),
  issuedAt: text('issued_at').notNull().$defaultFn(() => new Date().toISOString()),
  expiresAt: text('expires_at').notNull(),
  revokedAt: text('revoked_at'),
  /** Set when this token is rotated, so reuse of an old token is detectable. */
  replacedById: integer('replaced_by_id'),
  userAgent: text('user_agent'),
  ip: text('ip'),
}, (t) => ({ byUser: index('sess_user_idx').on(t.userId) }));

export const loginAttempts = sqliteTable('login_attempts', {
  id: pk(),
  email: text('email').notNull(),
  at: text('at').notNull().$defaultFn(() => new Date().toISOString()),
  success: integer('success', { mode: 'boolean' }).notNull(),
  ip: text('ip'),
}, (t) => ({ byEmail: index('la_email_idx').on(t.email, t.at) }));

/* ═══════════════════════════════════════════════════════════════════════════
 *  PERFORMANCE MANAGEMENT
 *
 *  The module most likely to undo the firewall by accident. If a review can
 *  be marked down for "poor availability" or "low hours", then every reduced-
 *  hours accommodation becomes a performance penalty, and the restriction has
 *  effectively been disclosed through the back door.
 *
 *  Two defences, both structural:
 *    • Ratings are recorded per COMPETENCY, and the competency vocabulary is
 *      closed. Hours, availability, attendance and shift pattern are not in
 *      it and cannot be added through the API.
 *    • Any quantitative measure is normalised PER HOUR WORKED, never per
 *      calendar period, so working fewer hours cannot lower a score.
 *
 *  This module never reads schedulingConstraints. See performance.service.ts.
 * ═════════════════════════════════════════════════════════════════════════ */

export const reviewCycles = sqliteTable('review_cycles', {
  id: pk(),
  name: text('name').notNull(),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  status: text('status').notNull().default('OPEN'),   // OPEN | IN_REVIEW | CLOSED
  createdAt: now(),
});

export const goals = sqliteTable('goals', {
  id: pk(),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  cycleId: integer('cycle_id').references(() => reviewCycles.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  /** Measured as a count or rate; normalised per hour worked when scored. */
  targetValue: real('target_value'),
  actualValue: real('actual_value'),
  unit: text('unit'),
  status: text('status').notNull().default('ACTIVE'),  // ACTIVE | ACHIEVED | PARTIAL | DROPPED
  dueDate: text('due_date'),
  createdAt: now(),
}, (t) => ({ byEmp: index('goal_emp_idx').on(t.employeeId) }));

export const performanceReviews = sqliteTable('performance_reviews', {
  id: pk(),
  cycleId: integer('cycle_id').notNull().references(() => reviewCycles.id, { onDelete: 'cascade' }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  reviewerId: integer('reviewer_id').notNull(),
  /** JSON: { competencyCode: 1..5 }. Keys validated against the closed list. */
  ratings: text('ratings').notNull().default('{}'),
  overallRating: real('overall_rating'),
  strengths: text('strengths'),
  development: text('development'),
  employeeComment: text('employee_comment'),
  status: text('status').notNull().default('DRAFT'),  // DRAFT | SUBMITTED | ACKNOWLEDGED
  /** Set when the fairness guard found barred language in the free text. */
  guardFlags: text('guard_flags').notNull().default('[]'),
  submittedAt: text('submitted_at'),
  acknowledgedAt: text('acknowledged_at'),
  createdAt: now(),
}, (t) => ({ uniq: uniqueIndex('review_uniq').on(t.cycleId, t.employeeId) }));

/* ═══════════════════════════════════════════════════════════════════════════
 *  RECRUITMENT
 *  AI assists a human reviewer. It never rejects, never ranks on anything but
 *  stated job requirements, and has no access to health data of any kind.
 * ═════════════════════════════════════════════════════════════════════════ */

export const jobPostings = sqliteTable('job_postings', {
  id: pk(),
  reference: text('reference').notNull().unique(),
  title: text('title').notNull(),
  departmentId: integer('department_id').notNull().references(() => departments.id),
  facilityId: integer('facility_id').notNull().references(() => facilities.id),
  employmentType: text('employment_type').notNull(),
  openings: integer('openings').notNull().default(1),
  /** JSON array of qualification codes, e.g. ["RN","BLS"]. */
  requiredQualifications: text('required_qualifications').notNull().default('[]'),
  desirableSkills: text('desirable_skills').notNull().default('[]'),
  minYearsExperience: real('min_years_experience').notNull().default(0),
  salaryRangeMin: real('salary_range_min'),
  salaryRangeMax: real('salary_range_max'),
  description: text('description').notNull(),
  status: text('status').notNull().default('OPEN'),  // DRAFT | OPEN | CLOSED | FILLED
  closingDate: text('closing_date'),
  createdAt: now(),
});

export const candidates = sqliteTable('candidates', {
  id: pk(),
  fullName: text('full_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  /** Plain-text resume. There is no health field, and none is parsed. */
  resumeText: text('resume_text').notNull().default(''),
  yearsExperience: real('years_experience').notNull().default(0),
  createdAt: now(),
}, (t) => ({ byEmail: index('cand_email_idx').on(t.email) }));

export const applications = sqliteTable('applications', {
  id: pk(),
  jobPostingId: integer('job_posting_id').notNull().references(() => jobPostings.id, { onDelete: 'cascade' }),
  candidateId: integer('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  /** APPLIED → SCREENED → SHORTLISTED → INTERVIEWING → OFFERED → HIRED | REJECTED
   *  Only a human may set REJECTED. The screening service cannot. */
  stage: text('stage').notNull().default('APPLIED'),
  /** Advisory only. Never used to filter, sort out, or auto-reject. */
  matchScore: real('match_score'),
  /** JSON: which requirements were evidenced, and where in the resume. */
  matchEvidence: text('match_evidence').notNull().default('{}'),
  screenedAt: text('screened_at'),
  decidedById: integer('decided_by_id'),
  decidedAt: text('decided_at'),
  decisionNote: text('decision_note'),
  createdAt: now(),
}, (t) => ({ uniq: uniqueIndex('app_uniq').on(t.jobPostingId, t.candidateId) }));

export const interviews = sqliteTable('interviews', {
  id: pk(),
  applicationId: integer('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  scheduledAt: text('scheduled_at').notNull(),
  durationMinutes: integer('duration_minutes').notNull().default(45),
  mode: text('mode').notNull().default('IN_PERSON'),
  interviewerId: integer('interviewer_id'),
  outcome: text('outcome'),              // PENDING | PROCEED | HOLD | DECLINE
  notes: text('notes'),
  createdAt: now(),
});

/* ─── Onboarding & offboarding ───────────────────────────────────────────── */

export const onboardingTemplates = sqliteTable('onboarding_templates', {
  id: pk(),
  name: text('name').notNull(),
  /** JSON array of { title, category, dayOffset, mandatory } */
  tasks: text('tasks').notNull().default('[]'),
  appliesToRole: text('applies_to_role'),
});

export const onboardingTasks = sqliteTable('onboarding_tasks', {
  id: pk(),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  category: text('category').notNull(),   // PAPERWORK | TRAINING | CREDENTIAL | ORIENTATION | IT
  mandatory: integer('mandatory', { mode: 'boolean' }).notNull().default(true),
  dueDate: text('due_date'),
  status: text('status').notNull().default('PENDING'),   // PENDING | IN_PROGRESS | DONE | WAIVED
  completedAt: text('completed_at'),
  assigneeRole: text('assignee_role').notNull().default('EMPLOYEE'),
  notes: text('notes'),
  createdAt: now(),
}, (t) => ({ byEmp: index('onb_emp_idx').on(t.employeeId, t.status) }));

export const offboardingCases = sqliteTable('offboarding_cases', {
  id: pk(),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  lastWorkingDay: text('last_working_day').notNull(),
  reason: text('reason').notNull(),       // RESIGNATION | END_OF_CONTRACT | RETIREMENT | OTHER
  status: text('status').notNull().default('OPEN'),    // OPEN | IN_PROGRESS | COMPLETED
  /** JSON checklist of { key, label, done } */
  checklist: text('checklist').notNull().default('[]'),
  accessRevokedAt: text('access_revoked_at'),
  /** Health records follow their own retention rule and are NOT deleted here;
   *  occupational health decides, and the action is logged in their zone. */
  healthRecordsHandledBy: text('health_records_handled_by'),
  completedAt: text('completed_at'),
  createdAt: now(),
});

/* ─── Documents ──────────────────────────────────────────────────────────── */

export const documents = sqliteTable('documents', {
  id: pk(),
  title: text('title').notNull(),
  category: text('category').notNull(),   // POLICY | FORM | HANDBOOK | NOTICE | TRAINING
  /** Text content, or a storage key for a binary. Clinical documents are not
   *  permitted here — they live in the health store. Enforced in the service. */
  body: text('body'),
  storageKey: text('storage_key'),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  version: text('version').notNull().default('1.0'),
  requiresAcknowledgement: integer('requires_acknowledgement', { mode: 'boolean' }).notNull().default(false),
  visibleToRoles: text('visible_to_roles').notNull().default('[]'),  // empty = everyone
  uploadedById: integer('uploaded_by_id'),
  createdAt: now(),
});

export const documentAcknowledgements = sqliteTable('document_acknowledgements', {
  id: pk(),
  documentId: integer('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  acknowledgedAt: text('acknowledged_at').notNull().$defaultFn(() => new Date().toISOString()),
  version: text('version').notNull(),
}, (t) => ({ uniq: uniqueIndex('ack_uniq').on(t.documentId, t.employeeId, t.version) }));

/* ─── Helpdesk ───────────────────────────────────────────────────────────── */

export const tickets = sqliteTable('tickets', {
  id: pk(),
  reference: text('reference').notNull().unique(),
  raisedById: integer('raised_by_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),   // PAY | ROSTER | LEAVE | IT | FACILITIES | OTHER
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  priority: text('priority').notNull().default('NORMAL'),
  status: text('status').notNull().default('OPEN'),   // OPEN | IN_PROGRESS | RESOLVED | CLOSED
  assignedToId: integer('assigned_to_id'),
  resolution: text('resolution'),
  resolvedAt: text('resolved_at'),
  createdAt: now(),
}, (t) => ({ byRaiser: index('tkt_raiser_idx').on(t.raisedById, t.status) }));

export const ticketComments = sqliteTable('ticket_comments', {
  id: pk(),
  ticketId: integer('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  authorId: integer('author_id').notNull(),
  body: text('body').notNull(),
  createdAt: now(),
});

/* ─── Assistant transcript ───────────────────────────────────────────────── */

export const assistantMessages = sqliteTable('assistant_messages', {
  id: pk(),
  userId: integer('user_id').notNull(),
  employeeId: integer('employee_id'),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  /** Which data sources were consulted, so an auditor can confirm the
   *  assistant never reached for health data. */
  sources: text('sources').notNull().default('[]'),
  refused: integer('refused', { mode: 'boolean' }).notNull().default(false),
  createdAt: now(),
}, (t) => ({ byUser: index('asst_user_idx').on(t.userId) }));
