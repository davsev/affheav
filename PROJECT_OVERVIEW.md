# Affiliate Heaven — Project Overview

## What You're Building (Owner's Vision)

You are building a **Hebrew affiliate marketing automation engine** — an invite-only SaaS dashboard for Israeli affiliate marketers (primarily fishing niche). The core idea: instead of manually posting products to WhatsApp groups, Facebook pages, and Instagram daily, the system does it automatically on a schedule, generates Hebrew marketing copy via OpenAI (culturally aware — Shabbat greetings, Motzei Shabbat, etc.), tracks clicks and commissions, and lets you manage multiple niches independently.

You are essentially replacing a manual daily workflow:
> "Pick a product → write a Hebrew post → send to 3 channels → log it → track earnings"

...with a fully automated pipeline that runs hands-free on a cron schedule.

---

## Architecture

```
Browser (Hebrew RTL UI)
        │
   Express.js (server.js)
        │
   ┌────┴──────────────────────────────────────────────┐
   │  Routes (products, schedules, broadcasts,          │
   │          subjects, analytics, send, scrape,        │
   │          users, facebook, prompt)                  │
   └────┬──────────────────────────────────────────────┘
        │
   ┌────┴─────────────────────────────────────────────────────┐
   │ Services                                                  │
   │  workflow.js → openai.js → whatsapp.js                    │
   │                          → facebook.js                    │
   │                          → instagram.js                   │
   │  broadcastDelivery.js (broadcast messages)                │
   │  subjectService.js / userService.js / broadcastService.js │
   │  googleSheets.js (legacy sync) / spooMe.js                │
   └────┬─────────────────────────────────────────────────────┘
        │
   PostgreSQL (primary DB)       Google Sheets (legacy/logs)
   node-cron scheduler           OpenAI / Facebook / Instagram APIs
   MacroDroid or whatsapp-web.js AliExpress Affiliate API / spoo.me
```

**Data flow for a product send:**
```
Cron fires → workflow.js → fetch next unsent product from DB
                         → OpenAI generates Hebrew message
                         → WhatsApp via MacroDroid webhook (or webjs)
                         → Facebook Graph API (photo post)
                         → Instagram Content Publishing API
                         → Mark product sent + log
```

---

## What the System Can Do

### Products
- Add, edit, delete products with image, text, affiliate link
- AI-generated Hebrew marketing copy (or manual override with `skip_ai`)
- URL shortening via spoo.me + click tracking
- Shuffle or drag-and-drop reorder the send queue
- Unsend a product (put it back in the queue)
- Filter by niche (subject)

### Scheduling
- Cron-based schedules: send next product automatically (daily, weekly, every N days)
- Fire any schedule immediately
- Enable/disable schedules
- Scoped to specific niches

### Broadcasts
- Recurring custom messages (not tied to a product) — e.g., a daily "good morning" or promo
- Optional image attachment
- Multi-recurrence options (daily at time X, every N days, specific weekdays)
- Send to WhatsApp groups + Facebook
- Fire immediately or on schedule
- Enable/disable

### Multi-Niche (Subjects)
- Each niche has its own: WhatsApp groups, Facebook page, Instagram account, MacroDroid webhook, AliExpress tracking ID, custom AI prompt, and per-channel toggles
- Credentials are per-niche and never exposed to the client (only presence indicators)
- Completely isolated — one niche's config doesn't affect another

### Analytics
- AliExpress commission sync (order snapshots, per-product breakdowns)
- ROAS calculation (commissions earned vs. ad spend)
- Join link click tracking via spoo.me
- Post insights (reach/impressions from Facebook/Instagram)

### Scraper / Product Discovery
- AliExpress product scraper (Playwright automation)
- Fishing auto-search (hot product discovery in fishing niche)
- Add scraped products directly to the send queue

### User Management
- Google OAuth login (invite-only)
- Admin/user roles
- Admin can invite users via tokenized link, suspend accounts, change roles
- All data isolated per user

### Logging
- Live SSE log stream in the UI (real-time, color-coded)
- Persistent log history (Google Sheets append-only log)

---

## What Has NOT Been Added Yet (Gap Analysis)

### 1. Human-readable Schedule Description
`broadcastService.js` stores recurrence as raw JSON and a cron expression, but never generates a description like _"Every day at 22:00"_ for display in the UI. The next-run time is shown but the schedule logic is not described in plain language.

### 2. Old Image Cleanup on Broadcast Update
When you upload a replacement image to a broadcast, the old file in `public/uploads/broadcasts/` is never deleted. Disk space will accumulate silently.

### 3. WhatsApp Delay Configuration
The 2-minute delay between WhatsApp group sends is hardcoded (`WA_GROUP_DELAY_MS = 120000`). There's no UI or per-subject setting to adjust this.

### 4. Instagram Broadcasts
`broadcastDelivery.js` sends to WhatsApp + Facebook only. Instagram is supported for _product sends_ (via `workflow.js`) but **not for broadcasts**. The code path simply doesn't call `instagram.js` from broadcast delivery.

### 5. Credential Encryption at Rest
Facebook tokens, Instagram credentials, AliExpress secrets are stored as plaintext in PostgreSQL. No encryption layer exists. This is a security gap for a multi-user SaaS.

### 6. Post Insights / Reach Tracking UI
The DB has `post_insights`, `join_link_click_snapshots`, and `ad_spend` tables fully defined, but there's no UI for manually entering ad spend, and no automated polling of Facebook post-reach after publishing.

### 7. Google Sheets Full Deprecation
The dual-store pattern (PostgreSQL primary + Sheets fallback) is partially maintained. `googleSheets.js` is still wired into `workflow.js` for logging, but the migration is incomplete — some code paths might still read from Sheets depending on runtime flags.

### 8. Mobile Push Notifications
The live log panel uses SSE. There's no push notification support to alert you when a product send fails or a schedule fires successfully on mobile.

### 9. Product Performance Feedback Loop
There's no automated logic to promote high-click products back to the top of the queue, or to suppress low-performing products based on analytics data.

---

## What You Wanted to Achieve (Inferred Intent)

You wanted to **free yourself from manual daily marketing work** while running multiple affiliate niches in parallel. Specifically:

1. **Zero-touch daily operations** — Products go out automatically at the right times without you touching the phone or keyboard.
2. **Cultural relevance** — Hebrew messages that feel human, with Friday greetings and post-Shabbat acknowledgments baked in — something a generic scheduler tool would never do.
3. **Multi-niche scalability** — Run fishing, electronics, home goods, etc. all from one dashboard without accounts bleeding into each other.
4. **Revenue visibility** — Know exactly which product, which niche, and which channel is making money (ROAS, AliExpress commissions, click tracking).
5. **Invite-only control** — Potentially let others (partners, VAs) use the tool with limited permissions, without giving them full access.
6. **Self-hosted / low-cost** — Railway deployment, Google Sheets as a free database fallback, spoo.me for free click tracking — keeping infrastructure costs near zero.

The endgame is a personal affiliate automation platform that could also be offered to other Israeli affiliate marketers as a SaaS product.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `server.js` | Express app, OAuth, SSE, route mounting |
| `services/workflow.js` | Core send pipeline orchestrator |
| `services/openai.js` | Hebrew message generation |
| `services/whatsapp.js` | WhatsApp delivery (MacroDroid or webjs) |
| `services/facebook.js` | Facebook Graph API posting |
| `services/instagram.js` | Instagram Content Publishing API |
| `services/broadcastDelivery.js` | Broadcast message delivery |
| `services/broadcastService.js` | Broadcast CRUD + recurrence logic |
| `services/subjectService.js` | Niche CRUD + credential masking |
| `services/googleSheets.js` | Legacy Sheets integration |
| `services/spooMe.js` | URL shortening + click stats |
| `scheduler/index.js` | node-cron job manager |
| `db/migrate.js` | PostgreSQL schema (idempotent) |
| `public/app.js` | Vanilla JS frontend (1631 lines) |
| `routes/analytics.js` | AliExpress commissions + ROAS |
| `routes/broadcasts.js` | Broadcast CRUD + fire-now |
| `routes/products.js` | Product CRUD + queue management |
| `routes/subjects.js` | Niche CRUD + WhatsApp groups |
| `routes/users.js` | User mgmt + invites (admin) |
| `scrapers/aliexpress.js` | Playwright product scraper |
