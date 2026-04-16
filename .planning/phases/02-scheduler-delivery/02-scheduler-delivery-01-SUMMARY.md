---
phase: 02-scheduler-delivery
plan: 01
subsystem: delivery
tags: [facebook, whatsapp, broadcast, delivery]
dependency_graph:
  requires:
    - services/subjectService.js (getSubjectById, getGroupsBySubject)
    - services/whatsapp.js (send)
    - services/facebook.js (postPhoto, postText)
  provides:
    - services/broadcastDelivery.js (send)
    - services/facebook.js (postText)
  affects:
    - routes/broadcasts.js (fire-now endpoint, Plan 02)
    - scheduler/index.js (cron jobs, Plan 02)
tech_stack:
  added: []
  patterns:
    - Platform isolation via independent try-catch blocks
    - Dual-shape normalization (camelCase service vs snake_case DB row)
    - Relative-to-absolute URL construction via APP_BASE_URL
key_files:
  created:
    - services/broadcastDelivery.js
  modified:
    - services/facebook.js
decisions:
  - _normalize() helper accepts both camelCase (broadcastService output) and snake_case (DB row) shapes — required because fire-now and scheduler pass different object shapes to the same function
  - image_url branch: postPhoto() when imageUrl truthy, postText() when null — core correctness requirement because /photos endpoint rejects null URL
  - WA_GROUP_DELAY_MS = 2 minutes matches workflow.js convention — ensures consistent group send pacing
  - Subject-not-found throws (not platform failure) — this is a programming error, not a delivery error to be swallowed
metrics:
  duration: 4 min
  completed: 2026-04-15
  tasks_completed: 2
  files_changed: 2
---

# Phase 2 Plan 01: Broadcast Delivery Service Summary

**One-liner:** Thin delivery orchestrator with independent WA/FB platform isolation and text-only Facebook posting via postText().

## What Was Done

Added `postText()` to `services/facebook.js` for text-only Facebook page feed posts (calls `/{pageId}/feed` not `/photos`). Created `services/broadcastDelivery.js` — the central delivery primitive called by both fire-now (Plan 02 routes) and the cron scheduler (Plan 02 scheduler).

## Files Created/Modified

| File | Action | Purpose |
|------|--------|---------|
| `services/facebook.js` | Modified | Added `postText()` function and updated `module.exports` |
| `services/broadcastDelivery.js` | Created | Thin delivery orchestrator: WA + FB with platform isolation |

## Key Design Decisions

**1. `_normalize()` dual-shape helper**
`send()` accepts either camelCase objects (from `broadcastService.getById()` used in fire-now route) or snake_case DB rows (from direct query in scheduler). The `_normalize()` helper uses `??` chaining to handle both shapes transparently. Without this, fire-now and scheduler would need separate implementations or an adapter.

**2. Image-or-text Facebook branch**
The `postPhoto()` endpoint (`/photos`) requires a URL and rejects null — calling it with a text-only broadcast would silently fail or error. The explicit `if (imageUrl)` branch routes to `postText()` (`/feed`) when no image is present. This was the primary pitfall documented in the Phase 2 research.

**3. Independent platform isolation**
WhatsApp and Facebook each have their own outer try-catch. Neither can throw into the other's execution path. Failures are captured as `{ success: false, error }` in their respective result slots. The caller always receives `{ whatsapp, facebook }` regardless of platform outcomes.

**4. Per-group inner catch**
Inside the WhatsApp loop, each individual group send is also wrapped in try-catch. A single group failure is recorded as `{ group: name, success: false, error }` in the results array without aborting the remaining groups.

## What Plan 02 Needs to Know

**`broadcastDelivery.send` signature:**
```javascript
const { send } = require('./broadcastDelivery');
const results = await send(broadcast, userId);
// results: { whatsapp: Array<{group, success, ...}> | {success, error}, facebook: {success, data} | {success, error} }
```

- `broadcast` — camelCase object from broadcastService OR snake_case DB row
- `userId` — required for subject lookup (subject scoped per user)
- Throws only if subject is not found — all platform errors are captured in results

**`facebook.postText` signature:**
```javascript
const { postText } = require('./facebook');
await postText({ message, facebookPageId, facebookToken });
// facebookPageId and facebookToken are optional — fallback to env vars
```

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `services/broadcastDelivery.js` exists and exports `send`
- [x] `services/facebook.js` exports `postText` alongside `postPhoto`
- [x] Both modules load without errors
- [x] Commits: `53910b3` (facebook.js), `eebd10f` (broadcastDelivery.js)
