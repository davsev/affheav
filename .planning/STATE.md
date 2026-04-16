# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-15)

**Core value:** Niche owners can schedule evergreen messages to reach their audiences at the right time — without touching the product pipeline.
**Current focus:** Phase 2 — Scheduler & Delivery

## Current Position

Phase: 2 of 3 (Scheduler & Delivery)
Plan: 1 of 2 in current phase
Status: In progress
Last activity: 2026-04-16 — Completed plan 01: broadcastDelivery.js + facebook.postText()

Progress: [████░░░░░░] 44%

## Performance Metrics

**Velocity:**
- Total plans completed: 4
- Average duration: 5 min
- Total execution time: 19 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-backend-foundation | 3 | 15 min | 5 min |
| 02-scheduler-delivery | 1 | 4 min | 4 min |

**Recent Trend:**
- Last 5 plans: 01-01 (8 min), 01-02 (2 min), 01-03 (5 min), 02-01 (4 min)
- Trend: consistent

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- New broadcast_messages table (not extending schedules) — avoids nulls and branching in workflow.js
- BCAST-03 (image upload) assigned to Phase 1 (backend concern: multer + filesystem storage) not Phase 2
- Human-friendly recurrence builder (daily/weekly/every-N-days) — raw cron hidden from user
- WhatsApp + Facebook only (no Instagram) for this milestone
- Local image upload to public/uploads/broadcasts/ — no cloud storage
- [01-01] subject_id is NOT NULL on broadcast_messages — no all-niches option (satisfies BCAST-02)
- [01-01] recurrence (JSONB) + cron (VARCHAR) stored as a pair — JSONB for edit-modal pre-population, VARCHAR for scheduler use
- [Phase 01-backend-foundation]: computeNextRun uses toLocaleString Asia/Jerusalem for display-only next-run; precision within minutes acceptable
- [Phase 01-backend-foundation]: recurrence JSONB JSON.stringify'd before pg INSERT — pg driver needs string for JSONB params
- [01-03]: Multer diskStorage with uuid filenames — avoids collisions, no cloud dependency
- [01-03]: fire-now stubbed in Phase 1 — returns whatsapp/facebook stubbed:true; Phase 2 wires real delivery
- [02-01]: _normalize() accepts both camelCase (broadcastService) and snake_case (DB row) — fire-now and scheduler pass different shapes
- [02-01]: postText() routes to /feed, postPhoto() routes to /photos — text-only broadcasts must use postText() or Facebook rejects null URL
- [02-01]: WA_GROUP_DELAY_MS = 2 minutes — matches workflow.js convention for sequential group sends

### Pending Todos

None yet.

### Blockers/Concerns

- Scheduler (scheduler/index.js) currently only loads product schedules — Phase 2 must extend it to also load broadcast_messages without breaking existing product job behavior
- app.js is 2254 lines — Phase 3 UI additions should use a new public/broadcast-modal.js file (follow schedule-modal.js pattern) rather than expanding app.js further

## Session Continuity

Last session: 2026-04-16
Stopped at: Completed 02-scheduler-delivery-01-PLAN.md (broadcastDelivery.js + facebook.postText)
Resume file: None
