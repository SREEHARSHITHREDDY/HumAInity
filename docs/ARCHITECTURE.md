# Architecture

## 1. The problem this design solves

A hospital scheduler needs to know that someone cannot work nights. It does not need
to know why. In most systems the two travel together, because the restriction is stored
as a note on an HR record and whoever can see the record can see the note.

HumAInity separates them structurally, so that the scheduler, managers and payroll are
*incapable* of learning a medical reason rather than merely *forbidden* from doing so.

## 2. The six layers

```
  ┌──────────────────────────── RESTRICTED ZONE ────────────────────────────┐
  │                                                                          │
  │   A. Occupational health store        B. Restriction service             │
  │      health.db                           turns an assessment into a      │
  │      diagnoses, clinical notes,          limit drawn from a closed       │
  │      documents, wellbeing                vocabulary                      │
  │                                                                          │
  └───────────────────────────────┬──────────────────────────────────────────┘
                                  │
                     C. CONSTRAINT FIREWALL
                     five checks on every crossing
                                  │
                     { type, numeric params, dates, opaqueRef }
                                  │
  ┌───────────────────────────────┴──────────────────────────────────────────┐
  │                          OPERATIONAL ZONE  hr.db                         │
  │                                                                          │
  │   D. Scheduling engine        E. HR / manager UI      (payroll)          │
  │      CP-SAT; treats the          shows that a                            │
  │      limit as a hard rule        restriction applies                     │
  │                                                                          │
  │   F. Audit and fairness services                                         │
  └──────────────────────────────────────────────────────────────────────────┘
```

## 3. Physical separation

| | `hr.db` | `health.db` |
|---|---|---|
| Connection | `HR_DATABASE_URL` | `HEALTH_DATABASE_URL` |
| Client | `hrDb` | `healthDb` |
| Imported by | the whole application | `services/health.service.ts` only |
| Foreign keys to the other | none | none |

Employees are referenced across the boundary by a bare integer (`employeeRef`), never
by a foreign key. The two stores cannot be joined by the query planner, so the
separation survives a mistaken query as well as a malicious one.

In production these are two database servers with two sets of credentials; the
application user for the HR store has no grant on the health store at all. SQLite files
are used here so the project runs with no setup.

## 4. The one-door rule

`services/health.service.ts` is the only module that imports `healthDb`. Every exported
function takes an `actor` and calls `assertOhAccess` before touching anything. Every
call — permitted or refused — writes to both the HR audit log and the health store's
own independent access log.

One function is callable by the rest of the system: `listProjectableRestrictions()`.
It selects a fixed column list that does not include `clinicalNotes` or `diagnosisCode`.
Those columns are not filtered out downstream; they are never selected.

This boundary is enforced by review and by `src/__tests__/firewall.test.ts`. A lint rule
restricting the import would make it mechanical, and is the obvious next hardening step.

## 5. The closed vocabulary

A restriction can only be one of ten types, each with a strict Zod schema permitting
numbers only:

```
NO_NIGHT_SHIFTS            {}
MAX_DAILY_HOURS            { hours }
MAX_WEEKLY_HOURS           { hours }
MAX_CONSECUTIVE_DAYS       { days }
MIN_REST_HOURS             { hours }
REQUIRES_SCHEDULED_BREAKS  { everyHours, durationMinutes }
NO_WEEKEND_SHIFTS          {}
MAX_DAILY_WORKLOAD         { weight }
NO_SHIFT_TYPE              { shiftTemplateIds[] }
NO_DEPARTMENT              { departmentIds[] }
```

There is no free-text option anywhere in it. This is the central safety property:
because the only channel out of the health store carries a value of this shape, a
diagnosis cannot leak even if someone tries. There is nowhere to put it.

The schemas are `.strict()`, so an extra key — `{ hours: 6, reason: "..." }` — is
rejected at the boundary rather than silently dropped.

## 6. The five checks

`firewall.service.ts` validates every crossing:

1. **Authorisation** — an authorising officer is recorded, and a legal basis for sharing
   exists and has not been withdrawn.
2. **Validity** — the source is `ACTIVE`, is in date, and has not been revoked.
3. **Vocabulary** — the type is one of the ten.
4. **Shape** — the parameters validate against that type's strict schema.
5. **Leak scan** — the serialised payload is scanned for clinical language. This is
   defence in depth: it exists so that a developer who widens a schema by mistake is
   caught immediately rather than silently.

Anything that fails is refused, audited, and any existing projection is retired.

`syncAll()` is idempotent and re-derives the entire HR-side constraint set from the
authorised source. It runs before every solve, so a revoked or expired restriction
cannot survive into a new roster.

## 7. Scheduling

Google OR-Tools CP-SAT, in a Python service with **no database access of any kind** —
it cannot read the health store even in principle, because it has no connection to it.

**Hard constraints** (never traded away): qualification, approved leave, one shift per
employee per day, weekly hours ceiling, consecutive-day limit, minimum rest, and every
active firewall constraint.

**Soft objectives** (weighted, minimised): unfilled coverage, night-shift spread,
preference violations, consumption of voluntary extra hours, workload imbalance.

### Why coverage is soft

A hard coverage constraint returns `INFEASIBLE` and tells you nothing. With slack
variables the solver always returns its best roster *and* we can report exactly which
slots went unfilled, which staff were ineligible for each, and why. The specification
requires that the system never silently breaks a hard rule when staffing is short — it
must explain the shortfall. This is how.

### Criticality weighting

Coverage penalties are scaled by `coverage_weight` (nights ×3, critical units ×1.6).
Without this, minimising the *count* of unfilled slots makes the solver abandon long
critical shifts first, because a 9h night consumes more of a scarce hours budget than a
6h outpatient shift for the same reduction in unfilled count. The first build of this
model left **every** night shift unfilled for exactly that reason.

### Short shifts matter

A person with a 6h daily cap is time-limited, not unavailable. Without short shift
templates in the catalogue the scheduler excludes them from every slot, which is both
operationally wasteful and quietly exclusionary. The seed includes 6h and 7.5h
templates for this reason.

### The fallback engine

If the Python service is unreachable, `solver/fallback.ts` runs a deterministic greedy
algorithm applying exactly the same hard rules. It optimises worse, and results are
labelled `heuristic-fallback` everywhere they surface so a degraded roster is never
mistaken for an optimal one.

### The independent validator

`solver/validator.ts` re-checks the produced roster from scratch and deliberately shares
no code with the solver, so a bug in the model cannot validate itself. If it finds a
violation the roster is stored as `FAILED` and cannot be approved.

## 8. Capacity and pay

See README §2. The rule in one line: **base pay is always contracted hours × rate**,
so an accommodation never reduces income and never produces a payroll anomaly.

`pay_lines` holds: contracted hours, base pay, voluntary extra hours, overtime pay,
night hours, night premium, gross. None of these can reveal a restriction.

The "accommodation protected hours" figure is derived on the fly for the employee
viewing their own payslip and is never stored, never shown to a manager, and never
present in payroll's view — storing it would itself be the leak.

## 9. Fatigue

Inputs: rolling 7- and 28-day hours, load ratio against contract, consecutive days,
nights in 14 days, short turnarounds, weekend load, voluntary extra hours. Weighted,
clamped to 0–100, banded, and always accompanied by plain-language drivers so the
number is never a black box.

The ceiling (default 80) is hard. `capacity.optInToExtraHours` refuses above it and the
solver sets that person's extra-hours allowance to zero.

Wellbeing check-ins are health-adjacent, so they live in `health.db`. The submitting
employee receives an acknowledgement but **not** the computed risk flag — returning the
flag would send a health signal back across the boundary.

## 10. Fairness

Aggregate only, with suppression below `FAIRNESS_MIN_GROUP_SIZE` (default 5), because a
statistic over three people is a statement about three identifiable people.

This module **does not read the constraint store at all**. It cannot compare restricted
against unrestricted staff, and must not, because publishing that comparison would
recreate exactly the disclosure the firewall prevents.

Distribution is measured with a Gini coefficient over nights, hours, weekends, weighted
workload and voluntary extra hours.

## 11. Audit

Append-only. No update or delete path exists anywhere in the codebase. Each row carries
`prevHash` and a SHA-256 `hash` over its own payload plus the previous hash, so removing
or editing a row breaks the chain. `GET /api/workforce/audit/verify` recomputes it.

Every employee can see every access to their own record at
`GET /api/workforce/audit/my-record`. Transparency about what the system holds on you is
an ethics requirement, not a courtesy.

## 12. Roles

| Capability | EMP | MGR | PLAN | HR | OH | AUDIT |
|---|---|---|---|---|---|---|
| Own schedule | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Team schedules | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| Generate rosters | – | – | ✓ | ✓ | – | – |
| Approve rosters | – | ✓ | ✓ | ✓ | – | – |
| Restriction **labels** | own | ✓ | ✓ | ✓ | ✓ | ✓ |
| Restriction **reasons** | – | – | – | – | ✓ | – |
| Clinical records | – | – | – | – | ✓ | – |
| Payroll | own | – | – | ✓ | – | ✓ |
| Audit trail | own | – | – | ✓ | ✓ | ✓ |

## 13. Ethics rules, and where each is enforced

| # | Rule | Enforced in |
|---|---|---|
| 1 | Medical records separate from HR records | two databases, `db/index.ts` |
| 2 | Scheduler never receives diagnoses | closed vocabulary, `constraintsForScheduler` |
| 3 | Health never inferred from attendance or scheduling | `fatigue.service.ts` inputs; `fairness.service.ts` reads no constraints |
| 4 | Employees see their own restrictions | `constraintsForSelf`, `/audit/my-record` |
| 5 | Consent and legal basis recorded | `consents` table, firewall check 1 |
| 6 | Expired restrictions never stay active | `expireStale()`, hourly sweep and before every solve |
| 7 | Restrictions never used for discriminatory decisions | pay model; performance metrics excluded from restriction data |
| 8 | Scheduling fairness monitored | `fairness.service.ts` |
| 9 | Sensitive access always logged | `health.service.ts` writes two logs |
| 10 | All prototype data synthetic | `db/seed.ts` |
| 11 | Performance metrics never penalise accommodations | closed competency vocabulary, per-hour scoring and the free-text guard — see §15 |


## 15. Tier 2 — the standard HR portal

Added after the privacy core. Each module is a place where health status could
re-enter through a side door, so each has a structural defence rather than a
policy sentence.

| Module | The side door | What closes it |
|---|---|---|
| Performance | "Poor availability" as a rating | Closed competency vocabulary; API rejects any other key |
| Performance | Output totals penalise short hours | Goals scored per hour worked against one shared target rate |
| Performance | Narrative marks someone down for hours | Free-text guard records flags on the review, visible to the employee |
| Recruitment | AI quietly filters people out | Screening can only set `SCREENED`; only a human can reject, and must give a reason |
| Recruitment | Resume mentions a condition | Those lines are set aside and excluded from the score |
| Documents | A fit note uploaded "for the file" | Clinical content is refused at upload with an explanation |
| Offboarding | HR deletes clinical records | Checklist refers to occupational health; the workflow has no health client |
| Analytics | A chart broken down by restriction | Module never reads the constraint store; small groups suppressed |
| Assistant | Asked why someone is restricted | No health import; explicit refusal; every source recorded |

### The performance calculation, in full

```
hoursWorked      = sum of assigned shift hours in the cycle period
referenceHours   = 40 × weeks in the period        (identical for everyone)
targetRate       = goal.targetValue / referenceHours
actualRate       = goal.actualValue / hoursWorked
attainment       = actualRate / targetRate
```

Because `hoursWorked` appears in the denominator of `actualRate` and nowhere in
`targetRate`, working fewer hours cannot reduce attainment. A person on a 6h
cap and a person on 8h are compared on the same basis.

The seeded demonstration: Priya completes 94 care plans in 58.5 hours against a
120-plan target. Her rate is 1.607/h against a target rate of 1.5/h — **107%**.
The naive total-based figure would be 78%.

## 16. Authentication

Access tokens are short-lived JWTs. Refresh tokens are random 32-byte values
stored **as SHA-256 hashes** — the raw token exists only in the client's
httpOnly cookie.

Rotation is single-use. Presenting a token that has already been rotated means
it was captured, so the entire session family for that user is revoked rather
than guessing which holder is genuine.

Brute force is handled at two levels: a per-account lockout (five failures in
fifteen minutes, the real control) and a per-IP rate limit (a backstop set well
above legitimate use, because a shared NAT or a classroom demo produces many
sign-ins from one address).

This matters more here than in an ordinary application: a stolen session
belonging to the occupational health officer would open the restricted zone.

## 17. Known gaps

Listed honestly in README §"Honest limitations". The ones that matter most for a
production path: encryption at rest on the health store, an import-boundary lint rule,
PostgreSQL with separate credentials per store, and the legal assessment.
