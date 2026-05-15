#!/bin/bash
# ============================================================
# Affiliate Heaven — Per-Service Schema + User Isolation
# Runs once when the postgres volume is first created.
# ALL passwords come from environment variables — never hardcoded.
#
# Copy .env.docker.example → .env.docker, fill in strong random
# passwords (openssl rand -base64 32), then: docker compose up
#
# To reset: docker compose down -v && docker compose up
# ============================================================
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL

  -- Monolith
  CREATE SCHEMA IF NOT EXISTS public;
  CREATE USER ah_mono WITH PASSWORD '${MONOLITH_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA public TO ah_mono;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ah_mono;

  -- Auth service (Phase 6)
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE USER ah_auth WITH PASSWORD '${AUTH_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA auth TO ah_auth;
  ALTER DEFAULT PRIVILEGES IN SCHEMA auth
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ah_auth;

  -- User service (Phase 7)
  CREATE SCHEMA IF NOT EXISTS users;
  CREATE USER ah_users WITH PASSWORD '${USERS_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA users TO ah_users;
  ALTER DEFAULT PRIVILEGES IN SCHEMA users
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ah_users;

  -- Subjects service (Phase 8)
  CREATE SCHEMA IF NOT EXISTS subjects;
  CREATE USER ah_subj WITH PASSWORD '${SUBJECTS_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA subjects TO ah_subj;
  ALTER DEFAULT PRIVILEGES IN SCHEMA subjects
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ah_subj;

  -- Products service (Phase 8)
  CREATE SCHEMA IF NOT EXISTS products;
  CREATE USER ah_prod WITH PASSWORD '${PRODUCTS_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA products TO ah_prod;
  ALTER DEFAULT PRIVILEGES IN SCHEMA products
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ah_prod;

  -- AI writer service (Phase 9)
  CREATE SCHEMA IF NOT EXISTS ai_writer;
  CREATE USER ah_aiw WITH PASSWORD '${AI_WRITER_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA ai_writer TO ah_aiw;
  ALTER DEFAULT PRIVILEGES IN SCHEMA ai_writer
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ah_aiw;

  -- Channels service (Phase 9)
  CREATE SCHEMA IF NOT EXISTS channels;
  CREATE USER ah_chan WITH PASSWORD '${CHANNELS_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA channels TO ah_chan;
  ALTER DEFAULT PRIVILEGES IN SCHEMA channels
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ah_chan;

  -- Scheduler service (Phase 10)
  CREATE SCHEMA IF NOT EXISTS scheduler;
  CREATE USER ah_sched WITH PASSWORD '${SCHEDULER_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA scheduler TO ah_sched;
  ALTER DEFAULT PRIVILEGES IN SCHEMA scheduler
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ah_sched;

  -- Broadcaster service (Phase 10)
  CREATE SCHEMA IF NOT EXISTS broadcaster;
  CREATE USER ah_bcast WITH PASSWORD '${BROADCASTER_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA broadcaster TO ah_bcast;
  ALTER DEFAULT PRIVILEGES IN SCHEMA broadcaster
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ah_bcast;

  -- Gateway (Phase 5)
  CREATE SCHEMA IF NOT EXISTS gateway;
  CREATE USER ah_gw WITH PASSWORD '${GATEWAY_DB_PASSWORD}';
  GRANT USAGE, CREATE ON SCHEMA gateway TO ah_gw;
  ALTER DEFAULT PRIVILEGES IN SCHEMA gateway
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ah_gw;

  -- No cross-schema GRANTs. Each user is isolated to its own schema.

EOSQL
