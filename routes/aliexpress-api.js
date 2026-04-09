const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const googleSheets = require('../services/googleSheets');
const workflow = require('../services/workflow');

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

// POST /api/aliexpress/add
// Body: { product: { promotion_link, product_main_image_url, product_title }, subject }
router.post('/add', async (req, res) => {
  const { product, subject = '' } = req.body;
  if (!product || !product.promotion_link || !product.product_title) {
    return res.status(400).json({ success: false, error: 'product with promotion_link and product_title required' });
  }

  try {
    workflow.log(`Adding AliExpress product: "${product.product_title.slice(0, 60)}"`);
    await googleSheets.addProduct({
      Link: product.promotion_link,
      image: product.product_main_image_url || '',
      Text: product.product_title,
      join_link: '',
      wa_group: '',
      subject,
    });
    workflow.log(`✓ Product added to Google Sheet`);
    res.json({ success: true });
  } catch (err) {
    workflow.log(`✗ Failed to add product: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
