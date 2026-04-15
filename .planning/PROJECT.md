# Affiliate Heaven — Broadcast Messages Milestone

## What This Is

Affiliate Heaven is a Node.js/Express dashboard that automates affiliate product broadcasting to WhatsApp groups and Facebook pages on a cron schedule, organized by niche (subject). This milestone adds a **Broadcast Messages** system: pre-written messages (text + optional image) that owners can schedule to send to WhatsApp groups and Facebook pages on a recurring basis, independent of the product pipeline.

## Core Value

Niche owners can schedule evergreen messages (greetings, announcements, deals) to reach their audiences at the right time — without touching the product pipeline.

## Requirements

### Validated

- ✓ Multi-niche (subject) system with per-niche WhatsApp group, Facebook page, and MacroDroid webhook — existing
- ✓ Product broadcasting pipeline (AI-generated Hebrew messages → WhatsApp + Facebook) — existing
- ✓ Cron-based scheduler with enable/disable, fire-now, edit — existing
- ✓ PostgreSQL data store with idempotent migrations — existing
- ✓ Google OAuth authentication, invite-only, role-based (admin/user) — existing
- ✓ Hebrew RTL dark-theme dashboard UI with Material Symbols icons — existing

### Active

- [ ] User can create a broadcast message with label, text content, and optional image
- [ ] User can assign a broadcast message to a specific niche (required — no "all niches")
- [ ] User can set a recurring schedule: daily at hour / weekly on day+hour / every N days at hour
- [ ] Broadcast messages are sent to both WhatsApp (MacroDroid webhook) and Facebook page for the niche
- [ ] User can upload an image to attach to a broadcast message
- [ ] User can enable/disable individual broadcast messages
- [ ] User can fire a broadcast message immediately (fire-now)
- [ ] User can edit and delete broadcast messages
- [ ] Broadcast message list shows human-readable schedule + next run time

### Out of Scope

- Instagram — not requested; WhatsApp + Facebook only
- AI-generated content — messages are pre-written by the user
- "All niches" broadcast — messages are niche-specific by design
- Raw cron expression editing — human-friendly recurrence builder only
- Per-send analytics / click tracking — out of scope for this milestone

## Context

**Existing architecture:**
- `services/workflow.js` — product pipeline (AI → WhatsApp + Facebook + Instagram)
- `scheduler/index.js` — node-cron manager, loads schedules from DB on startup
- `routes/` — one file per resource, all require auth
- `db/migrate.js` — idempotent `CREATE TABLE IF NOT EXISTS`, called on startup
- `public/app.js` (2231 lines) — vanilla JS SPA, Hebrew RTL
- `public/index.html` — tab-based layout, "לוחות זמנים" tab houses existing schedules
- MacroDroid webhook sends WhatsApp messages per subject
- Facebook Graph API posts to pages per subject

**UI context:**
- Dark theme, RTL Hebrew, Material Symbols Outlined icons
- Tab navigation: products / schedules / scraper / add-product / logs / settings / users
- Broadcast messages will live as a new section within the "לוחות זמנים" tab
- Existing schedule cards as design reference

**Codebase map:** `.planning/codebase/` (7 documents, 1473 lines)

## Constraints

- **Tech stack**: Node.js/Express + vanilla JS + PostgreSQL — no new frameworks
- **UI**: Must match existing dark RTL Hebrew theme (no design system changes)
- **DB**: Extend via `db/migrate.js` idempotent migrations only
- **Auth**: All `/api/*` routes require existing session auth middleware
- **Image storage**: Upload to `public/uploads/broadcasts/` (local filesystem, served statically) — no cloud storage for this milestone

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| New `broadcast_messages` table (not extend `schedules`) | Product schedules and broadcast messages are fundamentally different pipelines; avoids nulls, branching in workflow.js, and tight coupling | — Pending |
| Human-friendly recurrence builder (daily/weekly/every-N-days) | Covers all stated use cases; raw cron hidden from user | — Pending |
| WhatsApp + Facebook only (no Instagram) | User requirement; Instagram uses different Content Publishing API flow | — Pending |
| Subject required (no "all niches") | Broadcast content is niche-specific; messages reference niche audience | — Pending |
| Local image upload to public/uploads/ | Simplest approach; no cloud storage dependency for this milestone | — Pending |

---
*Last updated: 2026-04-15 after initialization*
