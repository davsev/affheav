const express = require('express');
const router = express.Router();
const { scrapeProduct } = require('../scrapers/aliexpress');
const googleSheets = require('../services/googleSheets');
const workflow = require('../services/workflow');

// POST /api/scrape/aliexpress
// Body: { url, join_link, wa_group, autoSend (bool) }
router.post('/aliexpress', async (req, res) => {
  const { url, join_link = '', wa_group = '', autoSend = false } = req.body;

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

module.exports = router;
