# Requirements: Affiliate Heaven v2.0 — Microservices Rebuild

**Defined:** 2026-04-29
**Core Value:** Niche owners can run multiple affiliate channels — each with its own audience, accounts, and schedule — from a single platform, without manual intervention.

## v2.0 Requirements

### Infrastructure & Tooling

- [ ] **INFRA-01**: Developer can run all services locally with `docker compose up`
- [ ] **INFRA-02**: pnpm workspace monorepo with shared TypeScript config, ESLint, and Prettier
- [ ] **INFRA-03**: Shared `packages/db` holds Drizzle ORM schema used by all services
- [ ] **INFRA-04**: Each service has its own PostgreSQL schema and dedicated DB user with no cross-schema access
- [ ] **INFRA-05**: Redis available in Docker Compose for BullMQ from day one
- [ ] **INFRA-06**: Branch merge deadline policy enforced: feature branches merged within 21 days or rebased

### API Gateway

- [x] **GW-01**: Gateway routes all `/api/v1/*` traffic — initially 100% proxied to monolith
- [ ] **GW-02**: Gateway validates JWT Bearer tokens and rejects unauthenticated requests
- [ ] **GW-03**: Gateway enforces per-user rate limiting
- [ ] **GW-04**: Traffic can be switched per-route from monolith to microservice via feature flag without redeployment

### Authentication

- [ ] **AUTH-01**: User can log in with Google OAuth and receive a JWT (RS256 with `kid` key registry)
- [ ] **AUTH-02**: JWT is stateless — no server-side session store required in new services
- [ ] **AUTH-03**: Monolith `isAuthenticated` middleware accepts both session cookie AND JWT Bearer token during transition window (minimum 30 days)
- [ ] **AUTH-04**: Admin can send invite links; invited users register via Google OAuth
- [ ] **AUTH-05**: JWT key rotation via `kid` registry without mass logout of active users

### User & Credential Management

- [ ] **USER-01**: User account has a role enforced server-side on every request
- [ ] **USER-02**: Admin can view, activate, deactivate, and delete users
- [ ] **USER-03**: User credentials (Facebook token, AliExpress key, WhatsApp webhook URL, Instagram token) stored AES-256-GCM encrypted with `key_version` column
- [ ] **USER-04**: Credential API returns boolean presence indicators only — raw token values never sent to client
- [ ] **USER-05**: User can connect and disconnect each platform account independently

### Permissions & Roles

- [ ] **PERM-01**: Super admin can create named custom roles (e.g. "editor", "viewer", "manager")
- [ ] **PERM-02**: Each role has a configurable permission set with granular read/write/delete per resource type
- [ ] **PERM-03**: Super admin can assign any role to any user
- [ ] **PERM-04**: All API endpoints enforce permissions server-side — client-provided role claims are never trusted
- [ ] **PERM-05**: Only super admin can create, modify, or delete roles

### Database Schema

- [ ] **DB-01**: Schema redesigned: normalized, no redundant columns, full Drizzle ORM TypeScript types
- [ ] **DB-02**: All tables have `id UUID DEFAULT gen_random_uuid()`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`, and explicit FK constraints
- [ ] **DB-03**: Google Sheets removed as data source — PostgreSQL is the sole source of truth
- [ ] **DB-04**: All column changes use expand-contract migration pattern (add nullable → backfill → constrain → drop old column)

### Subjects Service

- [ ] **SUBJ-01**: User can create, read, update, and delete subjects (niches)
- [ ] **SUBJ-02**: Each subject links to the user's stored credentials per platform (Facebook page, Instagram account, WhatsApp webhook)

### Products Service

- [ ] **PROD-01**: User can create, read, update, and delete products scoped to a subject
- [ ] **PROD-02**: User can import products from AliExpress affiliate API using their stored AliExpress credentials
- [ ] **PROD-03**: Each product tracks sent status and sent timestamp

### AI Writer Service

- [ ] **AI-01**: Service generates Hebrew marketing messages from product data via OpenAI using user's stored API key
- [ ] **AI-02**: Shabbat/Motzei Shabbat greeting automatically applied based on Asia/Jerusalem timezone
- [ ] **AI-03**: Subject-level prompt override applied when configured by user

### Channels Service

- [ ] **CHAN-01**: Service sends text and optional image to Facebook page via Graph API using user's stored credentials
- [ ] **CHAN-02**: Service sends text and optional image to WhatsApp group via MacroDroid webhook using user's stored webhook URL
- [ ] **CHAN-03**: Service publishes to Instagram via two-phase Content Publishing API using user's stored credentials
- [ ] **CHAN-04**: Per-channel circuit breaker — failure on one platform does not block delivery to others
- [ ] **CHAN-05**: Failed sends retry up to 3 times with exponential backoff; exhausted jobs go to dead letter queue

### Scheduler Service

- [ ] **SCHED-01**: Enabled schedules loaded from DB on startup and registered as cron jobs
- [ ] **SCHED-02**: Schedule create, update, and delete hot-reload cron jobs without service restart
- [ ] **SCHED-03**: Cron job fires by pushing a job to BullMQ with a deterministic job ID for deduplication

### Broadcaster Service

- [ ] **BROAD-01**: Broadcaster consumes BullMQ jobs: fetch product → generate message → send to channels → log result
- [ ] **BROAD-02**: DB-level sent flag checked before each external API call on every attempt (idempotency guard)
- [ ] **BROAD-03**: Broadcast result stored in logs table with per-channel success/fail status
- [ ] **BROAD-04**: Dead letter queue captures exhausted jobs for manual inspection

### Frontend

- [ ] **FE-01**: React 19 + Mantine 9, Hebrew RTL (`DirectionProvider initialDirection="rtl"`), dark mode (`defaultColorScheme="dark"`)
- [ ] **FE-02**: All existing dashboard sections rebuilt: products, schedules, broadcasts, scraper, logs, settings, users
- [ ] **FE-03**: Auth flow uses JWT Bearer token (not session cookie)
- [ ] **FE-04**: Credential connection screens per platform (Facebook, Instagram, AliExpress, WhatsApp)
- [ ] **FE-05**: Feature Flags management screen for super admin — toggle per flag with immediate effect

### Internationalization (i18n)

- [ ] **I18N-01**: All UI strings externalized — no hardcoded text in components
- [ ] **I18N-02**: System supports Hebrew (RTL) and English (LTR) at launch; architecture supports adding languages without code changes
- [ ] **I18N-03**: User can switch display language from profile settings
- [ ] **I18N-04**: Translation strings stored in JSON files per language (`locales/he.json`, `locales/en.json`)

### Feature Flags

- [x] **FLAG-01**: Feature flag system with flags stored in DB — each flag maps to a named capability (e.g. `auth-service`, `products-service`)
- [ ] **FLAG-02**: Super admin can toggle any feature flag via the Feature Flags screen with immediate effect — no redeployment required
- [ ] **FLAG-03**: When a service flag is off, API Gateway routes to monolith fallback; when on, routes to the new microservice
- [x] **FLAG-04**: Each extracted microservice is gated behind its own feature flag — Strangler Fig switch per service

### CI/CD Standards

- [ ] **CI-01**: GitHub Actions CI runs on every PR: `tsc --noEmit` + Vitest unit tests + ESLint
- [ ] **CI-02**: PR title validated against Conventional Commits format — PR fails CI if title does not match (`feat:`, `fix:`, `refactor:`, `chore:`, `test:`, `docs:`, `ci:`, `perf:`)
- [ ] **CI-03**: `commitlint` enforces Conventional Commits in CI pipeline
- [ ] **CI-04**: Playwright visual regression suite runs on merge to `main` — failures block merge

### Testing — E2E & Visual Regression

- [ ] **TEST-01**: Playwright E2E suite covers critical user flows: login, send product, schedule management, feature flag toggle
- [ ] **TEST-02**: Playwright captures visual snapshots per screen — baseline approved once, future merges to `main` compare pixel-by-pixel
- [ ] **TEST-03**: Visual snapshot failures block merge to `main` — developer must explicitly update snapshots to approve visual changes
- [ ] **TEST-04**: Feature flag scenarios tested in both states: flag on (new microservice) and flag off (monolith fallback)
- [ ] **TEST-05**: Vitest unit tests required for every new service function before phase is considered complete

---

## v3 Requirements (Deferred)

### Analytics
- **ANLX-01**: Track send success/failure per broadcast message with history log
- **ANLX-02**: Click tracking on links included in broadcast messages

### Advanced Scheduling
- **SCHED-04**: Bi-weekly and monthly recurrence options
- **SCHED-05**: Multiple send times per day

### Infrastructure
- **INFRA-07**: OpenAPI/Swagger docs auto-generated per service and aggregated at `/api/docs`
- **INFRA-08**: Distributed tracing (OpenTelemetry) across services

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time chat | Not part of product vision |
| Mobile app (React Native) | PWA is sufficient for this user base |
| Cloud image storage (S3/Cloudinary) | Local filesystem sufficient — add in v3 |
| Video posts | Storage/bandwidth cost, not requested |
| Multi-tenant organization sharing | Single-user account model for v2.0 |
| Fine-grained per-user permissions (no roles) | Role-based covers all stated use cases |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 4 | Pending |
| INFRA-02 | Phase 4 | Pending |
| INFRA-03 | Phase 4 | Pending |
| INFRA-04 | Phase 4 | Pending |
| INFRA-05 | Phase 4 | Pending |
| INFRA-06 | Phase 4 | Pending |
| CI-01 | Phase 4 | Pending |
| CI-02 | Phase 4 | Pending |
| CI-03 | Phase 4 | Pending |
| TEST-05 | Phase 4 | Pending |
| GW-01 | Phase 5 | Complete |
| GW-02 | Phase 5 | Pending |
| GW-03 | Phase 5 | Pending |
| GW-04 | Phase 5 | Pending |
| FLAG-01 | Phase 5 | Complete |
| FLAG-02 | Phase 5 | Pending |
| FLAG-03 | Phase 5 | Pending |
| FLAG-04 | Phase 5 | Complete |
| AUTH-01 | Phase 6 | Pending |
| AUTH-02 | Phase 6 | Pending |
| AUTH-03 | Phase 6 | Pending |
| AUTH-04 | Phase 6 | Pending |
| AUTH-05 | Phase 6 | Pending |
| USER-01 | Phase 7 | Pending |
| USER-02 | Phase 7 | Pending |
| USER-03 | Phase 7 | Pending |
| USER-04 | Phase 7 | Pending |
| USER-05 | Phase 7 | Pending |
| PERM-01 | Phase 7 | Pending |
| PERM-02 | Phase 7 | Pending |
| PERM-03 | Phase 7 | Pending |
| PERM-04 | Phase 7 | Pending |
| PERM-05 | Phase 7 | Pending |
| DB-01 | Phase 7 | Pending |
| DB-02 | Phase 7 | Pending |
| DB-03 | Phase 7 | Pending |
| DB-04 | Phase 7 | Pending |
| SUBJ-01 | Phase 8 | Pending |
| SUBJ-02 | Phase 8 | Pending |
| PROD-01 | Phase 8 | Pending |
| PROD-02 | Phase 8 | Pending |
| PROD-03 | Phase 8 | Pending |
| AI-01 | Phase 9 | Pending |
| AI-02 | Phase 9 | Pending |
| AI-03 | Phase 9 | Pending |
| CHAN-01 | Phase 9 | Pending |
| CHAN-02 | Phase 9 | Pending |
| CHAN-03 | Phase 9 | Pending |
| CHAN-04 | Phase 9 | Pending |
| CHAN-05 | Phase 9 | Pending |
| SCHED-01 | Phase 10 | Pending |
| SCHED-02 | Phase 10 | Pending |
| SCHED-03 | Phase 10 | Pending |
| BROAD-01 | Phase 10 | Pending |
| BROAD-02 | Phase 10 | Pending |
| BROAD-03 | Phase 10 | Pending |
| BROAD-04 | Phase 10 | Pending |
| FE-01 | Phase 11 | Pending |
| FE-02 | Phase 11 | Pending |
| FE-03 | Phase 11 | Pending |
| FE-04 | Phase 11 | Pending |
| FE-05 | Phase 11 | Pending |
| I18N-01 | Phase 11 | Pending |
| I18N-02 | Phase 11 | Pending |
| I18N-03 | Phase 11 | Pending |
| I18N-04 | Phase 11 | Pending |
| TEST-01 | Phase 12 | Pending |
| TEST-02 | Phase 12 | Pending |
| TEST-03 | Phase 12 | Pending |
| TEST-04 | Phase 12 | Pending |
| CI-04 | Phase 12 | Pending |

**Coverage:**
- v2.0 requirements: 73 total
- Mapped to phases: 73
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-29*
*Last updated: 2026-04-29 — traceability populated by roadmapper (v2.0 roadmap, 9 phases)*
