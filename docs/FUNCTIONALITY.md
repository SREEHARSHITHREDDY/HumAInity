# What every part of HumAInity does

A plain-language reference to the whole system: each module, what it is for,
what it does, and the rules it enforces.

Read it in any order. If you are preparing to present or defend this project,
§1 and §2 are the spine of the argument; the rest is detail you can quote from.

---

## Contents

1. [The one-sentence version](#1-the-one-sentence-version)
2. [The three guarantees](#2-the-three-guarantees)
3. [Who can see what](#3-who-can-see-what)
4. [Tier 1 — the privacy core](#4-tier-1--the-privacy-core)
5. [Tier 2 — the standard HR portal](#5-tier-2--the-standard-hr-portal)
6. [Cross-cutting services](#6-cross-cutting-services)
7. [Every page in the application](#7-every-page-in-the-application)
8. [Every API endpoint](#8-every-api-endpoint)
9. [The rules, and where each one lives](#9-the-rules-and-where-each-one-lives)
10. [How the guarantees are tested](#10-how-the-guarantees-are-tested)

---

## 1. The one-sentence version

**The roster knows the limit. It never knows the reason.**

A hospital scheduler needs to know that someone cannot work nights. It does not
need to know why. In most systems those two facts travel together, because the
restriction is stored as a note on an HR record and anyone who can open the
record can read the note.

HumAInity separates them structurally, so that the scheduler, managers and
payroll are *incapable* of learning a medical reason rather than merely
*forbidden* from doing so.

---

## 2. The three guarantees

### Guarantee 1 — a diagnosis cannot reach the scheduler

Clinical records live in a **physically separate database** (`health.db`) with
its own connection and its own client. The operational database (`hr.db`) holds
everything else. There is **no foreign key between them**, so the two cannot be
joined even by a mistaken query.

Exactly one module may touch the health database: `services/health.service.ts`.
That is enforced three ways:

| Layer | What it does |
|---|---|
| Lint rule | `npm run lint` fails the build if any other module imports the health client |
| Test | A unit test asserts the import does not appear in the source |
| Review | The module is small and the boundary is documented at the top of it |

The only thing that crosses is a `SchedulingConstraint`: a type, some numbers,
two dates and an opaque handle. That table has **no `reason`, `diagnosis`,
`notes` or `assessment_id` column** — the schema makes the leak impossible, not
merely the code.

### Guarantee 2 — pay cannot reveal a restriction

Three things are kept strictly apart:

- **Contracted hours** — an employment-contract fact. Payroll sees it. A person
  may be part-time for any reason: choice, study, caregiving, an accommodation.
  Payroll cannot tell which.
- **A daily or weekly cap** — a scheduling constraint from the firewall. The
  scheduler sees it. Payroll never does.
- **Voluntary extra hours** — opt-in only, same premium rate for everyone.

**Base pay is always `contracted hours × rate`**, never the hours actually
rostered. So an accommodation costs the employee nothing *and* produces no
payroll anomaly anyone could reason backwards from. Nobody has a financial
reason to hide a restriction.

### Guarantee 3 — performance cannot punish an accommodation

The module most likely to undo everything else by accident. If a review can be
marked down for "poor availability", every reduced-hours accommodation becomes a
performance penalty and the restriction has been disclosed through the back
door.

- **Closed competency list.** Eight competencies, none of which is hours,
  availability, attendance, punctuality, flexibility or overtime. A rating key
  outside the list is rejected by the API.
- **Rate, not total.** Measured goals are scored per hour worked against one
  shared per-hour target. A person on a 6-hour cap is judged on the same basis
  as a person on 8 hours.
- **Free-text guard.** Narrative fields are scanned for language that marks
  someone down for their working pattern. Matches are recorded on the review
  where the employee and compliance can both see them.

---

## 3. Who can see what

| Capability | Employee | Line Manager | Roster Planner | HR Admin | OH Officer | Compliance |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Own schedule | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Team schedules | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| Generate rosters | – | – | ✓ | ✓ | – | – |
| Approve rosters | – | ✓ | ✓ | ✓ | – | – |
| Restriction **labels** | own | ✓ | ✓ | ✓ | ✓ | ✓ |
| Restriction **reasons** | – | – | – | – | ✓ | – |
| Clinical records | – | – | – | – | ✓ | – |
| Whether a limit is self-declared | own | – | – | – | ✓ | ✓ |
| Payroll | own | – | – | ✓ | – | ✓ |
| Write performance reviews | – | ✓ | – | ✓ | – | – |
| Recruitment decisions | – | ✓ | – | ✓ | – | – |
| Audit trail | own | – | – | ✓ | ✓ | ✓ |

Two rows are worth dwelling on:

- **Restriction reasons** has exactly one tick. That is the project.
- **Whether a limit is self-declared** is hidden from managers deliberately.
  Knowing that a limit was self-declared rather than clinically assessed tells a
  manager something about the person and invites pressure to "get it verified".
  Managers see an identical label either way.

---

## 4. Tier 1 — the privacy core

### 4.1 Authentication and access control

**What it does:** signs people in, keeps them signed in safely, and decides what
each role may reach.

| Function | What it does |
|---|---|
| `authenticate(email, password)` | Verifies credentials, records the attempt, issues an access token and a refresh token |
| `issueRefreshToken(userId)` | Creates a random token, stores only its SHA-256 hash |
| `rotateRefreshToken(raw)` | Single use. Issues a replacement and marks the old one replaced |
| `revokeAllForUser(userId)` | Ends every session for a person |
| `checkPasswordStrength(pw)` | Ten characters, mixed case, a digit, a symbol, nothing predictable |
| `changePassword(...)` | Verifies the current password, then ends every other session |
| `assertNotLockedOut(email)` | Five failed attempts in fifteen minutes locks that account |

**Why rotation matters here more than usual:** a stolen session belonging to the
occupational health officer would open the restricted zone. Presenting a token
that has already been rotated means it was captured, so the **entire session
family is revoked** rather than guessing which holder is genuine.

### 4.2 Employee management

Profiles, departments, facilities, designations, employment contracts.

The employee record holds `contractedFte`, `contractedHoursPerWeek` and
`baseHourlyRate`. These are **contract facts, not health facts** — the
distinction that makes Guarantee 2 work.

### 4.3 Qualifications and credentials

Professional registrations, training, verification status and expiry.

The scheduler treats a lapsed credential as disqualifying: if a registration
expired before the roster period, that person is not eligible for shifts
requiring it. Credentials expiring within 90 days surface on the dashboard.

### 4.4 Leave and attendance

Requests, approvals, balances, attendance records.

Approved leave becomes a **hard constraint**: the scheduler will not roster
anyone who is away. The free-text reason field is for operational notes; the UI
tells people to keep clinical detail with occupational health.

### 4.5 Occupational health records *(restricted zone)*

**What it does:** holds assessments, diagnoses, clinical notes and supporting
documents — and lets exactly one role reach them.

| Function | What it does |
|---|---|
| `listAssessments(actor, ref?)` | Clinical records. OH only. Logs every read |
| `createAssessment(actor, input)` | Records an assessment. Clinical fields encrypted before writing |
| `createRestriction(actor, input)` | Converts an assessment into a diagnosis-free limit |
| `revokeRestriction(actor, id)` | Withdraws a restriction |
| `listProjectableRestrictions()` | **The only function the rest of the system may call.** Returns type, numeric params, dates and authorisation metadata — the clinical columns are never selected |
| `submitCheckIn(actor, ...)` | A wellbeing check-in. The submitter gets an acknowledgement, never the computed risk flag |
| `healthAccessTrail(actor, ref?)` | The restricted zone's own independent access log |

Every exported function calls `assertOhAccess` first. Every call, permitted or
refused, writes to **both** audit logs.

### 4.6 Self-declared capacity

**What it does:** lets an employee state a limit on their own work without
involving anyone and without disclosing anything medical.

This exists so the platform protects people on day one, before a hospital has an
occupational health team configured — and so that nobody has to disclose a
diagnosis in order to be scheduled safely.

| Function | What it does |
|---|---|
| `capacityQuestions()` | A functional questionnaire. Every question asks what you can **do** at work |
| `suggestCapacity(answers)` | Turns answers into suggested limits, each quoting the answer it came from. **Applies nothing** |
| `selfDeclareRestriction(actor, input)` | Records a limit with `source: SELF_DECLARED`, no authorising clinician, 30-day expiry |
| `myDeclarations(actor)` | The employee's own view, with full provenance |
| `withdrawDeclaration(actor, id)` | Withdraw at any time, no reason required |
| `verifyDeclaration(ohActor, id)` | OH confirms it, making it durable for six months |
| `pendingVerification(ohActor)` | What is awaiting an OH look |

**What this deliberately does not do:** infer a restriction from a stated
condition. There is no reliable mapping from a diagnosis to a safe number of
working hours — two people with the same diagnosis can have entirely different
capacity — and a system that pretends otherwise is guessing about someone's
safety. The questionnaire asks about work, not health, and there is nowhere in
the form to enter a condition.

An optional free-text note can be left for occupational health. It is
encrypted, never projected, and visible only to the employee and OH.

### 4.7 The constraint firewall

**What it does:** the single narrow channel between the restricted zone and
everything else.

Five checks on every crossing:

1. **Authorisation** — a clinician-verified restriction names its authorising
   officer; a self-declared one carries a review date instead. Both need a
   recorded legal basis that has not been withdrawn.
2. **Validity** — active, in date, not revoked.
3. **Vocabulary** — the type is one of ten.
4. **Shape** — parameters validate against that type's strict schema.
5. **Leak scan** — the serialised payload contains no clinical language.

| Function | What it does |
|---|---|
| `syncAll(actor)` | Re-derives the whole HR-side constraint set from the authorised source. Idempotent |
| `expireStale()` | Retires anything past its end date. Runs hourly and before every solve |
| `constraintsForScheduler(ids, from, to)` | What the solver receives: employee, type, numbers, dates |
| `constraintsForManager(id)` | A neutral label and a date window. No reason, no source |
| `constraintsForSelfDetailed(id)` | The employee's own view, which *does* include provenance |
| `verifyNoLeakage()` | Scans the whole constraint store for clinical language |

**The closed vocabulary.** A restriction can only be one of these, each with a
strict schema permitting numbers only:

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

There is no free-text option anywhere in it. **That is the central safety
property**: because the only channel out of the health store carries a value of
this shape, a diagnosis cannot leak even if someone tries. There is nowhere to
put it.

### 4.8 The scheduling engine

**What it does:** assigns staff to every required shift while respecting
qualifications, leave, working-hour limits, rest rules and active restrictions.

Google OR-Tools CP-SAT, in a Python service with **no database access of any
kind** — it cannot read the health store even in principle.

**Hard constraints** (never traded away):

| Rule | Meaning |
|---|---|
| Qualification | Required registration or certification for that shift |
| Leave | Nobody rostered while on approved leave |
| One shift per day | No overlapping assignments |
| Weekly hours | Contracted hours, plus a voluntary opt-in allowance if any |
| Consecutive days | Statutory-style default of 6, or lower if a restriction applies |
| Minimum rest | Night shift blocks the following day for anyone with a 12h+ rest rule |
| Every active firewall constraint | Applied exactly as received |

**Soft objectives** (weighted, minimised): unfilled coverage, night-shift
spread, preference violations, consumption of voluntary extra hours, workload
imbalance.

**Why coverage is soft.** A hard coverage constraint returns `INFEASIBLE` and
tells you nothing. With slack variables the solver always returns its best
roster *and* reports exactly which slots went unfilled, which staff were
ineligible for each, and why. The specification requires that the system never
silently breaks a hard rule when staffing is short — it must explain the
shortfall. This is how.

**Criticality weighting.** Coverage penalties are scaled (nights ×3, critical
units ×1.6). Without this, minimising the *count* of unfilled slots makes the
solver abandon long critical shifts first, because a 9-hour night consumes more
of a scarce hours budget than a 6-hour outpatient shift for the same reduction
in unfilled count. The first version of this model left **every** night shift
unfilled for exactly that reason.

**Short shifts matter.** A person with a 6-hour cap is time-limited, not
unavailable. Without short shift templates the scheduler excludes them from
every slot, which is both operationally wasteful and quietly exclusionary.

**The fallback engine.** If the Python service is unreachable, a deterministic
greedy algorithm in TypeScript applies exactly the same hard rules. It optimises
worse, and results are labelled `heuristic-fallback` everywhere they surface so
a degraded roster is never mistaken for an optimal one.

**The independent validator.** Re-checks the produced roster from scratch and
deliberately shares no code with the solver, so a bug in the model cannot
validate itself. A roster that fails validation is stored as `FAILED` and
cannot be approved.

### 4.9 Capacity and pay

| Function | What it does |
|---|---|
| `capacityFor(id, from, to)` | Combines contract and firewall constraints into effective caps |
| `optInToExtraHours(...)` | Voluntary opt-in. Refused above the fatigue ceiling |
| `calculatePayPeriod(actor, id)` | Base pay on contracted hours, overtime on voluntary extra, night premium |
| `selfPayView(id, periodId)` | The employee's own payslip, including the accommodation-protection line |

The "accommodation protected hours" figure is **derived on the fly** for the
employee viewing their own payslip. It is never stored, never shown to a
manager, and never present in payroll's view — storing it would itself be the
leak.

### 4.10 Fatigue

**What it does:** stops the healthy ones becoming the sick ones.

Inputs are **operational exposure only**: rolling 7- and 28-day hours, load
ratio against contract, consecutive days, nights in 14 days, short turnarounds,
weekend load, voluntary extra hours. No health data is an input, so none can
leak out through the score.

The score is weighted, clamped to 0–100, banded (OK / Elevated / High /
Critical) and always accompanied by plain-language drivers so the number is
never a black box.

**The ceiling is hard.** Someone at or above it cannot be allocated additional
hours and cannot waive the limit. Without this, paying a premium for extra hours
would quietly push healthy staff into becoming unhealthy ones.

### 4.11 Fairness monitoring

Aggregate only, with suppression below the minimum group size, because a
statistic over three people is a statement about three identifiable people.

This module **does not read the constraint store at all**. It cannot compare
restricted against unrestricted staff, and must not, because publishing that
comparison would recreate exactly the disclosure the firewall prevents.

Distribution is measured with a Gini coefficient over nights, hours, weekends,
weighted workload and voluntary extra hours. `payEquityCheck` confirms nobody's
base pay fell below their contracted entitlement.

### 4.12 Audit

Append-only. No update or delete path exists anywhere in the codebase. Each row
carries `prevHash` and a SHA-256 hash over its own payload plus the previous
hash, so removing or editing a row breaks the chain.

**Every employee can see every access to their own record.** Transparency about
what the system holds on you is an ethics requirement, not a courtesy.

---

## 5. Tier 2 — the standard HR portal

Built after the privacy core, deliberately — these are the modules where a
careless design leaks health status back in through a side door.

### 5.1 Performance management

Covered in §2 as Guarantee 3. The calculation in full:

```
hoursWorked    = sum of assigned shift hours in the cycle period
referenceHours = 40 × weeks in the period        (identical for everyone)
targetRate     = goal.targetValue / referenceHours
actualRate     = goal.actualValue / hoursWorked
attainment     = actualRate / targetRate
```

Because `hoursWorked` appears in the denominator of `actualRate` and nowhere in
`targetRate`, working fewer hours cannot reduce attainment.

**The worked example in the seed data:** Priya completes 94 care plans in 58.5
hours against a 120-plan target. Her rate is 1.607/h against a target rate of
1.5/h — **107%**. The naive total-based figure would be 78%, a failing score
caused entirely by her accommodation.

### 5.2 Recruitment and resume screening

Deterministic and explainable: matches a resume against the qualifications the
posting states and quotes the line where each match was found.

| Rule | How it is enforced |
|---|---|
| It never rejects | `screen()` can only set `SCREENED`. There is no code path from the scorer to a rejection |
| Only a human decides | `decide()` requires an actor and records them |
| A decision needs a reason | Rejecting, offering or hiring without a recorded note is refused |
| It scores only stated requirements | The score is built from the posting's own fields |
| Health disclosures are set aside | Lines mentioning health are excluded from scoring and shown to the reviewer as set aside |

Interview scheduling checks the roster: booking a panel member who is on a night
shift that morning is refused unless explicitly forced.

### 5.3 The workforce assistant

Deterministic retrieval over the asker's own data and published policy. **There
is no language model behind it**, and that is a choice rather than a shortcut:
an assistant that can be prompted is an assistant that can be prompted into
disclosing something.

- It never imports the health service or the firewall.
- It answers about the asker only.
- A question seeking a medical reason is refused explicitly, and the refusal is
  logged.
- Every reply records the sources it consulted, shown in the interface.

It handles: next shifts, leave balances, pay breakdown, why extra hours are or
are not available, credential expiry, own restrictions, onboarding progress, and
policy lookup.

### 5.4 Onboarding

Ten standard tasks across HR, IT, the ward and occupational health, with due
dates spread over the first fortnight. Only HR can waive a mandatory task.

### 5.5 Documents

A library of policies, handbooks, forms and notices, with acknowledgement
tracking and role-based visibility.

**It refuses clinical content.** Uploading a fit note "so the manager has it on
file" is exactly how a separate health store gets bypassed, so the upload is
blocked with an explanation of where it should go instead.

### 5.6 Offboarding

Exit checklist covering handover, equipment, access revocation, roster removal
and final pay.

Ticking "system access revoked" **really does** deactivate the account and end
every session. The last item is a referral to occupational health rather than a
deletion: health-record retention is their decision under their own rules, and
an HR workflow should not be able to delete clinical data it cannot read.

### 5.7 Helpdesk

Tickets for pay, roster, leave, IT and facilities questions. The UI directs
anything about a health condition to occupational health instead, because this
queue is read by HR and managers.

### 5.8 Analytics

Operational reporting that never reads the constraint store, so no chart can be
broken down by health status — and a chart is how such a disclosure normally
happens. Departments below the minimum group size are suppressed.

---

## 6. Cross-cutting services

| Service | What it does |
|---|---|
| `lib/crypto.ts` | AES-256-GCM field encryption for clinical columns. Self-describing format so a key rotation can recognise what it is reading |
| `lib/load-env.ts` | Loads `.env` from the repository root whatever the working directory is. Config that fails silently is worse than config that fails loudly |
| `lib/logger.ts` | Structured logging with a redaction list. No clinical content, password or token is ever written to a log |
| `lib/constraint-vocabulary.ts` | The closed vocabulary and the clinical-language scanner |
| `lib/competencies.ts` | The closed competency list and the free-text fairness guard |
| `lib/capacity-questionnaire.ts` | Functional capacity questions and the answer-to-suggestion mapping |

---

## 7. Every page in the application

| Page | Route | Who | What it does |
|---|---|---|---|
| Sign in | `/login` | everyone | Demonstration accounts listed and clickable |
| Overview | `/` | everyone | Role-aware dashboard. Carries the firewall diagram and the live privacy self-test |
| Assistant | `/assistant` | everyone | Permission-aware Q&A with visible sources |
| My schedule | `/schedule` | employees | Four-week calendar and upcoming shifts |
| Leave | `/leave` | everyone | Request and approve leave |
| Wellbeing | `/wellbeing` | employees | Fatigue score with drivers, overtime opt-in, private check-in |
| Work capacity | `/capacity` | employees | Functional questionnaire, self-declared limits |
| Pay | `/pay` | everyone | Payslip for employees, payroll view for HR |
| Rosters | `/rosters` | planners+ | Generate, inspect grid, unfilled slots with explanations, validation |
| People | `/people` | managers+ | Directory with neutral restriction labels |
| Person detail | `/people/:id` | managers+ | Contract, caps, fatigue, qualifications, upcoming shifts |
| Performance | `/performance` | everyone | Goal attainment by rate, reviews |
| Fairness | `/fairness` | managers+ | Distribution with Gini, suppression, flags |
| Analytics | `/analytics` | managers+ | Workforce and operations reporting |
| Recruitment | `/recruitment` | HR, managers | Postings, pipeline, screening evidence, decisions |
| Onboarding | `/onboarding` | everyone | Checklist and progress |
| Offboarding | `/offboarding` | managers+ | Exit cases |
| Documents | `/documents` | everyone | Library with acknowledgements |
| Helpdesk | `/helpdesk` | everyone | Support tickets |
| Audit trail | `/audit` | everyone | Full trail for compliance, own-record access for employees |
| Occupational health | `/occupational-health` | **OH only** | The restricted zone |
| Account | `/account` | everyone | Password, sessions |

---

## 8. Every API endpoint

### Authentication `/api/auth`

| Method | Path | What it does |
|---|---|---|
| POST | `/login` | Sign in. Rate limited, account lockout after five failures |
| POST | `/refresh` | Exchange a refresh token for a new access token. Rotates |
| POST | `/logout` | Revoke this session |
| GET | `/me` | Current identity |
| GET | `/sessions` | Active sessions |
| POST | `/sessions/revoke-all` | Sign out everywhere |
| POST | `/password` | Change password, ends other sessions |
| POST | `/password/check` | Strength feedback |

### HR `/api/hr`

`GET /employees`, `GET /employees/:id`, `PATCH /employees/:id`,
`GET /departments`, `GET /facilities`, `GET /qualifications/expiring`,
`GET /leave`, `POST /leave`, `POST /leave/:id/decide`,
`GET /leave/balances/:employeeId`, `GET /attendance/:employeeId`,
`GET /notifications`, `POST /notifications/:id/read`, `GET /policies`

### Scheduling `/api/schedule`

`GET /templates`, `GET /requirements`, `GET /solver/status`,
`GET /rosters`, `GET /rosters/:id`, `POST /rosters/generate`,
`POST /rosters/:id/approve`, `GET /my`, `GET /employee/:employeeId`,
`GET /preferences`, `PUT /preferences`

### Occupational health `/api/oh`

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/constraint-types` | all | The closed vocabulary |
| GET | `/assessments` | **OH** | Clinical records |
| POST | `/assessments` | **OH** | Record an assessment |
| GET | `/restrictions` | **OH** | Source restrictions |
| POST | `/restrictions` | **OH** | Authorise and project |
| POST | `/restrictions/:id/revoke` | **OH** | Withdraw |
| GET | `/access-trail` | OH, compliance | The restricted zone's own log |
| GET | `/check-ins` | **OH** | Wellbeing responses |
| POST | `/check-ins` | all | Submit own check-in |
| GET | `/my-restrictions` | all | Own restrictions with provenance |
| GET | `/capacity/questions` | all | Functional questionnaire |
| POST | `/capacity/suggest` | all | Answers to suggestions |
| POST | `/capacity/declare` | all | Declare a limit on own work |
| GET | `/capacity/mine` | all | Own declarations |
| POST | `/capacity/:id/withdraw` | all | Withdraw own declaration |
| POST | `/capacity/:id/verify` | **OH** | Confirm and extend |
| GET | `/capacity/pending` | **OH** | Awaiting review |
| GET | `/encryption-status` | OH, compliance, admin | Encryption posture |

### Workforce `/api/workforce`

`GET /capacity/:employeeId`, `POST /overtime/opt-in`,
`GET /pay/periods`, `POST /pay/periods/:id/calculate`,
`GET /pay/periods/:id/lines`, `GET /pay/periods/:id/equity`,
`GET /pay/my/:payPeriodId`, `GET /fatigue`, `GET /fatigue/:employeeId`,
`GET /fairness`, `POST /fairness/snapshot`,
`GET /firewall/constraints`, `POST /firewall/sync`, `GET /firewall/verify`,
`GET /audit`, `GET /audit/verify`, `GET /audit/my-record`, `GET /dashboard`

### Portal `/api/portal`

Performance: `GET /performance/competencies`, `/cycles`, `POST /cycles`,
`GET /goals/:employeeId`, `POST /goals`, `PATCH /goals/:id`,
`GET /score/:employeeId/:cycleId`, `GET /reviews`,
`GET /reviews/:employeeId/:cycleId`, `POST /reviews`,
`POST /reviews/:id/acknowledge`, `GET /flagged`

Recruitment: `GET /postings`, `POST /postings`, `GET /pipeline`,
`POST /apply`, `POST /applications/:id/screen`,
`POST /postings/:id/screen-all`, `POST /applications/:id/decide`,
`GET /interviews`, `POST /interviews`, `GET /interviews/conflict`,
`POST /interviews/:id/outcome`

Workplace: `GET /onboarding`, `/onboarding/:employeeId`, `POST /onboarding/start`,
`PATCH /onboarding/tasks/:id`, `GET /documents`, `POST /documents`,
`POST /documents/:id/acknowledge`, `GET /documents/:id/acknowledgements`,
`GET /offboarding`, `POST /offboarding`, `PATCH /offboarding/:id`,
`GET /tickets`, `POST /tickets`, `PATCH /tickets/:id`

Assistant and analytics: `POST /assistant/ask`, `GET /assistant/history`,
`GET /assistant/source-audit`, `GET /analytics`

### Operations

`GET /api/health` — liveness. `GET /api/ready` — readiness, including whether
clinical encryption is actually on.

---

## 9. The rules, and where each one lives

| # | Rule | Enforced in |
|---|---|---|
| 1 | Medical records separate from HR records | Two databases, `db/index.ts`, plus a lint rule |
| 2 | Scheduler never receives diagnoses | Closed vocabulary, `constraintsForScheduler` |
| 3 | Health never inferred from attendance or scheduling | `fatigue.service.ts` inputs; `fairness.service.ts` reads no constraints |
| 4 | Employees see their own restrictions | `constraintsForSelfDetailed`, `/audit/my-record` |
| 5 | Consent and legal basis recorded | `consents` table, firewall check 1 |
| 6 | Expired restrictions never stay active | `expireStale()`, hourly and before every solve |
| 7 | Restrictions never used for discriminatory decisions | Pay model, competency vocabulary, free-text guard |
| 8 | Scheduling fairness monitored | `fairness.service.ts` |
| 9 | Sensitive access always logged | `health.service.ts` writes two logs |
| 10 | All prototype data synthetic | `db/seed.ts` |
| 11 | Performance never penalises accommodations | Closed competencies, per-hour scoring, free-text guard |
| 12 | Nobody must disclose a diagnosis to be accommodated | Self-declared capacity, functional questionnaire |
| 13 | Clinical data encrypted at rest | `lib/crypto.ts`, AES-256-GCM |

---

## 10. How the guarantees are tested

**76 tests.** 63 unit, 13 end-to-end. Most of them actively try to break
something.

Run everything with `npm run test:all` (lint, typecheck, unit, E2E).

### What the unit tests prove

- Diagnosis codes and clinical notes appear nowhere in `hr.db`
- `scheduling_constraints` has no column capable of holding a reason
- Every non-OH role is refused by the health service, and each refusal is audited
- The constraint payload reaching the scheduler contains numbers only
- A type outside the closed vocabulary is refused and never projected
- A free-text parameter is rejected at the schema boundary
- An expired restriction is refused rather than silently persisting
- The audit chain verifies, and tampering with one row is detected
- The independent validator catches night-shift, daily-cap and leave breaches
- Base pay equals contracted hours × rate for every employee
- An employee with a cap is paid the same base as an identical colleague
- `pay_lines` has no column from which a restriction could be inferred
- A review cannot rate "availability"
- Scoring by rate never penalises fewer hours — asserted as a property
- Narrative text marking someone down for reduced hours is flagged
- Performance, analytics and the assistant contain no reference to the
  constraint store, asserted against source with comments stripped
- Screening cannot reject; a health disclosure changes the score by zero
- A rejection without a recorded reason is refused
- The document library blocks a fit note and allows a parking notice
- The assistant refuses four phrasings of "why is this person restricted"
- A rotated refresh token presented twice revokes the whole session family
- An account locks out after five failed sign-ins

### What the end-to-end tests prove

Through a real browser, against the running application:

- A line manager sees a restriction label and no clinical content anywhere
- A line manager opening the OH console is told why they cannot, and it is audited
- Payroll's table has no column mentioning restriction, accommodation or health
- The OH officer is the one role where a diagnosis appears
- The assistant refuses a medical-reason question in the interface
- An employee's capacity page contains no field asking for a diagnosis
- The roster grid shows a capped employee on short shifts only, never a night
- A generated roster passes independent validation
- The audit trail shows the refused access and verifies as an unbroken chain
