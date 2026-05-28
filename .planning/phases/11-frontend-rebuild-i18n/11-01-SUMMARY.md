---
phase: 11-frontend-rebuild-i18n
plan: 01
subsystem: apps/web
tags: [scaffold, vite, react19, mantine9, i18n, auth, axios]
dependency_graph:
  requires: []
  provides: [apps/web scaffold, RTL providers, JWT auth store, axios interceptors, i18n init]
  affects: [all phase-11 plans]
tech_stack:
  added: [vite@6, react@19, mantine@9, i18next@25, react-i18next@15, axios@1, zustand@5]
  patterns: [zustand for in-memory token store, axios interceptors for silent refresh, bundler moduleResolution]
key_files:
  created:
    - apps/web/package.json
    - apps/web/tsconfig.json
    - apps/web/vite.config.ts
    - apps/web/index.html
    - apps/web/src/main.tsx
    - apps/web/src/App.tsx
    - apps/web/src/lib/auth.ts
    - apps/web/src/lib/api.ts
    - apps/web/src/lib/i18n.ts
    - apps/web/src/locales/he.json
    - apps/web/src/locales/en.json
  modified:
    - apps/web/tsconfig.json (lib fix for Mantine 9 compat)
decisions:
  - "ESNext.Collection added to tsconfig lib — Mantine 9 @mantine/hooks uses ReadonlySetLike which is not in ES2022 but is in ESNext.Collection"
  - "742 i18n keys seeded directly from public/i18n/strings.js into he.json and en.json"
metrics:
  duration: 2 min
  completed: "2026-05-28"
  tasks_completed: 2
  files_created: 11
---

# Phase 11 Plan 01: Vite + React 19 + Mantine 9 Scaffold Summary

Bootstrapped `apps/web` pnpm workspace package with RTL dark-mode Mantine providers, zustand JWT auth store, axios interceptors for silent token refresh, and i18next initialized with Hebrew + English locale files seeded from the existing `public/i18n/strings.js`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Bootstrap apps/web package | 4bacf2b | package.json, tsconfig.json, vite.config.ts, index.html |
| 2 | Wire providers, auth store, axios interceptors, i18n | bab9f38 | main.tsx, App.tsx, auth.ts, api.ts, i18n.ts, he.json, en.json |

## Verification

- `pnpm --filter web run typecheck` exits 0
- `apps/web/index.html` has `lang="he" dir="rtl"` on `<html>`
- `apps/web/src/locales/he.json` contains 742 keys from `public/i18n/strings.js`
- `apps/web/src/locales/en.json` contains 742 keys with English translations

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed tsconfig lib incompatibility with Mantine 9**
- **Found during:** Task 2 typecheck
- **Issue:** `@mantine/hooks@9.2.2` uses `ReadonlySetLike<T>` in `use-set.d.ts`, which is not defined in ES2022 lib
- **Fix:** Added `"ESNext.Collection"` to the `lib` array in `tsconfig.json`
- **Files modified:** `apps/web/tsconfig.json`
- **Commit:** bab9f38

## Self-Check: PASSED
- apps/web/src/main.tsx: FOUND
- apps/web/src/lib/auth.ts: FOUND
- apps/web/src/lib/api.ts: FOUND
- apps/web/src/lib/i18n.ts: FOUND
- apps/web/src/locales/he.json: FOUND
- apps/web/src/locales/en.json: FOUND
- Commit 4bacf2b: FOUND
- Commit bab9f38: FOUND
