import { test, expect } from '@playwright/test';
import { DEMO_PASSWORD, demoEmail, expectTemplate, settle, signIn } from './template';

/**
 * The administrator Infrastructure page (UI-001), reached from the admin rail.
 *
 * Runs against whatever the stack has collected. Whatever that is, nothing
 * the server calls unknown may be drawn in the positive colour, and the
 * migration action stays disabled with its blockers listed.
 */
test('admin: infrastructure shows capacity, alerts and blocked migration readiness', async ({ page }) => {
  test.skip(!DEMO_PASSWORD, 'DEMO_PASSWORD is not set');

  const crashes: string[] = [];
  page.on('pageerror', (err) => crashes.push(err.message));

  await signIn(page, demoEmail('admin'), DEMO_PASSWORD);
  await settle(page);

  await page.locator('aside nav[aria-label="Main"]').getByRole('link', { name: 'Infrastructure' }).click();
  await expect(page).toHaveURL(/\/admin\/infrastructure$/);
  await settle(page);

  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Infrastructure' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Capacity' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Operational alerts' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'AWS migration readiness' })).toBeVisible();

  const cards = page.locator('[data-metric]');
  await expect(cards).toHaveCount(10);
  const unknown = page.locator('[data-metric][data-status="unknown"]');
  for (let i = 0; i < (await unknown.count()); i++) {
    await expect(unknown.nth(i).locator('.pill-positive')).toHaveCount(0);
    await expect(unknown.nth(i).getByText('Unknown', { exact: true })).toBeVisible();
  }

  await expect(page.getByTestId('revenue-minimum')).toHaveText('₹12,00,000');
  await expect(page.getByTestId('revenue-preferred')).toHaveText('₹15,00,000');
  await expect(page.getByTestId('revenue-measured')).toHaveText('Unknown');

  const start = page.getByTestId('start-migration');
  await expect(start).toBeDisabled();
  await expect(start).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#migration-blockers')).toContainText('Administrator step-up authentication');
  await expect(page.locator('#migration-blockers')).toContainText('Migration state machine and executor');

  await page.screenshot({ path: 'e2e-results/pages/admin/admin_infrastructure.png', fullPage: true });
  expect(await expectTemplate(page, 'Infrastructure (/admin/infrastructure)')).toEqual([]);

  // Phone width: the same page, nothing wider than the window.
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  expect(await expectTemplate(page, 'Infrastructure at 390px')).toEqual([]);
  expect(crashes).toEqual([]);
});

test('admin: the dashboard links to infrastructure with an honest status', async ({ page }) => {
  test.skip(!DEMO_PASSWORD, 'DEMO_PASSWORD is not set');

  await signIn(page, demoEmail('admin'), DEMO_PASSWORD);
  await page.goto('/admin');
  await settle(page);

  const tile = page.getByTestId('infrastructure-summary');
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute('href', '/admin/infrastructure');
});

test('a non-admin cannot reach infrastructure', async ({ page }) => {
  test.skip(!DEMO_PASSWORD, 'DEMO_PASSWORD is not set');

  await signIn(page, demoEmail('bride'), DEMO_PASSWORD);
  await page.goto('/admin/infrastructure');
  await settle(page);
  await expect(page.locator('[data-metric]')).toHaveCount(0);
});
