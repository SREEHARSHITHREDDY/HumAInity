/* Synthetic seed data. Every person, record and diagnosis here is invented.
 * No real patient or employee data is used anywhere in this project.
 *
 * The dataset is built around the scenario in the project brief:
 *   • Priya  — a 7.5 h daily cap
 *   • Arjun  — a 6 h daily cap and no night shifts
 *   • Sneha  — no restrictions, opted in to additional hours
 * All three hold identical 40 h contracts, so all three are paid for 40 h.
 * Only Sneha earns the overtime premium, and only because she chose to.
 */
import '../lib/load-env.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { hrDb, healthDb, hrConnection, healthConnection } from './index.js';
import * as H from './hr.schema.js';
import * as M from './health.schema.js';
import { dayKey, addDays, eachDay, isWeekend } from '../lib/dates.js';
import { encrypt, keyConfigured } from '../lib/crypto.js';

const PASSWORD = 'Demo@1234';

const monday = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return dayKey(d);
})();
const periodStart = monday;
const periodEnd = dayKey(addDays(monday, 27));          // four weeks

console.log(`\n  Seeding HumAInity — period ${periodStart} to ${periodEnd}\n`);

/* ─── Wipe (idempotent re-seed) ──────────────────────────────────────────── */
for (const t of ['assistant_messages', 'ticket_comments', 'tickets', 'document_acknowledgements',
  'documents', 'offboarding_cases', 'onboarding_tasks', 'onboarding_templates',
  'interviews', 'applications', 'candidates', 'job_postings',
  'performance_reviews', 'goals', 'review_cycles', 'sessions', 'login_attempts',
  'shift_assignments', 'shift_requirements', 'rosters', 'shift_preferences',
  'scheduling_constraints', 'overtime_opt_ins', 'pay_lines', 'pay_periods', 'fatigue_scores',
  'fairness_snapshots', 'notifications', 'audit_log', 'attendance', 'leave_balances',
  'leave_requests', 'qualifications', 'users', 'employees', 'departments', 'facilities',
  'shift_templates', 'policies']) hrConnection.exec(`DELETE FROM ${t};`);
// Reset autoincrement so a re-seed produces stable, predictable ids.
hrConnection.exec(`DELETE FROM sqlite_sequence;`);
for (const t of ['health_access_log', 'wellbeing_check_ins', 'work_restrictions',
  'medical_documents', 'oh_assessments', 'consents']) healthConnection.exec(`DELETE FROM ${t};`);
healthConnection.exec(`DELETE FROM sqlite_sequence;`);

/* ─── Facilities & departments ───────────────────────────────────────────── */
const fac = hrDb.insert(H.facilities).values([
  { code: 'HYD', name: 'Hyderabad Delivery Centre', city: 'Hyderabad' },
  { code: 'BLR', name: 'Bengaluru Engineering Hub', city: 'Bengaluru' },
]).returning().all();

const dept = hrDb.insert(H.departments).values([
  { code: 'SRE',  name: 'Site Reliability',    facilityId: fac[0].id },
  { code: 'NOC',  name: 'Network Operations',  facilityId: fac[0].id },
  { code: 'PLT',  name: 'Platform Engineering', facilityId: fac[0].id },
  { code: 'SUP',  name: 'Customer Support',    facilityId: fac[1].id },
]).returning().all();
const D = Object.fromEntries(dept.map((d) => [d.code, d.id]));

/* ─── Shift templates ────────────────────────────────────────────────────────
 * Note the short templates. A person with a 6 h cap is TIME-LIMITED, not
 * unavailable — without short shifts the scheduler would exclude them from
 * everything, which is both operationally wasteful and quietly exclusionary. */
const tpl = hrDb.insert(H.shiftTemplates).values([
  { code: 'EARLY',    name: 'Early',            startTime: '07:00', endTime: '15:00', durationHours: 8,   isNight: false, workloadWeight: 1.0 },
  { code: 'LATE',     name: 'Late',             startTime: '14:00', endTime: '22:00', durationHours: 8,   isNight: false, workloadWeight: 1.0 },
  { code: 'NIGHT',    name: 'Night',            startTime: '22:00', endTime: '07:00', durationHours: 9,   isNight: true,  workloadWeight: 1.4 },
  { code: 'REDUCED',  name: 'Reduced day',      startTime: '08:00', endTime: '15:30', durationHours: 7.5, isNight: false, workloadWeight: 0.9 },
  { code: 'SHORT_AM', name: 'Short morning',    startTime: '09:00', endTime: '15:00', durationHours: 6,   isNight: false, workloadWeight: 0.8 },
  { code: 'TWILIGHT', name: 'Twilight',         startTime: '16:00', endTime: '22:00', durationHours: 6,   isNight: false, workloadWeight: 0.9 },
]).returning().all();
const T = Object.fromEntries(tpl.map((t) => [t.code, t]));

/* ─── People ─────────────────────────────────────────────────────────────── */
interface Spec {
  code: string; first: string; last: string; desig: string; dept: string;
  quals: string[]; rate: number; hours?: number; fte?: number; type?: string;
}
const specs: Spec[] = [
  { code: 'E001', first: 'Priya',   last: 'Nair',      desig: 'Software Engineer',        dept: 'SRE', quals: ['RN', 'BLS', 'ACLS'], rate: 420 },
  { code: 'E002', first: 'Arjun',   last: 'Mehta',     desig: 'Software Engineer',        dept: 'SRE', quals: ['RN', 'BLS'],         rate: 420 },
  { code: 'E003', first: 'Sneha',   last: 'Reddy',     desig: 'Software Engineer',        dept: 'SRE', quals: ['RN', 'BLS', 'ACLS'], rate: 420 },
  { code: 'E004', first: 'Vikram',  last: 'Shah',      desig: 'Senior Site Reliability Engineer', dept: 'SRE', quals: ['RN', 'BLS', 'ACLS'], rate: 480 },
  { code: 'E005', first: 'Ananya',  last: 'Iyer',      desig: 'Software Engineer',        dept: 'SRE', quals: ['RN', 'BLS'],         rate: 420 },
  { code: 'E006', first: 'Rahul',   last: 'Deshmukh',  desig: 'Software Engineer',        dept: 'SRE', quals: ['RN', 'BLS'],         rate: 415 },
  { code: 'E007', first: 'Fatima',  last: 'Sheikh',    desig: 'Engineering Team Lead',       dept: 'NOC', quals: ['RN', 'BLS', 'ACLS'], rate: 500 },
  { code: 'E008', first: 'Karthik', last: 'Rao',       desig: 'Software Engineer',        dept: 'NOC', quals: ['RN', 'BLS'],         rate: 420 },
  { code: 'E009', first: 'Meera',   last: 'Joshi',     desig: 'Software Engineer',        dept: 'NOC', quals: ['RN', 'BLS', 'ACLS'], rate: 430 },
  { code: 'E010', first: 'Imran',   last: 'Qureshi',   desig: 'Software Engineer',        dept: 'NOC', quals: ['RN', 'BLS'],         rate: 420 },
  { code: 'E011', first: 'Divya',   last: 'Pillai',    desig: 'Software Engineer',        dept: 'NOC', quals: ['RN', 'BLS'],         rate: 418 },
  { code: 'E012', first: 'Sanjay',  last: 'Kulkarni',  desig: 'Software Engineer',        dept: 'PLT', quals: ['RN', 'BLS'],         rate: 400 },
  { code: 'E013', first: 'Lakshmi', last: 'Menon',     desig: 'Software Engineer',        dept: 'PLT', quals: ['RN', 'BLS'],         rate: 400 },
  { code: 'E014', first: 'Rohit',   last: 'Bansal',    desig: 'Software Engineer',        dept: 'PLT', quals: ['RN'],                rate: 395 },
  { code: 'E015', first: 'Kavya',   last: 'Srinivas',  desig: 'Software Engineer',        dept: 'PLT', quals: ['RN', 'BLS'],         rate: 400 },
  { code: 'E016', first: 'Neha',    last: 'Gupta',     desig: 'Software Engineer',        dept: 'PLT', quals: ['RN'],                rate: 395, hours: 24, fte: 0.6, type: 'PART_TIME' },
  { code: 'E017', first: 'Aditya',  last: 'Verma',     desig: 'Software Engineer',        dept: 'SUP', quals: ['RN'],                rate: 390 },
  { code: 'E018', first: 'Pooja',   last: 'Chawla',    desig: 'Software Engineer',        dept: 'SUP', quals: ['RN', 'BLS'],         rate: 395 },
  { code: 'E019', first: 'Suresh',  last: 'Patel',     desig: 'Software Engineer',        dept: 'SUP', quals: ['RN'],                rate: 390, hours: 30, fte: 0.75, type: 'PART_TIME' },
  { code: 'E020', first: 'Ritu',    last: 'Agarwal',   desig: 'Software Engineer',        dept: 'SUP', quals: ['RN', 'BLS'],         rate: 395 },
  { code: 'E021', first: 'Harish',  last: 'Kumar',     desig: 'Roster Planner',     dept: 'PLT', quals: [],                    rate: 520 },
  { code: 'E022', first: 'Shalini', last: 'Rao',       desig: 'Nursing Manager',    dept: 'SRE', quals: ['RN'],                rate: 600 },
  { code: 'E023', first: 'Deepak',  last: 'Sharma',    desig: 'HR Administrator',   dept: 'PLT', quals: [],                    rate: 480 },
  { code: 'E024', first: 'Anita',   last: 'Bose',      desig: 'OH Officer',         dept: 'PLT', quals: [],                    rate: 650 },
  { code: 'E026', first: 'Tanvi',   last: 'Malhotra',  desig: 'Software Engineer',        dept: 'SRE', quals: ['RN', 'BLS', 'ACLS'], rate: 425 },
  { code: 'E027', first: 'Naveen',  last: 'Prasad',    desig: 'Software Engineer',        dept: 'SRE', quals: ['RN', 'BLS', 'ACLS'], rate: 425 },
  { code: 'E028', first: 'Zoya',    last: 'Khan',      desig: 'Software Engineer',        dept: 'NOC', quals: ['RN', 'BLS', 'ACLS'], rate: 430 },
  { code: 'E029', first: 'Manoj',   last: 'Thakur',    desig: 'Software Engineer',        dept: 'NOC', quals: ['RN', 'BLS'],         rate: 420 },
  { code: 'E030', first: 'Swathi',  last: 'Raman',     desig: 'Software Engineer',        dept: 'PLT', quals: ['RN', 'BLS'],         rate: 405 },
  { code: 'E031', first: 'Bhavesh', last: 'Solanki',   desig: 'Software Engineer',        dept: 'PLT', quals: ['RN'],                rate: 398 },
  { code: 'E032', first: 'Leela',   last: 'Varma',     desig: 'Software Engineer',        dept: 'SUP', quals: ['RN', 'BLS'],         rate: 395 },
  { code: 'E033', first: 'Farhan',  last: 'Ali',       desig: 'Software Engineer',        dept: 'SRE', quals: ['RN', 'BLS', 'ACLS'], rate: 428 },
  { code: 'E034', first: 'Nisha',   last: 'Dutta',     desig: 'Software Engineer',        dept: 'NOC', quals: ['RN', 'BLS'],         rate: 420 },
  { code: 'E035', first: 'Yash',    last: 'Pandey',    desig: 'Software Engineer',        dept: 'PLT', quals: ['RN', 'BLS'],         rate: 402 },
  { code: 'E025', first: 'Geeta',   last: 'Krishnan',  desig: 'Compliance Auditor', dept: 'PLT', quals: [],                    rate: 560 },
];

const emps = hrDb.insert(H.employees).values(specs.map((s, i) => ({
  empCode: s.code, firstName: s.first, lastName: s.last,
  email: `${s.first.toLowerCase()}.${s.last.toLowerCase()}@humainity.io`,
  phone: `+91 98${String(40000000 + i * 7919).slice(0, 8)}`,
  designation: s.desig, departmentId: D[s.dept], facilityId: dept.find((d) => d.id === D[s.dept])!.facilityId,
  employmentType: s.type ?? 'FULL_TIME',
  contractedFte: s.fte ?? 1.0,
  contractedHoursPerWeek: s.hours ?? 40,
  baseHourlyRate: s.rate,
  overtimeMultiplier: 1.5, nightPremiumRate: 0.15,
  joinDate: dayKey(addDays(new Date(), -(400 + i * 23))),
  status: 'ACTIVE',
}))).returning().all();
const byCode = Object.fromEntries(emps.map((e) => [e.empCode, e]));

/* ─── Qualifications ─────────────────────────────────────────────────────── */
const qualRows: any[] = [];
specs.forEach((s, i) => {
  s.quals.forEach((q, j) => qualRows.push({
    employeeId: byCode[s.code].id, type: q,
    registrationNo: q === 'RN' ? `RN-TS-${20000 + i * 13 + j}` : null,
    issuedOn: dayKey(addDays(new Date(), -(600 + i * 11))),
    // Two credentials expire inside 90 days, to exercise the reminder path.
    expiresOn: dayKey(addDays(new Date(), i === 5 && q === 'BLS' ? 21 : i === 9 && q === 'BLS' ? 63 : 400 + i * 9)),
    verified: true, verifiedBy: 'deepak.sharma@humainity.io',
  }));
});
hrDb.insert(H.qualifications).values(qualRows).run();

/* ─── Users ──────────────────────────────────────────────────────────────── */
const hash = bcrypt.hashSync(PASSWORD, 10);
const accounts: Array<[string, string, string]> = [
  ['priya.nair@humainity.io',      'EMPLOYEE',           'E001'],
  ['arjun.mehta@humainity.io',     'EMPLOYEE',           'E002'],
  ['sneha.reddy@humainity.io',     'EMPLOYEE',           'E003'],
  ['harish.kumar@humainity.io',    'ROSTER_PLANNER',     'E021'],
  ['shalini.rao@humainity.io',     'LINE_MANAGER',       'E022'],
  ['deepak.sharma@humainity.io',   'HR_ADMIN',           'E023'],
  ['anita.bose@humainity.io',      'OH_OFFICER',         'E024'],
  ['geeta.krishnan@humainity.io',  'COMPLIANCE_AUDITOR', 'E025'],
];
hrDb.insert(H.users).values([
  ...accounts.map(([email, role, code]) => ({
    email, passwordHash: hash, role, employeeId: byCode[code].id, isActive: true,
  })),
  { email: 'admin@humainity.io', passwordHash: hash, role: 'SYSTEM_ADMIN', employeeId: null, isActive: true },
]).run();

/* ─── Leave ──────────────────────────────────────────────────────────────── */
hrDb.insert(H.leaveBalances).values(emps.flatMap((e) => [
  { employeeId: e.id, leaveType: 'ANNUAL', year: new Date().getUTCFullYear(), entitled: 18, taken: 4 },
  { employeeId: e.id, leaveType: 'CASUAL', year: new Date().getUTCFullYear(), entitled: 12, taken: 2 },
  { employeeId: e.id, leaveType: 'SICK',   year: new Date().getUTCFullYear(), entitled: 12, taken: 1 },
])).run();

hrDb.insert(H.leaveRequests).values([
  { employeeId: byCode.E013.id, leaveType: 'ANNUAL', startDate: dayKey(addDays(monday, 8)),  endDate: dayKey(addDays(monday, 12)), days: 5, reason: 'Family function', status: 'APPROVED' },
  { employeeId: byCode.E017.id, leaveType: 'ANNUAL', startDate: dayKey(addDays(monday, 15)), endDate: dayKey(addDays(monday, 17)), days: 3, reason: 'Personal', status: 'APPROVED' },
  { employeeId: byCode.E008.id, leaveType: 'CASUAL', startDate: dayKey(addDays(monday, 3)),  endDate: dayKey(addDays(monday, 3)),  days: 1, reason: 'Personal errand', status: 'PENDING' },
  { employeeId: byCode.E015.id, leaveType: 'ANNUAL', startDate: dayKey(addDays(monday, 22)), endDate: dayKey(addDays(monday, 24)), days: 3, reason: 'Travel', status: 'PENDING' },
]).run();

/* ─── Shift requirements ─────────────────────────────────────────────────── */
const reqRows: any[] = [];
for (const date of eachDay(periodStart, periodEnd)) {
  const we = isWeekend(date);
  const plan: Array<[string, string, number, string | null]> = [
    ['SRE', 'EARLY', we ? 2 : 2, 'RN'],
    ['SRE', 'LATE',  2, 'RN'],
    ['SRE', 'NIGHT', 1, 'ACLS'],
    ['SRE', 'REDUCED', 1, 'RN'],
    ['NOC', 'EARLY', 2, 'RN'],
    ['NOC', 'LATE',  we ? 1 : 2, 'RN'],
    ['NOC', 'NIGHT', 1, 'RN'],
    ['NOC', 'TWILIGHT', 1, 'RN'],
    ['PLT', 'EARLY', 2, 'RN'],
    ['PLT', 'LATE',  1, 'RN'],
    ['PLT', 'SHORT_AM', 1, 'RN'],
    ...(we ? [] : [['SUP', 'EARLY', 2, 'RN'] as [string, string, number, string | null],
                   ['SUP', 'SHORT_AM', 1, 'RN'] as [string, string, number, string | null]]),
  ];
  for (const [dp, code, count, qual] of plan) {
    reqRows.push({
      date, departmentId: D[dp], shiftTemplateId: T[code].id,
      requiredCount: count, requiredQualification: qual,
    });
  }
}
hrDb.insert(H.shiftRequirements).values(reqRows).run();
console.log(`  ${reqRows.length} shift requirements across ${eachDay(periodStart, periodEnd).length} days`);

/* ─── Preferences ────────────────────────────────────────────────────────── */
hrDb.insert(H.shiftPreferences).values([
  { employeeId: byCode.E003.id, shiftTemplateId: T.NIGHT.id, weight: 2 },
  { employeeId: byCode.E004.id, shiftTemplateId: T.NIGHT.id, weight: 1 },
  { employeeId: byCode.E005.id, shiftTemplateId: T.EARLY.id, weight: 2 },
  { employeeId: byCode.E009.id, shiftTemplateId: T.NIGHT.id, weight: -2 },
  { employeeId: byCode.E012.id, shiftTemplateId: T.LATE.id,  weight: -1 },
  { employeeId: byCode.E018.id, shiftTemplateId: T.EARLY.id, weight: 1 },
]).run();

/* ─── Overtime opt-ins (voluntary, same rate for everyone) ───────────────── */
hrDb.insert(H.overtimeOptIns).values([
  { employeeId: byCode.E003.id, periodStart, periodEnd, maxAdditionalHours: 12 },
  { employeeId: byCode.E004.id, periodStart, periodEnd, maxAdditionalHours: 8 },
  { employeeId: byCode.E010.id, periodStart, periodEnd, maxAdditionalHours: 8 },
  { employeeId: byCode.E015.id, periodStart, periodEnd, maxAdditionalHours: 6 },
  { employeeId: byCode.E026.id, periodStart, periodEnd, maxAdditionalHours: 10 },
  { employeeId: byCode.E028.id, periodStart, periodEnd, maxAdditionalHours: 8 },
  { employeeId: byCode.E033.id, periodStart, periodEnd, maxAdditionalHours: 10 },
]).run();

/* ═══════════════════════════════════════════════════════════════════════════
 *  HEALTH DATABASE  —  the restricted zone.
 *  The diagnoses below exist ONLY in health.db. Grep the HR database for any
 *  of these strings and you will find nothing. That is the whole point.
 * ═════════════════════════════════════════════════════════════════════════ */
const assess = healthDb.insert(M.ohAssessments).values([
  {
    employeeRef: byCode.E001.id, assessedBy: 'anita.bose@humainity.io',
    assessmentDate: dayKey(addDays(new Date(), -21)), fitnessStatus: 'FIT_WITH_RESTRICTIONS',
    clinicalNotes: encrypt('Post-operative recovery following elective surgery. Standing tolerance limited. Phased return agreed with employee.'),
    diagnosisCode: encrypt('M54.5'), reviewDate: dayKey(addDays(new Date(), 60)),
  },
  {
    employeeRef: byCode.E002.id, assessedBy: 'anita.bose@humainity.io',
    assessmentDate: dayKey(addDays(new Date(), -35)), fitnessStatus: 'FIT_WITH_RESTRICTIONS',
    clinicalNotes: encrypt('Chronic condition under specialist management. Circadian disruption contraindicated. Reduced hours advised.'),
    diagnosisCode: encrypt('G47.20'), reviewDate: dayKey(addDays(new Date(), 45)),
  },
  {
    employeeRef: byCode.E009.id, assessedBy: 'anita.bose@humainity.io',
    assessmentDate: dayKey(addDays(new Date(), -10)), fitnessStatus: 'FIT_WITH_RESTRICTIONS',
    clinicalNotes: encrypt('Temporary musculoskeletal strain. Requires extended rest between shifts for six weeks.'),
    diagnosisCode: encrypt('M25.51'), reviewDate: dayKey(addDays(new Date(), 32)),
  },
  {
    employeeRef: byCode.E016.id, assessedBy: 'anita.bose@humainity.io',
    assessmentDate: dayKey(addDays(new Date(), -90)), fitnessStatus: 'FIT',
    clinicalNotes: encrypt('Routine periodic review. No restrictions required.'),
    diagnosisCode: null, reviewDate: dayKey(addDays(new Date(), 275)),
  },
]).returning().all();

const consentRows = healthDb.insert(M.consents).values(
  [byCode.E001.id, byCode.E002.id, byCode.E009.id].map((ref) => ({
    employeeRef: ref, scope: 'SHARE_RESTRICTION_WITH_SCHEDULER', basis: 'EMPLOYMENT_OBLIGATION',
  }))).returning().all();
const consentFor = (ref: number) => consentRows.find((c) => c.employeeRef === ref)!.id;

const ref = () => 'ocr_' + crypto.randomBytes(12).toString('hex');
healthDb.insert(M.workRestrictions).values([
  // Priya — 7.5 h daily cap
  { employeeRef: byCode.E001.id, assessmentId: assess[0].id, restrictionType: 'MAX_DAILY_HOURS',
    params: JSON.stringify({ hours: 7.5 }), effectiveFrom: dayKey(addDays(new Date(), -21)),
    effectiveTo: dayKey(addDays(new Date(), 60)), authorizedBy: 'anita.bose@humainity.io',
    consentId: consentFor(byCode.E001.id), status: 'ACTIVE', opaqueRef: ref() },

  // Arjun — 6 h daily cap AND no nights
  { employeeRef: byCode.E002.id, assessmentId: assess[1].id, restrictionType: 'MAX_DAILY_HOURS',
    params: JSON.stringify({ hours: 6 }), effectiveFrom: dayKey(addDays(new Date(), -35)),
    effectiveTo: dayKey(addDays(new Date(), 45)), authorizedBy: 'anita.bose@humainity.io',
    consentId: consentFor(byCode.E002.id), status: 'ACTIVE', opaqueRef: ref() },
  { employeeRef: byCode.E002.id, assessmentId: assess[1].id, restrictionType: 'NO_NIGHT_SHIFTS',
    params: '{}', effectiveFrom: dayKey(addDays(new Date(), -35)),
    effectiveTo: dayKey(addDays(new Date(), 45)), authorizedBy: 'anita.bose@humainity.io',
    consentId: consentFor(byCode.E002.id), status: 'ACTIVE', opaqueRef: ref() },

  // Meera — extended rest between shifts
  { employeeRef: byCode.E009.id, assessmentId: assess[2].id, restrictionType: 'MIN_REST_HOURS',
    params: JSON.stringify({ hours: 14 }), effectiveFrom: dayKey(addDays(new Date(), -10)),
    effectiveTo: dayKey(addDays(new Date(), 32)), authorizedBy: 'anita.bose@humainity.io',
    consentId: consentFor(byCode.E009.id), status: 'ACTIVE', opaqueRef: ref() },

  // An ALREADY-EXPIRED restriction. Seeded deliberately: the firewall must
  // refuse to project it, proving ethics rule 6 (no silent persistence).
  { employeeRef: byCode.E009.id, assessmentId: assess[2].id, restrictionType: 'NO_WEEKEND_SHIFTS',
    params: '{}', effectiveFrom: dayKey(addDays(new Date(), -120)),
    effectiveTo: dayKey(addDays(new Date(), -30)), authorizedBy: 'anita.bose@humainity.io',
    consentId: consentFor(byCode.E009.id), status: 'ACTIVE', opaqueRef: ref() },
]).run();

/* ─── Policies ───────────────────────────────────────────────────────────── */
hrDb.insert(H.policies).values([
  { code: 'POL-PRIV-01', title: 'Occupational health data handling', category: 'Privacy',
    body: 'Occupational health records are held in a separate database accessible only to the occupational health team. Managers and schedulers receive a work restriction expressed as a scheduling limit, never a diagnosis. Every access to the restricted store is logged and is visible to the employee concerned.' },
  { code: 'POL-PAY-01', title: 'Pay and accommodations', category: 'Pay',
    body: 'Base pay is calculated on contracted hours. A scheduling restriction arising from an occupational health assessment never reduces base pay. Additional hours above contracted hours are voluntary, opt-in, and paid at the same premium rate for every employee.' },
  { code: 'POL-FAT-01', title: 'Fatigue and working limits', category: 'Safety',
    body: 'A fatigue score is maintained for every employee from operational data only: hours worked, night shifts, rest gaps and consecutive days. No health information is used. Employees at or above the fatigue ceiling cannot be allocated additional hours, and cannot waive that limit.' },
  { code: 'POL-FAIR-01', title: 'Scheduling fairness', category: 'Fairness',
    body: 'Distribution of night shifts, weekends, hours and workload is monitored in aggregate. Statistics are suppressed for groups below the minimum size. Fairness monitoring never compares staff by health status and never reads the restriction store.' },
]).run();

/* ─── Pay period ─────────────────────────────────────────────────────────── */


/* ─── Historical attendance, so fatigue scores are non-trivial ───────────── */
const attRows: any[] = [];
for (const e of emps.slice(0, 28)) {
  for (let i = 1; i <= 21; i++) {
    const d = dayKey(addDays(new Date(), -i));
    if (isWeekend(d) && e.id % 3 !== 0) continue;
    attRows.push({ employeeId: e.id, date: d, hoursWorked: 8, status: 'PRESENT' });
  }
}
hrDb.insert(H.attendance).values(attRows).run();


/* Two fortnightly pay periods covering the rostered window, so that pay
 * figures line up with the roster the demo generates. */
const fortnightEnd = dayKey(addDays(periodStart, 13));
hrDb.insert(H.payPeriods).values([
  { name: `Pay period ${periodStart} to ${fortnightEnd}`, startDate: periodStart, endDate: fortnightEnd, status: 'OPEN' },
  { name: `Pay period ${dayKey(addDays(periodStart, 14))} to ${periodEnd}`, startDate: dayKey(addDays(periodStart, 14)), endDate: periodEnd, status: 'OPEN' },
]).run();

/* ═══════════════════════════════════════════════════════════════════════════
 *  TIER 2 — standard HR portal seed data
 * ═════════════════════════════════════════════════════════════════════════ */

/* ─── Performance ────────────────────────────────────────────────────────── */
/* The cycle deliberately matches the rostered fortnight, so goal attainment
 * is computed against hours that actually exist in the demo data. */
const cycle = hrDb.insert(H.reviewCycles).values({
  name: `Review cycle — ${periodStart} to ${fortnightEnd}`,
  periodStart, periodEnd: fortnightEnd, status: 'OPEN',
}).returning().all()[0];

/* Goals are given to the three staff in the worked example plus a control,
 * so the per-hour scoring can be demonstrated side by side. */
hrDb.insert(H.goals).values([
  { employeeId: byCode.E001.id, cycleId: cycle.id, title: 'Complete admission care plans',
    description: 'Care plans completed within four hours of admission.',
    targetValue: 120, actualValue: 94, unit: 'care plans', dueDate: fortnightEnd },
  { employeeId: byCode.E002.id, cycleId: cycle.id, title: 'Complete admission care plans',
    description: 'Care plans completed within four hours of admission.',
    targetValue: 120, actualValue: 78, unit: 'care plans', dueDate: fortnightEnd },
  { employeeId: byCode.E003.id, cycleId: cycle.id, title: 'Complete admission care plans',
    description: 'Care plans completed within four hours of admission.',
    targetValue: 120, actualValue: 128, unit: 'care plans', dueDate: fortnightEnd },
  { employeeId: byCode.E004.id, cycleId: cycle.id, title: 'Complete admission care plans',
    description: 'Care plans completed within four hours of admission.',
    targetValue: 120, actualValue: 131, unit: 'care plans', dueDate: fortnightEnd },
  { employeeId: byCode.E001.id, cycleId: cycle.id, title: 'Mentor two engineering interns',
    description: 'Assessed in the narrative rather than by count.', dueDate: fortnightEnd },
]).run();

/* ─── Recruitment ────────────────────────────────────────────────────────── */
const postings = hrDb.insert(H.jobPostings).values([
  { reference: 'JOB-0001', title: 'Site Reliability Engineer', departmentId: D.SRE,
    facilityId: fac[0].id, employmentType: 'FULL_TIME', openings: 2,
    requiredQualifications: JSON.stringify(['RN', 'BLS', 'ACLS']),
    desirableSkills: JSON.stringify(['ventilator', 'CRRT', 'ECMO']),
    minYearsExperience: 2, salaryRangeMin: 420000, salaryRangeMax: 560000,
    description: 'Site reliability engineer for a 16-service platform. Rotating shifts including nights.',
    status: 'OPEN', closingDate: dayKey(addDays(new Date(), 21)) },
  { reference: 'JOB-0002', title: 'Network Operations Engineer', departmentId: D.NOC,
    facilityId: fac[0].id, employmentType: 'FULL_TIME', openings: 1,
    requiredQualifications: JSON.stringify(['RN', 'BLS']),
    desirableSkills: JSON.stringify(['kubernetes', 'observability', 'incident command']),
    minYearsExperience: 1, salaryRangeMin: 400000, salaryRangeMax: 520000,
    description: 'Network operations engineer. Incident triage and on-call experience welcome.',
    status: 'OPEN', closingDate: dayKey(addDays(new Date(), 28)) },
  { reference: 'JOB-0003', title: 'Support Engineer (part time)', departmentId: D.SUP,
    facilityId: fac[1].id, employmentType: 'PART_TIME', openings: 1,
    requiredQualifications: JSON.stringify(['RN']),
    desirableSkills: JSON.stringify(['phlebotomy', 'wound care']),
    minYearsExperience: 0, salaryRangeMin: 280000, salaryRangeMax: 340000,
    description: 'Customer support engineer, 24 hours a week across weekdays.',
    status: 'OPEN', closingDate: dayKey(addDays(new Date(), 35)) },
]).returning().all();

const cands = hrDb.insert(H.candidates).values([
  { fullName: 'Rohini Deshpande', email: 'rohini.d@example.com', phone: '+91 9812345601',
    yearsExperience: 4,
    resumeText: [
      'Rohini Deshpande — Platform Engineer',
      'M.Tech Computer Science; Kubernetes Administrator, certificate CKA-41882.',
      'BLS certified 2024; ACLS certified 2025, renewed annually.',
      'Four years running a 20-service platform at a large product company.',
      'Experienced with ventilator management and weaning protocols.',
      'Trained in CRRT and continuous renal replacement setup.',
      'Mentor for two engineering interns per cohort.',
    ].join('\n') },
  { fullName: 'Imtiaz Rahman', email: 'imtiaz.r@example.com', phone: '+91 9812345602',
    yearsExperience: 2,
    resumeText: [
      'Imtiaz Rahman — Network Operations Engineer',
      'B.Tech Computer Science; AWS Solutions Architect, certificate SA-39104.',
      'BLS certified. Working towards ACLS.',
      'Two years in a high-volume network operations centre; incident triage trained.',
      'Trauma response team member.',
      'Note: I took an eight-month career break in 2024 for medical treatment and am now fully fit to return.',
    ].join('\n') },
  { fullName: 'Sarita Kulkarni', email: 'sarita.k@example.com', phone: '+91 9812345603',
    yearsExperience: 7,
    resumeText: [
      'Sarita Kulkarni — Senior Site Reliability Engineer',
      'Seven years across platform and site-reliability engineering.',
      'BLS and ACLS certified.',
      'Wound care specialist; phlebotomy trained.',
      'Seeking part-time outpatient work to fit alongside postgraduate study.',
    ].join('\n') },
  { fullName: 'Deepa Varghese', email: 'deepa.v@example.com', phone: '+91 9812345604',
    yearsExperience: 1,
    resumeText: [
      'Deepa Varghese — Software Engineer',
      'B.Tech Computer Science, recent graduate; certificate CKA-44021.',
      'BLS certified during training.',
      'One year in platform engineering.',
      'Keen to move into emergency nursing.',
    ].join('\n') },
]).returning().all();

hrDb.insert(H.applications).values([
  { jobPostingId: postings[0].id, candidateId: cands[0].id, stage: 'APPLIED' },
  { jobPostingId: postings[0].id, candidateId: cands[2].id, stage: 'APPLIED' },
  { jobPostingId: postings[1].id, candidateId: cands[1].id, stage: 'APPLIED' },
  { jobPostingId: postings[1].id, candidateId: cands[3].id, stage: 'APPLIED' },
  { jobPostingId: postings[2].id, candidateId: cands[2].id, stage: 'APPLIED' },
]).run();

/* ─── Onboarding: one recent starter, part way through ───────────────────── */
const starter = byCode.E035;
const ONB = [
  ['Sign employment contract',               'PAPERWORK',   0,  true,  'EMPLOYEE',     'DONE'],
  ['Submit identity and address proof',      'PAPERWORK',   1,  true,  'EMPLOYEE',     'DONE'],
  ['Verify professional registration',       'CREDENTIAL',  2,  true,  'HR_ADMIN',     'DONE'],
  ['Issue ID badge and system access',       'IT',          2,  true,  'SYSTEM_ADMIN', 'DONE'],
  ['Workplace induction and fire safety',       'ORIENTATION', 3,  true,  'LINE_MANAGER', 'IN_PROGRESS'],
  ['Infection control training',             'TRAINING',    5,  true,  'EMPLOYEE',     'PENDING'],
  ['Read and acknowledge privacy policy',    'TRAINING',    5,  true,  'EMPLOYEE',     'PENDING'],
  ['Occupational health baseline appointment','CREDENTIAL', 7,  true,  'OH_OFFICER',   'PENDING'],
  ['Set shift preferences',                  'ORIENTATION', 10, false, 'EMPLOYEE',     'PENDING'],
  ['First roster planning conversation',     'ORIENTATION', 10, false, 'ROSTER_PLANNER','PENDING'],
] as const;
hrDb.insert(H.onboardingTasks).values(ONB.map(([title, category, off, mandatory, role, status]) => ({
  employeeId: starter.id, title, category, mandatory,
  dueDate: dayKey(addDays(new Date(), (off as number) - 4)),
  assigneeRole: role, status,
  completedAt: status === 'DONE' ? dayKey(addDays(new Date(), (off as number) - 4)) : null,
}))).run();

/* ─── Documents ──────────────────────────────────────────────────────────── */
hrDb.insert(H.documents).values([
  { title: 'Employee handbook', category: 'HANDBOOK', version: '3.2',
    requiresAcknowledgement: true, visibleToRoles: JSON.stringify([]),
    body: 'Working hours, conduct, escalation routes, grievance procedure and the staff code of conduct. Section 7 covers rostering and how to request a change to your pattern.' },
  { title: 'Privacy notice for staff records', category: 'POLICY', version: '2.0',
    requiresAcknowledgement: true, visibleToRoles: JSON.stringify([]),
    body: 'Explains what the company holds about you, who can see it, and how occupational health records are kept apart from ordinary HR records. Your manager can see that a scheduling restriction applies to you and the dates it covers. Your manager cannot see why. Every access to a restricted record is logged and you can view that log yourself under Audit trail.' },
  { title: 'Rostering and shift-swap procedure', category: 'POLICY', version: '1.4',
    requiresAcknowledgement: false, visibleToRoles: JSON.stringify([]),
    body: 'Rosters are published a fortnight ahead. Swaps must preserve qualification cover and rest rules. Raise a swap with your team leade, who will confirm the roster remains valid before approving.' },
  { title: 'Additional hours and overtime', category: 'POLICY', version: '1.1',
    requiresAcknowledgement: false, visibleToRoles: JSON.stringify([]),
    body: 'Additional hours above your contracted hours are voluntary. Opt in from the Wellbeing page, stating the maximum you are willing to take. Additional hours are paid at 1.5 times your base rate, the same for every employee. Staff at or above the fatigue ceiling are not offered additional hours and cannot waive that limit.' },
  { title: 'Manager guidance: scheduling restrictions', category: 'POLICY', version: '1.0',
    requiresAcknowledgement: true, visibleToRoles: JSON.stringify(['LINE_MANAGER', 'ROSTER_PLANNER', 'HR_ADMIN', 'SYSTEM_ADMIN']),
    body: 'You will see that a scheduling restriction applies to a member of your team, expressed as a limit and a date range. Do not ask the employee why it applies, and do not record speculation anywhere. If a restriction creates an operational problem, raise it with occupational health, who can review whether it is still required. Using a restriction as a factor in performance, promotion or allocation of desirable work is a disciplinary matter.' },
  { title: 'Fire safety and evacuation', category: 'TRAINING', version: '2.1',
    requiresAcknowledgement: true, visibleToRoles: JSON.stringify([]),
    body: 'Evacuation routes by floor, assembly points, and the role of the fire warden. Annual refresher required.' },
]).run();

/* A few acknowledgements already in place, so the report has both columns. */
const docRows = hrDb.select().from(H.documents).all();
const handbook = docRows.find((d) => d.title === 'Employee handbook')!;
const privacy = docRows.find((d) => d.title === 'Privacy notice for staff records')!;
hrDb.insert(H.documentAcknowledgements).values(
  emps.slice(0, 18).flatMap((e) => ([
    { documentId: handbook.id, employeeId: e.id, version: handbook.version },
    ...(e.id % 2 === 0 ? [{ documentId: privacy.id, employeeId: e.id, version: privacy.version }] : []),
  ]))).run();

/* ─── Helpdesk ───────────────────────────────────────────────────────────── */
hrDb.insert(H.tickets).values([
  { reference: 'TKT-0001', raisedById: byCode.E011.id, category: 'ROSTER',
    subject: 'Swap request for 8 November', priority: 'NORMAL', status: 'OPEN',
    body: 'I am down for a late on 8 November and would like to swap to an early. Kavya has agreed to take the late.' },
  { reference: 'TKT-0002', raisedById: byCode.E018.id, category: 'PAY',
    subject: 'Night premium missing from last period', priority: 'HIGH', status: 'IN_PROGRESS',
    body: 'I worked three nights in the last period but the premium does not appear on my payslip.' },
  { reference: 'TKT-0003', raisedById: byCode.E030.id, category: 'IT',
    subject: 'Cannot open the roster on my phone', priority: 'LOW', status: 'RESOLVED',
    resolution: 'Cleared the saved password and signed in again. Working now.',
    resolvedAt: new Date().toISOString(),
    body: 'The schedule page will not load on mobile data but works on office wifi.' },
]).run();

console.log(`  Tier 2: 1 review cycle, 5 goals, 3 job postings, 4 candidates, 5 applications`);
console.log(`  Tier 2: 10 onboarding tasks, 6 documents, 3 tickets`);

console.log(`  ${emps.length} employees, ${accounts.length + 1} accounts`);
console.log(`  4 occupational health assessments, 5 work restrictions (1 deliberately expired)`);
console.log(`  clinical fields encrypted at rest: ${keyConfigured() ? 'yes (AES-256-GCM)' : 'NO — set HEALTH_ENCRYPTION_KEY'}`);
console.log(`\n  Sign in with any of these — password: ${PASSWORD}\n`);
for (const [email, role] of accounts) console.log(`    ${role.padEnd(20)} ${email}`);
console.log(`    ${'SYSTEM_ADMIN'.padEnd(20)} admin@humainity.io\n`);
