# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-29)

**Core value:** Niche owners can run multiple affiliate channels — each with its own audience, accounts, and schedule — from a single platform, without manual intervention.
**Current focus:** Milestone v2.0 — Microservices Rebuild (roadmap created, ready for Phase 4 planning)

## Current Position

Phase: Phase 4 — Monorepo Scaffold + Infrastructure (not started)
Plan: —
Status: Roadmap created — awaiting `/gsd:plan-phase 4`
Last activity: 2026-04-29 — Milestone v2.0 roadmap created (9 phases, 73 requirements)

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
- Hono 4.12.14 chosen over Fastify — faster, built-in JWT middleware, first-class TypeScript
- Drizzle ORM 0.45.2 (stable, not 1.0.0-beta) — schema-as-code, type-safe migrations
- BullMQ 5.75.2 + Redis — async job queue replaces cron-to-workflow coupling
- jose 5.x for JWT — async, ESM-compatible, RS256 asymmetric; auth-service holds private key
- AES-256-GCM for credential encryption — Node.js built-in crypto, per-record IV, `key_version` column required from day one
- Mantine 9.0.2 + React 19 for frontend — best RTL support, dark mode built-in, no custom CSS
- Vitest 4.1.5 — unit tests required per service before merge
- JWT `kid` key registry required from day one in auth service — costly to retrofit
- Separate PostgreSQL DB user per service — enforced from Phase 4; cross-boundary writes must fail with `permission denied`
- BullMQ idempotency requires BOTH deterministic job ID AND DB sent-flag check — neither guard alone is sufficient
- Drizzle migrations gated behind `RUN_MIGRATIONS=true` — never auto-run on startup

### Research Flags (for `/gsd:plan-phase` to note)

- **Phase 6 (Auth):** RS256 public key distribution to Hono services; Railway secret manager integration; refresh token rotation; dual-auth window edge cases
- **Phase 9 (Channels):** opossum v9 per-user Redis-backed circuit breaker isolation against v9 API
- **Phase 10 (Scheduler/Broadcaster):** BullMQ worker pool tuning for mixed fast/slow jobs; SSE stream proxy via API gateway

### v1.0 Decisions (preserved for reference)

- broadcast_messages table separate from schedules — different pipelines, avoids nulls
- recurrence JSONB + cron VARCHAR stored as pair — JSONB for UI pre-population
- WhatsApp + Facebook only (v1.0) — Instagram added in v2.0 channels service
- Local image upload to public/uploads/ — cloud storage deferred

### Pending Todos

- Plan Phase 4 via `/gsd:plan-phase 4`

### Blockers/Concerns

- public/app.js is 2231 lines — full replacement planned in Phase 11
- Google Sheets dependency still present — to be fully retired in Phase 8 (products service)
- Railway PostgreSQL multi-schema user grants should be verified before Phase 4 DB schema design is finalized

## Session Continuity

Last session: 2026-04-29
Stopped at: v2.0 roadmap created — 9 phases, 73 requirements mapped
Resume: Run `/gsd:plan-phase 4` to begin Phase 4 planning
