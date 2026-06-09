const express  = require('express');
const router   = express.Router();
const { query }             = require('../db');
const { getProvider, listProviders, detectProvider } = require('../services/affiliates/registry');
const { shortenUrl }        = require('../services/spooMe');
const workflow              = require('../services/workflow');

// GET /api/affiliates/providers
router.get('/providers', (_req, res) => {
  res.json({ success: true, providers: listProviders() });
});

// POST /api/affiliates/detect — returns provider id for a given URL
router.post('/detect', (req, res) => {
  const p = detectProvider(req.body?.url);
  res.json({ success: true, provider: { id: p.id, label: p.label } });
});

// POST /api/affiliates/:providerId/fetch-by-url
router.post('/:providerId/fetch-by-url', async (req, res) => {
  const { url, subjectId } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'url is required' });

  const provider = getProvider(req.params.providerId);

  try {
    let options = {};
    if (subjectId) {
      const { rows } = await query(
        'SELECT aliexpress_tracking_id, amazon_tag FROM subjects WHERE id = $1 AND user_id = $2 LIMIT 1',
        [subjectId, req.user.id]
      );
      if (rows[0]) {
        if (rows[0].aliexpress_tracking_id) options.trackingId    = rows[0].aliexpress_tracking_id;
        if (rows[0].amazon_tag)             options.affiliateTag  = rows[0].amazon_tag;
      }
    }

    workflow.log(`[${provider.label}] Fetching: ${url.slice(0, 80)}`);
    const result = await provider.fetchByUrl(url, options);

    if (result.not_found) return res.json({ success: false, error: 'Product not found (404)' });
    if (!result.data)     return res.json({ success: false, error: 'Could not fetch product data' });

    workflow.log(`✓ [${provider.label}] ${result.data.title?.slice(0, 60) || '(no title)'}`);
    res.json({ success: true, data: result.data, provider: provider.id });
  } catch (err) {
    workflow.log(`✗ [${provider.label}] fetch-by-url: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/affiliates/:providerId/add
router.post('/:providerId/add', async (req, res) => {
  const { url, affiliateUrl, title, image, salePrice, videoUrl, subject, whatsappGroupId } = req.body;
  const finalUrl = affiliateUrl || url;
  if (!finalUrl) return res.status(400).json({ success: false, error: 'url is required' });

  const provider = getProvider(req.params.providerId);

  try {
    let wa_group = '', join_link = '', resolvedGroupId = whatsappGroupId || null;
    if (whatsappGroupId) {
      const { rows: grp } = await query(
        'SELECT wa_group, join_link FROM whatsapp_groups WHERE id = $1 AND user_id = $2',
        [whatsappGroupId, req.user.id]
      );
      if (grp[0]) { wa_group = grp[0].wa_group; join_link = grp[0].join_link || ''; }
    }

    workflow.log(`[${provider.label}] Adding: "${(title || '').slice(0, 60)}"`);

    const { rows: maxRow } = await query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM products WHERE user_id = $1',
      [req.user.id]
    );

    const shortLink      = await shortenUrl(finalUrl);
    const commissionRate = provider.getDefaultCommission();

    await query(
      `INSERT INTO products
         (user_id, subject_id, long_url, short_link, image, text, title, join_link, wa_group,
          whatsapp_group_id, sort_order, sale_price, commission_rate, video_url, use_video, affiliate_provider)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        req.user.id, subject || null, finalUrl, shortLink,
        image || '', title || '', title || '',
        join_link, wa_group, resolvedGroupId, maxRow[0].next_order,
        salePrice || null, commissionRate || null,
        videoUrl || null, !!videoUrl, provider.id,
      ]
    );

    workflow.log(`✓ [${provider.label}] Product added`);
    res.json({ success: true });
  } catch (err) {
    workflow.log(`✗ [${provider.label}] Add failed: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/affiliates/aliexpress/search (convenience — delegates to provider)
router.post('/aliexpress/search', async (req, res) => {
  const { keywords, subjectId, page_no } = req.body;
  if (!keywords?.trim()) return res.status(400).json({ success: false, error: 'keywords is required' });

  const provider            = getProvider('aliexpress');
  const DEFAULT_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || 'TechSalebuy';

  try {
    let trackingId = DEFAULT_TRACKING_ID;
    if (subjectId) {
      const { rows } = await query(
        'SELECT aliexpress_tracking_id FROM subjects WHERE id = $1 AND user_id = $2 LIMIT 1',
        [subjectId, req.user.id]
      );
      if (rows[0]?.aliexpress_tracking_id) trackingId = rows[0].aliexpress_tracking_id;
    }

    workflow.log(`[AliExpress] search: "${keywords.trim()}" (tracking: ${trackingId})`);
    const products = await provider.search({ keywords: keywords.trim(), trackingId, page: page_no || 1 });
    workflow.log(`[AliExpress] ${products.length} results passed filters`);
    res.json({ success: true, total: products.length, filtered: products.length, products });
  } catch (err) {
    workflow.log(`[AliExpress] search error: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
