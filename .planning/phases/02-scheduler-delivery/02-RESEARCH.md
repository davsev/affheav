# Phase 2: Scheduler & Delivery — Research

**Researched:** 2026-04-15
**Domain:** node-cron scheduler extension, broadcast delivery (Facebook Graph API + MacroDroid webhook), failure isolation
**Confidence:** HIGH

---

## Summary

Phase 2 wires the broadcast delivery pipeline: cron-scheduled broadcast jobs fire and send text (+ optional image) to the niche's WhatsApp group via MacroDroid webhook and to the niche's Facebook page via Graph API. Both delivery services already exist in the codebase (`services/facebook.js`, `services/whatsapp.js`) — Phase 2 is an integration layer, not a new service build.

The core work is two parallel tracks. First: extend `scheduler/index.js` to load `broadcast_messages` alongside product schedules on startup. Second: implement real delivery in `broadcastDelivery.js` (a new thin service) and wire it into the fire-now endpoint in `routes/broadcasts.js` (replacing the Phase 1 stub). The scheduler extension must be additive — the existing `activeJobs` map and product schedule behavior must not be touched.

Subject credential resolution (macrodroid_url, facebook_page_id, facebook_token) already has a proven pattern via `getSubjectById(subjectId, userId)` in `services/subjectService.js`. Broadcast delivery follows this same pattern exactly. Failure isolation between Facebook and WhatsApp is already the codebase norm (workflow.js wraps each platform in try-catch independently) — the same pattern applies here.

**Primary recommendation:** Create `services/broadcastDelivery.js` as a thin orchestrator (not workflow.js) that calls existing whatsapp.send() and facebook.postPhoto() with subject credentials, wraps each in independent try-catch, and returns per-platform results. Wire it into both: (1) the fire-now route handler in `routes/broadcasts.js` and (2) a new `runBroadcastJob()` function in `scheduler/index.js`.

> **Prerequisite:** Phase 2 assumes Phase 1 is complete. As of research date, `services/broadcastService.js` and `routes/broadcasts.js` do NOT yet exist. Phase 2 planning must treat these as hard dependencies and cannot be executed before Phase 1 is done.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DLVR-01 | Scheduled broadcast sends text (+ optional image) to the niche's Facebook page via Graph API | `facebook.postPhoto({ message, imageUrl, facebookPageId, facebookToken })` already exists; subject credentials from `getSubjectById()`; image sent as absolute URL |
| DLVR-02 | Scheduled broadcast sends text (+ optional image) to the niche's WhatsApp group via MacroDroid webhook | `whatsapp.send({ text, image, wa_group, webhookUrl })` already exists; WhatsApp groups from `getGroupsBySubject()`; image sent as absolute URL in `image` param |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node-cron` | ^3.0.3 (already installed) | Schedule broadcast jobs on cron expression | Already used by scheduler/index.js; `cron.schedule()` + `cron.validate()` are the project standard |
| `axios` | already installed | HTTP calls to Facebook Graph API and MacroDroid webhook | Already used by both `services/facebook.js` and `services/whatsapp.js` |
| `pg` | ^8.20.0 (already installed) | Load enabled broadcast_messages on startup | Already the project data layer |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `path` | Node.js core | Construct image URL from stored filename | When broadcast has image_url (filename), must build absolute URL for Facebook/WhatsApp |
| `services/subjectService.js` | internal | Resolve subject credentials (macrodroid_url, facebook_page_id, facebook_token, groups) | Every delivery call needs subject creds; DO NOT inline DB queries |

### No New Dependencies

No new npm packages are required for Phase 2. All delivery, scheduling, and credential resolution is already available in the existing codebase.

**Installation:**
```bash
# None — no new packages needed
```

---

## Architecture Patterns

### Recommended New Files

```
services/broadcastDelivery.js  # NEW: thin delivery orchestrator for broadcast messages
scheduler/index.js              # EDIT: extend startAll() + add runBroadcastJob()
routes/broadcasts.js            # EDIT: replace fire-now stub with real delivery call
```

### Pattern 1: Broadcast Delivery Service

**What:** A thin service that takes a broadcast_message record + subject config and sends to WhatsApp groups and Facebook. Does NOT touch workflow.js (different pipeline). Wraps each platform in independent try-catch.

**When to use:** Called from fire-now route AND from cron trigger in scheduler.

```javascript
// services/broadcastDelivery.js
const { getSubjectById, getGroupsBySubject } = require('./subjectService');
const whatsapp = require('./whatsapp');
const facebook = require('./facebook');

// Build absolute image URL from stored filename (if image present)
function buildImageUrl(imageUrl) {
  if (!imageUrl) return null;
  // If already an absolute URL, return as-is
  if (imageUrl.startsWith('http')) return imageUrl;
  // Stored as relative path like "uploads/broadcasts/uuid.jpg"
  const base = process.env.APP_BASE_URL || 'http://localhost:3000';
  return `${base}/${imageUrl.replace(/^\//, '')}`;
}

async function send(broadcast, userId) {
  // broadcast = row from broadcast_messages: { id, user_id, subject_id, label, text, image_url, cron, recurrence, enabled }
  const subject = await getSubjectById(broadcast.subject_id, userId);
  if (!subject) throw new Error(`Subject not found: ${broadcast.subject_id}`);

  const imageUrl = buildImageUrl(broadcast.image_url);
  const results  = { whatsapp: null, facebook: null };

  // WhatsApp — send to all groups for this subject
  try {
    const groups = await getGroupsBySubject(broadcast.subject_id, userId);
    if (groups.length === 0) {
      results.whatsapp = { success: false, error: 'No WhatsApp groups configured' };
    } else {
      results.whatsapp = [];
      for (let i = 0; i < groups.length; i++) {
        if (i > 0) await sleep(WA_GROUP_DELAY_MS);
        const g = groups[i];
        try {
          const r = await whatsapp.send({
            text:       broadcast.text,
            image:      imageUrl,
            wa_group:   g.waGroup,
            webhookUrl: subject.macrodroidUrl || null,
          });
          results.whatsapp.push({ group: g.name, ...r });
        } catch (err) {
          results.whatsapp.push({ group: g.name, success: false, error: err.message });
        }
      }
    }
  } catch (err) {
    results.whatsapp = { success: false, error: err.message };
  }

  // Facebook — independent of WhatsApp result
  try {
    const fbResult = await facebook.postPhoto({
      message:        broadcast.text,
      imageUrl:       imageUrl,
      facebookPageId: subject.facebookPageId || null,
      facebookToken:  subject.facebookToken  || null,
    });
    results.facebook = fbResult;
  } catch (err) {
    results.facebook = { success: false, error: err.message };
  }

  return results;
}

const WA_GROUP_DELAY_MS = 2 * 60 * 1000;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { send };
```

**Key design decisions:**
- `userId` is passed explicitly (never derived from broadcast row alone — ensures ownership)
- WhatsApp and Facebook are fully independent try-catch blocks (Facebook failure never blocks WhatsApp reporting)
- Image URL is built from `APP_BASE_URL` + stored path — Facebook Graph API requires an absolute public URL
- WA_GROUP_DELAY_MS matches the 2-minute delay used in `workflow.js` (existing behavior)

### Pattern 2: Scheduler Extension (additive)

**What:** Extend `scheduler/index.js` to load broadcast jobs alongside product jobs. The key constraint is: **the existing `activeJobs` map and product schedule loading must not change**. Broadcast jobs go into a separate `activeBroadcastJobs` map.

**When to use:** On `startAll()` (server startup) and any time a broadcast message is enabled or its schedule changes.

```javascript
// scheduler/index.js — additions only

let activeBroadcastJobs = {}; // broadcastId → cron.ScheduledTask
let _runBroadcastDelivery = null; // injected from server.js

function setBroadcastRunner(fn) { _runBroadcastDelivery = fn; }

// Inside startAll() — after existing product schedule loading
async function startBroadcasts() {
  // Stop existing broadcast jobs
  for (const job of Object.values(activeBroadcastJobs)) job.stop();
  activeBroadcastJobs = {};

  let broadcasts = [];
  try {
    const { rows } = await query('SELECT * FROM broadcast_messages WHERE enabled = true');
    broadcasts = rows;
  } catch (err) {
    log(`Could not load broadcast_messages: ${err.message}`, 'warn');
    return 0;
  }

  for (const b of broadcasts) {
    if (!cron.validate(b.cron)) {
      log(`Invalid cron for broadcast "${b.label}": "${b.cron}"`, 'warn');
      continue;
    }
    activeBroadcastJobs[b.id] = cron.schedule(b.cron, () => runBroadcastJob(b), { timezone: 'Asia/Jerusalem' });
    log(`Broadcast registered: "${b.label}" → ${b.cron}`);
  }
  return broadcasts.length;
}

async function runBroadcastJob(b) {
  log(`Firing broadcast: "${b.label}" (${b.cron})`);
  if (_runBroadcastDelivery) {
    try {
      await _runBroadcastDelivery({ broadcastId: b.id, userId: b.user_id });
    } catch (err) {
      log(`Broadcast error in job "${b.label}": ${err.message}`, 'error');
    }
  } else {
    log('No broadcast runner registered — job skipped', 'warn');
  }
}

async function fireBroadcastNow(id, userId) {
  const { rows } = await query(
    'SELECT * FROM broadcast_messages WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  if (!rows[0]) throw new Error(`Broadcast not found: ${id}`);
  await runBroadcastJob(rows[0]);
}
```

**Wire in server.js** (alongside existing scheduler setup):
```javascript
// server.js — after existing scheduler.setWorkflowRunner(...)
const broadcastDelivery = require('./services/broadcastDelivery');
scheduler.setBroadcastRunner(async ({ broadcastId, userId }) => {
  const { rows } = await require('./db').query(
    'SELECT * FROM broadcast_messages WHERE id = $1 AND user_id = $2',
    [broadcastId, userId]
  );
  if (rows[0]) await broadcastDelivery.send(rows[0], userId);
});
await scheduler.startBroadcasts();
```

**Alternative (simpler):** Pass the full broadcast row into the runner at scheduling time (store in closure). This avoids a DB re-fetch on cron fire. Pattern: `cron.schedule(b.cron, () => runBroadcastJob(b), ...)` — `b` is already the full row, closure-captured. The runner in server.js then calls `broadcastDelivery.send(b, b.user_id)` directly. This is the recommended approach — fewer moving parts.

### Pattern 3: Fire-Now Route Replacement

**What:** In `routes/broadcasts.js`, replace the Phase 1 stub in `POST /:id/fire-now` with a real call to `broadcastDelivery.send()`. The API contract (response shape) set by Phase 1 does not change.

```javascript
// routes/broadcasts.js (replace stub)
const broadcastDelivery = require('../services/broadcastDelivery');

router.post('/:id/fire-now', async (req, res) => {
  try {
    const msg = await broadcastService.getById(req.params.id, req.user.id);
    if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
    // Fire async — respond immediately (matches existing schedules.js pattern)
    res.json({ success: true, fired: true });
    broadcastDelivery.send(msg, req.user.id).catch(err => {
      log(`fire-now error for broadcast ${msg.id}: ${err.message}`, 'error');
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});
```

Note: `broadcastService.getById()` returns a camelCase object (from Phase 1's `_row()` transform). `broadcastDelivery.send()` must accept this shape OR accept the raw DB row. Since scheduler passes the raw DB row (from query), and fire-now passes the service's camelCase row — the delivery service must normalize. **Recommendation:** have `broadcastDelivery.send()` accept either, or define an internal normalizer. Simpler: scheduler calls service to get the row, passes camelCase to delivery — same shape.

### Pattern 4: Image URL Construction

**What:** `broadcast_messages.image_url` stores the relative path set by Multer (e.g., `"uploads/broadcasts/uuid.jpg"`). Facebook Graph API requires a publicly accessible absolute URL. MacroDroid webhook's `image` param is also a URL.

**How:** Construct absolute URL at delivery time using `APP_BASE_URL`:
```javascript
function buildImageUrl(imageUrl) {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('http')) return imageUrl;  // already absolute
  const base = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/${imageUrl.replace(/^\//, '')}`;
}
```

**Why this is correct:** `public/uploads/broadcasts/` is served by Express's `express.static('public')` mount on `server.js` line 214. Files at `public/uploads/broadcasts/uuid.jpg` are accessible at `/uploads/broadcasts/uuid.jpg` from the server's base URL. In production, `APP_BASE_URL` is set to the Railway URL.

**Pitfall:** In development (localhost:3000), Facebook cannot fetch a localhost URL — image posts will fail. This is expected behavior. For development testing, use a broadcast message with no image, or use a publicly accessible image URL.

### Pattern 5: startAll() Integration

**What:** `scheduler.startAll()` currently loads ONLY product schedules. Phase 2 extends it to also load broadcast jobs. Two options:

**Option A (Recommended):** Call `startBroadcasts()` from inside the extended `startAll()`:
```javascript
async function startAll() {
  // ... existing product schedule loading ...
  await startBroadcasts(); // NEW — additive
  return schedules.length;
}
```

**Option B:** Call `startBroadcasts()` separately from `server.js` after `startAll()`.

Option A is cleaner — one call site (`scheduler.startAll()`), no coordination needed in `server.js`. The existing `stopAll()` would need a companion `stopBroadcasts()` or the stop logic merged.

### Anti-Patterns to Avoid

- **Adding broadcast delivery into `workflow.js`:** workflow.js is the product pipeline. Broadcast messages are a separate pipeline. Adding a branch like `if (broadcast) { ... } else { ... }` in workflow.js creates tight coupling and breaks the clean separation. Use a new `broadcastDelivery.js`.
- **Using the same `activeJobs` map for both product schedules and broadcast jobs:** They have different IDs (same UUID space) and different execution logic. Using separate maps (`activeJobs` for product schedules, `activeBroadcastJobs` for broadcasts) avoids collision risk and keeps restart/stop logic clean.
- **Re-fetching subject on every cron tick without caching:** Each broadcast cron fire calls `getSubjectById()`. This is one DB query per fire — acceptable. Don't cache the subject object in the scheduler closure across ticks (credentials may change).
- **Forgetting to reload broadcast jobs after enable/disable toggling:** When a broadcast is toggled enabled/disabled or edited via the API, the in-memory cron job must be updated. Follow the existing `startAll()` pattern: call `startBroadcasts()` after any broadcast CRUD mutation (same as `scheduler.add()` and `scheduler.update()` call `startAll()`).
- **Facebook text-only post vs. photo post:** `facebook.postPhoto()` posts to `/{pageId}/photos` which requires an `imageUrl`. If `broadcast.image_url` is null, `imageUrl` will be null — test whether `postPhoto` handles this gracefully. Looking at `facebook.js` line 46: `url: imageUrl` is passed as a query param. Facebook may reject a photo post with no URL. **Fix:** If no image, use a different endpoint or skip Facebook photo post and use a text-only post instead.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WhatsApp delivery | Custom webhook caller | `whatsapp.send()` (existing) | Already handles response parsing, OK detection, logging |
| Facebook delivery | Custom Graph API call | `facebook.postPhoto()` (existing) | Already handles auth, error parsing, timeout |
| Subject credential resolution | Inline DB query | `getSubjectById()` (existing) | Handles camelCase transform, ownership check |
| Group resolution | Custom query | `getGroupsBySubject()` (existing) | Returns array of group objects with waGroup field |
| Cron job registration | Custom timer | `cron.schedule()` (node-cron, existing) | Already validates expressions, handles timezone |

**Key insight:** Phase 2 is almost entirely integration work — no new protocols or services. The heavy lifting (Facebook API, MacroDroid, cron) is already built. The new code is a thin orchestration layer.

---

## Common Pitfalls

### Pitfall 1: Facebook text-only broadcast (no image)

**What goes wrong:** `facebook.postPhoto()` posts to `/{pageId}/photos` with `url: imageUrl`. If `imageUrl` is null, Facebook returns an error (photos endpoint requires a URL or uploaded binary). Broadcasts without images fail on Facebook.

**Why it happens:** The existing `facebook.postPhoto()` function was designed for products which always have an image URL. Broadcast messages have an optional image.

**How to avoid:** In `broadcastDelivery.js`, check if `imageUrl` is present. If present, use `facebook.postPhoto()`. If absent, use a text-only post to `/{pageId}/feed` endpoint:
```javascript
// Text-only Facebook post (no image)
const response = await axios.post(`${BASE}/${pageId}/feed`, null, {
  params: { message, access_token: pageToken },
  timeout: 30000,
});
```

Either add a `postText()` function to `services/facebook.js` OR handle the branch in `broadcastDelivery.js` directly. Adding `postText()` to `facebook.js` is cleaner for reuse.

**Warning signs:** Any broadcast without an image consistently failing Facebook with "An image is required."

### Pitfall 2: Scheduler job leak on broadcast update/delete

**What goes wrong:** When a broadcast is edited (new cron), deleted, or disabled via the API, the old cron job in `activeBroadcastJobs` continues to fire.

**Why it happens:** `startBroadcasts()` is not called after broadcast mutations — only called at server startup.

**How to avoid:** Follow the exact pattern in `scheduler.add()` / `scheduler.update()` — call `startBroadcasts()` (reload all broadcast jobs) at the end of any broadcastService create/update/delete/setEnabled. Since broadcast mutations go through `routes/broadcasts.js` → `broadcastService.js`, call `scheduler.startBroadcasts()` from the route handler after the DB mutation completes.

**Alternative (lighter):** Instead of full reload, add `scheduler.addBroadcastJob(b)` and `scheduler.removeBroadcastJob(id)` for targeted add/remove. This avoids reloading all jobs on every edit. However, the existing codebase uses full `startAll()` reload on every product schedule mutation — follow the same pattern for simplicity.

### Pitfall 3: `user_id` ownership when scheduler fires

**What goes wrong:** The cron job fires with the `user_id` stored in the `broadcast_messages` row. If the user was deleted, `getSubjectById(subjectId, userId)` returns null and delivery silently fails.

**Why it happens:** Scheduler fires with stored IDs; no live auth context.

**How to avoid:** In `runBroadcastJob()`, if subject resolution returns null, log a clear error: `"Broadcast '${b.label}' skipped: subject not found or user deleted."` Don't throw — let the job complete cleanly so other jobs aren't affected.

### Pitfall 4: WhatsApp groups delay blocks other broadcasts

**What goes wrong:** Broadcast A sends to 3 WhatsApp groups with 2-minute delays = 4 minutes total. If Broadcast B fires during this time, it runs concurrently. This is fine because broadcasts are independent — each has its own execution context. However, if many broadcasts fire at the same second (e.g., all set to daily at 8:00), multiple concurrent deliveries each with their own 2-minute WA delays can stress the MacroDroid webhook.

**Why it happens:** node-cron fires each job independently; no queue or throttle between broadcast jobs.

**How to avoid:** For this milestone, accept concurrent execution — it's consistent with how product schedules work. Document this as a known limitation. If concurrent sends become a problem, a job queue (BullMQ) is the v2 solution (out of scope).

### Pitfall 5: `startBroadcasts()` called before `broadcast_messages` table exists

**What goes wrong:** If `startAll()` is extended to call `startBroadcasts()` and the DB migration hasn't run yet (e.g., `DATABASE_URL` not set), the query on `broadcast_messages` throws an error that propagates and prevents product schedules from loading.

**Why it happens:** `startAll()` currently handles DB errors gracefully (`try/catch`, returns 0). But if `startBroadcasts()` is added inside `startAll()` and throws, the existing error handler may surface.

**How to avoid:** Wrap `startBroadcasts()` in its own try-catch just like the existing product schedule loading:
```javascript
async function startBroadcasts() {
  try {
    // ... load and register ...
  } catch (err) {
    log(`Could not load broadcast jobs: ${err.message}`, 'warn');
    return 0;
  }
}
```
This matches the exact pattern in the existing `startAll()` (lines 24–29 of scheduler/index.js).

---

## Code Examples

Verified patterns from existing codebase:

### How workflow.js calls whatsapp.send() (source: services/workflow.js lines 190-195)
```javascript
// Existing product pipeline — broadcast delivery uses same call signature
const waResult = await whatsapp.send({
  text:       message,          // broadcast.text
  image:      product.image,    // buildImageUrl(broadcast.image_url) or null
  wa_group:   group.waGroup,    // from getGroupsBySubject()
  webhookUrl: subjectConfig?.macrodroidUrl || null,  // from getSubjectById()
});
```

### How workflow.js calls facebook.postPhoto() (source: services/workflow.js lines 236-241)
```javascript
// Existing product pipeline — broadcast delivery uses same call signature
const fbResult = await facebook.postPhoto({
  message:        message,                  // broadcast.text
  imageUrl:       product.image,            // buildImageUrl(broadcast.image_url)
  facebookPageId: subjectConfig?.facebookPageId || null,  // from getSubjectById()
  facebookToken:  subjectConfig?.facebookToken  || null,  // from getSubjectById()
});
```

### How scheduler registers a cron job (source: scheduler/index.js lines 39-40)
```javascript
// Broadcast jobs use the exact same registration call
activeJobs[s.id] = cron.schedule(s.cron, () => runJob(s), { timezone: 'Asia/Jerusalem' });
// → becomes →
activeBroadcastJobs[b.id] = cron.schedule(b.cron, () => runBroadcastJob(b), { timezone: 'Asia/Jerusalem' });
```

### How scheduler.add() triggers reload (source: scheduler/index.js lines 92-93)
```javascript
// Pattern to follow after broadcast mutations
await startAll();
return _formatRow(rows[0]);
// → for broadcasts →
await startBroadcasts();
return broadcastService._formatRow(rows[0]);
```

### Per-platform failure isolation (source: services/workflow.js lines 233-244)
```javascript
// Facebook wrapped independently — WhatsApp result is already in results.whatsapp
try {
  const fbResult = await facebook.postPhoto({ ... });
  results.facebook = fbResult;
} catch (err) {
  log(`✗ Facebook failed: ${err.message}`, 'error');
  results.facebook = { success: false, error: err.message };
}
```

### APP_BASE_URL pattern for absolute URLs (source: services/inviteService.js)
```javascript
// Same pattern used for invite links
const base = process.env.APP_BASE_URL || 'http://localhost:3000';
const url = `${base}/uploads/broadcasts/${filename}`;
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Monolithic workflow.js handles all delivery | Separate broadcastDelivery.js for broadcast pipeline | No entanglement; workflow.js stays product-only |
| Product schedules only in scheduler | Broadcast jobs in separate activeBroadcastJobs map | Clean separation; no risk of collision with product job IDs |
| Fire-now stub in Phase 1 | Real delivery wired in Phase 2 | API contract unchanged; stub replaced transparently |

---

## Open Questions

1. **Facebook text-only posts (no image)**
   - What we know: `facebook.postPhoto()` posts to `/{pageId}/photos` which requires a URL. Broadcasts without images need a different endpoint (`/{pageId}/feed`).
   - What's unclear: Does the existing `facebook.js` have or need a `postText()` function?
   - Recommendation: Add `postText({ message, facebookPageId, facebookToken })` to `services/facebook.js` and call it from `broadcastDelivery.js` when `imageUrl` is null. Simple 10-line addition.

2. **Reload strategy after broadcast mutations**
   - What we know: Existing pattern calls `startAll()` after every product schedule mutation (re-registers ALL jobs). This is safe but slightly wasteful.
   - What's unclear: Whether `startBroadcasts()` should be called from `broadcastService.js` (tight coupling) or from the route handler after mutation (looser coupling).
   - Recommendation: Call `startBroadcasts()` from the route handler after mutation (same layer as existing `schedules.js` behavior which calls `scheduler.add()` → internally calls `startAll()`). No cross-layer injection needed.

3. **Phase 1 prerequisite**
   - What we know: `broadcastService.js` and `routes/broadcasts.js` do not yet exist (Phase 1 not yet executed).
   - What's unclear: N/A — the dependency is clear.
   - Recommendation: Phase 2 planning must list Phase 1 completion as an explicit prerequisite in Wave 0 or as a blocker note. Phase 2 execution cannot start until Phase 1 PLAN files are completed and built.

---

## Sources

### Primary (HIGH confidence)

- `scheduler/index.js` (136 lines) — read directly; full understanding of activeJobs map, startAll(), runJob(), fireNow(), injection pattern
- `services/workflow.js` (303 lines) — read directly; established pattern for subject resolution, per-platform isolation, WA group iteration
- `services/facebook.js` (139 lines) — read directly; `postPhoto()` signature, Graph API v23.0 endpoint
- `services/whatsapp.js` (26 lines) — read directly; `send()` signature, MacroDroid webhook params
- `services/subjectService.js` (50 lines read) — confirmed `getSubjectById()` and `getGroupsBySubject()` signatures
- `server.js` (232 lines) — read directly; confirmed scheduler injection pattern, route mounting, static file serving
- `.planning/phases/01-backend-foundation/01-RESEARCH.md` — confirmed Phase 1 design: broadcastService.js shape, image_url field, fire-now stub contract

### Secondary (MEDIUM confidence)

- `.planning/codebase/ARCHITECTURE.md`, `INTEGRATIONS.md`, `CONCERNS.md` — codebase map documents; supplement direct source reading
- Facebook Graph API behavior for text-only posts — based on API documentation knowledge (not verified with live call); flag for testing

### Tertiary (LOW confidence)

- Concurrent broadcast execution behavior under load — derived from code reading; real behavior depends on MacroDroid rate limits which are undocumented

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all confirmed in package.json and source files
- Architecture patterns: HIGH — derived directly from reading scheduler/index.js, workflow.js, facebook.js, whatsapp.js
- Delivery integration: HIGH — direct port of established patterns; well-understood call signatures
- Facebook text-only post: MEDIUM — behavior inferred from API structure; needs verification during implementation
- Concurrent load behavior: LOW — theoretical; MacroDroid rate limits unknown

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable stack — no fast-moving dependencies)
