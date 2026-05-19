import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

/**
 * Baseline: products API is reachable and returns expected shape.
 * Does not assert specific product data — only that the endpoint
 * responds correctly so regressions in routing/auth are caught.
 */
test.describe('Products API', () => {
  test('GET /api/products returns 200 with success flag', async ({ page }) => {
    await page.request.post('/auth/test-login', { data: { role: 'admin' } });
    const res = await page.request.get('/api/products');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.products)).toBe(true);
  });

  test('GET /api/products without auth returns 401', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: BASE_URL });
    const res = await anon.get('/api/products');
    expect(res.status()).toBe(401);
    await anon.dispose();
  });

  test('GET /api/subjects returns 200 with success flag', async ({ page }) => {
    await page.request.post('/auth/test-login', { data: { role: 'admin' } });
    const res = await page.request.get('/api/subjects');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.subjects)).toBe(true);
  });
});
