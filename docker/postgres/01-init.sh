#!/bin/bash
# ============================================================
# Affiliate Heaven — Per-Service Schema + User Isolation
# Runs once when the postgres volume is first created.
# Passwords are read from environment variables — never hardcoded.
#
# Required env vars (set in docker-compose.yml via .env):
#   MONOLITH_DB_PASSWORD, AUTH_DB_PASSWORD, USERS_DB_PASSWORD,
#   SUBJECTS_DB_PASSWORD, PRODUCTS_DB_PASSWORD, AI_WRITER_DB_PASSWORD,
#   CHANNELS_DB_PASSWORD, SCHEDULER_DB_PASSWORD, BROADCASTER_DB_PASSWORD,
#   GATEWAY_DB_PASSWORD
#
# To re-run: docker compose down -v && docker compose up
# ============================================================
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL

  -- Monolith
  CREATE SCHEMA IF NOT EXISTS public;
  CREATE USER monolith_svc WITH PASSWORD '${MONOLITH_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA public TO monolith_svc;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO monolith_svc;

  -- Auth service (Phase 6)
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE USER auth_svc WITH PASSWORD '${AUTH_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA auth TO auth_svc;
  ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_svc;

  -- User service (Phase 7)
  CREATE SCHEMA IF NOT EXISTS users;
  CREATE USER users_svc WITH PASSWORD '${USERS_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA users TO users_svc;
  ALTER DEFAULT PRIVILEGES IN SCHEMA users GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO users_svc;

  -- Subjects service (Phase 8)
  CREATE SCHEMA IF NOT EXISTS subjects;
  CREATE USER subjects_svc WITH PASSWORD '${SUBJECTS_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA subjects TO subjects_svc;
  ALTER DEFAULT PRIVILEGES IN SCHEMA subjects GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO subjects_svc;

  -- Products service (Phase 8)
  CREATE SCHEMA IF NOT EXISTS products;
  CREATE USER products_svc WITH PASSWORD '${PRODUCTS_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA products TO products_svc;
  ALTER DEFAULT PRIVILEGES IN SCHEMA products GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO products_svc;

  -- AI writer service (Phase 9)
  CREATE SCHEMA IF NOT EXISTS ai_writer;
  CREATE USER ai_writer_svc WITH PASSWORD '${AI_WRITER_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA ai_writer TO ai_writer_svc;
  ALTER DEFAULT PRIVILEGES IN SCHEMA ai_writer GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ai_writer_svc;

  -- Channels service (Phase 9)
  CREATE SCHEMA IF NOT EXISTS channels;
  CREATE USER channels_svc WITH PASSWORD '${CHANNELS_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA channels TO channels_svc;
  ALTER DEFAULT PRIVILEGES IN SCHEMA channels GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO channels_svc;

  -- Scheduler service (Phase 10)
  CREATE SCHEMA IF NOT EXISTS scheduler;
  CREATE USER scheduler_svc WITH PASSWORD '${SCHEDULER_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA scheduler TO scheduler_svc;
  ALTER DEFAULT PRIVILEGES IN SCHEMA scheduler GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scheduler_svc;

  -- Broadcaster service (Phase 10)
  CREATE SCHEMA IF NOT EXISTS broadcaster;
  CREATE USER broadcaster_svc WITH PASSWORD '${BROADCASTER_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA broadcaster TO broadcaster_svc;
  ALTER DEFAULT PRIVILEGES IN SCHEMA broadcaster GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO broadcaster_svc;

  -- Gateway (Phase 5)
  CREATE SCHEMA IF NOT EXISTS gateway;
  CREATE USER gateway_svc WITH PASSWORD '${GATEWAY_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA gateway TO gateway_svc;
  ALTER DEFAULT PRIVILEGES IN SCHEMA gateway GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gateway_svc;

  -- No cross-schema GRANTs above. Each svc user is isolated to its own schema.

EOSQL
