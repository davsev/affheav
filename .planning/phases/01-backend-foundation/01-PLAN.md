---
phase: 01-backend-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - db/migrate.js
autonomous: true
requirements:
  - BCAST-01
  - BCAST-02

must_haves:
  truths:
    - "The broadcast_messages table exists in PostgreSQL after server startup"
    - "A broadcast_messages row can be inserted with label, text, subject_id (NOT NULL FK to subjects)"
    - "Rows have enabled=true by default and both recurrence (JSONB) and cron (VARCHAR) columns"
    - "Two indexes exist: bcast_user_id and bcast_subject_id"
  artifacts:
    - path: "db/migrate.js"
      provides: "broadcast_messages CREATE TABLE IF NOT EXISTS block + two index statements"
      contains: "CREATE TABLE IF NOT EXISTS broadcast_messages"
  key_links:
    - from: "db/migrate.js"
      to: "subjects table"
      via: "REFERENCES subjects(id) ON DELETE CASCADE"
      pattern: "REFERENCES subjects"
    - from: "db/migrate.js"
      to: "users table"
      via: "REFERENCES users(id) ON DELETE CASCADE"
      pattern: "REFERENCES users"
---

<objective>
Add the broadcast_messages table to the database migration.

Purpose: Establishes the data foundation — every other Plan 1 task depends on this table existing.
Output: `db/migrate.js` gains an idempotent CREATE TABLE block plus two indexes.
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
@db/migrate.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add broadcast_messages table to db/migrate.js</name>
  <files>db/migrate.js</files>
  <action>
    Append a new migration block at the END of the `migrate()` function in `db/migrate.js`, AFTER all existing table/index statements. Follow the exact same style as the blocks above it (ASCII section header + `await query(...)` pattern).

    Add this block:

    ```
    // ── Broadcast Messages ────────────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS broadcast_messages (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        label        VARCHAR(255) NOT NULL,
        text         TEXT NOT NULL,
        image_url    TEXT,
        recurrence   JSONB NOT NULL,
        cron         VARCHAR(100) NOT NULL,
        enabled      BOOLEAN NOT NULL DEFAULT true,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS bcast_user_id    ON broadcast_messages(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS bcast_subject_id ON broadcast_messages(subject_id)`);
    ```

    Column notes:
    - `subject_id` is NOT NULL — no "all niches" option (BCAST-02)
    - `recurrence` is JSONB storing `{ mode, hour, day?, n? }` — keeps human inputs for edit modal pre-population
    - `cron` is VARCHAR storing the computed cron expression (both columns always stored together)
    - `enabled` defaults true — consistent with the `schedules` table
    - UUID primary key — consistent with all other tables

    Do NOT modify any existing table block. The new block is purely additive.
  </action>
  <verify>
    <automated>node -e "require('dotenv').config(); const { migrate } = require('./db/migrate'); migrate().then(() => { console.log('Migration OK'); process.exit(0); }).catch(e => { console.error(e.message); process.exit(1); })"</automated>
    <manual>After running the command above, connect to the DB and confirm: `\d broadcast_messages` shows all 11 columns including recurrence (jsonb) and cron (character varying).</manual>
  </verify>
  <done>Migration runs without error; broadcast_messages table exists in DB with all 11 columns and both indexes.</done>
</task>

</tasks>

<verification>
Run `node -e "require('dotenv').config(); const { migrate } = require('./db/migrate'); migrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); })"` — exits 0. Then verify table exists with correct columns.
</verification>

<success_criteria>
`broadcast_messages` table is present after migration with: id (uuid pk), user_id (uuid not null fk→users), subject_id (uuid not null fk→subjects), label (varchar 255), text (text), image_url (text nullable), recurrence (jsonb not null), cron (varchar 100 not null), enabled (boolean default true), created_at, updated_at. Plus indexes bcast_user_id and bcast_subject_id.
</success_criteria>

<output>
After completion, create `.planning/phases/01-backend-foundation/01-backend-foundation-01-SUMMARY.md` with:
- What was done
- Files modified
- Key decisions made (if any)
- Anything the next plan needs to know
</output>
