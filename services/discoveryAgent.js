const { query } = require('../db');
const { signAndCall } = require('./aliexpressApi');
const { passesFilters } = require('./aliexpressFilters');
const { significantWords, isNearDuplicateTitle } = require('./productDedup');
const OpenAI = require('openai');

const DEFAULT_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || 'TechSalebuy';

const DEFAULT_AI_PROMPT =
`You are an AliExpress affiliate product researcher.

Niche: {{niche}}

Top-selling products in this niche (ranked by real AliExpress sales for this channel, falling back to link clicks when no sales data exists yet):
{{products}}

Generate 3 AliExpress search keywords to find similar or complementary products for this niche. Each keyword must be 2–5 English words — specific enough to return relevant products, broad enough to find variety.

Reply with only a valid JSON array of strings. Example:
["telescopic fishing rod", "spinning reel ultralight", "braided fishing line 100m"]
No explanation, no extra text — just the JSON array.`;

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

async function generateKeywordsWithAI(niche, products, customPrompt) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const productList = products
    .map((p, i) => `${i + 1}. ${p.title} (${p.orderCount > 0 ? `${p.orderCount} sold` : `${p.clicks} clicks`})`)
    .join('\n');

  const basePrompt = (customPrompt && customPrompt.trim()) ? customPrompt : DEFAULT_AI_PROMPT;
  const prompt = basePrompt
    .replace('{{niche}}', niche)
    .replace('{{products}}', productList);

  const response = await client.chat.completions.create({
    model:       process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    messages:    [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });

  const content = response.choices[0].message.content.trim();
  // Strip markdown code fences if the model wrapped the JSON
  const json = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const keywords = JSON.parse(json);
  if (!Array.isArray(keywords)) throw new Error('AI returned non-array response');
  return keywords.filter(k => typeof k === 'string' && k.trim()).slice(0, 5);
}

async function runDiscovery(userId) {
  // Load AI experiment settings
  const { rows: settingRows } = await query(
    `SELECT key, value FROM settings WHERE user_id = $1 AND key IN ('discovery_ai_enabled', 'discovery_ai_prompt')`,
    [userId]
  );
  const settingsMap = Object.fromEntries(settingRows.map(r => [r.key, r.value]));
  const aiEnabled = settingsMap.discovery_ai_enabled === 'true';
  const aiPrompt  = settingsMap.discovery_ai_prompt || '';

  // 1. Fetch top-performing products per subject.
  // "Most sold" is measured by real AliExpress orders/commission for that subject's
  // channel (tracking_id) via order_items — website clicks are only a fallback signal
  // for products that don't have confirmed order data yet.
  const { rows: topProducts } = await query(`
    SELECT
      p.subject_id,
      s.name                              AS subject_name,
      s.aliexpress_tracking_id,
      p.clicks,
      p.title                             AS product_title,
      COALESCE(sales.order_count, 0)      AS order_count,
      COALESCE(sales.total_commission, 0) AS total_commission
    FROM products p
    JOIN subjects s ON s.id = p.subject_id AND s.user_id = $1
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT oi.order_id) AS order_count,
             SUM(oi.commission_usd)      AS total_commission
      FROM order_items oi
      WHERE oi.user_id = $1
        AND oi.subject_id = p.subject_id
        AND p.long_url IS NOT NULL
        AND p.long_url LIKE '%' || oi.product_id || '%'
    ) sales ON true
    WHERE p.user_id = $1
      AND p.title IS NOT NULL
      AND p.created_at > NOW() - INTERVAL '90 days'
      AND (
        COALESCE(sales.order_count, 0) > 0
        OR p.clicks > 3
        OR EXISTS (
          SELECT 1 FROM commission_snapshots cs
          WHERE cs.user_id = $1
            AND cs.aliexpress_product_id IS NOT NULL
            AND p.long_url LIKE '%' || cs.aliexpress_product_id || '%'
        )
      )
    ORDER BY sales.order_count DESC NULLS LAST, sales.total_commission DESC NULLS LAST, p.clicks DESC
  `, [userId]);

  // 2. Group products by subject (skip Hebrew titles)
  const subjectProductsMap = new Map();
  for (const row of topProducts) {
    if (/[֐-׿]/.test(row.product_title)) continue;
    if (!subjectProductsMap.has(row.subject_id)) {
      subjectProductsMap.set(row.subject_id, {
        subjectName: row.subject_name,
        trackingId:  row.aliexpress_tracking_id,
        products:    [],
      });
    }
    subjectProductsMap.get(row.subject_id).products.push({
      title:      row.product_title,
      clicks:     row.clicks,
      orderCount: Number(row.order_count) || 0,
      commission: Number(row.total_commission) || 0,
    });
  }

  // 3. Build keyword list per subject — AI or title-extraction
  const subjectMap = new Map();
  for (const [subjectId, { subjectName, trackingId, products }] of subjectProductsMap) {
    let keywords;
    if (aiEnabled) {
      try {
        console.log(`[discovery] AI generating keywords for niche "${subjectName}"...`);
        keywords = await generateKeywordsWithAI(subjectName, products, aiPrompt);
        console.log(`[discovery] AI keywords for "${subjectName}": ${keywords.join(', ')}`);
      } catch (err) {
        console.error(`[discovery] AI failed for "${subjectName}", falling back to title extraction: ${err.message}`);
        keywords = [...new Set(products.slice(0, 3).map(p => titleToKeyword(p.title)))];
      }
    } else {
      keywords = [...new Set(products.slice(0, 3).map(p => titleToKeyword(p.title)))];
    }
    subjectMap.set(subjectId, { keywords, trackingId, subjectName });
  }

  // Fallback: no high-performing products yet — use subject names
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

  // 4. Deduplication sets
  const { rows: existingRows } = await query(
    `SELECT long_url, aliexpress_product_id, title FROM products
     WHERE user_id = $1 AND (long_url IS NOT NULL OR aliexpress_product_id IS NOT NULL)`,
    [userId]
  );
  const existingUrls = new Set(existingRows.map(r => r.long_url).filter(Boolean));

  const { rows: existingSugRows } = await query(
    `SELECT aliexpress_id, title FROM product_suggestions WHERE user_id = $1`,
    [userId]
  );
  // Exact-ID dedup covers both product_suggestions (aliexpress_id) and products already
  // added to the live catalog (aliexpress_product_id) — a suggestion approved via
  // POST /api/aliexpress/add ends up in the latter, not the former.
  const existingSugIds = new Set([
    ...existingSugRows.map(r => r.aliexpress_id),
    ...existingRows.map(r => r.aliexpress_product_id).filter(Boolean),
  ]);

  // Near-duplicate title check on top of the ID/URL sets above — AliExpress product
  // IDs differ per seller even for the exact same physical item, so the same product
  // listed by a different supplier would otherwise sail through ID-based dedup and
  // resurface as "new".
  const existingTitleWords = [...existingRows, ...existingSugRows]
    .map(r => r.title)
    .filter(Boolean)
    .map(significantWords);

  // 5. Search AliExpress per subject (max 5 subjects, up to 5 keywords each)
  const entries = [...subjectMap.entries()].slice(0, 5);
  let newCount = 0;

  for (const [subjectId, { keywords, trackingId }] of entries) {
    // Gather every keyword's results for this subject first so near-duplicate
    // listings from different suppliers (same product, different seller/ID) can be
    // collapsed to one before anything is inserted, instead of inserting each as it
    // streams in per-keyword.
    let candidates = [];
    for (const keyword of keywords) {
      try {
        const results = await searchAliExpress(keyword, trackingId);
        candidates.push(
          ...results
            .filter(passesFilters)
            .filter(p => !existingSugIds.has(String(p.product_id)) && !existingUrls.has(p.promotion_link))
            .filter(p => !isNearDuplicateTitle(p.product_title, existingTitleWords))
            .map(p => ({ ...p, _sourceKeyword: keyword }))
        );
      } catch (err) {
        console.error(`[discovery] search failed for keyword "${keyword}": ${err.message}`);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    const seenIds = new Set();
    candidates = candidates.filter(c => {
      const pid = String(c.product_id);
      if (seenIds.has(pid)) return false;
      seenIds.add(pid);
      return true;
    });

    // Diversity pass: collapse near-duplicate listings of the same physical product
    // from different sellers down to the single best one, ranked by recent sales
    // volume, before any suggestion is inserted.
    candidates.sort((a, b) => (Number(b.lastest_volume) || 0) - (Number(a.lastest_volume) || 0));
    const keptTitleWords = [];
    candidates = candidates.filter(c => {
      if (isNearDuplicateTitle(c.product_title, keptTitleWords)) return false;
      keptTitleWords.push(significantWords(c.product_title));
      return true;
    });

    for (const product of candidates) {
      const pid = String(product.product_id);

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
        product._sourceKeyword,
      ]);

      existingSugIds.add(pid);
      newCount++;
    }
  }

  return { newCount, subjectsSearched: entries.length, aiEnabled };
}

module.exports = { runDiscovery, DEFAULT_AI_PROMPT };
