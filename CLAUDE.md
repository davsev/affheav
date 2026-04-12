# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start       # Production: node server.js on port 3000
npm run dev     # Development: node --watch server.js (auto-restart)
```

No test runner or linter is configured.

## Architecture

**Affiliate Heaven** is a Node.js/Express dashboard that automates affiliate product broadcasting to WhatsApp groups, Facebook pages, and Instagram accounts on a cron schedule.

### Data Flow

```
User/Cron → POST /api/send → workflow.js → db (fetch unsent product)
                                         → spooMe.js (shorten URL via spoo.me)
                                         → openai.js (generate Hebrew message)
                                         → whatsapp.js (MacroDroid webhook)
                                         → facebook.js (Graph API)
                                         → instagram.js (Content Publishing API)
                                         → db (mark sent + log)
```

### Key Modules

- **server.js** — Express app, Passport Google OAuth, SSE log streaming (ring buffer, 500 entries), route mounting
- **services/workflow.js** — Orchestrates the full product-send pipeline
- **services/googleSheets.js** — Legacy sync only (products migration from Sheets); logs still flushed here every 60s
- **services/subjectService.js** — Subject/niche CRUD against PostgreSQL
- **services/promptStore.js** — Per-subject OpenAI prompt persistence
- **services/spooMe.js** — URL shortening via spoo.me API (`SPOOME_API_KEY`); also fetches click stats for all account URLs
- **services/openai.js** — Generates Hebrew marketing messages; adds Shabbat/Motzei Shabbat greetings based on day/time in `Asia/Jerusalem`
- **scheduler/index.js** — node-cron job manager; schedules loaded from DB on startup
- **routes/** — One file per resource: products, send, schedules, subjects, facebook, prompt, scrape, aliexpress-api, users
- **public/app.js** — Vanilla JS frontend, Hebrew RTL dark-theme UI
- **scrapers/aliexpress.js** — Playwright-based AliExpress product scraper

### Multi-Niche (Subjects)

Each "subject" (niche) has its own WhatsApp group(s), Facebook page, Instagram account, MacroDroid webhook, and optional OpenAI prompt override. A subject can have multiple `whatsapp_groups` rows (separate table) — products carry a `whatsapp_group_id` FK. Schedules can be scoped to a specific subject.

### Authentication & User Management

Google OAuth 2.0 via Passport.js. Invite-only registration: admin sends email invite → user gets a link → registers via Google OAuth. Session-based (30-day cookie). All `/api/*` routes require authentication.

- **Roles:** `admin` (full access + user management) and `user` (own data only)
- **Bootstrap:** First login with `ADMIN_GOOGLE_EMAIL` creates the admin account automatically
- **Invite flow:** `POST /api/users/invites` → generates token → `/auth/invite/:token` → Google OAuth → account created
- `passport.deserializeUser` re-fetches user from DB on every request (60s in-memory cache via `services/userService.js`)

### Database (PostgreSQL)

All data is stored in PostgreSQL (primary store). Google Sheets is legacy-only (one-time product migration via `db/migrate-subjects-from-sheets.js`; logs still appended there). Tables: `users`, `invitations`, `subjects`, `whatsapp_groups`, `products`, `schedules`, `settings`, `logs`. Schema is auto-migrated on startup via `db/migrate.js` (idempotent `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` for columns added post-initial migration).

- **`db/index.js`** — `pg` Pool, exports `query(sql, params)`
- **`db/migrate.js`** — idempotent schema creation, called on startup if `DATABASE_URL` is set
- **`services/userService.js`** — user CRUD with 60s TTL cache
- **`services/inviteService.js`** — invite token lifecycle

### Sensitive Fields

API tokens, webhook URLs, and credentials are never sent to the client — only boolean presence indicators are returned from subject/settings endpoints.

### Google Sheets Structure

- **`fishing` tab** — Products (columns: long_url, Link, image, _, Text, join_link, wa_group, sent, facebook, clicks, subject, instagram)
- **Settings tab** — Key-value pairs: schedules (JSON), openai_prompt, subjects (JSON), etc.
- **Logs tab** — Append-only audit trail; flushed from in-memory buffer every 60 seconds

### Environment Setup

Copy `.env.example` → `.env` and fill in all variables. Place Google Service Account JSON at `config/google-service-account.json`.

Key env vars:
```
GOOGLE_APPLICATION_CREDENTIALS=./config/google-service-account.json
GOOGLE_SHEET_ID=...
OPENAI_API_KEY=...
MACRODROID_WEBHOOK_URL=...
FACEBOOK_PAGE_ID=... / FACEBOOK_ACCESS_TOKEN=...
GOOGLE_CLIENT_ID=... / GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=...
DATABASE_URL=postgresql://...         # Railway PostgreSQL plugin sets this automatically
ADMIN_GOOGLE_EMAIL=your@gmail.com     # Bootstrap super-admin on first login
APP_BASE_URL=https://...              # Used for generating invite links
SPOOME_API_KEY=...                    # spoo.me URL shortening + click tracking (optional)
```
