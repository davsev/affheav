const { query } = require('../db');
const { signAndCall } = require('./aliexpressApi');
const { passesFilters } = require('./aliexpressFilters');

const DEFAULT_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || 'TechSalebuy';
const MAX_DRAFTS_PER_SUBJECT_PER_DAY = 5;
const MAX_SUBJECTS_PER_RUN = 10;
const HEBREW_RE = /[֐-׿]/;

// Extract a short category-level keyword from a full product title (first 5 words)
function titleToKeyword(title) {
  return title.split(/\s+/).slice(0, 5).join(' ');
}

async function searchAliExpress(keywords, trackingId) {
  const response = await signAndCall({
    method:          'aliexpress.affiliate.product.query',
    keywords,
    target_currency: 'ILS',
    target_language: 'HE',
    tracking_id:     trackingId || DEFAULT_TRACKING_ID,
    sort:            'LAST_VOLUME_DESC',
    page_no:         '1',
    page_size:       '30',
    fields:          'product_id,product_title,product_main_image_url,product_video_url,promotion_link,app_sale_price,evaluate_rate,lastest_volume,available_stock',
  });
  return response.data
    ?.aliexpress_affiliate_product_query_response
    ?.resp_result?.result?.products?.product || [];
}

// "Memory" of each channel's (subject/tracking_id) best sellers. Primary signal is
// order_items — real AliExpress orders, which persist independently of the live
// products table (a product can be edited/removed and this history still holds).
// Falls back to website clicks for channels without order history yet.
async function getTopSellersBySubject(userId) {
  const { rows: subjects } = await query(
    `SELECT id, name, aliexpress_tracking_id FROM subjects
     WHERE user_id = $1 AND aliexpress_tracking_id IS NOT NULL AND aliexpress_tracking_id != ''`,
    [userId]
  );

  const result = new Map(); // subjectId -> { subjectName, trackingId, products: [{ title, orderCount, commission, clicks }] }

  for (const s of subjects) {
    const { rows: sales } = await query(
      `SELECT product_id, MAX(product_title) AS title,
              COUNT(DISTINCT order_id) AS order_count,
              COALESCE(SUM(commission_usd), 0) AS commission
       FROM order_items
       WHERE user_id = $1 AND subject_id = $2 AND product_title IS NOT NULL
       GROUP BY product_id
       ORDER BY order_count DESC, commission DESC
       LIMIT 10`,
      [userId, s.id]
    );

    let products = sales
      .filter(r => r.title && !HEBREW_RE.test(r.title))
      .map(r => ({ title: r.title, orderCount: Number(r.order_count) || 0, commission: Number(r.commission) || 0, clicks: 0 }));

    if (products.length === 0) {
      const { rows: clicked } = await query(
        `SELECT title, clicks FROM products
         WHERE user_id = $1 AND subject_id = $2 AND title IS NOT NULL AND clicks > 3
         ORDER BY clicks DESC LIMIT 10`,
        [userId, s.id]
      );
      products = clicked
        .filter(r => r.title && !HEBREW_RE.test(r.title))
        .map(r => ({ title: r.title, orderCount: 0, commission: 0, clicks: r.clicks }));
    }

    if (products.length === 0 && !HEBREW_RE.test(s.name)) {
      products = [{ title: s.name, orderCount: 0, commission: 0, clicks: 0 }];
    }

    if (products.length) {
      result.set(s.id, { subjectName: s.name, trackingId: s.aliexpress_tracking_id, products });
    }
  }

  return result;
}

// Runs the autonomous product-acquisition agent for one user: learns each channel's
// best sellers, searches AliExpress for similar products, and inserts drafts directly
// into the products table (status='draft') for manual approval. Never touches the
// live catalog on its own.
async function runAutoProductAgent(userId) {
  const { rows: settingRows } = await query(
    `SELECT value FROM settings WHERE user_id = $1 AND key = 'auto_agent_enabled'`,
    [userId]
  );
  if (settingRows[0]?.value === 'false') {
    return { skipped: true, reason: 'disabled', totalAdded: 0, subjects: {} };
  }

  const subjectMap = await getTopSellersBySubject(userId);

  // Dedup against every product this user has ever had, in any status —
  // rejected drafts are kept (not deleted) specifically so they count here and
  // the agent never re-suggests something already declined.
  const { rows: existingRows } = await query(
    `SELECT long_url FROM products WHERE user_id = $1 AND long_url IS NOT NULL`,
    [userId]
  );
  const existingUrls = new Set(existingRows.map(r => r.long_url));

  const { rows: maxRow } = await query(
    'SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM products WHERE user_id = $1',
    [userId]
  );
  let nextOrder = (maxRow[0]?.max_order || 0) + 1;

  const entries = [...subjectMap.entries()].slice(0, MAX_SUBJECTS_PER_RUN);
  let totalAdded = 0;
  const perSubject = {};

  for (const [subjectId, { subjectName, trackingId, products }] of entries) {
    const { rows: countRows } = await query(
      `SELECT COUNT(*) AS n FROM products
       WHERE user_id = $1 AND subject_id = $2 AND added_by = 'auto_agent'
         AND created_at >= date_trunc('day', NOW())`,
      [userId, subjectId]
    );
    let remaining = MAX_DRAFTS_PER_SUBJECT_PER_DAY - parseInt(countRows[0]?.n || 0, 10);
    if (remaining <= 0) { perSubject[subjectName] = 0; continue; }

    const keywords = [...new Set(products.slice(0, 3).map(p => titleToKeyword(p.title)))];
    let added = 0;

    for (const keyword of keywords) {
      if (remaining <= 0) break;
      try {
        const results = await searchAliExpress(keyword, trackingId);
        const filtered = results.filter(passesFilters);

        for (const product of filtered) {
          if (remaining <= 0) break;
          if (existingUrls.has(product.promotion_link)) continue;

          const salePrice      = parseFloat(product.app_sale_price) || null;
          const commissionRate = salePrice ? 0.08 : null;
          const videoUrl       = product.product_video_url || null;

          await query(
            `INSERT INTO products
               (user_id, subject_id, long_url, image, text, title, sort_order,
                sale_price, commission_rate, video_url, use_video, status, added_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft','auto_agent')`,
            [
              userId, subjectId, product.promotion_link,
              product.product_main_image_url || '',
              product.product_title, product.product_title,
              nextOrder++,
              salePrice, commissionRate, videoUrl, !!videoUrl,
            ]
          );

          existingUrls.add(product.promotion_link);
          remaining--;
          added++;
          totalAdded++;
        }
      } catch (err) {
        console.error(`[auto-agent] search failed for "${keyword}": ${err.message}`);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    perSubject[subjectName] = added;
  }

  return { totalAdded, subjects: perSubject, skipped: false };
}

module.exports = { runAutoProductAgent, getTopSellersBySubject, MAX_DRAFTS_PER_SUBJECT_PER_DAY };
