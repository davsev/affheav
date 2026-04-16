---
phase: 01-backend-foundation
plan: 02
subsystem: api
tags: [node, express, postgres, node-cron, broadcast-messages, recurrence, cron]

# Dependency graph
requires:
  - phase: 01-backend-foundation-01
    provides: broadcast_messages table with recurrence (JSONB) + cron (VARCHAR) columns
provides:
  - services/broadcastService.js with listByUser, getById, create, update, remove, setEnabled
  - recurrenceToCron() converts daily/weekly/every_n_days to validated cron strings
  - computeNextRun() returns next fire ISO timestamp in Asia/Jerusalem timezone (or null)
  - Subject ownership validation on create/update
  - Old image file cleanup on update/remove
affects:
  - 01-backend-foundation-03 (routes/broadcasts.js will require broadcastService)
  - 02-scheduler-delivery (scheduler uses the cron field computed here)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dynamic SET clause pattern: updates[]/values[] arrays with counter i — matches subjectService.js"
    - "computeNextRun uses toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }) for timezone-aware display"
    - "recurrence (JSONB) always re-validated and cron recomputed together on every update"
    - "_row() private mapper keeps DB row shape fully internal"

key-files:
  created:
    - services/broadcastService.js
  modified: []

key-decisions:
  - "computeNextRun is for display only (SCHED-04 card) — precision within minutes is sufficient, full DST accuracy not required"
  - "fs.unlink errors are silently ignored — missing image file should not block the update/delete operation"
  - "recurrence JSONB is JSON.stringify'd before INSERT/UPDATE — pg driver requires string for JSONB parameters"

patterns-established:
  - "ASCII section headers: // ── Helpers ──, // ── CRUD ──, // ── Exports ── (matches subjectService.js style)"
  - "All 6 CRUD exports are async functions; private helpers (recurrenceToCron, computeNextRun, _row) are not exported"

requirements-completed: [BCAST-03, BCAST-04, BCAST-05, BCAST-06, SCHED-01, SCHED-02, SCHED-03, SCHED-04]

# Metrics
duration: 2min
completed: 2026-04-15
---

# Phase 1 Plan 02: broadcastService.js Summary

**Node.js service module with full broadcast CRUD, daily/weekly/every-N-days to cron conversion, and Jerusalem-timezone next-run computation**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-15T19:33:37Z
- **Completed:** 2026-04-15T19:35:06Z
- **Tasks:** 1 of 1
- **Files modified:** 1

## Accomplishments
- Created `services/broadcastService.js` with all 6 required exports: listByUser, getById, create, update, remove, setEnabled
- `recurrenceToCron()` validates mode/hour/day/n inputs then converts to cron string; cron.validate() is the final gate before returning
- `computeNextRun()` calculates next fire time in Asia/Jerusalem timezone for the SCHED-04 card display; returns null when disabled or recurrence absent
- Subject ownership validated via `SELECT id FROM subjects WHERE id=$1 AND user_id=$2` on create and on subjectId change
- Old image files cleaned up (fs.unlink, errors ignored) on update when imageUrl changes and on remove

## Task Commits

Each task was committed atomically:

1. **Task 1: Create services/broadcastService.js** - `7cd4c83` (feat)

**Plan metadata:** (see final docs commit)

## Files Created/Modified
- `services/broadcastService.js` - New file: broadcast message business logic layer (~280 lines of code + ~80 lines of comments/headers)

## Decisions Made
- `computeNextRun` uses `toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })` to determine local hour/day for next-run calculation — precision within minutes is sufficient for display (plan note: "next-run is for display only")
- `recurrence` passed as `JSON.stringify(recurrence)` to pg query parameters because the pg driver expects a string when inserting JSONB
- `fs.unlink` errors silently ignored — a missing image file on disk should never block a DB update or delete

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 03 (routes/broadcasts.js) can now `require('../services/broadcastService')` and call any of the 6 exports directly
- `create(userId, { subjectId, label, text, recurrence, imageUrl? })` — imageUrl is optional; Plan 03 sets it after multer saves the file
- `update(id, userId, fields)` — accepts any subset of `{ label, text, recurrence, imageUrl, subjectId }`; returns null if not found (route should 404)
- `remove(id, userId)` — returns the deleted row object (or null if not found)
- `setEnabled(id, userId, enabled)` — for the toggle switch in the UI (Phase 3)
- `recurrenceToCron` throws descriptive Errors for bad inputs — routes should catch and respond 400
- The `every_n_days` snap-to-anchor logic in `computeNextRun` uses day-of-month modulo; this is a display approximation, not the scheduler trigger

---
*Phase: 01-backend-foundation*
*Completed: 2026-04-15*
