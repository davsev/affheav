import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

/**
 * Baseline: /api/send pipeline entry point is reachable and auth-gated.
 *
 * We do NOT trigger a real broadcast here — that would hit WhatsApp/Facebook.
 * Instead we verify:
 *   1. The endpoint is auth-protected (401 without session)
 *   2. The endpoint rejects malformed requests gracefully (no 500)
 *   3. A dry-run request (no unsent products) returns a known shape
 *
 * This protects against routing regressions without causing side-effects.
 */
test.describe('Send API', () => {
  test('POST /api/send without auth returns 401', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: BASE_URL });
    const res = await anon.post('/api/send', { data: {} });
    expect(res.status()).toBe(401);
    await anon.dispose();
  });

  test('POST /api/send with auth returns JSON (not a 500)', async ({ request }) => {
    const res = await request.post('/api/send', {
      data: {
        // No subjectId — may result in "no unsent products" but must not 500
      },
    });

    // Must be authenticated (not redirected to login page) and must not crash
    expect(res.status()).not.toBe(500);
    expect(res.status()).not.toBe(401);

    const body = await res.json();
    // Must always return { success: boolean }
    expect(typeof body.success).toBe('boolean');
  });
});
