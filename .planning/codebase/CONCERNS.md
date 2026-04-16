# Codebase Concerns

**Analysis Date:** 2026-04-15

## Tech Debt

**Dual Data Store Architecture:**
- Issue: Data stored in both PostgreSQL (primary) and Google Sheets (legacy). Sync logic is distributed across multiple files, causing potential inconsistency.
- Files: `services/googleSheets.js`, `services/workflow.js`, `routes/scrape.js`, `db/migrate-subjects-from-sheets.js`
- Impact: Products can be out of sync between systems. If a product is updated in one store but not the other, sends may use stale data or fail.
- Fix approach: Complete migration to PostgreSQL-only. Remove all Google Sheets write operations from `addProduct()`, `markSent()`, and `appendLogs()`. Keep Sheets integration read-only for legacy import if needed.

**Monolithic Frontend (2254 lines):**
- Issue: `public/app.js` contains all UI logic in a single unstructured file with inline event handlers and global state management.
- Files: `public/app.js`
- Impact: Hard to test, maintain, and extend. New features require large diffs. Difficult to reason about state flow.
- Fix approach: Refactor into ES modules with clear separation: `modules/auth.js`, `modules/products.js`, `modules/dashboard.js`, `modules/logs.js`, etc. Extract state management into a simple store pattern.

**Inline Logging in Services:**
- Issue: Services use `console.log()` directly instead of a consistent logging abstraction. Some services call `workflow.log()` (workflow.js), others use `console.log()`.
- Files: `services/facebook.js`, `services/instagram.js`, `services/whatsapp.js`, `services/googleSheets.js`, `services/openai.js`, `scheduler/index.js`
- Impact: Logs scattered across console and SSE stream. No way to route different log levels or services to different outputs. Hard to debug in production.
- Fix approach: Create `services/logger.js` with levels (info, warn, error). All services should import and use this. Wire it to SSE in server.js.

**Missing Error Boundaries in Async Workflows:**
- Issue: `workflow.run()` has try-catch blocks but partial failures are not graceful. If Facebook fails, product is still marked as sent for WhatsApp. If Instagram fails after WhatsApp succeeds, the database update logic doesn't clearly convey which platforms actually succeeded.
- Files: `services/workflow.js` (lines 232-280)
- Impact: Products may be marked sent even if only 1 of 3 platforms succeeded. Clients can't easily know which platform failed.
- Fix approach: Change mark sent logic to only update platforms that succeeded. Return detailed per-platform success/failure in response. Never mark sent_at if sendWA=true but whatsapp failed.

**Hardcoded Environment Fallbacks:**
- Issue: Many services have inline fallback logic for missing env vars (e.g., `process.env.FACEBOOK_PAGE_ID || process.env.FACEBOOK_ACCESS_TOKEN`).
- Files: `services/facebook.js`, `services/instagram.js`, `services/whatsapp.js`, `server.js`
- Impact: Difficult to validate configuration at startup. Silent failures when vars are missing. Unclear which env vars are actually required.
- Fix approach: Create `services/config.js` that validates all required env vars on startup with clear error messages. Throw early if config is incomplete.

---

## Known Bugs

**Facebook Token Expiration Not Enforced:**
- Symptoms: Facebook operations fail silently when token expires. UI shows token status but doesn't block sends if expired.
- Files: `services/facebook.js` (getTokenInfo function doesn't throw on expiry), `public/app.js` (token warning is display-only)
- Trigger: Token expires, scheduled send runs, fails silently because token is invalid
- Workaround: Manually refresh token via `/api/facebook/refresh-token` route, but this is manual and easily forgotten

**Instagram Container Status Polling Fragile:**
- Symptoms: Instagram posts fail with "container was not ready after 30 seconds" even when image is valid. Polling loop doesn't handle rate limiting or temporary API errors well.
- Files: `services/instagram.js` (lines 47-70)
- Trigger: Peak API traffic or slow image processing by Instagram
- Cause: Fixed 10 polls at 3-second intervals (30s total) may not be enough for Instagram to process image. No exponential backoff. Catches generic errors but doesn't distinguish rate limit from real failure.
- Workaround: None. Posts fail completely.

**Product Sort Order Not Enforced as Primary Key:**
- Symptoms: Manual reordering (shuffle button) relies on sort_order column, but NULL values sort last. If multiple products have same sort_order, order is non-deterministic.
- Files: `routes/products.js` (lines 38-39, 47-48), `services/workflow.js` (lines 35-48)
- Trigger: When products are inserted without explicit sort_order, or shuffle is interrupted
- Cause: `NULLS LAST` in ORDER BY is correct but doesn't handle ties. Database doesn't enforce UNIQUE(sort_order, user_id).
- Workaround: Manually re-shuffle to fix

**Race Condition in Log Flush:**
- Symptoms: If server crashes between SSE log emission and 60-second flush interval, recent logs are lost.
- Files: `server.js` (lines 186-190, 193-198)
- Trigger: Server crash, process kill, or power loss
- Cause: Logs are kept in-memory (`_pendingLogs`) and flushed asynchronously every 60 seconds. No guarantee logs are persisted before shutdown.
- Workaround: Manual log export via `/api/logs/history` before shutdown

---

## Security Considerations

**Sensitive Fields Not Stripped from All Responses:**
- Risk: API_TOKEN and facebook_token values could leak if not carefully filtered in every response. Currently `stripSensitive()` is used in subjects route but not consistently in all endpoints returning subject data.
- Files: `routes/subjects.js` (line 35), `services/subjectService.js` (stripSensitive function), `routes/products.js`, `routes/schedules.js`
- Current mitigation: `stripSensitive()` replaces token values with boolean presence flags in subjects route. But products route returns subject_id without checking sensitive fields.
- Recommendations: (1) Ensure all endpoints that return subject data call stripSensitive(). (2) Create middleware that audits API responses for leaked tokens (regex check for patterns like `sk-`, `pk_`, base64 blobs).

**Session Secret Weak in Dev:**
- Risk: `server.js` line 20 defaults to `'dev-secret-change-in-prod'` if SESSION_SECRET not set. If this code path is used in production, sessions are not cryptographically secure.
- Files: `server.js` (line 20)
- Current mitigation: Comment says "change-in-prod" but no validation
- Recommendations: (1) Throw error if SESSION_SECRET not set AND NODE_ENV='production'. (2) Use strong default (generate if missing).

**No Rate Limiting on Webhooks:**
- Risk: WhatsApp/MacroDroid webhook endpoints and internal `/api/send` endpoints are not rate-limited. A user (or compromised token) could trigger thousands of sends in seconds, causing API quota exhaustion.
- Files: `routes/send.js`, `routes/scrape.js`
- Current mitigation: None
- Recommendations: (1) Add rate limiting middleware (e.g., express-rate-limit) with per-user limits. (2) Set max 10 sends/minute per user. (3) Queue long-running sends if limit exceeded.

**Invite Token Validation Timing:**
- Risk: Invite tokens are validated in passport callback (`server.js` line 49-52) but token is marked used only after user creation. If user creation fails, token is wasted but may not be marked used.
- Files: `server.js` (lines 46-58)
- Current mitigation: Try-catch wraps entire OAuth callback
- Recommendations: Move markUsed() to separate step after successful user creation. Or use database transaction.

**No CSRF Protection on State-Changing Endpoints:**
- Risk: POST endpoints like `/api/products` and `/api/send/execute` don't verify CSRF tokens. If attacker tricks user into visiting malicious site, user's session could be used to send products.
- Files: All routes under `/api/*` that use POST/PUT/DELETE
- Current mitigation: Session cookie has same-site implicit, but no explicit CSRF middleware
- Recommendations: Add express-csrf or manually implement CSRF token validation on all state-changing endpoints.

---

## Performance Bottlenecks

**Google Sheets API Calls Unoptimized:**
- Problem: `getAllProducts()` fetches entire sheet range A2:L every call. If sheet has 5000+ rows, this is slow (5-10s).
- Files: `services/googleSheets.js` (lines 43-80)
- Cause: No caching, no pagination, full read on every request
- Improvement path: (1) Cache entire sheet in memory with 5-minute TTL. (2) Implement incremental updates via changes API if Sheets supports it. (3) Migrate to PostgreSQL completely (reduces to fast DB query).

**Instagram Container Polling Synchronous:**
- Problem: 30-second blocking poll waits for Instagram image processing before continuing. During this time, other requests are held up.
- Files: `services/instagram.js` (lines 47-70)
- Cause: No async job queue or webhook callback for when container is ready
- Improvement path: (1) Return job ID immediately, poll in background. (2) Set up Instagram webhook to notify when ready. (3) Increase max polls to 20 (60s) with exponential backoff.

**Workflow Log History Limited to 500 in Memory:**
- Problem: Only last 500 logs kept in memory. If load increases, logs are lost between SSE client connects.
- Files: `server.js` (lines 150-164)
- Cause: In-memory circular buffer design
- Improvement path: (1) Fetch initial 500 from Google Sheets on SSE client open. (2) Implement proper log rotation to a file or database. (3) Consider time-window instead of count (last 5 minutes of logs).

**No Database Connection Pooling Tuning:**
- Problem: PostgreSQL pool created with defaults. If many concurrent requests hit database, pool may become exhausted (default max 10 connections).
- Files: `db/index.js` (lines 3-6)
- Cause: Default pg.Pool config
- Improvement path: (1) Set `max: 20` to handle more concurrent clients. (2) Monitor pool usage. (3) Add connection timeout and retry logic.

---

## Fragile Areas

**Workflow State Machine:**
- Files: `services/workflow.js`
- Why fragile: Complex async orchestration with multiple external API calls. Partial failures are hard to reason about. If one platform fails mid-send, state is unclear.
- Safe modification: (1) Add comprehensive logging at each step. (2) Wrap each API call (WhatsApp, Facebook, Instagram) in try-catch with unique error codes. (3) Use structured results object that clearly shows which steps succeeded/failed.
- Test coverage: Only logs are tested indirectly. No unit tests for workflow.run() with mocked APIs.

**Cron Schedule Execution:**
- Files: `scheduler/index.js`
- Why fragile: Cron jobs are stored in memory (activeJobs Map). If schedule is created, app restarts, schedule is lost until explicitly reloaded.
- Safe modification: (1) Persist schedule enable/disable state in DB (already done). (2) Always call startAll() on app startup. (3) Don't allow hot updates to cron without restart (or handle carefully with stop/restart).
- Test coverage: No tests for scheduler. Cron expressions are validated but not tested with actual time progression.

**User Cache Invalidation:**
- Files: `services/userService.js` (lines 3-19)
- Why fragile: In-memory cache with 60s TTL can cause stale user data. If user role is changed, user sees old role for up to 60 seconds. No way to force invalidation on role change.
- Safe modification: (1) Add explicit invalidation call on user update in `routes/users.js`. (2) Reduce TTL to 10s. (3) Add cache key versioning so role changes bust the cache immediately.
- Test coverage: No tests for cache expiry or invalidation.

**Database Schema Evolution:**
- Files: `db/migrate.js`
- Why fragile: Idempotent CREATE TABLE IF NOT EXISTS is safe, but ALTER TABLE ADD COLUMN IF NOT EXISTS doesn't validate existing column properties. If a column type needs to change, migration fails silently.
- Safe modification: (1) Implement proper versioning (migration version number). (2) Use explicit migration files (e.g., 001_init.sql, 002_add_column.sql). (3) Test migrations on a copy of production DB before running.
- Test coverage: No tests for migrations. Changes to schema are only validated manually.

**Passport Deserialize on Every Request:**
- Files: `server.js` (lines 87-94)
- Why fragile: `deserializeUser` hits database on every single authenticated request. With 60s cache, load on database is still significant. If cache misses, user sees old role.
- Safe modification: (1) Keep cache but reduce scope (cache only role/status, not full user). (2) Use JWT with role embedded so DB hit is optional. (3) Instrument cache hits/misses to measure impact.
- Test coverage: No load tests. Unknown if this causes bottleneck at scale.

---

## Scaling Limits

**PostgreSQL Connection Pool:**
- Current capacity: 10 concurrent connections (pg default)
- Limit: >10 concurrent DB requests fail (queue, then timeout)
- Scaling path: (1) Increase pool max to 20-50 depending on server RAM. (2) Monitor connection usage. (3) Add connection timeout + retry logic. (4) Consider read replicas for reporting queries.

**In-Memory Log History:**
- Current capacity: 500 logs in memory
- Limit: If app handles >500 logs in 60 seconds and SSE client joins, it misses older logs
- Scaling path: (1) Move logs to PostgreSQL table with TTL (auto-delete after 30 days). (2) Paginate log history API. (3) Implement log compression for long-term retention.

**Google Sheets as Data Source:**
- Current capacity: ~1000 products before API calls get slow
- Limit: Google Sheets API quota is 300 requests/min. Each product fetch hits API. At 1 request/product, max 300 products/min.
- Scaling path: Complete migration to PostgreSQL (already in progress). Cache entire product list in memory.

**WhatsApp Send Rate:**
- Current capacity: ~2 messages/minute (hardcoded 2-minute delay between groups)
- Limit: MacroDroid webhook may have its own rate limits
- Scaling path: (1) Make WA_GROUP_DELAY_MS configurable. (2) Implement rate limit detection and backoff. (3) Queue sends if rate limit hit.

---

## Dependencies at Risk

**Playwright for AliExpress Scraping:**
- Risk: Playwright is heavy (full Chromium browser) and slow. AliExpress may block headless browsers or change selectors frequently.
- Impact: Scraping fails silently if selectors change. Scraper is brittle and maintenance-heavy.
- Migration plan: (1) Negotiate official AliExpress affiliate API access (unlikely). (2) Use cheaper scraper service (ScraperAPI, Bright Data). (3) Accept manual product entry without scraping.

**node-cron Dependency:**
- Risk: Maintained but not widely used. Cron expression validation is basic.
- Impact: Invalid cron expressions can be saved to DB and silently ignored on startup.
- Migration plan: Cron is simple; could be replaced with custom job queue (Bull, BullMQ) that handles retries and persistence better.

**googleapis Client:**
- Risk: Large, slow, and tightly coupled to Google Sheets API. As data moves to PostgreSQL, this dependency should be removed entirely.
- Impact: Adds 140MB to node_modules. Startup time increases. Complex API surface.
- Migration plan: Remove once all data is PostgreSQL-only. Keep only for one-time import script.

**OpenAI API Dependency:**
- Risk: API is rate-limited and expensive. If OpenAI goes down, all sends fail gracefully but should have fallback.
- Impact: Products can't be sent if OpenAI is down (unless skip_ai=true).
- Migration plan: (1) Implement fallback prompt generation (simple template). (2) Add retry with exponential backoff. (3) Cache generated messages permanently so resends don't regenerate.

---

## Missing Critical Features

**No Admin Dashboard:**
- Problem: No way to see system health, error rates, or product delivery statistics across all users.
- Blocks: Can't diagnose why sends are failing. Hard to support users.
- Feature scope: Create `/api/admin/stats` endpoint returning: send success rate, API error counts, user activity. Add admin panel UI.

**No Webhook Delivery Tracking:**
- Problem: WhatsApp sends are fire-and-forget via MacroDroid webhook. No way to know if message actually reached the group.
- Blocks: Can't troubleshoot failed sends. No retry logic.
- Feature scope: Implement webhook callback from MacroDroid when send succeeds/fails. Store delivery status in DB.

**No Product Batch Operations:**
- Problem: Users must mark products as sent one by one. No bulk delete, bulk subject assign, or bulk re-send.
- Blocks: Managing 100+ products is painful.
- Feature scope: Add `/api/products/batch-action` with actions: `mark-sent`, `delete`, `set-subject`, `set-skip-ai`.

**No Undo/Rollback:**
- Problem: Once a product is sent, marked sent, or deleted, there's no undo. Deletes are immediate.
- Blocks: Accidental deletes are permanent. Helps with user errors.
- Feature scope: Add soft deletes. Store deleted products in archive table. Add restore endpoint.

---

## Test Coverage Gaps

**No Unit Tests for Workflow:**
- What's not tested: `workflow.run()` core logic with mocked APIs (WhatsApp, Facebook, Instagram, OpenAI)
- Files: `services/workflow.js`
- Risk: Refactoring this file is dangerous. Can't verify platform-specific behavior (e.g., what if WhatsApp succeeds but Facebook fails?).
- Priority: High

**No Integration Tests for Database:**
- What's not tested: Migrations, queries, cascading deletes (e.g., deleting user deletes all products)
- Files: `db/migrate.js`, all CRUD operations in routes
- Risk: Schema changes may break without being caught. Orphaned data possible.
- Priority: High

**No End-to-End Tests for OAuth Flow:**
- What's not tested: Invite token → Google OAuth → user creation → session management
- Files: `server.js` (passport callbacks), `routes/users.js`
- Risk: Auth flow breaks and breaks entire system. Can't verify invite token validation.
- Priority: High

**No Tests for Scheduler:**
- What's not tested: Cron job execution, timezone handling, concurrent jobs
- Files: `scheduler/index.js`
- Risk: Scheduler silently fails if time zones are wrong or cron expressions are invalid.
- Priority: Medium

**No Frontend Tests:**
- What's not tested: React-like state management, event handlers, API calls from browser
- Files: `public/app.js`, `public/schedule-modal.js`
- Risk: UI bugs, data inconsistency, state corruption go undetected.
- Priority: Medium

---

*Concerns audit: 2026-04-15*
