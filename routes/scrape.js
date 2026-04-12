const express = require('express');
const router = express.Router();
const { scrapeProduct, searchFishingProducts } = require('../scrapers/aliexpress');
const workflow = require('../services/workflow');
const { query } = require('../db');
const { shortenUrl } = require('../services/spooMe');

async function saveProductToDB(userId, { Link, image, Text, join_link, wa_group, subject }) {
  const shortLink = await shortenUrl(Link);
  const { rows: maxRow } = await query(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM products WHERE user_id = $1',
    [userId]
  );
  await query(
    `INSERT INTO products (user_id, subject_id, long_url, short_link, image, text, join_link, wa_group, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [userId, subject || null, Link, shortLink, image, Text, join_link, wa_group, maxRow[0].next_order]
  );
  return shortLink;
}

// POST /api/scrape/aliexpress
// Body: { url, join_link, wa_group, autoSend (bool) }
router.post('/aliexpress', async (req, res) => {
  const { url, join_link = '', wa_group = '', autoSend = false, subject = '' } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: 'url is required' });
  }

  try {
    workflow.log(`Scraping AliExpress product: ${url}`);
    const { text, image, affiliateLink } = await scrapeProduct(url);
    workflow.log(`Scraped: "${text}"`);

    const product = { Link: affiliateLink, image, Text: text, join_link, wa_group, subject };

    const shortLink = await saveProductToDB(req.user.id, product);
    workflow.log(`✓ Product saved to DB`);

    if (autoSend) {
      workflow.log(`Auto-sending product...`);
      const result = await workflow.run(
        { ...product, Link: shortLink },
        { userId: req.user.id, subject: subject || undefined }
      );
      return res.json({ success: true, product, sendResult: result });
    }

    res.json({ success: true, product });
  } catch (err) {
    workflow.log(`Scrape error: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/scrape/fishing-search
// Body: { limit, wa_group, join_link }
router.post('/fishing-search', async (req, res) => {
  const { limit = 10, wa_group = '', join_link = '', subject = '' } = req.body;

  workflow.log(`🔍 Starting fishing product search (limit: ${limit})...`);

  try {
    const products = await searchFishingProducts({ limit, wa_group, join_link, userId: req.user.id });

    workflow.log(`Found ${products.length} products — saving to DB...`);

    let saved = 0;
    let skipped = 0;
    for (const product of products) {
      try {
        await saveProductToDB(req.user.id, { ...product, subject });
        workflow.log(`✓ Added: ${product.Text?.slice(0, 60)}${product.affiliateGenerated ? ' (affiliate ✓)' : ' (no affiliate)'}`);
        saved++;
      } catch (err) {
        workflow.log(`✗ Failed to save product: ${err.message}`, 'error');
        skipped++;
      }
    }

    workflow.log(`✓ Fishing search complete — ${saved} saved, ${skipped} skipped`);
    res.json({ success: true, saved, skipped, products });

  } catch (err) {
    const isLoginError = err.message.startsWith('NOT_LOGGED_IN');
    workflow.log(`✗ Fishing search failed: ${err.message}`, 'error');
    res.status(isLoginError ? 401 : 500).json({
      success: false,
      error: err.message,
      needsLogin: isLoginError,
    });
  }
});

module.exports = router;
