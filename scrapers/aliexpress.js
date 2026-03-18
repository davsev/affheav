/**
 * AliExpress product scraper using Playwright.
 *
 * Replace the body of `scrapeProduct` with your existing Playwright automation.
 * The function should return: { text, image, affiliateLink }
 *
 * Currently includes a working basic scraper that extracts:
 * - Product title
 * - Main product image
 * - The affiliate/tracking link (pass-through of the input URL until you have a real affiliate tool)
 */

const { chromium } = require('playwright');

async function scrapeProduct(url) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000); // let JS render

    // --- Product title ---
    let text = '';
    const titleSelectors = [
      'h1[class*="title"]',
      '.product-title',
      'h1',
      '[data-pl="product-title"]',
    ];
    for (const sel of titleSelectors) {
      try {
        text = await page.textContent(sel, { timeout: 3000 });
        if (text?.trim()) { text = text.trim(); break; }
      } catch { /* try next */ }
    }

    // --- Main image ---
    let image = '';
    const imgSelectors = [
      '.slider-image img',
      '.images-gallery img',
      '.product-img img',
      'img[class*="product"]',
    ];
    for (const sel of imgSelectors) {
      try {
        image = await page.getAttribute(sel, 'src', { timeout: 3000 });
        if (image?.startsWith('http')) break;
      } catch { /* try next */ }
    }

    // Ensure HTTPS
    if (image && image.startsWith('//')) image = 'https:' + image;

    // --- Affiliate link ---
    // TODO: Replace with your affiliate link generation logic.
    // For now, the input URL is returned as-is.
    const affiliateLink = url;

    await browser.close();
    return { text: text || 'Unknown Product', image: image || '', affiliateLink };

  } catch (err) {
    await browser.close();
    throw new Error(`Scrape failed for ${url}: ${err.message}`);
  }
}

module.exports = { scrapeProduct };
