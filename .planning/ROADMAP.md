# Roadmap: Affiliate Heaven — v2.0 Microservices Rebuild

## Overview

Nine phases decompose the Node.js/Express monolith into independently deployable microservices using the Strangler Fig pattern. The monolith stays live throughout. Each extracted service is gated behind a feature flag — when the flag is off, the API Gateway routes to the monolith fallback; when on, it routes to the new microservice. Phase 4 builds the scaffold that makes all other phases possible. Phase 5 puts the gateway and feature flag system in place. Phases 6–10 extract services wave-by-wave. Phase 11 rebuilds the frontend against the stable API surface. Phase 12 locks in E2E and visual regression coverage.

## Phases

**Phase Numbering:**
- Phases 1–3 are the completed v1.0 Broadcast Messages milestone
- v2.0 phases begin at 4 and extend through 12
- Decimal phases (e.g. 4.1): urgent insertions created via `/gsd:insert-phase`

- [ ] **Phase 4: Monorepo Scaffold + Infrastructure** - pnpm workspaces, Docker Compose, CI pipeline, Drizzle schema, per-service DB credentials
- [ ] **Phase 5: API Gateway + Feature Flag System** - JWT-validated gateway routing 100% to monolith, feature flag DB + admin toggle
- [ ] **Phase 6: Auth Service** - Google OAuth → RS256 JWT with `kid` registry, dual-auth window in monolith, invite flow
- [ ] **Phase 7: User Service + Permissions + Credential Storage** - user CRUD, RBAC roles, AES-256-GCM encrypted credentials with `key_version`
- [ ] **Phase 8: Subjects + Products Services** - niche CRUD, product CRUD, AliExpress import, both gated behind feature flags
- [ ] **Phase 9: AI Writer + Channels Services** - Hebrew message generation, Shabbat logic, WhatsApp/Facebook/Instagram adapters, circuit breakers
- [ ] **Phase 10: Scheduler + Broadcaster Services** - BullMQ cron pipeline, idempotency guard, dead letter queue, SSE log emit
- [ ] **Phase 11: Frontend Rebuild + i18n** - React 19 + Mantine 9, Hebrew RTL dark theme, all dashboard sections, i18n JSON
- [ ] **Phase 12: E2E & Visual Regression Testing** - Playwright flows, visual snapshots, flag-on/flag-off scenarios, merge gate

## Phase Details

### Phase 4: Monorepo Scaffold + Infrastructure
**Goal**: Every service can be built, type-checked, tested, and run locally from a single pnpm monorepo with Docker Compose — no service ships without this foundation
**Depends on**: Nothing (first v2.0 phase; prior work was v1.0 milestone)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, CI-01, CI-02, CI-03, TEST-05
**Success Criteria** (what must be TRUE):
  1. `docker compose up` starts all service containers, PostgreSQL (with per-service schemas and separate DB users), and Redis; a cross-boundary write from one service's DB user to another service's schema fails with `permission denied`
  2. `pnpm -r tsc --noEmit` passes cleanly across all packages; `packages/db` exports Drizzle schema types importable in any service via `workspace:*`
  3. GitHub Actions CI runs `tsc --noEmit`, Vitest, and ESLint on every PR; a PR with a non-Conventional Commits title fails CI
  4. A new service added to the monorepo can import from `packages/types` and `packages/config` without path resolution errors in both `ts-node` and the Docker build context
  5. `RUN_MIGRATIONS=true` gate is enforced — Drizzle migrations do not auto-run on service startup; a migration can be reviewed and applied manually in under 5 minutes
**Plans**: TBD

### Phase 5: API Gateway + Feature Flag System
**Goal**: All API traffic flows through the gateway; feature flags stored in DB allow the gateway to switch any route from monolith to microservice without redeployment
**Depends on**: Phase 4
**Requirements**: GW-01, GW-02, GW-03, GW-04, FLAG-01, FLAG-02, FLAG-03, FLAG-04
**Success Criteria** (what must be TRUE):
  1. All `/api/v1/*` requests pass through the gateway; with no flags enabled, 100% of traffic is proxied to the monolith and all existing functionality works unchanged
  2. A request with no or invalid JWT Bearer token receives `401 Unauthorized` from the gateway before the request reaches any upstream service
  3. Rate limiting rejects a single user exceeding the configured request threshold within a time window with `429 Too Many Requests`
  4. Super admin can toggle a feature flag via API (and later the UI screen in Phase 11) with immediate effect — no service restart; toggling `auth-service` flag routes `/api/v1/auth/*` to the new auth service within one request cycle
  5. Each microservice extraction (Phases 6–10) has a corresponding named flag in the flags table before that phase begins
**Plans**: 3 plans
Plans:
- [ ] 05-01-PLAN.md — Feature flags Drizzle schema, SQL migrations (9 flags pre-seeded), gateway package dependencies
- [ ] 05-02-PLAN.md — Flag cache/service (5s TTL + cache eviction), admin flags API, rate limiter middleware
- [ ] 05-03-PLAN.md — Proxy/router (path rewrite + Strangler Fig switch), JWT middleware scaffold, app wiring, Docker service, Vitest tests

### Phase 6: Auth Service
**Goal**: Users authenticate via the new auth service and receive RS256 JWTs; the monolith accepts both session cookies and JWT Bearer tokens so no active user is logged out during migration
**Depends on**: Phase 5
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05
**Success Criteria** (what must be TRUE):
  1. User can log in via Google OAuth through the auth service and receive a short-lived access token (RS256, `kid`-signed) and a 30-day refresh token; the JWT payload contains `sub`, `role`, and `kid` claims
  2. JWT key rotation (new signing key with new `kid`) does not log out any active user — tokens signed with the old `kid` continue to validate against the key registry during the overlap window
  3. The monolith's `isAuthenticated` middleware accepts a valid JWT Bearer token with the same access as a session cookie — an authenticated API call succeeds with either credential for at least 30 days after Phase 6 ships
  4. Admin can generate an invite link; an invited user follows the link, authenticates via Google OAuth, and receives an account with the `user` role
**Plans**: TBD

### Phase 7: User Service + Permissions + Credential Storage
**Goal**: User accounts, roles, and per-user platform credentials are managed by the user service; credentials are encrypted at rest and never returned to the client in plaintext
**Depends on**: Phase 6
**Requirements**: USER-01, USER-02, USER-03, USER-04, USER-05, PERM-01, PERM-02, PERM-03, PERM-04, PERM-05, DB-01, DB-02, DB-03, DB-04
**Success Criteria** (what must be TRUE):
  1. User can connect a platform credential (Facebook token, AliExpress key, WhatsApp webhook URL, Instagram token); the credential API returns only a boolean `connected: true/false` — the raw token is never present in any API response
  2. A credential stored and then retrieved decrypts correctly; rotating `ENCRYPTION_KEY` (bumping `key_version`) does not permanently destroy access to credentials encrypted under the prior version
  3. Super admin can create a named custom role with per-resource read/write/delete permissions, assign it to a user, and the affected user's next request is governed by the new permissions without a re-login
  4. A request that would be rejected by the assigned role returns `403 Forbidden` from the service layer — not from client-side role claims
  5. All tables in the redesigned Drizzle schema have `id UUID`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`, and explicit FK constraints; Google Sheets is no longer queried as a data source
**Plans**: TBD

### Phase 8: Subjects + Products Services
**Goal**: Users can manage niches and products through their own extracted services; each is gated behind a feature flag and falls back to the monolith when disabled
**Depends on**: Phase 7
**Requirements**: SUBJ-01, SUBJ-02, PROD-01, PROD-02, PROD-03
**Success Criteria** (what must be TRUE):
  1. User can create, read, update, and delete a subject (niche); each subject links to the user's stored platform credentials (Facebook page ID, Instagram account, WhatsApp webhook URL) retrieved from user-service — no credentials duplicated in the subjects schema
  2. User can create, read, update, and delete products scoped to a subject; each product tracks `sent_at` timestamp and `is_sent` flag
  3. User can trigger an AliExpress affiliate API import using their stored AliExpress credentials; imported products appear in the products list with affiliate URLs populated
  4. Toggling the `subjects-service` feature flag off routes subjects traffic back to the monolith with no data loss; toggling the `products-service` flag off has the same behavior independently
**Plans**: TBD

### Phase 9: AI Writer + Channels Services
**Goal**: AI-generated Hebrew messages are produced by the AI writer service; WhatsApp, Facebook, and Instagram sends are handled by the channels service with circuit breakers preventing cross-platform failure propagation
**Depends on**: Phase 8
**Requirements**: AI-01, AI-02, AI-03, CHAN-01, CHAN-02, CHAN-03, CHAN-04, CHAN-05
**Success Criteria** (what must be TRUE):
  1. AI writer service produces a Hebrew marketing message for a given product using the user's stored OpenAI API key; a Friday evening or Saturday request includes the appropriate Shabbat/Motzei Shabbat greeting based on `Asia/Jerusalem` time
  2. When a subject has a prompt override configured, the AI writer uses the override — not the default system prompt
  3. A Facebook send succeeds via Graph API using the user's stored (decrypted) Facebook credentials; an Instagram publish completes the two-phase container-then-publish flow without blocking any BullMQ worker slot
  4. Failure on one channel (e.g. Facebook circuit breaker open) does not block or skip delivery to the remaining channels (WhatsApp, Instagram) in the same broadcast job
  5. A channel adapter that fails 3 times with exponential backoff moves the job to the dead letter queue; the other channels in that job are not retried unnecessarily
**Plans**: TBD

### Phase 10: Scheduler + Broadcaster Services
**Goal**: Cron schedules trigger BullMQ jobs that the broadcaster consumes to run the full pipeline — with idempotency guards preventing duplicate sends even on retry
**Depends on**: Phase 9
**Requirements**: SCHED-01, SCHED-02, SCHED-03, BROAD-01, BROAD-02, BROAD-03, BROAD-04
**Success Criteria** (what must be TRUE):
  1. On startup, all enabled schedules are registered as cron jobs; adding, updating, or deleting a schedule hot-reloads the cron registration without a service restart
  2. When a cron job fires, it pushes a BullMQ job with ID `broadcast:{productId}:{subjectId}`; submitting the same job ID a second time within the dedup window does not create a duplicate job
  3. The broadcaster checks the DB `is_sent` flag before each platform API call — if already sent, the call is skipped without error (idempotency guard holds on retry)
  4. Each broadcast result is written to the logs table with per-channel `success` / `fail` status and error message if applicable
  5. Exhausted jobs (retries exceeded) appear in the dead letter queue and are retrievable by the admin for inspection; they do not silently disappear
**Plans**: TBD

### Phase 11: Frontend Rebuild + i18n
**Goal**: The React + Mantine frontend replaces the vanilla JS SPA — all dashboard sections are rebuilt with Hebrew RTL dark theme and full i18n support; the frontend authenticates via JWT, not session cookie
**Depends on**: Phase 10
**Requirements**: FE-01, FE-02, FE-03, FE-04, FE-05, I18N-01, I18N-02, I18N-03, I18N-04
**Success Criteria** (what must be TRUE):
  1. The app loads in Hebrew RTL dark mode with no layout flash — `ColorSchemeScript` in `<head>` prevents dark mode flash; `DirectionProvider initialDirection="rtl"` and `dir="rtl"` on `<html>` are in place; number-only inputs render `dir="ltr"` within the RTL context
  2. All existing dashboard sections are functional: products, schedules, broadcasts, scraper, logs, settings/credentials, admin user management — no section present in v1.0 is absent from v2.0
  3. Auth flow uses JWT Bearer token stored client-side; a page reload does not log the user out; an expired access token is refreshed transparently using the refresh token
  4. Credential connection screens exist for Facebook, Instagram, AliExpress, and WhatsApp — connecting a credential shows `connected: true`; disconnecting shows `connected: false`
  5. Super admin can view the Feature Flags screen, toggle any flag on or off, and observe immediate routing behavior change without page reload or server restart
  6. User can switch display language between Hebrew and English from profile settings; all UI strings come from `locales/he.json` or `locales/en.json` — no hardcoded text in components
**Plans**: TBD

### Phase 12: E2E & Visual Regression Testing
**Goal**: Critical user flows are covered by Playwright E2E tests; visual snapshots baseline the stable UI and block regressions on merge to `main`
**Depends on**: Phase 11
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, CI-04
**Success Criteria** (what must be TRUE):
  1. Playwright E2E suite covers: login via Google OAuth, send a product broadcast, create and enable a schedule, toggle a feature flag — all flows pass in CI
  2. Visual snapshots are captured for each major screen after Phase 11 frontend is stable; baseline images are committed and reviewed once by the developer
  3. A PR that introduces a visual change causes the Playwright snapshot comparison to fail CI — the developer must explicitly run `playwright test --update-snapshots` and commit the new baseline to unblock the merge
  4. Feature flag tests run each critical flow in both states: flag on (new microservice path) and flag off (monolith fallback path) — both must pass
  5. `CI-04` Playwright suite runs automatically on merge to `main` via GitHub Actions; a failure blocks the merge

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 4. Monorepo Scaffold + Infrastructure | 0/? | Not started | - |
| 5. API Gateway + Feature Flag System | 2/3 | In Progress|  |
| 6. Auth Service | 0/? | Not started | - |
| 7. User Service + Permissions + Credential Storage | 0/? | Not started | - |
| 8. Subjects + Products Services | 0/? | Not started | - |
| 9. AI Writer + Channels Services | 0/? | Not started | - |
| 10. Scheduler + Broadcaster Services | 0/? | Not started | - |
| 11. Frontend Rebuild + i18n | 0/? | Not started | - |
| 12. E2E & Visual Regression Testing | 0/? | Not started | - |
