import { test, expect } from '@playwright/test';

/**
 * Visual regression: screenshots of every page/tab.
 *
 * Baselines live in tests/06-screenshots.spec.ts-snapshots/.
 * To regenerate: pnpm e2e --update-snapshots
 *
 * Dynamic content (charts, timestamps, spinners) is masked so diffs
 * only catch structural / layout regressions.
 */

const TABS = [
  'dashboard',
  'products',
  'schedules',
  'scraper',
  'add-product',
  'aliexpress-search',
  'discover',
  'analytics',
  'logs',
  'settings',
  'users',
] as const;

// Areas that change on every run (charts, clocks, live data).
// Playwright replaces these rectangles with a solid colour in the diff.
const DYNAMIC_MASKS = [
  // Topbar clock / live badge if any
  { selector: '#topbar-section' },
  // Analytics charts canvas
  { selector: 'canvas' },
  // Log panel (live streaming)
  { selector: '#log-panel' },
];

async function maskDynamic(page: import('@playwright/test').Page) {
  const masks: import('@playwright/test').Locator[] = [];
  for (const { selector } of DYNAMIC_MASKS) {
    const loc = page.locator(selector);
    if (await loc.count() > 0) masks.push(loc);
  }
  return masks;
}

test.describe('Visual regression — login page', () => {
  test('login page (unauthenticated)', async ({ page }) => {
    // Use a fresh context with no session so the login page is shown.
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Ensure login page is visible, not the app shell
    await expect(page.locator('#login-page')).toBeVisible();

    await expect(page).toHaveScreenshot('login-page.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });
});

test.describe('Visual regression — authenticated tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.post('/auth/test-login', { data: { role: 'admin' } });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // Wait for the app shell to appear (login page hidden)
    await expect(page.locator('#login-page')).toBeHidden();
  });

  for (const tab of TABS) {
    test(`tab: ${tab}`, async ({ page }) => {
      // Click the tab button (users tab may be hidden for non-admin, but we
      // logged in as admin so it should be visible)
      const tabBtn = page.locator(`[data-tab="${tab}"]`);

      // Skip if tab button doesn't exist / is hidden (e.g. users on non-admin)
      if (await tabBtn.count() === 0) return;

      await tabBtn.click();

      // Wait for the tab panel to become active
      const panel = page.locator(`#tab-${tab}`);
      await expect(panel).toHaveClass(/active/, { timeout: 5000 });

      // Brief pause for any CSS transitions / initial API calls to settle
      await page.waitForTimeout(400);

      await expect(page).toHaveScreenshot(`tab-${tab}.png`, {
        fullPage: true,
        animations: 'disabled',
        mask: await maskDynamic(page),
      });
    });
  }
});
