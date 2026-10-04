import { test, expect } from '@playwright/test';
import { expectTemplate, settle } from './template';

/**
 * A new bride registers through the form, filling in every field the way a
 * person would, and lands on her profile. Each run uses a fresh address, so
 * it leaves one more test account on the local database and nothing else.
 */
test('a new member can register and reach the profile', async ({ page }) => {
  const stamp = Date.now();
  // A password made per run, satisfying the form's rules: upper, lower, digit.
  const password = `Wow${stamp.toString(36)}e2eX9`;

  await page.goto('/register');
  await settle(page);
  expect(await expectTemplate(page, '/register')).toEqual([]);

  await page.getByRole('button', { name: /Individual/i }).first().click();
  await page.locator('#role').selectOption('bride');
  await page.locator('#firstName').fill('Ananya');
  await page.locator('#lastName').fill('Rao');
  await page.locator('#email').fill(`wow.e2e.${stamp}@gmail.com`);
  await page.locator('#phone').fill(`9${String(stamp).slice(-9)}`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);

  const response = page.waitForResponse((r) => r.url().includes('/api/auth/register'));
  await page.getByRole('button', { name: /^Create .*account$/ }).click();
  expect((await response).status()).toBeLessThan(300);

  await page.waitForURL('**/profile');
  await settle(page);
  await page.screenshot({ path: 'e2e-results/pages/register/profile-after-signup.png', fullPage: true });
  expect(await expectTemplate(page, '/profile after sign-up')).toEqual([]);
});
