import { test, expect } from '@playwright/test';

/**
 * Baseline: authenticated session works correctly.
 * Uses the admin session saved by auth.setup.ts.
 */
test.describe('Auth', () => {
  test('/api/me returns the authenticated admin user', async ({ request }) => {
    const res = await request.get('/api/me');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.user).toMatchObject({
      email: 'test-admin@affiliate-heaven.test',
      role: 'admin',
    });
  });

  test('session cookie is present after login', async ({ page }) => {
    await page.goto('/');
    const cookies = await page.context().cookies();
    const session = cookies.find(c => c.name === 'connect.sid');
    expect(session, 'session cookie must be set after auth setup').toBeTruthy();
  });

  test('logout clears the session', async ({ request }) => {
    // Logout with a standalone request context so we do not poison the shared session
    const standalone = await request.newContext();
    // First login
    const loginRes = await standalone.post('/auth/test-login', { data: { role: 'user' } });
    expect(loginRes.status()).toBe(200);

    // Confirm authenticated
    const meRes = await standalone.get('/api/me');
    expect(meRes.status()).toBe(200);

    // Logout
    const logoutRes = await standalone.post('/auth/logout');
    expect(logoutRes.status()).toBe(200);

    // Should be unauthenticated now
    const afterRes = await standalone.get('/api/me');
    expect(afterRes.status()).toBe(401);

    await standalone.dispose();
  });
});
