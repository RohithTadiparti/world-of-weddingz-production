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

for (const role of ['bride', 'groom'] as const) {
  test(`${role}: profile readiness has an understandable next step`, async ({ page }) => {
    test.skip(!DEMO_PASSWORD, 'DEMO_PASSWORD is not set');

    await signIn(page, demoEmail(role), DEMO_PASSWORD);
    await page.goto('/');
    await settle(page);

    const readiness = page.getByRole('region', { name: 'Profile readiness' });
    await expect(readiness).toBeVisible();
    await expect(readiness.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^(?:[0-9]|[1-9][0-9]|100)$/);
    await expect(readiness.getByRole('link')).toHaveAttribute('href', /\/(?:profile|biodata)$/);
  });

  test(`${role}: future wedding pages explain their existing planning state`, async ({ page }) => {
    test.skip(!DEMO_PASSWORD, 'DEMO_PASSWORD is not set');

    await signIn(page, demoEmail(role), DEMO_PASSWORD);

    for (const path of ['/events', '/bookings', '/planner', '/travel']) {
      await page.goto(path);
      await settle(page);

      const futureWedding = page.getByRole('region', { name: 'Your future wedding' });
      await expect(futureWedding).toBeVisible();

      // A locked explanation is deliberately informational. It must not create
      // a navigation affordance before the host page's existing data exposes
      // an available milestone.
      const planningLink = futureWedding.getByRole('link');
      if ((await planningLink.count()) === 0) {
        await expect(futureWedding).toContainText('Available after your match is fixed');
      } else {
        await expect(planningLink).toHaveAttribute('href', path);
      }
    }
  });

  test(`${role}: matching and connection states stay understandable`, async ({ page }) => {
    test.skip(!DEMO_PASSWORD, 'DEMO_PASSWORD is not set');

    await signIn(page, demoEmail(role), DEMO_PASSWORD);
    await page.goto('/matches');
    await settle(page);

    await expect(page.getByRole('region', { name: 'Matching journey' })).toBeVisible();
    const firstCard = page.getByTestId('match-card').first();
    if (await firstCard.count()) {
      await expect(firstCard).toHaveAccessibleName(/Match introduction for /);
      await expect(firstCard.getByLabel(/Interaction state:/)).toBeVisible();
      const compatibility = firstCard.getByLabel('Compatibility context');
      if (await compatibility.count()) await expect(compatibility).toBeVisible();
      const fallback = firstCard.getByTestId('profile-silhouette');
      if (await fallback.count()) await expect(fallback).toBeVisible();
    }

    await page.goto('/interests');
    await settle(page);
    await expect(page.getByRole('region', { name: 'Interest status' })).toBeVisible();

    await page.goto('/chat');
    await settle(page);
    await expect(page.getByRole('region', { name: 'Private conversation status' })).toBeVisible();
  });
}
