# Phase 5: API Gateway + Feature Flag System - Context

**Gathered:** 2026-05-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the gateway layer (`apps/gateway`) that proxies all `/api/v1/*` traffic to the monolith today, and can switch individual routes to new microservices via DB-stored feature flags — without service restart. This phase also delivers JWT validation infrastructure (wired but not enforced until Phase 6) and the admin API for toggling flags.

</domain>

<decisions>
## Implementation Decisions

### JWT Auth — Migration Window Strategy

- **Phase 5 behavior:** Gateway passes ALL requests through to the monolith uninspected. No JWT validation performed. Zero disruption to existing session-cookie users.
- **jwt-enforcement flag:** A feature flag named `jwt-enforcement` is created in the DB and starts OFF. The gateway checks this flag before doing any auth enforcement.
- **Tokens present but not validated:** Even if a request arrives with a JWT Bearer token, the gateway ignores it and forwards the request. No rejection until enforcement is ON.
- **Enforcement cutover (post-Phase 6):** When `jwt-enforcement` is toggled ON, the gateway validates JWT Bearer tokens. Requests with no token or an invalid token receive `401 Unauthorized`. Session-cookie-only users must re-authenticate.

### JWT Validation (for when enforcement turns ON)

- **Public key source:** Gateway fetches the Auth Service's JWKS endpoint (`/.well-known/jwks.json`) on startup, caches keys with TTL-based refresh. Works with the `kid` registry Phase 6 will build. No manual key distribution needed.
- **Invalid token behavior:** Reject with 401 immediately — no fallback to session cookies. The dual-auth window for session-cookie users is handled inside the monolith (Phase 6 scope), not at the gateway.

### Feature Flag Granularity

- **Per-service flags** (not per-route). One named flag per microservice: `auth-service`, `user-service`, `subjects-service`, `products-service`, `ai-writer-service`, `channels-service`, `scheduler-service`, `broadcaster-service`.
- **Pre-seeded:** All Phase 6–10 service flags are inserted into the DB during Phase 5 migration (all OFF). Each phase doesn't need to create its own flag.
- **Routing behavior:** Flag OFF → proxy to monolith. Flag ON → proxy to the microservice's URL.

### Rate Limiting

- **Redis-backed** (Redis is already in Docker Compose from Phase 4).
- **Fail-open:** If Redis is unavailable, rate limiting is skipped and requests pass through. Availability over strictness.
- **Claude's discretion:** Default threshold values, per-user vs per-IP strategy, window duration.

### Admin Flag Toggle API

- Simple REST surface sufficient for Phase 5:
  - `GET /api/v1/admin/flags` — list all flags with current state
  - `PATCH /api/v1/admin/flags/:name` — toggle or set a flag value
- Super-admin only (checked against JWT claims once enforcement is on; bypassed during migration window).
- Phase 11 builds the UI on top of this API.

### Claude's Discretion

- Exact rate limit thresholds and window duration
- HTTP proxy library choice for request forwarding
- JWKS cache TTL values
- Health check endpoint design (`/health`)
- Exact DB schema column names for the flags table

</decisions>

<specifics>
## Specific Ideas

- The `jwt-enforcement` flag and per-service routing flags are independent — admin can enforce JWT auth while all service routing still points to the monolith.
- The full auth lifecycle: Phase 5 passes through → Phase 6 ships Auth Service + dual-auth in monolith → admin flips `jwt-enforcement` ON → gateway validates JWTs → session-only users re-authenticate.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-api-gateway-feature-flag-system*
*Context gathered: 2026-05-20*
