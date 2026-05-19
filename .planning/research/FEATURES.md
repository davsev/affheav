# Feature Research

**Domain:** Multi-tenant SaaS affiliate broadcasting platform — microservices rebuild
**Researched:** 2026-04-29
**Confidence:** HIGH (architecture patterns well-established; implementation specifics MEDIUM)

---

## Feature Landscape

This document covers the five feature categories introduced in the v2.0 rebuild. Existing v1.0 features (product pipeline, broadcast messages, scheduler, WhatsApp/Facebook channels, cron-based scheduling) are validated and NOT re-researched here.

---

### Category 1: Per-User Credential Storage

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| AES-256-GCM encryption of stored credentials | Users expect their API keys not to be readable if DB is compromised | MEDIUM | Use Node.js `crypto` built-in. Single `ENCRYPTION_KEY` env var. Per-record random IV stored alongside ciphertext. Auth tag provides integrity verification. |
| Credentials never returned to client | Standard SaaS — tokens are write-only from user perspective | LOW | Endpoints return boolean presence indicators only (already done in v1 settings endpoint). Pattern must be enforced service-wide. |
| Per-user credential namespace | Each user owns their own Facebook/WhatsApp/AliExpress/Instagram credentials | LOW | Already modeled in current `subjects` table with `user_id` FK. Microservices rebuild needs this enforced at service boundary, not just query level. |
| Credential update without re-entering all fields | UX standard — user updates one token, others remain | LOW | Store as separate rows keyed by `(user_id, provider, key_name)` OR as JSONB blob per provider. Row-per-key is safer for partial updates. |
| Credential validation on save | Surface bad tokens before they fail at broadcast time | MEDIUM | Call provider's "verify token" endpoint on save (Facebook `/me`, AliExpress auth check). Return actionable error messages. |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-record unique IV + key derivation (scrypt or HKDF) | Prevents ciphertext correlation attacks across users | MEDIUM | Even with same ENCRYPTION_KEY, each credential encrypted with unique IV. scrypt key derivation adds cost to brute-force. |
| Credential health dashboard | Users can see at a glance which credentials are valid/expired without trial sends | MEDIUM | Periodic background job tests stored credentials, writes `last_verified_at` + `status` per credential. |
| Credential rotation audit log | Compliance-friendly — when was each token last changed | LOW | Append-only log row on every credential write. Already have `logs` table. |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Per-user encryption key (derived from user password) | Seems more secure — each user's data unreadable without their key | Breaks admin support workflows; key lost if user forgets password; incompatible with JWT-stateless auth | Single server-side ENCRYPTION_KEY in env with per-record IVs. Rotate key with re-encryption job when compromised. |
| External vault (HashiCorp Vault, AWS Secrets Manager) | Enterprise-grade secret management | Massively overbuilt for this scale; adds infra dependency, latency, and operational complexity | AES-256-GCM in PostgreSQL with server-side key in env. Sufficient for this threat model. |
| Plaintext credential storage "for now" | Faster to ship | One breach exposes all users' third-party accounts | Encrypt from day one. The crypto module is built-in; cost is near zero. |

---

### Category 2: Multi-Tenant Platform

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Row-level tenant isolation in all queries | Users must never see each other's data | LOW | Every query must include `WHERE user_id = $userId`. Currently done in v1 per-route. In microservices, enforce at service layer, not route handler. JWT sub claim becomes the `userId` for all queries. |
| Admin cross-tenant visibility | Admin needs to support users, review logs | LOW | `role = 'admin'` bypasses `user_id` filter. Already implemented in v1 `listUsers`. |
| User invitation flow | Invite-only registration prevents spam; already validated in v1 | LOW | Extract invite service from monolith as-is. No changes to semantics. |
| User suspension (not deletion) | Disabling access without destroying data | LOW | `status = 'suspended'` check on JWT validation in API gateway. Already modeled in `users` table. |
| Data isolation on delete | Deleting a user cascades to their data, not other users' | LOW | Already enforced via `ON DELETE CASCADE` in current schema. Verify Drizzle ORM migration preserves all FK cascade rules. |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-user usage metrics (product count, sends, schedules) | Enables future tiered pricing or admin oversight | LOW | Counts queryable from existing tables. No new schema needed. |
| Admin impersonation / act-as-user | Support without needing user's credentials | HIGH | Issue short-lived JWT with `sub=targetUserId, impersonatedBy=adminId`. Log all impersonation actions. Defer to v2.x. |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Organization/team model (users sharing subjects) | Power users want to collaborate | Adds M2M table, permission inheritance, invite-to-org flow — doubles auth complexity | Not in scope. Each user owns their own subjects. Sharing is out of scope per PROJECT.md. |
| Per-tenant database schemas | Maximum isolation | Overkill at this scale; connection pool exhaustion; migration complexity multiplied by tenant count | Single schema with `user_id` FK isolation. Sufficient for hundreds of users. |

---

### Category 3: Strangler Fig Migration

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Stable API surface during migration | No client breakage while extracting services | MEDIUM | API gateway routes requests to monolith or microservice based on which is active. Nginx `proxy_pass` or a lightweight Node gateway with routing table. |
| Feature-branch-per-service extraction | Each service independently shippable | LOW | Git branching convention already in PROJECT.md. One PR per service. Monolith fallback stays live. |
| Shared DB during transition | Monolith and new services read same PostgreSQL during overlap | MEDIUM | Services share DB but own their table subsets. No dual-write needed if extraction is done one domain at a time. Risk: schema changes in one service break monolith queries — use additive migrations only during overlap. |
| Traffic routing switch (monolith → microservice) | Rollback if new service is unstable | LOW | API gateway routing table: env var or DB flag controls which backend handles each route prefix. |
| Database migration compatibility | Drizzle ORM migrations must not break existing pg schema | MEDIUM | Drizzle `push` and `generate` are additive-safe. Avoid `DROP COLUMN` until monolith is fully retired from that domain. |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Canary traffic split per service | Shift 5% → 25% → 100% before full cutover | HIGH | Requires nginx upstream weights or API gateway with weighted routing. Overkill for single-owner platform; useful if user count grows. Defer to v2.x. |
| Automated rollback on error rate spike | Self-healing extraction | HIGH | Requires metrics collection + alerting. Defer to v2.x. Manual rollback (flip env var) is sufficient. |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Big-bang rewrite (all services at once) | Feels faster to plan | All-or-nothing risk; no fallback; months before anything ships | Strangler Fig: one service per branch, live in production when stable. Already the stated strategy. |
| Dual-write to both monolith and microservice DB | Data consistency during transition | Write amplification, consistency bugs, complex conflict resolution | Single DB during transition. Microservice reads/writes same tables. Schema ownership transfers as monolith code is deleted. |
| Service mesh (Istio, Linkerd) | Enterprise-grade traffic management | Massive operational overhead for a 2-person project | API gateway with simple routing table. No service mesh until scale demands it. |

---

### Category 4: Circuit Breaker / Multi-Channel Delivery Resilience

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Per-channel circuit breaker | Facebook API outage must not block WhatsApp delivery | MEDIUM | `opossum` library (v9.x, Node 20+). One breaker instance per channel adapter (WhatsApp, Facebook, Instagram, AliExpress). Closed → Open on failure threshold. Half-open probe to auto-recover. |
| Exponential backoff with jitter on retries | Thundering herd problem on API rate limits | LOW | Retry with `2^attempt * (1 + random * 0.1)` delay. Cap at ~60s. Built into BullMQ job options (`attempts`, `backoff`). |
| Partial send success handling | If Facebook fails but WhatsApp succeeds, record partial success | MEDIUM | Product `sent_at`, `facebook_at`, `instagram_at` are separate nullable columns — already modeled. Broadcaster service writes each independently. Circuit open = skip that channel, log warning. |
| Dead letter queue for failed jobs | Permanently failed jobs must not be silently dropped | LOW | BullMQ `failed` queue with configurable max attempts. Admin UI shows failed jobs with error reason. |
| Channel health status in UI | Users need to know if a channel is currently broken | LOW | Expose circuit breaker state (closed/open/half-open) per channel via `GET /api/channels/health`. Dashboard widget. |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Fallback message on channel failure | WhatsApp message sent with note "Facebook post failed" | LOW | Broadcaster service checks circuit state before send, appends delivery report to log. |
| Per-user breaker isolation | User A's broken Facebook token does not open breaker for User B | MEDIUM | Breaker keyed by `(userId, channelType)`, not global. Requires per-user circuit breaker instances in the channels service. Store state in Redis alongside BullMQ. |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Infinite retries with short delay | "Keep trying until it works" | Floods third-party API, triggers rate limiting or account ban | BullMQ `attempts: 5` with exponential backoff. After max attempts, move to dead letter. Alert user. |
| Synchronous channel delivery (request-response) | Simple to reason about | Blocks scheduler, no retry on failure, cascading timeout if one channel hangs | Async via BullMQ: scheduler enqueues job, broadcaster dequeues, channels service delivers. Already the planned architecture. |

---

### Category 5: User Role / Permission System (Multi-Tenant RBAC)

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Two-role model: admin / user | Standard for invite-only SaaS at this scale | LOW | Already implemented in v1. Admin: full access + user management. User: own data only. Enforced via JWT `role` claim in API gateway middleware. |
| Tenant-scoped resource ownership | User can only CRUD their own subjects/products/schedules | LOW | `WHERE user_id = req.user.id` on every data query. Microservices must re-implement this — it cannot live only in the API gateway. |
| JWT claims carry role + userId | Stateless auth compatible with microservices | LOW | JWT payload: `{ sub: userId, role: 'admin'|'user', email }`. Each service validates JWT independently (shared secret or public key). No session lookup on every request. |
| Admin user management (list, suspend, delete, promote) | Admin needs operational control | LOW | Already implemented in v1. Extract to user service. |
| Invite token scoped to email | Prevents invite link sharing | LOW | Already implemented in v1 invitations table. Token `used_at` enforces single-use. |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Permission check middleware at service layer | Defense in depth — not just gateway | LOW | Each microservice implements `requireOwnership(resourceType, resourceId)` check. Gateway validates JWT; service validates ownership. Two independent layers. |
| Audit log for admin actions | Compliance, debugging | LOW | Already have `logs` table. Log admin user_id + action + target_user_id on sensitive operations. |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Fine-grained RBAC (permissions per resource type per user) | Flexible access control | 5-table permission model, performance overhead, UI to manage it, testing surface doubled | Two roles is sufficient for this platform. Add granular RBAC only if enterprise customers with team accounts are added. |
| Permission check only at API gateway | Single enforcement point, simpler | If gateway is bypassed (direct service call, future internal tool), data leaks silently | Enforce at gateway AND at service layer for defense in depth. |
| OAuth scopes as permissions | Token-level granularity | Over-engineering for a 2-role system | Role in JWT claim. Scopes appropriate only if external API consumers are added. |

---

## Feature Dependencies

```
[JWT Auth Service]
    └──required by──> [All Microservices] (JWT validation in each service)
    └──required by──> [API Gateway] (JWT validation + routing)

[Per-User Credential Storage]
    └──requires──> [JWT Auth Service] (userId from token scopes the credential)
    └──required by──> [Channels Service] (retrieves Facebook/WhatsApp/Instagram tokens at send time)
    └──required by──> [AliExpress Products Service] (retrieves AliExpress API key)

[API Gateway]
    └──required by──> [Strangler Fig Migration] (route table switches monolith ↔ microservice)
    └──required by──> [Circuit Breaker visibility endpoint] (aggregates channel health)

[BullMQ + Redis]
    └──required by──> [Circuit Breaker Pattern] (per-user breaker state stored in Redis)
    └──required by──> [Broadcaster Service] (async job queue)
    └──required by──> [Dead Letter Queue] (failed job persistence)

[Strangler Fig Routing]
    └──requires──> [API Gateway] (traffic routing table)
    └──enhances──> [Feature Branch Deployment] (each service merged independently)

[Channels Service (circuit breaker)]
    └──requires──> [Per-User Credential Storage] (tokens fetched per send)
    └──requires──> [BullMQ] (async retry + dead letter)
    └──enhances──> [Broadcaster Service] (partial success per channel)
```

### Dependency Notes

- **All services require JWT Auth:** The auth service must be the first microservice extracted from the monolith. Every other service depends on JWT validation.
- **Credential storage requires auth:** Credentials are scoped by `userId` derived from JWT. Auth service must be live before credential service can be standalone.
- **Circuit breaker requires BullMQ:** Retry logic and dead-letter handling live in the BullMQ job options. Standing up BullMQ + Redis is a prerequisite for the channels service circuit breaker.
- **Strangler Fig requires API gateway:** The routing table that switches monolith ↔ microservice traffic must exist before any service is extracted. Gateway is phase 1.
- **Per-user breaker isolation requires Redis:** Global breaker state in process memory does not work in multi-process deployments. Redis-backed state (via `opossum` stats + BullMQ) required.

---

## MVP Definition

This is a rebuild milestone, not a greenfield MVP. "Launch with" means: minimum scope to have the microservices architecture running in production alongside the monolith.

### Launch With (v2.0 core)

- [ ] API Gateway with JWT validation and route table (Strangler Fig prerequisite)
- [ ] Auth service: Google OAuth → JWT, invite flow (replaces Passport.js session auth)
- [ ] Per-user credential storage with AES-256-GCM encryption (user service)
- [ ] Two-role RBAC enforced at gateway + service layer (admin/user)
- [ ] At least one extracted microservice (subjects or products) running in parallel with monolith
- [ ] BullMQ + Redis replacing direct cron → workflow coupling
- [ ] Circuit breakers on Facebook and WhatsApp channel adapters (opossum v9)

### Add After First Stable Service (v2.0 continued)

- [ ] All remaining services extracted one at a time (AI writer, scheduler, broadcaster, products, subjects)
- [ ] Dead letter queue UI in admin dashboard
- [ ] Channel health status endpoint + UI widget
- [ ] Credential validation on save (call provider verify endpoint)

### Future Consideration (v2.x)

- [ ] Per-user circuit breaker isolation (Redis-backed, keyed by userId+channel)
- [ ] Credential health background checker
- [ ] Admin impersonation / act-as-user
- [ ] Canary traffic split with weighted routing
- [ ] Automated rollback on error rate spike

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| JWT stateless auth service | HIGH | MEDIUM | P1 |
| AES-256-GCM credential storage | HIGH | LOW | P1 |
| API gateway + Strangler Fig routing | HIGH | MEDIUM | P1 |
| Tenant isolation (user_id FK everywhere) | HIGH | LOW | P1 |
| BullMQ async job queue | HIGH | MEDIUM | P1 |
| Circuit breaker per channel | HIGH | MEDIUM | P1 |
| Two-role RBAC (admin/user) | HIGH | LOW | P1 |
| Dead letter queue + failed job UI | MEDIUM | LOW | P2 |
| Channel health status in dashboard | MEDIUM | LOW | P2 |
| Credential validation on save | MEDIUM | MEDIUM | P2 |
| Per-user breaker isolation in Redis | MEDIUM | MEDIUM | P2 |
| Credential rotation audit log | LOW | LOW | P2 |
| Credential health background checker | LOW | MEDIUM | P3 |
| Admin impersonation | LOW | HIGH | P3 |
| Canary traffic split | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have — microservices rebuild does not ship without these
- P2: Should have — add during service extraction phases
- P3: Nice to have — v2.x

---

## Sources

- [AWS Prescriptive Guidance: Strangler Fig Pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html)
- [microservices.io: Strangler Application Pattern](https://microservices.io/patterns/refactoring/strangler-application.html)
- [Opossum circuit breaker for Node.js (v9.x)](https://github.com/nodeshift/opossum)
- [Red Hat: Fail fast with Opossum](https://developers.redhat.com/blog/2021/04/15/fail-fast-with-opossum-circuit-breaker-in-node-js)
- [BullMQ docs](https://docs.bullmq.io/)
- [WorkOS: Multi-tenant RBAC design](https://workos.com/blog/how-to-design-multi-tenant-rbac-saas)
- [OWASP Node.js cryptography practices](https://www.nodejs-security.com/blog/owasp-nodejs-authentication-authorization-cryptography-practices)
- [Flagsmith: Deployment strategies and feature flags](https://www.flagsmith.com/blog/deployment-strategies)

---

*Feature research for: Affiliate Heaven v2.0 — Microservices Rebuild*
*Researched: 2026-04-29*
