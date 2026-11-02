# Releasing HumAInity

## Read this first

This system holds occupational health data about identifiable people. The
engineering is release-grade; **the governance is not something code can
supply**. Everything in Part A must be done before real staff records go
anywhere near it.

Nothing in this document is legal advice.

---

## Part A — what must happen before a pilot with real people

These are not optional, and none of them is a software task.

- [ ] **Assessment under the Digital Personal Data Protection Act, 2023**,
      including its commencement provisions and rules. Health data is sensitive
      personal data and the obligations are specific.
- [ ] **A lawful basis recorded for each processing purpose.** The system has a
      `consents` table and records a basis per restriction, but *which* basis
      applies is a decision for the hospital and its advisers.
- [ ] **A retention schedule** for clinical records, agreed with occupational
      health. The offboarding workflow deliberately refers rather than deletes.
- [ ] **A penetration test** by someone who did not write the code.
- [ ] **A data processing agreement** with whoever hosts it.
- [ ] **A breach response plan**, including who is notified and within what
      period.
- [ ] **Employee-facing notice** explaining what is held, who can see it, and
      how to see your own audit trail. A draft is seeded as "Privacy notice for
      staff records" — have it reviewed, do not ship it as written.
- [ ] **Occupational health sign-off** on the restriction vocabulary. Ten
      constraint types is a design decision, not a clinical one.

---

## Part B — technical checklist

### Secrets

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # HEALTH_ENCRYPTION_KEY
```

- [ ] `JWT_SECRET` set, not the development default. The API refuses to start
      in production with the default.
- [ ] `HEALTH_ENCRYPTION_KEY` set. The API refuses to start without it in
      production, and the Docker entrypoint refuses before that.
- [ ] Both stored in a secret manager, **not** in the image, the repository or
      a compose file.
- [ ] `HEALTH_ENCRYPTION_KEY` backed up separately from the database. Losing it
      makes every clinical record permanently unreadable. Losing *only* the
      database and keeping the key is recoverable; the reverse is not.

### Configuration

- [ ] `NODE_ENV=production`
- [ ] `WEB_ORIGIN` set to the real origin. Never a wildcard — credentials are
      allowed on CORS because the refresh token is a cookie.
- [ ] `FIREWALL_STRICT_MODE=true`
- [ ] `FAIRNESS_MIN_GROUP_SIZE` agreed with whoever reads the fairness reports.
      Five is a starting point, not a standard.
- [ ] Rate limits reviewed. If staff share one outbound address, raise
      `RATE_LIMIT_LOGIN_MAX`; the per-account lockout is the real control and is
      not configurable.
- [ ] `SEED_DEMO_DATA` unset or `false`. It loads synthetic people.

### Database

The prototype ships with SQLite for zero-setup demonstration. For production:

- [ ] Move to PostgreSQL, **two separate instances** with separate credentials.
      The application user for the HR store should have no grant at all on the
      health store. The two-database separation is the part that matters and it
      transfers directly — the Drizzle schemas change dialect, not shape.
- [ ] Encryption at rest at the storage layer *in addition to* the field
      encryption, so indexes and write-ahead logs are covered too.
- [ ] Automated backups, with a tested restore. An untested backup is a guess.
- [ ] `apps/api/src/db/migrate.ts` run on deploy. It is additive and safe to
      re-run; it never drops anything unless given `--fresh`.

### Verification before you ship

```bash
npm run test:all     # lint, typecheck, 62 unit tests, 13 end-to-end tests
```

- [ ] All green. The lint step is not cosmetic: it fails the build if anyone
      has imported the health client outside the one module permitted to.
- [ ] `GET /api/ready` returns 200 and shows `clinicalEncryption.ok: true`.
- [ ] Sign in as a line manager and confirm the occupational health console
      refuses you, and that the refusal appears in the audit trail.

### Operations

- [ ] `GET /api/health` wired to the liveness probe, `GET /api/ready` to
      readiness. Do not point liveness at `/ready` — a database hiccup would
      restart the process instead of taking it out of rotation.
- [ ] Log shipping configured. Logs are JSON in production and carry a request
      id. Clinical content, passwords and tokens are redacted before writing.
- [ ] Alert on: `/api/ready` reporting degraded, any `FIREWALL_REFUSED` audit
      entry, and any failure of the audit chain verification.
- [ ] Someone named as responsible for reviewing `HEALTH_ACCESS_DENIED`
      entries. A log nobody reads is not a control.

---

## Part C — honest limitations at this version

State these rather than be caught by them.

- **The novelty claim is unverified.** The contribution is the privacy
  architecture and its evaluation. Whether this exact combination is absent from
  commercial products has not been checked, and the project does not claim it.
- **One shift per employee per day.** Standard for hospital rostering, but split
  shifts are not modelled.
- **Minimum rest is modelled coarsely** — a night shift blocks the following day
  for anyone with a 12-hour-plus rest rule, rather than computing exact clock
  gaps.
- **Document storage is text only.** There is no binary upload pipeline; the
  schema has `storageKey` and `mimeType` columns that nothing fills.
- **The assistant is retrieval, not generative.** It will not answer a question
  it has no intent for, and says so.
- **Key rotation is not automated.** The encryption format is versioned so a
  rotation is possible, but re-encrypting existing rows would need a migration
  script that does not yet exist.
- **No multi-tenancy.** One deployment serves one organisation.
- **Accessibility has had a pass, not an audit.** Keyboard navigation, focus
  rings, labelled controls and reduced-motion support are in place; it has not
  been tested with a screen reader by someone who uses one.
