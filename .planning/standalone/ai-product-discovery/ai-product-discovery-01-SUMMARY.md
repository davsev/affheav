---
phase: ai-product-discovery
plan: "01"
subsystem: discovery-backend
tags: [aliexpress, discovery, product-suggestions, postgresql]
dependency_graph:
  requires: []
  provides: [product_suggestions table, passesFilters shared utility, runDiscovery service, /api/discover routes]
  affects: [routes/aliexpress-api.js, db/migrate.js, server.js]
tech_stack:
  added: []
  patterns: [shared filter utility, lateral join for keyword extraction, ON CONFLICT DO NOTHING upsert]
key_files:
  created:
    - services/aliexpressFilters.js
    - services/discoveryAgent.js
    - routes/discover.js
  modified:
    - db/migrate.js
    - routes/aliexpress-api.js
    - server.js
decisions:
  - Extracted passesFilters to shared module to avoid duplication between aliexpress-api and discoveryAgent
  - Hebrew keyword detection via /[֐-׿]/ regex to skip untranslatable subject names
  - Fallback to all subjects when no high-performing products (clicks > 3 or commission record) found
  - Sequential AliExpress searches with 1s delay to stay within rate limits
metrics:
  duration: "~8 min"
  completed: "2026-05-03"
  tasks_completed: 3
  files_changed: 6
---

# Phase ai-product-discovery Plan 01: Discovery Backend Summary

**One-liner:** Product suggestions DB table + AliExpress discovery agent with shared filter utility and REST routes.

## What Was Built

The backend foundation for the AI product discovery feature:

1. **`services/aliexpressFilters.js`** — Shared `passesFilters()` function (rate > 80%, volume > 50, stock > 100 if present), extracted from `routes/aliexpress-api.js` to eliminate duplication.

2. **`db/migrate.js`** — New `product_suggestions` table with `UNIQUE(user_id, aliexpress_id)` constraint and indexes on `user_id` and `(user_id, status)`.

3. **`services/discoveryAgent.js`** — `runDiscovery(userId)` orchestrates:
   - Queries products with clicks > 3 OR commission records (90-day window, up to 20)
   - Builds subject→keyword map, skipping Hebrew names
   - Falls back to all subjects if no high-performers found
   - Deduplicates against existing products and known suggestions
   - Searches up to 5 subjects via AliExpress API with 1s rate-limit between calls
   - Returns `{ newCount, subjectsSearched }`

4. **`routes/discover.js`** — Three endpoints mounted at `/api/discover`:
   - `GET /` — returns pending suggestions (limit 50) with subject name
   - `POST /run` — triggers `runDiscovery` for authenticated user
   - `PATCH /:id` — updates status (added | dismissed | pending), returns 404 for unknown/unauthorized IDs

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Hash | Description |
|------|-------------|
| b15a4b8 | feat(ai-product-discovery-01): add product_suggestions migration + extract passesFilters |
| ec71a3e | feat(ai-product-discovery-01): build discoveryAgent.js service |
| 5af4c28 | feat(ai-product-discovery-01): create routes/discover.js and mount in server.js |
