---
phase: 05-api-gateway-feature-flag-system
plan: "03"
subsystem: api
tags: [hono, proxy, feature-flags, vitest, docker-compose, gateway]

# Dependency graph
requires:
  - phase: 05-api-gateway-feature-flag-system
    plan: "02"
    provides: getFlag service, rate limiter middleware, admin routes
provides:
  - resolveUpstream() routes /api/v1/* to monolith or microservice per flag state
  - proxyToUpstream() forwards all headers verbatim (Cookie + Authorization preserved)
  - applyJwtMiddleware() no-op guard when AUTH_SERVICE_JWKS_URI unset (Phase 5 safe)
  - Hono app: rate limit → optional JWT → admin routes → proxy
  - serve() entrypoint on configured port
  - Docker gateway service on port 8080 with depends_on monolith + redis + postgres
  - 6 Vitest unit tests for path rewrite and flag-based routing
affects:
  - 05-04 (integration tests depend on full app.ts + proxy layer)
  - Production traffic (gateway is now a deployable Docker service)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - flagOverrides pattern for unit testing resolveUpstream without DB/Redis
    - Conditional middleware registration using early-return guard (applyJwtMiddleware)
    - Path rewrite regex /^\/api\/v1/ → /api/ applied only on monolith fallback

key-files:
  created:
    - apps/gateway/src/proxy/upstream.ts
    - apps/gateway/src/middleware/jwtEnforce.ts
    - apps/gateway/src/app.ts
    - apps/gateway/src/tests/gateway.test.ts
    - apps/gateway/Dockerfile
  modified:
    - apps/gateway/src/index.ts
    - docker-compose.yml
    - apps/gateway/package.json

key-decisions:
  - "applyJwtMiddleware() uses early-return guard when jwksUri is empty; no hono/jwt import in Phase 5 — avoids loading jose for a non-existent auth service"
  - "vitest downgraded from ^4.1.5 to ^2.1.9 — v4 requires Node 22; current dev env is Node 20.10"
  - "resolveUpstream accepts optional flagOverrides for unit testing — avoids any DB/Redis dependency in tests"

requirements-completed: [GW-01, GW-02, GW-04, FLAG-02, FLAG-03]

# Metrics
duration: 8min
completed: 2026-05-22
---

# Phase 05 Plan 03: Proxy Router, JWT Middleware, App Entrypoint, and Tests Summary

**Flag-driven proxy router + conditional JWT guard + Hono app wired end-to-end + 6 passing Vitest unit tests**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-22T15:24:07Z
- **Completed:** 2026-05-22T15:32:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- `resolveUpstream()` routes /api/v1/* to monolith (flag OFF) or microservice (flag ON); falls back to monolith when service URL is empty
- Path rewrite `/api/v1/` → `/api/` applied before forwarding to monolith
- `proxyToUpstream()` uses `hono/proxy` and forwards Cookie and Authorization headers verbatim
- `applyJwtMiddleware()` is a complete no-op in Phase 5 (guard at function entry when jwksUri is empty)
- `app.ts` wires: rate limit → JWT (no-op) → admin routes → health → proxy
- `index.ts` serves on configured port with startup log messages
- `apps/gateway/Dockerfile` multi-stage pnpm monorepo build
- `docker-compose.yml` gateway service on port 8080 with condition-based depends_on
- 6 Vitest unit tests all passing: path rewrite, flag-on routing, empty URL fallback, unmatched prefix, nested paths

## Task Commits

1. **Task 1: Proxy router, JWT middleware, app entrypoint, gateway Docker service** - `dcd83da` (feat)
2. **Task 2: Vitest unit tests** - `2c0485b` (test)

## Files Created/Modified

- `apps/gateway/src/proxy/upstream.ts` - resolveUpstream + proxyToUpstream
- `apps/gateway/src/middleware/jwtEnforce.ts` - applyJwtMiddleware with no-op guard
- `apps/gateway/src/app.ts` - Hono app composition
- `apps/gateway/src/index.ts` - serve() entrypoint
- `apps/gateway/src/tests/gateway.test.ts` - 6 Vitest unit tests
- `apps/gateway/Dockerfile` - multi-stage pnpm build
- `docker-compose.yml` - gateway service added
- `apps/gateway/package.json` - vitest downgraded to ^2.1.9

## Decisions Made

- `applyJwtMiddleware()` uses an early-return when `config.jwksUri` is empty. The plan spec referenced `hono/jwt`'s `jwk()` export which does not exist in Hono 4.12.14 — the enforcement gate is implemented as a standalone middleware that reads `jwtPayload` (set by a Phase 6 upstream JWT middleware).
- Vitest downgraded from ^4.1.5 to ^2.1.9 because v4 requires Node 22 and the current development environment runs Node 20.10.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed non-existent jwk() import from hono/jwt**
- **Found during:** Task 1 (typecheck)
- **Issue:** Plan spec called `import { jwk } from 'hono/jwt'` but Hono 4.12.14 exports only `jwt()` (symmetric) — no `jwk()` JWK-set middleware exists
- **Fix:** Removed the dynamic import block; kept the enforcement gate middleware (reads `jwtPayload`) inside the `if (config.jwksUri)` guard. Phase 5 behavior is identical — the guard short-circuits before any middleware is registered.
- **Files modified:** apps/gateway/src/middleware/jwtEnforce.ts
- **Commit:** dcd83da

**2. [Rule 3 - Blocking] Downgraded vitest 4.1.5 → 2.1.9 for Node 20 compatibility**
- **Found during:** Task 2 (test run)
- **Issue:** `vitest@4.1.5` depends on `rolldown` which imports `styleText` from `node:util` — only available in Node 22+; dev env is Node 20.10
- **Fix:** Changed package.json devDependency to `^2.1.9`; ran `pnpm install`; all 6 tests pass
- **Files modified:** apps/gateway/package.json, pnpm-lock.yaml
- **Commit:** 2c0485b

---

**Total deviations:** 2 auto-fixed (Rule 1 API mismatch + Rule 3 Node version incompatibility)
**Impact on plan:** Architecture intent fully preserved. Gateway behavior in Phase 5 is identical — JWT enforcement is a no-op, proxy routing works correctly.

## Next Phase Readiness

- Gateway app is fully wired and testable — Plan 04 (integration tests) can import `app` from `app.ts`
- `resolveUpstream()` is unit-tested and ready for flag-driven routing decisions
- Docker service definition ready for `docker compose up`
