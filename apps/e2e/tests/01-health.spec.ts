import { test, expect } from '@playwright/test';

/**
 * Baseline: server is up and serves the SPA.
 * No auth required — this is a pure liveness check.
 */
test.describe('Health', () => {
  test('homepage returns 200 and loads the SPA shell', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);

    // The SPA index.html must have a root element
    await expect(page.locator('body')).toBeVisible();
  });

  test('/api/me returns 401 when unauthenticated', async ({ request }) => {
    // Use a fresh context with no session
    const res = await request.get('/api/me', {
      headers: { Cookie: '' },
    });
    expect(res.status()).toBe(401);
  });
});
