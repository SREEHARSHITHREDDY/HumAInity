/* ═══════════════════════════════════════════════════════════════════════════
 *  FATIGUE & LOAD ENGINE  —  "stop the healthy ones becoming the sick ones"
 *
 *  Every input is OPERATIONAL exposure: hours worked, nights, rest gaps,
 *  consecutive days, weekends, voluntary extra hours. No health data is read,
 *  so none can leak out through the score.
 *
 *  The score has a HARD CEILING that nobody can volunteer past. That matters:
 *  without it, paying a premium for extra hours would quietly incentivise
 *  people to work themselves into the ground.
 * ═════════════════════════════════════════════════════════════════════════ */
import { and, eq, gte, lte } from 'drizzle-orm';
import { hrDb } from '../db/index.js';
import { shiftAssignments, shiftTemplates, shiftRequirements, employees, fatigueScores } from '../db/hr.schema.js';
import { env } from '../lib/env.js';
import { addDays, dayKey, isWeekend } from '../lib/dates.js';

export interface FatigueComponents {
  hoursLast7: number;
  hoursLast28: number;
  contractedWeeklyHours: number;
  loadRatio: number;          // hoursLast7 / contracted
  consecutiveDays: number;
  nightsLast14: number;
  shortRestCount: number;     // gaps under 11 hours
  weekendsLast28: number;
  voluntaryExtraLast28: number;
}

export interface FatigueResult {
  employeeId: number;
  asOfDate: string;
  score: number;
  band: 'OK' | 'ELEVATED' | 'HIGH' | 'CRITICAL';
  components: FatigueComponents;
  /** Plain-language reasons, so the number is never a black box. */
  drivers: string[];
  atCeiling: boolean;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export function computeFatigue(employeeId: number, asOf = dayKey(new Date())): FatigueResult {
  const emp = hrDb.select().from(employees).where(eq(employees.id, employeeId)).all()[0];
  const contracted = emp?.contractedHoursPerWeek ?? 40;

  const from28 = dayKey(addDays(asOf, -27));
  const rows = hrDb.select({
    date: shiftAssignments.date,
    hours: shiftAssignments.hours,
    isVoluntaryExtra: shiftAssignments.isVoluntaryExtra,
    isNight: shiftTemplates.isNight,
    startTime: shiftTemplates.startTime,
    endTime: shiftTemplates.endTime,
  }).from(shiftAssignments)
    .innerJoin(shiftRequirements, eq(shiftRequirements.id, shiftAssignments.shiftRequirementId))
    .innerJoin(shiftTemplates, eq(shiftTemplates.id, shiftRequirements.shiftTemplateId))
    .where(and(
      eq(shiftAssignments.employeeId, employeeId),
      gte(shiftAssignments.date, from28),
      lte(shiftAssignments.date, asOf),
    )).all()
    .sort((a, b) => a.date.localeCompare(b.date));

  const from7 = dayKey(addDays(asOf, -6));
  const from14 = dayKey(addDays(asOf, -13));

  const hoursLast7 = rows.filter(r => r.date >= from7).reduce((s, r) => s + r.hours, 0);
  const hoursLast28 = rows.reduce((s, r) => s + r.hours, 0);
  const nightsLast14 = rows.filter(r => r.date >= from14 && r.isNight).length;
  const weekendsLast28 = rows.filter(r => isWeekend(r.date)).length;
  const voluntaryExtraLast28 = rows.filter(r => r.isVoluntaryExtra).reduce((s, r) => s + r.hours, 0);

  // Consecutive days ending at asOf
  const worked = new Set(rows.map(r => r.date));
  let consecutiveDays = 0;
  for (let i = 0; i < 28; i++) {
    if (worked.has(dayKey(addDays(asOf, -i)))) consecutiveDays++;
    else break;
  }

  // Short rest: a shift ending late followed by one starting early next day.
  let shortRestCount = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], cur = rows[i];
    const gapDays = (new Date(cur.date).getTime() - new Date(prev.date).getTime()) / 86_400_000;
    if (gapDays !== 1) continue;
    const prevEnd = parseInt(prev.endTime.slice(0, 2), 10) + (prev.isNight ? 24 : 0);
    const curStart = parseInt(cur.startTime.slice(0, 2), 10) + 24;
    if (curStart - prevEnd < 11) shortRestCount++;
  }

  const loadRatio = contracted > 0 ? hoursLast7 / contracted : 0;

  /* Weighted model. Weights chosen so that a person on contracted hours with
   * normal rotation lands in OK, and the drivers that genuinely predict
   * burnout (sustained overload, nights, broken rest) dominate.            */
  const score = clamp(
      Math.max(0, loadRatio - 0.85) * 120      // sustained overload
    + Math.max(0, consecutiveDays - 5) * 7     // no day off
    + nightsLast14 * 4.5                       // night-shift burden
    + shortRestCount * 9                       // broken recovery
    + Math.max(0, weekendsLast28 - 4) * 3      // weekend saturation
    + (voluntaryExtraLast28 / 10) * 4          // self-inflicted overload
  );

  const band = score >= env.FATIGUE_CEILING ? 'CRITICAL'
    : score >= env.FATIGUE_WARN_THRESHOLD ? 'HIGH'
    : score >= 40 ? 'ELEVATED' : 'OK';

  const drivers: string[] = [];
  if (loadRatio > 1.05) drivers.push(`Working ${Math.round(loadRatio * 100)}% of contracted hours this week`);
  if (consecutiveDays > 5) drivers.push(`${consecutiveDays} consecutive working days`);
  if (nightsLast14 >= 4) drivers.push(`${nightsLast14} night shifts in the last fortnight`);
  if (shortRestCount > 0) drivers.push(`${shortRestCount} turnaround(s) with under 11 hours rest`);
  if (weekendsLast28 > 4) drivers.push(`${weekendsLast28} weekend shifts in the last four weeks`);
  if (voluntaryExtraLast28 > 16) drivers.push(`${voluntaryExtraLast28.toFixed(1)} voluntary extra hours taken`);
  if (!drivers.length) drivers.push('Workload is within healthy limits');

  return {
    employeeId, asOfDate: asOf, score: Math.round(score * 10) / 10, band,
    atCeiling: score >= env.FATIGUE_CEILING,
    components: {
      hoursLast7, hoursLast28, contractedWeeklyHours: contracted,
      loadRatio: Math.round(loadRatio * 100) / 100,
      consecutiveDays, nightsLast14, shortRestCount, weekendsLast28, voluntaryExtraLast28,
    },
    drivers,
  };
}

export function computeAndStore(employeeId: number, asOf = dayKey(new Date())) {
  const r = computeFatigue(employeeId, asOf);
  hrDb.insert(fatigueScores).values({
    employeeId, asOfDate: asOf, score: r.score, band: r.band,
    components: JSON.stringify({ ...r.components, drivers: r.drivers }),
  }).onConflictDoUpdate({
    target: [fatigueScores.employeeId, fatigueScores.asOfDate],
    set: { score: r.score, band: r.band, components: JSON.stringify({ ...r.components, drivers: r.drivers }) },
  }).run();
  return r;
}

export function computeAll(asOf = dayKey(new Date())) {
  const all = hrDb.select({ id: employees.id }).from(employees)
    .where(eq(employees.status, 'ACTIVE')).all();
  return all.map(e => computeAndStore(e.id, asOf));
}

/** The hard gate used by the scheduler and by the overtime opt-in endpoint. */
export function isBlockedByFatigue(employeeId: number, asOf = dayKey(new Date())) {
  return computeFatigue(employeeId, asOf).atCeiling;
}
