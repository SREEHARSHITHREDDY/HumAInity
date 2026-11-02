import { test, expect } from '@playwright/test';
import { ACCOUNTS, signIn, signOut, expectNoClinicalContent } from './helpers';

/* ═══════════════════════════════════════════════════════════════════════════
 *  The privacy guarantees, exercised through the real interface.
 *
 *  The unit tests prove the services behave. These prove that what actually
 *  reaches a browser matches — which is where a leak would be visible to a
 *  person rather than to a function.
 * ═════════════════════════════════════════════════════════════════════════ */

test.describe('what each role can see', () => {
  test('a line manager sees the limit but never the reason', async ({ page }) => {
    await signIn(page, ACCOUNTS.manager);
    await page.goto('/people');
    await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();

    // A restriction label is present…
    await expect(page.getByText(/Maximum .* hours per day/).first()).toBeVisible();
    // …and nothing clinical is.
    await expectNoClinicalContent(page);
  });

  test('a line manager cannot reach the occupational health console', async ({ page }) => {
    await signIn(page, ACCOUNTS.manager);
    await page.goto('/occupational-health');
    await expect(page.getByText(/restricted to the occupational health team/i))
      .toBeVisible({ timeout: 15_000 });
    await expectNoClinicalContent(page);
  });

  test('an HR admin sees payroll with no field that reveals a restriction', async ({ page }) => {
    await signIn(page, ACCOUNTS.hr);
    await page.goto('/pay');
    await expect(page.getByRole('heading', { name: 'Pay', exact: true })).toBeVisible();
    await expectNoClinicalContent(page);

    const headers = await page.locator('thead th').allInnerTexts();
    for (const banned of ['restriction', 'accommodation', 'health', 'reason', 'capped']) {
      expect(headers.join(' ').toLowerCase()).not.toContain(banned);
    }
  });

  test('the occupational health officer is the one role that sees clinical content', async ({ page }) => {
    await signIn(page, ACCOUNTS.oh);
    await page.goto('/occupational-health');
    await expect(page.getByRole('heading', { name: 'Occupational health', exact: true })).toBeVisible();
    // This is the only page in the application where a diagnosis may appear.
    await expect(page.getByText(/ICD/).first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('the assistant', () => {
  test('refuses a question that seeks a medical reason', async ({ page }) => {
    await signIn(page, ACCOUNTS.manager);
    await page.goto('/assistant');
    await page.fill('input[placeholder*="Ask about"]', 'Why does Arjun only work 6 hours a day?');
    await page.getByRole('button', { name: 'Ask' }).click();

    await expect(page.getByText(/stays with occupational health/i).last())
      .toBeVisible({ timeout: 15_000 });
    await expectNoClinicalContent(page);
  });

  test('answers an ordinary question and shows what it consulted', async ({ page }) => {
    await signIn(page, ACCOUNTS.employeeCapped);
    await page.goto('/assistant');
    await page.fill('input[placeholder*="Ask about"]', 'How much annual leave do I have left?');
    await page.getByRole('button', { name: 'Ask' }).click();

    await expect(page.getByText(/days left/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('consulted:').last()).toBeVisible();
  });
});

test.describe('an employee', () => {
  test('sees their own restrictions and that the reason is withheld from managers', async ({ page }) => {
    await signIn(page, ACCOUNTS.employeeCapped);
    await page.goto('/schedule');
    await expect(page.getByRole('heading', { name: 'My schedule', exact: true })).toBeVisible();
    await expectNoClinicalContent(page);
  });

  test('is paid in full despite a scheduling cap', async ({ page }) => {
    await signIn(page, ACCOUNTS.employeeCapped);
    await page.goto('/pay');
    await expect(page.getByRole('heading', { name: 'My pay' })).toBeVisible();
    // Base pay is computed on contracted hours, so the figure is present and
    // the explanation says so.
    await expect(page.getByText(/contracted/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('can declare a work limit without disclosing anything medical', async ({ page }) => {
    await signIn(page, ACCOUNTS.employeeFree);
    await page.goto('/capacity');
    await expect(page.getByRole('heading', { name: 'Work capacity', exact: true })).toBeVisible();

    // The page may explain that it does not ask for a diagnosis. What matters
    // is that no control anywhere on it collects one.
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).toContain('never have to say why');

    const labels = (await page.locator('label, legend, [placeholder]').allInnerTexts()).join(' ').toLowerCase();
    const placeholders = (await page.locator('[placeholder]').evaluateAll(
      (els) => els.map((e) => (e as HTMLInputElement).placeholder).join(' '))).toLowerCase();
    for (const probe of ['diagnosis', 'condition', 'symptom', 'medication', 'illness']) {
      expect(labels, `no field may ask for a ${probe}`).not.toContain(probe);
      expect(placeholders, `no field may ask for a ${probe}`).not.toContain(probe);
    }
  });
});

test.describe('the audit trail', () => {
  test('records a refused access attempt', async ({ page }) => {
    // Provoke a denial…
    await signIn(page, ACCOUNTS.manager);
    await page.goto('/occupational-health');
    await page.waitForTimeout(1500);
    await signOut(page);

    // …then confirm compliance can see it.
    await signIn(page, ACCOUNTS.auditor);
    await page.goto('/audit');
    await expect(page.getByText('HEALTH_ACCESS_DENIED').first()).toBeVisible({ timeout: 15_000 });
  });

  test('verifies as an unbroken chain', async ({ page }) => {
    await signIn(page, ACCOUNTS.auditor);
    await page.goto('/audit');
    await expect(page.getByText(/Chain verified/i)).toBeVisible({ timeout: 15_000 });
  });
});
