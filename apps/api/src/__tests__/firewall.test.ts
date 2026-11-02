/* ═══════════════════════════════════════════════════════════════════════════
 *  THE PRIVACY TEST SUITE
 *
 *  These tests are the evidence for the project's central claim. Each one
 *  actively tries to break the firewall. They are written to fail loudly if
 *  a future change makes a leak possible.
 * ═════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll } from 'vitest';
import { hrDb, healthDb, hrConnection, healthConnection } from '../db/index.js';
import { schedulingConstraints } from '../db/hr.schema.js';
import { ohAssessments, workRestrictions } from '../db/health.schema.js';
import * as firewall from '../services/firewall.service.js';
import * as health from '../services/health.service.js';
import * as audit from '../services/audit.service.js';
import { CONSTRAINT_SCHEMAS, containsClinicalLanguage, CONSTRAINT_TYPES } from '../lib/constraint-vocabulary.js';
import { validate } from '../solver/validator.js';

const OH = { userId: 1, email: 'oh@test', role: 'OH_OFFICER' };
const MANAGER = { userId: 2, email: 'mgr@test', role: 'LINE_MANAGER' };
const HR = { userId: 3, email: 'hr@test', role: 'HR_ADMIN' };
const ADMIN = { userId: 4, email: 'admin@test', role: 'SYSTEM_ADMIN' };

beforeAll(() => { firewall.syncAll(OH); });

describe('separation of the two stores', () => {
  it('keeps diagnosis codes only in the health database', () => {
    const codes = healthConnection
      .prepare('select diagnosis_code from oh_assessments where diagnosis_code is not null')
      .all().map((r: any) => r.diagnosis_code);
    expect(codes.length).toBeGreaterThan(0);

    const tables = hrConnection
      .prepare("select name from sqlite_master where type='table'").all() as { name: string }[];
    const haystack = tables
      .flatMap((t) => hrConnection.prepare(`select * from "${t.name}"`).all())
      .map((row: any) => Object.values(row).join(' ')).join(' ');

    for (const code of codes) expect(haystack).not.toContain(code);
  });

  it('keeps clinical notes only in the health database', () => {
    const notes = healthConnection
      .prepare('select clinical_notes from oh_assessments where clinical_notes is not null')
      .all().map((r: any) => r.clinical_notes as string);

    const tables = hrConnection
      .prepare("select name from sqlite_master where type='table'").all() as { name: string }[];
    const haystack = tables
      .flatMap((t) => hrConnection.prepare(`select * from "${t.name}"`).all())
      .map((row: any) => Object.values(row).join(' ')).join(' ');

    for (const note of notes) {
      const fragment = note.split('.')[0].trim();
      if (fragment.length > 15) expect(haystack).not.toContain(fragment);
    }
  });

  it('gives the scheduling-constraints table no column that could hold a reason', () => {
    const cols = (hrConnection.prepare('pragma table_info(scheduling_constraints)').all() as any[])
      .map((c) => c.name as string);
    for (const forbidden of ['reason', 'diagnosis', 'diagnosis_code', 'clinical_notes', 'notes', 'assessment_id'])
      expect(cols).not.toContain(forbidden);
  });
});

describe('role enforcement on the health store', () => {
  for (const actor of [MANAGER, HR, ADMIN]) {
    it(`refuses ${actor.role} access to assessments`, () => {
      expect(() => health.listAssessments(actor as any)).toThrowError(/restricted/i);
    });
    it(`refuses ${actor.role} access to restrictions`, () => {
      expect(() => health.listRestrictionsForOfficer(actor as any)).toThrowError(/restricted/i);
    });
  }

  it('allows the occupational health officer', () => {
    expect(() => health.listAssessments(OH as any)).not.toThrow();
  });

  it('writes an audit entry when access is refused', () => {
    try { health.listAssessments(MANAGER as any); } catch { /* expected */ }
    const denied = audit.list({ action: 'HEALTH_ACCESS_DENIED', limit: 50 });
    expect(denied.length).toBeGreaterThan(0);
    expect(denied[0].outcome).toBe('DENIED');
  });
});

describe('what the scheduler receives', () => {
  it('carries only type, numeric params and dates', () => {
    const forScheduler = firewall.constraintsForScheduler([1, 2, 3, 9], '2020-01-01', '2030-01-01');
    expect(forScheduler.length).toBeGreaterThan(0);
    for (const c of forScheduler) {
      expect(Object.keys(c).sort()).toEqual(['effectiveFrom', 'effectiveTo', 'employeeId', 'params', 'type']);
      expect(CONSTRAINT_TYPES).toContain(c.type as any);
      for (const v of Object.values(c.params)) {
        const ok = typeof v === 'number' || (Array.isArray(v) && v.every((x) => typeof x === 'number'));
        expect(ok).toBe(true);     // numbers only — never a string
      }
      expect(containsClinicalLanguage(c.params)).toBeNull();
    }
  });

  it('gives managers a label with no reason attached', () => {
    const all = firewall.allActive().filter((c) => c.status === 'ACTIVE');
    expect(all.length).toBeGreaterThan(0);
    const view = firewall.constraintsForManager(all[0].employeeId);
    for (const r of view) {
      expect(containsClinicalLanguage(r.description)).toBeNull();
      expect(r).not.toHaveProperty('diagnosisCode');
      expect(r).not.toHaveProperty('clinicalNotes');
      expect(r.note).toMatch(/not available here/i);
    }
  });

  it('shows an employee exactly what their manager sees, no more and no less', () => {
    const all = firewall.allActive().filter((c) => c.status === 'ACTIVE');
    const id = all[0].employeeId;
    expect(firewall.constraintsForSelf(id)).toEqual(firewall.constraintsForManager(id));
  });
});

describe('the five firewall checks', () => {
  it('refuses a restriction whose end date has passed', () => {
    const result = firewall.syncAll(OH);
    const expired = result.refused.find((r) => /past its end date/i.test(r.reason));
    expect(expired).toBeDefined();   // the seed contains one deliberately
  });

  it('refuses a type outside the closed vocabulary', () => {
    // Unique per run, so repeated test runs do not collide on opaqueRef.
    const ref = `ocr_test_badtype_${Date.now()}`;
    const a = healthDb.select().from(ohAssessments).all()[0];
    healthDb.insert(workRestrictions).values({
      employeeRef: a.employeeRef, assessmentId: a.id,
      restrictionType: 'NO_PATIENTS_WITH_INFECTIOUS_DISEASE',   // not in the vocabulary
      params: '{}', effectiveFrom: '2020-01-01', effectiveTo: '2030-01-01',
      authorizedBy: 'oh@test', consentId: null, status: 'ACTIVE',
      opaqueRef: ref,
    }).run();

    const r = firewall.syncAll(OH);
    const refusal = r.refused.find((x) => x.opaqueRef === ref);
    expect(refusal).toBeDefined();

    const leaked = hrDb.select().from(schedulingConstraints).all()
      .find((c) => c.opaqueRef === ref);
    expect(leaked).toBeUndefined();
  });

  it('rejects a free-text parameter at the schema boundary', () => {
    const parsed = CONSTRAINT_SCHEMAS.MAX_DAILY_HOURS.safeParse({
      hours: 6, reason: 'chronic condition under specialist management',
    });
    expect(parsed.success).toBe(false);   // .strict() forbids extra keys
  });

  it('detects clinical language anywhere in a payload', () => {
    expect(containsClinicalLanguage({ hours: 6 })).toBeNull();
    expect(containsClinicalLanguage({ hours: 6, note: 'post-surgery recovery' })).not.toBeNull();
    expect(containsClinicalLanguage({ type: 'diagnosis' })).not.toBeNull();
  });

  it('reports a clean operational store', () => {
    const v = firewall.verifyNoLeakage();
    expect(v.clean).toBe(true);
    expect(v.findings).toHaveLength(0);
  });
});

describe('the audit log', () => {
  it('verifies as an unbroken hash chain', () => {
    const r = audit.verifyChain();
    expect(r.valid).toBe(true);
  });

  it('detects tampering', () => {
    const row = hrConnection.prepare('select id, detail from audit_log order by id limit 1').get() as any;
    hrConnection.prepare('update audit_log set detail = ? where id = ?').run('edited', row.id);
    expect(audit.verifyChain().valid).toBe(false);
    hrConnection.prepare('update audit_log set detail = ? where id = ?').run(row.detail, row.id);
    expect(audit.verifyChain().valid).toBe(true);   // restored
  });
});

describe('the independent validator', () => {
  const base = {
    period_start: '2026-11-02', period_end: '2026-11-08',
    employees: [{
      id: 1, name: 'Test', department_id: 1, qualifications: ['RN'],
      contracted_hours_per_week: 40, voluntary_extra_cap_hours: 0,
      fatigue_score: 10, fatigue_at_ceiling: false,
    }],
    shifts: [{
      requirement_id: 1, date: '2026-11-02', department_id: 1, template_id: 3,
      template_code: 'NIGHT', duration_hours: 9, is_night: true, workload_weight: 1.4,
      required_count: 1, required_qualification: 'RN', coverage_weight: 3,
    }],
    leave: [], preferences: [], max_time_seconds: 5,
  };

  it('catches a night shift assigned against a NO_NIGHT_SHIFTS restriction', () => {
    const v = validate(
      { ...base, constraints: [{ employee_id: 1, type: 'NO_NIGHT_SHIFTS', params: {} }] } as any,
      [{ requirement_id: 1, employee_id: 1, date: '2026-11-02', hours: 9, workload_weight: 1.4, is_voluntary_extra: false }],
    );
    expect(v.map((x) => x.rule)).toContain('NO_NIGHT_SHIFTS');
  });

  it('catches a breach of a daily hours cap', () => {
    const v = validate(
      { ...base, constraints: [{ employee_id: 1, type: 'MAX_DAILY_HOURS', params: { hours: 6 } }] } as any,
      [{ requirement_id: 1, employee_id: 1, date: '2026-11-02', hours: 9, workload_weight: 1.4, is_voluntary_extra: false }],
    );
    expect(v.map((x) => x.rule)).toContain('MAX_DAILY_HOURS');
  });

  it('catches an assignment made during approved leave', () => {
    const v = validate(
      { ...base, constraints: [], leave: [{ employee_id: 1, date: '2026-11-02' }] } as any,
      [{ requirement_id: 1, employee_id: 1, date: '2026-11-02', hours: 9, workload_weight: 1.4, is_voluntary_extra: false }],
    );
    expect(v.map((x) => x.rule)).toContain('LEAVE');
  });

  it('passes a roster that breaks nothing', () => {
    const v = validate({ ...base, constraints: [] } as any,
      [{ requirement_id: 1, employee_id: 1, date: '2026-11-02', hours: 9, workload_weight: 1.4, is_voluntary_extra: false }]);
    expect(v).toHaveLength(0);
  });
});
