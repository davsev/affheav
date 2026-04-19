const express = require('express');
const router = express.Router();
const googleSheets = require('../services/googleSheets');
const workflow = require('../services/workflow');
const { query } = require('../db');
const { signAndCall } = require('../services/aliexpressApi');

const DEFAULT_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || 'TechSalebuy';

async function searchProducts(keywords, pageNo = 1, trackingId = DEFAULT_TRACKING_ID) {
  return signAndCall({
    method:          'aliexpress.affiliate.product.query',
    keywords,
    target_currency: 'ILS',
    target_language: 'HE',
    tracking_id:     trackingId,
    sort:            'LAST_VOLUME_DESC',
    page_no:         String(pageNo),
    page_size:       '50',
    fields:          'product_id,product_title,product_main_image_url,promotion_link,app_sale_price,evaluate_rate,lastest_volume,available_stock',
  });
}

function passesFilters(product) {
  const rateStr = product.evaluate_rate || '0';
  const rate = parseFloat(rateStr.replace('%', '')) || 0;
  const volume = Number(product.lastest_volume || 0);
  // available_stock may be absent — only filter if present
  const stockRaw = product.available_stock;
  const stockOk = stockRaw === undefined || stockRaw === null || stockRaw === '' || Number(stockRaw) > 100;
  return rate > 80 && volume > 50 && stockOk;
}

// POST /api/aliexpress/search
// Body: { keywords, subjectId? }
router.post('/search', async (req, res) => {
  const { keywords, subjectId, page_no } = req.body;
  if (!keywords || !keywords.trim()) {
    return res.status(400).json({ success: false, error: 'keywords is required' });
  }

  try {
    // Resolve per-subject tracking ID if a subject is selected
    let trackingId = DEFAULT_TRACKING_ID;
    if (subjectId) {
      const { rows } = await query(
        'SELECT aliexpress_tracking_id FROM subjects WHERE id = $1 AND user_id = $2 LIMIT 1',
        [subjectId, req.user.id]
      );
      if (rows[0]?.aliexpress_tracking_id) trackingId = rows[0].aliexpress_tracking_id;
    }

    workflow.log(`AliExpress API search: "${keywords}" (tracking: ${trackingId})`);
    const response = await searchProducts(keywords.trim(), page_no || 1, trackingId);

    const products =
      response.data?.aliexpress_affiliate_product_query_response
        ?.resp_result?.result?.products?.product || [];

    const filtered = products.filter(passesFilters);
    workflow.log(`AliExpress: ${products.length} results, ${filtered.length} passed filters`);

    res.json({ success: true, total: products.length, filtered: filtered.length, products: filtered });
  } catch (err) {
    workflow.log(`AliExpress API error: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/aliexpress/existing — returns Set of long_urls already in the sheet
router.get('/existing', async (req, res) => {
  try {
    const products = await googleSheets.getAllProducts({ includeAll: true });
    const urls = products
      .map(p => p.long_url)
      .filter(Boolean);
    res.json({ success: true, urls });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, urls: [] });
  }
});

// POST /api/aliexpress/add
// Body: { product: { promotion_link, product_main_image_url, product_title }, subject, whatsappGroupId }
router.post('/add', async (req, res) => {
  const { product, subject = '', whatsappGroupId } = req.body;
  if (!product || !product.promotion_link || !product.product_title) {
    return res.status(400).json({ success: false, error: 'product with promotion_link and product_title required' });
  }

  try {
    // Resolve wa_group and join_link from whatsapp_group FK if provided
    let wa_group = '', join_link = '', resolvedGroupId = whatsappGroupId || null;
    if (whatsappGroupId) {
      const { rows: grp } = await query(
        'SELECT wa_group, join_link FROM whatsapp_groups WHERE id = $1 AND user_id = $2',
        [whatsappGroupId, req.user.id]
      );
      if (grp[0]) { wa_group = grp[0].wa_group; join_link = grp[0].join_link || ''; }
    }

    workflow.log(`Adding AliExpress product: "${product.product_title.slice(0, 60)}"`);
    const { shortenUrl } = require('../services/spooMe');
    const { rows: maxRow } = await query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM products WHERE user_id = $1',
      [req.user.id]
    );
    const shortLink = await shortenUrl(product.promotion_link);
    const salePrice      = parseFloat(product.app_sale_price) || null;
    const commissionRate = salePrice ? 0.08 : null; // AliExpress standard 8%
    await query(
      `INSERT INTO products
         (user_id, subject_id, long_url, short_link, image, text, join_link, wa_group, whatsapp_group_id, sort_order, sale_price, commission_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [req.user.id, subject || null, product.promotion_link, shortLink,
       product.product_main_image_url || '', product.product_title,
       join_link, wa_group, resolvedGroupId, maxRow[0].next_order,
       salePrice, commissionRate]
    );
    workflow.log(`✓ Product added to DB${salePrice ? ` (price: $${salePrice})` : ''}`);
    res.json({ success: true });
  } catch (err) {
    workflow.log(`✗ Failed to add product: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
