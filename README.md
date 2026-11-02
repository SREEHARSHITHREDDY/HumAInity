# HumAInity

**Privacy-preserving, health-aware workforce management and scheduling for hospitals.**

Version 1.1 · 62 unit tests + 13 end-to-end tests · [What every part does](docs/FUNCTIONALITY.md) · [Architecture](docs/ARCHITECTURE.md) · [Releasing](docs/RELEASE.md)

Occupational health sets a work restriction. The scheduler receives a number and a date.
Managers see that a restriction applies. Nobody outside occupational health sees why.

All data in this project is synthetic.

---

## Quick start

Requires **Node 18+** and **Python 3.10+**.

```bash
npm install     # installs the API and web workspaces
npm run setup   # creates both databases, seeds synthetic data, and sets up
                # a dedicated Python environment for the CP-SAT solver
npm run dev     # starts API (4000), web (5173) and solver (8000)
```

Optionally, turn on encryption for the clinical fields before seeding:

```bash
echo "HEALTH_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
npm run db:reset
```

Without it the demo still runs and prints a warning. In production the API
refuses to start without a key.

**If the solver fails to start**, it is almost always because `pip` installed
OR-Tools into one Python while `python3` resolves to another. Run:

```bash
npm run setup:solver
```

That finds an interpreter OR-Tools actually supports (CPython 3.9–3.13),
builds `services/scheduler/.venv`, and pins the solver to it. If no suitable
Python exists, `brew install python@3.13` then run it again.

You are never blocked by this: the API falls back to a built-in TypeScript
engine that enforces every hard rule, and rosters generated that way are
labelled `heuristic-fallback` everywhere they appear.

Open **http://localhost:5173** and sign in with any account below.
Password for all of them: `Demo@1234`

| Role | Email | What to look at |
|---|---|---|
| Roster planner | `harish.kumar@humainity.health` | Generate a roster, see coverage and explained shortfalls |
| Occupational health | `anita.bose@humainity.health` | The restricted zone; issue a restriction and watch it cross the firewall |
| Line manager | `shalini.rao@humainity.health` | A person's profile — a restriction label with no reason |
| HR admin | `deepak.sharma@humainity.health` | Payroll's complete view; nothing reveals a restriction |
| Compliance auditor | `geeta.krishnan@humainity.health` | The hash-chained audit trail |
| Employee (7.5h cap) | `priya.nair@humainity.health` | Her own payslip: full contracted pay despite fewer rostered hours |
| Employee (6h, no nights) | `arjun.mehta@humainity.health` | Schedule shows only short day shifts |
| Employee (opted in) | `sneha.reddy@humainity.health` | Voluntary extra hours and the premium |

Every account has the same password. `npm test` runs 62 tests, most of which
actively try to break the privacy guarantees.

---

## The demonstration, in five minutes

1. **Sign in as the roster planner.** The overview shows the firewall diagram, a live
   privacy self-test and the audit chain verification.
2. **Rosters → Generate roster.** CP-SAT solves a fortnight in about 15 seconds.
   Open the grid: Priya Nair never exceeds 7.5h, Arjun Mehta never exceeds 6h and never
   appears on a navy night block. The engine was never told why.
3. **Unfilled slots tab.** Where coverage fails, the system explains which staff were
   ineligible and why, and suggests alternatives. It never silently breaks a hard rule.
4. **Validation tab.** A validator that shares no code with the solver re-checks the
   roster. A roster that fails is stored as `FAILED` and cannot be approved.
5. **Sign in as the occupational health officer.** Issue a new restriction and watch the
   response: the constraint is projected, and the scheduler now has the limit but not
   the reason. Try signing in as HR and opening the same records — 403.

---

## The three things that make this different

### 1. The firewall is physical, not a convention

There are **two separate SQLite databases** with separate connections and separate
generated clients. `health.db` holds diagnoses, clinical notes and documents.
`hr.db` holds everything else. There is **no foreign key between them**, so the query
planner cannot join them even by mistake.

Exactly one module imports the health client: `services/health.service.ts`. Every
exported function in it checks the caller's role and writes to two independent logs.

The only thing that crosses is a `SchedulingConstraint` row, and that table has no
`reason`, `diagnosis`, `notes` or `assessment_id` column. The schema makes the leak
impossible, not merely the code.

### 2. Pay cannot reveal a restriction

Three things are kept strictly apart:

- **Contracted hours (FTE)** — an employment-contract fact. Payroll sees it. A person
  may be part-time for any reason: choice, study, caregiving, an accommodation.
  Payroll cannot tell which.
- **A daily or weekly cap** — a scheduling constraint from the firewall. The scheduler
  sees it. Payroll never does.
- **Voluntary extra hours** — opt-in only, same premium rate for everyone.

**Base pay is always computed from contracted hours**, never from hours actually
rostered. So an accommodation costs the employee nothing, and — just as important —
produces no payroll anomaly anyone could reason backwards from. Nobody has a financial
reason to hide a restriction.

Priya (7.5h cap) and Arjun (6h cap) are paid exactly what an unrestricted colleague on
the same contract is paid. Sneha earns more because she *chose* extra hours, not
because she is healthy.

### 3. A fatigue ceiling nobody can volunteer past

The fatigue score is built from operational exposure only — hours, nights, rest gaps,
consecutive days, weekends, voluntary extra hours. No health data is an input, so none
can leak out through the score.

It has a **hard ceiling**. Someone at the ceiling cannot be allocated additional hours
and cannot waive the limit. Without this, paying a premium for extra hours would quietly
push healthy staff into becoming unhealthy ones.

---

## The standard HR portal

Built after the privacy core, deliberately — these are the modules where a
careless design leaks health status back in through a side door. Each one is
built against the boundary already established.

### Performance management

The highest-risk module. If a review can be marked down for "poor
availability", every reduced-hours accommodation becomes a performance penalty
and the restriction has been disclosed through the back door.

Three structural defences:

- **A closed competency vocabulary.** Reviews rate eight things, none of which
  is hours, availability, attendance, punctuality, flexibility or overtime. A
  rating key outside the list is rejected by the API, not merely discouraged.
- **Rate, not total.** Every measured goal is scored per hour actually worked,
  against the same per-hour target for everyone. Priya (7.5h daily cap)
  achieves **107%** of target on 58.5 hours. Measured the naive way — 94 of 120
  care plans — she would read as 78%, a failing score caused entirely by her
  accommodation.
- **A free-text guard.** Narrative fields are scanned for language that marks
  someone down for their working pattern. Matches do not block the review; they
  are recorded on it, visible to the employee and to compliance. Making it
  visible is the point.

`performance.service.ts` never imports the firewall, and a test asserts that.

### Recruitment and resume screening

Deterministic and explainable: it matches a resume against the qualifications
the posting states and quotes the line where each match was found, so a
reviewer can check the machine's work.

- **It never rejects.** `screen()` can only set `SCREENED`. Only `decide()` can
  set `REJECTED`, it requires a human actor, and it refuses without a recorded
  reason.
- **It scores only stated requirements.** Nothing else contributes.
- **Health disclosures are set aside.** Candidates sometimes explain a career
  gap. That explanation is excluded from scoring and shown to the reviewer as
  set aside, rather than quietly becoming an input.

### The workforce assistant

Deterministic retrieval over the asker's own data and published policy. There
is no language model behind it, and that is a choice rather than a shortcut: an
assistant that can be prompted is an assistant that can be prompted into
disclosing something.

- It never imports the health service or the firewall.
- It answers about the asker only.
- A question seeking a medical reason is refused explicitly, and the refusal is
  logged. Asking "why does Arjun only work six hours?" returns an explanation
  of where the boundary is, not a guess.
- Every reply records the sources it consulted, shown in the interface.

### Onboarding, documents, offboarding, helpdesk

- The **document library refuses clinical content**. Uploading a fit note "so
  the manager has it on file" is exactly how a separate health store gets
  bypassed, so it is blocked and explained.
- **Offboarding revokes application access for real** — the account is
  deactivated and every session ended — but does not touch health records.
  Their retention is occupational health's decision under their own rules, so
  the checklist records who is handling it rather than letting an HR workflow
  delete clinical data it cannot read.

### Analytics

Operational reporting that never reads the constraint store, so no chart can be
broken down by health status — and a chart is how such a disclosure normally
happens. Departments below the minimum group size are suppressed.

### Work capacity, declared by the employee

The platform has to protect people on day one, before a hospital has an
occupational health team configured — and nobody should have to disclose a
diagnosis in order to be scheduled safely.

So an employee can state a limit on their **own work**: "no nights", "maximum
six hours". A functional questionnaire helps them find the right one, and every
question asks what they can *do* at work. No condition, symptom, medication or
diagnosis is asked for, and there is nowhere in the form to enter one.

The limit is recorded as `SELF_DECLARED` with no authorising clinician and a
30-day expiry. The scheduler obeys it immediately. Occupational health can
confirm it, which extends it to six months and records them as the authorising
officer. The employee can withdraw it at any time without giving a reason.

**Managers see the same neutral label either way.** Whether a limit was
self-declared or clinically assessed is not shown to them, because knowing it
invites pressure to "get it verified".

What this deliberately does **not** do is infer a restriction from a stated
condition. There is no reliable mapping from a diagnosis to a safe number of
working hours — two people with the same diagnosis can have entirely different
capacity — and a system that pretends otherwise is guessing about someone's
safety.

### Encryption at rest

Clinical fields — diagnosis codes, clinical notes, employee notes — are
encrypted with **AES-256-GCM** before they are written. Separating the
databases stops the application from leaking; it does not help if someone
obtains the file.

`GET /api/ready` reports whether encryption is actually on, so a deployment
that silently lost its key is visible rather than quietly insecure.

### Deployment

```bash
docker compose up --build
```

The image builds the front end, serves it from the API, runs the solver
alongside, and **refuses to start** without a real `JWT_SECRET` and
`HEALTH_ENCRYPTION_KEY`.

### Authentication

- Short-lived access tokens with **rotating refresh tokens** held as hashes.
  Presenting an already-rotated token is treated as theft and revokes the whole
  family.
- **Per-account lockout** after five failed attempts in fifteen minutes, plus a
  per-IP rate limit as a backstop.
- **Password policy** with live feedback, and changing a password ends every
  other session.
- Security headers via Helmet with a strict CSP; the app loads no third-party
  scripts.


---

## Project layout

```
humainity/
├── apps/
│   ├── api/                        Express + Drizzle + better-sqlite3
│   │   └── src/
│   │       ├── db/
│   │       │   ├── hr.schema.ts        operational store
│   │       │   ├── health.schema.ts    restricted store
│   │       │   ├── index.ts            two connections, two clients
│   │       │   ├── migrate.ts          schema DDL
│   │       │   └── seed.ts             synthetic data
│   │       ├── lib/
│   │       │   └── constraint-vocabulary.ts   the closed vocabulary
│   │       ├── services/
│   │       │   ├── health.service.ts       the only door to health.db
│   │       │   ├── firewall.service.ts     the five checks
│   │       │   ├── scheduling.service.ts   orchestration
│   │       │   ├── capacity.service.ts     capacity and pay
│   │       │   ├── fatigue.service.ts      fatigue engine
│   │       │   ├── fairness.service.ts     aggregate monitoring
│   │       │   └── audit.service.ts        hash-chained log
│   │       ├── solver/
│   │       │   ├── client.ts               calls CP-SAT, falls back
│   │       │   ├── fallback.ts             TypeScript heuristic engine
│   │       │   └── validator.ts            independent post-solve check
│   │       ├── routes/                     auth, hr, schedule, oh, workforce
│   │       └── __tests__/                  36 tests, mostly privacy attacks
│   └── web/                        React + Vite + TypeScript + Tailwind
│       └── src/
│           ├── components/ui/          design system
│           ├── components/FirewallDiagram.tsx
│           ├── layouts/AppShell.tsx    the restricted zone is set apart here
│           └── pages/                  12 role-aware pages
├── services/scheduler/             Python FastAPI + OR-Tools CP-SAT
├── docs/ARCHITECTURE.md
├── hr.db  health.db                created by `npm run setup`
└── .env.example
```

---

## Testing

```bash
npm run test:all     # lint, typecheck, unit tests, end-to-end tests
npm test             # unit only
npm run test:e2e     # end-to-end only (needs: npx playwright install chromium)
npm run lint         # includes the privacy boundary rules
```

**75 tests.** The lint step is not cosmetic — it fails the build if anyone
imports the health database client outside the single module permitted to, or
reads the constraint store from a module that must stay blind to it:

```
error  'healthDb' import from '../db/index.js' is restricted.
       The health database is reachable from exactly one module:
       services/health.service.ts.
```

62 unit tests. Most of them actively try to break the firewall:

- diagnosis codes and clinical notes do not appear anywhere in `hr.db`
- `scheduling_constraints` has no column capable of holding a reason
- every non-OH role is refused by the health service, and each refusal is audited
- the constraint payload reaching the scheduler contains numbers only
- a restriction type outside the closed vocabulary is refused and never projected
- a free-text parameter is rejected at the schema boundary
- an expired restriction is refused rather than silently persisting
- the audit chain verifies, and tampering with one row is detected
- the independent validator catches night-shift, daily-cap and leave breaches
- base pay equals contracted hours × rate for every employee
- an employee with a cap is paid the same base as an identical colleague without one
- `pay_lines` has no column from which a restriction could be inferred
- fairness statistics are suppressed for groups below the minimum size
- a performance review cannot rate "availability", and the vocabulary has no
  hours, attendance or flexibility measure
- goal attainment is a rate, so an employee with a cap still meets target while
  the naive total-based score would fail her
- narrative text marking someone down for reduced hours is flagged
- performance, analytics and the assistant contain no reference to the
  constraint store or the health client, asserted against the source with
  comments stripped
- resume screening cannot reject, and a health disclosure in a resume changes
  the score by exactly zero
- a rejection without a recorded reason is refused
- the document library blocks a fit note and allows a parking notice
- the assistant refuses four phrasings of "why is this person restricted"
- a rotated refresh token presented twice revokes the whole session family
- an account locks out after five failed sign-ins

---

## Scripts

| Command | What it does |
|---|---|
| `npm run setup` | Install, create both databases, seed |
| `npm run dev` | API + web + solver together |
| `npm run dev:api` | API only, on 4000 |
| `npm run dev:web` | Web only, on 5173 |
| `npm run dev:solver` | CP-SAT service only, on 8000 |
| `npm run db:reset` | Drop and rebuild both databases |
| `npm test` | Run the test suite |

---

## Honest limitations

These are real and worth stating in a viva rather than being caught by them.

- **The novelty claim is unverified.** The contribution is the privacy architecture and
  its evaluation. Whether this exact combination is absent from commercial products has
  not been checked, so the project does not claim "nothing like this exists".
- **One shift per employee per day.** Standard for hospital rostering, but it means
  split shifts are not modelled.
- **Minimum rest is modelled coarsely** — a night shift blocks the following day for
  anyone carrying a 12h+ rest constraint, rather than computing exact clock gaps.
- **SQLite, not PostgreSQL.** Chosen for zero-setup demonstration. The two-database
  separation is the part that matters and it transfers directly; in production these
  are separate servers with separate credentials.
- **Authentication is JWT in `localStorage`** with no refresh tokens, rate limiting or
  CSRF protection. Adequate for a prototype, not for deployment.
- **No encryption at rest** on the health store. A production deployment would need it.
- **The legal review is not done.** The design should be assessed against India's
  Digital Personal Data Protection Act 2023, its commencement provisions and rules, and
  relevant employment law. Nothing here constitutes legal advice.
- **Medical documents are referenced but not stored** — there is no upload pipeline.
- **The assistant is retrieval, not generative.** It matches intents and reads
  rows. It will not answer a question it has no intent for, and says so.
- **Document uploads are text only.** There is no binary storage pipeline, so
  the schema has `storageKey` and `mimeType` columns that nothing fills yet.
- **Key rotation is not automated.** The encryption format is versioned so a
  rotation is possible, but re-encrypting existing rows needs a migration
  script that does not yet exist.
- **Accessibility has had a pass, not an audit.**

The full release checklist, including the governance work that code cannot
supply, is in [docs/RELEASE.md](docs/RELEASE.md).
