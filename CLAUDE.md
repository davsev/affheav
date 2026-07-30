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
User/Cron → POST /api/send → workflow.js → googleSheets.js (fetch unsent product)
                                         → openai.js (generate Hebrew message)
                                         → whatsapp.js (MacroDroid webhook)
                                         → facebook.js (Graph API)
                                         → instagram.js (Content Publishing API)
                                         → googleSheets.js (mark sent + log)
```

### Key Modules

- **server.js** — Express app, Passport Google OAuth, SSE log streaming, route mounting
- **services/workflow.js** — Orchestrates the full product-send pipeline
- **services/googleSheets.js** — Primary data store: products, schedules, settings, logs, subjects (niches)
- **services/openai.js** — Generates Hebrew marketing messages; adds Shabbat/Motzei Shabbat greetings based on day/time in `Asia/Jerusalem`
- **scheduler/index.js** — node-cron job manager; schedules loaded from Google Sheets on startup
- **routes/** — One file per resource: products, send, schedules, subjects, facebook, prompt, scrape, aliexpress-api, discover, analytics
- **public/app.js** — Vanilla JS frontend (1631 lines), Hebrew RTL dark-theme UI

### AI Product Discovery (Discover tab)

`services/discoveryAgent.js` learns each subject's (niche's) best-selling AliExpress products for that subject's affiliate channel (`aliexpress_tracking_id`) and searches for similar/complementary products to suggest.

- **Ranking signal:** real AliExpress orders/commission from `order_items` (synced via `POST /api/analytics/sync-commissions`, matched to each subject's tracking ID) — falls back to website `products.clicks` for products without confirmed order data yet.
- **Keyword generation:** title-extraction by default, or OpenAI-generated keywords when `discovery_ai_enabled` is on (per-user setting, custom prompt supported).
- **Output:** results are inserted into `product_suggestions` (status `pending`) — never added to the live product list automatically. Reviewed via the Discover tab (`GET/PATCH /api/discover`), which calls `POST /api/aliexpress/add` on approval.
- **Automation:** `scheduler.startDiscoveryAgent()` runs `runDiscovery(userId)` once daily (`DISCOVERY_CRON`, default `0 6 * * *` UTC) for every user with a subject tracking ID configured, unless they've opted out via the `discovery_auto_run_enabled` setting. Still review-first — the cron only populates the suggestion queue.

### Autonomous Product Agent (drafts on the Products tab)

`services/autoProductAgent.js` is a second, independent acquisition agent (runs alongside Discover, not merged with it) that writes candidates directly into the `products` table instead of a separate suggestions table.

- **Memory:** `getTopSellersBySubject()` ranks each channel's (subject's `aliexpress_tracking_id`) best sellers primarily from `order_items` (grouped by `product_id`, independent of whether the source product row still exists), falling back to `products.clicks` for channels without order history yet.
- **Lifecycle:** every `products` row has `status` (`active` | `draft` | `rejected`) and `added_by` (`manual` | `auto_agent`). The agent inserts new candidates as `status='draft'` — no `short_link`, so they're already invisible to the send pipeline, `GET /api/products`, and `routes/send.js` (all filtered to `status='active'`). `approveProduct(userId, productId, whatsappGroupId)` (`services/autoProductAgent.js`) resolves a WhatsApp group (explicit `whatsappGroupId` or the subject's first group), generates the `short_link` via spoo.me (deferred until approval so drafts that never get approved never waste one), and flips the row to `active`; shared by `PATCH /api/products/:id/approve` and the auto-approve mode below. `PATCH /api/products/:id/reject` sets `status='rejected'` — kept, not deleted, so the agent's dedup check remembers not to re-suggest it.
- **Auto-approve (optional, `auto_agent_auto_approve` setting, off by default — opt-in, unlike the other two toggles):** when on, `runAutoProductAgent` calls `approveProduct` immediately after inserting each draft instead of leaving it for manual review — the product enters the normal send rotation with no human ever seeing it first. The daily per-subject draft cap still applies as a volume safety net. Frontend requires a confirm dialog to turn this on (not to turn it off) given the consequence.
- **Volume control:** capped at 5 new drafts per subject (channel) per day (`MAX_DRAFTS_PER_SUBJECT_PER_DAY`), across up to 10 subjects per run.
- **AI decision-making (optional, `auto_agent_ai_enabled` setting, off by default):** when on, keywords come from OpenAI (same custom-prompt pattern as Discover's `discovery_ai_prompt` — `auto_agent_ai_prompt`, falls back to title-extraction on failure) instead of naive title-extraction, and — the part Discover doesn't do — every numeric-filter-passing candidate across a subject's keywords is judged by a second AI pass (`filterCandidatesWithAI`, fixed non-customizable prompt) against the niche, its best sellers, and its rejection history before any draft is inserted, rejecting off-topic, redundant, or previously-declined-looking results. Both AI steps fail open (keep everything / fall back to title extraction) on any error — never blocks a run.
- **Discovery angles:** each subject's search combines three sources, all feeding the same candidate pool before the AI relevance pass (if enabled) judges the lot: **similar** (title-extraction or AI keywords from best sellers — the original behavior), **complementary** (`generateComplementaryKeywordsWithAI`, AI-only — accessories/add-ons for the best sellers, e.g. a phone case best seller → screen protector/charger keywords; no non-AI equivalent since there's no reliable heuristic for "what goes with this"), and **trending** (`searchHotProducts`, `aliexpress.affiliate.hotproduct.query` with the subject/niche name itself as the keyword — AliExpress's own hot-product ranking, independent of this channel's sales history, so it works even for a subject with zero orders/clicks yet; skipped when the subject name is Hebrew, same guard as everywhere else that builds a search keyword).
- **Feedback loop:** `products.status='rejected'` rows are kept (not deleted) specifically so two things can use them: dedup (never re-suggest the same URL) and, when AI is on, the relevance prompt is fed each subject's last 20 rejected titles so it learns to avoid similar picks over time — not just exact repeats.
- **Dedup:** keyed primarily on `products.aliexpress_product_id` (the stable AliExpress product ID), not `long_url`. `long_url` stores the affiliate `promotion_link`, which AliExpress regenerates on every API call — the same physical product gets a different link each time, so a URL-only dedup check silently fails and the same product keeps resurfacing as "new" (this was a real bug; fixed by adding the `aliexpress_product_id` column and keying both cross-run and within-run dedup off it, matching the pattern `discoveryAgent.js`/`product_suggestions.aliexpress_id` already used correctly).
- **Suggestion reasoning:** every draft gets a `suggestion_reason` (plain text, shown on the draft card) — the AI's own short justification when `filterCandidatesWithAI` is used, or `Similar to your best seller "{title}"` / `Found via search: "{keyword}"` for the non-AI path (each search keyword is tagged with the best-seller title it was extracted from).
- **Automation:** `scheduler.startAutoProductAgent()` runs `runAutoProductAgent(userId)` once daily (`AUTO_AGENT_CRON`, default `0 7 * * *` UTC, staggered an hour after the Discovery agent), unless disabled per-user via the `auto_agent_enabled` setting. That setting only gates the scheduled run — `POST /api/products/run-auto-agent` (Products tab "run now" button) always executes regardless.
- **UI:** the Products tab has an always-visible settings panel (enabled toggle, AI toggle + prompt) plus a performance comparison (`GET /api/products/auto-agent-stats` — active/draft/rejected counts, avg clicks, real order counts, `auto_agent` vs `manual`) plus a collapsible "pending approval" panel (`GET /api/products?status=draft`) with Approve/Reject actions per card. Settings read/write via `GET/PATCH /api/products/auto-agent-settings`.
- **Schema resilience:** new columns for this feature are added both in `db/migrate.js`'s main sequence and as an independent "belt-and-suspenders" guard in `server.js` (a standalone `try/catch` block that runs regardless of whether an earlier, unrelated statement in `migrate()`'s single long sequential list fails) — this repo has hit that failure mode more than once, so new columns for this feature follow that pattern from the start rather than retrofitting it after a production incident.

### Multi-Niche (Subjects)

Each "subject" (niche) has its own WhatsApp group, Facebook page, Instagram account, MacroDroid webhook, and optional OpenAI prompt override. Products are tagged with `subject=id` in Google Sheets column K. Schedules can be scoped to a specific subject.

### Authentication & User Management

Google OAuth 2.0 via Passport.js. Invite-only registration: admin sends email invite → user gets a link → registers via Google OAuth. Session-based (30-day cookie). All `/api/*` routes require authentication.

- **Roles:** `admin` (full access + user management) and `user` (own data only)
- **Bootstrap:** First login with `ADMIN_GOOGLE_EMAIL` creates the admin account automatically
- **Invite flow:** `POST /api/users/invites` → generates token → `/auth/invite/:token` → Google OAuth → account created
- `passport.deserializeUser` re-fetches user from DB on every request (60s in-memory cache via `services/userService.js`)

### Database (PostgreSQL)

All data is stored in PostgreSQL (replaces Google Sheets as primary store — Sheets still used for legacy product sync). Tables: `users`, `invitations`, `subjects`, `products`, `schedules`, `settings`, `logs`. Schema is auto-migrated on startup via `db/migrate.js` (idempotent `CREATE TABLE IF NOT EXISTS`).

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
```
