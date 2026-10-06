import { test, expect } from '@playwright/test';
import { expectTemplate, settle } from './template';

const PUBLIC_PAGES = ['/', '/login', '/register', '/forgot-password'];

for (const width of [1440, 375]) {
  test.describe(`public pages at ${width}px`, () => {
    test.use({ viewport: { width, height: width > 400 ? 900 : 812 } });

    for (const path of PUBLIC_PAGES) {
      test(`${path} is drawn in the template`, async ({ page }) => {
        await page.goto(path);
        await settle(page);
        await page.screenshot({ path: `e2e-results/pages/public/${width}${path.replace(/\//g, '_') || '_home'}.png`, fullPage: true });
        expect(await expectTemplate(page, path)).toEqual([]);
      });
    }
  });
}

test('the home page carries every section of the template', async ({ page }) => {
  await page.goto('/');
  for (const name of ['Profiles', 'How it works', 'Stories', 'Sign in', 'Register']) {
    await expect(page.getByRole('banner').getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(page.locator('#profiles article')).toHaveCount(4);
  await expect(page.locator('#stories')).toContainText('consent');
  await expect(page.locator('#how')).toBeVisible();
  await expect(page.locator('#how')).toContainText('Create your profile');
});

test('the home page introduces the private matrimonial journey before registration', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('region', { name: 'A beautiful future begins here' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'A beautiful future begins here' }).getByRole('link', { name: 'Begin your journey' })
  ).toHaveAttribute('href', '/register');
});
