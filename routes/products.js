const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { shortenUrl, getAllClickStats } = require('../services/spooMe');

const log = (...a) => console.log('[products]', ...a);

function rowToProduct(r, idx) {
  return {
    id:         r.id,
    row_number: idx + 2,   // simulate Google Sheets convention (header = row 1)
    long_url:   r.long_url    || '',
    Link:       r.short_link  || '',
    image:      r.image       || '',
    Text:       r.text        || '',
    join_link:  r.join_link   || '',
    wa_group:   r.wa_group    || '',
    sent:       r.sent_at     ? new Date(r.sent_at).toISOString()      : '',
    facebook:   r.facebook_at ? new Date(r.facebook_at).toISOString()  : '',
    instagram:  r.instagram_at? new Date(r.instagram_at).toISOString() : '',
    clicks:     r.clicks      ?? null,
    subject:    r.subject_id  || '',
    sort_order: r.sort_order,
    skip_ai:    r.skip_ai     || false,
    send_count: r.send_count  || 0,
  };
}

// GET /api/products — list (optional ?subject=id filter)
router.get('/', async (req, res) => {
  try {
    const { subject } = req.query;
    let rows;
    if (subject) {
      ({ rows } = await query(
        `SELECT * FROM products
         WHERE user_id = $1 AND subject_id = $2
           AND short_link IS NOT NULL AND short_link != ''
         ORDER BY sort_order ASC NULLS LAST, created_at ASC`,
        [req.user.id, subject]
      ));
    } else {
      ({ rows } = await query(
        `SELECT * FROM products
         WHERE user_id = $1
           AND short_link IS NOT NULL AND short_link != ''
         ORDER BY sort_order ASC NULLS LAST, created_at ASC`,
        [req.user.id]
      ));
    }
    res.json({ success: true, products: rows.map(rowToProduct) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products — add new product
router.post('/', async (req, res) => {
  const { Link, image, Text, subject, whatsappGroupId } = req.body;
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
         (user_id, subject_id, long_url, short_link, image, text, join_link, wa_group, whatsapp_group_id, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [req.user.id, subject || null, Link, shortLink, image || '', Text, join_link, wa_group, resolvedGroupId, maxRow[0].next_order]
    );
    res.json({ success: true, product: rowToProduct(rows[0], 0) });
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

// PUT /api/products/:id — edit text and/or skip_ai flag
router.put('/:id', async (req, res) => {
  const { Text, skip_ai } = req.body;
  if (Text === undefined && skip_ai === undefined) {
    return res.status(400).json({ success: false, error: 'Nothing to update' });
  }
  try {
    const updates = ['updated_at = NOW()'];
    const values  = [];
    let i = 1;
    if (Text !== undefined)    { updates.push(`text = $${i++}`);    values.push(Text); }
    if (skip_ai !== undefined) { updates.push(`skip_ai = $${i++}`); values.push(!!skip_ai); }
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

// POST /api/products/reorder — move a row to a new position
router.post('/reorder', async (req, res) => {
  const { fromRow, toRow } = req.body;
  if (!fromRow || !toRow || fromRow === toRow) {
    return res.status(400).json({ success: false, error: 'fromRow and toRow required and must differ' });
  }
  try {
    const { rows: products } = await query(
      `SELECT id, sort_order FROM products WHERE user_id = $1
       ORDER BY sort_order ASC NULLS LAST, created_at ASC`,
      [req.user.id]
    );
    const fromIdx = fromRow - 2;
    const toIdx   = toRow   - 2;
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= products.length || toIdx >= products.length) {
      return res.status(400).json({ success: false, error: 'Row out of range' });
    }
    const fromProduct = products[fromIdx];
    const toProduct   = products[toIdx];
    // Swap sort_orders (fall back to index if null)
    await query('UPDATE products SET sort_order = $1, updated_at = NOW() WHERE id = $2', [toProduct.sort_order ?? toIdx + 1, fromProduct.id]);
    await query('UPDATE products SET sort_order = $1, updated_at = NOW() WHERE id = $2', [fromProduct.sort_order ?? fromIdx + 1, toProduct.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
