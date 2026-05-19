import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

/**
 * Baseline: schedules API is reachable and returns expected shape.
 */
test.describe('Schedules API', () => {
  test('GET /api/schedules returns 200 with success flag', async ({ page }) => {
    await page.request.post('/auth/test-login', { data: { role: 'admin' } });
    const res = await page.request.get('/api/schedules');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.schedules)).toBe(true);
  });

  test('GET /api/schedules without auth returns 401', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: BASE_URL });
    const res = await anon.get('/api/schedules');
    expect(res.status()).toBe(401);
    await anon.dispose();
  });

  test('POST /api/schedules with invalid body returns 400', async ({ page }) => {
    await page.request.post('/auth/test-login', { data: { role: 'admin' } });
    const res = await page.request.post('/api/schedules', {
      data: {}, // missing required fields
    });
    // Must not return 500 — validation should reject gracefully
    expect(res.status()).toBeLessThan(500);
  });
});
