-- Migration: create gateway.feature_flags table
-- Run with: RUN_MIGRATIONS=true (or apply manually via psql)

CREATE TABLE IF NOT EXISTS gateway.feature_flags (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  enabled     BOOLEAN     NOT NULL DEFAULT false,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
