# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start       # Production: node server.js on port 3000
npm run dev     # Development: node --watch server.js (auto-restart)
```

No test runner or linter is configured.

## Architecture

**Affiliate Heaven** is a Node.js/Express dashboard that automates affiliate product broadcasting to WhatsApp groups, Facebook pages, and Instagram accounts on a cron schedule. Hebrew RTL UI, multi-tenant, invite-only.

### Data Flow

```
User/Cron → POST /api/send → workflow.js → db (fetch unsent product)
                                         → openai.js (generate Hebrew message via gpt-4.1-mini)
                                         → whatsapp.js (MacroDroid webhook)
                                         → facebook.js (Graph API v23.0)
                                         → instagram.js (Content Publishing API)
                                         → db (mark sent + log)
```

Send endpoints return 200 immediately; workflow runs async — results appear in the SSE log stream (`/api/logs`).

### Key Modules

- **server.js** — Express app, Passport Google OAuth, SSE log streaming, route mounting, DB migration on startup
- **services/workflow.js** — Orchestrates the full product-send pipeline; platforms fail independently (per-platform try-catch)
- **services/broadcastService.js** — Broadcast CRUD; converts `recurrence` JSONB → cron string; computes next-run in `Asia/Jerusalem`; generates Hebrew schedule descriptions
- **services/broadcastDelivery.js** — Thin orchestrator that executes a broadcast send
- **services/openai.js** — Hebrew marketing messages; appends Shabbat/Motzei Shabbat greetings based on day/time in `Asia/Jerusalem`
- **services/subjectService.js** — Niche + WhatsApp group CRUD
- **services/spooMe.js** — spoo.me URL shortening on product create; click stat sync
- **services/googleSheets.js** — Legacy secondary store: persistent log flushing (every 60s), historic log reads
- **scheduler/index.js** — node-cron job manager; two independent job sets: schedules (product-send) and broadcasts; all cron in `Asia/Jerusalem`
- **routes/** — One file per resource; see list below
- **public/app.js** — Vanilla ES6 frontend (3,770 lines), Hebrew RTL dark-theme SPA

### Multi-Niche (Subjects)

Each subject (niche) carries its own WhatsApp group(s), Facebook page, Instagram account, MacroDroid webhook URL, and optional OpenAI prompt override. Products and schedules are scoped to a `subject_id`. Credentials per-subject are stored in `subjects` table; sensitive fields (tokens, secrets) are stripped from API responses — only boolean presence is returned to the client.

### Broadcasts vs. Schedules

- **Schedules** — Cron jobs that auto-pick the next unsent product and run the full workflow.
- **Broadcasts** — Pre-written messages with an optional image that send on a recurrence (daily / weekly / every-N-days). Recurrence stored as JSONB; converted to cron on save. `broadcastService.recurrenceToCron()` is the authoritative converter.

### Authentication & User Management

Google OAuth 2.0 via Passport.js. Invite-only: admin creates token → `/auth/invite/:token` → Google OAuth → account created.

- **Roles:** `admin` (full access + user management) and `user` (own data only)
- **Bootstrap:** First login with `ADMIN_GOOGLE_EMAIL` auto-creates admin
- `passport.deserializeUser` re-fetches from DB on every request (60s in-memory cache in `services/userService.js`)

### Database (PostgreSQL)

Schema auto-migrated on startup via `db/migrate.js` (idempotent). `db/index.js` exports `query(sql, params)`.

Key tables: `users`, `invitations`, `subjects`, `whatsapp_groups`, `products`, `schedules`, `broadcast_messages`, `settings`, `logs`, `commission_snapshots`, `order_items`, `post_insights`, `ad_spend`.

All DB queries are parameterized (`$1, $2` style). All queries scoped to `user_id` for multi-tenant isolation.

### Analytics

AliExpress commission snapshots are stored in `commission_snapshots` / `order_items`. Manual ad spend in `ad_spend`. ROAS and attribution are computed in `routes/analytics.js`. A timing heatmap shows best send times per niche.

### Routes

| File | Prefix | Notes |
|------|--------|-------|
| routes/send.js | `/api/send` | Execute send (async, immediate 200) |
| routes/products.js | `/api/products` | CRUD + click sync |
| routes/schedules.js | `/api/schedules` | CRUD + fire-now |
| routes/broadcasts.js | `/api/broadcasts` | CRUD + image upload (multipart) + fire-now |
| routes/subjects.js | `/api/subjects` | Niche CRUD + WhatsApp group sub-resource |
| routes/users.js | `/api/users` | Admin: user list, roles, invites |
| routes/prompt.js | `/api/prompt` | Global OpenAI prompt get/set |
| routes/facebook.js | `/api/facebook` | Token validate/refresh/page-token generation |
| routes/analytics.js | `/api/analytics` | ROAS, ad spend, attribution, heatmap |
| routes/aliexpress-api.js | `/api/aliexpress` | Commission snapshot fetch + order tracking |

### Frontend (public/)

`app.js` is a single-file SPA (no framework). Supporting modules:

- `utils.js` — `api()` fetch wrapper, `escHtml()`, `fmtDate()`
- `schedule-modal.js` — Cron builder UI
- `broadcast-modal.js` — Recurrence picker + multipart image upload
- `cron-builder.js` — Cron expression helper

Global state arrays (`_subjects`, `_products`, `_schedules`, `_broadcasts`) are refreshed on each tab switch.

### Environment Setup

Copy `.env.example` → `.env`. Place Google Service Account JSON at `config/google-service-account.json`.

Key env vars:
```
DATABASE_URL=postgresql://...          # Railway sets this automatically
ADMIN_GOOGLE_EMAIL=your@gmail.com      # Bootstrap super-admin on first login
APP_BASE_URL=https://...               # Used for invite links
SESSION_SECRET=...                     # openssl rand -hex 32
GOOGLE_CLIENT_ID=... / GOOGLE_CLIENT_SECRET=...
OPENAI_API_KEY=... / OPENAI_MODEL=gpt-4.1-mini
GOOGLE_APPLICATION_CREDENTIALS=./config/google-service-account.json
GOOGLE_SHEET_ID=...
MACRODROID_WEBHOOK_URL=...
FACEBOOK_PAGE_ID=... / FACEBOOK_ACCESS_TOKEN=...
ALIEXPRESS_APP_KEY=... / ALIEXPRESS_APP_SECRET=...
SPOOME_API_KEY=...
```
