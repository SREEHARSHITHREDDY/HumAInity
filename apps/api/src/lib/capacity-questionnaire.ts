/* ═══════════════════════════════════════════════════════════════════════════
 *  FUNCTIONAL CAPACITY SELF-ASSESSMENT
 *
 *  Every question asks what a person can DO at work. None asks why, and none
 *  asks about a condition, a symptom, a medication or a diagnosis. That is
 *  deliberate and it is the difference between an occupational-health
 *  instrument and practising medicine.
 *
 *  The output is a SUGGESTION drawn from the same closed constraint
 *  vocabulary the firewall already uses. The employee confirms or discards
 *  each suggestion; nothing is applied automatically, because an answer to a
 *  questionnaire is not a decision about someone's working life.
 *
 *  What this deliberately does NOT do: infer a restriction from a stated
 *  condition. There is no reliable mapping from a diagnosis to a safe number
 *  of working hours — two people with the same diagnosis can have entirely
 *  different capacity — and a system that pretends otherwise is guessing
 *  about someone's safety.
 * ═════════════════════════════════════════════════════════════════════════ */
import type { ConstraintType } from './constraint-vocabulary.js';

export interface CapacityQuestion {
  id: string;
  question: string;
  help?: string;
  options: Array<{ value: string; label: string }>;
}

export const CAPACITY_QUESTIONS: CapacityQuestion[] = [
  {
    id: 'shift_length',
    question: 'How long can you work in one shift before your work would be affected?',
    help: 'Think about a typical shift on your team, not your best or worst day.',
    options: [
      { value: 'full', label: 'A full shift, up to 8 hours' },
      { value: '7.5',  label: 'Up to about 7½ hours' },
      { value: '6',    label: 'Up to about 6 hours' },
      { value: '4',    label: 'Up to about 4 hours' },
    ],
  },
  {
    id: 'nights',
    question: 'Can you work night shifts without your work being affected?',
    options: [
      { value: 'yes',       label: 'Yes, nights are fine' },
      { value: 'no',        label: 'No, I should not be rostered on nights' },
      { value: 'sometimes', label: 'Occasionally, but not regularly' },
    ],
  },
  {
    id: 'rest',
    question: 'How much time do you need between finishing one shift and starting the next?',
    options: [
      { value: 'standard', label: 'The standard gap is enough' },
      { value: '12',       label: 'At least 12 hours' },
      { value: '14',       label: 'At least 14 hours' },
      { value: '16',       label: 'At least 16 hours' },
    ],
  },
  {
    id: 'consecutive',
    question: 'How many days in a row can you work before you need a day off?',
    options: [
      { value: 'standard', label: 'The standard pattern is fine' },
      { value: '5',        label: 'Up to 5 days' },
      { value: '4',        label: 'Up to 4 days' },
      { value: '3',        label: 'Up to 3 days' },
    ],
  },
  {
    id: 'breaks',
    question: 'Do you need a scheduled break at a set interval during a shift?',
    options: [
      { value: 'no',  label: 'No, normal breaks are fine' },
      { value: '4h',  label: 'Yes, a short break every 4 hours' },
      { value: '3h',  label: 'Yes, a short break every 3 hours' },
      { value: '2h',  label: 'Yes, a short break every 2 hours' },
    ],
  },
  {
    id: 'weekends',
    question: 'Can you work at weekends?',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no',  label: 'No, I should not be rostered at weekends' },
    ],
  },
  {
    id: 'intensity',
    question: 'Are the most physically demanding shifts manageable for you at the moment?',
    help: 'For example a busy intensive care or resuscitation shift.',
    options: [
      { value: 'yes',   label: 'Yes' },
      { value: 'lower', label: 'I would manage better on less intensive shifts for now' },
    ],
  },
];

export interface Suggestion {
  constraintType: ConstraintType;
  params: Record<string, number>;
  label: string;
  because: string;
}

/** Maps answers to suggested constraints. Each mapping is a direct restatement
 *  of what the person said, in the vocabulary the scheduler understands —
 *  never an inference about them. */
export function suggestFromAnswers(answers: Record<string, string>): Suggestion[] {
  const out: Suggestion[] = [];
  const said = (id: string) => {
    const q = CAPACITY_QUESTIONS.find((x) => x.id === id);
    const o = q?.options.find((x) => x.value === answers[id]);
    return o?.label ?? '';
  };

  const len = answers.shift_length;
  if (len && len !== 'full') {
    out.push({
      constraintType: 'MAX_DAILY_HOURS', params: { hours: Number(len) },
      label: `No shift longer than ${len} hours`,
      because: `You said: “${said('shift_length')}”`,
    });
  }

  if (answers.nights === 'no') {
    out.push({
      constraintType: 'NO_NIGHT_SHIFTS', params: {},
      label: 'Not rostered on night shifts',
      because: `You said: “${said('nights')}”`,
    });
  }

  if (answers.rest && answers.rest !== 'standard') {
    out.push({
      constraintType: 'MIN_REST_HOURS', params: { hours: Number(answers.rest) },
      label: `At least ${answers.rest} hours between shifts`,
      because: `You said: “${said('rest')}”`,
    });
  }

  if (answers.consecutive && answers.consecutive !== 'standard') {
    out.push({
      constraintType: 'MAX_CONSECUTIVE_DAYS', params: { days: Number(answers.consecutive) },
      label: `No more than ${answers.consecutive} days in a row`,
      because: `You said: “${said('consecutive')}”`,
    });
  }

  if (answers.breaks && answers.breaks !== 'no') {
    const everyHours = Number(answers.breaks.replace('h', ''));
    out.push({
      constraintType: 'REQUIRES_SCHEDULED_BREAKS',
      params: { everyHours, durationMinutes: 15 },
      label: `A 15-minute break every ${everyHours} hours`,
      because: `You said: “${said('breaks')}”`,
    });
  }

  if (answers.weekends === 'no') {
    out.push({
      constraintType: 'NO_WEEKEND_SHIFTS', params: {},
      label: 'Not rostered at weekends',
      because: `You said: “${said('weekends')}”`,
    });
  }

  if (answers.intensity === 'lower') {
    out.push({
      constraintType: 'MAX_DAILY_WORKLOAD', params: { weight: 1.0 },
      label: 'Lower-intensity shifts for now',
      because: `You said: “${said('intensity')}”`,
    });
  }

  return out;
}
