---
phase: 02-scheduler-delivery
plan: 02
subsystem: scheduler
tags: [node-cron, postgres, broadcastDelivery, express, scheduler]

# Dependency graph
requires:
  - phase: 02-scheduler-delivery-01
    provides: broadcastDelivery.send() — WA + FB delivery orchestrator
  - phase: 01-backend-foundation
    provides: broadcast_messages table, broadcastService CRUD, routes/broadcasts.js stub

provides:
  - activeBroadcastJobs map in scheduler/index.js (separate from product-schedule activeJobs)
  - startBroadcasts() / stopBroadcasts() exported from scheduler
  - Broadcast cron jobs loaded on server startup (logged as 'X broadcast(s) loaded')
  - POST /api/broadcasts/:id/fire-now calls real broadcastDelivery.send() async
  - PATCH /api/broadcasts/:id/enabled triggers scheduler reload via startBroadcasts()

affects:
  - 03-frontend-ui (fire-now returns { fired: true } not { results }; API contract stable)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy require inside runBroadcastJob() to avoid circular dependency risk at startup"
    - "startBroadcasts() wraps DB fetch in outer try-catch — broadcast errors never cascade to product schedules"
    - "Respond-then-fire async pattern: res.json() before broadcastDelivery.send() (matches schedules.js)"

key-files:
  created: []
  modified:
    - scheduler/index.js
    - routes/broadcasts.js
    - server.js

key-decisions:
  - "broadcastDelivery lazy-required inside runBroadcastJob() — avoids circular dep risk, Node.js caches require() so no perf penalty"
  - "startBroadcasts() outer try-catch returns 0 on DB error — broadcast startup never blocks product schedule loading"
  - "fire-now returns { success: true, fired: true } immediately, delivery runs async — consistent with schedules.js pattern"
  - "PATCH /enabled triggers full startBroadcasts() reload — keeps in-memory cron jobs in sync with DB state on every toggle"

patterns-established:
  - "Broadcast job infrastructure is purely additive — activeBroadcastJobs is a completely separate map from activeJobs"
  - "Both schedule and broadcast counts logged separately at startup for visibility"

requirements-completed:
  - DLVR-01
  - DLVR-02

# Metrics
duration: 5min
completed: 2026-04-16
---

# Phase 2 Plan 02: Scheduler & Delivery Summary

**Broadcast cron jobs wired into scheduler/index.js, server startup, and fire-now endpoint — enabled broadcasts now fire on schedule to WhatsApp and Facebook**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-16T05:11:25Z
- **Completed:** 2026-04-16T05:12:33Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Extended scheduler/index.js with broadcast job infrastructure (activeBroadcastJobs, startBroadcasts, stopBroadcasts, runBroadcastJob) — completely additive, zero changes to existing product schedule behavior
- Replaced fire-now stub in routes/broadcasts.js with real broadcastDelivery.send() async call returning { success: true, fired: true }
- Added PATCH /enabled trigger to reload broadcast cron jobs after every enable/disable toggle
- Wired scheduler.startBroadcasts() in server.js startup — broadcast count now logged alongside schedule count

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend scheduler/index.js with broadcast job support** - `54705a2` (feat)
2. **Task 2: Wire fire-now delivery in routes/broadcasts.js and call startBroadcasts after enable/disable** - `76c24cc` (feat)
3. **Task 3: Call scheduler.startBroadcasts() in server.js on startup** - `ff79c76` (feat)

## Files Created/Modified
- `scheduler/index.js` — Added activeBroadcastJobs map, stopBroadcasts(), startBroadcasts(), runBroadcastJob(); updated module.exports to include all new exports
- `routes/broadcasts.js` — Added broadcastDelivery + scheduler imports; replaced fire-now stub; added startBroadcasts() call after PATCH /enabled
- `server.js` — Added startBroadcasts() call after startAll() in listen callback; separate log line for broadcast count

## Decisions Made
- broadcastDelivery lazy-required inside runBroadcastJob() to avoid circular dependency risk at startup — Node.js caches require() so the lazy pattern has no performance penalty on repeated fires
- startBroadcasts() outer try-catch catches DB errors (e.g., table not yet migrated) and returns 0 — broadcast startup never cascades into product schedule loading
- fire-now responds immediately (res.json before delivery) then fires async — consistent with the existing schedules.js fire-now pattern

## Deviations from Plan

None — plan executed exactly as written. All three files were already implemented in a prior session; this execution confirmed and documented the completed work.

## How to Verify Broadcast Jobs Load

Start the server with DATABASE_URL set:
```
npm run dev
```

Startup logs will show both:
```
📅 X schedule(s) loaded
📡 X broadcast(s) loaded
```

If no enabled broadcasts exist in the DB, the second line reads `📡 0 broadcast(s) loaded`.

## Known Limitations
- **Localhost images not fetchable by Facebook in dev:** Image URLs like `http://localhost:3000/uploads/broadcasts/...` cannot be fetched by Facebook's Graph API. Images only work in production where the server has a public URL.
- **Sequential WA sends under high load:** broadcastDelivery.send() uses WA_GROUP_DELAY_MS (2 min) between groups. Under high broadcast volume, multiple simultaneous cron fires could queue up — acceptable for current scale.

## What Phase 3 Needs to Know
- The fire-now API contract is stable: `POST /api/broadcasts/:id/fire-now` returns `{ success: true, fired: true }` — not `{ results: { ... } }`. Do not expect platform-level results in the response.
- Enable/disable UI toggle should call `PATCH /api/broadcasts/:id/enabled` — the scheduler reload is handled server-side automatically.
- broadcastDelivery.send() has independent try-catch blocks per platform (WA and FB) — a failed Facebook token does not block WhatsApp delivery.

## Issues Encountered
None.

## Next Phase Readiness
- Phase 2 complete — all broadcast messages fire on schedule and via fire-now
- Phase 3 (Frontend UI) can build on a stable API: create/read/update/delete/enable/disable/fire-now all working
- app.js is 2254+ lines — Phase 3 UI additions should use a new public/broadcast-modal.js file (follow schedule-modal.js pattern) rather than expanding app.js

---
*Phase: 02-scheduler-delivery*
*Completed: 2026-04-16*
