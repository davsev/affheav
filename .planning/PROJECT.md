# Affiliate Heaven

## What This Is

Affiliate Heaven is an affiliate product broadcasting platform that automates sending products and messages to WhatsApp groups, Facebook pages, and Instagram accounts on a cron schedule, organized by niche (subject). The platform is being rebuilt as a microservices architecture — each service extracted one at a time (Strangler Fig) behind a stable API surface, with per-user encrypted credential storage, multi-user support, and full test coverage.

## Core Value

Niche owners can run multiple affiliate channels — each with its own audience, accounts, and schedule — from a single platform, without manual intervention.

## Current Milestone: v2.0 — Microservices Rebuild

**Goal:** Decompose the Node.js/Express monolith into independent microservices using the Strangler Fig pattern, with a redesigned DB schema, per-user encrypted credential storage, multi-user support, and a modern React + Mantine frontend.

**Strategy:** Each service is extracted as a feature branch experiment. If the microservice is stable, it goes live. If not, the monolith fallback stays active. No downtime, no big-bang risk.

**Target features:**
- Monorepo with shared TypeScript config, ESLint, Prettier, Docker Compose
- Auth service (Google OAuth → JWT stateless, invite flow)
- User service with per-user encrypted credentials (Facebook, AliExpress, WhatsApp, Instagram)
- Redesigned normalized PostgreSQL schema (Drizzle ORM)
- Subjects (niches) service
- Products service (CRUD + AliExpress import)
- AI Writer service (OpenAI, Hebrew, Shabbat logic)
- Channels service (WhatsApp, Facebook, Instagram, AliExpress adapters with circuit breaker)
- Scheduler service (cron from DB → BullMQ jobs)
- Broadcaster service (consumes queue → orchestrates pipeline)
- API Gateway (JWT validation, rate limiting, routing)
- Frontend rebuild (React + Mantine, Hebrew RTL dark theme, PWA-ready)
- Vitest unit tests per service + GitHub Actions CI

## Requirements

### Validated (v1.0 — Broadcast Messages Milestone)

- ✓ Multi-niche (subject) system with per-niche WhatsApp group, Facebook page, and MacroDroid webhook
- ✓ Product broadcasting pipeline (AI-generated Hebrew messages → WhatsApp + Facebook)
- ✓ Broadcast Messages system (pre-written, scheduled, WhatsApp + Facebook)
- ✓ Cron-based scheduler with enable/disable, fire-now, edit
- ✓ PostgreSQL data store with idempotent migrations
- ✓ Google OAuth authentication, invite-only, role-based (admin/user)
- ✓ Hebrew RTL dark-theme dashboard UI

### Active (v2.0)

- [ ] Monorepo scaffolded with pnpm workspaces, shared TS config, ESLint, Prettier
- [ ] Docker Compose runs all services locally
- [ ] GitHub Actions CI runs tsc + Vitest on every PR
- [ ] Auth service: Google OAuth → JWT (stateless), invite flow
- [ ] User service: per-user credential storage, AES-256 encrypted
- [ ] DB schema redesigned: normalized, Drizzle ORM, no redundant columns
- [ ] Subjects service: CRUD, linked to user credentials
- [ ] Products service: CRUD + AliExpress affiliate API import
- [ ] AI Writer service: OpenAI, Hebrew, Shabbat/Motzei Shabbat logic
- [ ] Channels service: WhatsApp, Facebook, Instagram adapters, circuit breaker, retry
- [ ] Scheduler service: cron from DB → BullMQ, hot reload
- [ ] Broadcaster service: queue consumer → full pipeline orchestration
- [ ] API Gateway: JWT validation, rate limiting, service routing
- [ ] Frontend: React + Mantine, Hebrew RTL dark theme, all dashboard sections

### Out of Scope

- Raw cron expression editing — human-friendly recurrence builder only
- Cloud image storage (S3/Cloudinary) — local filesystem for this milestone
- Per-send click analytics — future milestone
- Real-time chat — not part of product vision
- Mobile app — PWA is sufficient for this user base

## Context

**Previous milestone:** v1.0 completed all 3 phases (Backend Foundation, Scheduler & Delivery, Frontend UI) for Broadcast Messages feature. All phases complete as of 2026-04-16.

**Existing codebase:**
- `server.js` — Express entry point, Passport OAuth, SSE log streaming
- `services/workflow.js` — product pipeline orchestrator (→ broadcaster-service)
- `services/googleSheets.js` — legacy data bridge (to be retired)
- `scheduler/index.js` — node-cron manager (→ scheduler-service)
- `routes/` — one file per resource (→ per-service endpoints)
- `public/app.js` — 2231-line vanilla JS SPA (→ React + Mantine)
- `db/migrate.js` — idempotent schema (→ Drizzle ORM migrations)

**Codebase maps:** `.planning/codebase/` (7 documents)

## Constraints

- **Migration:** Strangler Fig — monolith stays live during extraction; no downtime
- **Feature branches:** Each service extracted on its own branch; merged only when stable
- **Auth:** JWT stateless in new services; session-based removed
- **Credentials:** Per-user, AES-256 encrypted in DB — no per-user env vars
- **Testing:** No phase ships without unit tests passing in CI
- **Commits:** All PRs follow Conventional Commits format
- **Frontend:** Mantine design system — no custom CSS from scratch
- **RTL:** Hebrew RTL support required; Mantine has first-class RTL

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Strangler Fig migration | Zero downtime, rollback-safe, lower risk than big-bang | — Pending |
| pnpm workspaces monorepo | Shared tooling, single repo, easier cross-service types | — Pending |
| Fastify or Hono (TBD) | Faster than Express, built-in schema validation | — Pending |
| Drizzle ORM | Type-safe queries, lightweight, good migration support | — Pending |
| BullMQ + Redis | Replaces cron-to-workflow coupling with async jobs | — Pending |
| Mantine UI | Best RTL support, dark mode, data components, no custom CSS | — Pending |
| Vitest | Fast, ESM-native, good mocking, works in monorepo | — Pending |
| AES-256 credential encryption | User API keys encrypted at rest, only ENCRYPTION_KEY in env | — Pending |

---
*Last updated: 2026-04-29 — Milestone v2.0 started (Microservices Rebuild)*
