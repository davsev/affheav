const express  = require('express');
const router   = express.Router();
const { query }             = require('../db');
const { getProvider, listProviders, detectProvider } = require('../services/affiliates/registry');
const { getSourceById, getSourcesByUser, detectSourceByUrl, buildAffiliateLink } = require('../services/affiliateSourceService');
const { shortenUrl }        = require('../services/spooMe');
const workflow              = require('../services/workflow');
const manual                = require('../services/affiliates/manual');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Load a provider OR a custom affiliate source by id.
// Returns { provider, customSource } — exactly one will be non-null.
async function resolveProviderOrSource(id, userId) {
  if (UUID_RE.test(id)) {
    const source = await getSourceById(id, userId);
    return { provider: null, customSource: source };
  }
  return { provider: getProvider(id), customSource: null };
}

// GET /api/affiliates/providers — built-in providers + user's custom sources
router.get('/providers', async (req, res) => {
  try {
    const builtIn = listProviders();
    const custom  = await getSourcesByUser(req.user.id);
    res.json({
      success:   true,
      providers: builtIn,
      custom:    custom.map(s => ({ id: s.id, label: s.name, domain: s.domain })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/affiliates/detect — detect provider/source from URL
router.post('/detect', async (req, res) => {
  const { url } = req.body || {};
  try {
    // Check custom sources first
    const customSource = url ? await detectSourceByUrl(url, req.user.id) : null;
    if (customSource) {
      return res.json({ success: true, provider: { id: customSource.id, label: customSource.name }, isCustom: true });
    }
    // Fall back to built-in providers
    const p = detectProvider(url);
    res.json({ success: true, provider: { id: p.id, label: p.label }, isCustom: false });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/affiliates/:providerId/fetch-by-url
router.post('/:providerId/fetch-by-url', async (req, res) => {
  const { url, subjectId } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'url is required' });

  try {
    const { provider, customSource } = await resolveProviderOrSource(req.params.providerId, req.user.id);

    // Custom affiliate source — scrape with generic og: scraper, then apply link template
    if (customSource) {
      workflow.log(`[${customSource.name}] Fetching: ${url.slice(0, 80)}`);
      const result = await manual.fetchByUrl(url);
      if (result.not_found) return res.json({ success: false, error: 'Product not found (404)' });
      if (!result.data)     return res.json({ success: false, error: 'Could not fetch product data' });

      const affiliateUrl = buildAffiliateLink(url, customSource);
      workflow.log(`✓ [${customSource.name}] ${result.data.title?.slice(0, 60) || '(no title)'}`);
      return res.json({
        success:  true,
        data:     { ...result.data, affiliate_url: affiliateUrl },
        provider: customSource.id,
        isCustom: true,
        sourceName: customSource.name,
      });
    }

    // Built-in provider
    let options = {};
    if (subjectId) {
      const { rows } = await query(
        'SELECT aliexpress_tracking_id, amazon_tag FROM subjects WHERE id = $1 AND user_id = $2 LIMIT 1',
        [subjectId, req.user.id]
      );
      if (rows[0]) {
        if (rows[0].aliexpress_tracking_id) options.trackingId   = rows[0].aliexpress_tracking_id;
        if (rows[0].amazon_tag)             options.affiliateTag = rows[0].amazon_tag;
      }
    }

    workflow.log(`[${provider.label}] Fetching: ${url.slice(0, 80)}`);
    const result = await provider.fetchByUrl(url, options);

    if (result.not_found) return res.json({ success: false, error: 'Product not found (404)' });
    if (!result.data)     return res.json({ success: false, error: 'Could not fetch product data' });

    workflow.log(`✓ [${provider.label}] ${result.data.title?.slice(0, 60) || '(no title)'}`);
    res.json({ success: true, data: result.data, provider: provider.id, isCustom: false });
  } catch (err) {
    workflow.log(`✗ fetch-by-url (${req.params.providerId}): ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/affiliates/:providerId/add
router.post('/:providerId/add', async (req, res) => {
  const { url, affiliateUrl, title, image, salePrice, videoUrl, subject, whatsappGroupId } = req.body;
  const finalUrl = affiliateUrl || url;
  if (!finalUrl) return res.status(400).json({ success: false, error: 'url is required' });

  try {
    const { provider, customSource } = await resolveProviderOrSource(req.params.providerId, req.user.id);
    const sourceName     = customSource ? customSource.name : provider.label;
    const providerCol    = customSource ? 'custom' : provider.id;
    const sourceId       = customSource ? customSource.id  : null;
    const commissionRate = customSource ? null : provider.getDefaultCommission();

    let wa_group = '', join_link = '', resolvedGroupId = whatsappGroupId || null;
    if (whatsappGroupId) {
      const { rows: grp } = await query(
        'SELECT wa_group, join_link FROM whatsapp_groups WHERE id = $1 AND user_id = $2',
        [whatsappGroupId, req.user.id]
      );
      if (grp[0]) { wa_group = grp[0].wa_group; join_link = grp[0].join_link || ''; }
    }

    workflow.log(`[${sourceName}] Adding: "${(title || '').slice(0, 60)}"`);

    const { rows: maxRow } = await query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM products WHERE user_id = $1',
      [req.user.id]
    );

    const shortLink = await shortenUrl(finalUrl);

    await query(
      `INSERT INTO products
         (user_id, subject_id, long_url, short_link, image, text, title, join_link, wa_group,
          whatsapp_group_id, sort_order, sale_price, commission_rate, video_url, use_video,
          affiliate_provider, affiliate_source_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        req.user.id, subject || null, finalUrl, shortLink,
        image || '', title || '', title || '',
        join_link, wa_group, resolvedGroupId, maxRow[0].next_order,
        salePrice || null, commissionRate || null,
        videoUrl || null, !!videoUrl,
        providerCol, sourceId,
      ]
    );

    workflow.log(`✓ [${sourceName}] Product added`);
    res.json({ success: true });
  } catch (err) {
    workflow.log(`✗ add (${req.params.providerId}): ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/affiliates/aliexpress/search
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
