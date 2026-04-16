# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-15)

**Core value:** Niche owners can schedule evergreen messages to reach their audiences at the right time — without touching the product pipeline.
**Current focus:** Phase 3 — Frontend UI

## Current Position

Phase: 3 of 3 (Frontend UI)
Plan: 2 of 2 in current phase
Status: Complete
Last activity: 2026-04-15 — Completed plan 03-02: broadcast add/edit modal

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: 5 min
- Total execution time: 24 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-backend-foundation | 3 | 15 min | 5 min |
| 02-scheduler-delivery | 2 | 9 min | 4.5 min |

**Recent Trend:**
- Last 5 plans: 01-02 (2 min), 01-03 (5 min), 02-01 (4 min), 02-02 (5 min), 03-01 (7 min)
- Trend: consistent

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 03-frontend-ui | 1 (of 2) | 7 min | 7 min |

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
- [02-02]: broadcastDelivery lazy-required inside runBroadcastJob() — avoids circular dep risk at startup, Node.js caches require() so no perf penalty
- [02-02]: startBroadcasts() outer try-catch returns 0 on DB error — broadcast startup never blocks product schedule loading
- [02-02]: fire-now returns { success: true, fired: true } immediately, delivery runs async — consistent with schedules.js pattern
- [02-02]: PATCH /enabled triggers full startBroadcasts() reload — keeps in-memory cron jobs in sync with DB state on every toggle
- [Phase 03-frontend-ui]: PATCH /api/broadcasts/:id/enabled confirmed as correct endpoint
- [03-02]: window._subjects and window._broadcasts exposed at data-load time (not module init) so cross-module access always gets fresh data
- [03-02]: Raw fetch() used for all FormData/multipart; api() only for JSON payloads — browser must set Content-Type boundary automatically

### Pending Todos

None yet.

### Blockers/Concerns

- app.js is 2254+ lines — Phase 3 UI additions should use a new public/broadcast-modal.js file (follow schedule-modal.js pattern) rather than expanding app.js further
- localhost images not fetchable by Facebook Graph API in dev — only works in production with public URL

## Session Continuity

Last session: 2026-04-15
Stopped at: Completed 03-02-PLAN.md (broadcast add/edit modal — all phases complete)
Resume file: None
