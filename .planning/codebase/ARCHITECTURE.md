# Architecture

**Analysis Date:** 2026-04-15

## Pattern Overview

**Overall:** Layered MVC with middleware-based authentication, service-oriented business logic, and scheduled automation.

**Key Characteristics:**
- Passport.js-based OAuth 2.0 authentication with session management and user invitations
- Express.js request routing with isolated router modules (one per resource)
- PostgreSQL as primary data store with idempotent schema migration on startup
- Server-Sent Events (SSE) for real-time log streaming to connected clients
- node-cron scheduler that executes product broadcast workflows on configurable schedules
- Multi-niche (subject) support with per-niche credentials and platform toggles (WhatsApp, Facebook, Instagram)

## Layers

**Presentation (Client):**
- Purpose: Vanilla JavaScript SPA served from `public/`; Hebrew RTL dark-theme UI
- Location: `public/app.js` (2254 lines), `public/index.html`, `public/style.css`
- Contains: DOM manipulation, API calls, event listeners, local state management, Hebrew date/locale handling
- Depends on: Express static file serving, `/api/*` endpoints
- Used by: Users viewing dashboard, managing products, scheduling, checking logs

**HTTP Layer:**
- Purpose: Express.js request/response handling with middleware pipeline
- Location: `server.js` (232 lines)
- Contains: Session middleware, Passport OAuth strategy, route mounting, SSE setup, log flushing, graceful shutdown
- Depends on: All services and route modules
- Used by: All HTTP clients (browser, cron, manual API calls)

**Request Routing Layer:**
- Purpose: Resource-specific endpoint handlers
- Location: `routes/` directory (9 files, 1161 lines total)
- Contains: CRUD operations, parameter validation, response formatting
- Key files:
  - `routes/send.js` — product broadcast execution endpoints
  - `routes/products.js` — product CRUD and state management
  - `routes/subjects.js` — niche/subject CRUD and WhatsApp group management
  - `routes/schedules.js` — cron schedule CRUD
  - `routes/users.js` — user management, invitations (admin-only)
  - `routes/facebook.js`, `routes/aliexpress-api.js`, `routes/scrape.js` — feature-specific endpoints
- Depends on: Services, database, authentication middleware
- Used by: HTTP layer, frontend

**Authentication & Session Layer:**
- Purpose: Verify and maintain user identity across requests
- Location: `server.js` (lines 29–94) and `services/userService.js`
- Contains: Google OAuth strategy, session serialization, user caching (60s TTL), invite validation
- Pattern: Deserialize on every request to reflect live role/status changes; 30-day persistent cookie
- Used by: All protected routes via `isAuthenticated()` and `isAdmin()` middleware

**Business Logic (Services):**
- Purpose: Encapsulate domain operations; called by routes and scheduler
- Location: `services/` directory (10 files, 1538 lines total)
- Key services:
  - `services/workflow.js` — orchestrates full product broadcast pipeline (fetch → message generation → send to platforms → mark sent)
  - `services/subjectService.js` — subject/niche CRUD, WhatsApp group management, credential masking
  - `services/userService.js` — user CRUD with in-memory cache, admin detection
  - `services/openai.js` — Hebrew message generation with locale-aware greetings
  - `services/facebook.js` — Facebook Graph API integration
  - `services/instagram.js` — Instagram Content Publishing API
  - `services/whatsapp.js` — MacroDroid webhook integration
  - `services/googleSheets.js` — legacy Google Sheets integration (products fetch, logs append)
  - `services/inviteService.js` — invite token lifecycle
  - `services/spooMe.js` — URL shortening and click tracking
- Depends on: Database, external APIs, configuration
- Used by: Routes, scheduler, other services

**Scheduler Layer:**
- Purpose: Trigger product broadcasts on cron schedule
- Location: `scheduler/index.js` (136 lines)
- Contains: node-cron job registration, job lifecycle, timezone handling (Asia/Jerusalem)
- Pattern: Load enabled schedules from DB on startup; execute workflow runner on cron trigger
- Entry points: Server startup (`scheduler.startAll()`) and manual execution (`scheduler.fireNow()`)
- Used by: Server initialization, manual trigger endpoints

**Data Access Layer:**
- Purpose: PostgreSQL connectivity and query execution
- Location: `db/index.js` (26 lines), `db/migrate.js` (152 lines)
- Contains: pg Pool initialization, parameterized query wrapper, idempotent schema migration
- Pattern: Single connection pool; queries use `$1, $2` parameter binding; migrations run on startup if `DATABASE_URL` set
- Schema: 8 tables (users, invitations, subjects, whatsapp_groups, products, schedules, settings, logs)
- Used by: All services and routes

**Configuration & Utilities:**
- Purpose: Environment variables, utility functions
- Location: `.env.example`, `services/promptStore.js` (in-memory prompt cache)
- Env vars: `GOOGLE_SHEET_ID`, `OPENAI_API_KEY`, `MACRODROID_WEBHOOK_URL`, `FACEBOOK_*`, `INSTAGRAM_*`, `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_GOOGLE_EMAIL`, `APP_BASE_URL`

## Data Flow

**Product Send (Core Workflow):**

1. **Trigger:** User POST `/api/send/execute` OR cron fires `scheduler.runJob()` with schedule config
2. **Authentication:** Passport middleware ensures req.user populated
3. **Product Fetch:** `workflow.getNextUnsent()` queries DB for first unsent product (ordered by `sort_order ASC NULLS LAST`)
4. **Subject Resolution:** If subject specified, `subjectService.getSubjectById()` loads niche credentials (macrodroid_url, facebook_token, instagram_account_id, custom prompt)
5. **Message Generation:**
   - If product has `skip_ai=true`: use product text as-is
   - Else if saved message is Hebrew + has link: reuse cached message
   - Else: `openai.generateMessage()` generates new Hebrew message; save to DB
6. **Platform Sends (Parallel-ish):**
   - **WhatsApp:** Resolve groups from `whatsapp_groups` table (or fall back to product's `wa_group` string); POST to MacroDroid webhook for each group with 2-min delays
   - **Facebook:** `facebook.postPhoto()` to Graph API endpoint `/me/photos`
   - **Instagram:** `instagram.postPhoto()` via Content Publishing API (requires IG account ID + token)
7. **Mark Sent:** Update product DB row: `sent_at`, `facebook_at`, `instagram_at` (set only if platform sent successfully), increment `send_count`
8. **Log:** Emit log entries via SSE; append to logs table every 60s
9. **Return:** Respond with results object containing success status per platform

**State Management:**

- **Products:** Stored in `products` table with columns: `id`, `user_id`, `subject_id`, `long_url`, `short_link`, `image`, `text`, `sent_at`, `facebook_at`, `instagram_at`, `skip_ai`, `sort_order`, `send_count`
- **Subjects (Niches):** Stored in `subjects` table with all platform credentials; never sent to client (masked via `stripSensitive()`)
- **WhatsApp Groups:** Stored in `whatsapp_groups` table (many-to-one with subjects); used by workflow to determine broadcast targets
- **Schedules:** Stored in `schedules` table with user_id + subject_id (scoped schedule); loaded into memory on startup
- **Users:** Stored in `users` table; cached 60s in `userService._cache` to avoid DB hit on every request
- **Logs:** Appended to `logs` table every 60s; SSE buffer (500 entries max) keeps recent logs in memory for live client stream

## Key Abstractions

**Workflow:**
- Purpose: Orchestrates full product broadcast lifecycle
- Location: `services/workflow.js`
- Pattern: Procedural steps (fetch → generate → send → mark); error handling per platform (failure doesn't block other platforms); SSE logging at each step
- Exports: `run(overrideProduct, opts)`, `setEmitter(fn)`, `log(msg, level)`

**Subject (Niche):**
- Purpose: Encapsulates multi-platform credentials and configuration per broadcast niche
- Location: `services/subjectService.js`
- Pattern: Subject row contains: name, color, macrodroid_url, facebook_page_id, facebook_token, instagram_account_id, custom openai_prompt, per-platform enablement flags (wa_enabled, fb_enabled, instagram_enabled), aliexpress_tracking_id
- Related: `whatsapp_groups` table many-to-one with subject

**Product:**
- Purpose: Represents an affiliate item to broadcast
- Location: `db/migrate.js` (products table) and `routes/products.js` (CRUD)
- Pattern: Immutable creation; state mutated by workflow (sent_at timestamps, send_count); sort_order for queue ordering; subject_id for niche scoping

**Schedule:**
- Purpose: Cron job definition, stored in DB, loaded into memory on startup
- Location: `db/migrate.js` (schedules table) and `scheduler/index.js`
- Pattern: Cron expression validated against node-cron; timezone = Asia/Jerusalem; per-user + per-subject scoping

**User & Invite:**
- Purpose: Access control and onboarding
- Location: `services/userService.js` (user CRUD + cache), `services/inviteService.js` (invite token lifecycle)
- Pattern: Google OAuth primary auth; invites are email-addressed tokens (7-day TTL by default); first login with `ADMIN_GOOGLE_EMAIL` bootstraps admin

## Entry Points

**Server Startup:**
- Location: `server.js` (lines 220–231)
- Triggers: `npm start` or `npm run dev`
- Responsibilities: Initialize Express, Passport, session, SSE log stream, database migration, scheduler load, listen on port 3000

**HTTP Requests:**
- Location: `server.js` (lines 202–211)
- Triggers: Browser/client HTTP requests to `/api/*` routes
- Responsibilities: Route to appropriate route handler, enforce authentication + optional admin role check

**Scheduled Product Sends:**
- Location: `scheduler/index.js` (lines 52–63)
- Triggers: node-cron fires at schedule's cron expression (timezone: Asia/Jerusalem)
- Responsibilities: Look up schedule from `activeJobs`, call `workflow.run()` with userId + subject

**Manual Product Send:**
- Location: `routes/send.js` (lines 7–19)
- Triggers: `POST /api/send/execute` with optional { subject, platforms, waGroupIds }
- Responsibilities: Validate request, invoke `workflow.run(null, opts)`, return results

**Specific Product Send:**
- Location: `routes/send.js` (lines 22–53)
- Triggers: `POST /api/send/:id`
- Responsibilities: Fetch product by id + user_id, invoke `workflow.run(product, opts)`

## Error Handling

**Strategy:** Per-platform isolation; failures in one platform don't block others. Errors logged and returned in response object.

**Patterns:**
- **Database errors:** Caught at route level; respond 500 with `{ success: false, error: err.message }`
- **API errors:** `workflow.js` wraps each platform (WA, FB, IG) in try-catch; logs error; stores `{ success: false, error: err.message }` in results; continues to next platform
- **Validation errors:** Route-level checks; respond 400 if required fields missing
- **Authentication errors:** Middleware intercepts; respond 401 if not authenticated, 403 if not admin
- **Scheduler errors:** `scheduler.js` logs error; continues to next scheduled job

## Cross-Cutting Concerns

**Logging:** 
- Approach: Dual-sink logging via `workflow.log()` → emits SSE entry (broadcast to all connected clients) + appends to in-memory buffer (flushed to DB every 60s)
- Used by: All services and workflow for observability

**Validation:** 
- Approach: Inline route-level checks; required fields tested before DB operations

**Authentication:** 
- Approach: Passport.js Google OAuth 2.0; session-based (30-day cookie); re-fetch user on every request for live role/status
- Invite flow: Admin generates invite token → user visits `/auth/invite/:token` → redirected to Google OAuth → account created

**Multi-tenancy:** 
- Approach: All queries filtered by `user_id`; subjects scoped to user; whatsapp_groups scoped to user + subject

**Credential Masking:**
- Approach: Sensitive fields (facebook_token, instagram tokens, macrodroid_url) never sent to client; replaced with boolean presence flags via `stripSensitive()`

---

*Architecture analysis: 2026-04-15*
