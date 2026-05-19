# Project Research Summary

**Project:** Affiliate Heaven v2.0 — Microservices Rebuild
**Domain:** Node.js/Express monolith → microservices via Strangler Fig
**Researched:** 2026-04-29
**Confidence:** HIGH

## Executive Summary

Affiliate Heaven v2.0 is a Strangler Fig extraction of a Node.js/Express broadcast-scheduling monolith into independently deployable microservices. Research confirms this is a well-documented problem domain with established patterns. The recommended approach: pnpm workspaces monorepo, Hono (not Fastify) as the HTTP framework for each service, Drizzle ORM 0.45.x (stable) for type-safe schema management, BullMQ + Redis replacing direct cron-to-workflow coupling, and a React 19 + Mantine 9 frontend (RTL Hebrew dark theme). The gateway-first extraction order is non-negotiable: the API Gateway and Auth Service must ship before any other service can be safely extracted.

Three decisions must be made in Phases 1-2 or they become expensive to retrofit. First: the JWT `kid` key registry — a single-secret JWT system cannot rotate keys without a mass 401 event; `kid`-based signing must be in the auth service from day one. Second: AES-256-GCM credential encryption with a `key_version` column — credentials stored without version tracking cannot be migrated when the encryption key rotates; adding the column after the fact requires decrypting every record while the old key is still available. Third: separate PostgreSQL credentials per service — enforcing DB ownership boundaries via Postgres user grants is the only reliable way to prevent cross-service data coupling during the Strangler Fig transition window.

The primary execution risk is BullMQ retry loops causing duplicate broadcasts. The fix is a two-part idempotency guard: a deterministic job ID (`broadcast:${productId}:${subjectId}`) plus a DB-level sent-flag check before every external API call. Neither guard alone is sufficient. A secondary risk is silent divergence between the monolith's `workflow.js` and the new broadcaster-service during the extraction window — a hard 21-day merge deadline policy, enforced via PR template, is the only practical mitigation.

## Key Findings

### Recommended Stack

The stack is anchored by Hono 4.12.14 (faster than Fastify, first-class TypeScript, runs on Node 20+, built-in JWT middleware via `@hono/jwt`) and Drizzle ORM 0.45.x stable (not the 1.0.0-beta which changed migration behavior). BullMQ 5.75.2 with ioredis 5.x replaces the existing node-cron direct coupling. The monolith's vanilla JS frontend is fully replaced by React 19 + Mantine 9.0.2 — Mantine 9 is the current version as of April 2026 and requires React 19; do not reference v7 (EOL) documentation. All credential encryption uses Node.js built-in `crypto` with AES-256-GCM (authenticated encryption) — never CBC. Vitest 4.1.5 runs across all workspace packages via a root `vitest.config.ts` projects array.

**Core technologies:**
- **Hono 4.12.14**: HTTP framework for each microservice — fastest Node.js framework in 2026, built-in JWT middleware, no plugin ecosystem lock-in
- **Drizzle ORM 0.45.2 (stable)**: Schema-as-code + type-safe queries + `drizzle-kit generate` SQL migrations — replaces raw `pg` + manual `CREATE TABLE IF NOT EXISTS`
- **BullMQ 5.75.2**: Scheduler → job queue → broadcaster pipeline — replaces direct cron-to-workflow coupling; provides retries, dead-letter queues, job dedup by ID
- **jose 5.x**: JWT sign/verify — async, ESM-compatible, RS256 asymmetric; auth-service holds private key, all other services verify with public key
- **Node.js `crypto` (built-in)**: AES-256-GCM credential encryption — no extra dependency, GCM provides authenticated encryption with per-record IV
- **React 19 + Mantine 9.0.2**: Frontend SPA — Mantine 9 requires React 19; first-class RTL via `DirectionProvider`, dark mode via `defaultColorScheme="dark"`
- **pnpm 9.x workspaces**: Monorepo package management — 3x faster than npm, content-addressable store, `workspace:*` protocol for internal linking
- **TypeScript 5.x**: Type safety across all services — required for Drizzle schema types, Hono route typing, shared `packages/types`

### Expected Features

Research identifies 5 feature categories new to v2.0 (v1.0 broadcast pipeline features are validated and not re-researched).

**Must have (P1 — v2.0 does not ship without these):**
- API Gateway with JWT validation and Strangler Fig routing table — prerequisite for all service extraction
- Auth service: Google OAuth → JWT (RS256, 15-min access / 30-day refresh), `kid` key registry, invite flow
- Per-user credential storage with AES-256-GCM encryption and `key_version` column
- Two-role RBAC (admin/user) enforced at gateway AND at each service layer (defense in depth)
- BullMQ + Redis replacing direct cron → workflow coupling
- Circuit breakers (opossum v9) on Facebook and WhatsApp channel adapters

**Should have (P2 — add during service extraction phases):**
- Dead letter queue UI showing failed jobs with error reason
- Channel health status endpoint (`GET /api/channels/health`) + dashboard widget
- Credential validation on save (call provider's verify endpoint, surface actionable errors)
- Per-user circuit breaker isolation keyed by `(userId, channelType)` in Redis

**Defer (v2.x):**
- Admin impersonation / act-as-user (short-lived JWT with `impersonatedBy` claim)
- Canary traffic split with weighted routing
- Credential health background checker
- Automated rollback on error rate spike

**Explicit anti-features (do not build):**
- Organization/team model — doubles auth complexity; each user owns their own subjects
- Per-tenant database schemas — overkill at this scale; single schema with `user_id` FK isolation is correct
- Big-bang rewrite — all-or-nothing risk; Strangler Fig is the stated and correct strategy

### Architecture Approach

The target architecture is a 10-service pnpm monorepo behind a single API gateway, extracted wave-by-wave from the existing monolith. Services communicate synchronously via HTTP (Hono REST) for user-initiated reads/CRUD, and asynchronously via BullMQ for broadcast jobs. The database strategy is schema-per-service on a single Railway PostgreSQL cluster — separate Postgres user per service, each granted access only to its own schema. No cross-service DB JOINs; services call each other's HTTP APIs for cross-domain data. The monolith's `isAuthenticated` middleware is the one required monolith change during migration: extend it to accept JWT Bearer tokens alongside existing session cookies (dual-auth window until 30-day cookies expire naturally).

**Major components and responsibilities:**

| Component | Wave | Responsibility | DB Ownership |
|-----------|------|----------------|--------------|
| api-gateway | 2 | JWT validation, rate limiting, Strangler Fig routing table | none |
| auth-service | 1 | Google OAuth flow, JWT issuance (`kid` registry), invite tokens | `auth` schema |
| user-service | 3 | User CRUD, roles, AES-256-GCM encrypted credentials, `key_version` | `users` schema |
| subjects-service | 4 | Niche CRUD, per-niche platform toggles | `subjects` schema |
| products-service | 5 | Product CRUD, AliExpress import, URL shortening | `products` schema |
| ai-writer-service | 6 | OpenAI Hebrew message generation, Shabbat/Motzei Shabbat logic | `ai` schema |
| channels-service | 7 | WhatsApp/Facebook/Instagram adapters, circuit breakers (opossum) | none (stateless) |
| scheduler-service | 8 | Load cron schedules from DB, publish BullMQ jobs | `scheduler` schema |
| broadcaster-service | 9 | BullMQ consumer, full pipeline orchestration, SSE log emit | `logs` schema |
| frontend | 10 | React 19 + Mantine 9, Hebrew RTL dark theme | none |

### Critical Pitfalls

1. **BullMQ duplicate broadcasts** — Must implement BOTH a deterministic job ID (`broadcast:${productId}:${subjectId}`) AND a DB-level `sent_facebook_at` / `sent_wa_at` check before each external API call. Neither guard alone is sufficient. Never enable `attempts > 1` without both guards in place.

2. **JWT `kid` key registry not implemented at auth-service launch** — Without `kid`-versioned signing, any secret rotation causes an immediate mass 401 for all active users and in-flight service-to-service tokens. This is extremely expensive to retrofit. Implement from day one in the auth service.

3. **AES-256 encryption without `key_version` column** — If `ENCRYPTION_KEY` is rotated and no `key_version` is stored per credential, all existing credentials become permanently inaccessible without the old key. Store `key_version` alongside every encrypted record from day one. Use GCM (not CBC) — CBC has no authentication tag and silently decrypts tampered data.

4. **Shared PostgreSQL pool / credentials during Strangler Fig transition** — The monolith and a new service sharing a DB pool creates race conditions, schema lock conflicts, and makes table ownership impossible to establish. Enforce separate Postgres DB users per service from day one; test by attempting a cross-boundary write (it must fail with `permission denied`).

5. **Instagram container blocking poll in BullMQ worker** — The existing 30-second synchronous poll in `instagram.js` will stall BullMQ worker concurrency slots if carried over as-is. Extract Instagram publishing into two BullMQ jobs: `instagram:create-container` (fast) and `instagram:publish-container` (scheduled with BullMQ `delay: 30000`). Only set `sent_instagram_at` after publish succeeds.

6. **Drizzle migration auto-running on startup against production** — `ALTER TABLE ... RENAME COLUMN`, `SET NOT NULL`, and `DROP COLUMN` acquire ACCESS EXCLUSIVE locks that block all reads and writes. Gate migrations behind `RUN_MIGRATIONS=true` env var, never auto-run on startup. Review every generated SQL file before running in production. Use expand-contract pattern for any column change.

## Implications for Roadmap

Phase ordering is strictly enforced by the dependency graph. API Gateway cannot exist without Auth (JWT must be issuable before the gateway can validate tokens). User/credential service cannot exist without Auth (userId from JWT scopes credentials). All downstream services (subjects, products, ai-writer, channels, scheduler, broadcaster) cannot be safely extracted until the gateway's routing table exists to redirect their traffic. Frontend is last because it depends on the full stable API surface.

### Phase 1: Monorepo Scaffold + Infrastructure
**Rationale:** Zero services can be built until the monorepo structure, shared TypeScript config, Docker Compose, and CI pipeline are in place. Workspace resolution (pnpm symlinks, `dist/` build output, cross-package imports in Docker) must be validated end-to-end before the first service is written.
**Delivers:** pnpm workspace monorepo; shared `packages/types`, `packages/config`, `packages/db` (Drizzle schema); Docker Compose (all services + Redis + PostgreSQL); GitHub Actions CI (tsc + Vitest); Drizzle migration review process with `RUN_MIGRATIONS=true` gate; schema-per-service DB layout with separate Postgres credentials.
**Addresses:** Per-user credential namespace (DB schema design), data isolation (schema ownership), migration safety (Drizzle review process)
**Avoids:** Shared database pool coupling (Pitfall 1), Drizzle migration locks (Pitfall 4), pnpm TypeScript path resolution divergence (Pitfall 7)
**Research flag:** Standard patterns — skip research-phase. pnpm workspaces and Docker Compose multi-service setup are well-documented.

### Phase 2: Auth Service + API Gateway
**Rationale:** These two services are co-dependent and must ship together. Auth issues JWTs; the gateway validates them. No other service can run independently until JWT validation is available. This is also when the monolith receives its one required change: dual-auth `isAuthenticated` middleware (session + JWT Bearer both accepted).
**Delivers:** `auth-service` (Google OAuth → RS256 JWT with `kid` registry, 15-min access / 30-day refresh tokens, invite flow); `api-gateway` (JWT validation, rate limiting, Strangler Fig routing table — initially passes 100% to monolith); dual-auth `isAuthenticated` in monolith.
**Implements:** RS256 asymmetric JWT (auth-service holds private key, public key distributed to all other services), `kid`-versioned key registry (never a single `JWT_SECRET` string)
**Addresses:** Stateless JWT RBAC (role + sub claims), invite-only registration, admin/user two-role model
**Avoids:** JWT rotation mass 401 (Pitfall 5 — `kid` registry from day one), big-bang auth migration (dual-auth window), session invalidation on deploy
**Research flag:** Needs research-phase. RS256 key distribution pattern to Hono services, Railway secret manager integration for key rotation, and refresh token rotation implementation have known gotchas.

### Phase 3: User Service + Credential Storage
**Rationale:** Auth is a hard prerequisite (userId from JWT scopes all credential queries). User service unblocks subjects service (subjects belong to users) and the channels service (credentials retrieved at broadcast time).
**Delivers:** `user-service` (user CRUD, roles, per-user AES-256-GCM encrypted credentials with `key_version` column and per-record random IV); admin user management (list, suspend, delete, promote); credential validation on save (provider verify endpoint calls).
**Implements:** AES-256-GCM encrypt/decrypt with `key_version` column; `user_credentials` table keyed by `(user_id, provider, key_name)` (row-per-key for partial updates); boolean presence indicators only returned to client (never raw tokens).
**Avoids:** AES-256 key rotation orphaning records (Pitfall 6 — `key_version` from day one), CBC mode (use GCM), plaintext credential storage
**Research flag:** Standard patterns. AES-256-GCM with Node.js `crypto` is fully documented in STACK.md. The `key_version` rotation pattern is straightforward.

### Phase 4: Subjects + Products Services
**Rationale:** User service must be live (subjects have `user_id` FK). These two services can be extracted in parallel on separate branches since products depend on subjects only at query time (tagging), not at service call time. Both are clean CRUD + minimal logic services — low risk.
**Delivers:** `subjects-service` (niche CRUD, per-niche platform toggles, linked to user_credentials); `products-service` (product CRUD, sort_order queue, AliExpress affiliate API import, spoo.me URL shortening).
**Avoids:** Cross-service direct DB queries (subjects-service and products-service call each other via HTTP, never share a DB pool)
**Research flag:** AliExpress MD5-signed API request pattern may need research-phase — sparse public documentation.

### Phase 5: AI Writer + Channels Services
**Rationale:** AI writer is effectively stateless (calls OpenAI, stores prompt templates, no user data coupling beyond prompt overrides). Channels service is also stateless (adapter pattern, reads credentials from user-service at call time). Both unblock the broadcaster service in the next phase. Circuit breaker implementation (opossum v9) lives in channels-service.
**Delivers:** `ai-writer-service` (OpenAI GPT-4 Mini, Hebrew message generation, Shabbat/Motzei Shabbat greeting logic by Asia/Jerusalem day/time, per-subject prompt override); `channels-service` (WhatsApp MacroDroid webhook, Facebook Graph API v23, Instagram Content Publishing API v24 adapters; opossum v9 circuit breakers; two-phase Instagram publish job pattern).
**Addresses:** Circuit breakers per channel (P1), partial send success handling (per-platform sent flags), Instagram blocking poll fix
**Avoids:** Instagram container blocking poll (Pitfall 8 — two-phase BullMQ job), synchronous channel delivery, infinite retry loops
**Research flag:** opossum v9 per-user circuit breaker isolation with Redis-backed state may need research-phase.

### Phase 6: Scheduler + Broadcaster Services
**Rationale:** Broadcaster depends on all upstream services (products, subjects, ai-writer, channels). Scheduler depends on subjects/products existing to know what to enqueue. These are the last synchronous services extracted before the frontend.
**Delivers:** `scheduler-service` (reads cron schedules from DB, publishes `{ userId, subjectId, productId? }` BullMQ jobs, hot-reload on schedule change, Asia/Jerusalem timezone); `broadcaster-service` (BullMQ consumer, full pipeline orchestration: fetch product → generate message → send per channel → mark sent → append log → SSE emit; BullMQ idempotency: deterministic job ID + DB sent-flag guard; dead letter queue with admin UI; per-platform sent timestamps).
**Implements:** BullMQ idempotency guard (job ID `broadcast:${productId}:${subjectId}` + DB check before each platform API call), separate BullMQ job per subject per schedule tick, one job per platform type to prevent cross-platform retry contamination
**Avoids:** BullMQ duplicate broadcasts (Pitfall 2 — both guards required), extracting broadcaster before its dependencies, synchronous chain for broadcasting
**Research flag:** Needs research-phase. BullMQ worker concurrency tuning for mixed fast (WhatsApp) and slow (Instagram two-phase) jobs; SSE stream migration path from monolith to broadcaster-service.

### Phase 7: Frontend Rebuild
**Rationale:** Frontend is last because it depends on the full stable API surface from the gateway. All endpoints must be finalized before the React SPA is built against them.
**Delivers:** `frontend` (React 19 + Mantine 9.0.2, Hebrew RTL via `DirectionProvider`, dark theme via `defaultColorScheme="dark"`, `dir="rtl"` on `<html>`, `ColorSchemeScript` in `<head>` to prevent flash, all dashboard sections: products, subjects, schedules, logs, settings/credentials, admin user management); Vite build; PWA manifest.
**Implements:** `DirectionProvider` + `MantineProvider` bootstrap; `dir="ltr"` on number-only inputs within RTL context; per-platform delivery status in product list; BullMQ failed job alerts in dashboard.
**Avoids:** RTL broken by missing `DirectionProvider`, dark mode flash (use `ColorSchemeScript`), scheduler times shown in UTC (always `Asia/Jerusalem`)
**Research flag:** Standard patterns. Mantine 9 RTL and dark mode are fully documented. Research-phase only if Mantine Hebrew-specific edge cases surface during implementation.

### Phase Ordering Rationale

- **Gateway before all services:** The Strangler Fig routing table must exist before any service is extracted. On day one the gateway passes 100% of traffic to the monolith; it progressively routes to new services as they ship.
- **Auth before gateway:** The gateway validates JWTs; JWTs can only exist if the auth service can issue them.
- **User/credentials before subjects:** Subjects have a `user_id` FK and read credentials from user-service. This ordering enforces the DB ownership boundary early.
- **Services 4-7 before broadcaster:** The broadcaster calls all of them via HTTP. If they are not extracted first, the broadcaster would make HTTP calls back into the monolith indefinitely — a routing tangle that defeats the purpose of extraction.
- **Frontend last:** Depends on the full stable API surface. Building against in-progress APIs creates rework.
- **Non-negotiable Phase 1-2 decisions (costly to retrofit):** JWT `kid` registry, AES-256-GCM with `key_version`, separate DB credentials per service.

### Research Flags

Phases needing `/gsd:research-phase` during planning:
- **Phase 2 (Auth + Gateway):** RS256 public key distribution to Hono services; Railway secret manager integration; refresh token rotation implementation; dual-auth window edge cases
- **Phase 5 (Channels):** opossum v9 per-user Redis-backed circuit breaker isolation pattern
- **Phase 6 (Scheduler + Broadcaster):** BullMQ worker pool tuning for mixed job types; SSE stream proxy via API gateway

Phases with standard patterns (skip research-phase):
- **Phase 1 (Monorepo):** pnpm workspaces, Docker Compose, GitHub Actions, Drizzle migrations — all well-documented
- **Phase 3 (User/Credentials):** AES-256-GCM with Node.js crypto — fully documented in STACK.md
- **Phase 7 (Frontend):** Mantine 9 RTL/dark mode — official docs complete

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified via npm registry (Hono 4.12.14, BullMQ 5.75.2, Mantine 9.0.2, Vitest 4.1.5, Drizzle 0.45.2). Key decision resolved: Hono over Fastify. Mantine 9 (not v7) confirmed. |
| Features | HIGH | Architecture patterns well-established. RBAC, Strangler Fig, circuit breaker, credential encryption — all from primary sources. Implementation specifics MEDIUM. |
| Architecture | HIGH | Strangler Fig extraction order derived from hard dependency graph. Schema-per-service from O'Reilly Monolith to Microservices. Dual-auth transition window from codebase analysis. |
| Pitfalls | HIGH (architecture), MEDIUM (BullMQ idempotency specifics), LOW (Mantine Hebrew edge cases) | BullMQ deduplication pattern from official docs. Mantine Hebrew rendering edge cases have limited public documentation. |

**Overall confidence:** HIGH

### Gaps to Address

- **Mantine Hebrew number field rendering:** `dir="ltr"` on number-only inputs within RTL context is the known fix, but Hebrew mixed-content rendering edge cases in Mantine 9 have limited community documentation. Validate with real Hebrew content early in Phase 7.
- **opossum v9 per-user Redis state:** The per-user circuit breaker isolation pattern (keyed by `userId+channelType` in Redis alongside BullMQ) is architecturally sound but opossum's Redis adapter support needs verification against v9 before Phase 5.
- **AliExpress MD5-signed API:** Sparse public documentation. Validate current API endpoint, auth flow, and response schema during Phase 4 planning.
- **Railway PostgreSQL multi-schema user grants:** Railway's support for multiple Postgres DB users with schema-level GRANT restrictions should be verified before Phase 1 DB schema design is finalized.

## Sources

### Primary (HIGH confidence)
- [Hono npm — v4.12.14](https://www.npmjs.com/package/hono)
- [Drizzle ORM releases — v0.45.2 stable vs v1.0.0-beta.22](https://github.com/drizzle-team/drizzle-orm/releases)
- [BullMQ npm — v5.75.2](https://www.npmjs.com/package/bullmq)
- [BullMQ Idempotent Jobs docs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [Mantine all releases — v9.0.2 current](https://mantine.dev/changelog/all-releases/)
- [Mantine RTL docs](https://mantine.dev/styles/rtl/)
- [Vitest npm — v4.1.5](https://www.npmjs.com/package/vitest)
- [AWS Prescriptive Guidance: Strangler Fig Pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html)
- [Schema per Service — O'Reilly Monolith to Microservices](https://www.oreilly.com/library/view/monolith-to-microservices/9781492047834/ch04.html)
- Monolith codebase analysis: `server.js`, `services/workflow.js`, `scheduler/index.js`, `.planning/codebase/`

### Secondary (MEDIUM confidence)
- [BullMQ in a Monorepo — OneUptime](https://oneuptime.com/blog/post/2026-01-21-bullmq-monorepo-setup/view)
- [WorkOS: Multi-tenant RBAC design](https://workos.com/blog/how-to-design-multi-tenant-rbac-saas)
- [JWT auth in Node.js microservices 2026 — WorkOS](https://workos.com/blog/nodejs-authentication-guide-2026)
- [Drizzle ORM — Zero-Downtime Migrations](https://dev.to/whoffagents/zero-downtime-postgres-migrations-with-drizzle-orm-22ga)
- [JWTs in Microservices: Key Rotation — Pallavi](https://techblogsbypallavi.medium.com/jwts-in-microservices-how-to-rotate-keys-and-invalidate-sessions-cleanly-db30c1110fd7)
- [Opossum circuit breaker for Node.js v9](https://github.com/nodeshift/opossum)
- [microservices.io: Strangler Application Pattern](https://microservices.io/patterns/refactoring/strangler-application.html)

### Tertiary (LOW confidence)
- Mantine Hebrew rendering edge cases — limited public documentation; validate during implementation
- opossum v9 Redis adapter support — needs verification against current v9 API before Phase 5

---
*Research completed: 2026-04-29*
*Ready for roadmap: yes*
