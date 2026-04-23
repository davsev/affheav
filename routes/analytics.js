const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { query }       = require('../db');
const { signAndCall } = require('../services/aliexpressApi');
const workflow        = require('../services/workflow');

// Fetch one page of orders from AliExpress for a given tracking_id + date range + status.
// Returns { orders: [...], hasMore: bool, totalPages: N }
async function fetchOrderPage(trackingId, startTime, endTime, pageNo, status) {
  const res = await signAndCall({
    method:       'aliexpress.affiliate.order.list',
    start_time:   startTime,
    end_time:     endTime,
    tracking_id:  trackingId,
    status,
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

    // AliExpress requires status to be specified — fetch all three
    const ORDER_STATUSES = ['Payment Completed', 'Buyer Confirmed Receipt', 'Settled'];

    for (const subject of subjects) {
      const { id: subjectId, name: subjectName, aliexpress_tracking_id: trackingId } = subject;
      let synced = 0;

      try {
        workflow.log(`Analytics: fetching AliExpress orders for "${subjectName}" (${trackingId})`);

        for (const status of ORDER_STATUSES) {
          let pageNo = 1;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { orders, hasMore } = await fetchOrderPage(trackingId, startTime, endTime, pageNo, status);

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

              // Save per-product line items when the API includes them
              const items = order.order_items?.order_item || [];
              for (const item of items) {
                const pid       = String(item.product_id || '');
                const ptitle    = item.product_title || item.product_name || null;
                const icount    = parseInt(item.item_count ?? item.quantity ?? 0, 10) || null;
                const iamount   = parseFloat(item.order_amount) || null;
                const icommRate = item.commission_rate ? parseFloat(item.commission_rate) / 100 : null;
                const icommUsd  = parseFloat(item.estimated_commission ?? item.commission ?? 0) || null;
                if (!pid) continue;
                await query(
                  `INSERT INTO order_items
                     (user_id, subject_id, order_id, product_id, product_title,
                      item_count, order_amount, commission_rate, commission_usd)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                   ON CONFLICT (user_id, order_id, product_id) DO UPDATE SET
                     product_title  = EXCLUDED.product_title,
                     commission_usd = EXCLUDED.commission_usd,
                     fetched_at     = NOW()`,
                  [userId, subjectId, orderId, pid, ptitle, icount, iamount, icommRate, icommUsd]
                );
              }
            }

            if (!hasMore) break;
            pageNo++;
            await new Promise(r => setTimeout(r, 400));
          }
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
// Products ranked by real attributed commission:
//   attributed = product_clicks × (niche_real_commission / niche_total_clicks)
// Falls back to estimated model (clicks × conversion × price × commission_rate)
// only for niches that have no real order data yet.
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
      `WITH niche_perf AS (
         SELECT
           cs.subject_id,
           COALESCE(SUM(cs.commission_usd), 0)           AS niche_commission,
           AVG(NULLIF(cs.commission_rate, 0))             AS avg_commission_rate,
           COALESCE(SUM(p2.clicks), 0)                   AS niche_clicks,
           CASE WHEN SUM(p2.clicks) > 0
             THEN SUM(cs.commission_usd) / NULLIF(SUM(p2.clicks), 0)
             ELSE NULL END                                AS commission_per_click
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
         p.send_count,
         p.sent_at,
         s.name  AS subject_name,
         s.color AS subject_color,
         np.commission_per_click,
         np.niche_commission,
         np.niche_clicks,
         np.avg_commission_rate,
         CASE WHEN np.commission_per_click IS NOT NULL AND p.clicks > 0
           THEN ROUND(p.clicks * np.commission_per_click, 4)
           ELSE NULL END                                  AS attributed_commission
       FROM products p
       LEFT JOIN subjects s      ON s.id = p.subject_id
       LEFT JOIN niche_perf np   ON np.subject_id = p.subject_id
       WHERE p.user_id = $1 ${subjectFilter}
         AND p.clicks > 0
         AND np.commission_per_click IS NOT NULL
       ORDER BY attributed_commission DESC NULLS LAST
       LIMIT 50`,
      params
    );
    res.json({ success: true, products: rows, real: rows.length > 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/analytics/suggested-products
// Products worth republishing: ranked by attributed commission per send.
// Products that earned the most per posting historically are the best candidates.
router.get('/suggested-products', async (req, res) => {
  try {
    const { rows } = await query(
      `WITH niche_perf AS (
         SELECT
           cs.subject_id,
           CASE WHEN SUM(p2.clicks) > 0
             THEN SUM(cs.commission_usd) / NULLIF(SUM(p2.clicks), 0)
             ELSE NULL END AS commission_per_click
         FROM commission_snapshots cs
         JOIN products p2 ON p2.subject_id = cs.subject_id AND p2.user_id = cs.user_id
         WHERE cs.user_id = $1
         GROUP BY cs.subject_id
       )
       SELECT
         p.id,
         p.text,
         p.image,
         p.short_link,
         p.clicks,
         p.sale_price,
         COALESCE(p.send_count, 1)           AS send_count,
         p.sent_at,
         s.name  AS subject_name,
         s.color AS subject_color,
         np.commission_per_click,
         ROUND(p.clicks * np.commission_per_click, 4)  AS attributed_commission,
         ROUND(p.clicks * np.commission_per_click
               / NULLIF(COALESCE(p.send_count, 1), 0), 4) AS commission_per_send,
         NOW() - p.sent_at                   AS age
       FROM products p
       LEFT JOIN subjects s    ON s.id = p.subject_id
       LEFT JOIN niche_perf np ON np.subject_id = p.subject_id
       WHERE p.user_id = $1
         AND p.sent_at IS NOT NULL
         AND p.clicks > 0
         AND np.commission_per_click IS NOT NULL
       ORDER BY commission_per_send DESC NULLS LAST
       LIMIT 30`,
      [req.user.id]
    );
    res.json({ success: true, products: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch reach + impressions for a single Meta post/media via the Graph API Insights endpoint.
async function fetchMetaInsights(mediaId, accessToken, platform) {
  const metric = platform === 'instagram' ? 'reach,impressions' : 'post_impressions,post_reach';
  const { data } = await axios.get(
    `https://graph.facebook.com/v18.0/${encodeURIComponent(mediaId)}/insights`,
    { params: { metric, access_token: accessToken, period: 'lifetime' } }
  );
  const vals = {};
  for (const d of (data.data || [])) vals[d.name] = d.values?.[0]?.value ?? 0;
  return {
    reach:       vals.reach       ?? vals.post_reach        ?? 0,
    impressions: vals.impressions ?? vals.post_impressions   ?? 0,
  };
}

// POST /api/analytics/sync-reach
// Fetches reach + impressions for all products that have a Meta post/media ID stored.
router.post('/sync-reach', async (req, res) => {
  const userId = req.user.id;

  const { rows: products } = await query(
    `SELECT p.id, p.fb_post_id, p.ig_media_id, p.subject_id,
            s.facebook_token, s.instagram_account_id
     FROM products p
     LEFT JOIN subjects s ON s.id = p.subject_id
     WHERE p.user_id = $1
       AND (p.fb_post_id IS NOT NULL OR p.ig_media_id IS NOT NULL)`,
    [userId]
  );

  if (!products.length) {
    return res.json({ success: true, synced: 0, message: 'אין פוסטים עם מזהה Meta מוגדר' });
  }

  let synced = 0;
  const errors = [];

  for (const p of products) {
    // Facebook
    if (p.fb_post_id && p.facebook_token) {
      try {
        const { reach, impressions } = await fetchMetaInsights(p.fb_post_id, p.facebook_token, 'facebook');
        await query(
          `INSERT INTO post_insights (user_id, product_id, platform, reach, impressions)
           VALUES ($1,$2,'facebook',$3,$4)
           ON CONFLICT (product_id, platform) DO UPDATE SET
             reach = EXCLUDED.reach, impressions = EXCLUDED.impressions, fetched_at = NOW()`,
          [userId, p.id, reach, impressions]
        );
        synced++;
      } catch (err) {
        errors.push({ productId: p.id, platform: 'facebook', error: err.message });
      }
    }

    // Instagram
    if (p.ig_media_id && p.facebook_token) {
      try {
        const { reach, impressions } = await fetchMetaInsights(p.ig_media_id, p.facebook_token, 'instagram');
        await query(
          `INSERT INTO post_insights (user_id, product_id, platform, reach, impressions)
           VALUES ($1,$2,'instagram',$3,$4)
           ON CONFLICT (product_id, platform) DO UPDATE SET
             reach = EXCLUDED.reach, impressions = EXCLUDED.impressions, fetched_at = NOW()`,
          [userId, p.id, reach, impressions]
        );
        synced++;
      } catch (err) {
        errors.push({ productId: p.id, platform: 'instagram', error: err.message });
      }

      await new Promise(r => setTimeout(r, 200));
    }
  }

  res.json({ success: true, synced, errors: errors.length ? errors : undefined });
});

// GET /api/analytics/reach-summary?subjectId=
// Per-niche reach aggregation: avg reach per post, total impressions, CTR (clicks/reach)
router.get('/reach-summary', async (req, res) => {
  try {
    const { subjectId } = req.query;
    const params = [req.user.id];
    let subjectFilter = '';
    if (subjectId) {
      params.push(subjectId);
      subjectFilter = 'AND p.subject_id = $2';
    }

    const { rows } = await query(
      `SELECT
         s.id, s.name, s.color,
         pi.platform,
         COUNT(DISTINCT pi.product_id)                   AS posts_tracked,
         COALESCE(SUM(pi.reach), 0)                      AS total_reach,
         COALESCE(SUM(pi.impressions), 0)                AS total_impressions,
         COALESCE(AVG(pi.reach), 0)                      AS avg_reach_per_post,
         COALESCE(SUM(p.clicks), 0)                      AS total_clicks,
         CASE WHEN SUM(pi.reach) > 0
           THEN ROUND(SUM(p.clicks)::numeric / SUM(pi.reach) * 100, 2)
           ELSE 0 END                                    AS ctr_pct,
         MAX(pi.fetched_at)                              AS last_synced
       FROM post_insights pi
       JOIN products p  ON p.id = pi.product_id AND p.user_id = $1
       JOIN subjects s  ON s.id = p.subject_id
       WHERE pi.user_id = $1 ${subjectFilter}
       GROUP BY s.id, s.name, s.color, pi.platform
       ORDER BY avg_reach_per_post DESC`,
      params
    );
    res.json({ success: true, reach: rows });
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

// POST /api/analytics/spend
// Body: { subjectId, platform, spendUsd, periodStart, periodEnd, notes? }
router.post('/spend', async (req, res) => {
  try {
    const { subjectId, platform, spendUsd, periodStart, periodEnd, notes } = req.body;
    if (!subjectId || !platform || !spendUsd || !periodStart || !periodEnd) {
      return res.status(400).json({ success: false, error: 'חסרים שדות חובה' });
    }

    const { rows } = await query(
      `INSERT INTO ad_spend (user_id, subject_id, platform, spend_usd, period_start, period_end, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [req.user.id, subjectId, platform, parseFloat(spendUsd), periodStart, periodEnd, notes || null]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/analytics/spend/:id
router.delete('/spend/:id', async (req, res) => {
  try {
    await query(
      `DELETE FROM ad_spend WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/analytics/roas
// Per-niche: total spend, total commission, ROAS ratio, spend records list
router.get('/roas', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         s.id,
         s.name,
         s.color,
         COALESCE(SUM(a.spend_usd), 0)                           AS total_spend,
         COALESCE(SUM(cs.commission_usd), 0)                     AS total_commission,
         CASE WHEN SUM(a.spend_usd) > 0
           THEN ROUND(SUM(cs.commission_usd) / SUM(a.spend_usd), 2)
           ELSE NULL END                                          AS roas
       FROM subjects s
       LEFT JOIN ad_spend a            ON a.subject_id = s.id AND a.user_id = $1
       LEFT JOIN commission_snapshots cs ON cs.subject_id = s.id AND cs.user_id = $1
       WHERE s.user_id = $1
       GROUP BY s.id, s.name, s.color
       ORDER BY total_spend DESC, s.name`,
      [req.user.id]
    );

    // Also return raw spend records so the UI can list/delete them
    const { rows: spendRows } = await query(
      `SELECT a.id, a.subject_id, a.platform, a.spend_usd,
              a.period_start, a.period_end, a.notes, a.created_at,
              s.name AS subject_name, s.color AS subject_color
       FROM ad_spend a
       JOIN subjects s ON s.id = a.subject_id
       WHERE a.user_id = $1
       ORDER BY a.period_start DESC`,
      [req.user.id]
    );

    res.json({ success: true, niches: rows, records: spendRows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/analytics/product-orders?subjectId=
// Products ranked by real order count + commission from order_items table.
// Only populated when the AliExpress API returns per-item line data.
router.get('/product-orders', async (req, res) => {
  try {
    const { subjectId } = req.query;
    const params = [req.user.id];
    let subjectFilter = '';
    if (subjectId) {
      params.push(subjectId);
      subjectFilter = 'AND oi.subject_id = $2';
    }

    const { rows } = await query(
      `SELECT
         oi.product_id,
         MAX(oi.product_title)                                AS product_title,
         s.id   AS subject_id,
         s.name AS subject_name,
         s.color AS subject_color,
         COUNT(DISTINCT oi.order_id)                          AS order_count,
         COALESCE(SUM(oi.item_count), 0)                      AS total_items,
         COALESCE(SUM(oi.order_amount), 0)                    AS total_order_value,
         COALESCE(SUM(oi.commission_usd), 0)                  AS total_commission,
         MAX(oi.fetched_at)                                   AS last_seen
       FROM order_items oi
       JOIN subjects s ON s.id = oi.subject_id
       WHERE oi.user_id = $1 ${subjectFilter}
       GROUP BY oi.product_id, s.id, s.name, s.color
       ORDER BY total_commission DESC, order_count DESC
       LIMIT 50`,
      params
    );

    // Also return a count so the UI can show "no data yet" guidance
    const { rows: meta } = await query(
      `SELECT COUNT(*) AS total FROM order_items WHERE user_id = $1`,
      [req.user.id]
    );

    res.json({ success: true, products: rows, totalItems: parseInt(meta[0]?.total || 0, 10) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/analytics/probe-raw-orders
// Returns the raw AliExpress API response for the first page of the most recent 7 days.
// Use this to verify whether your API account returns order_items line-item data.
router.get('/probe-raw-orders', async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows: subjects } = await query(
      `SELECT id, name, aliexpress_tracking_id FROM subjects
       WHERE user_id = $1 AND aliexpress_tracking_id IS NOT NULL AND aliexpress_tracking_id != ''
       LIMIT 1`,
      [userId]
    );
    if (!subjects.length) {
      return res.json({ success: false, error: 'אין נישה עם tracking ID מוגדר' });
    }

    const { aliexpress_tracking_id: trackingId, name: subjectName } = subjects[0];
    const now      = new Date();
    const weekAgo  = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 30);
    const fmt = d => d.toISOString().replace('T', ' ').slice(0, 19);

    // Try each status until we find one with orders (or exhaust all)
    const statuses = ['Payment Completed', 'Buyer Confirmed Receipt', 'Settled'];
    let apiRes, root, orders = [], usedStatus;

    for (const status of statuses) {
      apiRes = await signAndCall({
        method:      'aliexpress.affiliate.order.list',
        start_time:  fmt(weekAgo),
        end_time:    fmt(now),
        tracking_id: trackingId,
        status,
        page_no:     '1',
        page_size:   '5',
      });
      root   = apiRes.data?.aliexpress_affiliate_order_list_response?.resp_result;
      orders = root?.result?.orders?.order || [];
      usedStatus = status;
      if (orders.length) break;
    }

    const sample = orders[0] || null;

    res.json({
      success:          true,
      subject:          subjectName,
      tracking_id:      trackingId,
      status_used:      usedStatus,
      order_count:      orders.length,
      has_order_items:  sample ? Array.isArray(sample.order_items?.order_item) : false,
      sample_order:     sample,
      raw_response:     apiRes.data,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/analytics/insights
// Per-niche comparison of real vs assumed metrics for profit analysis:
// real conversion rate, real commission rate, revenue-per-click, model accuracy.
router.get('/insights', async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows } = await query(
      `WITH real_data AS (
         SELECT
           cs.subject_id,
           COUNT(DISTINCT cs.order_id)                        AS real_orders,
           COALESCE(SUM(cs.commission_usd), 0)               AS real_commission,
           AVG(NULLIF(cs.commission_rate, 0))                 AS real_commission_rate
         FROM commission_snapshots cs
         WHERE cs.user_id = $1
         GROUP BY cs.subject_id
       ),
       product_data AS (
         SELECT
           p.subject_id,
           COALESCE(SUM(p.clicks), 0)                        AS total_clicks,
           COUNT(*)                                           AS total_products,
           COUNT(*) FILTER (WHERE p.sent_at IS NOT NULL)     AS sent_products,
           COUNT(*) FILTER (WHERE p.sale_price IS NOT NULL)  AS priced_products,
           COALESCE(SUM(
             CASE WHEN p.sale_price IS NOT NULL
               THEN p.clicks * 0.02 * p.sale_price * 0.08
               ELSE 0 END
           ), 0)                                              AS est_revenue_default
         FROM products p
         WHERE p.user_id = $1
         GROUP BY p.subject_id
       )
       SELECT
         s.id, s.name, s.color,
         COALESCE(rd.real_orders, 0)                         AS real_orders,
         COALESCE(rd.real_commission, 0)                     AS real_commission,
         rd.real_commission_rate,
         COALESCE(pd.total_clicks, 0)                        AS total_clicks,
         COALESCE(pd.total_products, 0)                      AS total_products,
         COALESCE(pd.sent_products, 0)                       AS sent_products,
         COALESCE(pd.priced_products, 0)                     AS priced_products,
         COALESCE(pd.est_revenue_default, 0)                 AS est_revenue_default,
         CASE WHEN COALESCE(pd.total_clicks, 0) > 0 AND COALESCE(rd.real_orders, 0) > 0
           THEN rd.real_orders::numeric / NULLIF(pd.total_clicks, 0)
           ELSE NULL END                                      AS real_conversion_rate,
         CASE WHEN COALESCE(pd.total_clicks, 0) > 0 AND COALESCE(rd.real_commission, 0) > 0
           THEN rd.real_commission / NULLIF(pd.total_clicks, 0)
           ELSE NULL END                                      AS revenue_per_click
       FROM subjects s
       LEFT JOIN real_data rd     ON rd.subject_id = s.id
       LEFT JOIN product_data pd  ON pd.subject_id = s.id
       WHERE s.user_id = $1
       ORDER BY rd.real_commission DESC NULLS LAST, pd.total_clicks DESC NULLS LAST`,
      [userId]
    );

    // Aggregate totals
    const totals = rows.reduce((acc, n) => {
      acc.real_commission  += parseFloat(n.real_commission  || 0);
      acc.est_default      += parseFloat(n.est_revenue_default || 0);
      acc.total_clicks     += parseInt(n.total_clicks || 0, 10);
      acc.real_orders      += parseInt(n.real_orders  || 0, 10);
      acc.total_products   += parseInt(n.total_products || 0, 10);
      acc.sent_products    += parseInt(n.sent_products || 0, 10);
      return acc;
    }, { real_commission: 0, est_default: 0, total_clicks: 0, real_orders: 0, total_products: 0, sent_products: 0 });

    res.json({ success: true, niches: rows, totals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
