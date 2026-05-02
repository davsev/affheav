# Phase 4: Monorepo Scaffold + Infrastructure - Research

**Researched:** 2026-05-02
**Domain:** pnpm monorepo, Docker Compose, Drizzle ORM migrations, GitHub Actions CI, PostgreSQL per-service isolation
**Confidence:** HIGH (core stack well-established; patterns verified against official docs and community sources)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- pnpm workspaces monorepo
- `apps/` for runnable services (monolith, gateway, each microservice)
- `packages/` for shared code: `packages/types`, `packages/config`, `packages/db`
- Standard pnpm workspace convention
- Docker Compose only — everything runs in containers; PostgreSQL, Redis, and all services run via `docker compose up`
- Drizzle migrations do NOT auto-run on service startup; `RUN_MIGRATIONS=true` env var gates migration execution; manual trigger: `npm run migrate`
- CI must pass: `tsc --noEmit`, Vitest, ESLint, Conventional Commits title check

### Claude's Discretion
- Exact Docker Compose service naming and port assignments
- Hot reload approach within containers (ts-node-dev, nodemon, or watch mode)
- ESLint config strictness level
- Specific Vitest configuration
- Per-service DB user naming convention

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | Developer can run all services locally with `docker compose up` | Docker Compose multi-service pattern + init scripts for DB setup |
| INFRA-02 | pnpm workspace monorepo with shared TypeScript config, ESLint, and Prettier | pnpm `pnpm-workspace.yaml`, root tsconfig.base.json, root ESLint flat config |
| INFRA-03 | Shared `packages/db` holds Drizzle ORM schema used by all services | `workspace:*` protocol, Drizzle schema export pattern |
| INFRA-04 | Each service has its own PostgreSQL schema and dedicated DB user with no cross-schema access | postgres init script at `/docker-entrypoint-initdb.d/`, per-schema GRANT pattern |
| INFRA-05 | Redis available in Docker Compose for BullMQ from day one | `redis:7-alpine` service in compose, no special config needed |
| INFRA-06 | Branch merge deadline policy enforced: feature branches merged within 21 days or rebased | GitHub PR description / CONTRIBUTING.md convention, not a technical artifact |
| CI-01 | GitHub Actions CI runs on every PR: `tsc --noEmit` + Vitest unit tests + ESLint | `pnpm/action-setup` + `actions/setup-node` workflow pattern |
| CI-02 | PR title validated against Conventional Commits format | `amannn/action-semantic-pull-request` GitHub Action |
| CI-03 | `commitlint` enforces Conventional Commits in CI pipeline | `@commitlint/cli` + `@commitlint/config-conventional` + commitlint GitHub Action |
| TEST-05 | Vitest unit tests required for every new service function before phase complete | Vitest workspace config, per-package `vitest.config.ts` |
</phase_requirements>

---

## Summary

Phase 4 is a pure scaffold phase. The output is a working pnpm monorepo directory tree, a Docker Compose environment that boots all infrastructure, a GitHub Actions CI pipeline, and a Drizzle migrations gate — no business logic is written. The existing monolith (`server.js` at repo root) stays untouched; the monorepo wraps it as `apps/monolith` or a symlink.

The three most technically involved pieces are: (1) getting TypeScript workspace cross-package imports to resolve cleanly both in `ts-node` dev mode and inside Docker build contexts, (2) wiring per-service PostgreSQL schemas/users with GRANT boundaries enforced by an init script, and (3) keeping the `RUN_MIGRATIONS=true` gate correct in the Drizzle startup path. Everything else (pnpm, Vitest, ESLint, CI) is well-understood boilerplate.

**Primary recommendation:** Use `tsconfig` path aliases in a root `tsconfig.base.json` with `composite: true` project references so `tsc --noEmit` traverses the full workspace in one command. Use Docker Compose `develop.watch` (Compose Watch, v2.22+) for hot reload instead of ts-node-dev to avoid polling issues on macOS.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pnpm | 9.x | Package manager + workspace orchestration | Strict hoisting, fastest installs, native `workspace:*` protocol |
| TypeScript | 5.x | Type checking across all packages | Already decided; `tsc --noEmit` CI gate |
| Drizzle ORM | 0.45.2 | DB schema-as-code, type-safe migrations | Locked in STATE.md |
| drizzle-kit | latest | Migration generation CLI | Pairs with Drizzle ORM |
| Vitest | 4.1.5 | Unit test runner | Locked in STATE.md |
| ESLint | 9.x (flat config) | Lint | v9 flat config is current standard |
| Docker Compose | v2.22+ | Local dev environment | Locked; enables Compose Watch |
| PostgreSQL | 16-alpine | Primary DB | Current stable, small image |
| Redis | 7-alpine | BullMQ queue backend | Locked in STATE.md |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@commitlint/cli` + `@commitlint/config-conventional` | latest | CI commit/PR message linting | CI-03 |
| `amannn/action-semantic-pull-request` | v5 | PR title Conventional Commits check | CI-02 — simplest option, no commitlint dependency |
| `pnpm/action-setup` | v4 | pnpm in GitHub Actions | Required for pnpm commands in CI |
| `prettier` | 3.x | Formatting (shared config) | INFRA-02 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Compose Watch | nodemon + volume mounts | nodemon needs `-L` polling flag on macOS inside Docker, Compose Watch handles this cleanly |
| Compose Watch | ts-node-dev | ts-node-dev is unmaintained as of 2023 |
| amannn/action-semantic-pull-request | commitlint GitHub Action on PR title | Both work; `action-semantic-pull-request` is simpler and more widely maintained |
| ESLint flat config | `.eslintrc` legacy | Legacy config deprecated in ESLint 9 |

### Installation
```bash
# Root
pnpm init
# Create pnpm-workspace.yaml
# Then per-package:
pnpm add -D typescript vitest eslint prettier @commitlint/cli @commitlint/config-conventional
pnpm add drizzle-orm
pnpm add -D drizzle-kit
```

---

## Architecture Patterns

### Recommended Project Structure
```
/                              # repo root (existing monolith files stay here during transition)
├── pnpm-workspace.yaml        # workspaces: ['apps/*', 'packages/*']
├── tsconfig.base.json         # shared compilerOptions, no include/exclude
├── eslint.config.js           # flat config, shared rules
├── .prettierrc                # shared formatting
├── commitlint.config.js       # extends @commitlint/config-conventional
├── docker-compose.yml         # all services + postgres + redis
├── docker-compose.override.yml # dev overrides (Compose Watch, port exposure)
├── apps/
│   ├── monolith/              # symlink or copy of existing server.js + its deps
│   │   ├── package.json       # name: @affiliate/monolith
│   │   ├── tsconfig.json      # extends ../../tsconfig.base.json
│   │   └── Dockerfile
│   └── gateway/               # Phase 5 — scaffold package.json now, impl later
│       ├── package.json       # name: @affiliate/gateway
│       └── tsconfig.json
└── packages/
    ├── types/                 # shared TypeScript interfaces/enums
    │   ├── package.json       # name: @affiliate/types
    │   ├── tsconfig.json
    │   └── src/index.ts
    ├── config/                # shared env-var parsing, zod schemas
    │   ├── package.json       # name: @affiliate/config
    │   ├── tsconfig.json
    │   └── src/index.ts
    └── db/                    # Drizzle schema + migration runner
        ├── package.json       # name: @affiliate/db
        ├── tsconfig.json
        ├── drizzle.config.ts
        └── src/
            ├── schema/        # per-service schema files
            ├── index.ts       # exports schema + db client factory
            └── migrate.ts     # migrate() gated by RUN_MIGRATIONS=true
```

### Pattern 1: workspace:* Protocol for Cross-Package Imports
**What:** Package references use `"@affiliate/types": "workspace:*"` in `package.json` — pnpm resolves to the local package, not npm registry.
**When to use:** All cross-package dependencies in this monorepo.
**Example:**
```json
// apps/gateway/package.json
{
  "name": "@affiliate/gateway",
  "dependencies": {
    "@affiliate/types": "workspace:*",
    "@affiliate/config": "workspace:*",
    "@affiliate/db": "workspace:*"
  }
}
```

### Pattern 2: TypeScript Composite + Project References
**What:** Root `tsconfig.base.json` sets shared options; each package has its own `tsconfig.json` with `composite: true` and `references` to its dependencies. Running `pnpm -r tsc --noEmit` type-checks all packages in dependency order.
**When to use:** Required for `pnpm -r tsc --noEmit` to traverse the workspace correctly.
**Example:**
```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "incremental": true
  }
}

// packages/db/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}

// apps/gateway/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "composite": true, "outDir": "dist", "rootDir": "src" },
  "references": [
    { "path": "../../packages/types" },
    { "path": "../../packages/config" },
    { "path": "../../packages/db" }
  ],
  "include": ["src"]
}
```

### Pattern 3: Drizzle Migration Gate
**What:** `migrate.ts` in `packages/db` wraps `drizzle-kit migrate` behind a runtime `RUN_MIGRATIONS=true` check. Each service's entrypoint calls this at startup but only applies migrations when the flag is set.
**When to use:** Every service startup (INFRA-03, and the success criterion).
**Example:**
```typescript
// packages/db/src/migrate.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

export async function runMigrationsIfEnabled(connectionString: string, migrationsFolder: string) {
  if (process.env.RUN_MIGRATIONS !== 'true') {
    console.log('[db] RUN_MIGRATIONS not set — skipping migrations');
    return;
  }
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder });
  await pool.end();
  console.log('[db] Migrations applied');
}
```

### Pattern 4: PostgreSQL Schema Isolation via Init Script
**What:** A shell script at `docker/postgres/init.sql` (mounted to `/docker-entrypoint-initdb.d/`) creates per-service schemas and DB users. Each user is GRANTed only on its own schema — cross-schema writes fail with `permission denied`.
**When to use:** INFRA-04 enforcement.
**Example:**
```sql
-- docker/postgres/01-init.sql
-- Auth service
CREATE SCHEMA IF NOT EXISTS auth;
CREATE USER auth_svc WITH PASSWORD 'auth_password';
GRANT USAGE ON SCHEMA auth TO auth_svc;
GRANT CREATE ON SCHEMA auth TO auth_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_svc;

-- Products service
CREATE SCHEMA IF NOT EXISTS products;
CREATE USER products_svc WITH PASSWORD 'products_password';
GRANT USAGE ON SCHEMA products TO products_svc;
GRANT CREATE ON SCHEMA products TO products_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA products GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO products_svc;

-- Explicitly: auth_svc has NO GRANT on products schema → cross-boundary write = permission denied
```

### Pattern 5: Docker Compose Watch for Hot Reload
**What:** Docker Compose v2.22+ `develop.watch` section rebuilds or syncs files on change without needing nodemon or polling flags.
**When to use:** Every service in `docker-compose.override.yml`.
**Example:**
```yaml
# docker-compose.override.yml
services:
  monolith:
    develop:
      watch:
        - action: sync
          path: ./apps/monolith/src
          target: /app/src
        - action: rebuild
          path: ./apps/monolith/package.json
```

### Pattern 6: GitHub Actions CI for pnpm Monorepo
**What:** Single workflow file installs pnpm, caches node_modules, then runs `tsc`, `vitest`, and `eslint` across the workspace. Separate job for PR title check.
**Example:**
```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:

jobs:
  lint-pr-title:
    runs-on: ubuntu-latest
    steps:
      - uses: amannn/action-semantic-pull-request@v5
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          types: [feat, fix, refactor, chore, test, docs, ci, perf]

  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r tsc --noEmit
      - run: pnpm -r vitest run
      - run: pnpm -r eslint .
```

### Anti-Patterns to Avoid
- **Single `node_modules` assumption in Docker:** Each service Dockerfile must run `pnpm install --frozen-lockfile` after copying `pnpm-lock.yaml` and all `package.json` files — don't rely on host `node_modules` being present inside the container.
- **`paths` in tsconfig without `moduleResolution: NodeNext`:** Using `paths` with `bundler` resolution mode breaks `ts-node` in Node services. Use `NodeNext` + `workspace:*` package.json deps instead of `paths` for cross-package imports.
- **Running `drizzle-kit generate` in Docker:** Generate migrations locally and commit them. Only `migrate` runs in CI/production — never `generate`.
- **Single postgres superuser for all services:** Defeats INFRA-04; must use per-schema users from day one.
- **Mixing `tsc --build` and `tsc --noEmit`:** They serve different purposes. `--noEmit` is the CI gate; `--build` with composite is for incremental local builds. Don't mix them in CI.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PR title conventional commits check | Custom regex GitHub Action | `amannn/action-semantic-pull-request` | Handles all edge cases (revert, WIP, scopes, breaking changes) |
| Monorepo TypeScript path resolution | Custom `tsconfig.paths` resolver | `workspace:*` protocol + project references | `paths` breaks at runtime in `ts-node`; workspace protocol is resolved by Node module resolution |
| DB schema permission enforcement | Application-level tenant checks | PostgreSQL GRANT + separate DB users | DB-level enforcement is the only reliable boundary; app checks can be bypassed |
| Migration auto-discovery | Custom file glob runner | `drizzle-kit migrate` with `drizzle.config.ts` | Drizzle handles ordering, checksums, and idempotency |
| Monorepo task orchestration | Custom shell scripts | `pnpm -r <cmd>` | pnpm `-r` (recursive) respects workspace dependency order |

---

## Common Pitfalls

### Pitfall 1: TypeScript Path Resolution Breaks Inside Docker
**What goes wrong:** `@affiliate/types` imports resolve on the host (IDE works) but fail inside Docker build context with "Cannot find module" errors.
**Why it happens:** Docker COPY doesn't know about pnpm symlinks in `node_modules/.pnpm`. If you COPY only the app directory, workspace packages aren't present.
**How to avoid:** In each service Dockerfile, COPY from the monorepo root — not just the service directory — so that `packages/` and `pnpm-lock.yaml` are available before `pnpm install`.
**Warning signs:** Build succeeds locally but fails in `docker build`; CI passes but Docker image crashes on import.

### Pitfall 2: macOS File Watching Polling in Docker
**What goes wrong:** Nodemon inside a Docker container on macOS doesn't detect file changes — the container never restarts.
**Why it happens:** macOS Docker uses a VM; inotify events don't cross the VM boundary reliably.
**How to avoid:** Use Compose Watch (`develop.watch` in docker-compose.override.yml) which uses Docker's own sync mechanism, or force nodemon's legacy polling with `-L` flag. Compose Watch is preferred.
**Warning signs:** Editing a file doesn't trigger container restart; `docker compose watch` is not running.

### Pitfall 3: `pnpm -r tsc --noEmit` Fails for Unrelated Reason
**What goes wrong:** `tsc --noEmit` recursively fails on packages that don't yet have code (empty `src/` or missing `index.ts`).
**Why it happens:** `composite: true` requires `rootDir` to match `include`; an empty package has no files matching the include glob.
**How to avoid:** Add a placeholder `src/index.ts` (even just `export {};`) to every package stub created in this phase.

### Pitfall 4: Postgres Init Script Only Runs Once
**What goes wrong:** Changes to `docker/postgres/01-init.sql` aren't applied when re-running `docker compose up`.
**Why it happens:** `/docker-entrypoint-initdb.d/` only runs on first container creation (when the data volume is empty).
**How to avoid:** `docker compose down -v` (destroys the volume) before `up` when you need to re-apply init scripts during development. Document this clearly.

### Pitfall 5: Drizzle `drizzle.config.ts` Schema Paths
**What goes wrong:** `drizzle-kit generate` discovers schema files from all packages, producing one mega-migration instead of per-service migrations.
**Why it happens:** `schema` glob in `drizzle.config.ts` is too broad.
**How to avoid:** Each service that needs migrations should have its own `drizzle.config.ts` pointing only to its schema files. `packages/db` holds schema definitions but each service runs its own migration set against its own schema.

---

## Code Examples

### Root `pnpm-workspace.yaml`
```yaml
# Source: https://pnpm.io/workspaces
packages:
  - 'apps/*'
  - 'packages/*'
```

### Root `package.json` scripts
```json
{
  "name": "affiliate-heaven-monorepo",
  "private": true,
  "scripts": {
    "typecheck": "pnpm -r tsc --noEmit",
    "test": "pnpm -r vitest run",
    "lint": "pnpm -r eslint .",
    "dev": "docker compose -f docker-compose.yml -f docker-compose.override.yml up"
  }
}
```

### Docker Compose skeleton
```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: affiliate_heaven
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/postgres:/docker-entrypoint-initdb.d

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  monolith:
    build:
      context: .
      dockerfile: apps/monolith/Dockerfile
    environment:
      DATABASE_URL: postgresql://monolith_svc:monolith_password@postgres:5432/affiliate_heaven
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis

volumes:
  postgres_data:
```

### Vitest workspace config
```typescript
// vitest.workspace.ts (root)
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*/vitest.config.ts',
  'apps/*/vitest.config.ts',
]);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ts-node-dev for TypeScript hot reload | Node.js `--watch` flag (built-in) or Compose Watch | Node 18+ / Compose 2.22 (2023) | No extra dependency; more reliable in containers |
| `.eslintrc.json` legacy config | `eslint.config.js` flat config | ESLint 9 (2024) | New format required in ESLint 9; all shared configs must be updated |
| `yarn workspaces` | `pnpm workspaces` | Industry shift 2022-2024 | Faster, stricter, less phantom dependencies |
| Drizzle ORM beta | Drizzle ORM 0.45.x stable | 2024 | STATE.md locks to 0.45.2 — do not use 1.0.0-beta |

**Deprecated/outdated:**
- `ts-node-dev`: Last published 2022, effectively unmaintained — avoid as hot reload solution
- ESLint `extends` in `.eslintrc`: Still works but deprecated in ESLint 9; plan for flat config from the start

---

## Open Questions

1. **Monolith placement in monorepo**
   - What we know: The existing `server.js` lives at repo root; moving it risks breaking Railway deployment config
   - What's unclear: Whether to create `apps/monolith/` as a copy/symlink or leave root-level files in place and treat the root as the monolith package
   - Recommendation: Create `apps/monolith/` with its own `package.json` (name: `@affiliate/monolith`) and move existing files there. Update Railway start command to `node apps/monolith/server.js`. This is cleaner than a hybrid root.

2. **Railway PostgreSQL multi-schema user grants**
   - What we know: STATE.md flags this as needing verification before Phase 4 DB design is finalized
   - What's unclear: Railway's managed Postgres may restrict `CREATE USER` and `GRANT` — superuser access may not be available
   - Recommendation: Before implementing INFRA-04 grant scripts, verify Railway Postgres permissions. If restricted, use schema-level row security (RLS) as a fallback boundary. The Docker Compose init script is unambiguous; production may need a migration that runs as the Railway admin user.

3. **INFRA-06 enforcement mechanism**
   - What we know: "Feature branches merged within 21 days or rebased" is a policy requirement
   - What's unclear: Whether this needs a GitHub Action (stale branch bot), a CONTRIBUTING.md statement, or a branch protection rule
   - Recommendation: Add a `CONTRIBUTING.md` entry and a GitHub stale bot action (e.g., `actions/stale`) configured for branches, not just issues. This is lightweight and satisfies the requirement.

---

## Sources

### Primary (HIGH confidence)
- [pnpm workspaces official docs](https://pnpm.io/workspaces) — workspace:* protocol, pnpm-workspace.yaml format
- [Drizzle ORM migrations docs](https://orm.drizzle.team/docs/migrations) — migrate() API, drizzle.config.ts
- [Docker Hub postgres image](https://hub.docker.com/_/postgres) — /docker-entrypoint-initdb.d/ init script behavior

### Secondary (MEDIUM confidence)
- [amannn/action-semantic-pull-request](https://github.com/amannn/action-semantic-pull-request) — PR title Conventional Commits GitHub Action (well-maintained, widely used)
- [Compose Watch DEV article](https://dev.to/mdazhar1038/using-docker-compose-watch-with-nodejs-2pb0) — Docker Compose Watch for Node.js hot reload
- [TypeScript project references — Nx Blog](https://nx.dev/blog/typescript-project-references) — composite + references pattern for monorepos
- [pnpm monorepo starter](https://github.com/firxworx/fx-pnpm-monorepo-starter) — reference implementation with vitest + eslint

### Tertiary (LOW confidence — training data + single source)
- ESLint 9 flat config compatibility with shared monorepo config — verify ESLint docs for exact flat config export pattern before writing `eslint.config.js`

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions locked in STATE.md, pnpm docs verified
- Architecture: HIGH — patterns are standard industry practice, verified against multiple sources
- Pitfalls: MEDIUM — Docker macOS volume/watch pitfalls verified; Postgres init-once behavior is documented

**Research date:** 2026-05-02
**Valid until:** 2026-08-02 (stable tooling; Drizzle version pin reduces drift risk)
