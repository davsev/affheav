# Codebase Structure

**Analysis Date:** 2026-04-15

## Directory Layout

```
affiliate-heaven/
├── server.js                    # Express app entry point; auth, middleware, route mounting
├── package.json                 # Node.js dependencies and scripts
├── .env                         # Environment variables (not committed; copy from .env.example)
├── .env.example                 # Template for required environment variables
├── CLAUDE.md                    # Project context and architecture summary
├── CONTEXT.md                   # Historical context
│
├── config/                      # Configuration files
│   └── google-service-account.json  # Google Service Account JSON (not committed)
│
├── db/                          # Database layer
│   ├── index.js                 # pg Pool initialization, query() wrapper
│   ├── migrate.js               # Idempotent schema creation (8 tables)
│   └── migrate-subjects-from-sheets.js  # Data migration utility
│
├── scheduler/                   # Job scheduling
│   └── index.js                 # node-cron wrapper; job registry; startup/teardown
│
├── services/                    # Business logic and external integrations
│   ├── workflow.js              # Core: product broadcast orchestration (fetch → generate → send → mark)
│   ├── openai.js                # OpenAI API: Hebrew message generation with locale-aware greetings
│   ├── whatsapp.js              # MacroDroid webhook integration
│   ├── facebook.js              # Facebook Graph API: photo posts
│   ├── instagram.js             # Instagram Content Publishing API: photo posts
│   ├── googleSheets.js          # Google Sheets API: legacy product/log sync (DEPRECATED primary store)
│   ├── userService.js           # User CRUD + 60s TTL cache; admin detection
│   ├── subjectService.js        # Subject/niche CRUD; WhatsApp group management; credential masking
│   ├── inviteService.js         # User invite token lifecycle (generation, validation, TTL)
│   ├── spooMe.js                # URL shortening and click tracking API
│   └── promptStore.js           # In-memory OpenAI prompt cache
│
├── routes/                      # HTTP request handlers (one file per resource)
│   ├── send.js                  # POST /api/send/execute, POST /api/send/:id (product broadcasts)
│   ├── products.js              # CRUD: GET/POST (list, create), PUT (update sort order, skip_ai), DELETE
│   ├── subjects.js              # CRUD: subjects + WhatsApp group management (GET/POST/PUT/DELETE)
│   ├── schedules.js             # CRUD: cron schedules (GET/POST/PUT/DELETE + manual fire)
│   ├── users.js                 # User management (list, update role), invitations (admin-only)
│   ├── facebook.js              # POST /api/facebook (fetch token, test post)
│   ├── prompt.js                # GET/PUT OpenAI prompt (persistent)
│   ├── aliexpress-api.js        # Scraping + tracking ID management
│   └── scrape.js                # Web scraping endpoint (for product data)
│
├── public/                      # Frontend (served as static files)
│   ├── index.html               # Single-page app shell (919 lines); Hebrew RTL layout
│   ├── app.js                   # Main frontend logic (2254 lines); DOM manipulation, API calls, state mgmt
│   ├── style.css                # Styling (46.5 KB); dark theme, Hebrew fonts
│   ├── cron-builder.js          # Cron expression builder UI component
│   ├── schedule-modal.js        # Schedule creation/edit modal component
│   └── utils.js                 # Shared frontend utilities
│
├── scrapers/                    # Headless browser automation
│   └── aliexpress.js            # Playwright-based AliExpress product scraper
│
└── .planning/                   # GSD planning artifacts
    ├── codebase/                # Architecture/structure docs (ARCHITECTURE.md, STRUCTURE.md, etc.)
    └── todos/                   # Phase tracking

```

## Directory Purposes

**Project Root:**
- Purpose: Entry point, configuration, documentation
- Contains: Express app, package manifest, environment setup, project notes
- Key files: `server.js` (232 lines), `package.json`, `.env.example`

**`config/`:**
- Purpose: Credentials and secrets (not committed to git)
- Contains: `google-service-account.json` (referenced by GOOGLE_APPLICATION_CREDENTIALS env var)

**`db/`:**
- Purpose: PostgreSQL database access and schema management
- Contains: Connection pool, query wrapper, idempotent migrations
- Key files: `index.js` (single pool), `migrate.js` (8 tables)
- Pattern: All queries use parameterized `query(sql, params)` function from `db/index.js`

**`scheduler/`:**
- Purpose: Cron job management
- Contains: node-cron wrapper, job registry, timezone handling
- Entry point: `scheduler.startAll()` loads enabled schedules from DB; `scheduler.fireNow()` manually triggers
- Timezone: Asia/Jerusalem for all cron expressions

**`services/`:**
- Purpose: Reusable business logic and external API integrations
- Contains: 10 modules, ~1500 lines total
- Architectural pattern: Each service module exports functions; no shared state except `userService` cache
- Key modules:
  - `workflow.js`: product broadcast orchestration (core logic)
  - `openai.js`, `facebook.js`, `instagram.js`, `whatsapp.js`: external API adapters
  - `userService.js`, `subjectService.js`: user/niche data access + caching
  - `inviteService.js`: invite token lifecycle
  - `spooMe.js`: URL shortening + analytics

**`routes/`:**
- Purpose: HTTP endpoint handlers
- Contains: 9 files, ~1160 lines total
- Architectural pattern: One file per resource; Express Router instance per file; middleware-based auth enforcement
- Route structure: All routes prefixed with `/api/` and require authentication (see `server.js` lines 202–211)
- Common response format: `{ success: true, [data] }` or `{ success: false, error: "message" }`

**`public/`:**
- Purpose: Frontend SPA and assets
- Contains: HTML shell, JavaScript app, CSS, utility modules
- Architectural pattern: Vanilla JavaScript (no framework); modular components (cron-builder, schedule-modal); SSE log streaming via EventSource API
- Language: Hebrew RTL; dark theme; accessible form inputs
- File size: app.js is 102 KB (2254 lines); significant domain logic in frontend

**`scrapers/`:**
- Purpose: Headless browser automation for data extraction
- Contains: Playwright-based AliExpress product scraper
- Used by: `routes/aliexpress-api.js` for product data ingestion

## Key File Locations

**Entry Points:**
- `server.js`: HTTP server startup, Express app, Passport OAuth strategy, route mounting, SSE setup
- `scheduler/index.js`: Cron job loader and executor

**Configuration & Secrets:**
- `.env.example`: Template of all required env vars
- `config/google-service-account.json`: Google API credentials (not committed)
- `services/promptStore.js`: In-memory cache for OpenAI prompt (loaded on startup from DB)

**Core Logic:**
- `services/workflow.js`: Product broadcast pipeline (core orchestration)
- `services/subjectService.js`: Multi-niche configuration and WhatsApp group management
- `services/openai.js`: Hebrew message generation
- `db/migrate.js`: Database schema definition

**Testing & Utilities:**
- Not structured yet; no test runner configured
- `public/utils.js`: Frontend utility functions

**Data Models:**
- Schema defined in `db/migrate.js`
- Row serializers in `routes/products.js`, `services/userService.js`, `services/subjectService.js`

## Naming Conventions

**Files:**
- Snake_case for Node.js backend files: `server.js`, `workflow.js`, `userService.js`
- Camel case for JavaScript modules: `server.js`, `openai.js` (service names match their exported functionality)
- Lowercase + hyphens for routes: `aliexpress-api.js`, `google-sheets.js`
- Lowercase + hyphens for config dirs: `config/`, `public/`, `services/`, `routes/`

**Functions & Variables:**
- camelCase for all JavaScript identifiers: `getNextUnsent()`, `markSent()`, `shortenUrl()`, `stripSensitive()`
- UPPER_SNAKE_CASE for constants: `WA_GROUP_DELAY_MS`, `CACHE_TTL`, `LOG_HISTORY_MAX`
- Prefixed with underscore for internal/private functions: `_row()`, `_cacheGet()`, `_emit`

**Types & Database:**
- snake_case for database column names: `user_id`, `google_id`, `created_at`, `updated_at`, `subject_id`, `wa_group`
- snake_case for database table names: `users`, `products`, `schedules`, `subjects`, `whatsapp_groups`, `invitations`, `settings`, `logs`
- PascalCase for Express Router constructor: `const router = express.Router()`
- Descriptive table column names: `short_link` (not `url`), `wa_group` (WhatsApp group identifier), `sent_at`, `facebook_at`, `instagram_at` (platform-specific timestamps)

## Where to Add New Code

**New Feature (Platform Integration):**
1. Create adapter service in `services/[platform].js` (example: `instagram.js` at 92 lines)
2. Add platform-specific columns to `products` table in `db/migrate.js` (sent/posted timestamp)
3. Integrate into `services/workflow.js` (add platform send logic, results tracking, mark-sent logic)
4. Add configuration columns to `subjects` table (API token, account ID)
5. Add toggle column to `subjects` table (`[platform]_enabled`)
6. Create route handler in `routes/[feature].js` if needed (e.g., `routes/facebook.js` for token management)
7. Expose credential masking in `services/subjectService.js` stripSensitive()

**New CRUD Resource:**
1. Create table in `db/migrate.js` with `user_id` FK (for multi-tenancy)
2. Create service module `services/[resource]Service.js` with CRUD functions
3. Create route module `routes/[resource].js` with GET/POST/PUT/DELETE endpoints
4. Mount route in `server.js` line 203–211 pattern: `app.use('/api/[resource]', isAuthenticated, require('./routes/[resource]'))`
5. All routes must check `req.user.id` ownership on read/update/delete

**New UI Component (Frontend):**
- Add modular .js file in `public/` (example: `public/schedule-modal.js` at 72 lines)
- Follow DOM manipulation pattern: query selectors, event listeners, API calls via fetch
- Import utility functions from `public/utils.js`
- Register component initialization in `public/app.js` main loop

**Database Query:**
- Use `const { rows } = await query(sql, [params])` pattern from `db/index.js`
- Always parameterize: `$1, $2, $3` instead of string concatenation
- Always filter by `user_id` for multi-tenancy
- Use `ORDER BY`, `LIMIT`, indexing for performance (see `db/migrate.js` lines 100–101 for index examples)

**Scheduled Job:**
1. Add schedule record to `schedules` table (via `/api/schedules` POST endpoint)
2. User specifies cron expression (validated by `node-cron.validate()`)
3. Scheduler auto-loads on startup and runs `workflow.run()` with `{ userId, subject }`

## Special Directories

**`.planning/codebase/`:**
- Purpose: Architecture and structure documentation
- Generated: No (created and updated manually)
- Committed: Yes

**`.claude/`:**
- Purpose: GSD worktree snapshots (not relevant to main codebase)
- Generated: Yes (by GSD orchestrator)
- Committed: No

**`.history/`:**
- Purpose: VS Code local history backups
- Generated: Yes (automatically by VS Code)
- Committed: No

---

## Implementation Checklist for New Features

1. **Identify affected layers:** Which of [DB → Service → Route → Frontend] need changes?
2. **Database first:** Add table/columns to `db/migrate.js` if needed
3. **Service layer:** Implement CRUD or integration logic
4. **Route handler:** Expose service via `/api/[endpoint]` and validate `req.user.id`
5. **Frontend:** Add UI component and API calls in `public/app.js` or new `.js` file
6. **Testing:** Manual via curl/Postman or frontend UI; no automated tests configured
7. **Logging:** Add `workflow.log()` calls for observability in core operations
8. **Multi-tenancy:** Ensure all queries filter by `user_id`
9. **Secrets:** Never send API tokens to client; use boolean flags via `stripSensitive()`
10. **Error handling:** Wrap async operations in try-catch; respond with `{ success: false, error }` on failure

---

*Structure analysis: 2026-04-15*
