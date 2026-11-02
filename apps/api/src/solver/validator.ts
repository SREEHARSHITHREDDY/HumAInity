/* ═══════════════════════════════════════════════════════════════════════════
 *  INDEPENDENT POST-SOLVE VALIDATOR
 *
 *  Deliberately does NOT reuse the solver's own eligibility code. It re-checks
 *  the produced roster against the rules from scratch, so a bug in the model
 *  cannot validate itself. The specification is explicit: a schedule must
 *  never be marked feasible if it breaches a hard constraint. If this
 *  validator finds a violation, the roster is stored as FAILED and is not
 *  offered for approval.
 * ═════════════════════════════════════════════════════════════════════════ */
import type { SolveRequest, SolverAssignment } from './types.js';

export interface Violation {
  rule: string;
  employeeId: number;
  date?: string;
  detail: string;
}

const isWeekend = (d: string) => [0, 6].includes(new Date(d).getUTCDay());
const weekOf = (d: string) => {
  const dt = new Date(d);
  const day = (dt.getUTCDay() + 6) % 7;
  const m = new Date(dt); m.setUTCDate(dt.getUTCDate() - day);
  return m.toISOString().slice(0, 10);
};

export function validate(req: SolveRequest, assignments: SolverAssignment[]): Violation[] {
  const v: Violation[] = [];
  const emp = new Map(req.employees.map((e) => [e.id, e]));
  const slot = new Map(req.shifts.map((s) => [s.requirement_id, s]));
  const leave = new Set(req.leave.map((l) => `${l.employee_id}|${l.date}`));

  const consBy = new Map<number, typeof req.constraints>();
  for (const c of req.constraints) {
    if (!consBy.has(c.employee_id)) consBy.set(c.employee_id, []);
    consBy.get(c.employee_id)!.push(c);
  }

  const perDay = new Map<string, number>();
  const perWeek = new Map<string, number>();
  const daysWorked = new Map<number, Set<string>>();

  for (const a of assignments) {
    const e = emp.get(a.employee_id);
    const s = slot.get(a.requirement_id);
    if (!e || !s) { v.push({ rule: 'INTEGRITY', employeeId: a.employee_id, detail: 'Assignment references unknown employee or slot' }); continue; }

    // leave
    if (leave.has(`${a.employee_id}|${a.date}`))
      v.push({ rule: 'LEAVE', employeeId: e.id, date: a.date, detail: 'Assigned while on approved leave' });

    // qualification
    if (s.required_qualification && !e.qualifications.includes(s.required_qualification))
      v.push({ rule: 'QUALIFICATION', employeeId: e.id, date: a.date, detail: `Missing ${s.required_qualification}` });

    // one shift per day
    const dk = `${e.id}|${a.date}`;
    perDay.set(dk, (perDay.get(dk) ?? 0) + 1);

    const wk = `${e.id}|${weekOf(a.date)}`;
    perWeek.set(wk, (perWeek.get(wk) ?? 0) + a.hours);

    if (!daysWorked.has(e.id)) daysWorked.set(e.id, new Set());
    daysWorked.get(e.id)!.add(a.date);

    // firewall constraints
    for (const c of consBy.get(e.id) ?? []) {
      if (c.effective_from && a.date < c.effective_from) continue;
      if (c.effective_to && a.date > c.effective_to) continue;
      const p = c.params as any;
      if (c.type === 'NO_NIGHT_SHIFTS' && s.is_night)
        v.push({ rule: 'NO_NIGHT_SHIFTS', employeeId: e.id, date: a.date, detail: 'Assigned a night shift against an active restriction' });
      if (c.type === 'NO_WEEKEND_SHIFTS' && isWeekend(a.date))
        v.push({ rule: 'NO_WEEKEND_SHIFTS', employeeId: e.id, date: a.date, detail: 'Assigned a weekend shift against an active restriction' });
      if (c.type === 'MAX_DAILY_HOURS' && a.hours > Number(p.hours) + 1e-9)
        v.push({ rule: 'MAX_DAILY_HOURS', employeeId: e.id, date: a.date, detail: `${a.hours}h assigned, cap is ${p.hours}h` });
      if (c.type === 'MAX_DAILY_WORKLOAD' && a.workload_weight > Number(p.weight) + 1e-9)
        v.push({ rule: 'MAX_DAILY_WORKLOAD', employeeId: e.id, date: a.date, detail: `weight ${a.workload_weight} exceeds cap ${p.weight}` });
      if (c.type === 'NO_SHIFT_TYPE' && (p.shiftTemplateIds ?? []).includes(s.template_id))
        v.push({ rule: 'NO_SHIFT_TYPE', employeeId: e.id, date: a.date, detail: 'Assigned an excluded shift type' });
      if (c.type === 'NO_DEPARTMENT' && (p.departmentIds ?? []).includes(s.department_id))
        v.push({ rule: 'NO_DEPARTMENT', employeeId: e.id, date: a.date, detail: 'Assigned to an excluded department' });
    }
  }

  for (const [k, n] of perDay) if (n > 1) {
    const [id, date] = k.split('|');
    v.push({ rule: 'OVERLAP', employeeId: Number(id), date, detail: `${n} shifts on the same day` });
  }

  for (const [k, hours] of perWeek) {
    const [idStr, wk] = k.split('|');
    const id = Number(idStr);
    const e = emp.get(id)!;
    const allowance = e.fatigue_at_ceiling ? 0 : e.voluntary_extra_cap_hours;
    if (hours > e.contracted_hours_per_week + allowance + 1e-9)
      v.push({ rule: 'MAX_WEEKLY_HOURS', employeeId: id, date: wk, detail: `${hours}h in week of ${wk}, ceiling ${e.contracted_hours_per_week + allowance}h` });
    const weekly = (consBy.get(id) ?? []).find((c) => c.type === 'MAX_WEEKLY_HOURS');
    if (weekly && hours > Number((weekly.params as any).hours) + 1e-9)
      v.push({ rule: 'MAX_WEEKLY_HOURS', employeeId: id, date: wk, detail: `${hours}h exceeds restriction cap of ${(weekly.params as any).hours}h` });
  }

  // consecutive days
  for (const [id, set] of daysWorked) {
    const limit = Number(((consBy.get(id) ?? []).find((c) => c.type === 'MAX_CONSECUTIVE_DAYS')?.params as any)?.days ?? 6);
    const sorted = [...set].sort();
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
      const gap = (new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) / 86_400_000;
      run = gap === 1 ? run + 1 : 1;
      if (run > limit) {
        v.push({ rule: 'MAX_CONSECUTIVE_DAYS', employeeId: id, date: sorted[i], detail: `${run} consecutive days, limit ${limit}` });
        break;
      }
    }
  }

  // fatigue ceiling: nobody at the ceiling may hold voluntary extra hours
  for (const a of assignments) {
    const e = emp.get(a.employee_id)!;
    if (e.fatigue_at_ceiling && a.is_voluntary_extra)
      v.push({ rule: 'FATIGUE_CEILING', employeeId: e.id, date: a.date, detail: 'Voluntary extra hours assigned to someone at the fatigue ceiling' });
  }

  return v;
}
