import { test, expect } from '@playwright/test';

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
  test('POST /api/send without auth returns 401', async ({ request }) => {
    const anon = await request.newContext();
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

    // Any structured response is acceptable; a crash (500) is not
    expect(res.status()).not.toBe(500);

    const body = await res.json();
    // Must always return { success: boolean }
    expect(typeof body.success).toBe('boolean');
  });
});
