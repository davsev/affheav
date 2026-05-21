---
phase: 05-api-gateway-feature-flag-system
plan: "03"
subsystem: api
tags: [hono, proxy, feature-flags, jwt, docker, vitest, gateway]

# Dependency graph
requires:
  - phase: 05-02
    provides: getFlag/setFlag/listFlags, rateLimitMiddleware, admin routes, config
provides:
  - proxy/upstream.ts: resolveUpstream() with flag-based routing and path rewrite
  - middleware/jwtEnforce.ts: conditional JWT middleware (no-op when JWKS URI unset)
  - app.ts: Hono app wiring all middleware and routes
  - index.ts: serve() entrypoint
  - Dockerfile: multi-stage pnpm build for gateway container
  - docker-compose.yml: gateway service on port 8080
  - 6 Vitest unit tests passing
affects: [06-auth-service]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Flag-based upstream routing: resolveUpstream() checks flag → microservice URL if ON + configured, else monolith with /api/v1/ → /api/ rewrite"
    - "Conditional JWT middleware: applyJwtMiddleware() is a no-op when config.jwksUri is empty — zero startup cost"
    - "Vitest flagOverrides param: resolveUpstream accepts optional flagOverrides to bypass DB in tests"

key-files:
  created:
    - apps/gateway/src/proxy/upstream.ts
    - apps/gateway/src/middleware/jwtEnforce.ts
    - apps/gateway/src/app.ts
    - apps/gateway/src/tests/gateway.test.ts
    - apps/gateway/Dockerfile
  modified:
    - apps/gateway/src/index.ts
    - apps/gateway/src/flags/service.ts
    - docker-compose.yml
    - apps/gateway/package.json

key-decisions:
  - "drizzle-orm + NodeNext resolution mode type conflict resolved by casting drizzle() return to any in service.ts — runtime is correct, only TS type checker confused by dual module instances"
  - "Vitest downgraded from 4.1.5 to 2.1.x — v4 requires Node 20.12+ for node:util styleText; dev environment runs Node 20.10"
  - "jwtEnforce.ts uses dynamic import + any cast for hono/jwt to avoid type errors for Phase 6 code path that is never executed in Phase 5"

# Metrics
duration: 12min
completed: 2026-05-21
---

# Phase 5 Plan 03: Proxy Router, JWT Middleware, App Entrypoint, and Tests Summary

**Hono proxy gateway wired with flag-based upstream routing, conditional JWT middleware, Docker service, and 6 passing Vitest unit tests**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-21T18:00:00Z
- **Completed:** 2026-05-21T18:12:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- `proxy/upstream.ts`: `resolveUpstream()` routes per feature flag — flag ON + service URL configured → microservice; otherwise → monolith with `/api/v1/` → `/api/` path rewrite
- `middleware/jwtEnforce.ts`: `applyJwtMiddleware()` is a pure no-op in Phase 5 (JWKS URI unset) — no network calls, no startup cost
- `app.ts`: Hono app wired: rate limit → JWT → admin routes → `/health` → proxy
- `index.ts`: `serve()` entrypoint with startup log messages
- `Dockerfile`: multi-stage pnpm workspace build for gateway container
- `docker-compose.yml`: gateway service on port 8080, depends on postgres (healthy), redis (healthy), monolith (started)
- 6 Vitest unit tests all passing: path rewrite, flag-on routing, empty URL fallback, unmatched prefix, nested paths

## Task Commits

1. **Task 1: Proxy router, JWT middleware, app entrypoint, Docker** — `663db0a`
2. **Task 2: Vitest unit tests** — `b4cbb2e`

## Files Created/Modified
- `apps/gateway/src/proxy/upstream.ts` — resolveUpstream() + proxyToUpstream() with verbatim Cookie/Authorization forwarding
- `apps/gateway/src/middleware/jwtEnforce.ts` — conditional JWT middleware (Phase 5 no-op)
- `apps/gateway/src/app.ts` — Hono app composition
- `apps/gateway/src/index.ts` — serve() entrypoint (replaced scaffold stub)
- `apps/gateway/src/tests/gateway.test.ts` — 6 unit tests for resolveUpstream
- `apps/gateway/src/flags/service.ts` — fixed drizzle-orm NodeNext type conflict (cast to any)
- `apps/gateway/Dockerfile` — multi-stage pnpm build
- `docker-compose.yml` — gateway service added
- `apps/gateway/package.json` — vitest downgraded to 2.1.x

## Decisions Made
- drizzle-orm + NodeNext module resolution causes type incompatibility between `@affiliate/db` compiled dist and direct `drizzle-orm` imports. Cast `drizzle()` return to `any` in service.ts. Runtime is fully correct.
- Vitest 4.1.5 requires Node 20.12+ (`node:util` `styleText`). Dev environment is Node 20.10 — downgraded to vitest@2.1.x.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] drizzle-orm NodeNext dual resolution type conflict in service.ts**
- **Found during:** Task 1 (typecheck verification)
- **Issue:** TypeScript errors in pre-existing `service.ts` — drizzle-orm resolves to separate module instances when imported via `@affiliate/db` compiled dist vs direct `drizzle-orm` import in NodeNext mode
- **Fix:** Cast `drizzle(pool)` return to `any`; add explicit type annotations on query results
- **Files modified:** apps/gateway/src/flags/service.ts
- **Commit:** 663db0a

**2. [Rule 3 - Blocking] Vitest 4.1.5 incompatible with Node 20.10**
- **Found during:** Task 2 (running tests)
- **Issue:** `node:util` `styleText` (used by rolldown bundled into vitest 4.x) requires Node 20.12+; dev runs 20.10
- **Fix:** Downgraded vitest to `^2.1.0` in gateway package.json
- **Files modified:** apps/gateway/package.json, pnpm-lock.yaml
- **Commit:** b4cbb2e

**3. [Rule 1 - Bug] `jwk` not exported from hono/jwt in Hono 4.12.14**
- **Found during:** Task 1 (typecheck verification)
- **Issue:** Plan specified `{ jwk }` destructure from `hono/jwt` but Hono 4.12.14 only exports `jwt`, `verifyWithJwks`, `verify`, `decode`, `sign`
- **Fix:** Used dynamic import with `any` cast + runtime guard `honoJwt.jwk ?? honoJwt.verifyWithJwks`; Phase 5 behavior unchanged since the entire block is skipped when JWKS URI is unset
- **Files modified:** apps/gateway/src/middleware/jwtEnforce.ts
- **Commit:** 663db0a

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All fixes required for correctness. No scope creep.

## Phase 5 Complete

All three Phase 5 plans are now complete:
- Plan 01: featureFlags schema, SQL migrations, gateway workspace scaffolding
- Plan 02: flag cache (5s TTL), flag service (fail-open), rate limiter, admin API
- Plan 03: proxy router, JWT middleware, Hono app, Docker service, 6 tests

The gateway is ready as a Docker service. With all flags OFF, it proxies all `/api/v1/*` traffic to the monolith at `/api/*`. Toggling individual flags will route traffic to microservices as they are built in Phases 6–10.

---
*Phase: 05-api-gateway-feature-flag-system*
*Completed: 2026-05-21*
