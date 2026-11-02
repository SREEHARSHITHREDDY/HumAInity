/* An accommodation must never cost anyone money, and payroll must hold no
 * field from which a restriction could be inferred. */
import { describe, it, expect } from 'vitest';
import { hrConnection } from '../db/index.js';
import * as capacity from '../services/capacity.service.js';
import * as fairness from '../services/fairness.service.js';

const HR = { userId: 1, email: 'hr@test', role: 'HR_ADMIN' };

describe('pay and accommodations', () => {
  it('pays base on contracted hours, never on hours actually rostered', () => {
    capacity.calculatePayPeriod(HR, 1);
    const rows = hrConnection.prepare(`
      select p.employee_id, p.contracted_hours, p.base_pay, e.base_hourly_rate
      from pay_lines p join employees e on e.id = p.employee_id
      where p.pay_period_id = 1`).all() as any[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.base_pay).toBeCloseTo(r.contracted_hours * r.base_hourly_rate, 1);
    }
  });

  it('pays an employee with a daily cap the same base as an identical colleague without one', () => {
    // Priya (E001, 7.5h cap) and a colleague on the same contract and rate.
    const [priya, control] = hrConnection.prepare(`
      select e.emp_code, p.base_pay, p.contracted_hours, e.base_hourly_rate
      from pay_lines p join employees e on e.id = p.employee_id
      where p.pay_period_id = 1 and e.emp_code in ('E001','E002')
      order by e.emp_code`).all() as any[];
    expect(priya.base_pay).toBe(control.base_pay);
  });

  it('exposes no field in payroll from which a restriction could be inferred', () => {
    const cols = (hrConnection.prepare('pragma table_info(pay_lines)').all() as any[]).map((c) => c.name);
    for (const forbidden of ['restriction', 'accommodation', 'capped_hours', 'reduced_hours',
      'health_status', 'reason', 'protected_hours'])
      expect(cols).not.toContain(forbidden);
  });

  it('passes the pay-equity check', () => {
    const r = fairness.payEquityCheck(1);
    expect(r.passed).toBe(true);
    expect(r.underpaid).toHaveLength(0);
  });
});

describe('fairness monitoring', () => {
  it('suppresses statistics for groups below the minimum size', () => {
    const r = fairness.computeFairness('2020-01-01', '2030-01-01', 99999 as any);
    expect(r.suppressed).toBe(true);
    expect(r.metrics).toBeNull();
    expect(r.reason).toMatch(/identify individuals/i);
  });

  it('reports aggregate distribution for a large enough group', () => {
    const r = fairness.computeFairness('2020-01-01', '2030-01-01', 'ALL');
    expect(r.suppressed).toBe(false);
    expect(r.metrics).not.toBeNull();
    expect(r.metrics!.nights.gini).toBeGreaterThanOrEqual(0);
  });
});
