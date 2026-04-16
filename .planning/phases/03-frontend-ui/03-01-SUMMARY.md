---
phase: 03-frontend-ui
plan: 01
subsystem: frontend
tags: [ui, broadcasts, schedules-tab, vanilla-js]
dependency_graph:
  requires: []
  provides: [loadBroadcasts, _broadcasts, fireBroadcastNow, toggleBroadcast, deleteBroadcast, bcast-msg-preview]
  affects: [public/index.html, public/app.js, public/style.css]
tech_stack:
  added: []
  patterns: [window.* onclick handlers, module-scope _ array, escHtml/fmtDate utils]
key_files:
  created: []
  modified:
    - public/index.html
    - public/app.js
    - public/style.css
decisions:
  - "PATCH /api/broadcasts/:id/enabled confirmed as correct endpoint (matches Phase 2 routes)"
  - "bcastRecurrenceLabel() kept as local helper inside loadBroadcasts() — not window-exposed"
  - "Stub openAddBroadcast/openEditBroadcast alert placeholders — Plan 02 replaces with real modal"
metrics:
  duration: 7min
  completed: 2026-04-16T05:21:49Z
  tasks_completed: 3
  files_modified: 3
---

# Phase 3 Plan 01: Broadcast Messages List UI Summary

Broadcast message list section added to the schedules tab — HTML shell, data-loading, card rendering, and all card-level action handlers wired to the Phase 1/2 API endpoints.

## What Was Built

- **#broadcasts-list** card in `#tab-schedules` with "הוסף הודעה" button
- **#broadcast-modal** empty overlay shell (modal body left empty for Plan 02)
- **loadBroadcasts()** — fetches `/api/broadcasts`, renders `.schedule-item` cards with niche chip, platform chips (WhatsApp + Facebook), 80-char preview, schedule label, next-run timestamp
- **fireBroadcastNow** — POST `/api/broadcasts/:id/fire-now`
- **toggleBroadcast** — PATCH `/api/broadcasts/:id/enabled`
- **deleteBroadcast** — DELETE `/api/broadcasts/:id` then reloads
- Startup: `loadBroadcasts()` called alongside `loadSchedules()` inside `loadSubjects().then()`
- **`.bcast-msg-preview`** CSS with `text-overflow: ellipsis` truncation
- **`.modal-body.scrollable`** opt-in modifier for Plan 02

## Deviations from Plan

None — plan executed exactly as written. PATCH endpoint URL confirmed matching Phase 2 implementation before coding.

## Commits

- `5559f6b` feat(03-01): add broadcast section HTML and modal shell to index.html
- `e0e3903` feat(03-01): add loadBroadcasts(), action handlers, and startup wiring to app.js
- `53b2aa4` feat(03-01): add .bcast-msg-preview and .modal-body.scrollable CSS

## Self-Check: PASSED

- public/index.html: FOUND
- public/app.js: FOUND
- public/style.css: FOUND
- Commits 5559f6b, e0e3903, 53b2aa4: all present in git log
