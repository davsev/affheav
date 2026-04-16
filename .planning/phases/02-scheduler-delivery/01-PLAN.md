---
phase: 02-scheduler-delivery
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - services/broadcastDelivery.js
  - services/facebook.js
autonomous: true
requirements:
  - DLVR-01
  - DLVR-02

must_haves:
  truths:
    - "services/broadcastDelivery.js exports a send(broadcast, userId) function that sends to both WhatsApp and Facebook"
    - "A Facebook failure does not throw or block the WhatsApp result — results.facebook gets { success: false, error } instead"
    - "A WhatsApp failure does not throw or block the Facebook result — results.whatsapp gets { success: false, error } instead"
    - "When broadcast.image_url is null, Facebook receives a text-only post via postText() to /{pageId}/feed (not a photo post)"
    - "When broadcast.image_url is set, Facebook receives a photo post via postPhoto() to /{pageId}/photos"
    - "Image URL passed to Facebook and WhatsApp is always an absolute URL (http/https), constructed from APP_BASE_URL when stored path is relative"
    - "services/facebook.js exports postText({ message, facebookPageId, facebookToken })"
  artifacts:
    - path: "services/broadcastDelivery.js"
      provides: "Thin delivery orchestrator: resolves subject creds, sends to WA groups + FB, returns { whatsapp, facebook }"
      contains: "module.exports = { send }"
    - path: "services/facebook.js"
      provides: "postText() for text-only Facebook posts — calls /{pageId}/feed endpoint"
      contains: "postText"
  key_links:
    - from: "services/broadcastDelivery.js"
      to: "services/whatsapp.js"
      via: "whatsapp.send({ text, image, wa_group, webhookUrl })"
      pattern: "whatsapp.send"
    - from: "services/broadcastDelivery.js"
      to: "services/facebook.js"
      via: "facebook.postPhoto() or facebook.postText() depending on imageUrl presence"
      pattern: "facebook.post"
    - from: "services/broadcastDelivery.js"
      to: "services/subjectService.js"
      via: "getSubjectById(broadcast.subject_id, userId) and getGroupsBySubject(broadcast.subject_id, userId)"
      pattern: "getSubjectById"
---

<objective>
Create the broadcast delivery service and add text-only Facebook posting support.

Purpose: Establishes the two delivery primitives that Phase 2 builds on — the `broadcastDelivery.send()` function (called by both fire-now and the cron scheduler) and `facebook.postText()` (required for broadcasts without images). Without these, the scheduler wiring in Plan 02 has nothing to call.

Output: `services/broadcastDelivery.js` (new), `services/facebook.js` (postText added).
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
@services/facebook.js
@services/whatsapp.js
@services/subjectService.js
@services/workflow.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add postText() to services/facebook.js</name>
  <files>services/facebook.js</files>
  <action>
    Add a `postText()` function to `services/facebook.js` immediately before the closing `module.exports` line. This function posts text-only content to the Facebook page feed (no image required).

    Insert this function after `generatePermanentPageToken` and before `module.exports`:

    ```javascript
    async function postText({ message, facebookPageId, facebookToken }) {
      const pageId   = facebookPageId || process.env.FACEBOOK_PAGE_ID;
      const pageToken = facebookToken || process.env.FACEBOOK_ACCESS_TOKEN;

      if (!pageId || !pageToken) {
        throw new Error('FACEBOOK_PAGE_ID or FACEBOOK_ACCESS_TOKEN not set in .env');
      }

      try {
        const response = await axios.post(
          `${BASE}/${pageId}/feed`,
          null,
          {
            params: {
              message,
              access_token: pageToken,
            },
            timeout: 30000,
          }
        );
        return { success: true, data: response.data };
      } catch (err) {
        const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        throw new Error(`postText failed: ${detail}`);
      }
    }
    ```

    Update `module.exports` to include `postText`:
    ```javascript
    module.exports = { postPhoto, postText, refreshToken, getTokenInfo, generatePermanentPageToken };
    ```

    Style rules: 2-space indentation, single quotes, semicolons — match the existing `postPhoto` function above it exactly.
  </action>
  <verify>
    <automated>node -e "const fb = require('./services/facebook'); console.log(typeof fb.postText === 'function' ? 'postText OK' : 'MISSING');"</automated>
    <manual>Confirm module.exports now includes postText alongside postPhoto.</manual>
  </verify>
  <done>require('./services/facebook').postText is a function; module loads without error.</done>
</task>

<task type="auto">
  <name>Task 2: Create services/broadcastDelivery.js</name>
  <files>services/broadcastDelivery.js</files>
  <action>
    Create `services/broadcastDelivery.js` as a new file. This is the thin orchestrator that sends a broadcast message to WhatsApp groups and Facebook, with full platform isolation (one platform's failure never blocks the other).

    The `send(broadcast, userId)` function accepts EITHER a camelCase object (from broadcastService.getById()) OR a snake_case DB row (from direct query in scheduler) — normalize field access using a helper.

    Full file content:

    ```javascript
    // ── Broadcast Delivery ────────────────────────────────────────────────────────
    // Thin orchestrator: sends a broadcast_messages record to WhatsApp + Facebook.
    // Called from routes/broadcasts.js (fire-now) and scheduler/index.js (cron).

    const { getSubjectById, getGroupsBySubject } = require('./subjectService');
    const whatsapp = require('./whatsapp');
    const facebook = require('./facebook');

    // Delay between WhatsApp group sends — matches workflow.js (WA_GROUP_DELAY_MS)
    const WA_GROUP_DELAY_MS = 2 * 60 * 1000;
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // Build absolute image URL from stored relative path.
    // broadcast_messages.image_url stores relative paths like "uploads/broadcasts/uuid.jpg"
    // Facebook Graph API and MacroDroid webhook both require absolute URLs.
    function buildImageUrl(imageUrl) {
      if (!imageUrl) return null;
      if (imageUrl.startsWith('http')) return imageUrl; // already absolute
      const base = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
      return `${base}/${imageUrl.replace(/^\//, '')}`;
    }

    // Normalize broadcast object: accept camelCase (from service) or snake_case (from DB row)
    function _normalize(b) {
      return {
        id:        b.id,
        label:     b.label,
        text:      b.text,
        image_url: b.image_url  ?? b.imageUrl  ?? null,
        subject_id: b.subject_id ?? b.subjectId ?? null,
        user_id:   b.user_id   ?? b.userId    ?? null,
      };
    }

    // ── send ──────────────────────────────────────────────────────────────────────
    // Sends broadcast to all WhatsApp groups (sequenced, 2-min delay) and Facebook.
    // Returns: { whatsapp: Array|Object, facebook: Object }
    // Each platform result is independent — failure in one does not affect the other.
    async function send(broadcast, userId) {
      const b        = _normalize(broadcast);
      const subject  = await getSubjectById(b.subject_id, userId);
      if (!subject) throw new Error(`Subject not found: ${b.subject_id}`);

      const imageUrl = buildImageUrl(b.image_url);
      const results  = { whatsapp: null, facebook: null };

      // ── WhatsApp ──────────────────────────────────────────────────────────────
      try {
        const groups = await getGroupsBySubject(b.subject_id, userId);
        if (groups.length === 0) {
          results.whatsapp = { success: false, error: 'No WhatsApp groups configured for this subject' };
        } else {
          results.whatsapp = [];
          for (let i = 0; i < groups.length; i++) {
            if (i > 0) await sleep(WA_GROUP_DELAY_MS);
            const g = groups[i];
            try {
              const r = await whatsapp.send({
                text:       b.text,
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

      // ── Facebook (independent of WhatsApp result) ─────────────────────────────
      try {
        let fbResult;
        if (imageUrl) {
          // Photo post — includes image
          fbResult = await facebook.postPhoto({
            message:        b.text,
            imageUrl,
            facebookPageId: subject.facebookPageId || null,
            facebookToken:  subject.facebookToken  || null,
          });
        } else {
          // Text-only post — no image (postPhoto rejects null imageUrl on /photos endpoint)
          fbResult = await facebook.postText({
            message:        b.text,
            facebookPageId: subject.facebookPageId || null,
            facebookToken:  subject.facebookToken  || null,
          });
        }
        results.facebook = fbResult;
      } catch (err) {
        results.facebook = { success: false, error: err.message };
      }

      return results;
    }

    module.exports = { send };
    ```

    Key design decisions to preserve:
    - `_normalize()` ensures the function works with both camelCase service output (fire-now path) and snake_case DB rows (scheduler path) — critical because both callers pass different shapes
    - WhatsApp try-catch wraps the entire group-loop block AND each individual group send — outer catches group resolution errors, inner catches per-group send errors
    - Facebook image-or-text branch: if imageUrl is truthy use postPhoto(), otherwise use postText() — this is the core fix for the "Facebook text-only broadcasts fail" pitfall documented in the research
    - WA_GROUP_DELAY_MS = 2 minutes matches workflow.js behavior (existing convention)
    - Subject not found throws (not a platform failure) — this is a programming error, not a delivery error
  </action>
  <verify>
    <automated>node -e "const bd = require('./services/broadcastDelivery'); console.log(typeof bd.send === 'function' ? 'send OK' : 'MISSING');"</automated>
    <manual>Confirm the file exists and loads without error. Check that _normalize, buildImageUrl, WA_GROUP_DELAY_MS, and sleep are all defined in the file.</manual>
  </verify>
  <done>require('./services/broadcastDelivery').send is a function; module loads without error; no syntax errors reported.</done>
</task>

</tasks>

<verification>
Run both verify commands sequentially:
1. `node -e "const fb = require('./services/facebook'); console.log(typeof fb.postText === 'function' ? 'postText OK' : 'MISSING');"` → outputs "postText OK"
2. `node -e "const bd = require('./services/broadcastDelivery'); console.log(typeof bd.send === 'function' ? 'send OK' : 'MISSING');"` → outputs "send OK"
</verification>

<success_criteria>
- services/facebook.js exports postText() alongside postPhoto()
- services/broadcastDelivery.js exports send(broadcast, userId)
- broadcastDelivery.send() uses postPhoto() when imageUrl is present and postText() when it is null
- Both Facebook and WhatsApp platform calls are wrapped in independent try-catch blocks
- buildImageUrl() returns an absolute URL (APP_BASE_URL + relative path) or null
- _normalize() handles both camelCase and snake_case broadcast shapes
- Both modules load without errors
</success_criteria>

<output>
After completion, create `.planning/phases/02-scheduler-delivery/02-scheduler-delivery-01-SUMMARY.md` with:
- What was done
- Files created/modified
- Key design decisions (normalize helper, image-or-text branch)
- What Plan 02 needs to know (broadcastDelivery.send signature)
</output>
