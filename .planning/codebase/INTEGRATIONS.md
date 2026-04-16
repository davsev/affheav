# External Integrations

**Analysis Date:** 2026-04-15

## APIs & External Services

**Google Workspace:**
- Google Sheets API - Primary data store for products, schedules, settings, logs
  - SDK/Client: `googleapis` package
  - Auth: Service Account JSON at `config/google-service-account.json`
  - Env: `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_NAME`
  - Scope: `https://www.googleapis.com/auth/spreadsheets`
  - Implementation: `services/googleSheets.js` (fetch/update products, mark sent status, append logs)

**Social Media Posting:**
- Facebook Graph API v23.0 - Photo posts to Facebook pages
  - SDK/Client: axios (HTTP GET/POST)
  - Auth: Page Access Token (long-lived, never expires)
  - Env: `FACEBOOK_PAGE_ID`, `FACEBOOK_ACCESS_TOKEN`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`
  - Implementation: `services/facebook.js` (postPhoto, token refresh, validation)
  - Endpoints: `POST /{pageId}/photos`, `GET /debug_token`, `GET /oauth/access_token`

- Instagram Business Account - Photo posts via Content Publishing API v24.0
  - SDK/Client: axios (HTTP POST for two-step: create container → publish)
  - Auth: Page Access Token with `instagram_content_publish` scope
  - Env: Subject-specific `instagram_access_token` in DB (stored in `subjects` table)
  - Implementation: `services/instagram.js` (createContainer, pollStatus, publish)
  - Process: POST /{igUserId}/media (container) → poll status → POST /{igUserId}/media_publish

**WhatsApp Automation:**
- MacroDroid Webhook - Send WhatsApp messages via webhook
  - SDK/Client: axios (HTTP GET with query parameters)
  - Auth: URL-based (webhook URL in env or subject config)
  - Env: `MACRODROID_WEBHOOK_URL` (default) or per-subject `macrodroid_url` in DB
  - Implementation: `services/whatsapp.js` (send with text, image, wa_group params)
  - Success: Response body contains string "OK"

**URL Shortening:**
- spoo.me API v1 - Link shortening with click tracking
  - SDK/Client: https request (native Node.js)
  - Auth: Bearer token (API key)
  - Env: `SPOOME_API_KEY` (optional; skips if not set)
  - Implementation: `services/spooMe.js` (shortenUrl, getAllClickStats)
  - Endpoints: `POST /api/v1/shorten`, `GET /api/v1/urls?page=&pageSize=100`

**E-Commerce Search:**
- AliExpress Affiliate API - Product search with MD5-signed requests
  - SDK/Client: axios (HTTP GET)
  - Auth: MD5 signature (app_key + sorted params + app_secret)
  - Env: `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET`, `ALIEXPRESS_TRACKING_ID`
  - Implementation: `routes/aliexpress-api.js` (buildSignedUrl, query products)
  - Endpoint: `https://api-sg.aliexpress.com/sync`
  - Per-subject tracking: Subjects can override `tracking_id` (stored in DB)

## Data Storage

**Databases:**

**PostgreSQL (Primary):**
- Connection: `DATABASE_URL` environment variable
- Client: `pg` package (Pool connection)
- SSL: Enabled in production (`rejectUnauthorized: false`)
- Auto-migration on startup: `db/migrate.js`
- Tables:
  - `users` - Authentication, roles, photos
  - `invitations` - Invite tokens and lifecycle
  - `subjects` - Niches: WhatsApp groups, Facebook pages, Instagram accounts, credentials
  - `products` - Product catalog with short links, send status per platform
  - `schedules` - Cron jobs (loaded into `node-cron` on startup)
  - `settings` - Key-value configuration
  - `logs` - Audit trail (append-only)

**Google Sheets (Legacy):**
- Spreadsheet: `GOOGLE_SHEET_ID` (env)
- Tab: `fishing` (default; configured via `GOOGLE_SHEET_NAME`)
- Columns: long_url, Link (spoo.me), image, Text, join_link, wa_group, sent, facebook, clicks, subject, instagram
- Used by: `services/googleSheets.js` for legacy product sync
- Still active but primary data moving to PostgreSQL

**File Storage:**
- None (no S3, local filesystem, or cloud storage configured)
- Images are external URLs (stored as strings in database/sheets)

**Caching:**
- In-memory session storage (express-session)
- In-memory user cache: 60-second TTL in `services/userService.js`
- In-memory log history: 500 recent entries in `server.js`
- No Redis or external cache layer

## Authentication & Identity

**Auth Provider:**
- Google OAuth 2.0 via Passport.js
- Implementation: `server.js` (GoogleStrategy)
- Flow: User clicks Google sign-in → OAuth callback → validate invite token or admin email → create user → session

**Invite-Only Registration:**
- Admin generates invite token (`POST /api/users/invites`)
- User receives email with invite link (`/auth/invite/:token`)
- Link stores token in session, redirects to Google OAuth
- After OAuth, validateToken checks email matches and marks invite as used
- Bootstrap: First login with `ADMIN_GOOGLE_EMAIL` creates super-admin without invite

**Authorization:**
- Roles: `admin` (full access + user management), `user` (own data only)
- Middleware: `isAuthenticated` (all `/api/*` routes), `isAdmin` (user management only)
- Session: 30-day cookie, Passport deserializeUser re-fetches from DB on every request

**User Service:**
- Implementation: `services/userService.js`
- Cache: 60-second TTL for findUser queries
- Create, find, update user by Google ID

**Invite Service:**
- Implementation: `services/inviteService.js`
- Token validation and mark-as-used workflow

## Monitoring & Observability

**Error Tracking:**
- None configured (no Sentry, DataDog, etc.)

**Logs:**
- In-memory buffer + Google Sheets append (60-second flush)
- SSE stream for real-time UI log display (`GET /api/logs`)
- Historical logs via `GET /api/logs/history` (max 2000 entries)
- Logs persisted to PostgreSQL `logs` table and Google Sheets `Logs` tab
- Console.log for development

**Request Logging:**
- None configured

## CI/CD & Deployment

**Hosting:**
- Railway.app (mentioned in .env comments)
- Docker-ready Node.js app
- Expects `DATABASE_URL` set by Railway PostgreSQL plugin
- Trust proxy: Enabled for Railway HTTPS headers

**CI Pipeline:**
- None detected (no GitHub Actions, CircleCI, etc.)

**Commands:**
```bash
npm start   # Production: node server.js
npm run dev # Development: node --watch server.js (auto-restart)
```

## Environment Configuration

**Required env vars (critical):**
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to Google Service Account JSON
- `GOOGLE_SHEET_ID` - Google Sheets ID for product data
- `OPENAI_API_KEY` - OpenAI API key
- `MACRODROID_WEBHOOK_URL` - WhatsApp webhook
- `FACEBOOK_PAGE_ID`, `FACEBOOK_ACCESS_TOKEN` - Facebook posting
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - OAuth
- `SESSION_SECRET` - Session signing (use `openssl rand -hex 32`)
- `DATABASE_URL` - PostgreSQL connection
- `ADMIN_GOOGLE_EMAIL` - Bootstrap admin
- `APP_BASE_URL` - Invite link base (e.g., https://affheav-production.up.railway.app)

**Optional env vars:**
- `SPOOME_API_KEY` - URL shortening (skipped if not set)
- `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET` - Product search
- `ALIEXPRESS_TRACKING_ID` - Default tracking ID (default: 'TechSalebuy')
- `GOOGLE_SHEET_NAME` - Tab name in Sheets (default: 'fishing')
- `OPENAI_MODEL` - GPT model (default: 'gpt-4.1-mini')
- `NODE_ENV` - 'production' or 'development'
- `PORT` - Server port (default 3000)

**Secrets location:**
- `.env` file (development)
- Railway environment variables (production)
- Google Service Account JSON at `config/google-service-account.json`
- Never committed to git

## Webhooks & Callbacks

**Incoming:**
- `POST /api/send` - Manual trigger or cron scheduler to broadcast a product
- MacroDroid → OpenAI → WhatsApp/Facebook/Instagram (reverse: scheduler calls out to services)

**Outgoing:**
- `MACRODROID_WEBHOOK_URL` - Trigger WhatsApp message sends
- `FACEBOOK_PAGE_ID/photos` - Post photos to Facebook
- `INSTAGRAM_ACCOUNT_ID/media` → `media_publish` - Publish to Instagram
- `OPENAI_API` - Generate marketing messages
- `ALIEXPRESS_API` - Query products
- `SPOOME_API` - Shorten links and fetch click stats
- `GOOGLE_SHEETS_API` - Fetch/update products and logs

## Subject Multi-Tenancy

**Per-Subject Configuration (Stored in DB):**
- Each "subject" (niche) has its own row in `subjects` table
- Includes:
  - `macrodroid_url` - Subject-specific MacroDroid webhook
  - `facebook_page_id`, `facebook_token` - Subject-specific Facebook page
  - `facebook_app_id`, `facebook_app_secret` - For token refresh
  - `instagram_account_id`, `instagram_access_token` - Subject-specific Instagram account
  - `openai_prompt_override` - Custom prompt for message generation (niche-specific)
  - `aliexpress_tracking_id` - Per-subject AliExpress tracking ID
- Products tagged with `subject_id` in PostgreSQL `products` table
- Schedules can be scoped to a specific subject via `subject_id` in `schedules` table

**Sensitive Fields:**
- API tokens and webhook URLs are stored encrypted in DB (at rest) and never sent to client
- Frontend receives only boolean presence indicators: `has_macrodroid_url`, `has_facebook_token`, etc.
- Implementation: `services/subjectService.js` (getSubjectById, getGroupsBySubject)

---

*Integration audit: 2026-04-15*
