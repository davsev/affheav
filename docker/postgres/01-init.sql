-- ============================================================
-- Affiliate Heaven — Per-Service Schema + User Isolation
-- This script runs once when the postgres volume is first created.
-- To re-run: docker compose down -v && docker compose up
-- ============================================================

-- Monolith (existing app, gets public schema for migration path)
CREATE SCHEMA IF NOT EXISTS public;
CREATE USER monolith_svc WITH PASSWORD 'monolith_password';
GRANT USAGE ON SCHEMA public TO monolith_svc;
GRANT CREATE ON SCHEMA public TO monolith_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO monolith_svc;

-- Auth service (Phase 6)
CREATE SCHEMA IF NOT EXISTS auth;
CREATE USER auth_svc WITH PASSWORD 'auth_password';
GRANT USAGE ON SCHEMA auth TO auth_svc;
GRANT CREATE ON SCHEMA auth TO auth_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_svc;

-- User service (Phase 7)
CREATE SCHEMA IF NOT EXISTS users;
CREATE USER users_svc WITH PASSWORD 'users_password';
GRANT USAGE ON SCHEMA users TO users_svc;
GRANT CREATE ON SCHEMA users TO users_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA users GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO users_svc;

-- Subjects service (Phase 8)
CREATE SCHEMA IF NOT EXISTS subjects;
CREATE USER subjects_svc WITH PASSWORD 'subjects_password';
GRANT USAGE ON SCHEMA subjects TO subjects_svc;
GRANT CREATE ON SCHEMA subjects TO subjects_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA subjects GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO subjects_svc;

-- Products service (Phase 8)
CREATE SCHEMA IF NOT EXISTS products;
CREATE USER products_svc WITH PASSWORD 'products_password';
GRANT USAGE ON SCHEMA products TO products_svc;
GRANT CREATE ON SCHEMA products TO products_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA products GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO products_svc;

-- AI writer service (Phase 9)
CREATE SCHEMA IF NOT EXISTS ai_writer;
CREATE USER ai_writer_svc WITH PASSWORD 'ai_writer_password';
GRANT USAGE ON SCHEMA ai_writer TO ai_writer_svc;
GRANT CREATE ON SCHEMA ai_writer TO ai_writer_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai_writer GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ai_writer_svc;

-- Channels service (Phase 9)
CREATE SCHEMA IF NOT EXISTS channels;
CREATE USER channels_svc WITH PASSWORD 'channels_password';
GRANT USAGE ON SCHEMA channels TO channels_svc;
GRANT CREATE ON SCHEMA channels TO channels_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA channels GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO channels_svc;

-- Scheduler service (Phase 10)
CREATE SCHEMA IF NOT EXISTS scheduler;
CREATE USER scheduler_svc WITH PASSWORD 'scheduler_password';
GRANT USAGE ON SCHEMA scheduler TO scheduler_svc;
GRANT CREATE ON SCHEMA scheduler TO scheduler_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA scheduler GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scheduler_svc;

-- Broadcaster service (Phase 10)
CREATE SCHEMA IF NOT EXISTS broadcaster;
CREATE USER broadcaster_svc WITH PASSWORD 'broadcaster_password';
GRANT USAGE ON SCHEMA broadcaster TO broadcaster_svc;
GRANT CREATE ON SCHEMA broadcaster TO broadcaster_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA broadcaster GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO broadcaster_svc;

-- Gateway (Phase 5)
CREATE SCHEMA IF NOT EXISTS gateway;
CREATE USER gateway_svc WITH PASSWORD 'gateway_password';
GRANT USAGE ON SCHEMA gateway TO gateway_svc;
GRANT CREATE ON SCHEMA gateway TO gateway_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA gateway GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gateway_svc;

-- No cross-schema GRANTs are issued above.
-- Example: monolith_svc has NO GRANT on auth schema.
