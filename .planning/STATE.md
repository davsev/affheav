# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-29)

**Core value:** Niche owners can run multiple affiliate channels — each with its own audience, accounts, and schedule — from a single platform, without manual intervention.
**Current focus:** Milestone v2.0 — Microservices Rebuild (Phase 4 complete, ready for Phase 5)

## Current Position

Phase: Phase 11 — Frontend Rebuild + i18n (in progress)
Plan: 11-01 complete
Status: Plan 11-01 complete — apps/web scaffold, RTL providers, JWT auth store, axios interceptors, i18n init
Last activity: 2026-05-28 — Plan 11-01 executed (Vite+React19+Mantine9 bootstrap, 742 i18n keys seeded)

Progress: ██░░░░░░░░ 11% (1/9 v2.0 phases complete)

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

**v2.0 Velocity (so far):**

| Phase | Plans | Status |
|-------|-------|--------|
| 04-monorepo-scaffold-infrastructure | 3 | ✅ Complete |
| 05-api-gateway-feature-flag-system P01 | 5 min | 3 tasks | 6 files |
| Phase 05-api-gateway-feature-flag-system P02 | 15 | 2 tasks | 8 files |
| Phase 11-frontend-rebuild-i18n P01 | 2 | 2 tasks | 11 files |

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
- NodeNext module resolution requires `.js` extensions in import paths (not `.ts`) — even inside TypeScript source files
- @hono-rate-limiter/redis pinned to ^0.1.4 (latest on npm as of 2026-05-21); plan spec ^0.5.0 does not exist
- All drizzle ORM queries centralized in packages/db — no drizzle-orm imports in app packages; prevents TypeScript dual-instance error with NodeNext composite project references
- @hono-rate-limiter/redis v0.1.4 uses client interface (scriptLoad/evalsha/decr/del) not sendCommand — ioredis adapter wraps each method with catch for fail-open behavior
- applyJwtMiddleware() uses early-return guard when jwksUri empty; hono 4.12.14 has no jwk() export — enforcement gate reads jwtPayload set by Phase 6 upstream JWT middleware
- vitest pinned to ^2.1.9 in gateway — v4 requires Node 22; dev env is Node 20.10
- resolveUpstream() accepts flagOverrides param for unit testing without DB/Redis dependency
- ESNext.Collection added to apps/web tsconfig lib — Mantine 9 @mantine/hooks uses ReadonlySetLike not present in ES2022

### Phase 4 Decisions (locked)

- `pnpm -r run typecheck` (not `pnpm -r tsc --noEmit`) — the latter looks for a script named `tsc`; each package exposes a `typecheck` script
- All packages expose `test` and `lint` scripts so `pnpm -r run test/lint` recurse cleanly in CI
- `packages/db/src/index.ts` re-exports use `.js` extensions — required for NodeNext module resolution
- Monolith `server.js` stays at repo root during transition — `apps/monolith` is a thin wrapper that points to it

### Research Flags (for `/gsd:plan-phase` to note)

- **Phase 5 (Gateway):** Hono proxy middleware patterns; feature flag DB schema in `gateway` PostgreSQL schema; JWT verification middleware without auth service being live yet
- **Phase 6 (Auth):** RS256 public key distribution to Hono services; Railway secret manager integration; refresh token rotation; dual-auth window edge cases
- **Phase 9 (Channels):** opossum v9 per-user Redis-backed circuit breaker isolation against v9 API
- **Phase 10 (Scheduler/Broadcaster):** BullMQ worker pool tuning for mixed fast/slow jobs; SSE stream proxy via API gateway

### v1.0 Decisions (preserved for reference)

- broadcast_messages table separate from schedules — different pipelines, avoids nulls
- recurrence JSONB + cron VARCHAR stored as pair — JSONB for UI pre-population
- WhatsApp + Facebook only (v1.0) — Instagram added in v2.0 channels service
- Local image upload to public/uploads/ — cloud storage deferred

### Pending Todos

- Plan Phase 5 via `/gsd:plan-phase 5`

### Blockers/Concerns

- public/app.js is 2231 lines — full replacement planned in Phase 11
- Google Sheets dependency still present — to be fully retired in Phase 8 (products service)
- Railway PostgreSQL multi-schema user grants should be verified before Phase 5+ DB schema work

## Session Continuity

Last session: 2026-05-28
Stopped at: Completed 11-01-PLAN.md
Resume: Run next plan in Phase 11
