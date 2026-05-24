const { query } = require('../db');
const { signAndCall } = require('./aliexpressApi');
const { passesFilters } = require('./aliexpressFilters');
const OpenAI = require('openai');

const DEFAULT_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || 'TechSalebuy';

const DEFAULT_AI_PROMPT =
`You are an AliExpress affiliate product researcher.

Niche: {{niche}}

Top-selling products in this niche (sorted by clicks):
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
    .map((p, i) => `${i + 1}. ${p.title} (${p.clicks} clicks)`)
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

  // 1. Fetch top-performing products per subject, ordered by clicks DESC
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
      title:  row.product_title,
      clicks: row.clicks,
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
    `SELECT long_url FROM products WHERE user_id = $1 AND long_url IS NOT NULL`,
    [userId]
  );
  const existingUrls = new Set(existingRows.map(r => r.long_url));

  const { rows: existingSugRows } = await query(
    `SELECT aliexpress_id FROM product_suggestions WHERE user_id = $1`,
    [userId]
  );
  const existingSugIds = new Set(existingSugRows.map(r => r.aliexpress_id));

  // 5. Search AliExpress per subject (max 5 subjects, up to 5 keywords each)
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

  return { newCount, subjectsSearched: entries.length, aiEnabled };
}

module.exports = { runDiscovery, DEFAULT_AI_PROMPT };
