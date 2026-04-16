---
phase: 01-backend-foundation
plan: 02
type: execute
wave: 2
depends_on:
  - "01-PLAN.md"
files_modified:
  - services/broadcastService.js
autonomous: true
requirements:
  - BCAST-03
  - BCAST-04
  - BCAST-05
  - BCAST-06
  - SCHED-01
  - SCHED-02
  - SCHED-03
  - SCHED-04

must_haves:
  truths:
    - "broadcastService.create() validates subject ownership before inserting"
    - "broadcastService.create() converts recurrence JSONB to a valid cron string and stores both"
    - "broadcastService.list() returns each row with nextRunAt (ISO string or null)"
    - "broadcastService.update() accepts an optional imageUrl; deletes old image file if replaced"
    - "broadcastService.setEnabled() toggles enabled without touching other fields"
    - "recurrenceToCron() produces correct cron for daily, weekly, and every_n_days modes"
    - "computeNextRun() returns null when enabled=false; returns ISO string when enabled=true"
  artifacts:
    - path: "services/broadcastService.js"
      provides: "CRUD + recurrenceToCron + computeNextRun"
      exports:
        - listByUser
        - getById
        - create
        - update
        - remove
        - setEnabled
  key_links:
    - from: "services/broadcastService.js"
      to: "db/index.js"
      via: "const { query } = require('../db')"
      pattern: "require\\('../db'\\)"
    - from: "services/broadcastService.js"
      to: "node-cron validate"
      via: "cron.validate(expr)"
      pattern: "cron\\.validate"
---

<objective>
Create services/broadcastService.js with full CRUD, recurrence-to-cron conversion, and next-run computation.

Purpose: Provides the business logic layer that the route module (Plan 03) will call. Also implements all SCHED-01–04 requirements (cron conversion and next-run display).
Output: `services/broadcastService.js` — new file, ~150 lines.
</objective>

<execution_context>
@/Users/davids/.claude/get-shit-done/workflows/execute-plan.md
@/Users/davids/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-backend-foundation/01-RESEARCH.md
@.planning/phases/01-backend-foundation/01-backend-foundation-01-SUMMARY.md
@services/subjectService.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create services/broadcastService.js</name>
  <files>services/broadcastService.js</files>
  <action>
    Create `services/broadcastService.js` as a NEW file. Model the overall structure and style exactly on `services/subjectService.js` (imports at top, private helpers, named exports at bottom).

    **Imports:**
    ```javascript
    const { query } = require('../db');
    const cron = require('node-cron');
    const fs = require('fs');
    const path = require('path');
    ```

    **Private: `recurrenceToCron(recurrence)`**
    Pure function. Validates inputs first, then converts:
    - `daily`: hour 0–23 → `"0 ${hour} * * *"`
    - `weekly`: day 0–6, hour 0–23 → `"0 ${hour} * * ${day}"`
    - `every_n_days`: n 1–30, hour 0–23 → `"0 ${hour} */${n} * *"`

    Validation before converting:
    - hour must be integer 0–23
    - day must be integer 0–6 (weekly mode only)
    - n must be integer 1–30 (every_n_days mode only)
    - mode must be one of `['daily', 'weekly', 'every_n_days']`

    After building the string, call `cron.validate(expr)` — throw `new Error('Invalid recurrence parameters')` if it returns false.

    Throw descriptive Error for any validation failure (routes will catch and return 400).

    **Private: `computeNextRun(recurrence, enabled)`**
    Returns `null` if `!enabled || !recurrence`.

    Compute next fire time using recurrence JSONB (not the cron string — avoid reverse-parsing).
    Use `Asia/Jerusalem` timezone for all calculations via `toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour12: false })`.

    Logic:
    - Get localNow in Jerusalem time; extract localHour (0–23) and localDay (0=Sun).
    - Start `next` from localNow with minutes/seconds/ms zeroed.
    - `daily`: if localHour >= hour, advance 1 day; set hours to hour.
    - `weekly`: compute daysUntil = (day - localDay + 7) % 7; if daysUntil === 0 and localHour >= hour, use 7; add daysUntil days; set hours to hour.
    - `every_n_days`: if localHour >= hour, advance 1 day; set hours to hour; snap to next calendar anchor (smallest date >= next where (date - 1) % n === 0).
    - Return `next.toISOString()`.

    Note: next-run is for display only (SCHED-04 card); precision within minutes is sufficient.

    **Private: `_row(r)`**
    Converts DB row to API object (snake_case → camelCase). Call `computeNextRun(r.recurrence, r.enabled)` to populate `nextRunAt`. Never expose raw DB row to callers.

    ```javascript
    function _row(r) {
      if (!r) return null;
      return {
        id:         r.id,
        userId:     r.user_id,
        subjectId:  r.subject_id,
        label:      r.label,
        text:       r.text,
        imageUrl:   r.image_url,
        recurrence: r.recurrence,
        cron:       r.cron,
        enabled:    r.enabled,
        nextRunAt:  computeNextRun(r.recurrence, r.enabled),
        createdAt:  r.created_at,
        updatedAt:  r.updated_at,
      };
    }
    ```

    **`listByUser(userId)`**
    `SELECT * FROM broadcast_messages WHERE user_id = $1 ORDER BY created_at DESC`
    Return `rows.map(_row)`.

    **`getById(id, userId)`**
    `SELECT * FROM broadcast_messages WHERE id = $1 AND user_id = $2`
    Return `_row(rows[0])` (null if not found — routes handle 404).

    **`create(userId, fields)`**
    fields: `{ subjectId, label, text, recurrence, imageUrl? }`

    Steps:
    1. Validate subject ownership: `SELECT id FROM subjects WHERE id = $1 AND user_id = $2` — if no row, throw `new Error('Invalid subject')`.
    2. Call `recurrenceToCron(recurrence)` to get `cron` string.
    3. `INSERT INTO broadcast_messages (user_id, subject_id, label, text, image_url, recurrence, cron) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`
    4. Return `_row(rows[0])`.

    **`update(id, userId, fields)`**
    fields: any subset of `{ label, text, recurrence, imageUrl, subjectId }`

    Use the dynamic SET pattern (see CONVENTIONS.md):
    - Build updates[] and values[] arrays with index counter `i`.
    - If `fields.recurrence !== undefined`, re-compute cron and add BOTH `recurrence` and `cron` to the SET clause in the same update.
    - If `fields.subjectId !== undefined`, validate ownership first (same query as create step 1).
    - If `fields.imageUrl !== undefined` (new image being set), fetch the current row first and delete the old image file if it exists: `fs.unlink(path.join(__dirname, '..', 'public', oldImageUrl), err => { /* ignore */ })` — only if `oldRow.imageUrl` is truthy.
    - Always append `updated_at = NOW()` to the SET clause.
    - WHERE clause: `id = $i AND user_id = $j`
    - Return `_row(rows[0])` — return null if no row updated (route handles 404).

    **`remove(id, userId)`**
    Fetch the row first (to get image_url for cleanup). Then `DELETE FROM broadcast_messages WHERE id = $1 AND user_id = $2`. If the deleted row had an `image_url`, delete the physical file using `fs.unlink` (ignore errors). Return the deleted row object.

    **`setEnabled(id, userId, enabled)`**
    `UPDATE broadcast_messages SET enabled = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *`
    Return `_row(rows[0])` (null if not found).

    **Exports:**
    ```javascript
    module.exports = { listByUser, getById, create, update, remove, setEnabled };
    ```

    Style notes:
    - 2-space indentation, single quotes, semicolons — match existing services.
    - Add `// ── Section Name ──...` ASCII section headers between logical groups (Helpers, CRUD, Exports).
    - Keep functions in this order: private helpers first, then exported functions in CRUD order.
  </action>
  <verify>
    <automated>node -e "const s = require('./services/broadcastService'); console.log(typeof s.listByUser, typeof s.getById, typeof s.create, typeof s.update, typeof s.remove, typeof s.setEnabled); console.log('exports OK');"</automated>
    <manual>Visually check: recurrenceToCron('daily', {mode:'daily',hour:22}) produces '0 22 * * *'; weekly with day:5 hour:18 produces '0 18 * * 5'.</manual>
  </verify>
  <done>Module requires without error; all 6 named exports are functions; recurrenceToCron produces correct cron strings for all three modes.</done>
</task>

</tasks>

<verification>
`node -e "const s = require('./services/broadcastService'); console.log(Object.keys(s))"` prints `[ 'listByUser', 'getById', 'create', 'update', 'remove', 'setEnabled' ]` without error.
</verification>

<success_criteria>
- `services/broadcastService.js` exists and requires without errors.
- All 6 exported functions are present.
- `recurrenceToCron({ mode: 'daily', hour: 22 })` returns `'0 22 * * *'`.
- `recurrenceToCron({ mode: 'weekly', day: 5, hour: 18 })` returns `'0 18 * * 5'`.
- `recurrenceToCron({ mode: 'every_n_days', n: 3, hour: 11 })` returns `'0 11 */3 * *'`.
- `computeNextRun(null, false)` returns null (via getById with enabled=false path).
- Invalid hour/day/n throws an Error before calling cron.validate().
</success_criteria>

<output>
After completion, create `.planning/phases/01-backend-foundation/01-backend-foundation-02-SUMMARY.md` with:
- What was done
- Files created/modified
- Any edge cases handled
- Anything Plan 03 needs to know
</output>
