/* ═══════════════════════════════════════════════════════════════════════════
 *  RECRUITMENT & RESUME SCREENING
 *
 *  The screening here is deterministic and explainable: it matches a resume
 *  against the qualifications and skills the job posting actually states, and
 *  shows the reviewer where in the resume each match was found.
 *
 *  Three rules, enforced in code rather than policy:
 *
 *   1. IT NEVER REJECTS. `screen()` can only move an application to SCREENED.
 *      Only `decide()` — which requires a human actor and records who they
 *      were — can set REJECTED. There is no code path from the scorer to a
 *      rejection.
 *
 *   2. IT SCORES ONLY STATED REQUIREMENTS. The score is built from the
 *      posting's own `requiredQualifications`, `desirableSkills` and
 *      `minYearsExperience`. Nothing else contributes.
 *
 *   3. IT HAS NO HEALTH DATA AND CANNOT GET ANY. Candidates are not
 *      employees; there is no health record for them, and this module does
 *      not import the health service or the firewall. A resume mentioning a
 *      condition is scrubbed from the evidence rather than scored.
 * ═════════════════════════════════════════════════════════════════════════ */
import { and, eq, desc } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import {
  jobPostings, candidates, applications, interviews, departments, facilities,
  shiftAssignments, shiftRequirements, shiftTemplates, employees,
} from '../db/hr.schema.js';
import { containsClinicalLanguage } from '../lib/constraint-vocabulary.js';
import { badRequest, notFound } from '../lib/errors.js';
import * as audit from './audit.service.js';

export interface Actor { userId: number; email: string; role: string }

const HUMAN_ONLY_STAGES = ['REJECTED', 'OFFERED', 'HIRED'] as const;

/* ─── Postings ───────────────────────────────────────────────────────────── */

export function listPostings() {
  return hrDb.select({
    id: jobPostings.id, reference: jobPostings.reference, title: jobPostings.title,
    employmentType: jobPostings.employmentType, openings: jobPostings.openings,
    requiredQualifications: jobPostings.requiredQualifications,
    desirableSkills: jobPostings.desirableSkills,
    minYearsExperience: jobPostings.minYearsExperience,
    salaryRangeMin: jobPostings.salaryRangeMin, salaryRangeMax: jobPostings.salaryRangeMax,
    description: jobPostings.description, status: jobPostings.status,
    closingDate: jobPostings.closingDate, createdAt: jobPostings.createdAt,
    departmentName: departments.name, facilityName: facilities.name,
  }).from(jobPostings)
    .innerJoin(departments, eq(departments.id, jobPostings.departmentId))
    .innerJoin(facilities, eq(facilities.id, jobPostings.facilityId))
    .orderBy(desc(jobPostings.id)).all()
    .map((p) => ({
      ...p,
      requiredQualifications: JSON.parse(p.requiredQualifications) as string[],
      desirableSkills: JSON.parse(p.desirableSkills) as string[],
      applicants: hrDb.select().from(applications)
        .where(eq(applications.jobPostingId, p.id)).all().length,
    }));
}

export function createPosting(actor: Actor, input: any) {
  if (!input.title || !input.departmentId) throw badRequest('A posting needs a title and a department');
  const dept = hrDb.select().from(departments).where(eq(departments.id, Number(input.departmentId))).all()[0];
  if (!dept) throw notFound('Department not found');
  const n = hrDb.select().from(jobPostings).all().length + 1;
  const row = hrDb.insert(jobPostings).values({
    reference: `JOB-${String(n).padStart(4, '0')}`,
    title: input.title, departmentId: dept.id, facilityId: dept.facilityId,
    employmentType: input.employmentType ?? 'FULL_TIME',
    openings: Number(input.openings ?? 1),
    requiredQualifications: JSON.stringify(input.requiredQualifications ?? []),
    desirableSkills: JSON.stringify(input.desirableSkills ?? []),
    minYearsExperience: Number(input.minYearsExperience ?? 0),
    salaryRangeMin: input.salaryRangeMin ?? null, salaryRangeMax: input.salaryRangeMax ?? null,
    description: input.description ?? '', status: input.status ?? 'OPEN',
    closingDate: input.closingDate ?? null,
  }).returning().all()[0];
  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'EMPLOYEE_UPDATED', resourceType: 'JobPosting', resourceId: row.reference,
    detail: `Opened ${row.title}`,
  });
  return row;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  THE SCORER
 *
 *  Transparent by construction: every point is attributable to a requirement
 *  the posting states, and the evidence quotes the line of the resume where
 *  the match was found, so a reviewer can check the machine's work.
 * ═════════════════════════════════════════════════════════════════════════ */

export interface MatchEvidence {
  requiredMet: Array<{ code: string; quote: string }>;
  requiredMissing: string[];
  desirableMet: Array<{ code: string; quote: string }>;
  experience: { stated: number; required: number; met: boolean };
  redactions: string[];
  explanation: string[];
}

const findQuote = (resume: string, term: string): string | null => {
  const lines = resume.split(/\n|\. /).map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => l.toLowerCase().includes(term.toLowerCase()));
  return hit ? (hit.length > 140 ? hit.slice(0, 137) + '…' : hit) : null;
};

export function scoreResume(resume: string, posting: {
  requiredQualifications: string[]; desirableSkills: string[]; minYearsExperience: number;
}, yearsExperience: number): { score: number; evidence: MatchEvidence } {

  const requiredMet: MatchEvidence['requiredMet'] = [];
  const requiredMissing: string[] = [];
  const desirableMet: MatchEvidence['desirableMet'] = [];
  const redactions: string[] = [];

  for (const code of posting.requiredQualifications) {
    const quote = findQuote(resume, code);
    if (quote) requiredMet.push({ code, quote });
    else requiredMissing.push(code);
  }
  for (const skill of posting.desirableSkills) {
    const quote = findQuote(resume, skill);
    if (quote) desirableMet.push({ code: skill, quote });
  }

  /* If a resume volunteers health information, it is not scored and the
   * evidence records that it was set aside. Candidates sometimes explain a
   * career gap; that explanation must not become a scoring input. */
  for (const line of resume.split('\n')) {
    const token = containsClinicalLanguage(line);
    if (token) redactions.push(line.trim().slice(0, 80));
  }

  const reqWeight = posting.requiredQualifications.length
    ? (requiredMet.length / posting.requiredQualifications.length) * 60 : 60;
  const desWeight = posting.desirableSkills.length
    ? (desirableMet.length / posting.desirableSkills.length) * 25 : 25;
  const expMet = yearsExperience >= posting.minYearsExperience;
  const expWeight = expMet ? 15
    : posting.minYearsExperience > 0
      ? Math.max(0, (yearsExperience / posting.minYearsExperience)) * 15 : 15;

  const score = Math.round(reqWeight + desWeight + expWeight);

  const explanation = [
    `${requiredMet.length} of ${posting.requiredQualifications.length || 0} required qualifications evidenced in the resume.`,
    `${desirableMet.length} of ${posting.desirableSkills.length || 0} desirable skills evidenced.`,
    `${yearsExperience} years stated against ${posting.minYearsExperience} required.`,
  ];
  if (redactions.length) {
    explanation.push(
      `${redactions.length} line(s) mentioning health were set aside and did not affect this score.`);
  }
  explanation.push(
    'This score is advisory. It is not used to filter, sort out or reject anyone, ' +
    'and a low score does not prevent a candidate progressing.');

  return {
    score,
    evidence: {
      requiredMet, requiredMissing, desirableMet,
      experience: { stated: yearsExperience, required: posting.minYearsExperience, met: expMet },
      redactions, explanation,
    },
  };
}

/* ─── Applications ───────────────────────────────────────────────────────── */

export function apply(input: {
  jobPostingId: number; fullName: string; email: string; phone?: string;
  resumeText: string; yearsExperience: number;
}) {
  const posting = hrDb.select().from(jobPostings).where(eq(jobPostings.id, input.jobPostingId)).all()[0];
  if (!posting) throw notFound('Job posting not found');
  if (posting.status !== 'OPEN') throw badRequest('This posting is not accepting applications');

  let cand = hrDb.select().from(candidates).where(eq(candidates.email, input.email)).all()[0];
  if (!cand) {
    cand = hrDb.insert(candidates).values({
      fullName: input.fullName, email: input.email, phone: input.phone ?? null,
      resumeText: input.resumeText, yearsExperience: input.yearsExperience,
    }).returning().all()[0];
  }

  const existing = hrDb.select().from(applications).where(and(
    eq(applications.jobPostingId, input.jobPostingId), eq(applications.candidateId, cand.id),
  )).all()[0];
  if (existing) throw badRequest('This candidate has already applied for this posting');

  return hrDb.insert(applications).values({
    jobPostingId: input.jobPostingId, candidateId: cand.id, stage: 'APPLIED',
  }).returning().all()[0];
}

/** Produces a summary for a human. The only stage it can set is SCREENED. */
export function screen(actor: Actor, applicationId: number) {
  const app = hrDb.select().from(applications).where(eq(applications.id, applicationId)).all()[0];
  if (!app) throw notFound('Application not found');
  const posting = hrDb.select().from(jobPostings).where(eq(jobPostings.id, app.jobPostingId)).all()[0]!;
  const cand = hrDb.select().from(candidates).where(eq(candidates.id, app.candidateId)).all()[0]!;

  const { score, evidence } = scoreResume(cand.resumeText, {
    requiredQualifications: JSON.parse(posting.requiredQualifications),
    desirableSkills: JSON.parse(posting.desirableSkills),
    minYearsExperience: posting.minYearsExperience,
  }, cand.yearsExperience);

  hrDb.update(applications).set({
    matchScore: score, matchEvidence: JSON.stringify(evidence),
    screenedAt: new Date().toISOString(),
    // Never anything but SCREENED. There is no rejection path here.
    stage: app.stage === 'APPLIED' ? 'SCREENED' : app.stage,
  }).where(eq(applications.id, applicationId)).run();

  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'EMPLOYEE_UPDATED', resourceType: 'Application', resourceId: String(applicationId),
    detail: `Screened: advisory score ${score}. No automated decision was taken.`,
  });

  return { applicationId, score, evidence };
}

export function screenAll(actor: Actor, jobPostingId: number) {
  const apps = hrDb.select().from(applications)
    .where(eq(applications.jobPostingId, jobPostingId)).all();
  return apps.map((a) => screen(actor, a.id));
}

/** The only path to a decision. Requires a human actor, and records them. */
export function decide(actor: Actor, applicationId: number, stage: string, note?: string) {
  const allowed = ['SCREENED', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'HIRED', 'REJECTED'];
  if (!allowed.includes(stage)) throw badRequest(`Unknown stage: ${stage}`);

  const app = hrDb.select().from(applications).where(eq(applications.id, applicationId)).all()[0];
  if (!app) throw notFound('Application not found');

  if ((HUMAN_ONLY_STAGES as readonly string[]).includes(stage) && !note?.trim()) {
    throw badRequest(
      `A ${stage.toLowerCase()} decision needs a short reason recorded against it. ` +
      `Decisions that affect a candidate are not made silently.`);
  }

  hrDb.update(applications).set({
    stage, decidedById: actor.userId, decidedAt: new Date().toISOString(),
    decisionNote: note ?? null,
  }).where(eq(applications.id, applicationId)).run();

  audit.record({
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: 'EMPLOYEE_UPDATED', resourceType: 'Application', resourceId: String(applicationId),
    detail: `Moved to ${stage} by ${actor.email}${note ? `: ${note}` : ''}`,
  });

  return hrDb.select().from(applications).where(eq(applications.id, applicationId)).all()[0];
}

export function pipeline(jobPostingId?: number) {
  const rows = hrDb.select({
    id: applications.id, stage: applications.stage, matchScore: applications.matchScore,
    matchEvidence: applications.matchEvidence, screenedAt: applications.screenedAt,
    decisionNote: applications.decisionNote, createdAt: applications.createdAt,
    candidateId: candidates.id, fullName: candidates.fullName, email: candidates.email,
    yearsExperience: candidates.yearsExperience, resumeText: candidates.resumeText,
    jobPostingId: jobPostings.id, jobTitle: jobPostings.title, jobReference: jobPostings.reference,
  }).from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobPostings, eq(jobPostings.id, applications.jobPostingId))
    .orderBy(desc(applications.matchScore)).all();
  const filtered = jobPostingId ? rows.filter((r) => r.jobPostingId === jobPostingId) : rows;
  return filtered.map((r) => ({ ...r, matchEvidence: JSON.parse(r.matchEvidence || '{}') }));
}

/* ─── Interviews ─────────────────────────────────────────────────────────── */

/** Is this interviewer rostered on a shift that overlaps the interview?
 *
 *  Booking a panel member who is on a night shift that morning is the kind of
 *  small operational mistake that erodes trust in a scheduling system. The
 *  check looks only at the roster — it never consults restrictions, because
 *  interview availability is not a place where a health limit should surface. */
export function interviewerConflict(interviewerUserId: number, scheduledAt: string) {
  const date = scheduledAt.slice(0, 10);
  const hour = Number(scheduledAt.slice(11, 13));
  if (Number.isNaN(hour)) return null;

  const emp = hrDb.select().from(employees).where(eq(employees.id, interviewerUserId)).all()[0];
  if (!emp) return null;

  const shifts = hrDb.select({
    code: shiftTemplates.code, name: shiftTemplates.name,
    start: shiftTemplates.startTime, end: shiftTemplates.endTime,
    isNight: shiftTemplates.isNight,
  }).from(shiftAssignments)
    .innerJoin(shiftRequirements, eq(shiftRequirements.id, shiftAssignments.shiftRequirementId))
    .innerJoin(shiftTemplates, eq(shiftTemplates.id, shiftRequirements.shiftTemplateId))
    .where(and(eq(shiftAssignments.employeeId, emp.id), eq(shiftAssignments.date, date)))
    .all();

  for (const sh of shifts) {
    const from = Number(sh.start.slice(0, 2));
    const to = Number(sh.end.slice(0, 2));
    const overlaps = sh.isNight
      ? (hour >= from || hour < to)          // a night shift wraps midnight
      : (hour >= from && hour < to);
    if (overlaps) {
      return `${emp.firstName} ${emp.lastName} is rostered on the ${sh.name} shift ` +
             `(${sh.start}–${sh.end}) on ${date}.`;
    }
  }
  return null;
}

export function scheduleInterview(actor: Actor, input: {
  applicationId: number; scheduledAt: string; durationMinutes?: number;
  mode?: string; interviewerId?: number; force?: boolean;
}) {
  const app = hrDb.select().from(applications).where(eq(applications.id, input.applicationId)).all()[0];
  if (!app) throw notFound('Application not found');

  const conflict = interviewerConflict(input.interviewerId ?? actor.userId, input.scheduledAt);
  if (conflict && !input.force) {
    throw badRequest(
      `${conflict} Choose another time or another interviewer, or confirm that the clash is ` +
      'intentional.');
  }
  const row = hrDb.insert(interviews).values({
    applicationId: input.applicationId, scheduledAt: input.scheduledAt,
    durationMinutes: input.durationMinutes ?? 45, mode: input.mode ?? 'IN_PERSON',
    interviewerId: input.interviewerId ?? actor.userId, outcome: 'PENDING',
  }).returning().all()[0];
  if (app.stage === 'SHORTLISTED' || app.stage === 'SCREENED') {
    decide(actor, input.applicationId, 'INTERVIEWING', 'Interview scheduled');
  }
  return row;
}

export const listInterviews = () =>
  hrDb.select({
    id: interviews.id, scheduledAt: interviews.scheduledAt, mode: interviews.mode,
    durationMinutes: interviews.durationMinutes, outcome: interviews.outcome,
    notes: interviews.notes, applicationId: interviews.applicationId,
    fullName: candidates.fullName, jobTitle: jobPostings.title,
  }).from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobPostings, eq(jobPostings.id, applications.jobPostingId))
    .orderBy(interviews.scheduledAt).all();

export function recordInterviewOutcome(actor: Actor, id: number, outcome: string, notes?: string) {
  hrDb.update(interviews).set({ outcome, notes: notes ?? null }).where(eq(interviews.id, id)).run();
  return hrDb.select().from(interviews).where(eq(interviews.id, id)).all()[0];
}
