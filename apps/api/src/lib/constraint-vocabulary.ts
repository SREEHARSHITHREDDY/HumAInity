/* ═══════════════════════════════════════════════════════════════════════════
 *  THE DIAGNOSIS-FREE CONSTRAINT VOCABULARY
 *
 *  This is a CLOSED vocabulary. A work restriction can only ever be expressed
 *  as one of these types with these numeric parameters. There is no free-text
 *  field anywhere in it.
 *
 *  That is the central safety property: because the only channel out of the
 *  health store is a value of this shape, a diagnosis cannot leak even if a
 *  developer, a bug or a malicious actor tries. There is simply nowhere to
 *  put it. The firewall validates against these schemas and refuses anything
 *  that does not match exactly.
 * ═════════════════════════════════════════════════════════════════════════ */
import { z } from 'zod';

const pos = z.number().positive().finite();

export const CONSTRAINT_SCHEMAS = {
  /** Employee must not be scheduled on any shift flagged isNight. */
  NO_NIGHT_SHIFTS: z.object({}).strict(),

  /** Maximum hours in any single calendar day. */
  MAX_DAILY_HOURS: z.object({ hours: pos.max(24) }).strict(),

  /** Maximum hours in any rolling 7-day window. */
  MAX_WEEKLY_HOURS: z.object({ hours: pos.max(168) }).strict(),

  /** Maximum consecutive days with any assignment. */
  MAX_CONSECUTIVE_DAYS: z.object({ days: z.number().int().positive().max(31) }).strict(),

  /** Minimum rest gap between the end of one shift and the start of the next. */
  MIN_REST_HOURS: z.object({ hours: pos.max(72) }).strict(),

  /** Scheduled breaks within a shift. */
  REQUIRES_SCHEDULED_BREAKS: z.object({
    everyHours: pos.max(12),
    durationMinutes: z.number().int().positive().max(120),
  }).strict(),

  /** No Saturday or Sunday assignments. */
  NO_WEEKEND_SHIFTS: z.object({}).strict(),

  /** Cap on cumulative WEIGHTED workload per day (shift acuity, not raw hours). */
  MAX_DAILY_WORKLOAD: z.object({ weight: pos.max(10) }).strict(),

  /** Exclude specific shift templates by id. */
  NO_SHIFT_TYPE: z.object({ shiftTemplateIds: z.array(z.number().int().positive()).min(1).max(20) }).strict(),

  /** Exclude specific departments by id. */
  NO_DEPARTMENT: z.object({ departmentIds: z.array(z.number().int().positive()).min(1).max(20) }).strict(),
} as const;

export type ConstraintType = keyof typeof CONSTRAINT_SCHEMAS;
export const CONSTRAINT_TYPES = Object.keys(CONSTRAINT_SCHEMAS) as ConstraintType[];

/** Human-readable, deliberately NON-medical descriptions. These strings are
 *  what managers and planners see. None of them hints at a cause. */
export const CONSTRAINT_LABEL: Record<ConstraintType, string> = {
  NO_NIGHT_SHIFTS: 'Not available for night shifts',
  MAX_DAILY_HOURS: 'Daily hours capped',
  MAX_WEEKLY_HOURS: 'Weekly hours capped',
  MAX_CONSECUTIVE_DAYS: 'Consecutive working days capped',
  MIN_REST_HOURS: 'Extended rest period required between shifts',
  REQUIRES_SCHEDULED_BREAKS: 'Scheduled breaks required',
  NO_WEEKEND_SHIFTS: 'Not available at weekends',
  MAX_DAILY_WORKLOAD: 'Daily workload intensity capped',
  NO_SHIFT_TYPE: 'Certain shift types excluded',
  NO_DEPARTMENT: 'Certain departments excluded',
};

export const describeConstraint = (type: ConstraintType, params: Record<string, unknown>): string => {
  switch (type) {
    case 'MAX_DAILY_HOURS':       return `Maximum ${params.hours} hours per day`;
    case 'MAX_WEEKLY_HOURS':      return `Maximum ${params.hours} hours per week`;
    case 'MAX_CONSECUTIVE_DAYS':  return `Maximum ${params.days} consecutive working days`;
    case 'MIN_REST_HOURS':        return `At least ${params.hours} hours rest between shifts`;
    case 'REQUIRES_SCHEDULED_BREAKS':
      return `A ${params.durationMinutes}-minute break every ${params.everyHours} hours`;
    case 'MAX_DAILY_WORKLOAD':    return `Daily workload intensity capped at ${params.weight}`;
    default:                      return CONSTRAINT_LABEL[type];
  }
};

/* ── Leak detection ────────────────────────────────────────────────────────
 * Defence in depth. Even though the schemas above are `.strict()` and permit
 * only numbers, we additionally scan any serialised constraint for tokens
 * that look clinical. If one is found the firewall refuses to emit and raises
 * an audited alert. This exists so that a future developer who widens a
 * schema by mistake is caught immediately rather than silently.            */

const CLINICAL_TOKENS = [
  'diagnos', 'icd', 'symptom', 'patient', 'clinical', 'disease', 'disorder',
  'syndrome', 'illness', 'injury', 'medication', 'prescri', 'treatment',
  'therapy', 'surgery', 'pregnan', 'cancer', 'cardiac', 'diabet', 'epilep',
  'asthma', 'migraine', 'depress', 'anxiet', 'psychiatr', 'disability',
  'chemo', 'dialysis', 'fracture', 'recovery', 'sick', 'unfit', 'notes',
];

export function containsClinicalLanguage(value: unknown): string | null {
  const text = JSON.stringify(value ?? '').toLowerCase();
  for (const token of CLINICAL_TOKENS) if (text.includes(token)) return token;
  return null;
}
