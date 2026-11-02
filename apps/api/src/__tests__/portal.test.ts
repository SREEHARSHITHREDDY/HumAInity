/* ═══════════════════════════════════════════════════════════════════════════
 *  TIER 2 PRIVACY TESTS
 *
 *  The standard HR modules are where a careless design leaks health status
 *  back in through a side door. Each test here tries one of those doors.
 * ═════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from 'vitest';
import { hrConnection } from '../db/index.js';
import * as perf from '../services/performance.service.js';
import * as rec from '../services/recruitment.service.js';
import * as work from '../services/workplace.service.js';
import * as assistant from '../services/assistant.service.js';
import * as analytics from '../services/analytics.service.js';
import * as auth from '../services/auth.service.js';
import { COMPETENCY_CODES, guardFreeText } from '../lib/competencies.js';


/* Reads a service's source with comments stripped, so an import-boundary
 * assertion tests the CODE rather than a comment that happens to mention the
 * thing it promises not to use. */
async function codeOf(relative: string): Promise<string> {
  const fs = await import('node:fs');
  const raw = fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/^\s*\/\/.*$/gm, '');        // line comments
}

const MGR = { userId: 2, email: 'mgr@test', role: 'LINE_MANAGER', employeeId: 22 };
const HR = { userId: 3, email: 'hr@test', role: 'HR_ADMIN', employeeId: 23 };
const EMP = { userId: 1, email: 'priya@test', role: 'EMPLOYEE', employeeId: 1 };

/* ─── Performance: ethics rule 11 ────────────────────────────────────────── */

describe('performance management cannot penalise an accommodation', () => {
  it('has no availability, hours or attendance competency', () => {
    const banned = ['AVAILABILITY', 'HOURS', 'ATTENDANCE', 'PUNCTUALITY', 'FLEXIBILITY', 'OVERTIME'];
    for (const b of banned) expect(COMPETENCY_CODES).not.toContain(b as any);
    expect(COMPETENCY_CODES.length).toBe(8);
  });

  it('refuses a rating key outside the closed vocabulary', () => {
    expect(() => perf.saveReview(MGR, {
      cycleId: 1, employeeId: 1, ratings: { WORK_QUALITY: 4, availability: 2 } as any,
    })).toThrowError(/not a competency that can be rated/i);
  });

  it('refuses a rating outside 1 to 5', () => {
    expect(() => perf.saveReview(MGR, {
      cycleId: 1, employeeId: 1, ratings: { WORK_QUALITY: 9 },
    })).toThrowError(/from 1 to 5/i);
  });

  it('flags narrative text that marks someone down for their working pattern', () => {
    const flags = guardFreeText('development',
      'Good clinically, but her reduced hours mean she is less available than the team needs.');
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.map((f) => f.phrase)).toEqual(
      expect.arrayContaining([expect.stringMatching(/reduced hours|available/)]));
  });

  it('does not flag an ordinary narrative', () => {
    expect(guardFreeText('strengths',
      'Excellent handover discipline and consistently accurate documentation.')).toHaveLength(0);
  });

  it('records the flags on the review rather than silently blocking it', () => {
    const r = perf.saveReview(MGR, {
      cycleId: 1, employeeId: 3, ratings: { WORK_QUALITY: 3 },
      development: 'Would benefit from greater availability for night shifts.',
    });
    expect(r.guardFlags.length).toBeGreaterThan(0);
  });

  /* The central claim of ethics rule 11.
   *
   * Asserted as a property rather than against particular seeded numbers, so
   * it holds whatever the roster happens to contain: whenever someone works
   * fewer hours than the full-time reference, scoring by RATE gives them a
   * higher attainment than scoring by raw total would. That difference is
   * exactly the penalty the naive method would impose on an accommodation. */
  it('scores by rate, so working fewer hours cannot lower attainment', () => {
    const cycle = perf.listCycles()[0];
    const weeks = (new Date(cycle.periodEnd).getTime() - new Date(cycle.periodStart).getTime())
      / (7 * 86_400_000) + 1 / 7;
    const referenceHours = 40 * weeks;

    let checked = 0;
    for (const employeeId of [1, 2, 3, 4]) {
      for (const g of perf.scoreGoals(employeeId, cycle.id)) {
        if (g.ratePerHour == null || g.target == null || g.actual == null) continue;
        checked++;

        // The figure the system reports.
        const byRate = g.attainmentPct!;
        // The figure a naive total-based review would have reported.
        const byTotal = (g.actual / g.target) * 100;

        if (g.hoursWorked < referenceHours) {
          expect(byRate, `employee ${employeeId} worked ${g.hoursWorked}h of a ${Math.round(referenceHours)}h ` +
            'reference, so rate-based scoring must not be worse than total-based')
            .toBeGreaterThan(byTotal);
        }

        // And the reported figure really is the rate calculation.
        const expected = Math.round(((g.actual / g.hoursWorked) / (g.target / referenceHours)) * 100);
        expect(byRate).toBe(expected);
      }
    }
    /* If no roster has been published yet nobody has hours, every goal is
     * correctly "not assessable", and there is nothing to compare. Assert that
     * state explicitly rather than silently passing on an empty loop. */
    if (checked === 0) {
      const all = [1, 2, 3, 4].flatMap((id) => perf.scoreGoals(id, cycle.id));
      expect(all.length, 'the cycle has no goals at all').toBeGreaterThan(0);
      for (const g of all) {
        expect(g.attainmentPct, 'with no hours worked a goal must be unscoreable, not 0%')
          .toBeNull();
      }
    }
  });

  it('reports a goal as unscoreable rather than zero when no hours were worked', () => {
    const cycle = perf.listCycles()[0];
    for (const g of perf.scoreGoals(1, cycle.id)) {
      if (g.hoursWorked === 0 && g.target != null) {
        expect(g.attainmentPct).toBeNull();
        expect(g.basis).toMatch(/not a score of zero/i);
      }
    }
  });

  it('applies the same per-hour target to everyone', () => {
    const a = perf.scoreGoals(1, 1).find((g) => g.targetRatePerHour !== null)!;
    const b = perf.scoreGoals(3, 1).find((g) => g.targetRatePerHour !== null)!;
    expect(a.targetRatePerHour).toBe(b.targetRatePerHour);
  });

  it('never reads the scheduling constraint store', async () => {
    const code = await codeOf('../services/performance.service.ts');
    expect(code).not.toMatch(/schedulingConstraints|firewall\.service/);
  });
});

/* ─── Recruitment ────────────────────────────────────────────────────────── */

describe('resume screening assists, it does not decide', () => {
  it('cannot set a rejected stage', () => {
    rec.screen(HR, 1);
    const after = hrConnection.prepare('select stage from applications where id = 1').get() as any;
    expect(after.stage).not.toBe('REJECTED');
    expect(['APPLIED', 'SCREENED']).toContain(after.stage);
  });

  it('sets aside health information volunteered in a resume', () => {
    const { evidence } = rec.scoreResume(
      [
        'B.Tech Computer Science (CS), certificate CS-1234.',
        'AWS certified.',
        'I took a career break in 2024 for medical treatment and am now fully fit.',
      ].join('\n'),
      { requiredQualifications: ['CS', 'AWS'], desirableSkills: [], minYearsExperience: 0 }, 3);

    expect(evidence.redactions.length).toBeGreaterThan(0);
    expect(evidence.explanation.join(' ')).toMatch(/set aside/i);
    expect(evidence.requiredMet).toHaveLength(2);     // still scored on its merits
  });

  it('scores only what the posting asks for', () => {
    const posting = { requiredQualifications: ['CS'], desirableSkills: ['kubernetes'], minYearsExperience: 1 };
    const plain = rec.scoreResume('B.Tech Computer Science (CS). Kubernetes trained.', posting, 2);
    const withHealth = rec.scoreResume(
      'B.Tech Computer Science (CS). Kubernetes trained.\nI have a chronic condition managed by a specialist.',
      posting, 2);
    expect(withHealth.score).toBe(plain.score);       // the extra line changed nothing
  });

  it('requires a recorded reason for a decision that affects the candidate', () => {
    expect(() => rec.decide(HR, 2, 'REJECTED')).toThrowError(/needs a short reason/i);
    expect(() => rec.decide(HR, 2, 'REJECTED', 'Does not hold the required ACLS certification.')).not.toThrow();
  });
});

/* ─── Documents ──────────────────────────────────────────────────────────── */

describe('the document library refuses clinical content', () => {
  it('blocks a fit note', () => {
    expect(() => work.createDocument(HR, {
      title: 'Fit note for A. Mehta', category: 'FORM',
      body: 'Diagnosed with a chronic condition; reduced hours advised.',
    })).toThrowError(/occupational health/i);
  });

  it('allows an ordinary policy', () => {
    expect(() => work.createDocument(HR, {
      title: 'Car parking arrangements', category: 'NOTICE',
      body: 'Staff parking moves to the north entrance from Monday.',
    })).not.toThrow();
  });
});

/* ─── Assistant ──────────────────────────────────────────────────────────── */

describe('the assistant cannot disclose a reason', () => {
  it('refuses a question seeking a medical reason', () => {
    const r = assistant.ask(MGR, 'Why does Arjun only work 6 hours a day?');
    expect(r.refused).toBe(true);
    expect(r.answer).toMatch(/stays with occupational health/i);
  });

  it('refuses several phrasings of the same question', () => {
    for (const q of [
      'what is wrong with Priya',
      'what is her diagnosis',
      'who has a restriction in SRE',
      'why is she restricted',
    ]) expect(assistant.ask(MGR, q).refused).toBe(true);
  });

  it('answers an ordinary question and records its sources', () => {
    const r = assistant.ask(EMP, 'How much annual leave do I have left?');
    expect(r.refused).toBe(false);
    expect(r.sources.length).toBeGreaterThan(0);
  });

  it('never consults a health source', () => {
    const audit = assistant.sourceAudit();
    expect(audit.touchedHealthStore).toBe(false);
  });

  it('does not import the health service or the firewall', async () => {
    const code = await codeOf('../services/assistant.service.ts');
    expect(code).not.toMatch(/health\.service|firewall\.service|healthDb/);
  });
});

/* ─── Analytics ──────────────────────────────────────────────────────────── */

describe('analytics cannot be broken down by health status', () => {
  it('does not read the constraint store', async () => {
    const code = await codeOf('../services/analytics.service.ts');
    expect(code).not.toMatch(/schedulingConstraints|firewall\.service/);
  });

  it('suppresses a department below the minimum group size', () => {
    const a = analytics.overview('2020-01-01', '2030-01-01');
    for (const d of a.byDepartment) {
      if (d.headcount < 5) {
        expect(d.suppressed).toBe(true);
        expect(d.coveragePct).toBeNull();
      }
    }
  });
});

/* ─── Auth ───────────────────────────────────────────────────────────────── */

describe('authentication hardening', () => {
  it('enforces a password policy', () => {
    expect(auth.checkPasswordStrength('short')).toBeTruthy();
    expect(auth.checkPasswordStrength('alllowercase123!')).toMatch(/uppercase/i);
    expect(auth.checkPasswordStrength('NoDigitsHere!!')).toMatch(/digit/i);
    expect(auth.checkPasswordStrength('NoSymbol1234')).toMatch(/symbol/i);
    expect(auth.checkPasswordStrength('password12345A!')).toMatch(/predictable/i);
    expect(auth.checkPasswordStrength('Tr0ub4dor&3xyz')).toBeNull();
  });

  it('rotates a refresh token and detects reuse of the old one', () => {
    const first = auth.issueRefreshToken(1, { ip: '127.0.0.1' });
    const second = auth.rotateRefreshToken(first.raw);
    expect(second.raw).not.toBe(first.raw);

    // Presenting the rotated token again means it was captured.
    expect(() => auth.rotateRefreshToken(first.raw)).toThrowError(/security/i);

    // …and the whole family is revoked, so the replacement stops working too.
    expect(() => auth.rotateRefreshToken(second.raw)).toThrow();
  });

  it('locks an account out after repeated failures', async () => {
    const email = `lockout-${Date.now()}@test`;
    for (let i = 0; i < 5; i++) {
      await auth.authenticate(email, 'wrong').catch(() => {});
    }
    await expect(auth.authenticate(email, 'wrong')).rejects.toThrowError(/too many failed/i);
  });
});

/* ─── Offboarding ────────────────────────────────────────────────────────── */

describe('offboarding does not touch health records', () => {
  it('refers them to occupational health instead of deleting them', async () => {
    const code = await codeOf('../services/workplace.service.ts');
    expect(code).not.toMatch(/healthDb|health\.service/);
    const fs = await import('node:fs');
    const raw = fs.readFileSync(new URL('../services/workplace.service.ts', import.meta.url), 'utf8');
    expect(raw).toMatch(/retention/i);
  });
});
