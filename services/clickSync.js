const { query } = require('../db');
const { getAllClickStats } = require('./spooMe');

// ── Shared helpers ──────────────────────────────────────────────────────────

async function _snapshotRows(table, idCol, rows, clicks, today) {
  let synced = 0;
  for (const r of rows) {
    const link = r.short_link || r.join_link;
    if (!link) continue;
    const count = clicks[link] ?? clicks[link.replace(/\/$/, '')] ?? undefined;
    if (count === undefined) continue;

    // Update the canonical clicks column where it exists
    if (table === 'products') {
      await query('UPDATE products SET clicks = $1, updated_at = NOW() WHERE id = $2', [count, r.id]);
    }

    await query(
      `INSERT INTO ${table}_click_snapshots (user_id, ${idCol}, snapshot_date, total_clicks)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (${idCol}, snapshot_date) DO UPDATE SET total_clicks = EXCLUDED.total_clicks`,
      [r.user_id, r.id, today, count]
    );
    synced++;
  }
  return synced;
}

// ── syncAllClicks ────────────────────────────────────────────────────────────
// Fetches spoo.me stats once and syncs products, join links, and broadcasts
// for all users. Called by the nightly cron job.
async function syncAllClicks(logFn) {
  const log = logFn || (msg => console.log('[clickSync]', msg));

  log('Fetching click stats from spoo.me...');
  const clicks = await getAllClickStats();
  const total = Object.keys(clicks).length;
  log(`Got ${total} links from spoo.me`);
  if (!total) return { products: 0, joinLinks: 0, broadcasts: 0 };

  const today = new Date().toISOString().slice(0, 10);

  // Products
  const { rows: products } = await query(
    'SELECT id, user_id, short_link FROM products WHERE short_link IS NOT NULL AND short_link != \'\''
  );
  const productsSynced = await _snapshotRows('product', 'product_id', products, clicks, today);

  // Join links (whatsapp_groups.join_link holds the spoo.me URL)
  const { rows: groups } = await query(
    'SELECT id, user_id, join_link AS short_link FROM whatsapp_groups WHERE join_link LIKE \'%spoo.me%\''
  );
  const joinSynced = await _snapshotRows('join_link', 'group_id', groups, clicks, today);

  // Broadcasts
  const { rows: broadcasts } = await query(
    'SELECT id, user_id, short_link FROM broadcast_messages WHERE short_link IS NOT NULL AND short_link != \'\''
  );
  const broadcastSynced = await _snapshotRows('broadcast', 'broadcast_id', broadcasts, clicks, today);

  log(`Synced — products: ${productsSynced}, join links: ${joinSynced}, broadcasts: ${broadcastSynced}`);
  return { products: productsSynced, joinLinks: joinSynced, broadcasts: broadcastSynced };
}

// ── syncClicksForUser ────────────────────────────────────────────────────────
// Same as syncAllClicks but scoped to a single user. Used by the manual
// sync-clicks route so we only touch that user's data.
async function syncClicksForUser(userId, logFn) {
  const log = logFn || (msg => console.log('[clickSync]', msg));

  log('Fetching click stats from spoo.me...');
  const clicks = await getAllClickStats();
  log(`Got ${Object.keys(clicks).length} links from spoo.me`);

  const today = new Date().toISOString().slice(0, 10);

  const { rows: products } = await query(
    'SELECT id, user_id, short_link FROM products WHERE user_id = $1 AND short_link IS NOT NULL AND short_link != \'\'',
    [userId]
  );
  const productsSynced = await _snapshotRows('product', 'product_id', products, clicks, today);

  const { rows: groups } = await query(
    'SELECT id, user_id, join_link AS short_link FROM whatsapp_groups WHERE user_id = $1 AND join_link LIKE \'%spoo.me%\'',
    [userId]
  );
  const joinSynced = await _snapshotRows('join_link', 'group_id', groups, clicks, today);

  const { rows: broadcasts } = await query(
    'SELECT id, user_id, short_link FROM broadcast_messages WHERE user_id = $1 AND short_link IS NOT NULL AND short_link != \'\'',
    [userId]
  );
  const broadcastSynced = await _snapshotRows('broadcast', 'broadcast_id', broadcasts, clicks, today);

  log(`Synced — products: ${productsSynced}, join links: ${joinSynced}, broadcasts: ${broadcastSynced}`);
  return { synced: productsSynced + joinSynced + broadcastSynced, productsSynced, joinSynced, broadcastSynced };
}

module.exports = { syncAllClicks, syncClicksForUser };
