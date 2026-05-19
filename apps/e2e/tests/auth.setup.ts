import { test as setup, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const AUTH_FILE = path.join(__dirname, '../playwright/.auth/admin.json');
fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

/**
 * Runs once before all baseline tests.
 * Calls the test-only /auth/test-login endpoint to get a real session cookie,
 * then saves the browser storage state so all subsequent tests skip login.
 *
 * Requires NODE_ENV=test on the server.
 */
setup('authenticate as admin', async ({ request, page }) => {
  // Hit the test login endpoint — creates a DB user + session
  const res = await request.post('/auth/test-login', {
    data: { role: 'admin' },
  });

  expect(res.status(), 'test-login endpoint must return 200 (is NODE_ENV=test set on the server?)')
    .toBe(200);

  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.user.role).toBe('admin');

  // Load the app page so the browser picks up the session cookie
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Verify /api/me returns our test admin
  const me = await page.evaluate(async () => {
    const r = await fetch('/api/me');
    return r.json();
  });
  expect(me.success).toBe(true);
  expect(me.user.role).toBe('admin');

  // Persist cookies + localStorage to disk for reuse
  await page.context().storageState({ path: AUTH_FILE });
});
