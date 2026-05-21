-- Migration: seed all Phase 5–10 feature flags (all start disabled)

INSERT INTO gateway.feature_flags (name, enabled, description) VALUES
  ('jwt-enforcement',     false, 'Gateway validates JWT Bearer tokens and rejects unauthenticated requests — activate post-Phase 6'),
  ('auth-service',        false, 'Route /api/v1/auth/* to auth-service (Phase 6)'),
  ('user-service',        false, 'Route /api/v1/users/* to user-service (Phase 7)'),
  ('products-service',    false, 'Route /api/v1/products/* to products-service (Phase 8)'),
  ('subjects-service',    false, 'Route /api/v1/subjects/* to subjects-service (Phase 8)'),
  ('ai-writer-service',   false, 'Route /api/v1/generate/* to ai-writer-service (Phase 9)'),
  ('channels-service',    false, 'Route /api/v1/channels/* to channels-service (Phase 9)'),
  ('scheduler-service',   false, 'Route /api/v1/schedules/* to scheduler-service (Phase 10)'),
  ('broadcaster-service', false, 'Route /api/v1/broadcasts/* to broadcaster-service (Phase 10)')
ON CONFLICT (name) DO NOTHING;
