# Pitfalls Research

**Domain:** Microservices extraction of a Node.js broadcast/scheduling monolith (Strangler Fig)
**Researched:** 2026-04-29
**Confidence:** HIGH (architecture pitfalls), MEDIUM (BullMQ idempotency specifics, encryption rotation), LOW (Mantine Hebrew edge cases — limited public documentation)

---

## Critical Pitfalls

### Pitfall 1: Strangler Fig with Shared Database — Two Deployments, One Logical System

**What goes wrong:**
The monolith and a new microservice both write to the same PostgreSQL tables. They appear independent but are tightly coupled at the data layer. Concurrent writes race, constraint violations surface unpredictably, and rolling back one service's schema is impossible without breaking the other.

**Why it happens:**
The shortest path to extracting a service is "point it at the existing DB." Developers move on before data ownership is resolved.

**How to avoid:**
- Each extracted service must own its tables. No cross-service foreign keys in production.
- During the transition window, the new service reads from the monolith via API, not direct DB access.
- Only promote a service to "owns its data" after its tables are migrated and the monolith has stopped writing to them.
- Enforce this with separate DB credentials per service (Railway supports multiple DB users) — the scheduler service's Postgres user simply cannot write to the products table.

**Warning signs:**
- Two services both have `import { db } from '../../db'` pointing to the same pool.
- A migration run by one service breaks another service's queries.
- `sort_order` conflicts, duplicate `sent_at` marks — the existing `workflow.js` partial-failure bug (CONCERNS.md line 28) will resurface in worse form if two services can mark a product sent.

**Phase to address:**
Phase 1 (Monorepo & Infrastructure). Define data ownership boundaries in the schema design before any service is extracted. Enforce separate DB credentials per service from day one.

---

### Pitfall 2: BullMQ Retry Loops Causing Duplicate Broadcasts

**What goes wrong:**
A BullMQ job sends a product to Facebook, then the job fails (network timeout, uncaught error) after the Facebook API accepted the request. BullMQ retries the job. Facebook receives the post twice. WhatsApp receives the message twice. The product is marked sent twice.

**Why it happens:**
BullMQ's at-least-once delivery guarantee means a job that fails after side effects are produced will be retried. Without external idempotency guards, the side effect (posting to Facebook, sending to WhatsApp) happens again on each retry.

**How to avoid:**
1. **Job-level deduplication:** Give every broadcast job a deterministic ID: `broadcast:${productId}:${subjectId}`. BullMQ ignores duplicate job IDs already in the queue.
2. **DB idempotency guard before each platform send:** Before calling Facebook, check `SELECT sent_facebook_at FROM products WHERE id = $1`. If already set, skip. This survives even if the job ID dedup is bypassed.
3. **Per-platform sent flags, not a single `sent` flag:** The existing v1 bug (CONCERNS.md line 29) of marking sent even if only one platform succeeded must not be carried forward. Each platform gets its own timestamp column (`sent_wa_at`, `sent_facebook_at`, `sent_instagram_at`).
4. **Use AES-256-GCM AEAD for job payloads that carry credentials** — if a job payload contains decrypted credentials, a retry that logs the payload leaks them. Store only `credentialId` in the payload; decrypt fresh on each attempt.

**Warning signs:**
- A user reports seeing duplicate Facebook posts.
- `logs` table shows the same product sent twice within minutes.
- Job status in BullMQ dashboard shows `failed → retrying` on broadcast jobs.

**Phase to address:**
Phase: Broadcaster Service extraction. Must be addressed before enabling BullMQ retries (`attempts > 1`). Never enable retries without first implementing the DB idempotency guard.

---

### Pitfall 3: Silent Divergence Between Monolith and New Service During Strangler Fig Transition

**What goes wrong:**
The monolith's `workflow.js` and the new broadcaster-service implement the same product-send pipeline independently. A bug fix applied to `workflow.js` is never ported to the broadcaster-service. A feature flag disables the monolith path, but the broadcaster-service path has never been tested at scale. The transition window extends for months. By merge time, both codepaths have diverged silently.

**Why it happens:**
Feature branch experiments have no hard time limit. The "if not stable, fall back to monolith" safety valve makes it easy to defer a difficult merge indefinitely.

**How to avoid:**
- Set a hard merge deadline per service branch: **if not merged within 3 weeks of first commit, branch is deleted and work restarts as incremental commits to main.**
- Run both codepaths in parallel during transition and compare outputs (shadow mode): monolith sends first, broadcaster-service sends to a test channel, results are diff'd.
- Any bug fix to `workflow.js` during the transition window gets a TODO comment: `// SYNC TO broadcaster-service branch`.
- The Broadcaster service branch must include a test that exercises the full pipeline with mocked external APIs — the test is the merge gate.

**Warning signs:**
- Branch age > 2 weeks with no PR opened.
- `git diff main...feature/broadcaster-service` shows changes to files the monolith also modified.
- `workflow.js` received commits while the feature branch was open.

**Phase to address:**
Phase 0 (Planning). Document the merge deadline policy before any service branch is opened. Enforce via PR description template that includes "Branch opened: [date], merge deadline: [date + 21 days]."

---

### Pitfall 4: Drizzle Migrations Locking Live Tables

**What goes wrong:**
Drizzle generates an `ALTER TABLE products ALTER COLUMN type SET NOT NULL` or `RENAME COLUMN sent TO sent_wa_at`. On PostgreSQL, these operations acquire an ACCESS EXCLUSIVE lock that blocks all reads and writes for the duration. At 2 AM on Railway's shared instance this might be 200ms; during peak traffic it causes cascading 500 errors and connection timeouts.

**Why it happens:**
`drizzle-kit generate` produces safe-looking SQL. Developers `drizzle-kit migrate` on production without verifying each statement. The monolith's `db/migrate.js` used `CREATE TABLE IF NOT EXISTS` which is genuinely safe — but Drizzle's column change statements are not.

**How to avoid:**
- **Audit every generated migration file before running on production.** Treat Drizzle's output as a draft, not as a final script.
- Apply the **expand-contract pattern**: never rename or make NOT NULL in one step.
  - Step 1: Add new nullable column (`sent_wa_at`), deploy new code that writes to both.
  - Step 2: Backfill old data.
  - Step 3: Add NOT NULL constraint (safe once column is populated).
  - Step 4: Drop old column after old code is gone.
- Add indexes with `CREATE INDEX CONCURRENTLY` — Drizzle does not do this by default; write custom migration files for indexes.
- Test migrations on a Railway staging DB that is a replica of production before running on prod. Railway's fork feature makes this cheap.

**Warning signs:**
- Generated migration contains `DROP COLUMN`, `RENAME COLUMN`, or `ALTER COLUMN ... SET NOT NULL` on a table with >1000 rows.
- Migration runs during the same deploy that changes application code (no backward-compatible window).
- `db/migrate.js` called unconditionally at app startup — any new deploy triggers migration with zero review.

**Phase to address:**
Phase 1 (Monorepo & DB Schema). Establish the migration review process before the first Drizzle schema is written. The startup-time migration call must be gated behind a `RUN_MIGRATIONS=true` env var, not automatic.

---

### Pitfall 5: JWT Secret Rotation Invalidating All Active Users

**What goes wrong:**
`JWT_SECRET` is rotated (security policy, key compromise suspicion, or accident). All existing access tokens signed with the old secret become invalid immediately. Every logged-in user gets a 401 on their next request. They're silently logged out. For a scheduled system, in-flight broadcasts that use service-to-service JWTs also fail.

**Why it happens:**
Single-secret JWT systems have no graceful rotation path. Rotating the secret is a binary flag: all old tokens are invalid instantly.

**How to avoid:**
- Use **key ID (`kid`) header** in JWTs and maintain a key registry: `{ kid: "v2": secret, kid: "v1": secret_old }`.
- During rotation: issue new tokens signed with `v2`, keep `v1` in the registry for the remaining max token TTL (e.g., 15 minutes for access tokens).
- After TTL window passes: remove `v1` from registry. All valid tokens are now `v2`.
- For service-to-service tokens (scheduler → broadcaster): use short-lived tokens (5 min) so rotation window is small.
- Never store the JWT secret directly in env — use Railway's secret management; rotate via Railway dashboard without a code deploy.

**Warning signs:**
- `JWT_SECRET` is a plain string in `.env` with no versioning.
- Token verification uses a hardcoded `process.env.JWT_SECRET` with no `kid` lookup.
- No test for "old token still works during rotation window."

**Phase to address:**
Phase 2 (Auth Service). Implement `kid`-based key registry from day one. This is much harder to retrofit after services are deployed.

---

### Pitfall 6: AES-256 Encryption Key Rotation Leaving Orphaned Encrypted Records

**What goes wrong:**
`ENCRYPTION_KEY` is rotated (compromise, periodic policy). The new key is set in Railway env. Old encrypted credential records (Facebook tokens, AliExpress API keys) were encrypted with the old key. Decryption fails for all existing credentials. Users can no longer broadcast until they re-enter all credentials manually.

**Why it happens:**
Simple encrypt/decrypt implementations use a single global key. When the key changes, all existing ciphertext is permanently inaccessible.

**How to avoid:**
- Use **envelope encryption**: each credential record stores its own encrypted data key (EDK) alongside the ciphertext. The EDK is encrypted with the master key. To rotate: re-encrypt all EDKs with the new master key — the ciphertext itself doesn't change.
- Alternatively, use a **key version column**: store `key_version` alongside each encrypted credential. On read, use `ENCRYPTION_KEY_V1` or `ENCRYPTION_KEY_V2` based on the column. On write, always use the current version. Run a background migration to re-encrypt old records.
- Use **AES-256-GCM** (authenticated encryption), not AES-256-CBC. GCM detects tampering; CBC does not. A corrupted or tampered record with CBC silently decrypts to garbage.
- Store the IV/nonce per-record, never reuse.

**Warning signs:**
- `ENCRYPTION_KEY` is a single env var with no versioning mechanism.
- `crypto.createCipheriv('aes-256-cbc', ...)` — if CBC is used, upgrade to GCM.
- No migration script exists to re-encrypt existing records under a new key.

**Phase to address:**
Phase 2 (User Service / Credential Storage). The encryption scheme must be designed with rotation in mind before any credentials are stored in production. Retrofit is expensive (requires decrypting all records with old key while old key is still available).

---

### Pitfall 7: pnpm Workspace TypeScript Path Resolution Diverging Between tsc and Runtime

**What goes wrong:**
TypeScript compiles cleanly with `paths` aliases like `@affiliate/shared`. But at runtime (Node.js), the path alias is not resolved — Node.js doesn't know about `tsconfig.json`. The service crashes with `Cannot find module '@affiliate/shared'`. Or worse: it resolves at compile time but picks up a stale compiled `.js` file in `dist/` instead of the live source.

**Why it happens:**
TypeScript `paths` only affect type checking and compilation. They are not module resolution for Node.js. This disconnect is common in fresh monorepo setups.

**How to avoid:**
- Treat workspace packages as proper npm packages: each package in `packages/` has its own `package.json` with `name: "@affiliate/shared"` and a `main`/`exports` field pointing to `dist/index.js` (or `src/index.ts` with `tsx`).
- Use pnpm workspace protocol (`"@affiliate/shared": "workspace:*"`) in consuming packages. pnpm installs a symlink — Node.js resolves it without needing `paths`.
- Avoid duplicate `@/` aliases across packages. Each package's tsconfig should only define aliases for its own internal paths, not workspace packages.
- For Vitest: configure `resolve.alias` in `vitest.config.ts` to mirror workspace resolution.
- Never rely on `tsconfig-paths` at runtime in production — it's a dev crutch that papers over the underlying issue.

**Warning signs:**
- `module not found` errors that only occur when running `node dist/index.js` but not `tsx src/index.ts`.
- `packages/shared/dist/` is missing or stale after a change to shared source.
- `tsconfig.json` has `paths` pointing to `../../packages/shared/src` — this works with `tsx` but breaks with compiled output.

**Phase to address:**
Phase 1 (Monorepo Scaffold). The workspace resolution strategy must work end-to-end before any services are added. Validate with a simple cross-package import test as part of the scaffold acceptance criteria.

---

### Pitfall 8: Instagram Container Polling Blocking the Broadcast Queue

**What goes wrong:**
The existing `instagram.js` has a synchronous 30-second blocking poll (CONCERNS.md line 115). In the new broadcaster-service, this becomes a BullMQ worker that holds a job active for 30+ seconds. During this time, the worker concurrency slot is consumed. If multiple products target Instagram simultaneously, the queue stalls.

**Why it happens:**
The polling logic is carried over from the monolith without adapting it to the async job model.

**How to avoid:**
- Extract Instagram publishing into a two-phase job: `instagram:create-container` (immediate, fast) and `instagram:publish-container` (retried after delay).
- Use BullMQ's `delay` option to schedule the publish-container job 30 seconds after container creation, rather than polling in-process.
- Set worker concurrency to match expected Instagram throughput; do not share a worker pool between fast jobs (WhatsApp webhook) and slow jobs (Instagram polling).

**Warning signs:**
- Worker logs show jobs in `active` state for >30 seconds.
- BullMQ dashboard shows queue depth growing while workers appear busy.
- Instagram failures (container not ready) cause the whole broadcast job to fail and retry, re-sending WhatsApp/Facebook.

**Phase to address:**
Phase: Channels Service. The two-phase Instagram pattern must be designed before the broadcaster service consumes Instagram jobs.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Run Drizzle migrations automatically on startup | No manual deploy step | Any bad migration runs in production with zero review window | Never in production. Gate behind `RUN_MIGRATIONS=true` env var |
| Single `ENCRYPTION_KEY` with no version | Simple implementation | Key rotation requires decrypting all records while old key is still accessible; any window of unavailability loses access | Never. Version from day one |
| Share the PostgreSQL pool between monolith and new service during transition | Fast to set up | Race conditions, schema lock conflicts, can't migrate tables independently | Never. Use API calls across the boundary instead |
| Long-lived feature branch per service (>3 weeks) | Isolated experiment | Divergence from main, merge conflicts compound, monolith fixes not reflected | Acceptable only if branch is rebased on main daily and has a hard deadline |
| Use `aes-256-cbc` for credential encryption | Simpler to implement | No authentication tag — corrupted/tampered data decrypts silently to garbage | Never for new code. Migrate existing CBC to GCM in the User Service phase |
| Single JWT secret, no `kid` | Simple token verification | Any rotation invalidates all sessions instantly, no graceful migration | Never for a multi-user production system |
| `workspace:*` packages without `dist/` (source-only) | No build step in dev | Vitest and tsc work, but production Node.js can't run without a build step | Acceptable during development only; build step required before any production deploy |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| BullMQ + Facebook Graph API | Assume job failure means send didn't happen — retry without idempotency check | Check `sent_facebook_at` in DB before calling Facebook on every attempt, including first |
| BullMQ + WhatsApp MacroDroid webhook | Retry on network error — webhook may have already accepted the request | Use a per-job `sent_wa_at` DB flag; treat 2xx webhook response as "accepted" not "delivered" |
| Drizzle + Railway PostgreSQL | Run `drizzle-kit push` directly against production | Always generate migration files (`drizzle-kit generate`), review SQL, then run via `drizzle-kit migrate` with explicit confirmation |
| JWT + Google OAuth | Re-issue JWT on every OAuth callback without checking if user already has active tokens | OAuth callback should check for existing active tokens; refresh token flow for silent renewal |
| pnpm workspaces + Docker | `pnpm install` in service Dockerfile without hoisting config | Copy `pnpm-workspace.yaml` and `pnpm-lock.yaml` from root; install from root, not per-service |
| Mantine + RTL + Hebrew | Set `dir="rtl"` only on the document body, forgetting `DirectionProvider` wrapper | Wrap with `<DirectionProvider initialDirection="rtl">` — Mantine's CSS variables for RTL need this context to activate |
| AES-256-GCM + PostgreSQL | Store IV/nonce as separate column | Store as a single concatenated binary blob `iv + tag + ciphertext` — simpler to migrate and impossible to accidentally separate |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Instagram blocking poll in BullMQ worker | Queue stalls; worker busy for 30s per job | Two-phase job (create → delay → publish) | At 2+ concurrent Instagram sends |
| Broadcasting all subjects in a single BullMQ job | One subject's failure blocks others; retry re-sends all platforms for all subjects | One job per subject per schedule tick | At 3+ active subjects |
| Drizzle N+1: loading products then subjects in a loop | Slow product list page, DB connection exhaustion | Use JOIN in Drizzle query or `inArray` batch load | At 50+ products |
| Single Redis instance for BullMQ with no persistence | Queue contents lost on Redis restart; scheduled jobs disappear | Enable Redis AOF persistence; use Railway Redis with persistence enabled | On any Redis restart |
| PostgreSQL pool exhaustion in monorepo with multiple services sharing one DB | Random query timeouts, `remaining connection slots are reserved` errors | Separate pool per service; use PgBouncer or Railway's connection pooler | At 3+ services active simultaneously |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging job payloads that contain decrypted credentials | Credentials visible in BullMQ dashboard and log files | Store only `credentialId` in job payload; decrypt at worker execution time |
| JWT with no expiry (`expiresIn` omitted) | Stolen token valid forever | Always set `expiresIn`; access tokens 15 min, refresh tokens 30 days |
| Symmetric JWT secret stored in plain `.env` without key versioning | Rotation causes immediate mass 401 | Use `kid`-versioned key registry; store secrets in Railway secret manager |
| AES-256-CBC without authentication tag | Silent decryption of tampered data — attacker can flip bits | Use AES-256-GCM; validate authentication tag before accepting decrypted value |
| Service-to-service calls without JWT validation | Any service can call any other service on the internal network | API Gateway validates JWT for all inter-service calls; services do not trust caller identity without a token |
| Sensitive credential fields returned from API responses | Facebook tokens, AliExpress keys leak to frontend | The existing `stripSensitive()` pattern (CONCERNS.md line 75) must be enforced in all new service endpoints — add middleware-level response auditing |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent broadcast failure — job fails in BullMQ, user sees nothing | User thinks product was sent when it wasn't; re-sends manually creating duplicates | Show per-platform delivery status in the product list; surface BullMQ job failures as dashboard alerts |
| RTL layout breaks on number-only fields (prices, counts) | Hebrew users see numbers in wrong direction | Use `dir="ltr"` on number-only inputs within RTL context; test with actual Hebrew content |
| Dark mode flash on first load (SSR or localStorage hydration race) | White flash on page load in dark environments | Use Mantine's `ColorSchemeScript` in `<head>` to inject color scheme before React hydrates |
| Credentials form shows "saved" even if encryption failed | User believes credentials are stored; sends fail silently | Validate that the encrypted value can be decrypted before confirming save |
| Scheduler shows "next run" in UTC when user is in Asia/Jerusalem | User confused about when sends will happen | Display all times in `Asia/Jerusalem` (existing v1 behavior); validate timezone rendering in Mantine date components |

---

## "Looks Done But Isn't" Checklist

- [ ] **BullMQ idempotency:** Job has deterministic ID AND DB-level sent-flag check before each external API call — verify both, not just one.
- [ ] **Credential encryption:** Each record has its own IV/nonce stored alongside ciphertext, and `key_version` column exists — verify with a round-trip encrypt/decrypt test in CI.
- [ ] **JWT rotation:** `kid` header is present in every issued token AND the key registry is checked on verification — verify by rotating key in test env and confirming existing tokens still validate during grace period.
- [ ] **Drizzle migrations:** All generated SQL files have been manually reviewed for dangerous operations before being committed — verify by checking git history for unreviewed migration files.
- [ ] **pnpm workspace resolution:** Cross-package import works in both `tsx src/index.ts` (dev) AND `node dist/index.js` (prod) — verify in Docker Compose, not just local dev.
- [ ] **Strangler Fig data boundary:** New service has its own DB credentials that cannot write to monolith tables — verify by attempting a cross-boundary write from the new service's credentials (it should fail with permission denied).
- [ ] **Instagram two-phase publish:** `sent_instagram_at` is only set after `publish` succeeds, not after `create-container` — verify by interrupting after container creation and confirming the record is not marked sent.
- [ ] **RTL + Mantine:** `DirectionProvider` wraps the entire app, `dir="rtl"` is on `<html>`, and `postcss-preset-mantine` is configured — verify by checking computed CSS direction on a Mantine `TextInput`.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Shared DB causes split-brain after service extraction | HIGH | Freeze writes from one service; audit conflict rows; reconcile manually; enforce credentials boundary before unfreezing |
| Duplicate Facebook/WhatsApp sends due to missing idempotency | MEDIUM | Mark affected products as sent in DB; notify users; add idempotency guard; redeploy; no automated rollback possible for external sends |
| JWT rotation mass 401 | MEDIUM | Roll back `JWT_SECRET` to old value in Railway env; redeploy; plan proper `kid`-based rotation before next attempt |
| Encryption key rotation leaves inaccessible records | HIGH | If old key is still available: write one-shot migration script to re-encrypt all records; if old key is gone: users must re-enter credentials |
| Drizzle migration locks table in production | MEDIUM | Railway supports point-in-time recovery — restore to pre-migration snapshot; fix migration using expand-contract pattern; re-run |
| Long-lived branch unmergeable due to divergence | MEDIUM | Cherry-pick only net-new functionality onto a fresh branch from main; discard diverged branch entirely |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Shared database during Strangler Fig | Phase 1 — Monorepo & DB Schema | New service's Postgres user cannot write to monolith tables (verified with permission test) |
| BullMQ duplicate sends | Phase: Broadcaster Service | Idempotency test: kill job after Facebook call, retry, confirm no duplicate post |
| Silent branch divergence | Phase 0 — Planning / Process | PR template includes merge deadline; branch age > 21 days triggers automatic close |
| Drizzle migration locks live table | Phase 1 — Monorepo & DB Schema | Migration review checklist in PR template; CI lints for `DROP COLUMN` / `RENAME COLUMN` in migration files |
| JWT rotation invalidates all sessions | Phase 2 — Auth Service | Rotation test: rotate key in staging, confirm existing tokens valid during grace period |
| AES-256 key rotation orphans records | Phase 2 — User Service | Round-trip test with `key_version` rotation in CI; verify old-version records still decrypt |
| pnpm TypeScript path resolution | Phase 1 — Monorepo Scaffold | Cross-package import test runs in Docker Compose (production-like) as part of scaffold acceptance |
| Instagram blocking poll | Phase: Channels Service | Queue depth test: 5 concurrent Instagram jobs complete without worker stall |

---

## Sources

- [Strangler Fig — AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html)
- [BullMQ Idempotent Jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [BullMQ Deduplication](https://docs.bullmq.io/guide/jobs/deduplication)
- [BullMQ Job IDs](https://docs.bullmq.io/guide/jobs/job-ids)
- [JWTs in Microservices: Key Rotation and Session Invalidation](https://techblogsbypallavi.medium.com/jwts-in-microservices-how-to-rotate-keys-and-invalidate-sessions-cleanly-db30c1110fd7)
- [Drizzle ORM — Zero-Downtime Migrations](https://dev.to/whoffagents/zero-downtime-postgres-migrations-with-drizzle-orm-22ga)
- [3 Biggest Mistakes with Drizzle ORM](https://medium.com/@lior_amsalem/3-biggest-mistakes-with-drizzle-orm-1327e2531aff)
- [keyring-node — AES key rotation for Node.js](https://github.com/fnando/keyring-node)
- [Mantine RTL Support](https://mantine.dev/styles/rtl/)
- [Saga Pattern in Microservices](https://microservices.io/patterns/data/saga.html)
- [pnpm Workspaces](https://pnpm.io/workspaces)
- [Managing TypeScript Packages in Monorepos — Nx Blog](https://nx.dev/blog/managing-ts-packages-in-monorepos)
- Codebase audit: `/Users/davids/Development/Learning/affiliate-heaven/.planning/codebase/CONCERNS.md`

---
*Pitfalls research for: Affiliate Heaven v2.0 — Microservices Rebuild (Strangler Fig)*
*Researched: 2026-04-29*
