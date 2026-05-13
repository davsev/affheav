---
phase: 04-monorepo-scaffold-infrastructure
plan: "03"
status: complete
---

# Plan 04-03 Summary: packages/db (Drizzle) + GitHub Actions CI

## What Was Done

Completed the two remaining Phase 4 success criteria not covered by Plans 01–02.

### packages/db — Drizzle ORM scaffold (INFRA-03)

**Files created:**
- `packages/db/package.json` — `@affiliate/db`, depends on `@affiliate/types` + `drizzle-orm 0.45.2` + `pg`
- `packages/db/tsconfig.json` — composite build, references `packages/types`
- `packages/db/drizzle.config.ts` — points to `src/schema/index.ts`, outputs to `migrations/`, gated by `DATABASE_URL`
- `packages/db/src/schema/index.ts` — placeholder with comments for Phase 6–10 table definitions
- `packages/db/src/migrate.ts` — `runMigrationsIfEnabled()` gated behind `RUN_MIGRATIONS=true`; does nothing when flag is absent
- `packages/db/src/index.ts` — re-exports schema + migrate using `.js` extensions (NodeNext requirement)
- `packages/db/vitest.config.ts` — standard node environment

Also updated `apps/monolith/Dockerfile` to COPY `packages/db/package.json` for proper layer caching.

### GitHub Actions CI (CI-01, CI-02, CI-03)

**File created:**
- `.github/workflows/ci.yml` — two jobs:
  - `lint-pr-title`: `amannn/action-semantic-pull-request@v5` enforces Conventional Commits on PR titles
  - `ci`: `pnpm install --frozen-lockfile` → `pnpm -r run typecheck` → `pnpm -r run test` → `pnpm -r run lint`

Added `test` and `lint` scripts to all packages (types, config, db, gateway) so `-r run` recurses cleanly.

## Verification

- `pnpm -r run typecheck` passes across all 5 packages (types, config, db, gateway) with zero errors
- Fixed: `src/index.ts` in `packages/db` used `.ts` extensions in re-exports — corrected to `.js` (NodeNext requires the compiled extension in import paths)
- CI workflow validates on every PR; `lint-pr-title` job blocks non-Conventional Commits titles

## Phase 4 Success Criteria Status

| Criterion | Met |
|-----------|-----|
| 1. `docker compose up` starts postgres, redis, monolith with health checks | ✅ Plan 02 |
| 2. `pnpm -r run typecheck` passes across all packages | ✅ Plans 01+03 |
| 3. GitHub Actions CI runs tsc, Vitest, ESLint + PR title check on every PR | ✅ Plan 03 |
| 4. New service can import from `@affiliate/types` and `@affiliate/config` | ✅ Plan 01 |
| 5. `RUN_MIGRATIONS=true` gate enforced in `packages/db` | ✅ Plan 03 |

**Phase 4 is complete.**
