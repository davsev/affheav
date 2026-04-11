const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const googleSheets = require('../services/googleSheets');
const workflow = require('../services/workflow');
const { query } = require('../db');

const ALIEXPRESS_ENDPOINT = 'https://api-sg.aliexpress.com/sync';
const TRACKING_ID = 'TechSalebuy';

function buildSignedUrl(keywords, pageNo = 1) {
  const APP_KEY = process.env.ALIEXPRESS_APP_KEY;
  const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET;

  if (!APP_KEY || !APP_SECRET) {
    throw new Error('ALIEXPRESS_APP_KEY or ALIEXPRESS_APP_SECRET not configured');
  }

  const params = {
    app_key: APP_KEY,
    method: 'aliexpress.affiliate.product.query',
    timestamp: Date.now().toString(),
    format: 'json',
    v: '2.0',
    keywords,
    sign_method: 'md5',
    target_currency: 'ILS',
    target_language: 'HE',
    tracking_id: TRACKING_ID,
    sort: 'LAST_VOLUME_DESC',
    page_no: String(pageNo),
    page_size: '50',
    fields: 'product_id,product_title,product_main_image_url,promotion_link,app_sale_price,evaluate_rate,lastest_volume,available_stock',
  };

  const sortedKeys = Object.keys(params).sort();
  let signString = APP_SECRET;
  sortedKeys.forEach(key => { signString += key + params[key]; });
  signString += APP_SECRET;

  const sign = crypto.createHash('md5').update(signString).digest('hex').toUpperCase();
  params.sign = sign;

  const qs = Object.keys(params)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');

  return ALIEXPRESS_ENDPOINT + '?' + qs;
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
// Body: { keywords }
router.post('/search', async (req, res) => {
  const { keywords } = req.body;
  if (!keywords || !keywords.trim()) {
    return res.status(400).json({ success: false, error: 'keywords is required' });
  }

  try {
    workflow.log(`AliExpress API search: "${keywords}"`);
    const url = buildSignedUrl(keywords.trim());
    const response = await axios.get(url, { timeout: 15000 });

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
    await query(
      `INSERT INTO products
         (user_id, subject_id, long_url, short_link, image, text, join_link, wa_group, whatsapp_group_id, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [req.user.id, subject || null, product.promotion_link, shortLink,
       product.product_main_image_url || '', product.product_title,
       join_link, wa_group, resolvedGroupId, maxRow[0].next_order]
    );
    workflow.log(`✓ Product added to DB`);
    res.json({ success: true });
  } catch (err) {
    workflow.log(`✗ Failed to add product: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
