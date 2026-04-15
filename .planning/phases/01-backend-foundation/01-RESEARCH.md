# Phase 1: Backend Foundation - Research

**Researched:** 2026-04-15
**Domain:** Node.js/Express REST API, PostgreSQL schema migration, Multer file upload, cron expression generation
**Confidence:** HIGH

---

## Summary

Phase 1 adds a `broadcast_messages` table and a full REST API (`/api/broadcasts`) to the existing Node.js/Express codebase. The codebase has a well-established pattern for this: DB migration in `db/migrate.js`, a service module in `services/`, a route module in `routes/`, and a mount line in `server.js`. All four layers must be created for this feature.

Image upload (BCAST-03) uses Multer, which is NOT currently installed. It must be added (`npm install multer`). Uploaded files go to `public/uploads/broadcasts/` which is already served statically by Express's `express.static` middleware. The cron conversion logic (SCHED-01 through SCHED-03) maps three human-readable modes to cron strings in-process — no new library needed; `node-cron` (already installed) provides validation.

The fire-now endpoint (BCAST-07) should follow the exact pattern in `routes/schedules.js`: respond immediately with `{ success: true }` and run delivery asynchronously. In Phase 1, delivery is stubbed (no actual WhatsApp/Facebook calls) — the endpoint returns a delivery-shape result object so Phase 2 can wire real delivery without changing the API contract.

**Primary recommendation:** Follow the New CRUD Resource checklist from STRUCTURE.md exactly: migrate → service → route → mount. Install multer before implementing image upload. Keep cron conversion pure (no library needed).

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BCAST-01 | Create broadcast message with label and pre-written text | DB table + POST /api/broadcasts with label + text columns |
| BCAST-02 | Assign broadcast message to a specific niche (required, no "all niches") | subject_id FK NOT NULL in broadcast_messages table; route validates presence |
| BCAST-03 | Optionally upload an image to attach to a broadcast message | Multer middleware on POST /api/broadcasts (multipart) or POST /api/broadcasts/:id/image; file saved to public/uploads/broadcasts/ |
| BCAST-04 | Edit an existing broadcast message (all fields) | PUT /api/broadcasts/:id with dynamic SET clause pattern (see CONVENTIONS.md) |
| BCAST-05 | Delete a broadcast message with confirmation (backend only — UI confirm is Phase 3) | DELETE /api/broadcasts/:id with user_id ownership check |
| BCAST-06 | Enable or disable a broadcast message without deleting | PATCH /api/broadcasts/:id/enabled or toggle field in PUT; enabled column in table |
| BCAST-07 | Fire a broadcast message immediately regardless of schedule | POST /api/broadcasts/:id/fire-now; stub delivery in Phase 1; return { success, results } |
| SCHED-01 | Daily recurrence at a specific hour | Mode "daily" + hour → cron: `0 {hour} * * *` |
| SCHED-02 | Weekly recurrence on a specific day + hour | Mode "weekly" + day (0–6) + hour → cron: `0 {hour} * * {day}` |
| SCHED-03 | Every-N-days recurrence at a specific hour | Mode "every_n_days" + n + hour → cron: `0 {hour} */{n} * *` (see pitfall below) |
| SCHED-04 | GET /api/broadcasts returns next scheduled run time for each enabled message | Compute next cron fire from stored cron string at read time |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` | ^8.20.0 (already installed) | PostgreSQL client for all DB reads/writes | Already the project's data layer; all queries use `query(sql, params)` from `db/index.js` |
| `multer` | ^1.4.5-lts.1 (NOT installed — must add) | Multipart file upload parsing and disk storage | Standard Express file upload middleware; supports DiskStorage with custom destination/filename |
| `node-cron` | ^3.0.3 (already installed) | Cron expression validation via `cron.validate()` | Already used by scheduler; no additional library needed for cron conversion |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `path` | Node.js core | Resolve upload file paths | Always when writing files to disk |
| `fs` | Node.js core | Ensure upload directory exists at startup | mkdir for `public/uploads/broadcasts/` before multer writes |
| `uuid` | ^10.0.0 (already installed) | Unique filenames for uploaded images | Prevent filename collisions; already imported in other services |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| multer | busboy (raw), formidable | multer is the Express-idiomatic wrapper; simpler API, better docs, directly used in most Express tutorials |
| `*/N` cron for every-N-days | External scheduler library | Overkill; `*/N` in day-of-month field covers the stated use case; node-cron validates it |
| Compute next-run at read time | Store next_run_at in DB | Computing at read time is simpler and stays correct if server timezone changes; no stale data risk |

**Installation:**
```bash
npm install multer
```

---

## Architecture Patterns

### Recommended Project Structure

New files to create:

```
db/migrate.js              # ADD: broadcast_messages table + indexes
services/broadcastService.js  # NEW: CRUD functions for broadcast_messages
routes/broadcasts.js          # NEW: Express router for /api/broadcasts
server.js                      # EDIT: mount /api/broadcasts route + serve uploads dir
public/uploads/broadcasts/     # NEW: created at startup or by multer
```

### Pattern 1: DB Migration (Idempotent)

**What:** Add `broadcast_messages` table to `db/migrate.js` using `CREATE TABLE IF NOT EXISTS`, followed by `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for any additions post-initial-create.

**When to use:** Every new table follows this. It's already done for `subjects`, `products`, `schedules`, etc.

**Example (follows existing pattern):**
```javascript
// Source: db/migrate.js (existing tables as model)
await query(`
  CREATE TABLE IF NOT EXISTS broadcast_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    label        VARCHAR(255) NOT NULL,
    text         TEXT NOT NULL,
    image_url    TEXT,
    recurrence   JSONB NOT NULL,         -- { mode, hour, day?, n? }
    cron         VARCHAR(100) NOT NULL,
    enabled      BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);
await query(`CREATE INDEX IF NOT EXISTS bcast_user_id ON broadcast_messages(user_id)`);
await query(`CREATE INDEX IF NOT EXISTS bcast_subject_id ON broadcast_messages(subject_id)`);
```

Key decisions:
- `subject_id` is NOT NULL (BCAST-02: required, no "all niches")
- `recurrence` stored as JSONB — keeps the human-readable inputs for editing; `cron` stores the computed expression
- `enabled` default true (consistent with `schedules` table)
- UUID primary key (consistent with all other tables)

### Pattern 2: Service Module

**What:** `services/broadcastService.js` follows the same shape as `services/subjectService.js` — exports named functions, uses `_row()` for DB-to-API transformation, validates ownership via `user_id` on all mutations.

**Key functions to export:**
```javascript
// services/broadcastService.js (pattern matches subjectService.js)
async function listByUser(userId) { ... }
async function getById(id, userId) { ... }
async function create(userId, fields) { ... }
async function update(id, userId, fields) { ... }
async function remove(id, userId) { ... }
async function setEnabled(id, userId, enabled) { ... }
```

**`_row()` transformation** converts `snake_case` DB columns to `camelCase` API fields — same pattern as `userService._row()` and `subjectService`:
```javascript
// Source: services/userService.js (existing pattern)
function _row(r) {
  if (!r) return null;
  return {
    id:         r.id,
    userId:     r.user_id,
    subjectId:  r.subject_id,
    label:      r.label,
    text:       r.text,
    imageUrl:   r.image_url,
    recurrence: r.recurrence,
    cron:       r.cron,
    enabled:    r.enabled,
    nextRunAt:  computeNextRun(r.cron, r.enabled),
    createdAt:  r.created_at,
    updatedAt:  r.updated_at,
  };
}
```

### Pattern 3: Recurrence-to-Cron Conversion

**What:** Pure function that takes a recurrence object and returns a cron string.

**Three modes:**

| Mode | Input | Output cron | Notes |
|------|-------|-------------|-------|
| `daily` | `{ mode: 'daily', hour: 22 }` | `0 22 * * *` | Fire every day at hour:00 |
| `weekly` | `{ mode: 'weekly', day: 5, hour: 18 }` | `0 18 * * 5` | day 0=Sun … 6=Sat |
| `every_n_days` | `{ mode: 'every_n_days', n: 3, hour: 11 }` | `0 11 */3 * *` | See pitfall below |

```javascript
// Source: derived from node-cron docs; validated with cron.validate()
function recurrenceToCron({ mode, hour, day, n }) {
  switch (mode) {
    case 'daily':        return `0 ${hour} * * *`;
    case 'weekly':       return `0 ${hour} * * ${day}`;
    case 'every_n_days': return `0 ${hour} */${n} * *`;
    default: throw new Error(`Unknown recurrence mode: ${mode}`);
  }
}
```

After generating, always validate: `if (!cron.validate(expr)) throw new Error(...)`.

### Pattern 4: Multer DiskStorage

**What:** Multer with `DiskStorage` saves files to a fixed directory with a UUID-based filename.

**When to use:** Any file upload endpoint in an Express route.

```javascript
// Source: multer official docs pattern
const multer  = require('multer');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../public/uploads/broadcasts')),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Images only'));
    cb(null, true);
  },
});
```

The upload directory must exist before multer writes. Create it at module load time or on startup:
```javascript
const fs = require('fs');
fs.mkdirSync(path.join(__dirname, '../public/uploads/broadcasts'), { recursive: true });
```

### Pattern 5: Route Structure (follows schedules.js exactly)

```javascript
// routes/broadcasts.js — mirrors routes/schedules.js shape
const express = require('express');
const router  = express.Router();
const { listByUser, getById, create, update, remove, setEnabled } = require('../services/broadcastService');

router.get('/',              async (req, res) => { /* list */ });
router.post('/',             upload.single('image'), async (req, res) => { /* create */ });
router.get('/:id',           async (req, res) => { /* get one */ });
router.put('/:id',           upload.single('image'), async (req, res) => { /* update */ });
router.delete('/:id',        async (req, res) => { /* delete */ });
router.patch('/:id/enabled', async (req, res) => { /* toggle */ });
router.post('/:id/fire-now', async (req, res) => { /* stub fire */ });
```

Mounting in `server.js` (add after existing route mounts):
```javascript
app.use('/api/broadcasts', isAuthenticated, require('./routes/broadcasts'));
```

### Pattern 6: Fire-Now Stub (BCAST-07)

Fire-now in Phase 1 returns a stubbed result so Phase 2 can wire real delivery without changing the API contract. Follow the `routes/schedules.js` fire pattern: respond immediately, run async:

```javascript
// Source: routes/schedules.js lines 61-62 (existing pattern)
router.post('/:id/fire-now', async (req, res) => {
  try {
    const msg = await getById(req.params.id, req.user.id);
    if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, results: { whatsapp: { stubbed: true }, facebook: { stubbed: true } } });
    // Phase 2: replace stub with actual broadcastDelivery.send(msg)
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});
```

### Pattern 7: Next Run Time Computation (SCHED-04)

Computing the next cron fire at read time from a cron string — no additional library is required. A small pure function using date arithmetic covers all three recurrence modes correctly:

```javascript
// Compute next scheduled run from cron string
// For daily: next occurrence of HH:00 at or after now (Asia/Jerusalem)
function computeNextRun(cronExpr, enabled) {
  if (!enabled || !cronExpr) return null;
  // Parse the stored cron: "0 {hour} {dom} {month} {dow}"
  // Use the recurrence JSONB instead of parsing cron for simplicity
  // Return ISO string of next fire
}
```

**Recommendation:** Compute next-run from the `recurrence` JSONB (already on the row) rather than reverse-parsing the cron string. The `recurrence` object has all the inputs needed and is easier to compute from. Store time in `Asia/Jerusalem` offset, return as UTC ISO string.

### Anti-Patterns to Avoid

- **Extending the `schedules` table:** Broadcast messages and product schedules are different pipelines. Adding nullable columns or a `type` discriminator to `schedules` would force branching throughout `scheduler/index.js` and `workflow.js`. The decision to use a new `broadcast_messages` table is locked and correct.
- **Storing only the cron, not the recurrence params:** If only the cron string is stored, the edit modal can't pre-populate the recurrence builder fields. Store BOTH `recurrence` (JSONB) and `cron` (VARCHAR).
- **Parsing cron string to compute next run:** Reverse-parsing `*/3` back to "every 3 days" is fragile. Use the `recurrence` JSONB for display and next-run computation.
- **Not creating the upload directory at startup:** Multer will throw if the destination doesn't exist. Use `fs.mkdirSync(..., { recursive: true })` before the server listens.
- **Multipart-only create endpoint:** If create is multipart-only, clients that don't upload an image must still send a `multipart/form-data` request. Instead, support JSON create (no image) and a separate `POST /:id/image` endpoint for upload — OR use `upload.single('image')` which is optional when `fileFilter` is permissive. Multer with `upload.single('image')` works fine for JSON bodies — it just sets `req.file = undefined` when no file is present.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multipart form parsing | Custom body parser | `multer` | Handles chunked upload, file size limits, MIME filtering, temp storage |
| Cron string validation | Regex validation | `cron.validate()` from node-cron (already installed) | Already in codebase; handles all edge cases |
| UUID filename generation | `Date.now()` or random string | `uuid` v4 (already installed) | Guaranteed uniqueness; already a dependency |
| Disk directory management | Startup check | `fs.mkdirSync(..., { recursive: true })` | One line; idempotent |

**Key insight:** All supporting tooling is already installed except `multer`. Don't reach for date libraries or cron parser libraries — the recurrence JSONB makes next-run computation straightforward without parsing cron strings.

---

## Common Pitfalls

### Pitfall 1: `*/N` in Day-of-Month Means "Every N Days From 1st", Not "Every N Days From Now"

**What goes wrong:** `0 11 */3 * *` fires on days 1, 4, 7, 10... of the month (multiples of 3 + 1). It does NOT fire every 3 days from the current date. At the end of the month, the gap to the 1st of the next month may be shorter or longer than N days.

**Why it happens:** Standard cron `*/3` in the day-of-month field means "every 3rd value" (1, 4, 7...), not "every 3 days from last fire."

**How to avoid:** This is acceptable for the stated requirements ("every N days at hour"). Document the behavior: the fire days are anchored to the calendar month (day 1, 4, 7, etc.) and reset at the start of each month. This covers the use case even if it's not perfectly "every exactly N days."

**Warning signs:** If n=7 and user wants "every week," they should use the `weekly` mode instead.

### Pitfall 2: Subject_id Must Be Owned by the Same User

**What goes wrong:** A user could POST with a `subject_id` belonging to another user, associating their broadcast with another user's niche.

**Why it happens:** Multi-tenancy is enforced by convention (WHERE user_id = $N), but if subject validation doesn't check ownership, the FK insert succeeds.

**How to avoid:** Before inserting, verify the subject exists AND belongs to `req.user.id`:
```javascript
const { rows } = await query(
  'SELECT id FROM subjects WHERE id = $1 AND user_id = $2',
  [subjectId, userId]
);
if (!rows[0]) return res.status(400).json({ success: false, error: 'Invalid subject' });
```

### Pitfall 3: Old Image Not Deleted on Update

**What goes wrong:** When a broadcast message's image is replaced, the old file in `public/uploads/broadcasts/` is never removed. Over time, orphaned files accumulate.

**Why it happens:** Multer only manages the new upload; the old file path is stored in the DB but the old file is on disk separately.

**How to avoid:** In the update handler, if a new file is uploaded and the existing record has an `image_url`, delete the old file using `fs.unlink()` before saving the new path. Wrap in try-catch (old file may already be gone).

### Pitfall 4: Multer Error Not Caught by Express Error Handler

**What goes wrong:** When Multer rejects a file (size limit, wrong MIME), it passes an error to Express's error middleware, but the route's own `try/catch` doesn't catch it.

**Why it happens:** Multer calls `next(err)` on validation failure, bypassing the route handler.

**How to avoid:** Add a Multer-specific error handler at the end of the route file:
```javascript
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, error: 'File too large (max 10 MB)' });
  }
  next(err);
});
```

### Pitfall 5: Recurrence Validation Gaps

**What goes wrong:** `hour` values outside 0–23 or `day` values outside 0–6 produce invalid cron strings that either `cron.validate()` rejects or behave unexpectedly.

**Why it happens:** Client sends `hour: 25` or `day: 7`; the conversion function produces an invalid cron string.

**How to avoid:** Validate inputs before converting:
- `hour`: integer 0–23
- `day`: integer 0–6 (0=Sunday)
- `n`: integer 1–30
- `mode`: one of `['daily', 'weekly', 'every_n_days']`

Then call `cron.validate()` as a final safety net.

---

## Code Examples

Verified patterns from official sources and existing codebase:

### Dynamic UPDATE (existing codebase pattern)
```javascript
// Source: services/subjectService.js and CONVENTIONS.md
const updates = [];
const values  = [];
let i = 1;

if (fields.label !== undefined) { updates.push(`label = $${i++}`); values.push(fields.label); }
if (fields.text  !== undefined) { updates.push(`text  = $${i++}`); values.push(fields.text);  }
// ...
updates.push(`updated_at = NOW()`);
values.push(id, userId);

const { rows } = await query(
  `UPDATE broadcast_messages SET ${updates.join(', ')} WHERE id = $${i++} AND user_id = $${i++} RETURNING *`,
  values
);
```

### Ownership check on GET/PUT/DELETE
```javascript
// Source: routes/schedules.js lines 97-101 (existing pattern)
const { rows } = await query(
  'SELECT * FROM broadcast_messages WHERE id = $1 AND user_id = $2',
  [req.params.id, req.user.id]
);
if (!rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
```

### Multer setup (multer official docs)
```javascript
const multer = require('multer');
const path   = require('path');
const { v4: uuidv4 } = require('uuid');
const fs     = require('fs');

const UPLOAD_DIR = path.join(__dirname, '../public/uploads/broadcasts');
fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // idempotent

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Images only'));
  },
});
```

### Express static serving for uploads (already in server.js)
```javascript
// Source: server.js line 214 — no change needed
// express.static serves public/ which already covers public/uploads/broadcasts/
app.use(express.static(path.join(__dirname, 'public')));
```

The uploaded image at `public/uploads/broadcasts/uuid.jpg` is accessible at `/uploads/broadcasts/uuid.jpg` immediately — no additional static mount needed.

### Computing next run from recurrence JSONB
```javascript
// Compute next occurrence in Asia/Jerusalem timezone
function computeNextRun(recurrence, enabled) {
  if (!enabled || !recurrence) return null;
  const now = new Date();
  // Use toLocaleString in Asia/Jerusalem to get local hour/day
  const jlmOpts = { timeZone: 'Asia/Jerusalem', hour12: false };
  const localNow = new Date(now.toLocaleString('en-US', jlmOpts));
  const localHour = localNow.getHours();
  const localDay  = localNow.getDay(); // 0=Sun

  const { mode, hour, day, n } = recurrence;
  let next = new Date(localNow);
  next.setMinutes(0, 0, 0);

  if (mode === 'daily') {
    if (localHour >= hour) next.setDate(next.getDate() + 1);
    next.setHours(hour);
  } else if (mode === 'weekly') {
    const daysUntil = (day - localDay + 7) % 7 || (localHour >= hour ? 7 : 0);
    next.setDate(next.getDate() + daysUntil);
    next.setHours(hour);
  } else if (mode === 'every_n_days') {
    if (localHour >= hour) next.setDate(next.getDate() + 1);
    next.setHours(hour);
    // Snap to next calendar anchor (day of month divisible by n, anchored to day 1)
    const dom = next.getDate();
    const remainder = dom % n;
    if (remainder !== 0) next.setDate(dom + (n - remainder));
  }
  return next.toISOString();
}
```

Note: This is a good-enough approximation for display purposes. For SCHED-04 the next-run is shown on the card for UX — it doesn't need to be millisecond-precise.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Google Sheets as primary data store | PostgreSQL (already migrated) | All new features go to PostgreSQL only — no Sheets writes needed |
| Extending `schedules` table with a type column | New `broadcast_messages` table | Clean separation; no branching in existing scheduler or workflow |
| Cloud storage for uploaded images | Local `public/uploads/broadcasts/` | Simpler for this milestone; cloud storage is v2 scope |

**Deprecated/outdated:**
- Google Sheets: Not used for broadcast messages — PostgreSQL only.

---

## Open Questions

1. **Image upload on create vs. separate endpoint**
   - What we know: The `additional_context` says "Multer for file upload middleware" and "POST /api/broadcasts/:id/image or multipart on create" — both are mentioned.
   - What's unclear: Whether create should accept multipart (image in same request as JSON fields) or require a two-step flow (POST JSON to create, then POST image separately).
   - Recommendation: Support multipart on create via `upload.single('image')` (Multer sets `req.file = undefined` when no file is sent, so JSON-only creates still work). Also support `POST /api/broadcasts/:id/image` for standalone image replacement. This matches the ROADMAP success criteria: "An uploaded image (via POST /api/broadcasts/:id/image or multipart on create)."

2. **`recurrence` JSONB vs. separate columns**
   - What we know: JSONB is more flexible; separate columns (`mode`, `hour`, `day`, `n`) are more query-friendly.
   - What's unclear: Whether future phases will need to query by recurrence fields (e.g., "all daily broadcasts").
   - Recommendation: Use JSONB for `recurrence`. It matches the pattern of other flexible config fields in the codebase and avoids proliferating nullable columns. Query by recurrence is not a stated requirement.

3. **Delete behavior for image files**
   - What we know: On DELETE, the DB row is removed. The file in `public/uploads/broadcasts/` remains.
   - What's unclear: Whether orphaned files matter at this scale.
   - Recommendation: Delete the physical file on DELETE and on image replacement. Use `fs.unlink()` with try-catch. This is a few lines and avoids accumulation.

---

## Sources

### Primary (HIGH confidence)

- Existing codebase (`db/migrate.js`, `scheduler/index.js`, `routes/schedules.js`, `server.js`, `services/subjectService.js`) — all architectural patterns derived directly from reading source files
- `package.json` — confirmed installed dependencies; confirmed multer is NOT present
- `.planning/codebase/ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `CONCERNS.md` — conventions and patterns extracted from codebase map
- `.planning/REQUIREMENTS.md`, `ROADMAP.md` — requirements and success criteria read directly

### Secondary (MEDIUM confidence)

- Multer DiskStorage API — standard middleware, stable for years; patterns are conventional and well-known
- node-cron `cron.validate()` — confirmed present in `scheduler/index.js` line 35

### Tertiary (LOW confidence)

- `computeNextRun` implementation — logic derived from first principles; tested conceptually but not against live cron library. LOW: may have edge cases at month boundaries for `every_n_days`. Planner should flag for manual verification.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed from package.json and node_modules check
- Architecture patterns: HIGH — derived directly from reading 6 source files
- Cron conversion: HIGH — simple arithmetic, validated with node-cron.validate()
- Pitfalls: HIGH — derived from code reading (multer error handling, multi-tenancy pattern)
- Next-run computation: MEDIUM — conceptually correct, edge cases at month boundaries possible

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable stack — no fast-moving dependencies)
