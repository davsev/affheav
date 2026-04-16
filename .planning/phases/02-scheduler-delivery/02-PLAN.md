---
phase: 02-scheduler-delivery
plan: 02
type: execute
wave: 2
depends_on:
  - "01-PLAN.md"
files_modified:
  - scheduler/index.js
  - routes/broadcasts.js
  - server.js
autonomous: true
requirements:
  - DLVR-01
  - DLVR-02

must_haves:
  truths:
    - "On server startup, enabled broadcast_messages rows are loaded into cron jobs (logged as 'X broadcast(s) active')"
    - "Broadcast cron jobs live in a separate activeBroadcastJobs map — the existing activeJobs map for product schedules is not modified"
    - "startBroadcasts() is wrapped in its own try-catch — a DB error loading broadcasts does not prevent product schedules from loading"
    - "POST /api/broadcasts/:id/fire-now fires broadcastDelivery.send() and returns { success: true, fired: true } immediately (async delivery)"
    - "After any PATCH /:id/enabled call, scheduler.startBroadcasts() is called to sync in-memory jobs with DB state"
    - "server.js calls scheduler.startBroadcasts() during startup (after startAll()) and the count is logged"
    - "scheduler/index.js exports startBroadcasts so it can be called from routes/broadcasts.js after enable/disable mutations"
  artifacts:
    - path: "scheduler/index.js"
      provides: "activeBroadcastJobs map, startBroadcasts(), runBroadcastJob() — additive, no changes to activeJobs or existing functions"
      contains: "activeBroadcastJobs"
    - path: "routes/broadcasts.js"
      provides: "fire-now stub replaced with real broadcastDelivery.send() call; PATCH /enabled calls startBroadcasts() after mutation"
      contains: "broadcastDelivery"
    - path: "server.js"
      provides: "scheduler.startBroadcasts() called at startup after scheduler.startAll()"
      contains: "startBroadcasts"
  key_links:
    - from: "scheduler/index.js"
      to: "services/broadcastDelivery.js"
      via: "runBroadcastJob() calls broadcastDelivery.send(b, b.user_id)"
      pattern: "broadcastDelivery.send"
    - from: "routes/broadcasts.js"
      to: "services/broadcastDelivery.js"
      via: "broadcastDelivery.send(msg, req.user.id) in fire-now handler"
      pattern: "broadcastDelivery.send"
    - from: "routes/broadcasts.js"
      to: "scheduler/index.js"
      via: "scheduler.startBroadcasts() called after PATCH /enabled mutation"
      pattern: "startBroadcasts"
    - from: "server.js"
      to: "scheduler/index.js"
      via: "scheduler.startBroadcasts() called after startAll() in listen callback"
      pattern: "startBroadcasts"
---

<objective>
Wire broadcast delivery into the scheduler and fire-now endpoint.

Purpose: Makes broadcast messages actually fire. Extends scheduler/index.js with broadcast job support (additive — zero changes to existing product schedule behavior), replaces the fire-now stub in routes/broadcasts.js with real delivery, and starts broadcast jobs on server startup.

Output: `scheduler/index.js` (extended), `routes/broadcasts.js` (fire-now stub replaced, enable/disable triggers reload), `server.js` (one startup call added).
</objective>

<execution_context>
@/Users/davids/.claude/get-shit-done/workflows/execute-plan.md
@/Users/davids/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-scheduler-delivery/02-RESEARCH.md
@.planning/phases/02-scheduler-delivery/02-scheduler-delivery-01-SUMMARY.md
@scheduler/index.js
@routes/broadcasts.js
@server.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend scheduler/index.js with broadcast job support</name>
  <files>scheduler/index.js</files>
  <action>
    Add broadcast job infrastructure to `scheduler/index.js`. This is PURELY ADDITIVE — do not modify `activeJobs`, `_runWorkflow`, `setWorkflowRunner`, `setLogger`, `startAll`, `stopAll`, `runJob`, `fireNow`, `add`, `update`, `remove`, or `_formatRow`. Only add new code.

    **Step 1:** After the existing module-scope variables (line 4-6), add:
    ```javascript
    let activeBroadcastJobs = {}; // broadcastId → cron.ScheduledTask
    ```

    **Step 2:** After the existing `stopAll()` function (around line 20), add `stopBroadcasts()`:
    ```javascript
    function stopBroadcasts() {
      for (const job of Object.values(activeBroadcastJobs)) job.stop();
      activeBroadcastJobs = {};
    }
    ```

    **Step 3:** After `stopBroadcasts()`, add `startBroadcasts()` and `runBroadcastJob()`:
    ```javascript
    async function startBroadcasts() {
      let broadcasts = [];
      try {
        const { rows } = await query('SELECT * FROM broadcast_messages WHERE enabled = true');
        broadcasts = rows;
      } catch (err) {
        log(`Could not load broadcast_messages: ${err.message}`, 'warn');
        return 0;
      }

      stopBroadcasts();

      for (const b of broadcasts) {
        if (!cron.validate(b.cron)) {
          log(`Invalid cron for broadcast "${b.label}": "${b.cron}"`, 'warn');
          continue;
        }
        activeBroadcastJobs[b.id] = cron.schedule(b.cron, () => runBroadcastJob(b), { timezone: 'Asia/Jerusalem' });
        log(`Broadcast registered: "${b.label}" → ${b.cron}`);
      }

      if (broadcasts.length) {
        log(`📡 ${broadcasts.length} broadcast(s) active: ${broadcasts.map(b => `"${b.label}"`).join(', ')}`);
      } else {
        log('No enabled broadcasts found');
      }

      return broadcasts.length;
    }

    async function runBroadcastJob(b) {
      const broadcastDelivery = require('../services/broadcastDelivery');
      log(`Firing broadcast: "${b.label}" (${b.cron})`);
      try {
        await broadcastDelivery.send(b, b.user_id);
      } catch (err) {
        log(`Broadcast "${b.label}" error: ${err.message}`, 'error');
      }
    }
    ```

    **Design notes:**
    - `broadcastDelivery` is required INSIDE `runBroadcastJob()` (not at the top of the file) to avoid a circular dependency risk at startup. This matches the injection pattern the existing code uses for `_runWorkflow`. The require() call is cached by Node.js after the first call — no performance penalty on repeated fires.
    - `stopBroadcasts()` is called at the START of `startBroadcasts()` (after the DB fetch) — same pattern as `stopAll()` is called inside `startAll()`. This ensures a clean reload.
    - The outer try-catch in `startBroadcasts()` catches DB errors (e.g., table not yet migrated). Returns 0 safely — does NOT throw. This prevents broadcast startup errors from cascading into product schedule loading.
    - `b` (the full DB row) is closure-captured in the cron callback — avoids a DB re-fetch on every cron fire. Subject credentials are NOT cached (fetched fresh per delivery in broadcastDelivery.send).

    **Step 4:** Update `module.exports` at the bottom to include the new exports:
    ```javascript
    module.exports = {
      startAll, stopAll, getActiveJobs,
      startBroadcasts, stopBroadcasts,
      add, update, remove,
      setWorkflowRunner, setLogger, fireNow,
    };
    ```
    Replace the existing single-line `module.exports = { ... }` with this multi-line version. Preserve all existing exports exactly.
  </action>
  <verify>
    <automated>node -e "const s = require('./scheduler'); console.log(typeof s.startBroadcasts === 'function' && typeof s.stopBroadcasts === 'function' ? 'scheduler OK' : 'MISSING');"</automated>
    <manual>Confirm activeJobs, startAll, stopAll, setWorkflowRunner, fireNow are all still present in exports.</manual>
  </verify>
  <done>scheduler exports startBroadcasts and stopBroadcasts; existing exports (startAll, stopAll, add, update, remove, etc.) are all still present and unchanged; module loads without error.</done>
</task>

<task type="auto">
  <name>Task 2: Wire fire-now delivery in routes/broadcasts.js and call startBroadcasts after enable/disable</name>
  <files>routes/broadcasts.js</files>
  <action>
    Make two targeted changes to `routes/broadcasts.js` (which was created by Phase 1).

    **NOTE:** This file does not yet exist — it is created by Phase 1, Plan 03. If Phase 1 has not been executed, this plan cannot proceed. The file must exist before this task runs.

    **Change 1: Add imports at the top of routes/broadcasts.js**

    After the existing `require` lines (the last `require` is probably `broadcastService`), add:
    ```javascript
    const broadcastDelivery = require('../services/broadcastDelivery');
    const scheduler = require('../scheduler');
    ```

    Add these immediately after the existing local require lines, before the `UPLOAD_DIR` constant or router definition.

    **Change 2: Replace the fire-now stub**

    Find the existing fire-now stub handler that looks like:
    ```javascript
    router.post('/:id/fire-now', async (req, res) => {
      try {
        const msg = await getById(req.params.id, req.user.id);
        if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
        // Phase 2: replace stub with actual broadcastDelivery.send(msg)
        res.json({ success: true, results: { whatsapp: { stubbed: true }, facebook: { stubbed: true } } });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
    ```

    Replace it entirely with:
    ```javascript
    router.post('/:id/fire-now', async (req, res) => {
      try {
        const msg = await getById(req.params.id, req.user.id);
        if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
        // Respond immediately; delivery runs async (matches schedules.js pattern)
        res.json({ success: true, fired: true });
        broadcastDelivery.send(msg, req.user.id).catch(err => {
          console.error(`[broadcasts] fire-now error for broadcast ${msg.id}: ${err.message}`);
        });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
    ```

    **Change 3: Call startBroadcasts() after PATCH /:id/enabled**

    Find the existing PATCH /:id/enabled handler:
    ```javascript
    router.patch('/:id/enabled', async (req, res) => {
      try {
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
          return res.status(400).json({ success: false, error: 'enabled must be a boolean' });
        }
        const msg = await setEnabled(req.params.id, req.user.id, enabled);
        if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true, broadcast: msg });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
    ```

    Replace it with (adds one line — the startBroadcasts call — after setEnabled succeeds):
    ```javascript
    router.patch('/:id/enabled', async (req, res) => {
      try {
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
          return res.status(400).json({ success: false, error: 'enabled must be a boolean' });
        }
        const msg = await setEnabled(req.params.id, req.user.id, enabled);
        if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
        await scheduler.startBroadcasts(); // sync cron jobs with DB state
        res.json({ success: true, broadcast: msg });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
    ```

    Do NOT change any other handlers. The GET, POST, PUT, DELETE, POST /:id/image, and multer error handler are unchanged.
  </action>
  <verify>
    <automated>node -e "const r = require('./routes/broadcasts'); console.log(typeof r.handle === 'function' ? 'router OK' : 'not a router');"</automated>
    <manual>Inspect routes/broadcasts.js and confirm: (1) broadcastDelivery and scheduler are imported, (2) fire-now returns { success: true, fired: true } and calls broadcastDelivery.send async, (3) PATCH /enabled calls scheduler.startBroadcasts() after setEnabled.</manual>
  </verify>
  <done>routes/broadcasts.js loads without error; fire-now handler calls broadcastDelivery.send(); PATCH /enabled handler calls scheduler.startBroadcasts(); stubbed results object is gone from fire-now.</done>
</task>

<task type="auto">
  <name>Task 3: Call scheduler.startBroadcasts() in server.js on startup</name>
  <files>server.js</files>
  <action>
    Add ONE line to `server.js` in the startup `app.listen()` callback. Find the existing scheduler startup block:

    ```javascript
    scheduler.setLogger(workflow.log);
    scheduler.setWorkflowRunner((opts) => workflow.run(null, opts || {}));
    const count = await scheduler.startAll();
    console.log(`📅 ${count} schedule(s) loaded\n`);
    ```

    Replace it with (adds two lines — broadcast startup + log):
    ```javascript
    scheduler.setLogger(workflow.log);
    scheduler.setWorkflowRunner((opts) => workflow.run(null, opts || {}));
    const count = await scheduler.startAll();
    console.log(`📅 ${count} schedule(s) loaded`);
    const bcount = await scheduler.startBroadcasts();
    console.log(`📡 ${bcount} broadcast(s) loaded\n`);
    ```

    Do NOT change any other line in server.js. The `\n` is moved from the schedules log to the broadcasts log to keep the blank line after the startup block.
  </action>
  <verify>
    <automated>node -e "const fs = require('fs'); const src = fs.readFileSync('./server.js','utf8'); console.log(src.includes('startBroadcasts') ? 'wired OK' : 'MISSING');"</automated>
    <manual>With DATABASE_URL set and server running (npm run dev), check startup logs for '📡 X broadcast(s) loaded' line appearing after the schedule count line.</manual>
  </verify>
  <done>server.js contains scheduler.startBroadcasts() call in the listen callback; the startup log shows both schedule and broadcast counts.</done>
</task>

</tasks>

<verification>
End-to-end verification sequence (requires running server with DATABASE_URL set and a valid session):

1. **Scheduler startup:** Start server with `npm run dev`; confirm logs show both:
   - `📅 X schedule(s) loaded`
   - `📡 X broadcast(s) loaded`

2. **Fire-now (no delivery):** With an enabled broadcast message in DB:
   ```
   curl -X POST http://localhost:3000/api/broadcasts/<id>/fire-now \
     -H 'Cookie: <session>'
   ```
   Returns `{ "success": true, "fired": true }` immediately (not the stubbed response).

3. **Enable/disable sync:** Toggle a broadcast enabled state:
   ```
   curl -X PATCH http://localhost:3000/api/broadcasts/<id>/enabled \
     -H 'Content-Type: application/json' \
     -H 'Cookie: <session>' \
     -d '{"enabled": false}'
   ```
   Server logs show 'No enabled broadcasts found' or updated broadcast count (scheduler reloaded).

4. **Failure isolation (static check):** In services/broadcastDelivery.js, confirm two independent try-catch blocks exist — one for WhatsApp, one for Facebook. Both log errors to console but return result objects rather than throwing.
</verification>

<success_criteria>
- scheduler/index.js exports startBroadcasts and stopBroadcasts alongside all existing exports
- activeBroadcastJobs is a separate map from activeJobs — no shared state
- startBroadcasts() is wrapped in outer try-catch; a DB error returns 0 and warns but does not throw
- server.js calls scheduler.startBroadcasts() at startup and logs the count
- routes/broadcasts.js POST /:id/fire-now calls broadcastDelivery.send() async and returns { success: true, fired: true }
- routes/broadcasts.js PATCH /:id/enabled calls scheduler.startBroadcasts() after DB mutation
- All three files load without syntax errors
- Existing product schedule behavior (activeJobs, startAll, runJob, fireNow) is completely unchanged
</success_criteria>

<output>
After completion, create `.planning/phases/02-scheduler-delivery/02-scheduler-delivery-02-SUMMARY.md` with:
- What was done
- Files modified
- How to verify broadcast jobs are loading (startup log line)
- Known limitations (localhost images not fetchable by Facebook in dev; concurrent WA sends under high load)
- What Phase 3 needs to know (API contract is stable; fire-now returns { fired: true } not { results })
</output>
