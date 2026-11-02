"""CP-SAT rostering model.

Design decisions worth knowing:

* Coverage is a SOFT objective with a large penalty rather than a hard
  constraint. A hard coverage constraint makes the model return INFEASIBLE
  and tell you nothing. With slack variables the solver always returns its
  best roster AND we can report exactly which slots went unfilled and why.
  The specification requires that the system never silently violates a hard
  rule when staffing is short — it must explain the shortfall. This is how.

* Every genuinely safety-critical rule (qualification, leave, rest, health
  restrictions, fatigue ceiling) IS hard. Those are never traded away.

* One shift per employee per day. Standard for hospital rostering and it
  keeps the overlap constraint trivial.
"""
import time
from collections import defaultdict
from datetime import date, timedelta
from ortools.sat.python import cp_model

from models import SolveRequest, SolveResponse, Assignment, Shortfall


def _d(s: str) -> date:
    return date.fromisoformat(s)


def _days(start: str, end: str) -> list[str]:
    out, cur, stop = [], _d(start), _d(end)
    while cur <= stop:
        out.append(cur.isoformat())
        cur += timedelta(days=1)
    return out


def _is_weekend(s: str) -> bool:
    return _d(s).weekday() >= 5


# ── Eligibility ─────────────────────────────────────────────────────────────
# Returns None if the employee may work the slot, otherwise a human-readable
# reason. The reasons feed the shortfall explanation, so they must never
# mention anything clinical — and they cannot, because the solver has no
# clinical data to mention.

def ineligibility_reason(emp, slot, cons_by_emp, leave_set) -> str | None:
    if (emp.id, slot.date) in leave_set:
        return "on approved leave"

    if slot.required_qualification and slot.required_qualification not in emp.qualifications:
        return f"lacks required qualification {slot.required_qualification}"

    for c in cons_by_emp.get(emp.id, []):
        if c.effective_from and slot.date < c.effective_from:
            continue
        if c.effective_to and slot.date > c.effective_to:
            continue

        t, p = c.type, (c.params or {})
        if t == "NO_NIGHT_SHIFTS" and slot.is_night:
            return "a scheduling restriction excludes night shifts"
        if t == "NO_WEEKEND_SHIFTS" and _is_weekend(slot.date):
            return "a scheduling restriction excludes weekends"
        if t == "MAX_DAILY_HOURS" and slot.duration_hours > float(p.get("hours", 24)):
            return f"shift is {slot.duration_hours}h, above this person's {p.get('hours')}h daily cap"
        if t == "MAX_DAILY_WORKLOAD" and slot.workload_weight > float(p.get("weight", 99)):
            return "shift intensity is above this person's workload cap"
        if t == "NO_SHIFT_TYPE" and slot.template_id in (p.get("shiftTemplateIds") or []):
            return "this shift type is excluded for this person"
        if t == "NO_DEPARTMENT" and slot.department_id in (p.get("departmentIds") or []):
            return "this department is excluded for this person"
    return None


def solve(req: SolveRequest) -> SolveResponse:
    t0 = time.time()
    m = cp_model.CpModel()

    days = _days(req.period_start, req.period_end)
    emps = {e.id: e for e in req.employees}
    leave_set = {(l.employee_id, l.date) for l in req.leave}
    pref = {(p.employee_id, p.template_id): p.weight for p in req.preferences}

    cons_by_emp = defaultdict(list)
    for c in req.constraints:
        cons_by_emp[c.employee_id].append(c)

    # ── Decision variables ──────────────────────────────────────────────────
    # x[(emp, slot)] = 1 when that employee works that slot.
    x: dict[tuple[int, int], cp_model.IntVar] = {}
    eligible_for_slot: dict[int, list[int]] = defaultdict(list)
    blocked: dict[int, list[tuple[int, str]]] = defaultdict(list)

    for slot in req.shifts:
        for e in req.employees:
            reason = ineligibility_reason(e, slot, cons_by_emp, leave_set)
            if reason is None:
                x[(e.id, slot.requirement_id)] = m.NewBoolVar(f"x_{e.id}_{slot.requirement_id}")
                eligible_for_slot[slot.requirement_id].append(e.id)
            else:
                blocked[slot.requirement_id].append((e.id, reason))

    # ── HARD: coverage never exceeds what is required ───────────────────────
    slack: dict[int, cp_model.IntVar] = {}
    for slot in req.shifts:
        vars_ = [x[(e, slot.requirement_id)] for e in eligible_for_slot[slot.requirement_id]]
        s = m.NewIntVar(0, slot.required_count, f"slack_{slot.requirement_id}")
        slack[slot.requirement_id] = s
        if vars_:
            m.Add(sum(vars_) + s == slot.required_count)
        else:
            m.Add(s == slot.required_count)

    # ── HARD: at most one shift per employee per day ────────────────────────
    by_day = defaultdict(list)
    for slot in req.shifts:
        by_day[slot.date].append(slot)
    for e in req.employees:
        for d, slots in by_day.items():
            same_day = [x[(e.id, s.requirement_id)] for s in slots if (e.id, s.requirement_id) in x]
            if len(same_day) > 1:
                m.AddAtMostOne(same_day)

    # ── HARD: weekly hours ──────────────────────────────────────────────────
    # Contracted hours are the ceiling UNLESS the employee opted in to extra
    # hours, in which case the ceiling is contracted + their own stated cap.
    # Anyone at the fatigue ceiling gets no extra allowance at all.
    SCALE = 10  # model in tenths of an hour to stay integral
    weeks = defaultdict(list)
    for slot in req.shifts:
        iso_week = _d(slot.date).isocalendar()[:2]
        weeks[iso_week].append(slot)

    for e in req.employees:
        allowance = 0.0 if e.fatigue_at_ceiling else e.voluntary_extra_cap_hours
        for wk, slots in weeks.items():
            terms = [
                x[(e.id, s.requirement_id)] * int(s.duration_hours * SCALE)
                for s in slots if (e.id, s.requirement_id) in x
            ]
            if not terms:
                continue
            cap = int((e.contracted_hours_per_week + allowance) * SCALE)
            m.Add(sum(terms) <= cap)

            # Firewall weekly cap, if one applies, is additionally hard.
            for c in cons_by_emp.get(e.id, []):
                if c.type == "MAX_WEEKLY_HOURS":
                    m.Add(sum(terms) <= int(float(c.params.get("hours", 168)) * SCALE))

    # ── HARD: consecutive days ──────────────────────────────────────────────
    for e in req.employees:
        limit = None
        for c in cons_by_emp.get(e.id, []):
            if c.type == "MAX_CONSECUTIVE_DAYS":
                limit = int(c.params.get("days", 31))
        if limit is None:
            limit = 6  # default statutory-style rule for everyone
        works = {}
        for d in days:
            same_day = [x[(e.id, s.requirement_id)] for s in by_day.get(d, []) if (e.id, s.requirement_id) in x]
            if same_day:
                w = m.NewBoolVar(f"w_{e.id}_{d}")
                m.AddMaxEquality(w, same_day)
                works[d] = w
        ordered = [works[d] for d in days if d in works]
        if len(ordered) > limit:
            for i in range(len(ordered) - limit):
                m.Add(sum(ordered[i:i + limit + 1]) <= limit)

    # ── HARD: minimum rest between consecutive days ─────────────────────────
    # Modelled as: no night shift followed by a next-day shift, for anyone
    # carrying a MIN_REST_HOURS constraint of 12h or more.
    for e in req.employees:
        min_rest = None
        for c in cons_by_emp.get(e.id, []):
            if c.type == "MIN_REST_HOURS":
                min_rest = float(c.params.get("hours", 0))
        if not min_rest or min_rest < 12:
            continue
        for i in range(len(days) - 1):
            d, nxt = days[i], days[i + 1]
            nights = [x[(e.id, s.requirement_id)] for s in by_day.get(d, [])
                      if s.is_night and (e.id, s.requirement_id) in x]
            nextday = [x[(e.id, s.requirement_id)] for s in by_day.get(nxt, [])
                       if (e.id, s.requirement_id) in x]
            for a in nights:
                for b in nextday:
                    m.Add(a + b <= 1)

    # ── SOFT objectives ─────────────────────────────────────────────────────
    terms = []

    # 1. Coverage — dominant penalty, scaled by how critical the slot is.
    for slot in req.shifts:
        terms.append(slack[slot.requirement_id] * int(req.w_coverage * slot.coverage_weight))

    # 2. Night-shift fairness: minimise the spread between the busiest and
    #    least busy person on nights.
    night_counts = {}
    for e in req.employees:
        nights = [x[(e.id, s.requirement_id)] for s in req.shifts
                  if s.is_night and (e.id, s.requirement_id) in x]
        if nights:
            v = m.NewIntVar(0, len(nights), f"nights_{e.id}")
            m.Add(v == sum(nights))
            night_counts[e.id] = v
    if len(night_counts) > 1:
        hi = m.NewIntVar(0, len(req.shifts), "night_max")
        lo = m.NewIntVar(0, len(req.shifts), "night_min")
        m.AddMaxEquality(hi, list(night_counts.values()))
        m.AddMinEquality(lo, list(night_counts.values()))
        spread = m.NewIntVar(0, len(req.shifts), "night_spread")
        m.Add(spread == hi - lo)
        terms.append(spread * req.w_night_fairness)

    # 3. Preferences — reward liked shifts, penalise disliked ones.
    for (eid, tid), w in pref.items():
        if w == 0:
            continue
        for s in req.shifts:
            if s.template_id == tid and (eid, s.requirement_id) in x:
                terms.append(x[(eid, s.requirement_id)] * (-w * req.w_preference))

    # 4. Prefer not to consume voluntary extra hours unless coverage needs it.
    for e in req.employees:
        base = int(e.contracted_hours_per_week * SCALE)
        for wk, slots in weeks.items():
            ts = [x[(e.id, s.requirement_id)] * int(s.duration_hours * SCALE)
                  for s in slots if (e.id, s.requirement_id) in x]
            if not ts:
                continue
            over = m.NewIntVar(0, 10_000, f"over_{e.id}_{wk[0]}_{wk[1]}")
            m.Add(over >= sum(ts) - base)
            m.Add(over >= 0)
            terms.append(over * max(1, req.w_voluntary_extra // SCALE))

    # 5. Balance weighted workload across the team.
    loads = {}
    for e in req.employees:
        ts = [x[(e.id, s.requirement_id)] * int(s.workload_weight * 10)
              for s in req.shifts if (e.id, s.requirement_id) in x]
        if ts:
            v = m.NewIntVar(0, 100_000, f"load_{e.id}")
            m.Add(v == sum(ts))
            loads[e.id] = v
    if len(loads) > 1:
        hi = m.NewIntVar(0, 100_000, "load_max")
        lo = m.NewIntVar(0, 100_000, "load_min")
        m.AddMaxEquality(hi, list(loads.values()))
        m.AddMinEquality(lo, list(loads.values()))
        gap = m.NewIntVar(0, 100_000, "load_gap")
        m.Add(gap == hi - lo)
        terms.append(gap * max(1, req.w_load_balance // 10))

    m.Minimize(sum(terms))

    # ── Solve ───────────────────────────────────────────────────────────────
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = req.max_time_seconds
    solver.parameters.num_search_workers = 8
    status = solver.Solve(m)

    runtime_ms = int((time.time() - t0) * 1000)
    name = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE"}.get(status)
    if name is None:
        return SolveResponse(
            status="INFEASIBLE", runtime_ms=runtime_ms,
            message="No roster satisfies the hard safety rules for this period.",
        )

    # ── Extract ─────────────────────────────────────────────────────────────
    assignments: list[Assignment] = []
    weekly_hours: dict[tuple[int, tuple], float] = defaultdict(float)
    for slot in req.shifts:
        wk = _d(slot.date).isocalendar()[:2]
        for eid in eligible_for_slot[slot.requirement_id]:
            if solver.Value(x[(eid, slot.requirement_id)]):
                weekly_hours[(eid, wk)] += slot.duration_hours
                assignments.append(Assignment(
                    requirement_id=slot.requirement_id, employee_id=eid, date=slot.date,
                    hours=slot.duration_hours, workload_weight=slot.workload_weight,
                    is_voluntary_extra=weekly_hours[(eid, wk)] > emps[eid].contracted_hours_per_week,
                ))

    # ── Explain every shortfall ─────────────────────────────────────────────
    shortfalls: list[Shortfall] = []
    for slot in req.shifts:
        missing = solver.Value(slack[slot.requirement_id])
        if missing <= 0:
            continue
        tally: dict[str, int] = defaultdict(int)
        for _eid, reason in blocked[slot.requirement_id]:
            tally[reason] += 1
        reasons = [f"{n} staff: {r}" for r, n in sorted(tally.items(), key=lambda kv: -kv[1])]
        pool = len(eligible_for_slot[slot.requirement_id])
        if pool:
            reasons.append(
                f"{pool} eligible staff, but assigning more would breach weekly hours, "
                f"rest or consecutive-day limits")
        alternatives = []
        if pool:
            alternatives.append("Invite opt-in to additional hours from eligible staff below the fatigue ceiling")
        if any("daily cap" in r for r in tally):
            alternatives.append(
                "Split this slot into a shortened shift plus cover. Staff with a lower daily "
                "cap can work a shorter shift — they are not unavailable, only time-limited")
        if any("qualification" in r for r in tally):
            alternatives.append(f"Reassign a qualified {slot.required_qualification} from a lower-priority shift")
        if any("night" in r for r in tally):
            alternatives.append("Rotate the night slot to a colleague with fewer nights this fortnight")
        alternatives.append("Reduce the required headcount for this slot, or use bank/agency cover")
        shortfalls.append(Shortfall(
            requirement_id=slot.requirement_id, date=slot.date,
            template_code=slot.template_code, department_id=slot.department_id,
            required=slot.required_count, filled=slot.required_count - missing,
            missing=missing, reasons=reasons, alternatives=alternatives,
        ))

    total_req = sum(s.required_count for s in req.shifts)
    total_filled = total_req - sum(solver.Value(v) for v in slack.values())
    per_emp_nights = {eid: solver.Value(v) for eid, v in night_counts.items()}
    per_emp_hours: dict[int, float] = defaultdict(float)
    for a in assignments:
        per_emp_hours[a.employee_id] += a.hours

    metrics = {
        "slots_required": total_req,
        "slots_filled": total_filled,
        "coverage_pct": round(100 * total_filled / total_req, 1) if total_req else 100.0,
        "unfilled_slots": total_req - total_filled,
        "assignments": len(assignments),
        "voluntary_extra_assignments": sum(1 for a in assignments if a.is_voluntary_extra),
        "night_distribution": per_emp_nights,
        "night_spread": (max(per_emp_nights.values()) - min(per_emp_nights.values())) if per_emp_nights else 0,
        "hours_per_employee": {str(k): round(v, 1) for k, v in per_emp_hours.items()},
        "objective": solver.ObjectiveValue(),
        "constraints_applied": len(req.constraints),
    }

    return SolveResponse(
        status=name, runtime_ms=runtime_ms, assignments=assignments,
        shortfalls=shortfalls, metrics=metrics,
    )
