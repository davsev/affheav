const { query } = require('../db');
const { signAndCall } = require('./aliexpressApi');
const { passesFilters } = require('./aliexpressFilters');
const { significantWords, isNearDuplicateTitle } = require('./productDedup');
const { shortenUrl } = require('./spooMe');
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

Products previously rejected for this niche — avoid suggesting similar ones again:
{{rejected}}

Products that were approved and sent to the channel but got almost no clicks after two weeks live — real audience feedback, treat as equally worth avoiding:
{{underperforming}}

Candidate products found via AliExpress search:
{{candidates}}

Decide which candidates are a good fit to add to this channel's catalog: relevant to the niche, a genuine complement or variant of the best sellers, not similar to anything previously rejected or that underperformed after being sent, and not a near-duplicate of another candidate in this list. Reject anything off-topic, low-quality-looking, or redundant.

Reply with only a valid JSON array of objects for the candidates to keep, each with the candidate number (1-indexed) and a short (under 12 words) reason a shop owner would find useful. Example:
[{"index":1,"reason":"Matching screen protector for your best-selling phone case"},{"index":3,"reason":"Popular color variant of your top seller"}]
No explanation, no extra text — just the JSON array.`;

// Not user-customizable (unlike the keyword prompt) — keeps the settings UI to one prompt.
const COMPLEMENTARY_PROMPT =
`You are an AliExpress affiliate cross-sell researcher.

Niche: {{niche}}

Top-selling products in this niche:
{{products}}

Generate 3 AliExpress search keywords for products that COMPLEMENT the ones above — accessories or add-ons a customer who already bought these would also want. Not more variants of the same product. For example, for a phone case: screen protector, wireless charger, phone stand. Each keyword must be 2–5 English words.

Reply with only a valid JSON array of strings. Example:
["tempered glass screen protector", "wireless phone charger", "phone stand desk"]
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

// Cross-sell keywords — accessories/add-ons for the best sellers, not more variants of
// the same item. No non-AI equivalent: there's no reliable title-extraction heuristic
// for "what goes with this," so this source is skipped entirely when AI is off.
async function generateComplementaryKeywordsWithAI(subjectName, products) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const productList = products
    .map((p, i) => `${i + 1}. ${p.title} (${p.orderCount > 0 ? `${p.orderCount} sold` : `${p.clicks} clicks`})`)
    .join('\n');

  const prompt = COMPLEMENTARY_PROMPT.replace('{{niche}}', subjectName).replace('{{products}}', productList);

  const response = await client.chat.completions.create({
    model:       process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    messages:    [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });

  const keywords = parseAiJsonArray(response.choices[0].message.content);
  return keywords.filter(k => typeof k === 'string' && k.trim()).slice(0, 3);
}

// Judges a subject's numeric-filter-passing candidates against its niche, best sellers,
// previously-rejected products, and products that underperformed after being sent
// (real click data — see getUnderperformingTitles), returning only the ones worth
// drafting — each tagged with a short AI-written reason (used for the draft card's
// "why this?" line). Falls back to keeping everything (untagged) on any failure
// (network error, bad JSON, etc) — AI filtering is an enhancement, not a gate.
async function filterCandidatesWithAI(subjectName, bestSellers, candidates, rejectedTitles, underperformingTitles = []) {
  if (!candidates.length) return candidates;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const bestSellerList = bestSellers.length
    ? bestSellers.map((p, i) => `${i + 1}. ${p.title}`).join('\n')
    : '(no sales data yet)';
  const rejectedList = rejectedTitles.length
    ? rejectedTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
    : '(none yet)';
  const underperformingList = underperformingTitles.length
    ? underperformingTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
    : '(none yet)';
  const candidateList = candidates.map((c, i) => `${i + 1}. ${c.product_title}`).join('\n');

  const prompt = RELEVANCE_PROMPT
    .replace('{{niche}}', subjectName)
    .replace('{{bestSellers}}', bestSellerList)
    .replace('{{rejected}}', rejectedList)
    .replace('{{underperforming}}', underperformingList)
    .replace('{{candidates}}', candidateList);

  const response = await client.chat.completions.create({
    model:       process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    messages:    [{ role: 'user', content: prompt }],
    temperature: 0.3,
  });

  const decisions = parseAiJsonArray(response.choices[0].message.content);
  const reasonByIndex = new Map(
    decisions
      .filter(d => d && typeof d.index !== 'undefined')
      .map(d => [Number(d.index), typeof d.reason === 'string' ? d.reason.trim() : null])
  );

  return candidates
    .map((c, i) => (reasonByIndex.has(i + 1) ? { ...c, aiReason: reasonByIndex.get(i + 1) || null } : null))
    .filter(Boolean);
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

// AliExpress's own hot/trending products for a keyword — independent of this channel's
// own sales history, so it surfaces new-to-you products and works even for a subject
// with zero orders or clicks yet.
async function searchHotProducts(keywords, trackingId) {
  const response = await signAndCall({
    method:          'aliexpress.affiliate.hotproduct.query',
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
    ?.aliexpress_affiliate_hotproduct_query_response
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

// Real-traffic negative signal for a subject, independent of manual rejection: products
// the agent added, that got approved and sent, but earned almost no clicks after two
// weeks live. Fed into filterCandidatesWithAI alongside human-rejected titles, so what
// actually drives (or fails to drive) traffic — not just approve/reject judgment calls —
// teaches the AI what to avoid suggesting again.
const UNDERPERFORMING_DAYS_LIVE  = 14;
const UNDERPERFORMING_MAX_CLICKS = 2;

async function getUnderperformingTitles(userId, subjectId) {
  const { rows } = await query(
    `SELECT title FROM products
     WHERE user_id = $1 AND subject_id = $2 AND added_by = 'auto_agent' AND status = 'active'
       AND title IS NOT NULL
       AND sent_at IS NOT NULL AND sent_at <= NOW() - INTERVAL '${UNDERPERFORMING_DAYS_LIVE} days'
       AND clicks <= $3
     ORDER BY sent_at DESC LIMIT 20`,
    [userId, subjectId, UNDERPERFORMING_MAX_CLICKS]
  );
  return rows.map(r => r.title);
}

// Approves a single draft: resolves a WhatsApp group (explicit choice, or the
// subject's first group), generates the short_link via spoo.me (deferred until
// approval so drafts that never get approved never waste one), and flips it to
// 'active' so it enters the normal send rotation. Shared by the manual approve
// route (routes/products.js) and runAutoProductAgent's optional auto-approve mode
// below — returns null if the row isn't a pending draft (already handled/gone).
async function approveProduct(userId, productId, whatsappGroupId) {
  const { rows: draftRows } = await query(
    `SELECT * FROM products WHERE id = $1 AND user_id = $2 AND status = 'draft'`,
    [productId, userId]
  );
  const draft = draftRows[0];
  if (!draft) return null;

  let wa_group = '', join_link = '', resolvedGroupId = whatsappGroupId || null;
  if (whatsappGroupId) {
    const { rows: grp } = await query(
      'SELECT wa_group, join_link FROM whatsapp_groups WHERE id = $1 AND user_id = $2',
      [whatsappGroupId, userId]
    );
    if (grp[0]) { wa_group = grp[0].wa_group; join_link = grp[0].join_link || ''; }
  } else if (draft.subject_id) {
    const { rows: grp } = await query(
      `SELECT id, wa_group, join_link FROM whatsapp_groups
       WHERE subject_id = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT 1`,
      [draft.subject_id, userId]
    );
    if (grp[0]) { resolvedGroupId = grp[0].id; wa_group = grp[0].wa_group; join_link = grp[0].join_link || ''; }
  }

  const shortLink = draft.short_link || await shortenUrl(draft.long_url);

  const { rows: updated } = await query(
    `UPDATE products SET
       status = 'active', short_link = $1, wa_group = $2, join_link = $3,
       whatsapp_group_id = $4, updated_at = NOW()
     WHERE id = $5 AND user_id = $6
     RETURNING *`,
    [shortLink, wa_group, join_link, resolvedGroupId, productId, userId]
  );
  return updated[0];
}

// Runs the autonomous product-acquisition agent for one user: learns each channel's
// best sellers, then searches AliExpress across three angles — similar variants,
// complementary/cross-sell add-ons (AI only), and trending products for the niche as
// a whole — and inserts drafts directly into the products table (status='draft') for
// manual approval. Never touches the live catalog on its own, UNLESS the
// auto_agent_auto_approve setting is on (off by default, opt-in), in which case every
// inserted draft is immediately approved via approveProduct() — no human review step.
//
// The auto_agent_enabled setting only gates the *scheduled* daily run (checked by the
// caller in scheduler/index.js) — it does not gate this function itself, so a manual
// "run now" trigger always works even when the user has paused automatic runs.
async function runAutoProductAgent(userId) {
  const { rows: settingRows } = await query(
    `SELECT key, value FROM settings WHERE user_id = $1
     AND key IN ('auto_agent_ai_enabled', 'auto_agent_ai_prompt', 'auto_agent_auto_approve')`,
    [userId]
  );
  const settingsMap = Object.fromEntries(settingRows.map(r => [r.key, r.value]));
  const aiEnabled    = settingsMap.auto_agent_ai_enabled === 'true';
  const aiPrompt     = settingsMap.auto_agent_ai_prompt || '';
  // Off by default (opt-in) — unlike the other two settings, this one skips human
  // review entirely, so it doesn't get the same "absence means enabled" default.
  const autoApprove  = settingsMap.auto_agent_auto_approve === 'true';

  const subjectMap = await getTopSellersBySubject(userId);

  // Dedup against every product this user has ever had, in any status — rejected
  // drafts are kept (not deleted) specifically so they count here and the agent
  // never re-suggests something already declined. Keyed primarily by the stable
  // AliExpress product_id, not long_url: long_url stores the affiliate
  // promotion_link, which AliExpress regenerates on every API call — the same
  // physical product gets a different link each time, so a URL-only dedup check
  // silently fails and the same product keeps resurfacing as "new". long_url is
  // kept as a secondary check for older rows inserted before this column existed.
  const { rows: existingRows } = await query(
    `SELECT long_url, aliexpress_product_id, title FROM products
     WHERE user_id = $1 AND (long_url IS NOT NULL OR aliexpress_product_id IS NOT NULL)`,
    [userId]
  );
  const existingUrls       = new Set(existingRows.map(r => r.long_url).filter(Boolean));
  const existingProductIds = new Set(existingRows.map(r => r.aliexpress_product_id).filter(Boolean));

  // agent_suggestion_history is a durable, insert-only log of every product this
  // agent has ever drafted for this user — independent of the products table, so a
  // user deleting old (already-sent) products doesn't erase the agent's memory and
  // cause the exact same product to resurface as "new". Combined with existingRows'
  // titles below for the near-duplicate check (different sellers of the same item
  // have different product_ids, so ID dedup alone misses them).
  const { rows: historyRows } = await query(
    `SELECT aliexpress_product_id, title FROM agent_suggestion_history WHERE user_id = $1`,
    [userId]
  );
  for (const r of historyRows) if (r.aliexpress_product_id) existingProductIds.add(r.aliexpress_product_id);

  const existingTitleWords = [...existingRows, ...historyRows]
    .map(r => r.title)
    .filter(Boolean)
    .map(significantWords);

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

    // keyword -> best-seller title that produced it. Only meaningful for title-extraction
    // "similar" keywords (each comes from one specific best seller); AI-generated
    // keywords (similar or complementary) aren't tied to a single product, so this map
    // stays empty for those.
    const keywordSource = new Map();
    let similarKeywords;
    if (aiEnabled) {
      try {
        similarKeywords = await generateKeywordsWithAI(subjectName, products, aiPrompt);
      } catch (err) {
        console.error(`[auto-agent] AI keyword generation failed for "${subjectName}", falling back to title extraction: ${err.message}`);
        similarKeywords = [];
        for (const p of products.slice(0, 3)) {
          const kw = titleToKeyword(p.title);
          if (!keywordSource.has(kw)) { similarKeywords.push(kw); keywordSource.set(kw, p.title); }
        }
      }
    } else {
      similarKeywords = [];
      for (const p of products.slice(0, 3)) {
        const kw = titleToKeyword(p.title);
        if (!keywordSource.has(kw)) { similarKeywords.push(kw); keywordSource.set(kw, p.title); }
      }
    }

    // Three search sources feed the same candidate pool: variants of what already
    // sells (similarKeywords, above), accessories/add-ons for those best sellers
    // (complementary — AI only, no reliable non-AI heuristic for "what goes with
    // this"), and AliExpress's own trending products for the niche as a whole
    // (works even for a subject with zero sales history yet).
    const searchTasks = similarKeywords.map(keyword => ({ keyword, hot: false }));

    if (aiEnabled) {
      try {
        const complementary = await generateComplementaryKeywordsWithAI(subjectName, products);
        searchTasks.push(...complementary.map(keyword => ({ keyword, hot: false })));
      } catch (err) {
        console.error(`[auto-agent] AI complementary-keyword generation failed for "${subjectName}": ${err.message}`);
      }
    }

    if (!HEBREW_RE.test(subjectName)) {
      searchTasks.push({ keyword: subjectName, hot: true });
    }

    // Gather every numeric-filter-passing candidate across all of this subject's
    // searches first, so an AI relevance pass (if enabled) can judge the whole set
    // in one call.
    let candidates = [];
    for (const task of searchTasks) {
      try {
        const results = task.hot
          ? await searchHotProducts(task.keyword, trackingId)
          : await searchAliExpress(task.keyword, trackingId);
        candidates.push(
          ...results
            .filter(passesFilters)
            .filter(p => !existingProductIds.has(String(p.product_id)) && !existingUrls.has(p.promotion_link))
            .filter(p => !isNearDuplicateTitle(p.product_title, existingTitleWords))
            .map(p => ({ ...p, _sourceKeyword: task.keyword, _isTrending: task.hot }))
        );
      } catch (err) {
        console.error(`[auto-agent] search failed for "${task.keyword}"${task.hot ? ' (trending)' : ''}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    // Dedup candidates against each other (the same product can surface for multiple
    // keywords, each time with a different promotion_link) — key by product_id, not link.
    const seenIds = new Set();
    candidates = candidates.filter(c => {
      const pid = String(c.product_id);
      if (seenIds.has(pid)) return false;
      seenIds.add(pid);
      return true;
    });

    // Diversity pass: collapse near-duplicate listings of the same physical product
    // from different sellers (e.g. the same LED strip offered by five suppliers) down
    // to a single best candidate, ranked by recent sales volume, before any draft is
    // created. Runs unconditionally (not just when AI filtering is on) since this is
    // exactly the pattern non-AI title-extraction search tends to surface.
    candidates.sort((a, b) => (Number(b.lastest_volume) || 0) - (Number(a.lastest_volume) || 0));
    const keptTitleWords = [];
    candidates = candidates.filter(c => {
      if (isNearDuplicateTitle(c.product_title, keptTitleWords)) return false;
      keptTitleWords.push(significantWords(c.product_title));
      return true;
    });

    if (aiEnabled && candidates.length) {
      try {
        const [{ rows: rejectedRows }, underperformingTitles] = await Promise.all([
          query(
            `SELECT title FROM products
             WHERE user_id = $1 AND subject_id = $2 AND status = 'rejected' AND title IS NOT NULL
             ORDER BY updated_at DESC LIMIT 20`,
            [userId, subjectId]
          ),
          getUnderperformingTitles(userId, subjectId),
        ]);
        candidates = await filterCandidatesWithAI(subjectName, products, candidates, rejectedRows.map(r => r.title), underperformingTitles);
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
      const bestSeller     = keywordSource.get(product._sourceKeyword);
      const reason         = product.aiReason
        || (product._isTrending ? `Trending in "${subjectName}" on AliExpress` : null)
        || (bestSeller ? `Similar to your best seller "${bestSeller}"` : `Found via search: "${product._sourceKeyword}"`);

      const { rows: insertedRows } = await query(
        `INSERT INTO products
           (user_id, subject_id, long_url, image, text, title, sort_order,
            sale_price, commission_rate, video_url, use_video, status, added_by,
            suggestion_reason, aliexpress_product_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft','auto_agent',$12,$13)
         RETURNING id`,
        [
          userId, subjectId, product.promotion_link,
          product.product_main_image_url || '',
          product.product_title, product.product_title,
          nextOrder++,
          salePrice, commissionRate, videoUrl, !!videoUrl,
          reason, String(product.product_id),
        ]
      );

      if (autoApprove) {
        try {
          await approveProduct(userId, insertedRows[0].id, null);
        } catch (err) {
          // Falls back to sitting as a normal draft for manual review — never
          // blocks the run.
          console.error(`[auto-agent] auto-approve failed for product ${insertedRows[0].id}: ${err.message}`);
        }
      }

      // Durable memory: recorded independently of the products row above, so it
      // survives that row later being deleted (e.g. cleanup of old sent products).
      await query(
        `INSERT INTO agent_suggestion_history (user_id, subject_id, aliexpress_product_id, title)
         VALUES ($1,$2,$3,$4)`,
        [userId, subjectId, String(product.product_id), product.product_title]
      );

      existingUrls.add(product.promotion_link);
      existingProductIds.add(String(product.product_id));
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
  approveProduct,
  MAX_DRAFTS_PER_SUBJECT_PER_DAY,
  DEFAULT_KEYWORD_PROMPT,
};
