import { test, expect } from '@playwright/test';
import {
  DEMO_PASSWORD,
  DEMO_ROLES,
  demoEmail,
  expectTemplate,
  settle,
  signIn,
  visitRoleScreen,
} from './template';

/**
 * Every screen every role can reach, walked by clicking its own navigation.
 *
 * The rail is filtered by permission, so it is the honest list of what a
 * role sees; clicking rather than typing URLs keeps the walk inside the app
 * the way a person moves through it. One role failing does not stop the
 * others: each walk reports on its own.
 */

for (const role of DEMO_ROLES) {
  test(`${role}: every screen in the navigation is drawn in the template`, async ({ page }) => {
    test.skip(!DEMO_PASSWORD, 'DEMO_PASSWORD is not set');

    const crashes: string[] = [];
    page.on('pageerror', (err) => crashes.push(`${page.url()}: ${err.message}`));

    await signIn(page, demoEmail(role), DEMO_PASSWORD);
    await settle(page);

    await expect(page.locator('aside nav[aria-label="Main"]')).toBeVisible();
    const links = await page.locator('aside nav[aria-label="Main"] a').evaluateAll((as) =>
      as.map((a, index) => ({ index, href: a.getAttribute('href') ?? '', label: a.textContent?.trim() ?? '' })),
    );
    expect(links.length, `${role} has a navigation`).toBeGreaterThan(0);

    const issues: string[] = [];
    for (const screen of links) {
      await visitRoleScreen(page, role, screen);
      await page.screenshot({
        path: `e2e-results/pages/${role}/${screen.href.replace(/[/?=&]/g, '_').replace(/^_/, '') || 'home'}.png`,
        fullPage: true,
      });
      issues.push(...(await expectTemplate(page, `${screen.label} (${screen.href})`)));
    }

    console.log(`${role}: walked ${links.length} screens`);
    expect(crashes, 'uncaught errors').toEqual([]);
    expect(issues).toEqual([]);
  });
}
