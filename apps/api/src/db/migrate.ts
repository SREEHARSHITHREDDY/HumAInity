/* Schema creation for both databases.
 * Hand-written DDL keeps the two stores explicit and auditable, and avoids
 * any build-time codegen step on a machine that may be offline.
 * Run:  npm -w @humainity/api run db:migrate  [-- --fresh]                 */
import '../lib/load-env.js';
import fs from 'node:fs';
import { hrConnection, healthConnection, HR_DB_PATH, HEALTH_DB_PATH } from './index.js';

const HR_DDL = `
CREATE TABLE IF NOT EXISTS facilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, city TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  facility_id INTEGER NOT NULL REFERENCES facilities(id));

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT, emp_code TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT,
  designation TEXT NOT NULL,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  facility_id INTEGER NOT NULL REFERENCES facilities(id),
  manager_id INTEGER,
  employment_type TEXT NOT NULL,
  contracted_fte REAL NOT NULL DEFAULT 1,
  contracted_hours_per_week REAL NOT NULL DEFAULT 40,
  base_hourly_rate REAL NOT NULL,
  overtime_multiplier REAL NOT NULL DEFAULT 1.5,
  night_premium_rate REAL NOT NULL DEFAULT 0.15,
  join_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS emp_dept_idx ON employees(department_id);
CREATE INDEX IF NOT EXISTS emp_facility_idx ON employees(facility_id);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL, employee_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1, last_login_at TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS qualifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL, registration_no TEXT, issued_on TEXT NOT NULL, expires_on TEXT,
  verified INTEGER NOT NULL DEFAULT 0, verified_by TEXT);
CREATE INDEX IF NOT EXISTS qual_emp_idx ON qualifications(employee_id);
CREATE INDEX IF NOT EXISTS qual_type_idx ON qualifications(type);

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  days REAL NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'PENDING',
  decided_by_id INTEGER, decided_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS leave_emp_idx ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS leave_status_idx ON leave_requests(status);

CREATE TABLE IF NOT EXISTS leave_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL, year INTEGER NOT NULL, entitled REAL NOT NULL, taken REAL NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS leave_bal_uniq ON leave_balances(employee_id, leave_type, year);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL, clock_in TEXT, clock_out TEXT,
  hours_worked REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'PRESENT');
CREATE UNIQUE INDEX IF NOT EXISTS att_uniq ON attendance(employee_id, date);
CREATE INDEX IF NOT EXISTS att_date_idx ON attendance(date);

CREATE TABLE IF NOT EXISTS shift_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  start_time TEXT NOT NULL, end_time TEXT NOT NULL, duration_hours REAL NOT NULL,
  is_night INTEGER NOT NULL DEFAULT 0, workload_weight REAL NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS rosters (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT', solver_status TEXT, solver_engine TEXT,
  runtime_ms INTEGER, metrics TEXT, explanation TEXT,
  generated_at TEXT NOT NULL, approved_by_id INTEGER, approved_at TEXT);

CREATE TABLE IF NOT EXISTS shift_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roster_id INTEGER REFERENCES rosters(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  shift_template_id INTEGER NOT NULL REFERENCES shift_templates(id),
  required_count INTEGER NOT NULL, required_qualification TEXT);
CREATE INDEX IF NOT EXISTS req_date_idx ON shift_requirements(date);
CREATE INDEX IF NOT EXISTS req_roster_idx ON shift_requirements(roster_id);

CREATE TABLE IF NOT EXISTS shift_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roster_id INTEGER NOT NULL REFERENCES rosters(id) ON DELETE CASCADE,
  shift_requirement_id INTEGER NOT NULL REFERENCES shift_requirements(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL, hours REAL NOT NULL, workload_weight REAL NOT NULL DEFAULT 1,
  is_voluntary_extra INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'SCHEDULED');
CREATE INDEX IF NOT EXISTS asg_emp_date_idx ON shift_assignments(employee_id, date);
CREATE INDEX IF NOT EXISTS asg_roster_idx ON shift_assignments(roster_id);

CREATE TABLE IF NOT EXISTS shift_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_template_id INTEGER NOT NULL REFERENCES shift_templates(id),
  weight INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS pref_uniq ON shift_preferences(employee_id, shift_template_id);

-- ── THE FIREWALL OUTPUT ────────────────────────────────────────────────────
-- No reason / diagnosis / assessment_id / notes column exists. By design.
CREATE TABLE IF NOT EXISTS scheduling_constraints (
  id INTEGER PRIMARY KEY AUTOINCREMENT, opaque_ref TEXT NOT NULL UNIQUE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  constraint_type TEXT NOT NULL, params TEXT NOT NULL DEFAULT '{}',
  effective_from TEXT NOT NULL, effective_to TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  source TEXT NOT NULL DEFAULT 'CLINICIAN_VERIFIED',
  issued_at TEXT NOT NULL,
  source_digest TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sc_emp_idx ON scheduling_constraints(employee_id, status);

CREATE TABLE IF NOT EXISTS overtime_opt_ins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  max_additional_hours REAL NOT NULL, opted_in_at TEXT NOT NULL, withdrawn_at TEXT);
CREATE INDEX IF NOT EXISTS oti_emp_idx ON overtime_opt_ins(employee_id);

CREATE TABLE IF NOT EXISTS pay_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN');

CREATE TABLE IF NOT EXISTS pay_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pay_period_id INTEGER NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  contracted_hours REAL NOT NULL, base_pay REAL NOT NULL,
  voluntary_extra_hours REAL NOT NULL DEFAULT 0, overtime_pay REAL NOT NULL DEFAULT 0,
  night_hours REAL NOT NULL DEFAULT 0, night_premium_pay REAL NOT NULL DEFAULT 0,
  gross_pay REAL NOT NULL, calculated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS payline_uniq ON pay_lines(pay_period_id, employee_id);

CREATE TABLE IF NOT EXISTS fatigue_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  as_of_date TEXT NOT NULL, score REAL NOT NULL, band TEXT NOT NULL,
  components TEXT NOT NULL, computed_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS fatigue_uniq ON fatigue_scores(employee_id, as_of_date);

CREATE TABLE IF NOT EXISTS fairness_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  scope TEXT NOT NULL, group_size INTEGER NOT NULL, suppressed INTEGER NOT NULL DEFAULT 0,
  metrics TEXT NOT NULL, alerts TEXT NOT NULL DEFAULT '[]', generated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
  actor_user_id INTEGER, actor_email TEXT, actor_role TEXT,
  action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT,
  subject_employee_id INTEGER, outcome TEXT NOT NULL DEFAULT 'SUCCESS',
  detail TEXT, ip TEXT, prev_hash TEXT, hash TEXT);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log(at);
CREATE INDEX IF NOT EXISTS audit_subject_idx ON audit_log(subject_employee_id);
CREATE INDEX IF NOT EXISTS audit_action_idx ON audit_log(action);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  read_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS notif_emp_idx ON notifications(employee_id, read_at);

CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  category TEXT NOT NULL, body TEXT NOT NULL, version TEXT NOT NULL DEFAULT '1.0',
  updated_at TEXT NOT NULL);
-- ═══════════════════════ TIER 2 — standard HR portal ═══════════════════════

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, issued_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  revoked_at TEXT, replaced_by_id INTEGER, user_agent TEXT, ip TEXT);
CREATE INDEX IF NOT EXISTS sess_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, at TEXT NOT NULL,
  success INTEGER NOT NULL, ip TEXT);
CREATE INDEX IF NOT EXISTS la_email_idx ON login_attempts(email, at);

CREATE TABLE IF NOT EXISTS review_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  cycle_id INTEGER REFERENCES review_cycles(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT, target_value REAL, actual_value REAL,
  unit TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', due_date TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS goal_emp_idx ON goals(employee_id);

CREATE TABLE IF NOT EXISTS performance_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id INTEGER NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reviewer_id INTEGER NOT NULL, ratings TEXT NOT NULL DEFAULT '{}',
  overall_rating REAL, strengths TEXT, development TEXT, employee_comment TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT', guard_flags TEXT NOT NULL DEFAULT '[]',
  submitted_at TEXT, acknowledged_at TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS review_uniq ON performance_reviews(cycle_id, employee_id);

CREATE TABLE IF NOT EXISTS job_postings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  facility_id INTEGER NOT NULL REFERENCES facilities(id),
  employment_type TEXT NOT NULL, openings INTEGER NOT NULL DEFAULT 1,
  required_qualifications TEXT NOT NULL DEFAULT '[]',
  desirable_skills TEXT NOT NULL DEFAULT '[]',
  min_years_experience REAL NOT NULL DEFAULT 0,
  salary_range_min REAL, salary_range_max REAL, description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN', closing_date TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, email TEXT NOT NULL,
  phone TEXT, resume_text TEXT NOT NULL DEFAULT '',
  years_experience REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS cand_email_idx ON candidates(email);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_posting_id INTEGER NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'APPLIED', match_score REAL,
  match_evidence TEXT NOT NULL DEFAULT '{}', screened_at TEXT,
  decided_by_id INTEGER, decided_at TEXT, decision_note TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS app_uniq ON applications(job_posting_id, candidate_id);

CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 45,
  mode TEXT NOT NULL DEFAULT 'IN_PERSON', interviewer_id INTEGER,
  outcome TEXT, notes TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS onboarding_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  tasks TEXT NOT NULL DEFAULT '[]', applies_to_role TEXT);

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL, category TEXT NOT NULL,
  mandatory INTEGER NOT NULL DEFAULT 1, due_date TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING', completed_at TEXT,
  assignee_role TEXT NOT NULL DEFAULT 'EMPLOYEE', notes TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS onb_emp_idx ON onboarding_tasks(employee_id, status);

CREATE TABLE IF NOT EXISTS offboarding_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  last_working_day TEXT NOT NULL, reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN', checklist TEXT NOT NULL DEFAULT '[]',
  access_revoked_at TEXT, health_records_handled_by TEXT,
  completed_at TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL,
  body TEXT, storage_key TEXT, mime_type TEXT, size_bytes INTEGER,
  version TEXT NOT NULL DEFAULT '1.0',
  requires_acknowledgement INTEGER NOT NULL DEFAULT 0,
  visible_to_roles TEXT NOT NULL DEFAULT '[]',
  uploaded_by_id INTEGER, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS document_acknowledgements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  acknowledged_at TEXT NOT NULL, version TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ack_uniq ON document_acknowledgements(document_id, employee_id, version);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT NOT NULL UNIQUE,
  raised_by_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL', status TEXT NOT NULL DEFAULT 'OPEN',
  assigned_to_id INTEGER, resolution TEXT, resolved_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tkt_raiser_idx ON tickets(raised_by_id, status);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, employee_id INTEGER,
  question TEXT NOT NULL, answer TEXT NOT NULL, sources TEXT NOT NULL DEFAULT '[]',
  refused INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS asst_user_idx ON assistant_messages(user_id);

`;

const HEALTH_DDL = `
CREATE TABLE IF NOT EXISTS oh_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_ref INTEGER NOT NULL,
  assessed_by TEXT NOT NULL, assessment_date TEXT NOT NULL, fitness_status TEXT NOT NULL,
  clinical_notes TEXT, diagnosis_code TEXT, review_date TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS oha_emp_idx ON oh_assessments(employee_ref);

CREATE TABLE IF NOT EXISTS medical_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL REFERENCES oh_assessments(id) ON DELETE CASCADE,
  filename TEXT NOT NULL, mime_type TEXT NOT NULL, storage_key TEXT NOT NULL,
  uploaded_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_ref INTEGER NOT NULL, scope TEXT NOT NULL,
  granted_at TEXT NOT NULL, withdrawn_at TEXT,
  basis TEXT NOT NULL DEFAULT 'EMPLOYMENT_OBLIGATION');
CREATE INDEX IF NOT EXISTS consent_emp_idx ON consents(employee_ref);

CREATE TABLE IF NOT EXISTS work_restrictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_ref INTEGER NOT NULL,
  assessment_id INTEGER REFERENCES oh_assessments(id) ON DELETE CASCADE,
  restriction_type TEXT NOT NULL, params TEXT NOT NULL DEFAULT '{}',
  effective_from TEXT NOT NULL, effective_to TEXT,
  source TEXT NOT NULL DEFAULT 'CLINICIAN_VERIFIED',
  authorized_by TEXT, authorized_at TEXT NOT NULL,
  consent_id INTEGER REFERENCES consents(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  opaque_ref TEXT NOT NULL UNIQUE, projected_at TEXT,
  verified_by TEXT, verified_at TEXT, employee_note TEXT);
CREATE INDEX IF NOT EXISTS wr_emp_idx ON work_restrictions(employee_ref, status);

CREATE TABLE IF NOT EXISTS wellbeing_check_ins (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_ref INTEGER NOT NULL,
  submitted_at TEXT NOT NULL, responses TEXT NOT NULL,
  risk_flag TEXT NOT NULL DEFAULT 'NONE', reviewed_by TEXT, reviewed_at TEXT);
CREATE INDEX IF NOT EXISTS wci_emp_idx ON wellbeing_check_ins(employee_ref);

CREATE TABLE IF NOT EXISTS health_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL, action TEXT NOT NULL, employee_ref INTEGER,
  resource TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT 'SUCCESS');
CREATE INDEX IF NOT EXISTS hal_at_idx ON health_access_log(at);
CREATE INDEX IF NOT EXISTS hal_emp_idx ON health_access_log(employee_ref);
`;

const fresh = process.argv.includes('--fresh');

if (fresh) {
  hrConnection.close();
  healthConnection.close();
  for (const p of [HR_DB_PATH, HEALTH_DB_PATH]) {
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(p + suffix)) fs.unlinkSync(p + suffix);
    }
  }
  console.log('  dropped existing databases');
  const { hrConnection: h, healthConnection: hc } = await import('./index.js?fresh=' + Date.now());
  h.exec(HR_DDL); hc.exec(HEALTH_DDL);
} else {
  hrConnection.exec(HR_DDL);
  healthConnection.exec(HEALTH_DDL);
}

console.log(`  HR database      → ${HR_DB_PATH}`);
console.log(`  Health database  → ${HEALTH_DB_PATH}`);
console.log('  schema ready');
