const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { shortenUrl, getAllClickStats } = require('../services/spooMe');
const { runAutoProductAgent, DEFAULT_KEYWORD_PROMPT } = require('../services/autoProductAgent');

const log = (...a) => console.log('[products]', ...a);

function rowToProduct(r, idx) {
  return {
    id:         r.id,
    row_number: idx + 2,   // simulate Google Sheets convention (header = row 1)
    long_url:   r.long_url    || '',
    Link:       r.short_link  || '',
    image:      r.image       || '',
    title:      r.title       || '',
    Text:       r.text        || '',
    join_link:  r.join_link   || '',
    wa_group:   r.wa_group    || '',
    sent:       r.sent_at     ? new Date(r.sent_at).toISOString()      : '',
    facebook:   r.facebook_at ? new Date(r.facebook_at).toISOString()  : '',
    instagram:  r.instagram_at? new Date(r.instagram_at).toISOString() : '',
    clicks:     r.clicks      ?? null,
    subject:    r.subject_id  || '',
    sort_order: r.sort_order,
    skip_ai:         r.skip_ai        || false,
    send_count:      r.send_count     || 0,
    sale_price:      r.sale_price     != null ? parseFloat(r.sale_price) : null,
    commission_rate: r.commission_rate != null ? parseFloat(r.commission_rate) : null,
    video_url:         r.video_url         || '',
    use_video:         r.use_video         || false,
    affiliate_provider:   r.affiliate_provider   || 'aliexpress',
    affiliate_source_id:  r.affiliate_source_id  || null,
    affiliate_source_name: r.affiliate_source_name || null,
    status:     r.status   || 'active',
    added_by:   r.added_by || 'manual',
    suggestion_reason: r.suggestion_reason || '',
  };
}

// GET /api/products — list (optional ?subject=id filter, optional ?status=draft
// to list products the auto-agent added that are still awaiting approval)
router.get('/', async (req, res) => {
  try {
    const { subject, status } = req.query;
    const srcJoin = `LEFT JOIN affiliate_sources afs ON afs.id = p.affiliate_source_id`;
    const srcCols = `p.*, afs.name AS affiliate_source_name`;

    if (status === 'draft') {
      const params = [req.user.id];
      let subjectFilter = '';
      if (subject) { params.push(subject); subjectFilter = 'AND p.subject_id = $2'; }
      const { rows } = await query(
        `SELECT ${srcCols}, s.name AS subject_name FROM products p ${srcJoin}
         LEFT JOIN subjects s ON s.id = p.subject_id
         WHERE p.user_id = $1 AND p.status = 'draft' ${subjectFilter}
         ORDER BY p.created_at DESC`,
        params
      );
      return res.json({
        success:  true,
        products: rows.map((r, i) => ({ ...rowToProduct(r, i), subject_name: r.subject_name || '' })),
      });
    }

    let rows;
    if (subject) {
      ({ rows } = await query(
        `SELECT ${srcCols} FROM products p ${srcJoin}
         WHERE p.user_id = $1 AND p.subject_id = $2 AND p.status = 'active'
           AND p.short_link IS NOT NULL AND p.short_link != ''
         ORDER BY p.sort_order ASC NULLS LAST, p.created_at ASC`,
        [req.user.id, subject]
      ));
    } else {
      ({ rows } = await query(
        `SELECT ${srcCols} FROM products p ${srcJoin}
         WHERE p.user_id = $1 AND p.status = 'active'
           AND p.short_link IS NOT NULL AND p.short_link != ''
         ORDER BY p.sort_order ASC NULLS LAST, p.created_at ASC`,
        [req.user.id]
      ));
    }
    res.json({ success: true, products: rows.map(rowToProduct) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products/run-auto-agent — trigger the autonomous product agent immediately
// (same logic the daily cron runs). Always runs regardless of the auto_agent_enabled
// toggle — that setting only pauses the *scheduled* run, not a manual click.
router.post('/run-auto-agent', async (req, res) => {
  try {
    const result = await runAutoProductAgent(req.user.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/products/auto-agent-settings — enabled state + AI decision-making settings
router.get('/auto-agent-settings', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT key, value FROM settings WHERE user_id = $1
       AND key IN ('auto_agent_enabled', 'auto_agent_ai_enabled', 'auto_agent_ai_prompt')`,
      [req.user.id]
    );
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({
      success:       true,
      // Both default ON (opt-out) — absence of the setting means enabled
      enabled:       map.auto_agent_enabled !== 'false',
      aiEnabled:     map.auto_agent_ai_enabled === 'true',
      aiPrompt:      map.auto_agent_ai_prompt || '',
      defaultPrompt: DEFAULT_KEYWORD_PROMPT,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/products/auto-agent-settings
router.patch('/auto-agent-settings', async (req, res) => {
  const { enabled, aiEnabled, aiPrompt } = req.body || {};
  try {
    const upsert = (key, value) => query(
      `INSERT INTO settings (user_id, key, value, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
      [req.user.id, key, value]
    );
    if (enabled   !== undefined) await upsert('auto_agent_enabled', enabled ? 'true' : 'false');
    if (aiEnabled !== undefined) await upsert('auto_agent_ai_enabled', aiEnabled ? 'true' : 'false');
    if (aiPrompt  !== undefined) await upsert('auto_agent_ai_prompt', aiPrompt);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/products/auto-agent-stats — compares auto_agent-added vs manually-added
// products (lifecycle counts + performance) so it's visible whether the agent is
// actually adding things worth keeping.
router.get('/auto-agent-stats', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         p.added_by,
         COUNT(*) FILTER (WHERE p.status = 'active')   AS active_count,
         COUNT(*) FILTER (WHERE p.status = 'draft')    AS draft_count,
         COUNT(*) FILTER (WHERE p.status = 'rejected') AS rejected_count,
         COALESCE(AVG(p.clicks) FILTER (WHERE p.status = 'active'), 0) AS avg_clicks,
         COALESCE(SUM(sales.order_count), 0) AS total_orders
       FROM products p
       LEFT JOIN LATERAL (
         SELECT COUNT(DISTINCT oi.order_id) AS order_count
         FROM order_items oi
         WHERE oi.user_id = p.user_id AND oi.subject_id = p.subject_id
           AND p.long_url IS NOT NULL AND p.long_url LIKE '%' || oi.product_id || '%'
       ) sales ON p.status = 'active'
       WHERE p.user_id = $1
       GROUP BY p.added_by`,
      [req.user.id]
    );
    const stats = rows.map(r => ({
      added_by:       r.added_by,
      active_count:   parseInt(r.active_count, 10),
      draft_count:    parseInt(r.draft_count, 10),
      rejected_count: parseInt(r.rejected_count, 10),
      avg_clicks:     parseFloat(r.avg_clicks),
      total_orders:   parseInt(r.total_orders, 10),
    }));
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/products/:id/approve — approve a draft: resolve a WhatsApp group,
// generate its short link (deferred until now so rejected drafts never waste
// a spoo.me link), and flip it to 'active' so it enters the normal send rotation.
// Body: { whatsappGroupId? } — falls back to the subject's first group if omitted.
router.patch('/:id/approve', async (req, res) => {
  const { whatsappGroupId } = req.body || {};
  try {
    const { rows: draftRows } = await query(
      `SELECT * FROM products WHERE id = $1 AND user_id = $2 AND status = 'draft'`,
      [req.params.id, req.user.id]
    );
    const draft = draftRows[0];
    if (!draft) return res.status(404).json({ success: false, error: 'Draft not found' });

    let wa_group = '', join_link = '', resolvedGroupId = whatsappGroupId || null;
    if (whatsappGroupId) {
      const { rows: grp } = await query(
        'SELECT wa_group, join_link FROM whatsapp_groups WHERE id = $1 AND user_id = $2',
        [whatsappGroupId, req.user.id]
      );
      if (grp[0]) { wa_group = grp[0].wa_group; join_link = grp[0].join_link || ''; }
    } else if (draft.subject_id) {
      const { rows: grp } = await query(
        `SELECT id, wa_group, join_link FROM whatsapp_groups
         WHERE subject_id = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT 1`,
        [draft.subject_id, req.user.id]
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
      [shortLink, wa_group, join_link, resolvedGroupId, req.params.id, req.user.id]
    );
    res.json({ success: true, product: rowToProduct(updated[0], 0) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/products/:id/reject — decline a draft. Kept (not deleted) with
// status='rejected' so the auto-agent remembers not to re-suggest it.
router.patch('/:id/reject', async (req, res) => {
  try {
    const { rowCount } = await query(
      `UPDATE products SET status = 'rejected', updated_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'draft'`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Draft not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products — add new product
router.post('/', async (req, res) => {
  const { Link, image, Text, subject, whatsappGroupId, affiliateProvider } = req.body;
  if (!Link || !Text) return res.status(400).json({ success: false, error: 'Link and Text are required' });
  try {
    // Resolve wa_group and join_link from whatsapp_group FK if provided
    let wa_group = '', join_link = '', resolvedGroupId = whatsappGroupId || null;
    if (whatsappGroupId) {
      const { rows: grp } = await query(
        'SELECT wa_group, join_link FROM whatsapp_groups WHERE id = $1 AND user_id = $2',
        [whatsappGroupId, req.user.id]
      );
      if (grp[0]) { wa_group = grp[0].wa_group; join_link = grp[0].join_link || ''; }
    }

    const shortLink = await shortenUrl(Link);
    const { rows: maxRow } = await query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM products WHERE user_id = $1',
      [req.user.id]
    );
    const { rows } = await query(
      `INSERT INTO products
         (user_id, subject_id, long_url, short_link, image, text, join_link, wa_group, whatsapp_group_id, sort_order, affiliate_provider)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [req.user.id, subject || null, Link, shortLink, image || '', Text, join_link, wa_group, resolvedGroupId, maxRow[0].next_order, affiliateProvider || 'manual']
    );
    res.json({ success: true, product: rowToProduct(rows[0], 0) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/products/batch — bulk delete by ids array
// Body: { ids: string[] }
router.delete('/batch', async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ success: false, error: 'ids array required' });
  }
  try {
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');
    const { rowCount } = await query(
      `DELETE FROM products WHERE user_id = $1 AND id IN (${placeholders})`,
      [req.user.id, ...ids]
    );
    res.json({ success: true, deleted: rowCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/products/:id — remove a product
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await query(
      'DELETE FROM products WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Product not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/products/:id — edit text, skip_ai flag, and/or use_video toggle
router.put('/:id', async (req, res) => {
  const { Text, skip_ai, use_video } = req.body;
  if (Text === undefined && skip_ai === undefined && use_video === undefined) {
    return res.status(400).json({ success: false, error: 'Nothing to update' });
  }
  try {
    const updates = ['updated_at = NOW()'];
    const values  = [];
    let i = 1;
    if (Text !== undefined)      { updates.push(`text = $${i++}`);      values.push(Text); }
    if (skip_ai !== undefined)   { updates.push(`skip_ai = $${i++}`);   values.push(!!skip_ai); }
    if (use_video !== undefined) { updates.push(`use_video = $${i++}`); values.push(!!use_video); }
    values.push(req.params.id, req.user.id);
    const { rows } = await query(
      `UPDATE products SET ${updates.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Product not found' });
    res.json({ success: true, product: rowToProduct(rows[0], 0) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products/:id/unsend — reset sent_at so product appears unsent again
router.post('/:id/unsend', async (req, res) => {
  try {
    const { rowCount } = await query(
      `UPDATE products SET sent_at = NULL, facebook_at = NULL, instagram_at = NULL, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Product not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products/sync-clicks — fetch click counts from spoo.me and update DB
router.post('/sync-clicks', async (req, res) => {
  try {
    log('Fetching click stats from spoo.me...');
    const clicks = await getAllClickStats();
    log(`Got ${Object.keys(clicks).length} links from spoo.me`);

    const { rows: products } = await query(
      'SELECT id, short_link FROM products WHERE user_id = $1 AND short_link IS NOT NULL',
      [req.user.id]
    );

    let synced = 0;
    for (const p of products) {
      if (clicks[p.short_link] !== undefined) {
        await query('UPDATE products SET clicks = $1, updated_at = NOW() WHERE id = $2', [clicks[p.short_link], p.id]);
        synced++;
      }
    }
    log(`Synced ${synced} rows`);

    const { rows } = await query(
      `SELECT * FROM products WHERE user_id = $1
         AND short_link IS NOT NULL AND short_link != ''
       ORDER BY sort_order ASC NULLS LAST, created_at ASC`,
      [req.user.id]
    );
    res.json({ success: true, synced, products: rows.map(rowToProduct) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products/shorten-all — convert all product links to spoo.me short links
router.post('/shorten-all', async (req, res) => {
  try {
    const [{ rows: products }, accountClicks] = await Promise.all([
      query('SELECT * FROM products WHERE user_id = $1', [req.user.id]),
      getAllClickStats(),
    ]);

    let converted = 0, skipped = 0;
    for (const p of products) {
      if (p.short_link && accountClicks[p.short_link] !== undefined) { skipped++; continue; }
      const source = p.long_url;
      if (!source) { skipped++; continue; }
      try { new URL(source); } catch { skipped++; continue; }
      const shortLink = await shortenUrl(source);
      if (shortLink !== source) {
        await query('UPDATE products SET short_link = $1, updated_at = NOW() WHERE id = $2', [shortLink, p.id]);
        converted++;
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    res.json({ success: true, converted, skipped });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products/shuffle — randomise the sending order
router.post('/shuffle', async (req, res) => {
  const { subject } = req.body;
  try {
    // Fetch the products to shuffle (scoped to subject if provided)
    const params = subject ? [req.user.id, subject] : [req.user.id];
    const whereClause = subject
      ? 'WHERE user_id = $1 AND subject_id = $2'
      : 'WHERE user_id = $1';
    const { rows: products } = await query(
      `SELECT id FROM products ${whereClause} ORDER BY RANDOM()`,
      params
    );
    // Fetch all products for the user to determine the global sort_order baseline
    // Products outside the shuffled scope keep their sort_orders; we slot shuffled
    // products into the same positions they occupied before.
    const { rows: allOrdered } = await query(
      `SELECT id, sort_order FROM products WHERE user_id = $1
       ORDER BY sort_order ASC NULLS LAST, created_at ASC`,
      [req.user.id]
    );
    // Map each shuffled product id to a new sort_order drawn from the positions
    // that those products held in the global ordered list.
    const targetIds = new Set(products.map(p => p.id));
    const slots = allOrdered
      .filter(p => targetIds.has(p.id))
      .map((p, i) => i + 1); // relative slot numbers within the scope

    // Assign shuffled products to those slots in the global numbering
    const slotValues = allOrdered
      .filter(p => targetIds.has(p.id))
      .map(p => p.sort_order ?? allOrdered.indexOf(p) + 1);

    await Promise.all(
      products.map((p, i) =>
        query('UPDATE products SET sort_order = $1, updated_at = NOW() WHERE id = $2',
          [slotValues[i], p.id])
      )
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products/reorder — move a product to a new position
router.post('/reorder', async (req, res) => {
  const { fromId, toId } = req.body;
  if (!fromId || !toId || fromId === toId) {
    return res.status(400).json({ success: false, error: 'fromId and toId required and must differ' });
  }
  try {
    const { rows: products } = await query(
      `SELECT id, sort_order FROM products WHERE user_id = $1
       ORDER BY sort_order ASC NULLS LAST, created_at ASC`,
      [req.user.id]
    );
    const fromIdx = products.findIndex(p => p.id === fromId);
    const toIdx   = products.findIndex(p => p.id === toId);
    if (fromIdx === -1 || toIdx === -1) {
      return res.status(400).json({ success: false, error: 'Product not found' });
    }
    // Remove the dragged item and re-insert at the target position.
    // When dragging down (fromIdx < toIdx): insert AFTER target → splice at toIdx
    // When dragging up   (fromIdx > toIdx): insert BEFORE target → splice at toIdx
    // In both cases the correct insert index in the post-splice array is toIdx.
    const [moved] = products.splice(fromIdx, 1);
    products.splice(toIdx, 0, moved);
    // Renumber all sort_orders 1..n so they stay compact and correct
    await Promise.all(
      products.map((p, i) =>
        query('UPDATE products SET sort_order = $1, updated_at = NOW() WHERE id = $2', [i + 1, p.id])
      )
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
