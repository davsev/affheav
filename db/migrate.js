/**
 * Database migration — creates all tables if they don't exist.
 * Safe to run on every startup (idempotent).
 */
const { query } = require('./index');

async function migrate() {
  // Enable pgcrypto for gen_random_uuid()
  await query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  // ── Users ─────────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      google_id  VARCHAR(255) UNIQUE,
      email      VARCHAR(255) UNIQUE NOT NULL,
      name       VARCHAR(255),
      photo      TEXT,
      role       VARCHAR(20) NOT NULL DEFAULT 'user',    -- 'admin' | 'user'
      status     VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active' | 'suspended'
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── Invitations ───────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS invitations (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email       VARCHAR(255) NOT NULL,
      token       VARCHAR(255) UNIQUE NOT NULL,
      invited_by  UUID REFERENCES users(id) ON DELETE SET NULL,
      used_at     TIMESTAMPTZ,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── Subjects (niches) ─────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS subjects (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name                 VARCHAR(255) NOT NULL,
      color                VARCHAR(7),
      wa_group             VARCHAR(255),
      macrodroid_url       TEXT,
      facebook_page_id     VARCHAR(255),
      facebook_token       TEXT,
      facebook_app_id      VARCHAR(255),
      facebook_app_secret  TEXT,
      instagram_account_id VARCHAR(255),
      join_link            TEXT,
      openai_prompt        TEXT,
      wa_enabled           BOOLEAN NOT NULL DEFAULT true,
      fb_enabled           BOOLEAN NOT NULL DEFAULT true,
      instagram_enabled    BOOLEAN NOT NULL DEFAULT false,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── Products ──────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS products (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id   UUID REFERENCES subjects(id) ON DELETE SET NULL,
      long_url     TEXT,
      short_link   TEXT,
      image        TEXT,
      text         TEXT,
      join_link    TEXT,
      wa_group     VARCHAR(255),
      sent_at      TIMESTAMPTZ,
      facebook_at  TIMESTAMPTZ,
      instagram_at TIMESTAMPTZ,
      clicks       INTEGER NOT NULL DEFAULT 0,
      sort_order   INTEGER,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS products_user_id ON products(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS products_subject_id ON products(subject_id)`);

  // ── Schedules ─────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS schedules (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
      label      VARCHAR(255),
      cron       VARCHAR(100) NOT NULL,
      enabled    BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── Settings (per-user key-value) ─────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key        VARCHAR(255) NOT NULL,
      value      TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, key)
    )
  `);

  // ── Logs ──────────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS logs (
      id      BIGSERIAL PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      ts      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      level   VARCHAR(20) NOT NULL DEFAULT 'info',
      msg     TEXT NOT NULL
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS logs_user_ts ON logs(user_id, ts DESC)`);

  console.log('✓ Database schema up to date');
}

module.exports = { migrate };
