/* A deterministic greedy fallback solver, in TypeScript.
 *
 * It exists for one reason: a demo or a production shift handover must never
 * fail because a Python process is down. It applies exactly the same HARD
 * rules as the CP-SAT model — it simply optimises worse. The result is marked
 * `engine: "heuristic-fallback"` everywhere it surfaces, so nobody mistakes a
 * degraded roster for an optimal one.
 */
import type { SolveRequest, SolveResponse, SolverAssignment, Shortfall } from './types.js';

const isWeekend = (d: string) => [0, 6].includes(new Date(d).getUTCDay());
const isoWeek = (d: string) => {
  const dt = new Date(d);
  const day = (dt.getUTCDay() + 6) % 7;
  const monday = new Date(dt); monday.setUTCDate(dt.getUTCDate() - day);
  return monday.toISOString().slice(0, 10);
};

function blockReason(emp: any, slot: any, cons: any[], leave: Set<string>): string | null {
  if (leave.has(`${emp.id}|${slot.date}`)) return 'on approved leave';
  if (slot.required_qualification && !emp.qualifications.includes(slot.required_qualification))
    return `lacks required qualification ${slot.required_qualification}`;
  for (const c of cons) {
    if (c.effective_from && slot.date < c.effective_from) continue;
    if (c.effective_to && slot.date > c.effective_to) continue;
    const p: any = c.params || {};
    if (c.type === 'NO_NIGHT_SHIFTS' && slot.is_night) return 'a scheduling restriction excludes night shifts';
    if (c.type === 'NO_WEEKEND_SHIFTS' && isWeekend(slot.date)) return 'a scheduling restriction excludes weekends';
    if (c.type === 'MAX_DAILY_HOURS' && slot.duration_hours > Number(p.hours))
      return `shift is ${slot.duration_hours}h, above this person's ${p.hours}h daily cap`;
    if (c.type === 'MAX_DAILY_WORKLOAD' && slot.workload_weight > Number(p.weight))
      return "shift intensity is above this person's workload cap";
    if (c.type === 'NO_SHIFT_TYPE' && (p.shiftTemplateIds ?? []).includes(slot.template_id))
      return 'this shift type is excluded for this person';
    if (c.type === 'NO_DEPARTMENT' && (p.departmentIds ?? []).includes(slot.department_id))
      return 'this department is excluded for this person';
  }
  return null;
}

export function solveFallback(req: SolveRequest): SolveResponse {
  const t0 = Date.now();
  const leave = new Set(req.leave.map((l) => `${l.employee_id}|${l.date}`));
  const consBy = new Map<number, any[]>();
  for (const c of req.constraints) {
    if (!consBy.has(c.employee_id)) consBy.set(c.employee_id, []);
    consBy.get(c.employee_id)!.push(c);
  }

  const weekHours = new Map<string, number>();
  const dayUsed = new Set<string>();
  const nightCount = new Map<number, number>();
  const totalHours = new Map<number, number>();
  const assignments: SolverAssignment[] = [];
  const shortfalls: Shortfall[] = [];

  // Fill the most critical slots first, for the same reason the CP-SAT model
  // weights coverage: a night in a critical unit must not lose to a short
  // outpatient shift simply because it costs more hours.
  const slots = [...req.shifts].sort((a, b) =>
    (b.coverage_weight ?? 1) - (a.coverage_weight ?? 1) || a.date.localeCompare(b.date));

  for (const slot of slots) {
    let filled = 0;
    const blocked = new Map<string, number>();

    for (let n = 0; n < slot.required_count; n++) {
      const candidates = req.employees.filter((e) => {
        if (dayUsed.has(`${e.id}|${slot.date}`)) return false;
        const r = blockReason(e, slot, consBy.get(e.id) ?? [], leave);
        if (r) { blocked.set(r, (blocked.get(r) ?? 0) + 1); return false; }
        const wk = `${e.id}|${isoWeek(slot.date)}`;
        const allowance = e.fatigue_at_ceiling ? 0 : e.voluntary_extra_cap_hours;
        const weekly = (consBy.get(e.id) ?? []).find((c) => c.type === 'MAX_WEEKLY_HOURS');
        const cap = Math.min(
          e.contracted_hours_per_week + allowance,
          weekly ? Number((weekly.params as any).hours) : Infinity,
        );
        return (weekHours.get(wk) ?? 0) + slot.duration_hours <= cap;
      });
      if (!candidates.length) break;

      // Fairest available: fewest nights for a night slot, otherwise fewest hours.
      candidates.sort((a, b) => slot.is_night
        ? (nightCount.get(a.id) ?? 0) - (nightCount.get(b.id) ?? 0)
        : (totalHours.get(a.id) ?? 0) - (totalHours.get(b.id) ?? 0));
      const pick = candidates[0];

      const wk = `${pick.id}|${isoWeek(slot.date)}`;
      const before = weekHours.get(wk) ?? 0;
      weekHours.set(wk, before + slot.duration_hours);
      dayUsed.add(`${pick.id}|${slot.date}`);
      totalHours.set(pick.id, (totalHours.get(pick.id) ?? 0) + slot.duration_hours);
      if (slot.is_night) nightCount.set(pick.id, (nightCount.get(pick.id) ?? 0) + 1);

      assignments.push({
        requirement_id: slot.requirement_id, employee_id: pick.id, date: slot.date,
        hours: slot.duration_hours, workload_weight: slot.workload_weight,
        is_voluntary_extra: before + slot.duration_hours > pick.contracted_hours_per_week,
      });
      filled++;
    }

    if (filled < slot.required_count) {
      const reasons = [...blocked.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n} staff: ${r}`);
      reasons.push('Remaining staff would breach weekly hours or daily limits');
      shortfalls.push({
        requirement_id: slot.requirement_id, date: slot.date, template_code: slot.template_code,
        department_id: slot.department_id, required: slot.required_count, filled,
        missing: slot.required_count - filled, reasons,
        alternatives: [
          'Invite opt-in to additional hours from eligible staff below the fatigue ceiling',
          'Split this slot into a shortened shift plus cover',
          'Reduce the required headcount, or use bank/agency cover',
        ],
      });
    }
  }

  const required = req.shifts.reduce((s, x) => s + x.required_count, 0);
  const got = assignments.length;
  const nights = Object.fromEntries(req.employees.map((e) => [e.id, nightCount.get(e.id) ?? 0]));
  const nv = Object.values(nights) as number[];

  return {
    status: 'FEASIBLE', engine: 'heuristic-fallback', runtime_ms: Date.now() - t0,
    assignments, shortfalls,
    metrics: {
      slots_required: required, slots_filled: got,
      coverage_pct: required ? Math.round((1000 * got) / required) / 10 : 100,
      unfilled_slots: required - got, assignments: got,
      voluntary_extra_assignments: assignments.filter((a) => a.is_voluntary_extra).length,
      night_distribution: nights,
      night_spread: nv.length ? Math.max(...nv) - Math.min(...nv) : 0,
      hours_per_employee: Object.fromEntries([...totalHours.entries()].map(([k, v]) => [String(k), Math.round(v * 10) / 10])),
      constraints_applied: req.constraints.length,
      degraded: true,
    },
    message: 'Generated by the fallback engine. Hard rules are enforced; optimisation quality is lower than CP-SAT.',
  };
}
