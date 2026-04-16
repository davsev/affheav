---
phase: 01-backend-foundation
plan: "03"
subsystem: api-routes
tags: [broadcasts, multer, image-upload, express-router]
dependency_graph:
  requires:
    - 01-backend-foundation-02-SUMMARY.md  # broadcastService.js CRUD + recurrenceToCron + computeNextRun
  provides:
    - routes/broadcasts.js                 # Express router, all 8 endpoints
  affects:
    - server.js                            # added /api/broadcasts mount
tech_stack:
  added:
    - multer@2.1.1                         # multipart/form-data + disk storage
  patterns:
    - UUID filenames for uploaded images
    - Multer error handler as last router middleware
    - Idempotent upload directory creation on require
key_files:
  created:
    - routes/broadcasts.js
    - public/uploads/broadcasts/           # directory (empty, created by require)
  modified:
    - server.js                            # one mount line added
    - package.json                         # multer added to dependencies
    - package-lock.json
decisions:
  - "Multer diskStorage with uuid filenames — avoids collisions, no cloud dependency"
  - "fire-now stubbed in Phase 1 — returns { whatsapp: { stubbed: true }, facebook: { stubbed: true } }"
  - "Upload directory created idempotently at require time — no manual setup needed"
metrics:
  duration: "5 min"
  completed: "2026-04-15"
  tasks_completed: 2
  files_changed: 5
---

# Phase 1 Plan 03: Broadcasts Router Summary

Express router for the broadcasts API — multer image upload, all 8 CRUD + control endpoints wired to broadcastService, mounted in server.js with isAuthenticated.

## What Was Done

**Task 1 — Install multer, create routes/broadcasts.js**

Installed `multer@2.1.1` and created `routes/broadcasts.js` implementing all 8 endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/broadcasts | List all broadcasts for authenticated user |
| POST | /api/broadcasts | Create broadcast (JSON or multipart with optional image) |
| GET | /api/broadcasts/:id | Get single broadcast (ownership enforced) |
| PUT | /api/broadcasts/:id | Update fields (supports multipart image replacement) |
| DELETE | /api/broadcasts/:id | Remove broadcast |
| PATCH | /api/broadcasts/:id/enabled | Toggle enabled state |
| POST | /api/broadcasts/:id/image | Standalone image upload for existing record |
| POST | /api/broadcasts/:id/fire-now | Stubbed delivery (Phase 2 wires real delivery) |

Multer configured: 10 MB file size limit, images-only fileFilter, UUID disk filenames, destination `public/uploads/broadcasts/`. Error handler registered last to catch `LIMIT_FILE_SIZE` and `Images only` errors that bypass route try/catch.

**Task 2 — Mount /api/broadcasts in server.js**

Added one line to the Protected API Routes section of server.js:
```javascript
app.use('/api/broadcasts',   isAuthenticated, require('./routes/broadcasts'));
```

## Files Created / Modified

- `routes/broadcasts.js` — new Express router, 130 lines
- `public/uploads/broadcasts/` — directory created idempotently on require
- `server.js` — one mount line added
- `package.json` / `package-lock.json` — multer added

## Endpoints Implemented

All 8 endpoints from BCAST-01 through BCAST-07 and SCHED-04 are registered. Each uses try/catch with appropriate status codes (201 for create, 404 for not-found, 400 for validation/upload errors, 500 for unexpected errors).

## Known Limitations

- **fire-now is stubbed** — returns `{ whatsapp: { stubbed: true }, facebook: { stubbed: true } }`. Phase 2 must replace with actual `broadcastDelivery.send(msg)` call.
- **No image deletion on record update** — when a broadcast's image is replaced (PUT or POST /:id/image), the old file on disk is not removed. Phase 2 or a cleanup task should handle orphaned uploads.
- **No subject ownership validation at route layer** — the service's `create` call relies on the DB FK constraint to reject invalid or other-user subject_ids with a thrown error (caught and returned as 400).

## What Phase 2 Needs to Wire

1. Replace `fire-now` stub with `broadcastDelivery.send(broadcast)` — deliver via WhatsApp (MacroDroid webhook) and Facebook (Graph API)
2. Extend `scheduler/index.js` to load `broadcast_messages` rows on startup and register cron jobs, without breaking existing product schedule jobs
3. Optionally: delete old image file when image is replaced on update

## Deviations from Plan

None — plan executed exactly as written.
