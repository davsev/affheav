# Affiliate Heaven — Project Context

## What this project is
A Node.js/Express web dashboard that replaces an n8n workflow for automated affiliate marketing.
It sends fishing product promotions to a WhatsApp group and a Facebook page on a schedule.

## What the original n8n workflow did
1. Triggered on a schedule (daily 11:00, 17:00 + Friday special times for Jewish Sabbath greetings)
2. Read the next unsent product from a Google Sheet (`fishing` tab)
3. Used GPT-4.1-mini to generate a Hebrew WhatsApp marketing message
4. Sent the message + image to a WhatsApp group via a MacroDroid webhook (Android automation)
5. Posted the same message + image to a Facebook page via Graph API
6. Marked the row as sent in Google Sheets (columns: `sent`, `facebook`)

## Google Sheet
- **Sheet ID:** `1sLhVM8btTRGYVpv8PSSZviTPiQht7VZc6E2UAioqqSE`
- **Tab name:** `fishing`
- **Columns:** `Link`, `image`, `Text`, `join_link`, `wa_group`, `sent`, `facebook`

## What has been built (all code complete, deps installed)

```
affiliate-heaven/
├── server.js                   ✅ Express app + SSE log stream
├── package.json                ✅ deps installed (node_modules present)
├── .env.example                ✅ template for all secrets
├── .gitignore                  ✅
├── config/
│   └── schedules.json          ✅ default cron jobs matching n8n
├── services/
│   ├── googleSheets.js         ✅ getAllProducts, getNextUnsent, markSent, addProduct
│   ├── openai.js               ✅ Hebrew message generator (exact n8n prompt, + day-of-week logic)
│   ├── whatsapp.js             ✅ MacroDroid webhook POST
│   ├── facebook.js             ✅ Graph API photo post + token refresh
│   └── workflow.js             ✅ orchestrates full pipeline, emits SSE logs
├── scheduler/
│   └── index.js                ✅ node-cron manager (load/save/start/stop/add/remove)
├── scrapers/
│   └── aliexpress.js           ✅ Playwright scraper stub (replace body with your automation)
├── routes/
│   ├── products.js             ✅ GET/POST /api/products
│   ├── send.js                 ✅ POST /api/send/:rowNumber, POST /api/send/execute
│   ├── schedules.js            ✅ GET/POST/PUT/DELETE /api/schedules
│   ├── scrape.js               ✅ POST /api/scrape/aliexpress
│   └── facebook.js             ✅ POST /api/facebook/refresh-token
└── public/
    ├── index.html              ✅ RTL Hebrew dashboard (dark theme)
    └── app.js                  ✅ Vanilla JS frontend
```

## Dashboard tabs
| Tab | Purpose |
|---|---|
| מוצרים | Products table from Google Sheet + "Send Now" per row |
| לוחות זמנים | Add/remove/toggle cron jobs |
| סריקת AliExpress | Paste URL → Playwright scrapes + adds to sheet |
| הוסף מוצר | Manual product entry form |
| לוג | Live SSE log stream |

## What still needs to be done

### 1. Set up `.env` (REQUIRED before running)
```bash
cp .env.example .env
# then fill in:
OPENAI_API_KEY=...
MACRODROID_WEBHOOK_URL=https://trigger.macrodroid.com/59197a13-7731-47af-81fd-76ce46da38d7/n8n
FACEBOOK_PAGE_ID=993730403813933
FACEBOOK_ACCESS_TOKEN=...   # long-lived page token
GOOGLE_SHEET_ID=1sLhVM8btTRGYVpv8PSSZviTPiQht7VZc6E2UAioqqSE
GOOGLE_SHEET_NAME=fishing
GOOGLE_APPLICATION_CREDENTIALS=./config/google-service-account.json
```

### 2. Google Sheets authentication (REQUIRED)
Two options:
- **Service account (recommended):**
  1. Google Cloud Console → IAM → Service Accounts → Create → download JSON key
  2. Save as `config/google-service-account.json`
  3. Share the Google Sheet with the service account email (Editor access)
- **OAuth2 (alternative):** Can reuse credentials from the `youtube-video-creator` project next door

### 3. Facebook long-lived token
The token in the n8n workflow is short-lived. Use the dashboard's "רענן טוקן FB" button
(requires `FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET` in `.env`) to exchange for a 60-day token.

### 4. Wire in existing Playwright automation
Open `scrapers/aliexpress.js` and replace the `scrapeProduct()` function body with
the user's existing Playwright automation. The interface is:
```js
// Input:  url (string)
// Output: { text, image, affiliateLink }
```

### 5. Run and verify
```bash
node server.js
# → http://localhost:3000
```

## Key credentials in original n8n workflow
- MacroDroid webhook: `https://trigger.macrodroid.com/59197a13-7731-47af-81fd-76ce46da38d7/n8n`
- Facebook Page ID: `993730403813933`
- Google Sheet ID: `1sLhVM8btTRGYVpv8PSSZviTPiQht7VZc6E2UAioqqSE`
- Sheet tab: `fishing`

## Notes
- Scheduler runs in **Asia/Jerusalem** timezone (matches Israeli Shabbat-aware schedule)
- The Hebrew prompt detects Friday / Saturday night and adds appropriate greetings automatically
- The `sent` column update uses the row's `Link` value as the match key (same as n8n)
- `.claude/launch.json` is already configured — run `preview_start "affiliate-heaven"` to start
