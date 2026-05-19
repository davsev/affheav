# Stack Research

**Domain:** Node.js microservices — affiliate marketing automation platform
**Researched:** 2026-04-29
**Confidence:** MEDIUM-HIGH (versions verified via npm/web search; some beta versions noted)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Hono | 4.12.14 | HTTP framework for each microservice | Fastest Node.js framework in 2026, first-class TypeScript, runs on Node 20+, smallest bundle. Fits lightweight services that don't need Fastify's plugin ecosystem. Built-in JWT middleware via `@hono/jwt`. |
| Drizzle ORM | 0.45.2 (stable) or 1.0.0-beta.22 | PostgreSQL schema + type-safe queries + migrations | Lightweight, no runtime overhead, schema-as-code, `drizzle-kit generate` produces SQL migrations stored in repo. Replaces existing raw `pg` + manual SQL in `db/migrate.js`. |
| BullMQ | 5.75.2 | Scheduler → job queue → broadcaster pipeline | Replaces direct cron-to-workflow coupling. Scheduler service enqueues jobs; broadcaster service consumes them. Redis-backed, excellent TypeScript types, active development. |
| ioredis | 5.x | Redis client for BullMQ | BullMQ's required peer dependency; handles connection pooling and reconnection. |
| Vitest | 4.1.5 | Unit testing per service | ESM-native, fast, compatible with pnpm workspaces via `vitest.projects` config. No separate Jest config needed per service. |
| React 19 | latest | Frontend SPA | Required by Mantine 9. |
| Mantine | 9.0.2 | React component library | Current version as of April 2026. First-class RTL via `DirectionProvider`, dark mode via `MantineProvider defaultColorScheme="dark"`, all data components included. No custom CSS needed. |
| pnpm | 9.x | Package manager + workspaces | 3x faster than npm, content-addressable store eliminates duplicate packages across services, native `workspace:*` protocol for internal linking, `--filter` for targeted commands. |
| TypeScript | 5.x | Type safety across all services | Required for Drizzle schema types, Hono route typing, shared types package. |
| jose | 5.x | JWT sign/verify | Web Standards-compliant, works with Hono's JWT middleware, supports RS256. The auth service signs JWTs; all other services verify via middleware. |
| Node.js built-in `crypto` | — | AES-256-GCM credential encryption | No extra dependency. `crypto.createCipheriv('aes-256-gcm', key, iv)` is production-quality. Use GCM (not CBC) for authenticated encryption. Only the `ENCRYPTION_KEY` env var is needed. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@hono/node-server` | latest | Hono adapter for Node.js | Every service that runs on Node.js (not edge). Wrap app: `serve({ fetch: app.fetch })`. |
| `drizzle-kit` | 0.30.x (stable) / beta | Migration generation + push | Run `drizzle-kit generate` in CI to produce SQL files. Run `drizzle-kit migrate` on startup. |
| `zod` | 3.x | Request validation schemas | Hono has built-in Zod validator middleware (`@hono/zod-validator`). Define once, reuse in shared types package. |
| `pino` | 9.x | Structured JSON logging | Lightweight, fast. Each service logs to stdout; Railway/Docker collects. |
| `@types/node` | 22.x | Node.js type definitions | Needed for crypto, fs, process in TypeScript. |
| `tsx` | latest | TypeScript execution in dev | Replaces `ts-node`; faster, no config needed. Use for scripts and dev server. |
| `postcss-preset-mantine` | latest | Mantine RTL + dark CSS mixins | Required for `rtl` and `light`/`dark` PostCSS mixins in frontend. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| pnpm workspaces | Monorepo package management | `pnpm-workspace.yaml` at root listing `apps/*` and `packages/*` |
| Docker Compose | Local multi-service dev environment | One container per service + Redis + PostgreSQL |
| GitHub Actions | CI: tsc + Vitest on every PR | `pnpm -r test` runs all workspace tests |
| Vitest projects config | Run all service tests from monorepo root | `vitest.config.ts` at root with `projects: ['apps/*/vitest.config.ts']` |
| Prettier + ESLint | Code formatting + lint | Shared configs in `packages/config/` workspace |

## Installation

```bash
# Root monorepo setup
pnpm init
# pnpm-workspace.yaml: packages: ['apps/*', 'packages/*']

# Shared packages
pnpm add -w typescript @types/node tsx prettier eslint vitest

# Per service (e.g., apps/auth-service)
pnpm --filter auth-service add hono @hono/node-server @hono/zod-validator jose zod pino drizzle-orm pg
pnpm --filter auth-service add -D drizzle-kit vitest @vitest/coverage-v8

# Scheduler + broadcaster services
pnpm --filter scheduler-service add bullmq ioredis
pnpm --filter broadcaster-service add bullmq ioredis

# Frontend
pnpm --filter frontend add @mantine/core @mantine/hooks @mantine/dates postcss postcss-preset-mantine react react-dom
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Hono | Fastify | If you need Fastify's plugin ecosystem (fastify-jwt, fastify-multipart, etc.) or JSON Schema validation is a hard requirement. Fastify is better when migrating a large Express app that already uses express-compatible middleware. |
| Hono | Express (existing) | Never for new services — keep Express only in the monolith fallback during Strangler Fig. |
| Drizzle ORM stable (0.45.x) | Drizzle ORM beta (1.0.0-beta.x) | Beta has breaking migration behavior changes (no more `IF NOT EXISTS` in generated SQL). Use stable for production services; beta only if you want to track v1 path. |
| Node.js built-in `crypto` | `@noble/ciphers` | Only if you need pure-JS (no native bindings) for cross-runtime or auditable code. Noble is ESM-only now — adds complexity. Built-in crypto is simpler for Node.js-only services. |
| Mantine 9 | Mantine 7 | v7 is end-of-life (v7.17.8 final). v8→v9 migration path exists. Use v9 for all new development. |
| jose | jsonwebtoken | `jsonwebtoken` is synchronous, CommonJS-only, uses Node.js-specific APIs. `jose` is async, ESM-compatible, Web Standards API — fits Hono's design. |
| BullMQ | node-cron (existing) | Keep node-cron only in the monolith fallback. BullMQ provides retries, dead-letter queues, job history, and worker concurrency. |
| pnpm workspaces | Turborepo | Turborepo adds caching and task pipelines. Useful at large scale. For this project (10-12 services), plain pnpm workspaces are sufficient — no extra tool needed. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `express-session` / `passport` in new services | Session-based auth couples services to a shared session store. Stateless JWT removes this. | `jose` for JWT sign/verify in auth service; Hono JWT middleware in all other services |
| `node-cron` in microservices | Direct cron-to-function coupling; no retry, no distributed coordination. | BullMQ: scheduler enqueues, broadcaster consumes |
| Raw `pg` + manual SQL | Existing pattern in `db/migrate.js`; no type safety, migration drift risk. | Drizzle ORM with `drizzle-kit generate` |
| `localStorage` for JWT | XSS-vulnerable. | `httpOnly` cookie (or `Authorization: Bearer` header for API-to-API) |
| Google Sheets as data store | Legacy bridge; already planned for retirement. | PostgreSQL via Drizzle ORM |
| `ts-node` | Slow startup, complex config with ESM. | `tsx` for scripts/dev; compile to JS for production |
| `yarn` or `npm` in monorepo | Slower than pnpm, phantom dependency problem, no content-addressable store. | pnpm workspaces |
| Mantine < v9 | v7 and v8 are superseded; v9.0.2 is current as of April 2026. | Mantine 9 |
| `crypto` CBC mode for credential encryption | CBC lacks authentication — vulnerable to padding oracle attacks. | AES-256-GCM via built-in `crypto` (authenticated encryption) |

## Stack Patterns by Variant

**Monorepo root structure:**
```
affiliate-heaven/
  apps/
    auth-service/         # Hono + jose + Drizzle
    user-service/         # Hono + Drizzle + crypto (AES-256-GCM)
    products-service/     # Hono + Drizzle
    subjects-service/     # Hono + Drizzle
    ai-writer-service/    # Hono + OpenAI SDK
    channels-service/     # Hono + axios adapters (FB, Instagram, MacroDroid)
    scheduler-service/    # Hono + node-cron (reads DB) + BullMQ producer
    broadcaster-service/  # BullMQ consumer + pipeline orchestration
    api-gateway/          # Hono + JWT middleware + rate limiting
    frontend/             # React 19 + Mantine 9 + Vite
  packages/
    config/               # Shared tsconfig, eslint, prettier configs
    types/                # Shared TypeScript interfaces (User, Product, Subject, etc.)
    db/                   # Shared Drizzle schema + drizzle config
  pnpm-workspace.yaml
  vitest.config.ts        # Root config pointing to all service vitest configs
  docker-compose.yml
```

**AES-256-GCM credential encryption pattern (user-service):**
```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex') // 32 bytes

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decrypt(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const encrypted = buf.subarray(28)
  const decipher = createDecipheriv(ALGO, KEY, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final('utf8')
}
```

**Mantine 9 RTL + dark mode bootstrap (frontend):**
```tsx
// main.tsx
import { MantineProvider, DirectionProvider } from '@mantine/core'
import '@mantine/core/styles.css'

<DirectionProvider initialDirection="rtl">
  <MantineProvider defaultColorScheme="dark">
    <App />
  </MantineProvider>
</DirectionProvider>
```
Also set `<html dir="rtl" lang="he">` in `index.html`.

**Drizzle migration pattern (per service or shared db package):**
- Schema defined in `packages/db/schema.ts`
- `drizzle-kit generate` → SQL files in `packages/db/migrations/`
- On service startup: `import { migrate } from 'drizzle-orm/node-postgres/migrator'; await migrate(db, { migrationsFolder: './migrations' })`
- Use stable 0.45.x; avoid beta until v1.0.0 is released

**BullMQ monorepo pattern:**
- `packages/queue-types/` — shared job payload TypeScript interfaces
- `scheduler-service` imports `Queue` from bullmq, enqueues jobs
- `broadcaster-service` imports `Worker` from bullmq, processes jobs
- Both connect to the same Redis instance (Docker Compose local, Railway Redis addon in production)

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Mantine 9.0.2 | React 19 | React 19 required. Check peer deps if downgrading to React 18. |
| BullMQ 5.75.2 | ioredis 5.x | BullMQ 5.x requires ioredis 5.x (not 4.x). |
| Drizzle ORM 0.45.2 | drizzle-kit 0.30.x | Keep drizzle-orm and drizzle-kit versions aligned — mismatches cause migration errors. |
| Hono 4.12.14 | @hono/node-server latest | Always update together; node-server adapter tracks hono major version. |
| Vitest 4.1.5 | Vite 6.x | Vitest 4.x requires Vite 6.x. Frontend uses Vite; services use Vitest without Vite (Node environment). |
| jose 5.x | Node 20+ | jose v5 is ESM-only. Ensure all services have `"type": "module"` in package.json or use tsx for dev. |

## Sources

- [Hono vs Fastify — Better Stack](https://betterstack.com/community/guides/scaling-nodejs/hono-vs-fastify/) — framework comparison
- [Hono npm](https://www.npmjs.com/package/hono) — version 4.12.14 confirmed
- [Drizzle ORM Migrations docs](https://orm.drizzle.team/docs/migrations) — migration patterns
- [Drizzle ORM releases](https://github.com/drizzle-team/drizzle-orm/releases) — v1.0.0-beta.22 vs stable 0.45.2
- [BullMQ npm](https://www.npmjs.com/package/bullmq) — version 5.75.2 confirmed
- [BullMQ in a Monorepo — OneUptime](https://oneuptime.com/blog/post/2026-01-21-bullmq-monorepo-setup/view) — monorepo structure pattern
- [Vitest npm](https://www.npmjs.com/package/vitest) — version 4.1.5 confirmed
- [Vitest Workspace docs](https://vitest.dev/guide/projects) — projects config (replaces workspace.ts, deprecated in 3.2)
- [Mantine all releases](https://mantine.dev/changelog/all-releases/) — v9.0.2 current as of April 2026
- [Mantine RTL docs](https://mantine.dev/styles/rtl/) — DirectionProvider setup
- [Mantine color schemes docs](https://mantine.dev/theming/color-schemes/) — dark mode setup
- [Node.js AES-256 built-in crypto](https://ssojet.com/encryption-decryption/aes-256-in-nodejs) — GCM vs CBC
- [JWT auth in Node.js microservices 2026 — WorkOS](https://workos.com/blog/nodejs-authentication-guide-2026) — stateless JWT best practices
- [pnpm workspaces](https://pnpm.io/workspaces) — workspace protocol, filter flag

---
*Stack research for: Affiliate Heaven v2.0 — Microservices Rebuild*
*Researched: 2026-04-29*
