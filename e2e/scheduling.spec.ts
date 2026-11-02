import { test, expect } from '@playwright/test';
import { ACCOUNTS, signIn } from './helpers';

test.describe('scheduling', () => {
  test('a planner can generate a roster that respects every restriction', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, ACCOUNTS.planner);
    await page.goto('/rosters');

    await page.getByRole('button', { name: 'Generate roster' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.fill('#ps', '2026-10-26');
    await page.fill('#pe', '2026-11-08');
    await page.getByRole('dialog').getByRole('button', { name: 'Generate roster', exact: true }).click();

    await expect(page.getByText(/Roster generated/i)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/without any diagnosis reaching the scheduler/i)).toBeVisible();

    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();

    // The independent validator must report no hard-rule breaches.
    await page.getByRole('button', { name: /Validation/ }).first().click();
    await expect(page.getByText(/Independent validation passed/i)).toBeVisible({ timeout: 20_000 });
  });

  test('the roster grid shows capped staff on short shifts only', async ({ page }) => {
    await signIn(page, ACCOUNTS.planner);
    await page.goto('/rosters');
    await expect(page.getByRole('button', { name: /Roster grid/ })).toBeVisible({ timeout: 20_000 });

    const row = page.locator('tr', { hasText: 'Arjun Mehta' }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    // Arjun carries a 6h cap and a no-nights restriction, so every block in
    // his row must be 6h or shorter, and none may be a night.
    const blocks = await row.locator('.shift').allInnerTexts();
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      const hours = parseFloat(b);
      expect(hours, `Arjun was assigned a ${hours}h shift against a 6h cap`).toBeLessThanOrEqual(6);
      expect(b).not.toContain('NIGHT');
    }
  });
});
