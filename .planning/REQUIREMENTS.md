# Requirements: Affiliate Heaven — Broadcast Messages

**Defined:** 2026-04-15
**Core Value:** Niche owners can schedule evergreen messages to reach their audiences at the right time — without touching the product pipeline.

## v1 Requirements

### Broadcast Message Management

- [x] **BCAST-01**: User can create a broadcast message with a label and pre-written text content
- [x] **BCAST-02**: User can assign a broadcast message to a specific niche (required — no "all niches" option)
- [x] **BCAST-03**: User can optionally upload an image to attach to a broadcast message
- [x] **BCAST-04**: User can edit an existing broadcast message (label, content, image, schedule, niche)
- [x] **BCAST-05**: User can delete a broadcast message (with confirmation)
- [x] **BCAST-06**: User can enable or disable a broadcast message without deleting it
- [x] **BCAST-07**: User can fire a broadcast message immediately regardless of its schedule

### Scheduling

- [x] **SCHED-01**: User can set a daily recurrence at a specific hour (e.g. every day at 22:00)
- [x] **SCHED-02**: User can set a weekly recurrence on a specific day + hour (e.g. every Friday at 18:00)
- [x] **SCHED-03**: User can set an every-N-days recurrence at a specific hour (e.g. every 3 days at 11:00)
- [x] **SCHED-04**: Broadcast message list shows next scheduled run time for each enabled message

### Delivery

- [x] **DLVR-01**: Scheduled broadcast sends text (+ optional image) to the niche's Facebook page via Graph API
- [x] **DLVR-02**: Scheduled broadcast sends text (+ optional image) to the niche's WhatsApp group via MacroDroid webhook

### UI

- [x] **UI-01**: Broadcast messages section appears in the "לוחות זמנים" tab, below existing product schedules, visually separated
- [ ] **UI-02**: Add/edit modal includes: label field, niche selector, textarea with character counter, image uploader with preview, recurrence builder with human-readable preview line

## v2 Requirements

### Analytics

- **ANLX-01**: Track send success/failure per broadcast message
- **ANLX-02**: Show send history log per broadcast message
- **ANLX-03**: Click tracking on links included in broadcast messages

### Advanced Scheduling

- **SCHED-05**: Bi-weekly recurrence (every 2 weeks on a specific day)
- **SCHED-06**: Monthly recurrence (on a specific day of month)
- **SCHED-07**: Multiple send times per day

### Delivery

- **DLVR-03**: Instagram support for broadcast messages (when requested)
- **DLVR-04**: "All niches" broadcast option (send to all subjects simultaneously)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Instagram delivery | Not requested for this milestone; different API flow |
| AI-generated content | Messages are pre-written by owner; AI pipeline is for products |
| "All niches" broadcast | Messages are niche-specific by design; content relevance per audience |
| Raw cron expression editing | Human-friendly builder covers all stated use cases |
| Cloud image storage (S3/Cloudinary) | Local filesystem sufficient for this milestone |
| Per-send analytics | v2 concern; core delivery first |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BCAST-01 | Phase 1 | Complete |
| BCAST-02 | Phase 1 | Complete |
| BCAST-03 | Phase 1 | Complete |
| BCAST-04 | Phase 1 | Complete |
| BCAST-05 | Phase 1 | Complete |
| BCAST-06 | Phase 1 | Complete |
| BCAST-07 | Phase 1 | Complete |
| SCHED-01 | Phase 1 | Complete |
| SCHED-02 | Phase 1 | Complete |
| SCHED-03 | Phase 1 | Complete |
| SCHED-04 | Phase 1 | Complete |
| DLVR-01 | Phase 2 | Complete |
| DLVR-02 | Phase 2 | Complete |
| UI-01 | Phase 3 | Complete |
| UI-02 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-15*
*Last updated: 2026-04-15 after roadmap creation (BCAST-03 moved Phase 2 → Phase 1: image upload is a backend data concern, not a delivery concern)*
