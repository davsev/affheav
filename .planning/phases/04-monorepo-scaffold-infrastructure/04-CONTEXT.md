# Phase 4: Monorepo Scaffold + Infrastructure - Context

**Gathered:** 2026-05-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the foundation every subsequent phase depends on: pnpm monorepo with Docker Compose local environment, GitHub Actions CI pipeline, Drizzle schema with per-service DB isolation, and shared packages. No service functionality is built here — this is pure infrastructure scaffold.

</domain>

<decisions>
## Implementation Decisions

### Monorepo structure
- pnpm workspaces
- `apps/` for runnable services (monolith, gateway, each microservice)
- `packages/` for shared code: `packages/types`, `packages/config`, `packages/db`
- Standard pnpm workspace convention

### Local development workflow
- Docker Compose only — everything runs in containers
- PostgreSQL, Redis, and all services run via `docker compose up`
- Consistent with production environment

### Migration strategy
- Drizzle migrations do NOT auto-run on service startup
- `RUN_MIGRATIONS=true` env var gates migration execution
- Manual trigger: developer runs `npm run migrate` before deploying
- Keeps migrations reviewable and safe from accidental prod schema changes

### CI checks (all must pass to merge)
- `tsc --noEmit` — type errors block merge
- Vitest — test failures block merge
- ESLint — lint errors block merge
- Conventional Commits title check — non-conforming PR titles block merge

### Claude's Discretion
- Exact Docker Compose service naming and port assignments
- Hot reload approach within containers (ts-node-dev, nodemon, or watch mode)
- ESLint config strictness level
- Specific Vitest configuration
- Per-service DB user naming convention

</decisions>

<specifics>
## Specific Ideas

- User wants to start coding immediately — keep scaffold lean, don't over-engineer shared packages upfront
- Existing monolith stays running throughout; the monorepo wraps it, not replaces it yet

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-monorepo-scaffold-infrastructure*
*Context gathered: 2026-05-02*
