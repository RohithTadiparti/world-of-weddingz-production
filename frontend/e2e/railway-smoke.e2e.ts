import { expect, test } from '@playwright/test';
import { io } from 'socket.io-client';

const enabled = process.env.RAILWAY_SMOKE === 'true';
const frontendUrl = (process.env.E2E_BASE_URL ?? '').replace(/\/$/, '');
const apiUrl = (process.env.E2E_API_URL ?? '').replace(/\/$/, '');
const password = process.env.RAILWAY_SMOKE_PASSWORD ?? '';

test.describe('Railway four-service smoke', () => {
  test.skip(!enabled, 'RAILWAY_SMOKE=true is required');

  test('health, CORS auth rotation, navigation and WebSocket reconnect work', async ({ page, request }) => {
    expect(frontendUrl).toMatch(/^https:\/\//);
    expect(apiUrl).toMatch(/^https:\/\//);
    expect(password.length).toBeGreaterThanOrEqual(12);

    const shell = await request.get(`${frontendUrl}/`);
    expect(shell.ok()).toBeTruthy();
    const proxiedHealth = await request.get(`${frontendUrl}/api/health/live`);
    expect(proxiedHealth.ok()).toBeTruthy();

    const directHealth = await request.get(`${apiUrl}/api/health/live`, {
      headers: { Origin: frontendUrl },
    });
    expect(directHealth.ok()).toBeTruthy();
    expect(directHealth.headers()['access-control-allow-origin']).toBe(frontendUrl);
    expect(directHealth.headers()['access-control-allow-credentials']).toBe('true');

    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const registration = await request.post(`${apiUrl}/api/auth/register`, {
      headers: { Origin: frontendUrl },
      data: {
        email: `wow.railway.${stamp}@gmail.com`,
        username: `wow.railway.${stamp}`,
        password,
        accountType: 'individual',
        role: 'bride',
        displayName: 'Railway Smoke',
        phone: `9${stamp.slice(-9)}`,
      },
    });
    expect(registration.status()).toBe(201);
    expect(registration.headers()['access-control-allow-origin']).toBe(frontendUrl);
    const auth = await registration.json();
    expect(auth.accessToken).toBeTruthy();

    const setCookie = registration.headers()['set-cookie'] ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie.toLowerCase()).toContain('samesite=none');
    const cookie = setCookie.split(';', 1)[0];
    const refreshed = await request.post(`${apiUrl}/api/auth/refresh`, {
      headers: { Origin: frontendUrl, Cookie: cookie },
    });
    expect(refreshed.ok()).toBeTruthy();
    expect(refreshed.headers()['set-cookie']).toContain('HttpOnly');

    const browserStamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await page.goto('/register');
    await page.getByRole('button', { name: /Individual/i }).first().click();
    await page.getByRole('button', { name: 'Bride' }).click();
    await page.locator('#firstName').fill('Railway');
    await page.locator('#lastName').fill('Browser');
    await page.locator('#email').fill(`wow.railway.browser.${browserStamp}@gmail.com`);
    await page.locator('#username').fill(`rlyb.${browserStamp.slice(-12)}`);
    await page.locator('#phone').fill(`8${browserStamp.slice(-9)}`);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password').fill(password);
    const browserRegistration = page.waitForResponse((response) =>
      response.url().includes('/api/auth/register'),
    );
    await page.getByRole('button', { name: /^Create .*account$/ }).click();
    expect((await browserRegistration).status()).toBe(201);
    await page.waitForURL('**/profile');
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/profile');
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('main h1')).toBeVisible();

    await new Promise<void>((resolve, reject) => {
      const socket = io(`${apiUrl}/chat`, {
        auth: { token: auth.accessToken },
        extraHeaders: { Origin: frontendUrl },
        transports: ['websocket'],
        reconnection: true,
        timeout: 10_000,
      });
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('Railway WebSocket connection timed out'));
      }, 15_000);
      socket.once('connect', () => {
        socket.once('disconnect', () => {
          clearTimeout(timer);
          resolve();
        });
        socket.disconnect();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        socket.close();
        reject(error);
      });
    });
  });
});
