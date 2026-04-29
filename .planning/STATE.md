# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-29)

**Core value:** Niche owners can run multiple affiliate channels — each with its own audience, accounts, and schedule — from a single platform, without manual intervention.
**Current focus:** Milestone v2.0 — Microservices Rebuild (defining requirements)

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements for v2.0
Last activity: 2026-04-29 — Milestone v2.0 started (Microservices Rebuild)

Progress: ░░░░░░░░░░ 0%

## Performance Metrics (v1.0 Reference)

**v1.0 Velocity:**
- Total plans completed: 7
- Average duration: 5 min
- Total execution time: ~35 min

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-backend-foundation | 3 | 15 min | 5 min |
| 02-scheduler-delivery | 2 | 9 min | 4.5 min |
| 03-frontend-ui | 2 | 11 min | 5.5 min |

## Accumulated Context

### Key Decisions (v2.0)

- Strangler Fig migration — monolith stays live, one service extracted at a time on feature branches
- Feature branch experiments — service goes live only when stable, monolith fallback otherwise
- pnpm workspaces monorepo — single repo, shared tooling, cross-service TypeScript types
- Mantine for frontend — best RTL support, dark mode built-in, no custom CSS
- BullMQ + Redis — async job queue replaces cron-to-workflow coupling
- AES-256 encryption for user credentials — no per-user values in env vars
- Vitest — unit tests required per service before merge

### v1.0 Decisions (preserved for reference)

- broadcast_messages table separate from schedules — different pipelines, avoids nulls
- recurrence JSONB + cron VARCHAR stored as pair — JSONB for UI pre-population
- WhatsApp + Facebook only (v1.0) — Instagram added in v2.0 channels service
- Local image upload to public/uploads/ — cloud storage deferred

### Pending Todos

None — milestone just started.

### Blockers/Concerns

- public/app.js is 2231 lines — full replacement planned in frontend phase
- Google Sheets dependency still present — to be fully retired in products service phase

## Session Continuity

Last session: 2026-04-29
Stopped at: Milestone v2.0 started — running research before requirements
Resume: Run research → requirements → roadmap
