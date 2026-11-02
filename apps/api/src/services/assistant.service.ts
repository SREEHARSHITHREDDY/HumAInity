/* ═══════════════════════════════════════════════════════════════════════════
 *  WORKFORCE ASSISTANT
 *
 *  Deterministic retrieval over the asker's OWN data plus published policy.
 *  There is no language model behind it: every answer is produced from a
 *  matched intent and real rows, and the sources consulted are recorded on
 *  each message so an auditor can confirm what it looked at.
 *
 *  That is a deliberate choice, not a shortcut. An assistant that can be
 *  prompted is an assistant that can be prompted into disclosing something,
 *  and the one thing this platform must never do is answer "why does Arjun
 *  only work six hours?".
 *
 *  Three hard rules:
 *   1. It never imports the health service or the firewall. It cannot read a
 *      diagnosis, a restriction reason, or a wellbeing response.
 *   2. It answers about the ASKER only. There is no path to another named
 *      person's schedule, pay or restrictions.
 *   3. A question that seeks a medical reason is refused explicitly, and the
 *      refusal is logged.
 * ═════════════════════════════════════════════════════════════════════════ */
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import {
  employees, leaveBalances, leaveRequests, qualifications, shiftAssignments,
  shiftRequirements, shiftTemplates, departments, policies, documents,
  payLines, payPeriods, onboardingTasks, assistantMessages, overtimeOptIns,
} from '../db/hr.schema.js';
import { dayKey, addDays } from '../lib/dates.js';
import * as fatigue from './fatigue.service.js';
import * as audit from './audit.service.js';

export interface Actor { userId: number; email: string; role: string; employeeId?: number | null }

export interface Answer {
  answer: string;
  sources: string[];
  refused: boolean;
  suggestions?: string[];
}

/* ── Questions the assistant must refuse ───────────────────────────────────
 * Anything seeking a medical reason, or anything about another person's
 * health. Refusal is explicit and explains where the boundary is, because a
 * vague "I can't help with that" teaches nobody anything.                  */

const SEEKS_MEDICAL_REASON = [
  /why (does|is|can'?t|cannot|doesn'?t) \w+ (only|not|never)/i,
  /what('?s| is) wrong with/i,
  /(diagnos|illness|disease|condition|medical reason|sick with|health problem)/i,
  /why (am i|is (he|she|they)) (restricted|capped|limited)/i,
  /(his|her|their) (health|medical|condition|diagnosis)/i,
  /who (has|is on) (a )?(restriction|accommodation|medical)/i,
];

const ABOUT_SOMEONE_ELSE = /\b(arjun|priya|sneha|vikram|ananya|rahul|fatima|karthik|meera|imran|divya|sanjay|lakshmi|rohit|kavya|neha|aditya|pooja|suresh|ritu|tanvi|naveen|zoya|manoj|swathi|bhavesh|leela|farhan|nisha|yash)\b/i;

export function ask(actor: Actor, question: string): Answer {
  const q = (question ?? '').trim();
  if (!q) return { answer: 'Ask me about your shifts, leave, pay, credentials or a policy.', sources: [], refused: false };

  const lower = q.toLowerCase();
  const sources: string[] = [];

  /* ── Rule 3: refuse anything seeking a medical reason ─────────────────── */
  const seeksMedical = SEEKS_MEDICAL_REASON.some((re) => re.test(q));
  const aboutOther = ABOUT_SOMEONE_ELSE.test(q) && !lower.includes('my ');

  if (seeksMedical) {
    const refusal =
      'I can tell you that a scheduling restriction applies to someone, and the dates it ' +
      'covers, because that is what the roster needs. I cannot tell you why one applies — ' +
      'the reason stays with occupational health and is not reachable from here by anyone, ' +
      'including me. If you need a restriction reviewed, occupational health can do that.';
    log(actor, q, refusal, ['refusal:health-boundary'], true);
    audit.record({
      actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
      action: 'HEALTH_ACCESS_DENIED', resourceType: 'Assistant', outcome: 'DENIED',
      detail: 'Assistant refused a question seeking a medical reason',
    });
    return { answer: refusal, sources: ['refusal:health-boundary'], refused: true };
  }

  if (aboutOther) {
    const refusal =
      'I only answer about your own record. For a colleague’s schedule, ask your line ' +
      'manager or open the roster, which shows who is working when without anything personal.';
    log(actor, q, refusal, ['refusal:own-record-only'], true);
    return { answer: refusal, sources: ['refusal:own-record-only'], refused: true };
  }

  const id = actor.employeeId;
  const emp = id ? hrDb.select().from(employees).where(eq(employees.id, id)).all()[0] : null;

  /* ── Intents ──────────────────────────────────────────────────────────── */

  // Next shift / schedule
  if (/\b(shift|roster|schedul|working|work (today|tomorrow|next))\b/i.test(lower) && emp) {
    const today = dayKey(new Date());
    const rows = hrDb.select({
      date: shiftAssignments.date, hours: shiftAssignments.hours,
      code: shiftTemplates.code, name: shiftTemplates.name,
      start: shiftTemplates.startTime, end: shiftTemplates.endTime,
      isNight: shiftTemplates.isNight, dept: departments.name,
    }).from(shiftAssignments)
      .innerJoin(shiftRequirements, eq(shiftRequirements.id, shiftAssignments.shiftRequirementId))
      .innerJoin(shiftTemplates, eq(shiftTemplates.id, shiftRequirements.shiftTemplateId))
      .innerJoin(departments, eq(departments.id, shiftRequirements.departmentId))
      .where(and(
        eq(shiftAssignments.employeeId, emp.id),
        gte(shiftAssignments.date, today),
        lte(shiftAssignments.date, dayKey(addDays(today, 14))),
      )).all().sort((a, b) => a.date.localeCompare(b.date));
    sources.push('your schedule');

    if (!rows.length) {
      return answer(actor, q,
        'You have no shifts scheduled in the next fortnight. Once a planner publishes the ' +
        'schedule for your team, they will appear in My schedule.', sources);
    }
    const next = rows[0];
    const list = rows.slice(0, 5).map((r) =>
      `  ${r.date} · ${r.name} ${r.start}–${r.end} (${r.hours}h) in ${r.dept}`).join('\n');
    return answer(actor, q,
      `Your next shift is ${next.name} on ${next.date}, ${next.start}–${next.end} in ${next.dept}.\n\n` +
      `The next few:\n${list}\n\nYou have ${rows.length} shift(s) booked over the next fortnight.`, sources);
  }

  // Leave balance
  if (/\b(leave|holiday|annual|time off|vacation|balance)\b/i.test(lower) && emp) {
    const year = new Date().getUTCFullYear();
    const bal = hrDb.select().from(leaveBalances).where(and(
      eq(leaveBalances.employeeId, emp.id), eq(leaveBalances.year, year))).all();
    const pending = hrDb.select().from(leaveRequests).where(and(
      eq(leaveRequests.employeeId, emp.id), eq(leaveRequests.status, 'PENDING'))).all();
    sources.push('your leave balances', 'your leave requests');

    const lines = bal.map((b) =>
      `  ${b.leaveType.toLowerCase()}: ${b.entitled - b.taken} of ${b.entitled} days left`).join('\n');
    return answer(actor, q,
      `Your leave for ${year}:\n${lines || '  No balances recorded.'}\n\n` +
      (pending.length
        ? `You have ${pending.length} request awaiting a decision.`
        : 'You have no requests awaiting a decision.') +
      `\n\nRequest leave from the Leave page.`, sources);
  }

  // Pay
  if (/\b(pay|salary|paid|earn|payslip|overtime|wage)\b/i.test(lower) && emp) {
    const period = hrDb.select().from(payPeriods).orderBy(payPeriods.id).all()[0];
    const line = period ? hrDb.select().from(payLines).where(and(
      eq(payLines.payPeriodId, period.id), eq(payLines.employeeId, emp.id))).all()[0] : null;
    sources.push('your pay line', 'pay policy');

    if (!line) {
      return answer(actor, q,
        'No pay line has been calculated for the current period yet. When it is, you will ' +
        'see it on the Pay page.\n\nHow it works: your base pay is always calculated on your ' +
        `contracted ${emp.contractedHoursPerWeek} hours a week, not on the hours you were ` +
        'actually rostered. Additional hours are voluntary and paid at 1.5×.', sources);
    }
    return answer(actor, q,
      `For ${period!.name}:\n` +
      `  contracted ${line.contractedHours}h · base pay ₹${Math.round(line.basePay).toLocaleString('en-IN')}\n` +
      `  voluntary extra ${line.voluntaryExtraHours}h · ₹${Math.round(line.overtimePay).toLocaleString('en-IN')}\n` +
      `  night premium ₹${Math.round(line.nightPremiumPay).toLocaleString('en-IN')}\n` +
      `  gross ₹${Math.round(line.grossPay).toLocaleString('en-IN')}\n\n` +
      'Your base pay is calculated on contracted hours, so a scheduling restriction never ' +
      'reduces it.', sources);
  }

  // Why can't I take extra hours
  if (/\b(extra hours|additional hours|more hours|overtime|opt in|opt-in)\b/i.test(lower) && emp) {
    const f = fatigue.computeFatigue(emp.id);
    const opt = hrDb.select().from(overtimeOptIns)
      .where(eq(overtimeOptIns.employeeId, emp.id)).all().find((o) => !o.withdrawnAt);
    sources.push('your workload score', 'your overtime opt-in');
    if (f.atCeiling) {
      return answer(actor, q,
        `Additional hours are closed to you at the moment because your workload score is ` +
        `${f.score}, at or above the ceiling of 80.\n\nWhat is driving it:\n` +
        f.drivers.map((d) => `  ${d}`).join('\n') +
        `\n\nThis limit applies to everyone and cannot be waived. It exists so that extra pay ` +
        `never becomes a reason to work yourself into the ground.`, sources);
    }
    if (!opt) {
      return answer(actor, q,
        `You have not opted in to additional hours. You can do that from the Wellbeing page, ` +
        `choosing the maximum you are willing to take.\n\nYour workload score is ${f.score} ` +
        `(${f.band.toLowerCase()}), so you are currently eligible. Extra hours are paid at 1.5× ` +
        `and are always your choice.`, sources);
    }
    return answer(actor, q,
      `You are opted in for up to ${opt.maxAdditionalHours}h of additional hours this period, ` +
      `paid at 1.5×. Your workload score is ${f.score} (${f.band.toLowerCase()}), below the ` +
      `ceiling, so the scheduler may offer you extra shifts.`, sources);
  }

  // Credentials
  if (/\b(credential|qualification|registration|certificate|expire|renew|licen[cs]e)\b/i.test(lower) && emp) {
    const quals = hrDb.select().from(qualifications)
      .where(eq(qualifications.employeeId, emp.id)).all();
    sources.push('your qualifications');
    if (!quals.length) return answer(actor, q, 'No qualifications are recorded against your profile. HR can add them.', sources);
    const soon = dayKey(addDays(dayKey(new Date()), 90));
    const lines = quals.map((qq) => {
      const expiring = qq.expiresOn && qq.expiresOn <= soon;
      return `  ${qq.type}${qq.registrationNo ? ` (${qq.registrationNo})` : ''}` +
             `${qq.expiresOn ? ` — expires ${qq.expiresOn}${expiring ? ' ⚠ renew soon' : ''}` : ''}`;
    }).join('\n');
    return answer(actor, q, `Your qualifications:\n${lines}`, sources);
  }

  // My restrictions (label only — this is already non-clinical)
  if (/\b(restriction|cap|limit|my hours|adjusted)\b/i.test(lower) && emp) {
    sources.push('your scheduling restrictions');
    return answer(actor, q,
      'Your own restrictions are listed on your Overview and in My schedule. They show what ' +
      'limit applies and the dates it covers — the same information your manager sees. ' +
      'The reason behind one is held by occupational health and is not shown anywhere else. ' +
      'If you think a restriction is wrong or out of date, occupational health can review it.',
      sources);
  }

  // Onboarding
  if (/\b(onboard|induction|joining|new starter|checklist)\b/i.test(lower) && emp) {
    const tasks = hrDb.select().from(onboardingTasks)
      .where(eq(onboardingTasks.employeeId, emp.id)).all();
    sources.push('your onboarding checklist');
    if (!tasks.length) return answer(actor, q, 'You have no onboarding checklist open.', sources);
    const open = tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
    return answer(actor, q,
      `${tasks.length - open.length} of ${tasks.length} onboarding tasks complete.` +
      (open.length ? `\n\nStill to do:\n${open.map((t) => `  ${t.title} (due ${t.dueDate})`).join('\n')}` : '\n\nAll done.'),
      sources);
  }

  // Policy lookup
  const pol = hrDb.select().from(policies).all();
  const docs = hrDb.select().from(documents).all();
  const terms = lower.split(/\W+/).filter((w) => w.length > 3);
  const scored = [
    ...pol.map((p) => ({ title: p.title, body: p.body, kind: 'policy' })),
    ...docs.filter((d) => d.body).map((d) => ({ title: d.title, body: d.body!, kind: 'document' })),
  ].map((p) => ({
    ...p,
    hits: terms.filter((t) => (p.title + ' ' + p.body).toLowerCase().includes(t)).length,
  })).filter((p) => p.hits > 0).sort((a, b) => b.hits - a.hits);

  if (scored.length) {
    sources.push(`${scored[0].kind}: ${scored[0].title}`);
    return answer(actor, q,
      `From “${scored[0].title}”:\n\n${scored[0].body}` +
      (scored.length > 1 ? `\n\nAlso relevant: ${scored.slice(1, 3).map((s) => s.title).join(', ')}.` : ''),
      sources);
  }

  /* Nothing matched — say so plainly and point somewhere useful. */
  return answer(actor, q,
    'I could not match that to anything I hold. I can answer questions about your own ' +
    'shifts, leave, pay, credentials, onboarding and published policies.',
    sources, [
      'When is my next shift?',
      'How much annual leave do I have left?',
      'Why can I not take extra hours?',
      'When does my BLS certificate expire?',
      'What is the policy on pay and accommodations?',
    ]);
}

function answer(actor: Actor, q: string, text: string, sources: string[], suggestions?: string[]): Answer {
  log(actor, q, text, sources, false);
  return { answer: text, sources, refused: false, suggestions };
}

function log(actor: Actor, question: string, answerText: string, sources: string[], refused: boolean) {
  hrDb.insert(assistantMessages).values({
    userId: actor.userId, employeeId: actor.employeeId ?? null,
    question, answer: answerText, sources: JSON.stringify(sources), refused,
  }).run();
}

export const history = (actor: Actor) =>
  hrDb.select().from(assistantMessages)
    .where(eq(assistantMessages.userId, actor.userId))
    .orderBy(desc(assistantMessages.id)).limit(40).all()
    .map((m) => ({ ...m, sources: JSON.parse(m.sources || '[]') as string[] }))
    .reverse();

/** For the compliance view: proof the assistant never touched health data. */
export function sourceAudit() {
  const all = hrDb.select().from(assistantMessages).all();
  const sources = new Set<string>();
  for (const m of all) for (const s of JSON.parse(m.sources || '[]') as string[]) sources.add(s);
  return {
    messages: all.length,
    refused: all.filter((m) => m.refused).length,
    distinctSources: [...sources].sort(),
    touchedHealthStore: [...sources].some((s) => /health|diagnos|clinical|assessment|wellbeing/i.test(s)
      && !s.startsWith('refusal:')),
  };
}
