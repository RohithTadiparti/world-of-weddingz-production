import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end checks against a running stack (docker compose up).
 *
 * E2E_BASE_URL defaults to the local frontend. The suite signs in as the demo
 * accounts from `seed-demo`, so DEMO_PASSWORD must match the one they were
 * seeded with; without it the signed-in specs skip rather than fail.
 */
export default defineConfig({
  testDir: './e2e',
  // Not *.spec/*.test, so Vitest's default pattern never picks these up.
  testMatch: '**/*.e2e.ts',
  outputDir: './e2e-results/artifacts',
  // One worker: the sign-in endpoints are rate limited per address, and eight
  // roles signing in at once would trip the limit the suite is meant to respect.
  workers: 1,
  fullyParallel: false,
  timeout: 5 * 60 * 1000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: './e2e-results/report', open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // A machine set to dark mode, on purpose: the template is light only and
    // must be what every page shows whatever the system prefers.
    colorScheme: 'dark',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
