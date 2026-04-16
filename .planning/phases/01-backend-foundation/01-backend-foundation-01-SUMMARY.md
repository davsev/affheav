---
phase: 01-backend-foundation
plan: 01
subsystem: database
tags: [postgres, migration, schema, broadcast-messages, uuid, jsonb]

# Dependency graph
requires: []
provides:
  - broadcast_messages table with 11 columns (id, user_id, subject_id, label, text, image_url, recurrence, cron, enabled, created_at, updated_at)
  - bcast_user_id index on broadcast_messages(user_id)
  - bcast_subject_id index on broadcast_messages(subject_id)
affects:
  - 01-backend-foundation-02 (broadcast CRUD routes will INSERT/SELECT this table)
  - 01-backend-foundation-03 (image upload route stores image_url in this table)
  - 02-scheduler-delivery (scheduler loads enabled broadcast_messages rows to schedule cron jobs)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotent CREATE TABLE IF NOT EXISTS migration block appended to db/migrate.js"
    - "JSONB column (recurrence) stores human-readable inputs; VARCHAR column (cron) stores computed cron string — both always persisted together"

key-files:
  created: []
  modified:
    - db/migrate.js

key-decisions:
  - "subject_id is NOT NULL — broadcast messages must always belong to a specific niche (BCAST-02); no all-niches option"
  - "recurrence (JSONB) and cron (VARCHAR) stored as a pair — recurrence preserves human inputs for edit modal pre-population, cron is what the scheduler uses"
  - "enabled defaults true — consistent with the existing schedules table convention"

patterns-established:
  - "ASCII section header pattern: // ── Section Name ─── (matches all other migrate.js sections)"

requirements-completed: [BCAST-01, BCAST-02]

# Metrics
duration: 8min
completed: 2026-04-15
---

# Phase 1 Plan 01: Add broadcast_messages DB Migration Summary

**PostgreSQL broadcast_messages table added to idempotent migration with JSONB recurrence storage, NOT NULL subject FK, and both user/subject indexes**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-15T00:00:00Z
- **Completed:** 2026-04-15T00:08:00Z
- **Tasks:** 1 of 1
- **Files modified:** 1

## Accomplishments
- Added `broadcast_messages` CREATE TABLE block to `db/migrate.js` with all 11 required columns
- Enforced `subject_id NOT NULL` FK to subjects (ON DELETE CASCADE) — satisfies BCAST-02
- Stored both `recurrence` (JSONB) and `cron` (VARCHAR) columns together for edit-modal pre-population and scheduler use
- Added `bcast_user_id` and `bcast_subject_id` indexes for query performance

## Task Commits

Each task was committed atomically:

1. **Task 1: Add broadcast_messages table to db/migrate.js** - `157acaf` (feat)

**Plan metadata:** (see final docs commit)

## Files Created/Modified
- `db/migrate.js` - Appended broadcast_messages CREATE TABLE block and two index statements at end of migrate() function

## Decisions Made
- None beyond what the plan specified — followed plan exactly as written.

## Deviations from Plan

None - plan executed exactly as written.

**Note on migration verification:** The `DATABASE_URL` env var is not set locally (Railway provides it in production). The migration verification command could not connect to PostgreSQL. The code was verified syntactically (`node --check db/migrate.js` passes) and the logic was manually reviewed — it follows the identical pattern as all other migration blocks. The table will be created on next server startup in the production/staging environment.

## Issues Encountered
- Migration verification command (`node -e "...migrate()..."`) failed with `AggregateError` from pg-pool because `DATABASE_URL` is not set locally. This is expected behavior — the database is a Railway PostgreSQL instance only accessible in the deployed environment. Verified the change via `node --check` syntax validation and manual code review.

## User Setup Required
None - no external service configuration required beyond what is already in place.

## Next Phase Readiness
- `broadcast_messages` table is ready for Plan 02 (broadcast CRUD routes: GET/POST/PUT/DELETE /api/broadcasts)
- The `recurrence` JSONB column stores `{ mode, hour, day?, n? }` — Plan 02 routes should validate this shape on input
- The `cron` VARCHAR column stores the computed cron string — Plan 02 should compute this from recurrence before INSERT/UPDATE
- Plan 03 (image upload) writes to the `image_url` TEXT column (nullable)
- Phase 2 scheduler loads enabled rows from this table — query should filter `WHERE enabled = true`

---
*Phase: 01-backend-foundation*
*Completed: 2026-04-15*
