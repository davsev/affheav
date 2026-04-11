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
- **routes/** — One file per resource: products, send, schedules, subjects, facebook, prompt, scrape, aliexpress-api
- **public/app.js** — Vanilla JS frontend (1631 lines), Hebrew RTL dark-theme UI

### Multi-Niche (Subjects)

Each "subject" (niche) has its own WhatsApp group, Facebook page, Instagram account, MacroDroid webhook, and optional OpenAI prompt override. Products are tagged with `subject=id` in Google Sheets column K. Schedules can be scoped to a specific subject.

### Authentication

Google OAuth 2.0 via Passport.js. Optional email whitelist via `ALLOWED_GOOGLE_EMAIL` env var. Session-based (30-day cookie). All `/api/*` routes require authentication.

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
```
