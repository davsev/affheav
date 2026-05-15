# AGENTS.md

Agent and AI assistant instructions for the **Affiliate Heaven** project.
This file defines conventions, constraints, and best practices that all agents must follow.

---

## Project Overview

Affiliate Heaven automates affiliate product broadcasting to WhatsApp groups, Facebook pages, and Instagram accounts. The codebase is currently a Node.js/Express monolith being incrementally migrated to a **microservices architecture** using the Strangler Fig pattern — one service at a time, keeping the monolith running throughout.

---

## Architecture & Migration Strategy

- **Current state:** Node.js/Express monolith with PostgreSQL and Google Sheets (legacy sync)
- **Target state:** Independent microservices — auth, user, products, ai-writer, channels, scheduler, broadcaster, frontend
- **Migration approach:** Strangler Fig — extract one service at a time behind the same `/api/v1/` surface. Never break existing functionality while refactoring.
- **Service communication:** BullMQ + Redis for async jobs; direct HTTP for synchronous calls between services
- **New services use:** TypeScript, Fastify or Hono, Drizzle ORM, Zod validation, Vitest

---

## Commit & PR Standards

All commit messages and PR titles **must** follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

**Format:** `<type>(<scope>): <description>`

**Types:**
- `feat` — new feature
- `fix` — bug fix
- `refactor` — code change without behavior change
- `test` — adding or updating tests
- `chore` — tooling, deps, config
- `docs` — documentation only
- `ci` — CI/CD changes
- `perf` — performance improvement

**Examples:**
```
feat(user-service): add per-user credential encryption with AES-256
fix(scheduler): prevent duplicate cron jobs on hot reload
refactor(products): extract DB queries into repository layer
test(auth): add unit tests for invite token validation
ci: add GitHub Actions workflow for Vitest on PR
```

---

## Security Review (Mandatory)

**Every PR and every set of code changes must be reviewed with `/security-review` before merging.**

This is non-negotiable. No exceptions for "small" or "infrastructure-only" changes — the hardcoded password incident in Phase 4 came from exactly that assumption.

Run it as the last step before opening or updating a PR:
```
/security-review
```

The review must pass (no high-severity findings) before the branch is merged to `main`.

---

## Security Rules (Non-Negotiable)

### Input Validation
- **Every** API endpoint must validate its input with a Zod schema before any business logic runs.
- Reject unknown fields — use `z.object({ ... }).strict()` or strip extras explicitly.
- Return `400` with a structured error on validation failure — never let invalid data reach the DB.

```typescript
// ✅ correct
const schema = z.object({ email: z.string().email(), subjectId: z.string().uuid() });
const parsed = schema.safeParse(req.body);
if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.flatten() });

// ❌ wrong
const { email, subjectId } = req.body; // no validation
```

### Credential Storage
- User API keys (Facebook tokens, AliExpress secrets, WhatsApp webhook URLs, Instagram tokens) are **never** stored as environment variables.
- All per-user credentials live in the `user_credentials` table, encrypted at rest with AES-256.
- Only **system-level** values belong in env vars: `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `SESSION_SECRET`, `ENCRYPTION_KEY`, etc.
- Credentials are **never** sent to the client. Return only boolean presence indicators: `{ hasFacebookToken: true }`.

### Authentication & Authorization
- All `/api/*` routes require authentication. Never skip the auth middleware.
- Role checks (`admin` vs `user`) must happen server-side on every request — never trust client-sent role claims.
- Admin-only endpoints must check `req.user.role === 'admin'` explicitly.
- Use JWT (stateless) in new services; do not use session cookies in microservices.

### SQL Injection Prevention
- Use parameterized queries exclusively: `query('SELECT * FROM users WHERE id = $1', [id])`
- Never concatenate user input into SQL strings.

### Sensitive Data in Logs
- Never log credentials, tokens, or personally identifiable information.
- Redact sensitive fields before logging: `{ ...subject, facebookToken: '[REDACTED]' }`

---

## Code Style & Quality

### General
- **Readability over cleverness.** Code is written once, read many times. Prefer explicit over implicit.
- **Abstract over specific.** Write generic utilities; avoid hard-coding platform-specific logic in shared modules.
- **Single responsibility.** Each function does one thing. If a function needs a comment explaining what each section does, split it.
- **No silent failures.** Catch errors explicitly. Log and propagate; do not swallow errors silently in critical paths.

### Naming
- Files: `kebab-case` for routes/scripts; `camelCase` for services (`userService.ts`)
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Database columns: `snake_case`
- API response fields: `camelCase`
- Private/module-scoped state: prefix with `_`

### TypeScript (new services)
- Strict mode enabled: `"strict": true` in `tsconfig.json`
- No `any` — use `unknown` and narrow explicitly
- Define explicit return types on all exported functions
- Use `interface` for shapes that can be extended; `type` for unions and mapped types

### Error Handling
- Use structured error responses: `{ success: false, error: string, errors?: object }`
- HTTP status codes:
  - `400` — validation error / bad request
  - `401` — unauthenticated
  - `403` — unauthorized (wrong role)
  - `404` — resource not found
  - `409` — conflict (duplicate)
  - `500` — unexpected server error
- Service functions throw typed errors; route handlers catch and format them.
- External API calls (Facebook, WhatsApp, AliExpress, OpenAI) must be wrapped in a **circuit breaker**. A failure on one channel must not block others.

### Imports
Order: Node core → third-party → local (separated by blank lines).

---

## API Standards

- All routes versioned from day one: `/api/v1/...`
- Each service exposes an OpenAPI/Swagger spec (auto-generated, e.g., via `@fastify/swagger`)
- RESTful resource naming: plural nouns, lowercase, kebab-case: `/api/v1/user-credentials`
- Use HTTP methods semantically: `GET` reads, `POST` creates, `PUT` replaces, `PATCH` updates partial, `DELETE` removes
- Pagination on list endpoints: `?page=1&limit=20`; response includes `{ data, total, page, limit }`

---

## Database

### Schema Principles
- Normalized — no redundant columns
- `snake_case` column names
- All tables have: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()`
- Foreign keys must have explicit constraints (no orphan rows)
- Soft deletes where audit trail matters: `deleted_at TIMESTAMPTZ`

### Core Tables (target schema)
```
users               — id, email, google_id, role, created_at
user_credentials    — id, user_id, provider, key_name, encrypted_value, created_at
subjects            — id, user_id, name, created_at  (niches)
products            — id, subject_id, user_id, url, image_url, text, sent_at, created_at
schedules           — id, subject_id, user_id, cron_expression, enabled, created_at
broadcast_messages  — id, subject_id, user_id, label, text, image_url, cron_expression, enabled, created_at
logs                — id, user_id, subject_id, action, payload, created_at
invitations         — id, email, token, invited_by, accepted_at, expires_at, created_at
```

### Migrations
- Idempotent `CREATE TABLE IF NOT EXISTS` for schema bootstrapping
- Migrations run on startup when `DATABASE_URL` is set
- Never mutate existing column types in-place in production without a migration plan

---

## Testing

- **Unit tests are required** for every new function, service method, and utility.
- Test runner: **Vitest**
- Test files: co-located next to the source file — `userService.test.ts` beside `userService.ts`
- Test naming: describe what the function does, not how — `it('returns null when user is not found')`
- Mock external dependencies (DB, HTTP clients) — unit tests must not make real network calls
- Aim for edge cases: empty input, invalid types, missing optional fields, error paths
- Integration tests for service boundaries (DB interactions) use a test database

```typescript
// Example structure
describe('findUser', () => {
  it('returns the user when found by googleId', async () => { ... });
  it('returns null when user does not exist', async () => { ... });
  it('throws when DB query fails', async () => { ... });
});
```

### CI
- GitHub Actions runs Vitest on every PR targeting `main`
- PRs cannot be merged if tests fail
- CI also runs TypeScript type-check (`tsc --noEmit`)

---

## External Integrations

- Wrap every external API call (Facebook Graph, WhatsApp/MacroDroid, Instagram, AliExpress, OpenAI, spoo.me) in a circuit breaker
- Never let one platform's failure propagate to others in the broadcast pipeline
- Retry transient errors (network timeouts) with exponential backoff — max 3 attempts
- Log every outbound API call with: provider, action, success/failure, duration

---

## Environment Variables

Only system-level values belong in env vars. Per-user credentials go in the DB.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `ENCRYPTION_KEY` | AES-256 key for encrypting user credentials |
| `REDIS_URL` | BullMQ / queue connection |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth 2.0 (system-wide) |
| `GOOGLE_CALLBACK_URL` | OAuth redirect URI |
| `SESSION_SECRET` | Session signing (monolith only) |
| `JWT_SECRET` | JWT signing (new services) |
| `ADMIN_GOOGLE_EMAIL` | Bootstrap super-admin on first login |
| `APP_BASE_URL` | Invite link generation |
| `NODE_ENV` | `development` or `production` |
| `PORT` | Service port |

---

## What Not To Do

- Do not store user API keys, tokens, or webhook URLs in `.env` files
- Do not send credentials or tokens to the client
- Do not skip input validation on any endpoint
- Do not use `any` in TypeScript
- Do not write a function longer than ~60 lines without a strong reason — split it
- Do not commit secrets, `.env` files, or `config/google-credentials.json`
- Do not silently swallow errors in critical code paths
- Do not break the running monolith while extracting a service (Strangler Fig — keep both working)
- Do not add new env vars for per-user configuration — use `user_credentials` table instead
