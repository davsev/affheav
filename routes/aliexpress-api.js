const express = require('express');
const router = express.Router();
const googleSheets = require('../services/googleSheets');
const workflow = require('../services/workflow');
const { query } = require('../db');
const { signAndCall } = require('../services/aliexpressApi');
const { passesFilters } = require('../services/aliexpressFilters');
const { syncProduct, syncProducts, resolveUrl, fetchProductDataByUrl } = require('../services/aliexpressSync');

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
    fields:          'product_id,product_title,product_main_image_url,product_video_url,promotion_link,app_sale_price,evaluate_rate,lastest_volume,available_stock',
  });
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
    const videoUrl       = product.product_video_url || null;

    const baseParams = [req.user.id, subject || null, product.promotion_link, shortLink,
      product.product_main_image_url || '', product.product_title,
      join_link, wa_group, resolvedGroupId, maxRow[0].next_order,
      salePrice, commissionRate];
    const aliexpressProductId = product.product_id ? String(product.product_id) : null;

    try {
      await query(
        `INSERT INTO products
           (user_id, subject_id, long_url, short_link, image, text, join_link, wa_group, whatsapp_group_id, sort_order, sale_price, commission_rate, video_url, use_video, aliexpress_product_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [...baseParams, videoUrl, !!videoUrl, aliexpressProductId]
      );
    } catch (insertErr) {
      // video_url/use_video/aliexpress_product_id columns may not exist yet if migration hasn't run — retry without them
      if (insertErr.message?.includes('video_url') || insertErr.message?.includes('use_video') || insertErr.message?.includes('aliexpress_product_id')) {
        await query(
          `INSERT INTO products
             (user_id, subject_id, long_url, short_link, image, text, join_link, wa_group, whatsapp_group_id, sort_order, sale_price, commission_rate)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          baseParams
        );
        workflow.log('⚠ video_url/use_video/aliexpress_product_id columns missing — restart server to run migration');
      } else {
        throw insertErr;
      }
    }
    workflow.log(`✓ Product added to DB${salePrice ? ` (price: $${salePrice})` : ''}${videoUrl ? ' · video ✓' : ''}`);
    res.json({ success: true });
  } catch (err) {
    workflow.log(`✗ Failed to add product: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/aliexpress/check-url/:id — lightweight 404 check (no scraping)
router.post('/check-url/:id', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, long_url, text FROM products WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Product not found' });
    const product = rows[0];
    if (!product.long_url) return res.json({ success: true, not_found: false, skipped: true });

    const { status } = await resolveUrl(product.long_url);
    res.json({ success: true, not_found: status === 404 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/aliexpress/sync/:id — sync one product's data from AliExpress
router.post('/sync/:id', async (req, res) => {
  try {
    const result = await syncProduct(req.params.id, req.user.id);
    if (result.not_found) {
      workflow.log(`⚠ Product ${req.params.id} returned 404 on AliExpress`);
      return res.json({ success: true, not_found: true });
    }
    if (result.no_data) {
      workflow.log(`⚠ Product ${req.params.id}: no data returned from AliExpress (page may be blocked)`);
      return res.json({ success: true, not_found: false, no_data: true, data: {} });
    }
    workflow.log(`✓ Synced product ${req.params.id}: ${result.data?.title?.slice(0, 60) || '(no title)'}`);
    res.json({ success: true, not_found: false, data: result.data });
  } catch (err) {
    workflow.log(`✗ Sync failed for ${req.params.id}: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/aliexpress/fetch-by-url — fetch product metadata by URL without saving
// Body: { url, subjectId? }
router.post('/fetch-by-url', async (req, res) => {
  const { url, subjectId } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'url is required' });

  try {
    let trackingId = DEFAULT_TRACKING_ID;
    if (subjectId) {
      const { rows } = await query(
        'SELECT aliexpress_tracking_id FROM subjects WHERE id = $1 AND user_id = $2 LIMIT 1',
        [subjectId, req.user.id]
      );
      if (rows[0]?.aliexpress_tracking_id) trackingId = rows[0].aliexpress_tracking_id;
    }

    workflow.log(`Fetching AliExpress product data for: ${url.slice(0, 80)}`);
    const result = await fetchProductDataByUrl(url, trackingId);

    if (result.not_found) return res.json({ success: false, error: 'Product not found (404)' });
    if (!result.data)     return res.json({ success: false, error: 'Could not fetch product data' });

    workflow.log(`✓ Fetched: ${result.data.title?.slice(0, 60) || '(no title)'}`);
    res.json({ success: true, data: result.data });
  } catch (err) {
    workflow.log(`✗ fetch-by-url error: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/aliexpress/sync-bulk — sync multiple products
// Body: { ids?: string[] }  — omit ids to sync all unsent products
router.post('/sync-bulk', async (req, res) => {
  try {
    let ids = req.body?.ids;

    if (!ids || !ids.length) {
      const { rows } = await query(
        `SELECT id FROM products WHERE user_id = $1 AND long_url IS NOT NULL AND long_url != ''
         ORDER BY sort_order ASC NULLS LAST, created_at ASC`,
        [req.user.id]
      );
      ids = rows.map(r => r.id);
    }

    if (!ids.length) return res.json({ success: true, succeeded: 0, failed: 0, errors: [] });

    workflow.log(`Starting bulk AliExpress sync for ${ids.length} products`);
    const result = await syncProducts(ids, req.user.id);
    workflow.log(`Bulk sync done: ${result.succeeded} succeeded, ${result.failed} failed`);
    res.json({ success: true, ...result });
  } catch (err) {
    workflow.log(`✗ Bulk sync error: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
