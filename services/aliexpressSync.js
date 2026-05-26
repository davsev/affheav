const axios   = require('axios');
const cheerio = require('cheerio');
const { signAndCall } = require('./aliexpressApi');
const { query }       = require('../db');

const DEFAULT_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || 'TechSalebuy';

const SCRAPE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

function notFound() {
  const e = new Error('Product not found (404)');
  e.code  = 'NOT_FOUND';
  return e;
}

function extractProductId(url) {
  const m = url.match(/\/item\/(\d+)\.html/);
  return m ? m[1] : null;
}

// Returns { finalUrl, status } — status is the HTTP status of the final response.
async function resolveUrl(url) {
  try {
    const res = await axios.get(url, {
      maxRedirects:   10,
      timeout:        15000,
      headers:        SCRAPE_HEADERS,
      validateStatus: () => true,
    });
    const finalUrl = res.request.res?.responseUrl || res.config?.url || url;
    return { finalUrl, status: res.status };
  } catch {
    return { finalUrl: url, status: 0 };
  }
}

async function fetchViaApi(productId, trackingId) {
  const res = await signAndCall({
    method:          'aliexpress.affiliate.productdetail.get',
    product_ids:     productId,
    target_currency: 'ILS',
    target_language: 'HE',
    tracking_id:     trackingId,
    fields:          'product_id,product_title,product_main_image_url,app_sale_price,original_price,product_video_url',
  });

  const products =
    res.data?.aliexpress_affiliate_productdetail_get_response
      ?.resp_result?.result?.products?.product || [];
  if (!products.length) return null;

  const p = products[0];
  return {
    title:      p.product_title              || null,
    image:      p.product_main_image_url     || null,
    sale_price: parseFloat(p.app_sale_price) || null,
    video_url:  p.product_video_url          || null,
  };
}

async function fetchViaScraper(url) {
  let res;
  try {
    res = await axios.get(url, {
      timeout:        15000,
      headers:        SCRAPE_HEADERS,
      validateStatus: () => true,
    });
  } catch (err) {
    if (err.response?.status === 404) throw notFound();
    throw err;
  }

  if (res.status === 404) throw notFound();

  const $ = cheerio.load(res.data);

  const html = res.data;

  // Also check for videoUrl in any embedded JSON blob (applies to all tiers)
  function extractVideoUrl(rawHtml) {
    const m = rawHtml.match(/"videoUrl"\s*:\s*"([^"]+)"/);
    return m ? m[1] : null;
  }

  // Tier 1: JSON-LD structured data
  const scripts = $('script[type="application/ld+json"]').toArray();
  for (const el of scripts) {
    try {
      const data    = JSON.parse($(el).html());
      const entries = Array.isArray(data) ? data : [data];
      for (const entry of entries) {
        if (entry['@type'] === 'Product' && entry.name) {
          return {
            title:      entry.name || null,
            image:      (Array.isArray(entry.image) ? entry.image[0] : entry.image) || null,
            sale_price: entry.offers?.price ? parseFloat(entry.offers.price) : null,
            video_url:  extractVideoUrl(html),
          };
        }
      }
    } catch { /* try next */ }
  }

  // Tier 2: window.runParams embedded state
  const match = html.match(/window\.runParams\s*=\s*(\{[\s\S]+?\});\s*(?:window|var|let|const)/);
  if (match) {
    try {
      const state    = JSON.parse(match[1]);
      const title    = state?.data?.titleModule?.subject || state?.titleModule?.subject;
      const image    = state?.data?.imageModule?.imagePathList?.[0] || state?.imageModule?.imagePathList?.[0];
      const videoUrl = state?.data?.videoModule?.videoUrl || state?.videoModule?.videoUrl || extractVideoUrl(html) || null;
      if (title || image) return { title: title || null, image: image || null, sale_price: null, video_url: videoUrl };
    } catch { /* fall through */ }
  }

  // Tier 3: og meta tags
  const title = $('meta[property="og:title"]').attr('content') || $('title').text() || null;
  const image = $('meta[property="og:image"]').attr('content') || null;
  return { title, image, sale_price: null, video_url: extractVideoUrl(html) };
}

// Returns { data } on success, { deleted: true } if the product was 404'd and removed.
async function syncProduct(dbProductId, userId) {
  const { rows } = await query(
    `SELECT p.id, p.long_url, s.aliexpress_tracking_id
     FROM products p
     LEFT JOIN subjects s ON s.id = p.subject_id
     WHERE p.id = $1 AND p.user_id = $2`,
    [dbProductId, userId]
  );
  if (!rows.length) throw new Error('Product not found');

  const product    = rows[0];
  const trackingId = product.aliexpress_tracking_id || DEFAULT_TRACKING_ID;
  if (!product.long_url) throw new Error('Product has no URL');

  const { finalUrl, status } = await resolveUrl(product.long_url);

  if (status === 404) return { not_found: true };

  const productId = extractProductId(finalUrl);
  let data = null;

  if (productId) {
    try { data = await fetchViaApi(productId, trackingId); } catch { /* fall through */ }
  }

  if (!data) {
    try {
      data = await fetchViaScraper(finalUrl);
    } catch (err) {
      if (err.code === 'NOT_FOUND') return { not_found: true };
      throw err;
    }
  }

  if (!data) throw new Error('Could not fetch product data');

  // API doesn't always return video URLs — also try the HTTP scraper for video_url
  if (!data.video_url) {
    try {
      const scraped = await fetchViaScraper(finalUrl);
      if (scraped.video_url) data.video_url = scraped.video_url;
    } catch { /* ignore — video_url is optional */ }
  }

  const sets   = [];
  const values = [];
  let   idx    = 1;

  if (data.title      != null) { sets.push(`title = $${idx++}`);      values.push(data.title); }
  if (data.image      != null) { sets.push(`image = $${idx++}`);      values.push(data.image); }
  if (data.sale_price != null) { sets.push(`sale_price = $${idx++}`); values.push(data.sale_price); }
  if (data.video_url  != null) { sets.push(`video_url = $${idx++}`);  values.push(data.video_url); }

  if (!sets.length) throw new Error('No product data returned');

  sets.push('updated_at = NOW()');
  await query(
    `UPDATE products SET ${sets.join(', ')} WHERE id = $${idx++} AND user_id = $${idx}`,
    [...values, dbProductId, userId]
  );

  return { data };
}

// Returns { succeeded, not_found, failed, errors }
async function syncProducts(productIds, userId) {
  const result = { succeeded: 0, not_found: 0, failed: 0, errors: [] };

  for (let i = 0; i < productIds.length; i++) {
    const id = productIds[i];
    try {
      const res = await syncProduct(id, userId);
      if (res.not_found) result.not_found++;
      else               result.succeeded++;
    } catch (err) {
      result.failed++;
      result.errors.push({ id, error: err.message });
    }
    if (i < productIds.length - 1) await new Promise(r => setTimeout(r, 1000));
  }

  return result;
}

module.exports = { syncProduct, syncProducts, resolveUrl };
