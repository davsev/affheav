const express = require('express');
const router = express.Router();
const { scrapeProduct, searchFishingProducts } = require('../scrapers/aliexpress');
const googleSheets = require('../services/googleSheets');
const workflow = require('../services/workflow');

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

    const product = {
      Link: affiliateLink,
      image,
      Text: text,
      join_link,
      wa_group,
      subject,
    };

    // Save to Google Sheet
    await googleSheets.addProduct(product);
    workflow.log(`✓ Product added to Google Sheet`);

    // Optionally send immediately
    if (autoSend) {
      workflow.log(`Auto-sending product...`);
      const result = await workflow.run({ ...product, row_number: null });
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
    const products = await searchFishingProducts({ limit, wa_group, join_link });

    workflow.log(`Found ${products.length} products — saving to Google Sheet...`);

    let saved = 0;
    let skipped = 0;
    for (const product of products) {
      try {
        await googleSheets.addProduct({ ...product, subject });
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
