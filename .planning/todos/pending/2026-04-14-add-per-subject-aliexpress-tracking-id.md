---
created: 2026-04-14T15:05:05.561Z
title: Add per-subject AliExpress tracking ID
area: api
files:
  - routes/aliexpress-api.js
  - services/googleSheets.js
---

## Problem

Each subject (niche) needs its own AliExpress affiliate tracking ID so that commissions are correctly attributed per niche. Currently, products fetched via the AliExpress API use a single tracking ID, meaning all affiliate links across all subjects share the same tracking attribution. This makes it impossible to track performance and revenue per subject.

## Solution

1. Add a `aliexpress_tracking_id` field to the subject/niche settings (both in the DB `subjects` table and the subject settings UI).
2. When fetching products from the AliExpress API (`routes/aliexpress-api.js`), look up the subject's tracking ID and pass it to the API call so generated affiliate links are tagged with the correct tracking ID.
3. Ensure the field is treated as a sensitive credential — never returned to the client in plain text; only a boolean presence indicator exposed.
