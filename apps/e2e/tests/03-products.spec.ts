import { test, expect } from '@playwright/test';

/**
 * Baseline: products API is reachable and returns expected shape.
 * Does not assert specific product data — only that the endpoint
 * responds correctly so regressions in routing/auth are caught.
 */
test.describe('Products API', () => {
  test('GET /api/products returns 200 with success flag', async ({ request }) => {
    const res = await request.get('/api/products');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.products)).toBe(true);
  });

  test('GET /api/products without auth returns 401', async ({ request }) => {
    const anon = await request.newContext();
    const res = await anon.get('/api/products');
    expect(res.status()).toBe(401);
    await anon.dispose();
  });

  test('GET /api/subjects returns 200 with success flag', async ({ request }) => {
    const res = await request.get('/api/subjects');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.subjects)).toBe(true);
  });
});
