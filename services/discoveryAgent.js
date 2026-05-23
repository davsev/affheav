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

// Extract a short category-level keyword from a full product title (first 5 words)
function titleToKeyword(title) {
  return title.split(/\s+/).slice(0, 5).join(' ');
}

async function runDiscovery(userId) {
  // 1. Fetch top-performing products per subject, ordered by clicks DESC.
  //    Use p.title (the stored AliExpress product title) as the search keyword.
  const { rows: topProducts } = await query(`
    SELECT
      p.subject_id,
      s.name                   AS subject_name,
      s.aliexpress_tracking_id,
      p.clicks,
      p.title                  AS product_title
    FROM products p
    JOIN subjects s ON s.id = p.subject_id AND s.user_id = $1
    WHERE p.user_id = $1
      AND p.title IS NOT NULL
      AND p.created_at > NOW() - INTERVAL '90 days'
      AND (
        p.clicks > 3
        OR EXISTS (
          SELECT 1 FROM commission_snapshots cs
          WHERE cs.user_id = $1
            AND cs.aliexpress_product_id IS NOT NULL
            AND p.long_url LIKE '%' || cs.aliexpress_product_id || '%'
        )
      )
    ORDER BY p.clicks DESC
  `, [userId]);

  // 2. Build subject → { keywords[], trackingId, subjectName } map.
  //    Collect up to 3 distinct keywords per subject from top-selling products,
  //    so suggestions reflect what's actually working in each niche.
  const subjectMap = new Map();

  for (const row of topProducts) {
    const keyword = titleToKeyword(row.product_title);
    // Skip Hebrew keywords (can't search AliExpress with them)
    if (/[֐-׿]/.test(keyword)) continue;

    if (!subjectMap.has(row.subject_id)) {
      subjectMap.set(row.subject_id, {
        keywords:    [],
        trackingId:  row.aliexpress_tracking_id,
        subjectName: row.subject_name,
      });
    }

    const entry = subjectMap.get(row.subject_id);
    if (entry.keywords.length < 3 && !entry.keywords.includes(keyword)) {
      entry.keywords.push(keyword);
    }
  }

  // Fallback: if no high-performing products found, use subject names
  if (subjectMap.size === 0) {
    const { rows: subjects } = await query(
      `SELECT id, name, aliexpress_tracking_id FROM subjects WHERE user_id = $1`,
      [userId]
    );
    for (const s of subjects) {
      if (!/[֐-׿]/.test(s.name)) {
        subjectMap.set(s.id, { keywords: [s.name], trackingId: s.aliexpress_tracking_id, subjectName: s.name });
      }
    }
  }

  // 3. Fetch existing products/suggestions for deduplication
  const { rows: existingRows } = await query(
    `SELECT long_url FROM products WHERE user_id = $1 AND long_url IS NOT NULL`,
    [userId]
  );
  const existingUrls = new Set(existingRows.map(r => r.long_url));

  const { rows: existingSugRows } = await query(
    `SELECT aliexpress_id FROM product_suggestions WHERE user_id = $1`,
    [userId]
  );
  const existingSugIds = new Set(existingSugRows.map(r => r.aliexpress_id));

  // 4. Search AliExpress per subject (max 5 subjects, up to 3 keywords each)
  const entries = [...subjectMap.entries()].slice(0, 5);
  let newCount = 0;

  for (const [subjectId, { keywords, trackingId }] of entries) {
    for (const keyword of keywords) {
      try {
        const results = await searchAliExpress(keyword, trackingId);
        const filtered = results.filter(passesFilters);

        for (const product of filtered) {
          const pid = String(product.product_id);
          if (existingSugIds.has(pid)) continue;
          if (existingUrls.has(product.promotion_link)) continue;

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
            parseFloat(product.app_sale_price) || null,
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

      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return { newCount, subjectsSearched: entries.length };
}

module.exports = { runDiscovery };
