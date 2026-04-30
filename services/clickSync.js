const { query } = require('../db');
const { getAllClickStats } = require('./spooMe');

// Fetches click stats from spoo.me once and updates all products + daily snapshots.
// Returns { synced } count.
async function syncAllClicks(logFn) {
  const log = logFn || (msg => console.log('[clickSync]', msg));

  log('Fetching click stats from spoo.me...');
  const clicks = await getAllClickStats();
  const total = Object.keys(clicks).length;
  log(`Got ${total} links from spoo.me`);
  if (!total) return { synced: 0 };

  const { rows: products } = await query(
    'SELECT id, user_id, short_link FROM products WHERE short_link IS NOT NULL AND short_link != \'\''
  );

  const today = new Date().toISOString().slice(0, 10);
  let synced = 0;

  for (const p of products) {
    const count = clicks[p.short_link];
    if (count === undefined) continue;
    await query(
      'UPDATE products SET clicks = $1, updated_at = NOW() WHERE id = $2',
      [count, p.id]
    );
    await query(
      `INSERT INTO product_click_snapshots (user_id, product_id, snapshot_date, total_clicks)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, snapshot_date) DO UPDATE SET total_clicks = EXCLUDED.total_clicks`,
      [p.user_id, p.id, today, count]
    );
    synced++;
  }

  log(`Synced ${synced} products`);
  return { synced };
}

// Syncs clicks for a single user and returns their updated products rows.
async function syncClicksForUser(userId, logFn) {
  const log = logFn || (msg => console.log('[clickSync]', msg));

  log('Fetching click stats from spoo.me...');
  const clicks = await getAllClickStats();
  log(`Got ${Object.keys(clicks).length} links from spoo.me`);

  const { rows: products } = await query(
    'SELECT id, short_link FROM products WHERE user_id = $1 AND short_link IS NOT NULL AND short_link != \'\'',
    [userId]
  );

  const today = new Date().toISOString().slice(0, 10);
  let synced = 0;

  for (const p of products) {
    const count = clicks[p.short_link];
    if (count === undefined) continue;
    await query('UPDATE products SET clicks = $1, updated_at = NOW() WHERE id = $2', [count, p.id]);
    await query(
      `INSERT INTO product_click_snapshots (user_id, product_id, snapshot_date, total_clicks)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, snapshot_date) DO UPDATE SET total_clicks = EXCLUDED.total_clicks`,
      [userId, p.id, today, count]
    );
    synced++;
  }

  log(`Synced ${synced} rows`);
  return { synced };
}

module.exports = { syncAllClicks, syncClicksForUser };
