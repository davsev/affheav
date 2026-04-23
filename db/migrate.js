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

  // ── WhatsApp Groups (per niche) ───────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS whatsapp_groups (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      name       VARCHAR(255) NOT NULL,
      wa_group   VARCHAR(255) NOT NULL,
      join_link  TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS wa_groups_subject_id ON whatsapp_groups(subject_id)`);
  await query(`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS aliexpress_tracking_id TEXT`);

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
  // Add whatsapp_group_id FK if not already present (idempotent)
  await query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS whatsapp_group_id UUID REFERENCES whatsapp_groups(id) ON DELETE SET NULL
  `);
  await query(`CREATE INDEX IF NOT EXISTS products_wa_group_id ON products(whatsapp_group_id)`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS skip_ai BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS send_count INTEGER NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_price      NUMERIC(10,2)`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,4)`);

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

  // ── Commission Snapshots (AliExpress affiliate orders) ───────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS commission_snapshots (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id      UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      tracking_id     TEXT NOT NULL,
      order_id        TEXT NOT NULL,
      order_amount    NUMERIC(12,2),
      commission_rate NUMERIC(5,4),
      commission_usd  NUMERIC(10,2),
      order_status    TEXT,
      payment_status  TEXT,
      order_time      TIMESTAMPTZ,
      fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, order_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS commission_snapshots_subject ON commission_snapshots(subject_id)`);
  await query(`CREATE INDEX IF NOT EXISTS commission_snapshots_user    ON commission_snapshots(user_id)`);

  // ── Post IDs on products (for Meta Insights) ─────────────────────────────
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS fb_post_id  TEXT`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ig_media_id TEXT`);

  // ── Post Insights (Meta organic reach per post) ───────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS post_insights (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      platform     TEXT NOT NULL,
      reach        INTEGER,
      impressions  INTEGER,
      fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(product_id, platform)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS post_insights_product ON post_insights(product_id)`);
  await query(`CREATE INDEX IF NOT EXISTS post_insights_user    ON post_insights(user_id)`);

  // ── Ad Spend (manual ROAS tracking) ──────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS ad_spend (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      platform     TEXT NOT NULL,
      spend_usd    NUMERIC(10,2) NOT NULL,
      period_start DATE NOT NULL,
      period_end   DATE NOT NULL,
      notes        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS ad_spend_user    ON ad_spend(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS ad_spend_subject ON ad_spend(subject_id)`);

  // ── Order Items (AliExpress per-product line items within each order) ─────────
  await query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id      UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      order_id        TEXT NOT NULL,
      product_id      TEXT NOT NULL,
      product_title   TEXT,
      item_count      INTEGER,
      order_amount    NUMERIC(12,2),
      commission_rate NUMERIC(5,4),
      commission_usd  NUMERIC(10,2),
      fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, order_id, product_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS order_items_user    ON order_items(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS order_items_subject ON order_items(subject_id)`);
  await query(`CREATE INDEX IF NOT EXISTS order_items_product ON order_items(product_id)`);

  // ── Enrich commission_snapshots with product-level fields from AliExpress ────
  // sub_order_id is the per-product unique key (parent order_id may cover multiple products)
  await query(`ALTER TABLE commission_snapshots ADD COLUMN IF NOT EXISTS sub_order_id TEXT`);
  await query(`ALTER TABLE commission_snapshots ADD COLUMN IF NOT EXISTS aliexpress_product_id TEXT`);
  await query(`ALTER TABLE commission_snapshots ADD COLUMN IF NOT EXISTS product_title TEXT`);
  await query(`ALTER TABLE commission_snapshots ADD COLUMN IF NOT EXISTS product_image TEXT`);
  await query(`ALTER TABLE commission_snapshots ADD COLUMN IF NOT EXISTS is_hot_product BOOLEAN`);
  await query(`ALTER TABLE commission_snapshots ADD COLUMN IF NOT EXISTS is_new_buyer BOOLEAN`);
  await query(`ALTER TABLE commission_snapshots ADD COLUMN IF NOT EXISTS category_id TEXT`);
  await query(`CREATE INDEX IF NOT EXISTS commission_snapshots_product ON commission_snapshots(aliexpress_product_id)`);

  console.log('✓ Database schema up to date');
}

module.exports = { migrate };
