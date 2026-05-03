const { query } = require('../db');
const { signAndCall } = require('./aliexpressApi');
const { passesFilters } = require('./aliexpressFilters');

const DEFAULT_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || 'TechSalebuy';

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
    fields:          'product_id,product_title,product_main_image_url,promotion_link,app_sale_price,evaluate_rate,lastest_volume,available_stock',
  });
  return response.data
    ?.aliexpress_affiliate_product_query_response
    ?.resp_result?.result?.products?.product || [];
}

async function runDiscovery(userId) {
  // 1. Fetch top-performing products per subject:
  //    products with clicks > 3 OR products that have a commission record
  const { rows: topProducts } = await query(`
    SELECT
      p.id,
      p.subject_id,
      s.name        AS subject_name,
      s.aliexpress_tracking_id,
      p.clicks,
      COALESCE(oi.product_title, '') AS english_title
    FROM products p
    JOIN subjects s ON s.id = p.subject_id AND s.user_id = $1
    LEFT JOIN commission_snapshots cs ON cs.product_id = p.id
    LEFT JOIN LATERAL (
      SELECT product_title FROM order_items
      WHERE user_id = $1 AND product_title IS NOT NULL
      LIMIT 1
    ) oi ON true
    WHERE p.user_id = $1
      AND p.created_at > NOW() - INTERVAL '90 days'
      AND (p.clicks > 3 OR cs.id IS NOT NULL)
    ORDER BY p.clicks DESC
    LIMIT 20
  `, [userId]);

  // 2. Build subject → keyword map; fall back to subject name when no English title
  const subjectMap = new Map();
  for (const row of topProducts) {
    if (!subjectMap.has(row.subject_id)) {
      const keyword = row.english_title || row.subject_name;
      // Only use ASCII/English keywords — skip if Hebrew (contains chars in ֐-׿ range)
      if (/[֐-׿]/.test(keyword)) continue;
      subjectMap.set(row.subject_id, {
        keyword,
        trackingId: row.aliexpress_tracking_id,
        subjectName: row.subject_name,
      });
    }
  }

  // If no high-performing products found, fall back to all subjects' names
  if (subjectMap.size === 0) {
    const { rows: subjects } = await query(
      `SELECT id, name, aliexpress_tracking_id FROM subjects WHERE user_id = $1`,
      [userId]
    );
    for (const s of subjects) {
      if (!/[֐-׿]/.test(s.name)) {
        subjectMap.set(s.id, { keyword: s.name, trackingId: s.aliexpress_tracking_id, subjectName: s.name });
      }
    }
  }

  // 3. Fetch existing promotion_links to deduplicate
  const { rows: existingRows } = await query(
    `SELECT long_url FROM products WHERE user_id = $1 AND long_url IS NOT NULL`,
    [userId]
  );
  const existingUrls = new Set(existingRows.map(r => r.long_url));

  // 4. Fetch already-known suggestion aliexpress_ids to skip
  const { rows: existingSugRows } = await query(
    `SELECT aliexpress_id FROM product_suggestions WHERE user_id = $1`,
    [userId]
  );
  const existingSugIds = new Set(existingSugRows.map(r => r.aliexpress_id));

  // 5. Search AliExpress sequentially (rate-limit safe), max 5 subjects
  const entries = [...subjectMap.entries()].slice(0, 5);
  let newCount = 0;

  for (const [subjectId, { keyword, trackingId, subjectName }] of entries) {
    try {
      const results = await searchAliExpress(keyword, trackingId);
      const filtered = results.filter(passesFilters);

      for (const product of filtered) {
        const pid = String(product.product_id);
        if (existingSugIds.has(pid)) continue;
        if (existingUrls.has(product.promotion_link)) continue;

        const salePrice = parseFloat(product.app_sale_price) || null;

        await query(`
          INSERT INTO product_suggestions
            (user_id, subject_id, aliexpress_id, title, image_url, promotion_link,
             sale_price, evaluate_rate, lastest_volume, source_keyword)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (user_id, aliexpress_id) DO NOTHING
        `, [
          userId, subjectId, pid,
          product.product_title,
          product.product_main_image_url || '',
          product.promotion_link,
          salePrice,
          product.evaluate_rate || null,
          Number(product.lastest_volume) || null,
          keyword,
        ]);

        existingSugIds.add(pid);
        newCount++;
      }
    } catch (err) {
      console.error(`[discovery] search failed for keyword "${keyword}": ${err.message}`);
    }

    // Rate-limit: 1s between searches
    await new Promise(r => setTimeout(r, 1000));
  }

  return { newCount, subjectsSearched: entries.length };
}

module.exports = { runDiscovery };
