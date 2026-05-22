---
phase: 05-api-gateway-feature-flag-system
plan: "02"
subsystem: api
tags: [hono, drizzle-orm, redis, ioredis, feature-flags, rate-limiting, gateway]

# Dependency graph
requires:
  - phase: 05-api-gateway-feature-flag-system
    plan: "01"
    provides: featureFlags Drizzle schema + gateway runtime deps installed
provides:
  - 5s TTL in-process flag cache (getCached/setCached/evict/clearCache)
  - getFlag/setFlag/listFlags service with DB + cache + fail-open
  - Redis-backed rate limiter middleware (120 req/min, fail-open)
  - Admin Hono router with GET /flags and PATCH /flags/:name
affects:
  - 05-03 (proxy layer depends on getFlag for routing decisions)
  - 05-04 (integration tests depend on admin routes)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - All drizzle ORM query logic lives in packages/db — no drizzle-orm imports in apps/gateway
    - Fail-open pattern for both DB (getFlag) and Redis (rate limiter)
    - Cache-aside with TTL + explicit eviction on write (FLAG-02 one-request-cycle guarantee)

key-files:
  created:
    - apps/gateway/src/config.ts
    - apps/gateway/src/flags/cache.ts
    - apps/gateway/src/flags/service.ts
    - apps/gateway/src/middleware/rateLimit.ts
    - apps/gateway/src/routes/admin.ts
    - packages/db/src/gateway-db.ts
  modified:
    - packages/db/src/index.ts
    - apps/gateway/package.json

key-decisions:
  - "All drizzle ORM query code lives in packages/db (dbGetFlag/dbListFlags/dbSetFlag) to prevent TypeScript dual-instance error with NodeNext composite project references"
  - "@hono-rate-limiter/redis v0.1.4 uses client interface (scriptLoad/evalsha/decr/del) not sendCommand — ioredis adapter wraps these with catch for fail-open"
  - "pg aligned to ^8.20.0 across all packages to prevent drizzle-orm type resolution conflicts"

patterns-established:
  - "Gateway DB helper pattern: packages/db exports db*() functions; services import from @affiliate/db only"
  - "Fail-open: DB errors in getFlag return false (monolith fallback); Redis errors in rate limiter allow through"
  - "Cache eviction on write: setFlag always calls evict(name) immediately after DB update"

requirements-completed: [FLAG-01, FLAG-02, GW-03]

# Metrics
duration: 15min
completed: 2026-05-22
---

# Phase 05 Plan 02: Flag Cache, Service, Rate Limiter, and Admin Routes Summary

**5s TTL in-process flag cache + fail-open DB service + Redis rate limiter (120 req/min) + admin flag toggle API**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-22T15:07:00Z
- **Completed:** 2026-05-22T15:22:06Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Flag cache with getCached/setCached/evict/clearCache (5s TTL, Map-based)
- Flag service with getFlag (cache-aside + fail-open), listFlags, setFlag (evicts cache immediately)
- Redis-backed rate limiter at 120 req/min per IP with ioredis fail-open adapter
- Admin Hono router: GET /flags returns all flags; PATCH /flags/:name returns updated record (400/404/500)

## Task Commits

1. **Task 1: Config, flag cache, and flag service** - `e17cf05` (feat)
2. **Task 2: Rate limiter middleware and admin routes** - `579c4cf` (feat)

## Files Created/Modified

- `apps/gateway/src/config.ts` - All gateway env-var config (port, URLs, service upstreams)
- `apps/gateway/src/flags/cache.ts` - 5s TTL in-process Map cache with evict/clearCache
- `apps/gateway/src/flags/service.ts` - getFlag/listFlags/setFlag using @affiliate/db helpers
- `apps/gateway/src/middleware/rateLimit.ts` - Redis rate limiter with ioredis adapter, fail-open
- `apps/gateway/src/routes/admin.ts` - Hono router for flag list and toggle endpoints
- `packages/db/src/gateway-db.ts` - dbGetFlag/dbListFlags/dbSetFlag with lazy pool, drizzle queries
- `packages/db/src/index.ts` - Added exports for gateway DB helpers
- `apps/gateway/package.json` - Aligned pg to ^8.20.0, removed direct drizzle-orm/pg deps

## Decisions Made

- All drizzle ORM queries centralized in `packages/db/src/gateway-db.ts` to avoid TypeScript dual-instance type error that occurs when both `packages/db` (composite reference) and `apps/gateway` import `drizzle-orm` under NodeNext module resolution.
- `@hono-rate-limiter/redis` v0.1.4 API uses `client` property with `scriptLoad/evalsha/decr/del` — not the `sendCommand` approach specified in the plan (which was written for v0.5.0). Ioredis adapter wraps each method with `.catch(() => 0/null)` for fail-open behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Moved all drizzle ORM code to packages/db to fix TypeScript dual-instance error**
- **Found during:** Task 1 (flag service typecheck)
- **Issue:** TypeScript composite project references + NodeNext resolution caused `drizzle-orm` types to load twice with different resolution modes, making `eq(featureFlags.name, name)` fail type checking
- **Fix:** Created `packages/db/src/gateway-db.ts` with `dbGetFlag/dbListFlags/dbSetFlag`; gateway service.ts imports only from `@affiliate/db`; removed direct `drizzle-orm` and `pg` deps from gateway
- **Files modified:** packages/db/src/gateway-db.ts (new), packages/db/src/index.ts, apps/gateway/src/flags/service.ts, apps/gateway/package.json
- **Verification:** `pnpm -r run typecheck` passes with zero errors
- **Committed in:** e17cf05 (Task 1 commit)

**2. [Rule 1 - Bug] Updated rate limiter to use @hono-rate-limiter/redis v0.1.4 client API**
- **Found during:** Task 2 (rateLimit.ts typecheck)
- **Issue:** Plan spec used `sendCommand` from v0.5.0 API; installed version is v0.1.4 which uses `client: { scriptLoad, evalsha, decr, del }`
- **Fix:** Wrote ioredis adapter object matching the v0.1.4 `RedisClient` interface; each method catches errors for fail-open
- **Files modified:** apps/gateway/src/middleware/rateLimit.ts
- **Verification:** `pnpm -r run typecheck` passes
- **Committed in:** 579c4cf (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs — TypeScript resolution + version API mismatch)
**Impact on plan:** Both fixes necessary for typecheck to pass. Architecture intent preserved: fail-open, cache eviction, DB abstraction all intact.

## Issues Encountered

- TypeScript composite project references with NodeNext module resolution cause the same npm package to be loaded twice when both a workspace library and its consumer import from it. Solution: centralize all ORM code in the library package.

## Next Phase Readiness

- Flag cache, service, and admin routes are complete — Plan 03 (proxy layer) can call `getFlag()` to make routing decisions
- Rate limiter middleware is ready to mount on all `/api/v1/*` routes
- `GATEWAY_DATABASE_URL` env var must be set at runtime

---
*Phase: 05-api-gateway-feature-flag-system*
*Completed: 2026-05-22*
