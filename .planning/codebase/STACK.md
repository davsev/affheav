# Technology Stack

**Analysis Date:** 2026-04-15

## Languages

**Primary:**
- JavaScript (Node.js) - All backend services, server logic, and cron scheduler

**Secondary:**
- HTML/CSS/JavaScript - Frontend vanilla JS client (`public/app.js`)

## Runtime

**Environment:**
- Node.js (no specific version locked; see `.nvmrc` if present)

**Package Manager:**
- npm with `package-lock.json`

## Frameworks

**Core:**
- Express.js 4.19.2 - HTTP server and REST API framework
- Passport.js 0.7.0 - OAuth 2.0 authentication layer
- passport-google-oauth20 2.0.0 - Google OAuth 2.0 strategy

**Task Scheduling:**
- node-cron 3.0.3 - Cron job scheduling with timezone support (Asia/Jerusalem)

**Data Access:**
- googleapis 140.0.1 - Google Sheets API client for legacy product data sync
- pg 8.20.0 - PostgreSQL driver for primary data storage

**HTTP Client:**
- axios 1.7.2 - HTTP requests for external APIs (MacroDroid, Facebook, Instagram, AliExpress, spoo.me)

**Testing:**
- None configured (no test framework, linter, or formatter)

## Key Dependencies

**AI & Content Generation:**
- openai 4.52.0 - GPT-4 Mini for Hebrew marketing message generation with Shabbat context

**Session Management:**
- express-session 1.19.0 - Session storage for authenticated users
- (Sessions stored in-memory; suitable for single-instance or scale to external store)

**Utilities:**
- dotenv 16.4.5 - Environment variable management from `.env` files
- uuid 10.0.0 - UUID generation for database records
- playwright 1.59.1 - Browser automation (likely for web scraping in `/routes/scrape.js`)

## Configuration

**Environment:**
Configured via `.env` file with the following critical variables:
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to Google Service Account JSON (Sheets API)
- `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_NAME` - Spreadsheet coordinates
- `OPENAI_API_KEY`, `OPENAI_MODEL` - GPT model selection
- `MACRODROID_WEBHOOK_URL` - WhatsApp automation webhook
- `FACEBOOK_PAGE_ID`, `FACEBOOK_ACCESS_TOKEN` - Facebook page posting
- `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET` - AliExpress product search signing
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` - OAuth 2.0
- `SESSION_SECRET` - Session signing key
- `DATABASE_URL` - PostgreSQL connection string
- `ADMIN_GOOGLE_EMAIL` - Bootstrap super-admin on first login
- `APP_BASE_URL` - For generating invite links
- `NODE_ENV` - "production" or "development"
- `PORT` - Server port (default 3000)
- `SPOOME_API_KEY` - URL shortener (optional)

**Build:**
- No build step (Node.js runs code directly)
- Entry point: `server.js`
- Dev mode: `npm run dev` (node --watch server.js)
- Prod mode: `npm start` (node server.js)

## Database

**Primary Store:**
- PostgreSQL (via `DATABASE_URL` environment variable)
- Client: `pg` pool (`db/index.js`)
- Auto-migrated on startup via `db/migrate.js` (idempotent schema)
- Tables: `users`, `invitations`, `subjects`, `products`, `schedules`, `settings`, `logs`

**Legacy Data Source:**
- Google Sheets (still used for product sync; primary data moving to PostgreSQL)

## Platform Requirements

**Development:**
- Node.js
- npm
- `.env` file with API keys and credentials
- Google Service Account JSON at `config/google-service-account.json`
- PostgreSQL (local or remote via `DATABASE_URL`)

**Production:**
- Node.js runtime
- Railway.app platform (or compatible Node.js host)
- PostgreSQL (Railway plugin or external)
- Environment variables configured via platform (not `.env` file)
- HTTPS/SSL (trust proxy configured for Railway)

## External Service Dependencies

**Google APIs:**
- Google Sheets API v4 (googleapis package)
- Google OAuth 2.0 (passport-google-oauth20)

**Social Media:**
- Facebook Graph API v23.0
- Meta Content Publishing API (Instagram v24.0)

**URL Shortening:**
- spoo.me API v1 (optional; fallback to original URL)

**E-Commerce:**
- AliExpress Affiliate API (sync endpoint with MD5 signing)

**AI/Content:**
- OpenAI Chat Completions API (GPT-4 Mini)

**Automation:**
- MacroDroid webhook (WhatsApp sender via Tasker automation)

---

*Stack analysis: 2026-04-15*
