const express = require('express');
const router  = express.Router();
const { query }       = require('../db');
const { signAndCall } = require('../services/aliexpressApi');
const workflow        = require('../services/workflow');

// Fetch one page of orders from AliExpress for a given tracking_id + date range.
// Returns { orders: [...], hasMore: bool, totalPages: N }
async function fetchOrderPage(trackingId, startTime, endTime, pageNo) {
  const res = await signAndCall({
    method:       'aliexpress.affiliate.order.list',
    start_time:   startTime,
    end_time:     endTime,
    tracking_id:  trackingId,
    page_no:      String(pageNo),
    page_size:    '50',
  });

  const root = res.data?.aliexpress_affiliate_order_list_response?.resp_result;
  if (!root || root.resp_code !== 200) {
    const msg = root?.resp_msg || 'AliExpress order API error';
    throw new Error(msg);
  }

  const result     = root.result || {};
  const orders     = result.orders?.order || [];
  const totalPages = parseInt(result.total_page_no || result.page_no || 1, 10);

  return { orders, hasMore: pageNo < totalPages, totalPages };
}

// POST /api/analytics/sync-commissions
// Body: { startDate?, endDate? }  (ISO dates, defaults to last 30 days)
router.post('/sync-commissions', async (req, res) => {
  try {
    const userId = req.user.id;

    // Date range
    const now      = new Date();
    const defStart = new Date(now);
    defStart.setDate(defStart.getDate() - 30);

    const startDate = req.body.startDate ? new Date(req.body.startDate) : defStart;
    const endDate   = req.body.endDate   ? new Date(req.body.endDate)   : now;

    // Format: "yyyy-MM-dd HH:mm:ss"
    const fmt = d => d.toISOString().replace('T', ' ').slice(0, 19);
    const startTime = fmt(startDate);
    const endTime   = fmt(endDate);

    // Get all subjects with an aliexpress_tracking_id for this user
    const { rows: subjects } = await query(
      `SELECT id, name, aliexpress_tracking_id FROM subjects
       WHERE user_id = $1 AND aliexpress_tracking_id IS NOT NULL AND aliexpress_tracking_id != ''`,
      [userId]
    );

    if (!subjects.length) {
      return res.json({ success: true, synced: 0, skipped: 0, subjects: [], message: 'אין נישות עם tracking ID מוגדר' });
    }

    let totalSynced = 0;
    const results = [];

    for (const subject of subjects) {
      const { id: subjectId, name: subjectName, aliexpress_tracking_id: trackingId } = subject;
      let synced = 0;
      let pageNo = 1;

      try {
        workflow.log(`Analytics: fetching AliExpress orders for "${subjectName}" (${trackingId})`);

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { orders, hasMore } = await fetchOrderPage(trackingId, startTime, endTime, pageNo);

          for (const order of orders) {
            const orderId       = String(order.order_id || '');
            const orderAmount   = parseFloat(order.order_amount)   || null;
            const commissionPct = parseFloat(order.commission_rate) / 100 || null;
            // AliExpress may call it estimated_commission or settlement_amount
            const commissionUsd = parseFloat(order.estimated_commission ?? order.settlement_amount ?? order.commission) || null;
            const orderStatus   = order.order_status  || null;
            const paymentStatus = order.payment_status || null;
            const orderTime     = order.order_time || order.paid_time || null;

            if (!orderId) continue;

            await query(
              `INSERT INTO commission_snapshots
                 (user_id, subject_id, tracking_id, order_id, order_amount,
                  commission_rate, commission_usd, order_status, payment_status, order_time)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               ON CONFLICT (user_id, order_id) DO UPDATE SET
                 commission_usd  = EXCLUDED.commission_usd,
                 order_status    = EXCLUDED.order_status,
                 payment_status  = EXCLUDED.payment_status,
                 fetched_at      = NOW()`,
              [userId, subjectId, trackingId, orderId, orderAmount,
               commissionPct, commissionUsd, orderStatus, paymentStatus,
               orderTime ? new Date(orderTime) : null]
            );
            synced++;
          }

          if (!hasMore) break;
          pageNo++;
          // Polite rate-limiting
          await new Promise(r => setTimeout(r, 400));
        }

        workflow.log(`Analytics: synced ${synced} orders for "${subjectName}"`);
        results.push({ subjectId, subjectName, synced, error: null });
        totalSynced += synced;
      } catch (err) {
        workflow.log(`Analytics: error fetching orders for "${subjectName}": ${err.message}`, 'warn');
        results.push({ subjectId, subjectName, synced, error: err.message });
      }
    }

    res.json({ success: true, synced: totalSynced, subjects: results });
  } catch (err) {
    workflow.log(`Analytics sync error: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/analytics/summary
// Returns per-niche commission aggregation joined with click data
router.get('/summary', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         s.id,
         s.name,
         s.color,
         s.aliexpress_tracking_id                                  AS tracking_id,
         COUNT(DISTINCT p.id)                                       AS total_products,
         COUNT(DISTINCT CASE WHEN p.sent_at IS NOT NULL THEN p.id END) AS sent_count,
         COALESCE(SUM(p.clicks), 0)                                AS total_clicks,
         COUNT(DISTINCT cs.order_id)                               AS total_orders,
         COALESCE(SUM(cs.order_amount), 0)                         AS total_order_value,
         COALESCE(SUM(cs.commission_usd), 0)                       AS total_commission,
         COALESCE(SUM(
           CASE WHEN cs.payment_status = 'confirmed' OR cs.order_status = 'finished'
           THEN cs.commission_usd ELSE 0 END
         ), 0)                                                      AS confirmed_commission,
         MAX(cs.fetched_at)                                         AS last_synced
       FROM subjects s
       LEFT JOIN products p             ON p.subject_id = s.id AND p.user_id = $1
       LEFT JOIN commission_snapshots cs ON cs.subject_id = s.id AND cs.user_id = $1
       WHERE s.user_id = $1
       GROUP BY s.id, s.name, s.color, s.aliexpress_tracking_id
       ORDER BY total_commission DESC, total_clicks DESC`,
      [req.user.id]
    );
    res.json({ success: true, niches: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/analytics/orders?subjectId=
// Returns raw commission_snapshots rows for a niche (or all)
router.get('/orders', async (req, res) => {
  try {
    const { subjectId } = req.query;
    const params = [req.user.id];
    let subjectFilter = '';
    if (subjectId) {
      params.push(subjectId);
      subjectFilter = 'AND cs.subject_id = $2';
    }

    const { rows } = await query(
      `SELECT
         cs.order_id, cs.tracking_id, cs.order_amount,
         cs.commission_rate, cs.commission_usd,
         cs.order_status, cs.payment_status, cs.order_time,
         s.name AS subject_name, s.color AS subject_color
       FROM commission_snapshots cs
       JOIN subjects s ON s.id = cs.subject_id
       WHERE cs.user_id = $1 ${subjectFilter}
       ORDER BY cs.order_time DESC NULLS LAST
       LIMIT 200`,
      params
    );
    res.json({ success: true, orders: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/analytics/top-products?subjectId=
// Products ranked by estimated revenue: clicks × conversion_rate × sale_price × commission_rate
// Falls back to 2% conversion when the niche has no real orders yet.
router.get('/top-products', async (req, res) => {
  try {
    const { subjectId } = req.query;
    const params = [req.user.id];
    let subjectFilter = '';
    if (subjectId) {
      params.push(subjectId);
      subjectFilter = 'AND p.subject_id = $2';
    }

    const { rows } = await query(
      `WITH niche_conv AS (
         SELECT
           cs.subject_id,
           CASE WHEN SUM(p2.clicks) > 0
             THEN COUNT(DISTINCT cs.order_id)::numeric / NULLIF(SUM(p2.clicks), 0)
             ELSE 0.02 END AS conversion_rate
         FROM commission_snapshots cs
         JOIN products p2 ON p2.subject_id = cs.subject_id AND p2.user_id = cs.user_id
         WHERE cs.user_id = $1
         GROUP BY cs.subject_id
       )
       SELECT
         p.id,
         p.text,
         p.short_link,
         p.image,
         p.clicks,
         p.sale_price,
         p.commission_rate,
         p.sent_at,
         s.name  AS subject_name,
         s.color AS subject_color,
         COALESCE(nc.conversion_rate, 0.02) AS conversion_rate,
         CASE WHEN p.sale_price IS NOT NULL AND p.clicks > 0
           THEN ROUND(
             p.clicks
             * COALESCE(nc.conversion_rate, 0.02)
             * p.sale_price
             * COALESCE(p.commission_rate, 0.08),
           2)
           ELSE NULL END AS estimated_revenue
       FROM products p
       LEFT JOIN subjects s       ON s.id = p.subject_id
       LEFT JOIN niche_conv nc    ON nc.subject_id = p.subject_id
       WHERE p.user_id = $1
         AND p.sale_price IS NOT NULL
         ${subjectFilter}
       ORDER BY estimated_revenue DESC NULLS LAST
       LIMIT 50`,
      params
    );
    res.json({ success: true, products: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/analytics/timing?subjectId=
// Per-hour/day aggregation of avg clicks for sent products (Asia/Jerusalem timezone).
router.get('/timing', async (req, res) => {
  try {
    const { subjectId } = req.query;
    const params = [req.user.id, subjectId || null];

    const { rows } = await query(
      `SELECT
         EXTRACT(DOW  FROM sent_at AT TIME ZONE 'Asia/Jerusalem')::int AS dow,
         EXTRACT(HOUR FROM sent_at AT TIME ZONE 'Asia/Jerusalem')::int AS hour,
         COUNT(*)                        AS sends,
         COALESCE(SUM(clicks),  0)       AS total_clicks,
         COALESCE(AVG(clicks),  0)       AS avg_clicks
       FROM products
       WHERE user_id = $1
         AND sent_at IS NOT NULL
         AND ($2::uuid IS NULL OR subject_id = $2)
       GROUP BY dow, hour
       ORDER BY avg_clicks DESC`,
      params
    );
    res.json({ success: true, slots: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
