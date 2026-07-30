# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

**Affiliate Heaven** is a Node.js/Express dashboard that automates affiliate product broadcasting to WhatsApp groups, Facebook pages, and Instagram accounts on a cron schedule.

The AI Product Discovery (Discover tab) and Autonomous Product Agent (Products tab drafts) subsystems are documented in `services/CLAUDE.md` — also relevant when touching `routes/discover.js` or `routes/products.js`, since their approve/reject endpoints and status filtering depend on that agent behavior.

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

### Sensitive Fields

API tokens, webhook URLs, and credentials are never sent to the client — only boolean presence indicators are returned from subject/settings endpoints.

### Google Sheets Structure

- **`fishing` tab** — Products (columns: long_url, Link, image, _, Text, join_link, wa_group, sent, facebook, clicks, subject, instagram)
- **Settings tab** — Key-value pairs: schedules (JSON), openai_prompt, subjects (JSON), etc.
- **Logs tab** — Append-only audit trail; flushed from in-memory buffer every 60 seconds

### Environment Setup

Copy `.env.example` → `.env` and fill in all variables (see that file for the full list). Place Google Service Account JSON at `config/google-service-account.json`.
