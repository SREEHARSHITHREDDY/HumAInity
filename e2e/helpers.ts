import { type Page, expect } from '@playwright/test';

export const ACCOUNTS = {
  employeeCapped:  'priya.nair@humainity.io',      // 7.5h daily cap
  employeeNoNights:'arjun.mehta@humainity.io',     // 6h cap, no nights
  employeeFree:    'sneha.reddy@humainity.io',
  planner:         'harish.kumar@humainity.io',
  manager:         'shalini.rao@humainity.io',
  hr:              'deepak.sharma@humainity.io',
  oh:              'anita.bose@humainity.io',
  auditor:         'geeta.krishnan@humainity.io',
} as const;

export const PASSWORD = 'Demo@1234';

export async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await expect(page.locator('nav').first()).toBeVisible({ timeout: 15_000 });
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.waitForURL('**/login');
}

/** Asserts that no clinical term appears anywhere in the rendered page. */
export async function expectNoClinicalContent(page: Page) {
  const body = (await page.locator('body').innerText()).toLowerCase();
  for (const term of [
    'm54.5', 'g47.20', 'm25.51',
    'post-operative', 'chronic condition', 'musculoskeletal', 'circadian',
    'diagnosis code', 'clinical note',
  ]) {
    expect(body, `"${term}" must not appear on this page`).not.toContain(term);
  }
}
