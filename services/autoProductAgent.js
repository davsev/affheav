const { query } = require('../db');
const { signAndCall } = require('./aliexpressApi');
const { passesFilters } = require('./aliexpressFilters');
const OpenAI = require('openai');

const DEFAULT_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || 'TechSalebuy';
const MAX_DRAFTS_PER_SUBJECT_PER_DAY = 5;
const MAX_SUBJECTS_PER_RUN = 10;
const HEBREW_RE = /[֐-׿]/;

const DEFAULT_KEYWORD_PROMPT =
`You are an AliExpress affiliate product researcher.

Niche: {{niche}}

Top-selling products in this niche (ranked by real AliExpress sales for this channel, falling back to link clicks when no sales data exists yet):
{{products}}

Generate 3 AliExpress search keywords to find similar or complementary products for this niche. Each keyword must be 2–5 English words — specific enough to return relevant products, broad enough to find variety.

Reply with only a valid JSON array of strings. Example:
["telescopic fishing rod", "spinning reel ultralight", "braided fishing line 100m"]
No explanation, no extra text — just the JSON array.`;

// Not user-customizable (unlike the keyword prompt) — keeps the settings UI to one prompt.
const RELEVANCE_PROMPT =
`You are curating AliExpress product listings for a WhatsApp affiliate channel focused on one niche.

Niche: {{niche}}

Current best sellers in this niche:
{{bestSellers}}

Candidate products found via AliExpress search:
{{candidates}}

Decide which candidates are a good fit to add to this channel's catalog: relevant to the niche, a genuine complement or variant of the best sellers, and not a near-duplicate of another candidate in this list. Reject anything off-topic, low-quality-looking, or redundant with another candidate.

Reply with only a valid JSON array of the candidate numbers to keep (1-indexed). Example: [1,3,4]
No explanation, no extra text — just the JSON array.`;

// Extract a short category-level keyword from a full product title (first 5 words)
function titleToKeyword(title) {
  return title.split(/\s+/).slice(0, 5).join(' ');
}

// Strip markdown code fences if the model wrapped the JSON, then parse.
function parseAiJsonArray(content) {
  const json = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('AI returned non-array response');
  return parsed;
}

async function generateKeywordsWithAI(subjectName, products, customPrompt) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const productList = products
    .map((p, i) => `${i + 1}. ${p.title} (${p.orderCount > 0 ? `${p.orderCount} sold` : `${p.clicks} clicks`})`)
    .join('\n');

  const basePrompt = (customPrompt && customPrompt.trim()) ? customPrompt : DEFAULT_KEYWORD_PROMPT;
  const prompt = basePrompt.replace('{{niche}}', subjectName).replace('{{products}}', productList);

  const response = await client.chat.completions.create({
    model:       process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    messages:    [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });

  const keywords = parseAiJsonArray(response.choices[0].message.content);
  return keywords.filter(k => typeof k === 'string' && k.trim()).slice(0, 5);
}

// Judges a subject's numeric-filter-passing candidates against its niche + best sellers,
// returning only the ones worth drafting. Falls back to keeping everything on any
// failure (network error, bad JSON, etc) — AI filtering is an enhancement, not a gate.
async function filterCandidatesWithAI(subjectName, bestSellers, candidates) {
  if (!candidates.length) return candidates;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const bestSellerList = bestSellers.length
    ? bestSellers.map((p, i) => `${i + 1}. ${p.title}`).join('\n')
    : '(no sales data yet)';
  const candidateList = candidates.map((c, i) => `${i + 1}. ${c.product_title}`).join('\n');

  const prompt = RELEVANCE_PROMPT
    .replace('{{niche}}', subjectName)
    .replace('{{bestSellers}}', bestSellerList)
    .replace('{{candidates}}', candidateList);

  const response = await client.chat.completions.create({
    model:       process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    messages:    [{ role: 'user', content: prompt }],
    temperature: 0.3,
  });

  const indices = parseAiJsonArray(response.choices[0].message.content);
  const keepSet = new Set(indices.map(n => Number(n)));
  return candidates.filter((_, i) => keepSet.has(i + 1));
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
//
// The auto_agent_enabled setting only gates the *scheduled* daily run (checked by the
// caller in scheduler/index.js) — it does not gate this function itself, so a manual
// "run now" trigger always works even when the user has paused automatic runs.
async function runAutoProductAgent(userId) {
  const { rows: settingRows } = await query(
    `SELECT key, value FROM settings WHERE user_id = $1 AND key IN ('auto_agent_ai_enabled', 'auto_agent_ai_prompt')`,
    [userId]
  );
  const settingsMap = Object.fromEntries(settingRows.map(r => [r.key, r.value]));
  const aiEnabled = settingsMap.auto_agent_ai_enabled === 'true';
  const aiPrompt  = settingsMap.auto_agent_ai_prompt || '';

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

    let keywords;
    if (aiEnabled) {
      try {
        keywords = await generateKeywordsWithAI(subjectName, products, aiPrompt);
      } catch (err) {
        console.error(`[auto-agent] AI keyword generation failed for "${subjectName}", falling back to title extraction: ${err.message}`);
        keywords = [...new Set(products.slice(0, 3).map(p => titleToKeyword(p.title)))];
      }
    } else {
      keywords = [...new Set(products.slice(0, 3).map(p => titleToKeyword(p.title)))];
    }

    // Gather every numeric-filter-passing candidate across this subject's keywords first,
    // so an AI relevance pass (if enabled) can judge the whole set in one call.
    let candidates = [];
    for (const keyword of keywords) {
      try {
        const results = await searchAliExpress(keyword, trackingId);
        candidates.push(...results.filter(passesFilters).filter(p => !existingUrls.has(p.promotion_link)));
      } catch (err) {
        console.error(`[auto-agent] search failed for "${keyword}": ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    // Dedup candidates against each other (the same product can surface for multiple keywords)
    const seenLinks = new Set();
    candidates = candidates.filter(c => {
      if (seenLinks.has(c.promotion_link)) return false;
      seenLinks.add(c.promotion_link);
      return true;
    });

    if (aiEnabled && candidates.length) {
      try {
        candidates = await filterCandidatesWithAI(subjectName, products, candidates);
      } catch (err) {
        console.error(`[auto-agent] AI relevance filter failed for "${subjectName}", keeping all numeric-filtered candidates: ${err.message}`);
      }
    }

    let added = 0;
    for (const product of candidates) {
      if (remaining <= 0) break;

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

    perSubject[subjectName] = added;
  }

  return { totalAdded, subjects: perSubject, aiEnabled, skipped: false };
}

module.exports = {
  runAutoProductAgent,
  getTopSellersBySubject,
  MAX_DRAFTS_PER_SUBJECT_PER_DAY,
  DEFAULT_KEYWORD_PROMPT,
};
