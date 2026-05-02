---
phase: ai-product-discovery
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - db/migrate.js
  - services/aliexpressFilters.js
  - routes/aliexpress-api.js
  - services/discoveryAgent.js
  - routes/discover.js
autonomous: true
requirements: []

must_haves:
  truths:
    - "product_suggestions table exists in the DB with correct schema"
    - "passesFilters logic is in one shared location, not duplicated"
    - "POST /api/discover/run triggers discovery and returns count of new suggestions"
    - "GET /api/discover returns pending suggestions for the authenticated user"
    - "PATCH /api/discover/:id accepts status updates (added | dismissed)"
  artifacts:
    - path: "services/aliexpressFilters.js"
      provides: "Shared passesFilters() function"
      exports: ["passesFilters"]
    - path: "services/discoveryAgent.js"
      provides: "runDiscovery(userId) — queries DB, extracts keywords, searches AliExpress, stores results"
      exports: ["runDiscovery"]
    - path: "routes/discover.js"
      provides: "GET /api/discover, POST /api/discover/run, PATCH /api/discover/:id"
  key_links:
    - from: "services/discoveryAgent.js"
      to: "services/aliexpressApi.js"
      via: "signAndCall"
      pattern: "signAndCall"
    - from: "services/discoveryAgent.js"
      to: "services/aliexpressFilters.js"
      via: "passesFilters import"
      pattern: "require.*aliexpressFilters"
    - from: "routes/aliexpress-api.js"
      to: "services/aliexpressFilters.js"
      via: "passesFilters import (refactored)"
      pattern: "require.*aliexpressFilters"
---

<objective>
Build the backend discovery agent: DB schema, shared filter utility, core service logic, and REST routes.

Purpose: Establish the data layer and business logic needed for the discovery feature before any UI work begins.
Output: New `product_suggestions` table, `services/aliexpressFilters.js`, `services/discoveryAgent.js`, `routes/discover.js`
</objective>

<execution_context>
@/Users/davids/.claude/get-shit-done/workflows/execute-plan.md
@/Users/davids/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/standalone/ai-product-discovery/RESEARCH.md
@db/migrate.js
@routes/aliexpress-api.js
@services/aliexpressApi.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add product_suggestions migration + extract passesFilters to shared module</name>
  <files>
    db/migrate.js
    services/aliexpressFilters.js
    routes/aliexpress-api.js
  </files>
  <action>
    1. Create `services/aliexpressFilters.js` exporting a single function:
    ```js
    function passesFilters(product) {
      const rate = parseFloat((product.evaluate_rate || '0').replace('%', '')) || 0;
      const volume = Number(product.lastest_volume || 0);
      const stockRaw = product.available_stock;
      const stockOk = stockRaw === undefined || stockRaw === null || stockRaw === '' || Number(stockRaw) > 100;
      return rate > 80 && volume > 50 && stockOk;
    }
    module.exports = { passesFilters };
    ```

    2. In `routes/aliexpress-api.js`, remove the inline `passesFilters` function definition and replace with:
    ```js
    const { passesFilters } = require('../services/aliexpressFilters');
    ```
    All existing call sites in that file remain unchanged.

    3. In `db/migrate.js`, append (before the final `console.log`) a new migration block:
    ```js
    // ── Product Suggestions (AI discovery agent) ──────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS product_suggestions (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject_id     UUID REFERENCES subjects(id) ON DELETE SET NULL,
        aliexpress_id  TEXT NOT NULL,
        title          TEXT NOT NULL,
        image_url      TEXT,
        promotion_link TEXT NOT NULL,
        sale_price     NUMERIC(10,2),
        evaluate_rate  TEXT,
        lastest_volume INTEGER,
        source_keyword TEXT,
        status         TEXT NOT NULL DEFAULT 'pending',
        score          NUMERIC(6,2),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, aliexpress_id)
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS product_suggestions_user   ON product_suggestions(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS product_suggestions_status ON product_suggestions(user_id, status)`);
    ```
  </action>
  <verify>
    <automated>node -e "const {migrate} = require('./db/migrate'); migrate().then(() => { console.log('OK'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); })"</automated>
    <manual>Confirm `product_suggestions` table appears in the DB and `routes/aliexpress-api.js` still imports passesFilters correctly</manual>
  </verify>
  <done>Migration runs without error; `product_suggestions` table exists; `passesFilters` lives only in `services/aliexpressFilters.js`; no duplicate definition in `routes/aliexpress-api.js`</done>
</task>

<task type="auto">
  <name>Task 2: Build discoveryAgent.js service</name>
  <files>services/discoveryAgent.js</files>
  <action>
    Create `services/discoveryAgent.js` exporting `runDiscovery(userId)`.

    Implementation:

    ```js
    const { query } = require('../db');
    const { signAndCall } = require('./aliexpressApi');
    const { passesFilters } = require('./aliexpressFilters');

    const DEFAULT_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || 'TechSalebuy';

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

    async function runDiscovery(userId) {
      // 1. Fetch top-performing products per subject (clicks > 3 OR commission record exists)
      const { rows: topProducts } = await query(`
        SELECT
          p.id,
          p.subject_id,
          s.name        AS subject_name,
          s.aliexpress_tracking_id,
          p.clicks,
          COALESCE(oi.product_title, '') AS english_title
        FROM products p
        JOIN subjects s ON s.id = p.subject_id AND s.user_id = $1
        LEFT JOIN LATERAL (
          SELECT product_title FROM order_items
          WHERE user_id = $1 AND product_title IS NOT NULL
          LIMIT 1
        ) oi ON true
        WHERE p.user_id = $1
          AND p.created_at > NOW() - INTERVAL '90 days'
          AND p.clicks > 3
        ORDER BY p.clicks DESC
        LIMIT 20
      `, [userId]);

      // 2. Build subject → keyword map; fall back to subject name when no English title
      const subjectMap = new Map();
      for (const row of topProducts) {
        if (!subjectMap.has(row.subject_id)) {
          const keyword = row.english_title || row.subject_name;
          // Only use ASCII/English keywords — skip if Hebrew (contains chars in ֐-׿ range)
          if (/[֐-׿]/.test(keyword)) continue;
          subjectMap.set(row.subject_id, {
            keyword,
            trackingId: row.aliexpress_tracking_id,
            subjectName: row.subject_name,
          });
        }
      }

      // If no high-performing products found, fall back to all subjects' names
      if (subjectMap.size === 0) {
        const { rows: subjects } = await query(
          `SELECT id, name, aliexpress_tracking_id FROM subjects WHERE user_id = $1`,
          [userId]
        );
        for (const s of subjects) {
          if (!/[֐-׿]/.test(s.name)) {
            subjectMap.set(s.id, { keyword: s.name, trackingId: s.aliexpress_tracking_id, subjectName: s.name });
          }
        }
      }

      // 3. Fetch existing promotion_links to deduplicate
      const { rows: existingRows } = await query(
        `SELECT long_url FROM products WHERE user_id = $1 AND long_url IS NOT NULL`,
        [userId]
      );
      const existingUrls = new Set(existingRows.map(r => r.long_url));

      // 4. Fetch already-known suggestion aliexpress_ids to skip
      const { rows: existingSugRows } = await query(
        `SELECT aliexpress_id FROM product_suggestions WHERE user_id = $1`,
        [userId]
      );
      const existingSugIds = new Set(existingSugRows.map(r => r.aliexpress_id));

      // 5. Search AliExpress sequentially (rate-limit safe), max 5 subjects
      const entries = [...subjectMap.entries()].slice(0, 5);
      let newCount = 0;

      for (const [subjectId, { keyword, trackingId, subjectName }] of entries) {
        try {
          const results = await searchAliExpress(keyword, trackingId);
          const filtered = results.filter(passesFilters);

          for (const product of filtered) {
            const pid = String(product.product_id);
            if (existingSugIds.has(pid)) continue;
            if (existingUrls.has(product.promotion_link)) continue;

            const salePrice = parseFloat(product.app_sale_price) || null;

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
              salePrice,
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

        // Rate-limit: 1s between searches
        await new Promise(r => setTimeout(r, 1000));
      }

      return { newCount, subjectsSearched: entries.length };
    }

    module.exports = { runDiscovery };
    ```
  </action>
  <verify>
    <automated>node -e "const d = require('./services/discoveryAgent'); console.log(typeof d.runDiscovery === 'function' ? 'OK' : 'FAIL')"</automated>
  </verify>
  <done>Module loads without errors; `runDiscovery` is exported as a function</done>
</task>

<task type="auto">
  <name>Task 3: Create routes/discover.js and mount in server.js</name>
  <files>
    routes/discover.js
    server.js
  </files>
  <action>
    1. Create `routes/discover.js`:

    ```js
    const express = require('express');
    const router = express.Router();
    const { query } = require('../db');
    const { runDiscovery } = require('../services/discoveryAgent');

    // GET /api/discover — list pending suggestions for authenticated user
    router.get('/', async (req, res) => {
      try {
        const { rows } = await query(`
          SELECT
            ps.id, ps.aliexpress_id, ps.title, ps.image_url, ps.promotion_link,
            ps.sale_price, ps.evaluate_rate, ps.lastest_volume, ps.source_keyword,
            ps.status, ps.created_at,
            s.name AS subject_name, s.id AS subject_id
          FROM product_suggestions ps
          LEFT JOIN subjects s ON s.id = ps.subject_id
          WHERE ps.user_id = $1
            AND ps.status = 'pending'
          ORDER BY ps.created_at DESC
          LIMIT 50
        `, [req.user.id]);
        res.json({ success: true, suggestions: rows });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // POST /api/discover/run — trigger discovery agent
    router.post('/run', async (req, res) => {
      try {
        const result = await runDiscovery(req.user.id);
        res.json({ success: true, ...result });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // PATCH /api/discover/:id — update suggestion status ('added' | 'dismissed')
    router.patch('/:id', async (req, res) => {
      const { status } = req.body;
      if (!['added', 'dismissed', 'pending'].includes(status)) {
        return res.status(400).json({ success: false, error: 'status must be added | dismissed | pending' });
      }
      try {
        const { rowCount } = await query(
          `UPDATE product_suggestions SET status = $1 WHERE id = $2 AND user_id = $3`,
          [status, req.params.id, req.user.id]
        );
        if (rowCount === 0) return res.status(404).json({ success: false, error: 'not found' });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    module.exports = router;
    ```

    2. In `server.js`, find where other routes are mounted (e.g., the block mounting `/api/aliexpress`) and add directly after:
    ```js
    app.use('/api/discover', require('./routes/discover'));
    ```
    Do NOT modify any existing route mounting lines — only add the new one.
  </action>
  <verify>
    <automated>node -e "const app = require('./server'); setTimeout(() => { process.exit(0); }, 500);" 2>&1 | grep -v "^$" | head -20</automated>
    <manual>Run `curl -s http://localhost:3000/api/discover` — should return 401 (not 404), confirming the route is registered</manual>
  </verify>
  <done>Server starts without errors; `GET /api/discover` returns 401 (auth required), not 404; `POST /api/discover/run` and `PATCH /api/discover/:id` routes exist</done>
</task>

</tasks>

<verification>
After all three tasks:
- `node -e "require('./db/migrate').migrate()" ` runs without error
- `node -e "require('./services/discoveryAgent')"` loads without error
- `node -e "require('./routes/discover')"` loads without error
- `node -e "require('./routes/aliexpress-api')"` loads without error (refactored passesFilters import)
- `grep -n "passesFilters" routes/aliexpress-api.js` shows only the require line, no function definition
</verification>

<success_criteria>
- `product_suggestions` table exists with `UNIQUE(user_id, aliexpress_id)` constraint
- `passesFilters` defined once in `services/aliexpressFilters.js`, imported in both `routes/aliexpress-api.js` and `services/discoveryAgent.js`
- `POST /api/discover/run` calls `runDiscovery`, inserts new pending suggestions, returns `{ newCount, subjectsSearched }`
- `GET /api/discover` returns array of pending suggestions with subject name
- `PATCH /api/discover/:id` updates status correctly; returns 404 for unknown/unauthorized IDs
</success_criteria>

<output>
After completion, create `.planning/standalone/ai-product-discovery/ai-product-discovery-01-SUMMARY.md`
</output>
