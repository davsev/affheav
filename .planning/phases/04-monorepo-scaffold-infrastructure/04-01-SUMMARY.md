---
phase: 04-monorepo-scaffold-infrastructure
plan: "01"
status: complete
---

# Plan 04-01 Summary: pnpm Workspace Root + Shared Package Scaffold

## What Was Done

Created the pnpm monorepo foundation alongside the existing monolith — no existing files were moved or modified (except `package.json` which gained `private: true`, devDependencies, and workspace scripts).

**Files created:**
- `pnpm-workspace.yaml` — declares `apps/*` and `packages/*` globs
- `tsconfig.base.json` — shared `NodeNext` + strict TypeScript config
- `eslint.config.js` — ESLint 9 flat config with `@eslint/js`
- `.prettierrc` — shared formatting config
- `commitlint.config.js` — Conventional Commits enforcement
- `vitest.workspace.ts` — Vitest workspace pointing to `packages/*/vitest.config.ts` and `apps/*/vitest.config.ts`
- `packages/types/` — `@affiliate/types` package with placeholder `export {}`
- `packages/config/` — `@affiliate/config` package, depends on `@affiliate/types` via `workspace:*`

## Verification

- `pnpm install` completed cleanly, all devDependencies installed
- `pnpm -r run typecheck` passes with zero errors across both packages
- `packages/config` correctly references `packages/types` via `workspace:*` symlink

## Notes

- Root `typecheck` script uses `pnpm -r run typecheck` (not `pnpm -r tsc --noEmit` which looks for a script named `tsc`)
- Monolith `server.js` and all `routes/`, `services/` files are untouched
