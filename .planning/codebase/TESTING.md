# Testing Patterns

**Analysis Date:** 2026-04-15

## Test Framework

**Status:** No test runner or testing framework configured

**Not Configured:**
- Jest not configured
- Vitest not configured
- Mocha not configured
- No test scripts in `package.json`
- No test files (`.test.js`, `.spec.js`) in project source code (only in node_modules)

**Notes from CLAUDE.md:**
> No test runner or linter is configured.

**Implications:**
- Code quality relies on manual review and runtime verification
- All testing is manual or done via external tools (e.g., direct API calls, browser testing)
- Playwright is included as a dependency for web scraping, not testing

## Manual Testing Approach

**Current Practice:**
- Direct API calls via `curl`, Postman, or frontend UI
- Manual browser testing of frontend features
- Visual verification of log output and SSE streaming

**Entry Points for Testing:**
- **Backend:** Start dev server with `npm run dev` (node --watch server.js on port 3000)
- **Frontend:** Access `/` after authentication (login via Google OAuth)
- **API routes:** POST to `/api/send/execute`, `/api/products`, `/api/schedules`, etc.
- **Logs:** Monitor `/api/logs` (SSE stream) for real-time workflow execution

## Routes & Their Acceptance Criteria

**Authentication & Users:**
- `GET /api/me` — Verify user session is valid and roles display correctly
- `POST /auth/logout` — Verify session cleared and user redirected to login
- `GET /auth/invite/:token` — Verify invite token validation and Google OAuth flow
- `POST /api/users/invites` (admin) — Verify invitation email and token generation

**Products:**
- `GET /api/products?subject=:id` — Verify products filtered by subject; short_link not null
- `POST /api/products` — Verify product created with auto-generated short link and sort order
- `PUT /api/products/:id` — Verify partial updates work (subject, text, etc.)
- `DELETE /api/products/:id` — Verify cascade deletes (no orphaned product-schedule links)
- `POST /api/products/reorder` — Verify sort_order updated and persisted

**Send/Workflow:**
- `POST /api/send/execute` — Verify next unsent product fetched and sent to platforms
  - Platforms: WhatsApp, Facebook, Instagram
  - Check log entries created with send timestamps
  - Verify marked as sent in DB
- `POST /api/send/:id` — Verify specific product sent by ID
  - Respects user boundary (can't send other user's products)
  - Respects subject boundary (products matched to right subject credentials)

**Schedules:**
- `GET /api/schedules` — Verify cron schedules loaded from DB
- `POST /api/schedules` — Verify cron expression validated and stored
- `PATCH /api/schedules/:id` — Verify updates re-register in scheduler without restart
- `DELETE /api/schedules/:id` — Verify job immediately stopped

**Subjects (Niches):**
- `GET /api/subjects` — Verify subject list with stripped sensitive fields
  - `facebookToken`, `facebookAppSecret`, `aliexpressTrackingId` return boolean presence only
- `POST /api/subjects` — Verify new subject created with WhatsApp groups, Facebook settings, etc.
- `PUT /api/subjects/:id` — Verify settings updated (credentials, prompt override)
- `DELETE /api/subjects/:id` — Verify cascade deletes products and schedules in subject

## Manual Verification Patterns

**Frontend Verification:**
- Open browser DevTools Network tab
- Trigger action (e.g., send product, create schedule)
- Verify API response: `{ success: true, ... }`
- Check SSE log stream in `/api/logs` for events
- Verify UI updates correctly (product marked as sent, schedule added to calendar)

**Database Verification:**
- Connect to PostgreSQL directly
- Query tables: `SELECT * FROM products WHERE id = '...'`
- Verify `sent_at`, `facebook_at`, `instagram_at` timestamps populated
- Check `send_count` incremented

**Log Stream Verification:**
- Open `/api/logs` endpoint in browser or curl
- Trigger workflow action
- Observe real-time SSE events with timestamps and level (info/error/warn)
- Example:
  ```json
  {"ts":"2026-04-15T10:30:45.123Z","level":"info","msg":"Firing job: \"Daily 9am fishing\" (0 9 * * *)"}
  {"ts":"2026-04-15T10:30:46.456Z","level":"info","msg":"Sent product: fishing-link-123 → WhatsApp"}
  ```

## Testing Edge Cases

**Recommend Manual Testing For:**

**Authentication & Authorization:**
- Non-authenticated user accessing `/api/products` → 401 Unauthorized
- Regular user accessing `/api/users` (admin-only) → 403 Forbidden
- User attempting to delete another user's product → 404 Not found (filtered by user_id)
- Invite token expired (7 days old) → validation fails, user redirected with error

**Data Validation:**
- POST `/api/products` without `Link` field → 400 Bad Request: "Link and Text are required"
- POST `/api/products` with non-existent `whatsappGroupId` → Default to empty `wa_group`
- POST `/api/schedules` with invalid cron expression → 400 Bad Request: "Invalid cron"
- Update subject with empty `facebookToken` → Should not overwrite existing token (skip update)

**Concurrency & Race Conditions:**
- Rapid-fire send requests for same product → Should be processed sequentially; only one send_count increment
- Scheduler fires while manual send in progress → Both should complete safely (no transaction conflicts)
- Multiple users creating products simultaneously → sort_order should auto-increment without gaps

**Platform Integration:**
- WhatsApp: Verify MacroDroid webhook called with correct payload
- Facebook: Verify Graph API call with correct page ID and token
- Instagram: Verify Content Publishing API called with caption and media
- OpenAI: Verify API timeout after 30s; graceful fallback if rate-limited

**State Management:**
- User role changes from admin → user mid-session → Verify role immediately reflected on next request
- Subject credentials updated → Verify next send uses new credentials
- Schedule disabled → Verify cron job stopped immediately (within 60s flush window)

## Playwright Usage

**Purpose:** Web scraping (not testing)

**Location:** `scrapers/aliexpress.js`

**Usage:**
- `scrapeProduct(url)` — Extracts title, image, price from AliExpress product page
- `searchFishingProducts(opts)` — Searches fishing products, generates affiliate links via portal
- Fallback selectors: Tries multiple CSS selectors if page structure varies
- Error handling: Graceful timeout recovery; saves/loads cookies for portal session

**Not for Testing:**
- Playwright is not used for end-to-end or integration testing
- Only used for production scraping functionality

## Suggested Testing Additions

**If Automated Testing Were to Be Added:**

**Test Framework Recommendation:**
- Jest (or Vitest) for unit and integration tests
- Supertest for HTTP route testing
- Jest mocking for external services (OpenAI, Google Sheets API, PostgreSQL)

**Priority Test Areas:**
1. **Authentication:** Passport OAuth flow, invite validation, role-based access
2. **Workflow Pipeline:** Product fetch → AI message generation → Platform send → DB update
3. **Database Layer:** Query parameterization, transaction handling, data integrity
4. **Scheduler:** Cron parsing, job firing, concurrent execution safety
5. **Data Validation:** Input sanitization, boundary checks, error handling

**Example Test Structure (if implemented):**
```javascript
// routes/__tests__/products.test.js
describe('POST /api/products', () => {
  it('should create product with auto-generated short link', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ Link: 'https://example.com', Text: 'Test Product' });
    
    expect(res.status).toBe(200);
    expect(res.body.product.Link).toMatch(/^https:\/\/sp00\.me/);
  });
});
```

---

*Testing analysis: 2026-04-15*
