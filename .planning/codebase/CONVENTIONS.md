# Coding Conventions

**Analysis Date:** 2026-04-15

## Naming Patterns

**Files:**
- `kebab-case` for files: `server.js`, `schedule-modal.js`, `schedule-builder.js`
- Service files: `camelCase.js` in `services/` directory, e.g., `userService.js`, `subjectService.js`, `inviteService.js`
- Route files: `kebab-case.js` in `routes/` directory, e.g., `send.js`, `products.js`, `users.js`
- Scrapers: descriptive lowercase, e.g., `aliexpress.js`

**Functions:**
- `camelCase` for regular functions: `findUser()`, `createUser()`, `markSent()`
- Private functions prefixed with `_`: `_row()`, `_cache()`, `_cacheGet()`, `_waRow()`, `_formatRow()`
- Helper/utility functions: `camelCase`, e.g., `shortenUrl()`, `sleep()`, `emitLog()`
- Event handlers: verb prefix: `toggleSidebar()`, `closeSidebar()`, `showLoginPage()`, `hideLoginPage()`
- Async functions: same casing as sync, no special prefix

**Variables:**
- `camelCase` for local variables: `shortLink`, `sortOrder`, `productId`, `userId`
- Constants: `UPPERCASE_SNAKE_CASE`: `CACHE_TTL`, `INVITE_EXPIRY_DAYS`, `LOG_HISTORY_MAX`, `SENSITIVE`, `WA_GROUP_DELAY_MS`
- Module-scope state prefixed with `_`: `_emit`, `_pendingLogs`, `_runWorkflow`, `_log`, `_cache`
- Loop counters: `i`, `j` (generic iteration variables)

**Types & Data Shapes:**
- Object field names in API responses use `camelCase`: `id`, `email`, `googleId`, `createdAt`, `subjectId`
- Database column names use `snake_case`: `google_id`, `created_at`, `subject_id`
- Transformation functions map between DB rows and API objects: `_row(r)` pattern in services
- Product objects use mixed naming for compatibility: `Link`, `Text`, `sent`, `wa_group` (from legacy Google Sheets schema)

## Code Style

**Formatting:**
- No linter or formatter configured
- Indentation: 2 spaces (observed throughout codebase)
- Line length: ~100-120 characters (long SQL queries and function signatures may exceed)
- Single quotes for strings: `'text'` (JavaScript)
- Double quotes for JSDoc: `"string"`
- Semicolons: Present at end of statements
- Blank lines: Used to separate logical sections within functions and between methods

**Linting:**
- No ESLint configuration present
- No Prettier configuration present
- Code follows basic Node.js/Express conventions implicitly

**Section Headers:**
- Use ASCII art dividers for major sections:
  ```
  // ── Section Name ──────────────────────────────────────────────────────────────
  ```
- Used in `server.js` for: Session, Passport/Google OAuth, Public Auth Routes, SSE Log Stream
- Used in service files to group related functions

## Import Organization

**Order:**
1. Node.js core modules: `require('fs')`, `require('path')`
2. Third-party packages: `require('express')`, `require('pg')`, `require('dotenv')`
3. Local modules: `require('../db')`, `require('../services/userService')`
4. ES6 imports for frontend: `import { api } from './utils.js'`

**Path Aliases:**
- No path aliases configured
- Relative paths used throughout: `../db`, `../services/`, `./`
- Frontend uses relative ES6 imports: `from './utils.js'`, `from './schedule-modal.js'`

**Examples:**
- Backend services: `const { query } = require('../db');` followed by domain services
- Routes: `const { findUser } = require('../services/userService');`
- Frontend: `import { api, escHtml } from './utils.js';`

## Error Handling

**Patterns:**
- `try/catch` blocks in async route handlers and service functions
- Error responses use consistent JSON structure: `{ success: false, error: err.message }`
- HTTP status codes used appropriately:
  - `400` for validation errors: missing required fields, invalid input
  - `401` for unauthenticated requests
  - `403` for unauthorized (insufficient permissions)
  - `404` for resource not found
  - `500` for server errors
- Silent error suppression in non-critical operations: `try { ... } catch { /* ignore */ }`
  - Used in scraper fallback logic: trying multiple CSS selectors, falling back to cached data
  - Used in cookie loading: local file, then Google Sheets, then null
- Validation before operations: check existence before update/delete
- Error propagation: service functions throw Error with descriptive message, routes catch and format

**Examples:**
```javascript
// Route error handling
try {
  const user = await findUser(googleId);
  return done(null, user);
} catch (err) {
  return done(err);
}

// Service validation
const inv = await validateToken(inviteToken);
if (!inv || inv.email.toLowerCase() !== email.toLowerCase()) {
  return done(null, false, { message: 'invalid_invite' });
}

// Silent fallback
try {
  const saved = await getSetting('portal_cookies');
  if (saved) return JSON.parse(saved);
} catch { /* ignore */ }
return null;
```

## Logging

**Framework:** `console` only (no logging library)

**Patterns:**
- `console.log()` for info messages
- `console.error()` for errors
- `console.warn()` for warnings
- Custom log function with log level: `log(msg, level = 'info')`
- Prefixed logs: `[module-name]` convention in `services/workflow.js`, `services/userService.js`
  - Example: `console.log('[products]', ...a);`
- Emoji markers in informational logs: `✓ Loaded prompt`, `📅 Scheduled jobs`
- Server provides SSE log streaming via `/api/logs` for real-time UI updates
- Pending logs buffered in-memory and flushed to Google Sheets every 60 seconds

**Usage:**
- Info: `console.log('User created')`
- Warn: `console.warn('[scheduler] Could not load from DB:', err.message)`
- Error: `console.error('[db] Unexpected pool error:', err.message)`

## Comments

**When to Comment:**
- Block headers for major sections (see Section Headers above)
- Inline comments for non-obvious logic: timezone handling, cookie fallback chain
- Data flow explanations: "Primary data store: products, schedules, settings, logs"
- Document business rules: "Store only user id in session; re-fetch on every request for live role/status"
- Multi-step algorithms: each significant step on new line

**JSDoc/TSDoc:**
- Minimal use; typically only for public APIs
- Used in database module: documents `query()` function parameters
- Format: Block comment with `/**`, parameter docs, return type
- Example from `db/index.js`:
  ```javascript
  /**
   * Run a query against the pool.
   * @param {string} text - SQL query
   * @param {Array} [params] - query parameters
   */
  async function query(text, params) { ... }
  ```

## Function Design

**Size:** 
- Typical range: 10-40 lines per function
- Some helper functions are 2-5 lines (sleep, cache accessors)
- Service functions mixing data transformation and DB queries: 20-80 lines (e.g., `createSubject()`, `updateSubject()`)
- No observable limit; functions kept to single responsibility

**Parameters:**
- Positional for required params: `findUser(googleId)`, `deleteUser(id)`
- Destructuring for optional/multiple fields: `async function generateMessage({ Text, Link, join_link, promptOverride } = {})`
- Options objects for configuration: `browser.newContext({ userAgent: '...' })`
- SQL parameters passed as arrays to prepared statement calls

**Return Values:**
- Service functions return data objects (user, subject, product)
- Data transformation functions return null on empty result: `_row(null)` returns `null`
- Query helpers return pg result objects: `{ rows, rowCount, fields }`
- Async handlers return promises; routes send JSON responses
- Null for "not found" is preferred over undefined in service layer

## Module Design

**Exports:**
- Each service exports an object with named functions: `module.exports = { findUser, createUser, ... }`
- One export per file; barrel files not used
- Route files export a single `router` object via `module.exports = router`
- Frontend ES6 modules export individual functions: `export async function api() { ... }`

**Barrel Files:**
- Not used in this codebase
- Each service is imported directly by name: `require('../services/userService')`

**File-to-Module Mapping:**
- `db/index.js` exports `{ query, pool }` — database access
- `services/userService.js` exports user CRUD functions
- `services/subjectService.js` exports subject and WhatsApp group management
- `services/workflow.js` exports workflow orchestration and product-send pipeline
- `services/openai.js` exports `{ generateMessage }`
- `routes/*.js` export Express router
- `scheduler/index.js` exports scheduler control functions

## Database Query Patterns

**Parameterized Queries:**
- All queries use numbered parameters: `$1`, `$2`, `$3`
- Parameters passed as array: `query(sql, [userId, email])`
- Prevents SQL injection; all user input parameterized

**Dynamic SQL Construction:**
- Build `SET` clauses dynamically for UPDATE statements
- Pattern: track update list and parameter index
  ```javascript
  const updates = [];
  const values = [];
  let i = 1;
  
  if (fields.name !== undefined) {
    updates.push(`name = $${i++}`);
    values.push(fields.name);
  }
  // ...
  query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${i} ...`, values)
  ```

**Data Transformation:**
- Helper function `_row()` converts DB rows to API objects
- Converts `snake_case` DB columns to `camelCase` API fields
- Returns `null` if row is empty
- Cached in memory by userService (60s TTL) to reduce DB hits on session re-fetch

---

*Convention analysis: 2026-04-15*
