---
phase: 01-backend-foundation
plan: 03
type: execute
wave: 3
depends_on:
  - "01-PLAN.md"
  - "02-PLAN.md"
files_modified:
  - routes/broadcasts.js
  - server.js
  - package.json
  - package-lock.json
autonomous: true
requirements:
  - BCAST-01
  - BCAST-02
  - BCAST-03
  - BCAST-04
  - BCAST-05
  - BCAST-06
  - BCAST-07
  - SCHED-04

must_haves:
  truths:
    - "GET /api/broadcasts returns an array of broadcast messages with nextRunAt field"
    - "POST /api/broadcasts (JSON or multipart) creates a broadcast message and returns 201"
    - "POST /api/broadcasts/:id/image uploads an image, saves to public/uploads/broadcasts/, returns updated record"
    - "PUT /api/broadcasts/:id updates fields; returns 404 if id not found or not owned"
    - "DELETE /api/broadcasts/:id removes the record; returns 404 if not found"
    - "PATCH /api/broadcasts/:id/enabled toggles enabled; returns updated record"
    - "POST /api/broadcasts/:id/fire-now returns { success: true, results: { whatsapp: { stubbed: true }, facebook: { stubbed: true } } }"
    - "Uploaded images larger than 10 MB return 400 with a clear error message"
    - "Subject_id belonging to another user returns 400"
  artifacts:
    - path: "routes/broadcasts.js"
      provides: "Express router with all 7 endpoint handlers + multer + error handler"
      exports: "router"
    - path: "server.js"
      provides: "app.use('/api/broadcasts', isAuthenticated, require('./routes/broadcasts')) mount line"
      contains: "/api/broadcasts"
  key_links:
    - from: "routes/broadcasts.js"
      to: "services/broadcastService.js"
      via: "require('../services/broadcastService')"
      pattern: "require\\('../services/broadcastService'\\)"
    - from: "server.js"
      to: "routes/broadcasts.js"
      via: "app.use('/api/broadcasts', isAuthenticated, require('./routes/broadcasts'))"
      pattern: "/api/broadcasts"
---

<objective>
Install multer, create routes/broadcasts.js, and mount it in server.js.

Purpose: Exposes the broadcast messages API — all 7 endpoints that fulfill BCAST-01 through BCAST-07 and SCHED-04. The fire-now endpoint is stubbed in this phase (delivery wired in Phase 2).
Output: `routes/broadcasts.js` (new), `server.js` (one added line), `package.json` / `package-lock.json` (multer added).
</objective>

<execution_context>
@/Users/davids/.claude/get-shit-done/workflows/execute-plan.md
@/Users/davids/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-backend-foundation/01-RESEARCH.md
@.planning/phases/01-backend-foundation/01-backend-foundation-02-SUMMARY.md
@routes/schedules.js
@server.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install multer and create routes/broadcasts.js</name>
  <files>routes/broadcasts.js, package.json, package-lock.json</files>
  <action>
    **Step 1: Install multer**
    Run: `npm install multer`
    This adds `multer` to dependencies in package.json.

    **Step 2: Create `routes/broadcasts.js`**

    Model the file structure on `routes/schedules.js` (existing file). Key differences: this route uses multer for file upload.

    **Imports at top (in order: core → third-party → local):**
    ```javascript
    const fs      = require('fs');
    const path    = require('path');
    const express = require('express');
    const multer  = require('multer');
    const { v4: uuidv4 } = require('uuid');
    const { listByUser, getById, create, update, remove, setEnabled } = require('../services/broadcastService');
    ```

    **Upload directory setup (before router definition):**
    ```javascript
    const UPLOAD_DIR = path.join(__dirname, '../public/uploads/broadcasts');
    fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // idempotent — creates on first require
    ```

    **Multer configuration:**
    ```javascript
    const storage = multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOAD_DIR),
      filename:    (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
    });

    const upload = multer({
      storage,
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) return cb(null, true);
        cb(new Error('Images only'));
      },
    });
    ```

    **Router definition:**
    ```javascript
    const router = express.Router();
    ```

    **Endpoints (implement all with try/catch wrapping):**

    `GET /` — List all broadcasts for the authenticated user:
    ```javascript
    router.get('/', async (req, res) => {
      try {
        const msgs = await listByUser(req.user.id);
        res.json({ success: true, broadcasts: msgs });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
    ```

    `POST /` — Create (supports both JSON body and multipart with optional image file):
    Use `upload.single('image')` middleware. `req.file` will be undefined for JSON-only requests.
    Required body fields: `label`, `text`, `subjectId`, `recurrence` (object or JSON string).
    Parse recurrence: if `typeof req.body.recurrence === 'string'`, JSON.parse it (multipart sends everything as strings).
    Validate presence of label, text, subjectId, recurrence before calling service.
    On success return 201.
    ```javascript
    router.post('/', upload.single('image'), async (req, res) => {
      try {
        const { label, text, subjectId } = req.body;
        let recurrence = req.body.recurrence;
        if (typeof recurrence === 'string') recurrence = JSON.parse(recurrence);
        if (!label || !text || !subjectId || !recurrence) {
          return res.status(400).json({ success: false, error: 'label, text, subjectId, recurrence are required' });
        }
        const imageUrl = req.file ? `/uploads/broadcasts/${req.file.filename}` : undefined;
        const msg = await create(req.user.id, { subjectId, label, text, recurrence, imageUrl });
        res.status(201).json({ success: true, broadcast: msg });
      } catch (err) {
        res.status(400).json({ success: false, error: err.message });
      }
    });
    ```

    `GET /:id` — Get single broadcast (ownership enforced by service returning null):
    ```javascript
    router.get('/:id', async (req, res) => {
      try {
        const msg = await getById(req.params.id, req.user.id);
        if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true, broadcast: msg });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
    ```

    `PUT /:id` — Update (supports multipart for image replacement):
    Use `upload.single('image')` middleware.
    Pass all provided fields to service; let service handle dynamic SET.
    Parse recurrence from string if needed (same as POST).
    ```javascript
    router.put('/:id', upload.single('image'), async (req, res) => {
      try {
        const fields = {};
        if (req.body.label     !== undefined) fields.label     = req.body.label;
        if (req.body.text      !== undefined) fields.text      = req.body.text;
        if (req.body.subjectId !== undefined) fields.subjectId = req.body.subjectId;
        if (req.body.recurrence !== undefined) {
          fields.recurrence = typeof req.body.recurrence === 'string'
            ? JSON.parse(req.body.recurrence)
            : req.body.recurrence;
        }
        if (req.file) fields.imageUrl = `/uploads/broadcasts/${req.file.filename}`;
        const msg = await update(req.params.id, req.user.id, fields);
        if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true, broadcast: msg });
      } catch (err) {
        res.status(400).json({ success: false, error: err.message });
      }
    });
    ```

    `DELETE /:id`:
    ```javascript
    router.delete('/:id', async (req, res) => {
      try {
        const msg = await remove(req.params.id, req.user.id);
        if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
    ```

    `PATCH /:id/enabled` — Toggle enabled state:
    Body: `{ enabled: true|false }` (boolean).
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

    `POST /:id/image` — Standalone image upload (replace image on existing record):
    Use `upload.single('image')` middleware.
    Fetch the record first to confirm ownership; then call update with imageUrl only.
    ```javascript
    router.post('/:id/image', upload.single('image'), async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ success: false, error: 'No image provided' });
        const imageUrl = `/uploads/broadcasts/${req.file.filename}`;
        const msg = await update(req.params.id, req.user.id, { imageUrl });
        if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true, broadcast: msg });
      } catch (err) {
        res.status(400).json({ success: false, error: err.message });
      }
    });
    ```

    `POST /:id/fire-now` — Stubbed delivery (Phase 2 wires real delivery):
    Follow the exact same fire-now pattern as `routes/schedules.js`: fetch record first to confirm existence and ownership, respond immediately, note Phase 2 TODO.
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

    **Multer error handler (MUST be last — after all routes):**
    Handles LIMIT_FILE_SIZE and Images-only errors that bypass route try/catch.
    ```javascript
    // eslint-disable-next-line no-unused-vars
    router.use((err, req, res, next) => {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, error: 'File too large (max 10 MB)' });
      }
      if (err.message === 'Images only') {
        return res.status(400).json({ success: false, error: 'Only image files are accepted' });
      }
      next(err);
    });
    ```

    **Export:**
    ```javascript
    module.exports = router;
    ```

    Style: 2-space indentation, single quotes, semicolons, ASCII section headers between logical groups (Upload Setup, Routes, Error Handler) — match `routes/schedules.js` conventions.
  </action>
  <verify>
    <automated>node -e "const r = require('./routes/broadcasts'); console.log(typeof r.handle === 'function' ? 'router OK' : 'not a router');"</automated>
    <manual>Check that public/uploads/broadcasts/ directory was created (ls public/uploads/broadcasts). Verify package.json lists multer in dependencies.</manual>
  </verify>
  <done>routes/broadcasts.js requires without error; multer is in package.json dependencies; public/uploads/broadcasts/ directory exists.</done>
</task>

<task type="auto">
  <name>Task 2: Mount /api/broadcasts in server.js</name>
  <files>server.js</files>
  <action>
    Add ONE line to `server.js` in the Protected API Routes section, after the existing route mounts (after the `/api/users` line, before the Static + SPA Fallback comment block):

    ```javascript
    app.use('/api/broadcasts', isAuthenticated, require('./routes/broadcasts'));
    ```

    Match the exact alignment and spacing style of the existing mount lines. Do NOT change any other line in server.js.
  </action>
  <verify>
    <automated>node -e "require('dotenv').config(); const app = require('./server'); console.log('server loads OK');" 2>&1 | head -5</automated>
    <manual>With server running (npm run dev), curl -s http://localhost:3000/api/broadcasts returns 401 (unauthenticated), confirming the route is mounted and protected.</manual>
  </verify>
  <done>server.js mounts /api/broadcasts with isAuthenticated middleware; `node server.js` starts without error; unauthenticated GET /api/broadcasts returns 401.</done>
</task>

</tasks>

<verification>
End-to-end smoke test (requires running server + valid session cookie):
1. `curl -X GET http://localhost:3000/api/broadcasts` → 401 (confirms mount + auth guard)
2. With valid session: `curl -X GET http://localhost:3000/api/broadcasts` → `{ success: true, broadcasts: [] }`
3. Create: `curl -X POST http://localhost:3000/api/broadcasts -H 'Content-Type: application/json' -d '{"label":"Test","text":"Hello","subjectId":"<valid-id>","recurrence":{"mode":"daily","hour":9}}'` → 201 with broadcast object containing `nextRunAt` field
4. Fire-now: `curl -X POST http://localhost:3000/api/broadcasts/<id>/fire-now` → `{ success: true, results: { whatsapp: { stubbed: true }, facebook: { stubbed: true } } }`
</verification>

<success_criteria>
- multer listed in package.json dependencies
- routes/broadcasts.js exports an Express router, requires without error
- server.js mounts /api/broadcasts with isAuthenticated
- GET /api/broadcasts returns 401 when unauthenticated
- All 8 endpoints (GET /, POST /, GET /:id, PUT /:id, DELETE /:id, PATCH /:id/enabled, POST /:id/image, POST /:id/fire-now) are registered in the router
- Multer error handler is the last middleware in the router
- public/uploads/broadcasts/ directory exists after requiring the route module
</success_criteria>

<output>
After completion, create `.planning/phases/01-backend-foundation/01-backend-foundation-03-SUMMARY.md` with:
- What was done
- Files created/modified
- Endpoints implemented
- Known limitations (fire-now is stubbed; image deletion edge cases)
- What Phase 2 needs to wire
</output>
