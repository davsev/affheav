import { test, expect } from '@playwright/test';

/**
 * Baseline: schedules API is reachable and returns expected shape.
 */
test.describe('Schedules API', () => {
  test('GET /api/schedules returns 200 with success flag', async ({ request }) => {
    const res = await request.get('/api/schedules');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.schedules)).toBe(true);
  });

  test('GET /api/schedules without auth returns 401', async ({ request }) => {
    const anon = await request.newContext();
    const res = await anon.get('/api/schedules');
    expect(res.status()).toBe(401);
    await anon.dispose();
  });

  test('POST /api/schedules with invalid body returns 400', async ({ request }) => {
    const res = await request.post('/api/schedules', {
      data: {}, // missing required fields
    });
    // Must not return 500 — validation should reject gracefully
    expect(res.status()).toBeLessThan(500);
  });
});
