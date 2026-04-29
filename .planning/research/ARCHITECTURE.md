# Architecture Research

**Domain:** Strangler Fig microservices extraction from Node.js/Express monolith
**Researched:** 2026-04-29
**Confidence:** HIGH

## Standard Architecture

### System Overview — Target State

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser / PWA                                 │
│             React + Mantine SPA (Hebrew RTL dark theme)             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS
┌──────────────────────────────▼──────────────────────────────────────┐
│                         API Gateway                                  │
│            JWT validation · rate limiting · service routing          │
└──┬──────────┬────────────┬──────────┬───────────┬───────────────────┘
   │          │            │          │           │
┌──▼──┐  ┌───▼──┐  ┌──────▼──┐ ┌────▼────┐ ┌───▼────────────────┐
│auth │  │user  │  │subjects │ │products │ │ai-writer           │
│svc  │  │svc   │  │svc      │ │svc      │ │svc                 │
└──┬──┘  └───┬──┘  └──────┬──┘ └────┬────┘ └───┬────────────────┘
   │          │            │          │           │
   └──────────┴────────────┴──┬───────┴───────────┘
                              │ All services → shared PG cluster
                    ┌─────────▼──────────────────────────────┐
                    │  PostgreSQL  (schema-per-service)        │
                    │  auth · users · subjects · products …   │
                    └────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     Async / Job Tier                                  │
│  scheduler-svc ──→ BullMQ (Redis) ──→ broadcaster-svc               │
│                        │                      │                      │
│                        │              channels-svc                   │
│                        │         (WA / FB / IG / AliExpress)        │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Owns in DB |
|-----------|---------------|------------|
| api-gateway | JWT validation, rate limiting, reverse proxy to services | none |
| auth-service | Google OAuth flow, JWT issuance, invite tokens | `auth` schema: `users`, `invitations` |
| user-service | User CRUD, roles, per-user AES-256 encrypted credentials | `users` schema: `users`, `user_credentials` |
| subjects-service | Niche CRUD, per-niche platform toggles | `subjects` schema: `subjects`, `whatsapp_groups` |
| products-service | Product CRUD, sort_order queue, AliExpress import | `products` schema: `products` |
| ai-writer-service | Hebrew message generation, Shabbat logic, prompt management | `ai` schema: `prompt_templates` |
| channels-service | WhatsApp/Facebook/Instagram/AliExpress API adapters, circuit breaker | none (stateless adapters) |
| scheduler-service | Load cron schedules from DB, publish jobs to BullMQ | `scheduler` schema: `schedules` |
| broadcaster-service | BullMQ consumer, pipeline orchestration | `logs` schema: `logs` |
| frontend | React + Mantine SPA, Hebrew RTL, consumes API gateway | none |

---

## Extraction Order: Dependency Analysis

The key constraint is that services extracted later can only be extracted safely once their dependencies are already live. The monolith continues to serve everything during extraction.

### Dependency Graph (must-extract-before arrows)

```
auth-service
    ↓ (JWT used by all other services)
api-gateway
    ↓ (gateway routes once services exist)
user-service
    ↓ (subjects belong to users)
subjects-service
    ↓ (products tagged to subjects)
products-service
    ↓ (pipeline needs products, subjects, ai, channels)
ai-writer-service
channels-service
    ↓ (broadcaster drives everything downstream)
scheduler-service
broadcaster-service
    ↓ (frontend last; depends on full API surface)
frontend
```

### Recommended Extraction Sequence

| Wave | Service | Rationale |
|------|---------|-----------|
| 1 | **auth-service** | Zero downstream coupling; JWT replaces sessions; can run alongside monolith session auth during transition |
| 2 | **api-gateway** | Once JWT is live, gateway can validate tokens and proxy to monolith for everything not yet extracted |
| 3 | **user-service** | Auth is a prerequisite; user/credential data is isolated; unblocks subjects |
| 4 | **subjects-service** | Depends on user-service only; niches are the scoping key for all downstream data |
| 5 | **products-service** | Depends on subjects; clean table, straightforward CRUD + AliExpress import |
| 6 | **ai-writer-service** | Stateless; only calls OpenAI; no DB coupling except prompt storage |
| 7 | **channels-service** | Stateless adapters; extracts cleanest; circuit breaker logic lives here |
| 8 | **scheduler-service** | Depends on subjects/products existing; publishes to BullMQ |
| 9 | **broadcaster-service** | Last synchronous step; consumes queue, calls all upstream services |
| 10 | **frontend** | Rebuilt only after full API surface is stable |

**Rationale for auth first:** All other services will need to validate JWTs. The auth service must exist before the gateway can validate tokens. Extracting auth first also lets you run a dual-auth window (sessions + JWT) during which existing users are not broken.

---

## Integration with the Existing Monolith During Extraction

### The Routing Proxy Pattern

The API gateway is the Strangler Fig "vine." Add it as a thin reverse proxy in front of the monolith on day one. Initially it passes 100% of traffic through to the monolith unchanged. As each service is extracted, update routing rules to direct those endpoints to the new service. The monolith shrinks; the gateway grows.

```
Phase 0:  Browser → Gateway → Monolith (100%)
Phase 2:  Browser → Gateway → auth-service (/auth/*)
                            → Monolith (everything else)
Phase 5:  Browser → Gateway → auth-service
                            → user-service
                            → subjects-service
                            → products-service
                            → Monolith (legacy routes only)
Final:    Browser → Gateway → all microservices (monolith decommissioned)
```

**Implementation:** Use [http-proxy-middleware](https://github.com/chimurai/http-proxy-middleware) or Fastify/Hono proxy plugin in the gateway. Each routing rule is a simple path-prefix match.

### Monolith Modifications Required During Extraction

These are the only changes the monolith needs; avoid larger refactors until a service is fully extracted.

| Extraction Step | Monolith Change Required |
|-----------------|--------------------------|
| Wave 1 (auth) | Add JWT verification middleware alongside existing session middleware |
| Wave 2 (gateway) | Add `trust proxy` for gateway-forwarded headers (already present) |
| Wave 3 (user-service) | Route `/api/users/*` and `/api/me` to new service via gateway |
| Waves 4-9 | Route extracted resource endpoints to respective services |
| Final | Monolith process removed; only gateway + services remain |

### New Components vs Modified Components

**New (greenfield):**
- api-gateway (new process)
- auth-service (new process, replaces Passport.js block in server.js)
- user-service (new process, replaces `services/userService.js` + `services/inviteService.js`)
- subjects-service (new process, replaces `services/subjectService.js` + `routes/subjects.js`)
- products-service (new process, replaces `routes/products.js` + `routes/aliexpress-api.js`)
- ai-writer-service (new process, replaces `services/openai.js` + `routes/prompt.js`)
- channels-service (new process, replaces `services/whatsapp.js` + `services/facebook.js` + `services/instagram.js`)
- scheduler-service (new process, replaces `scheduler/index.js`)
- broadcaster-service (new process, replaces `services/workflow.js` + `routes/send.js`)
- frontend (full rewrite; replaces `public/app.js`)

**Modified (monolith stays, route redirected):**
- `server.js` — gains JWT middleware; loses routes one by one as services extract
- `db/migrate.js` — Drizzle migrations replace idempotent CREATE TABLE IF NOT EXISTS

**Retired (deleted at project end):**
- `services/googleSheets.js` — legacy data bridge
- `services/workflow.js` — absorbed by broadcaster-service
- `scheduler/index.js` — absorbed by scheduler-service
- `public/app.js` / `public/style.css` — replaced by React SPA

---

## Database Strategy: Schema-Per-Service on Shared Cluster

### Why Schema-Per-Service, Not Separate Clusters

For a small team with a single PostgreSQL instance on Railway, using a separate schema per service is the correct tradeoff. It provides:
- Logical isolation enforced at the DB level (separate DB users, GRANT to own schema only)
- Single managed instance (no Railway cost explosion)
- No cross-service JOINs (services call each other's APIs, not each other's tables)
- Upgrade path to separate clusters per service if load ever demands it

**Do not** keep a single shared schema during migration — it hides coupling, prevents schema evolution per-service, and makes future cluster separation impossible.

### Schema Layout

```sql
-- Each service owns one schema; its DB user has no access to other schemas
CREATE SCHEMA auth;       -- users, invitations (auth-service user)
CREATE SCHEMA users;      -- users (profile only), user_credentials (user-service user)
CREATE SCHEMA subjects;   -- subjects, whatsapp_groups (subjects-service user)
CREATE SCHEMA products;   -- products (products-service user)
CREATE SCHEMA ai;         -- prompt_templates, settings (ai-writer-service user)
CREATE SCHEMA scheduler;  -- schedules (scheduler-service user)
CREATE SCHEMA logs;       -- logs (broadcaster-service user)
```

**Note on users table duplication:** `auth` schema stores identity (googleId, email, role, status). `users` schema stores profile + credentials. Services that need to know "who is this user?" call the user-service HTTP API, not the auth schema directly. No cross-schema JOINs.

### Migration Strategy: Monolith to Schema-Per-Service

The current monolith uses a flat public schema. Migrating requires:

1. Create new schemas + Drizzle migration files per service
2. Backfill new schemas from existing public tables (one-time data migration script)
3. Dual-write: monolith writes public + new schema during transition window
4. Once service is live and serving reads, cut the monolith write to the old table
5. Drop old public table after 1 full week of confirmed correct service operation

---

## Auth Migration: Session → JWT

### Dual-Auth Transition Window

The monolith currently uses `express-session` + Passport. Existing users have active 30-day cookies. A hard cutover would invalidate all sessions and force every user to re-login on deploy.

**Safe approach: parallel auth middleware**

```typescript
// In monolith's server.js — add JWT check alongside session check
const isAuthenticated = async (req, res, next) => {
  // 1. Try JWT (new path — from API gateway or new frontend)
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
      req.user = await userService.findById(payload.sub);
      return req.user ? next() : res.status(401).json({ success: false, error: 'Unauthorized' });
    } catch {
      // fall through to session check
    }
  }
  // 2. Try session (legacy path — existing browser cookies)
  if (req.isAuthenticated() && req.user) return next();
  res.status(401).json({ success: false, error: 'Unauthorized' });
};
```

**Transition phases:**

| Phase | Auth State |
|-------|-----------|
| Pre-extraction | Session only |
| Wave 1 (auth-service live) | Session + JWT both accepted by monolith |
| Frontend migrated to React | Frontend sends JWT; sessions deprecated |
| 30-day cookie expiry window | All active sessions naturally expire |
| Session middleware removed | JWT only |

**JWT configuration for the auth-service:**

- Access token TTL: 15 minutes (short, stateless validation by all services)
- Refresh token TTL: 30 days (matches current session TTL; stored in `auth` schema `refresh_tokens` table)
- Algorithm: RS256 (asymmetric; services verify with public key, only auth-service holds private key)
- Claims: `sub` (user DB id), `role`, `email`, `iat`, `exp`

**Token revocation:** JWT is stateless; revocation requires either short access token TTL (15 min) or a Redis blocklist. For this project, short TTL + refresh token rotation is sufficient. No Redis blocklist needed initially.

---

## Inter-Service Communication Patterns

### Synchronous (HTTP) — When to Use

Use HTTP (Fastify/Hono REST) for:
- User-initiated reads (products list, subject list)
- CRUD operations where the caller needs an immediate response
- Auth token validation (gateway → auth-service)

**Pattern:** Each service exposes a Fastify/Hono REST API. Service-to-service calls use `fetch` or `axios` with the service's internal hostname. The API gateway is the only entry point from outside; internal services call each other directly (no gateway hop for internal traffic).

### Asynchronous (BullMQ) — When to Use

Use BullMQ for:
- Broadcasting jobs (fire-and-forget, long-running)
- Scheduled product sends (scheduler → broadcaster)
- Retry logic (channels-service failures)

**Pattern:**
```
scheduler-service
  → publishes Job { userId, subjectId, productId? } to BullMQ queue "broadcast"
broadcaster-service
  → consumes queue "broadcast"
  → calls products-service (HTTP) to get next unsent product
  → calls ai-writer-service (HTTP) to generate message
  → calls channels-service (HTTP) for each platform
  → calls products-service (HTTP) to mark sent
  → appends to logs
```

BullMQ job options: `attempts: 3`, `backoff: { type: 'exponential', delay: 60000 }`. Channel failures are per-platform isolated — a failed Instagram attempt doesn't prevent WhatsApp delivery (match existing monolith behavior).

### SSE Logs — Migration Path

The current monolith streams logs via SSE from in-process memory. In microservices, logs originate in broadcaster-service. The API gateway proxies the SSE stream, or the frontend subscribes to broadcaster-service's SSE endpoint directly via the gateway.

---

## Data Flow: Target State Broadcast Pipeline

```
Cron fires in scheduler-service (Asia/Jerusalem timezone)
    ↓
scheduler-service publishes Job to BullMQ "broadcast" queue
    ↓
broadcaster-service dequeues job
    ↓
  GET /products/next-unsent?subjectId=X → products-service
    ↓
  GET /subjects/:id → subjects-service (credentials, platform flags)
    ↓
  POST /generate → ai-writer-service (Hebrew message; Shabbat logic)
    ↓
  POST /send/whatsapp → channels-service (MacroDroid webhook per group)
  POST /send/facebook → channels-service (Graph API)
  POST /send/instagram → channels-service (Content Publishing API)
    ↓ (parallel, isolated failures)
  PATCH /products/:id/mark-sent → products-service
    ↓
  POST /logs → broadcaster-service logs table
    ↓
  SSE emit → connected frontend clients
```

---

## Monorepo Structure

```
affiliate-heaven/
├── packages/
│   ├── shared/              # Shared TypeScript types, Zod schemas, constants
│   │   ├── src/types/       # User, Subject, Product, Job types
│   │   └── src/schemas/     # Zod validation schemas
│   ├── auth-service/        # Wave 1
│   ├── api-gateway/         # Wave 2
│   ├── user-service/        # Wave 3
│   ├── subjects-service/    # Wave 4
│   ├── products-service/    # Wave 5
│   ├── ai-writer-service/   # Wave 6
│   ├── channels-service/    # Wave 7
│   ├── scheduler-service/   # Wave 8
│   ├── broadcaster-service/ # Wave 9
│   └── frontend/            # Wave 10
├── docker-compose.yml       # Local dev: all services + Redis + PostgreSQL
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .eslintrc.base.js
└── server.js                # Existing monolith (gradually reduced)
```

Each service package:
```
packages/auth-service/
├── src/
│   ├── index.ts             # Fastify/Hono app entry
│   ├── routes/              # Route handlers
│   ├── services/            # Business logic
│   ├── db/                  # Drizzle schema + queries for this service's schema
│   └── middleware/          # JWT, error handling
├── vitest.config.ts
├── package.json
└── Dockerfile
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Shared Public Schema During Transition

**What people do:** Keep all tables in the public schema while extracting services; services query each other's tables directly.

**Why it's wrong:** Hides coupling. Prevents independent schema evolution. Makes future cluster separation impossible. Creates a distributed monolith.

**Do this instead:** Schema-per-service from day one. Services call each other's HTTP APIs for cross-domain data.

### Anti-Pattern 2: Big-Bang Auth Migration

**What people do:** Deploy JWT auth service and remove session middleware simultaneously.

**Why it's wrong:** Invalidates all active user sessions on deploy. Users with 30-day cookies are silently logged out. Support burden spikes.

**Do this instead:** Dual-auth middleware in monolith (session + JWT both accepted) during the transition window. Remove session support only after the 30-day max cookie age has elapsed and the new frontend is live.

### Anti-Pattern 3: Synchronous Chain for Broadcasting

**What people do:** API request → auth-service → products-service → ai-service → channels-service → response.

**Why it's wrong:** HTTP timeout on long-running WhatsApp sends (2-minute delays between groups). Retry logic becomes complex. Caller blocks.

**Do this instead:** HTTP request enqueues a BullMQ job and returns `202 Accepted`. broadcaster-service runs the pipeline asynchronously; SSE streams progress to the frontend.

### Anti-Pattern 4: Extracting Broadcaster Before Its Dependencies

**What people do:** Extract broadcaster-service early because it's the "core" feature.

**Why it's wrong:** broadcaster-service calls products-service, ai-writer-service, and channels-service. If those don't exist yet, you'll be making HTTP calls back into the monolith indefinitely, creating a complex routing tangle.

**Do this instead:** Follow the wave order. Extract all upstream services first. broadcaster-service is Wave 9 because it depends on Waves 4-7.

### Anti-Pattern 5: Per-User Environment Variables for Credentials

**What people do:** Store `FACEBOOK_ACCESS_TOKEN_USER123=...` in environment variables.

**Why it's wrong:** Doesn't scale. No encryption. Requires deploy to add new user.

**Do this instead:** user-service stores credentials as AES-256-GCM encrypted blobs in `user_credentials` table. Only `ENCRYPTION_KEY` env var needed.

---

## Integration Points

### External Services

| Service | Integration | Notes |
|---------|-------------|-------|
| Google OAuth | auth-service only; returns JWT to frontend | No other service touches Google OAuth |
| OpenAI Chat Completions | ai-writer-service only | GPT-4 Mini; Shabbat logic stays here |
| MacroDroid webhook | channels-service (WhatsApp adapter) | Per-subject URL from user_credentials |
| Facebook Graph API v23 | channels-service (Facebook adapter) | Token from user_credentials |
| Instagram Content Publishing API v24 | channels-service (Instagram adapter) | Token from user_credentials |
| AliExpress Affiliate API | products-service (import) | MD5-signed requests |
| spoo.me URL shortener | products-service (URL shortening on import) | Optional; fallback to long URL |
| BullMQ / Redis | scheduler-service → broadcaster-service | Single Redis instance |

### Internal Service Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| gateway ↔ auth-service | HTTP (JWT validation endpoint) | Gateway calls auth on every request if not caching public key |
| gateway ↔ all services | HTTP reverse proxy | Path-based routing rules |
| broadcaster ↔ products | HTTP REST | GET next-unsent, PATCH mark-sent |
| broadcaster ↔ ai-writer | HTTP REST | POST /generate |
| broadcaster ↔ channels | HTTP REST | POST /send/:platform |
| broadcaster ↔ subjects | HTTP REST | GET subject credentials |
| scheduler ↔ broadcaster | BullMQ (Redis) | Async; no direct HTTP |
| all services ↔ PostgreSQL | Direct pg/Drizzle | Each service connects to its own schema |

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (1-10 users) | Single instance per service on Railway; shared PostgreSQL; single Redis |
| 100 users | Add connection pooling (PgBouncer); increase BullMQ concurrency |
| 1,000+ users | Separate PostgreSQL clusters per high-traffic service; Redis Sentinel; horizontal broadcaster replicas |

The broadcaster-service is the primary scaling bottleneck — WhatsApp sends are serialized per group (2-minute delays by MacroDroid constraint). At higher user counts, run multiple broadcaster replicas with BullMQ job locking to prevent duplicate sends.

---

## Sources

- [Strangler Fig Pattern — AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html) — HIGH confidence
- [Strangler Fig Pattern — microservices.io](https://microservices.io/patterns/refactoring/strangler-application.html) — HIGH confidence
- [Schema per Service pattern — Monolith to Microservices, O'Reilly](https://www.oreilly.com/library/view/monolith-to-microservices/9781492047834/ch04.html) — HIGH confidence
- [BullMQ documentation](https://docs.bullmq.io/) — HIGH confidence
- [Auth.js Session Strategies](https://authjs.dev/concepts/session-strategies) — MEDIUM confidence
- [Microservices authentication patterns 2025](https://rohitpatil.com/blog/microservices-authentication-patterns.html) — MEDIUM confidence
- [API Gateway Authentication Patterns 2026](https://www.elysiate.com/blog/api-gateway-authentication-patterns-jwt-oauth) — MEDIUM confidence
- Monolith codebase analysis: `server.js`, `services/workflow.js`, `scheduler/index.js`, `.planning/codebase/ARCHITECTURE.md` — HIGH confidence

---
*Architecture research for: Affiliate Heaven v2.0 Microservices Rebuild (Strangler Fig)*
*Researched: 2026-04-29*
