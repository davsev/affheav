# Roadmap: Affiliate Heaven — Broadcast Messages

## Overview

Three phases deliver the Broadcast Messages feature end-to-end. Phase 1 builds the data foundation: the broadcast_messages table, CRUD API, image upload handling, and recurrence-to-cron conversion. Phase 2 wires the scheduler and delivery: broadcast jobs load on startup alongside product schedules and fire to Facebook and WhatsApp. Phase 3 delivers the frontend: the dashboard section, add/edit modal, recurrence builder, and live enable/disable controls.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Backend Foundation** - broadcast_messages table, CRUD API, image upload, recurrence-to-cron conversion (completed 2026-04-15)
- [ ] **Phase 2: Scheduler & Delivery** - cron job loading for broadcasts, Facebook + WhatsApp sending
- [ ] **Phase 3: Frontend UI** - dashboard section, add/edit modal, recurrence builder, image preview

## Phase Details

### Phase 1: Backend Foundation
**Goal**: A fully-functional broadcast messages API exists — messages can be created, read, updated, deleted, enabled/disabled, and fired; images can be uploaded; recurrence modes convert to valid cron expressions
**Depends on**: Nothing (first phase)
**Requirements**: BCAST-01, BCAST-02, BCAST-03, BCAST-04, BCAST-05, BCAST-06, BCAST-07, SCHED-01, SCHED-02, SCHED-03, SCHED-04
**Success Criteria** (what must be TRUE):
  1. A broadcast message can be created via POST /api/broadcasts with label, text, subject_id, and recurrence params; it appears on GET /api/broadcasts
  2. An uploaded image (via POST /api/broadcasts/:id/image or multipart on create) is saved to public/uploads/broadcasts/ and its URL is stored on the record
  3. GET /api/broadcasts returns each message with a human-readable schedule string and the next scheduled run time
  4. PUT /api/broadcasts/:id updates any field; DELETE /api/broadcasts/:id removes the record; PATCH /api/broadcasts/:id/enabled toggles active state
  5. POST /api/broadcasts/:id/fire-now returns a delivery result object (even if delivery is stubbed) without errors
**Plans**: TBD

### Phase 2: Scheduler & Delivery
**Goal**: Enabled broadcast messages fire on their cron schedule and successfully send text (+ optional image) to the niche's WhatsApp group and Facebook page
**Depends on**: Phase 1
**Requirements**: DLVR-01, DLVR-02
**Success Criteria** (what must be TRUE):
  1. On server startup, enabled broadcast_messages are loaded into the cron scheduler alongside product schedules (visible in startup logs)
  2. When a broadcast job fires (by schedule or fire-now), the niche's Facebook page receives a text post (+ image if set) via the Graph API
  3. When a broadcast job fires, the niche's WhatsApp group receives the message text (+ image if set) via the MacroDroid webhook
  4. A failed delivery to one platform (e.g., bad Facebook token) does not block delivery to the other platform
**Plans**: TBD

### Phase 3: Frontend UI
**Goal**: Users can manage all broadcast messages from the dashboard without touching the API directly — the broadcast section is visible in the schedules tab with full create/edit/delete/enable/fire-now controls
**Depends on**: Phase 2
**Requirements**: UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. The "לוחות זמנים" tab shows a broadcast messages section below the product schedules section, visually separated with a heading
  2. Each broadcast message card displays its label, niche, schedule description, next run time, and enabled/disabled state
  3. The add/edit modal includes: label field, niche dropdown, textarea with character counter, image uploader with preview, and a recurrence builder (daily/weekly/every-N-days) with a live human-readable preview line
  4. Enable/disable toggle, fire-now button, edit button, and delete button (with confirmation) all function correctly from the card
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Backend Foundation | 3/3 | Complete   | 2026-04-15 |
| 2. Scheduler & Delivery | 0/? | Not started | - |
| 3. Frontend UI | 0/? | Not started | - |
