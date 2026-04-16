---
phase: 02-scheduler-delivery
verified: 2026-04-15T00:00:00Z
status: passed
score: 11/11 must-haves verified
re_verification: false
---

# Phase 2: Scheduler & Delivery Verification Report

**Phase Goal:** Enabled broadcast messages fire on their cron schedule and successfully send text (+ optional image) to the niche's WhatsApp group and Facebook page
**Verified:** 2026-04-15
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | On server startup, enabled broadcast_messages are loaded into the cron scheduler alongside product schedules (visible in startup logs) | VERIFIED | `server.js:232-233` calls `scheduler.startBroadcasts()` after `startAll()` and logs `📡 X broadcast(s) loaded` |
| 2 | When a broadcast job fires, the niche's Facebook page receives a text post (+ image if set) via the Graph API | VERIFIED | `broadcastDelivery.js:77-93` branches on `imageUrl` — calls `facebook.postPhoto()` with image or `facebook.postText()` without; `facebook.js:138-163` posts to `/{pageId}/feed` |
| 3 | When a broadcast job fires, the niche's WhatsApp group receives the message text (+ image if set) via the MacroDroid webhook | VERIFIED | `broadcastDelivery.js:48-72` calls `whatsapp.send({ text, image, wa_group, webhookUrl })` for each group in the subject |
| 4 | A failed delivery to one platform does not block delivery to the other platform | VERIFIED | `broadcastDelivery.js:48-96` — WhatsApp block (lines 48-72) and Facebook block (lines 75-96) are independent try-catch blocks; errors populate `results.whatsapp` / `results.facebook` without re-throwing |

**Score:** 4/4 success criteria verified

---

### Required Artifacts

#### Plan 01 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `services/broadcastDelivery.js` | VERIFIED | 102 lines; exports `{ send }`; `_normalize()`, `buildImageUrl()`, `WA_GROUP_DELAY_MS`, `sleep()` all defined; independent try-catch blocks for WA and FB |
| `services/facebook.js` (postText added) | VERIFIED | `postText()` defined at lines 138-163; posts to `/{pageId}/feed`; exported at line 165 alongside `postPhoto` |

#### Plan 02 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `scheduler/index.js` | VERIFIED | `activeBroadcastJobs` at line 5 (separate from `activeJobs`); exports `startBroadcasts`, `stopBroadcasts`; all existing exports preserved |
| `routes/broadcasts.js` | VERIFIED | Imports `broadcastDelivery` (line 7) and `scheduler` (line 8); fire-now returns `{ success: true, fired: true }` (line 138); PATCH /enabled calls `scheduler.startBroadcasts()` (line 112) |
| `server.js` | VERIFIED | `startBroadcasts()` called at line 232 after `startAll()`; count logged at line 233 |

---

### Key Link Verification

#### Plan 01 Key Links

| From | To | Via | Status |
|------|----|-----|--------|
| `services/broadcastDelivery.js` | `services/whatsapp.js` | `whatsapp.send(...)` | WIRED — line 58 |
| `services/broadcastDelivery.js` | `services/facebook.js` | `facebook.postPhoto()` / `facebook.postText()` | WIRED — lines 79, 87 |
| `services/broadcastDelivery.js` | `services/subjectService.js` | `getSubjectById(...)` | WIRED — line 41 |

#### Plan 02 Key Links

| From | To | Via | Status |
|------|----|-----|--------|
| `scheduler/index.js` | `services/broadcastDelivery.js` | `broadcastDelivery.send(b, b.user_id)` in `runBroadcastJob()` | WIRED — lines 59, 62 (lazy require inside function) |
| `routes/broadcasts.js` | `services/broadcastDelivery.js` | `broadcastDelivery.send(msg, req.user.id)` in fire-now handler | WIRED — line 139 |
| `routes/broadcasts.js` | `scheduler/index.js` | `scheduler.startBroadcasts()` after PATCH /enabled | WIRED — line 112 |
| `server.js` | `scheduler/index.js` | `scheduler.startBroadcasts()` in listen callback | WIRED — line 232 |

---

### Requirements Coverage

| Requirement | Description | Plan | Status | Evidence |
|-------------|-------------|------|--------|----------|
| DLVR-01 | Scheduled broadcast sends text (+ optional image) to the niche's Facebook page via Graph API | 01, 02 | SATISFIED | `facebook.postText()` and `facebook.postPhoto()` both implemented; `broadcastDelivery.send()` selects correct call based on `imageUrl`; scheduler fires via `runBroadcastJob()` |
| DLVR-02 | Scheduled broadcast sends text (+ optional image) to the niche's WhatsApp group via MacroDroid webhook | 01, 02 | SATISFIED | `whatsapp.send()` called per group in `broadcastDelivery.send()`; image URL absolutized via `buildImageUrl()`; scheduler fires via `runBroadcastJob()` |

No orphaned requirements found — both IDs declared in both PLAN frontmatter sections and traced in REQUIREMENTS.md Traceability table.

---

### Anti-Patterns Found

None. No TODOs, FIXMEs, stubs, placeholders, or empty return values found in any of the four modified files.

---

### Plan 01 Must-Haves (Detailed)

| Truth | Status | Evidence |
|-------|--------|----------|
| `broadcastDelivery.js` exports `send(broadcast, userId)` | VERIFIED | `module.exports = { send }` at line 101 |
| Facebook failure does not throw or block WhatsApp — `results.facebook` gets `{ success: false, error }` | VERIFIED | Outer FB try-catch at lines 75-96 catches errors and assigns to `results.facebook` |
| WhatsApp failure does not throw or block Facebook — `results.whatsapp` gets `{ success: false, error }` | VERIFIED | Outer WA try-catch at lines 48-72 catches errors and assigns to `results.whatsapp` |
| No image → Facebook text post via `postText()` to `/{pageId}/feed` | VERIFIED | `broadcastDelivery.js:85-91`; `facebook.js:138-163` posts to `/{pageId}/feed` |
| Image set → Facebook photo post via `postPhoto()` to `/{pageId}/photos` | VERIFIED | `broadcastDelivery.js:79-84`; existing `facebook.postPhoto()` posts to `/{pageId}/photos` |
| Image URL is always absolute (APP_BASE_URL + relative path) | VERIFIED | `buildImageUrl()` at lines 16-21: passes through http URLs, prepends `APP_BASE_URL` for relative paths |
| `facebook.js` exports `postText({ message, facebookPageId, facebookToken })` | VERIFIED | Signature at line 138; exported at line 165 |

### Plan 02 Must-Haves (Detailed)

| Truth | Status | Evidence |
|-------|--------|----------|
| Enabled broadcasts loaded into cron jobs on startup, logged as 'X broadcast(s) active' | VERIFIED | `startBroadcasts()` queries `broadcast_messages WHERE enabled = true`; logs at lines 49-51 |
| Broadcast cron jobs in separate `activeBroadcastJobs` map — `activeJobs` untouched | VERIFIED | `activeBroadcastJobs` declared at line 5; `activeJobs` unchanged |
| `startBroadcasts()` wrapped in outer try-catch — DB error does not prevent product schedule loading | VERIFIED | Try-catch at lines 30-36 returns 0 on error without throwing |
| POST /api/broadcasts/:id/fire-now fires `broadcastDelivery.send()` async, returns `{ success: true, fired: true }` | VERIFIED | `routes/broadcasts.js:138-140` — responds immediately then fires async with `.catch()` |
| After PATCH /:id/enabled, `scheduler.startBroadcasts()` is called | VERIFIED | `routes/broadcasts.js:112` |
| `server.js` calls `scheduler.startBroadcasts()` during startup after `startAll()` | VERIFIED | `server.js:232` |
| `scheduler/index.js` exports `startBroadcasts` | VERIFIED | `module.exports` at lines 181-186 |

---

### Human Verification Required

The following behaviors cannot be verified programmatically and require a running server with live credentials:

**1. End-to-end Facebook delivery (text-only)**
- Test: Fire a broadcast with no image against a configured Facebook subject
- Expected: Text post appears on the Facebook page
- Why human: Requires valid Facebook token and live Graph API call

**2. End-to-end WhatsApp delivery**
- Test: Fire a broadcast against a configured subject with a WhatsApp group
- Expected: Message arrives in the WhatsApp group
- Why human: Requires live MacroDroid webhook and device

**3. Startup log visibility**
- Test: Start server with `DATABASE_URL` set and at least one enabled broadcast in DB
- Expected: Logs show `📅 X schedule(s) loaded` followed by `📡 X broadcast(s) loaded`
- Why human: Requires live DB connection

**4. Enable/disable scheduler sync**
- Test: Toggle a broadcast's enabled state via PATCH; check server logs
- Expected: Log shows updated broadcast count after toggle
- Why human: Requires session cookie and live server

---

## Summary

Phase 2 goal is achieved. All 4 success criteria are satisfied by substantive, wired implementations:

- `services/broadcastDelivery.js` is a complete, non-stub orchestrator with proper platform isolation, absolute URL resolution, and camelCase/snake_case normalization.
- `services/facebook.js` has `postText()` fully implemented and exported.
- `scheduler/index.js` has additive broadcast job support (`activeBroadcastJobs`, `startBroadcasts`, `stopBroadcasts`, `runBroadcastJob`) with proper DB-error isolation.
- `routes/broadcasts.js` fire-now handler calls real delivery (not stubbed); PATCH /enabled syncs the scheduler.
- `server.js` starts broadcast jobs at startup alongside product schedules.

Both DLVR-01 and DLVR-02 are fully satisfied. No anti-patterns found in any modified file.

---

_Verified: 2026-04-15_
_Verifier: Claude (gsd-verifier)_
