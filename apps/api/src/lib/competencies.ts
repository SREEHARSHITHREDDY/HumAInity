/* ═══════════════════════════════════════════════════════════════════════════
 *  THE CLOSED COMPETENCY VOCABULARY
 *
 *  A performance review can only rate these eight things. The list is closed
 *  for the same reason the constraint vocabulary is: if a reviewer could add
 *  their own criterion, "availability" would appear within a week, and every
 *  reduced-hours accommodation would quietly become a performance penalty.
 *
 *  Note what is deliberately absent and can never be added through the API:
 *  hours worked, availability, attendance, punctuality relative to roster,
 *  willingness to take nights, flexibility, overtime taken. Each of those is
 *  a proxy for a scheduling restriction, and rating someone on a proxy is
 *  rating them on the restriction.
 * ═════════════════════════════════════════════════════════════════════════ */

export const COMPETENCIES = [
  { code: 'WORK_QUALITY',       label: 'Quality of work delivered',     description: 'Correctness, robustness and adherence to standards in the work actually performed.' },
  { code: 'STAKEHOLDER_CARE',   label: 'Stakeholder interaction',       description: 'Communication with users and clients; responsiveness and professionalism.' },
  { code: 'TEAMWORK',           label: 'Teamwork',                      description: 'Handover quality, support for colleagues, conduct during incident escalation.' },
  { code: 'COMMUNICATION',      label: 'Communication',                 description: 'Clarity in documentation, handover and escalation to seniors.' },
  { code: 'INITIATIVE',         label: 'Initiative',                    description: 'Identifying problems and acting within scope without being asked.' },
  { code: 'DEVELOPMENT',        label: 'Professional development',      description: 'Training completed, credentials maintained, learning applied.' },
  { code: 'PROCESS_ADHERENCE',  label: 'Process and governance',        description: 'Change control, documentation standards, incident reporting.' },
  { code: 'MENTORING',          label: 'Mentoring and supervision',     description: 'Support given to juniors and interns, where applicable.' },
] as const;

export type CompetencyCode = (typeof COMPETENCIES)[number]['code'];
export const COMPETENCY_CODES = COMPETENCIES.map((c) => c.code) as CompetencyCode[];

/* ── The fairness guard ────────────────────────────────────────────────────
 * Free-text fields cannot be a closed vocabulary, so they are scanned
 * instead. A match does not block the review — a reviewer may have a
 * legitimate reason to mention a schedule — but it is flagged for the
 * employee and for compliance, and it is recorded on the review itself.
 *
 * The point is that marking someone down for working fewer hours becomes
 * visible rather than invisible.                                            */

export const BARRED_RATING_FACTORS = [
  'availability', 'available', 'hours worked', 'fewer hours', 'reduced hours',
  'short hours', 'part time', 'part-time', 'attendance', 'absent', 'absence',
  'sick leave', 'time off', 'night shift', 'nights', 'weekend availability',
  'flexib', 'restriction', 'restricted', 'accommodation', 'adjusted duties',
  'light duties', 'cannot work', "can't work", 'unable to work', 'limited to',
  'only works', 'capped at', 'medical', 'health',
];

export interface GuardFlag { phrase: string; field: string; note: string }

export function guardFreeText(field: string, text: string | null | undefined): GuardFlag[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found: GuardFlag[] = [];
  for (const phrase of BARRED_RATING_FACTORS) {
    if (lower.includes(phrase)) {
      found.push({
        phrase, field,
        note: 'A performance review may not take working pattern, availability or ' +
              'health into account. If this refers to the quality of work rather than ' +
              'the amount of time available, reword it to say so.',
      });
    }
  }
  return found;
}
