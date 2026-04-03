const express = require('express');
const router = express.Router();
const googleSheets = require('../services/googleSheets');
const { shortenUrl, getAllClickStats } = require('../services/spooMe');
const log = (...a) => console.log('[products]', ...a);

// GET /api/products — list all
router.get('/', async (req, res) => {
  try {
    const products = await googleSheets.getAllProducts();
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products — add new product manually
router.post('/', async (req, res) => {
  const { Link, image, Text, join_link, wa_group } = req.body;
  if (!Link || !Text) {
    return res.status(400).json({ success: false, error: 'Link and Text are required' });
  }
  try {
    await googleSheets.addProduct({ Link, image, Text, join_link, wa_group });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products/sync-clicks — fetch click counts from spoo.me and save to sheet Column J
router.post('/sync-clicks', async (req, res) => {
  try {
    log('Fetching click stats from spoo.me...');
    const clicks = await getAllClickStats();
    log(`Got ${Object.keys(clicks).length} links from spoo.me`);
    const synced = await googleSheets.syncClicks(clicks);
    log(`Synced ${synced} rows to sheet`);
    const products = await googleSheets.getAllProducts();
    res.json({ success: true, synced, products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products/shorten-all — convert all product links to account-linked spoo.me short links
router.post('/shorten-all', async (req, res) => {
  try {
    const [products, accountClicks] = await Promise.all([
      googleSheets.getAllProducts(),
      getAllClickStats(),
    ]);

    let converted = 0;
    let skipped = 0;

    for (const product of products) {
      // Skip if Link column already has a tracked spoo.me link
      if (product.Link && accountClicks[product.Link] !== undefined) { skipped++; continue; }

      // Use long_url as source; fall back to Link if long_url is missing
      const source = product.long_url || product.Link;
      if (!source) { skipped++; continue; }

      const shortLink = await shortenUrl(source);
      if (shortLink !== source) {
        await googleSheets.updateProductLink(product.row_number, shortLink);
        converted++;
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    res.json({ success: true, converted, skipped });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products/reorder — move a row to a new position
// Body: { fromRow, toRow }  (1-based row numbers including header row)
router.post('/reorder', async (req, res) => {
  const { fromRow, toRow } = req.body;
  if (!fromRow || !toRow || fromRow === toRow) {
    return res.status(400).json({ success: false, error: 'fromRow and toRow required and must differ' });
  }
  try {
    await googleSheets.moveRow(fromRow, toRow);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
