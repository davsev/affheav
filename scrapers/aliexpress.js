/**
 * AliExpress scraper using Playwright.
 *
 * Two modes:
 *  1. scrapeProduct(url)           — scrape a single product page
 *  2. searchFishingProducts(opts)  — search AliExpress, generate affiliate links via portal
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { getSetting, setSetting } = require('../services/googleSheets');

const COOKIES_FILE = path.join(__dirname, '../config/portal-cookies.json');
const TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || 'TechSalebuy';
const PORTAL_URL = 'https://portals.aliexpress.com/affiportals/web/link_generator.htm';
const SEARCH_URL = 'https://www.aliexpress.com/w/wholesale-fishing.html?sortType=total_tranpro_desc&SearchText=fishing';

// ── Cookie helpers ─────────────────────────────────────────────────────────────

async function loadCookies() {
  // Try local file first
  if (fs.existsSync(COOKIES_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
    } catch { /* fall through */ }
  }
  // Fall back to Google Sheets
  try {
    const saved = await getSetting('portal_cookies');
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return null;
}

async function saveCookies(cookies) {
  // Save locally
  try {
    fs.mkdirSync(path.dirname(COOKIES_FILE), { recursive: true });
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  } catch { /* ignore */ }
  // Save to Google Sheets for Railway
  try {
    await setSetting('portal_cookies', JSON.stringify(cookies));
  } catch { /* ignore */ }
}

// ── Single product scraper ─────────────────────────────────────────────────────

async function scrapeProduct(url) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    let text = '';
    const titleSelectors = ['h1[class*="title"]', '.product-title', 'h1', '[data-pl="product-title"]'];
    for (const sel of titleSelectors) {
      try {
        text = await page.textContent(sel, { timeout: 3000 });
        if (text?.trim()) { text = text.trim(); break; }
      } catch { /* try next */ }
    }

    let image = '';
    const imgSelectors = ['.slider-image img', '.images-gallery img', '.product-img img', 'img[class*="product"]'];
    for (const sel of imgSelectors) {
      try {
        image = await page.getAttribute(sel, 'src', { timeout: 3000 });
        if (image?.startsWith('http') || image?.startsWith('//')) break;
      } catch { /* try next */ }
    }
    if (image && image.startsWith('//')) image = 'https:' + image;

    await browser.close();
    return { text: text || 'Unknown Product', image: image || '', affiliateLink: url };
  } catch (err) {
    await browser.close();
    throw new Error(`Scrape failed for ${url}: ${err.message}`);
  }
}

// ── Fishing product search + affiliate link generation ─────────────────────────

async function searchFishingProducts({ limit = 10, wa_group = '', join_link = '' } = {}) {
  const cookies = await loadCookies();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  if (cookies) {
    await context.addCookies(cookies);
  }

  const results = [];

  try {
    // ── Step 1: Search AliExpress ────────────────────────────────────────────
    const searchPage = await context.newPage();
    await searchPage.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await searchPage.waitForTimeout(3000);

    // Extract product cards
    const products = await searchPage.evaluate((maxItems) => {
      const cards = document.querySelectorAll(
        'a[href*="/item/"], .search-item-card-wrapper-gallery a, [class*="product-snippet"] a'
      );
      const seen = new Set();
      const items = [];

      for (const card of cards) {
        if (items.length >= maxItems) break;
        const href = card.href || '';
        if (!href.includes('/item/')) continue;

        // Normalise to bare item URL
        let url = href.split('?')[0];
        if (!url.startsWith('http')) url = 'https://www.aliexpress.com' + url;
        if (seen.has(url)) continue;
        seen.add(url);

        // Try to get title and image from card
        const titleEl = card.querySelector('[class*="title"], h3, h2');
        const imgEl   = card.querySelector('img');
        items.push({
          url,
          title: titleEl?.textContent?.trim() || '',
          image: imgEl?.src || imgEl?.getAttribute('data-src') || '',
        });
      }
      return items;
    }, limit);

    await searchPage.close();

    if (products.length === 0) {
      await browser.close();
      throw new Error('No products found on AliExpress search page. The layout may have changed.');
    }

    // ── Step 2: Generate affiliate link for each product via portal ──────────
    const portalPage = await context.newPage();

    // Check if we're logged in to the portal
    await portalPage.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await portalPage.waitForTimeout(2000);

    const isLoggedIn = await portalPage.evaluate(() => {
      return !document.title.toLowerCase().includes('login') &&
             !document.querySelector('.login-form, #login-form, input[name="loginId"]');
    });

    if (!isLoggedIn) {
      await browser.close();
      throw new Error('NOT_LOGGED_IN: Please log in to the AliExpress portal first. Use the "Login to Portal" button in the dashboard.');
    }

    // Save cookies now that we know we're logged in
    const updatedCookies = await context.cookies();
    await saveCookies(updatedCookies);

    for (const product of products) {
      try {
        // Clear input and paste product URL
        const inputSel = 'input[placeholder*="url"], input[placeholder*="URL"], input[placeholder*="link"], input[type="text"]';
        await portalPage.waitForSelector(inputSel, { timeout: 10000 });
        await portalPage.fill(inputSel, product.url);

        // Click generate button
        const btnSel = 'button[class*="generate"], button[class*="Generate"], button:has-text("Generate"), button:has-text("生成")';
        await portalPage.click(btnSel, { timeout: 5000 });
        await portalPage.waitForTimeout(2000);

        // Extract the generated affiliate link
        const affiliateLink = await portalPage.evaluate(() => {
          // Look for the output in various possible containers
          const selectors = [
            'input[readonly]',
            '[class*="result"] input',
            '[class*="link-output"] input',
            '[class*="generated"] input',
            'textarea[readonly]',
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el?.value?.includes('s.click.aliexpress.com') || el?.value?.includes('aff_')) {
              return el.value;
            }
          }
          // Fallback: look in text content
          const links = [...document.querySelectorAll('a, [class*="result"]')];
          for (const el of links) {
            const href = el.href || el.textContent;
            if (href?.includes('s.click.aliexpress.com')) return href;
          }
          return null;
        });

        results.push({
          Link: affiliateLink || product.url,
          image: product.image.startsWith('//') ? 'https:' + product.image : product.image,
          Text: product.title,
          join_link,
          wa_group,
          affiliateGenerated: !!affiliateLink,
        });

        // Small delay between requests
        await portalPage.waitForTimeout(1000);
      } catch (err) {
        // Don't fail the whole batch — skip this product
        results.push({
          Link: product.url,
          image: product.image.startsWith('//') ? 'https:' + product.image : product.image,
          Text: product.title,
          join_link,
          wa_group,
          affiliateGenerated: false,
          error: err.message,
        });
      }
    }

    await browser.close();
    return results;

  } catch (err) {
    await browser.close();
    throw err;
  }
}

// ── Save portal cookies (called after manual login flow) ───────────────────────

async function savePortalCookiesFromContext(cookies) {
  await saveCookies(cookies);
}

module.exports = { scrapeProduct, searchFishingProducts, savePortalCookiesFromContext };
