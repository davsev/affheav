export const config = {
  port:           parseInt(process.env.PORT ?? '8080', 10),
  monolithUrl:    process.env.MONOLITH_URL ?? 'http://monolith:3000',
  redisUrl:       process.env.REDIS_URL ?? 'redis://redis:6379',
  dbUrl:          process.env.GATEWAY_DATABASE_URL ?? '',

  // Required: shared secret protecting /api/v1/admin/* endpoints
  adminToken:     process.env.GATEWAY_ADMIN_TOKEN ?? '',

  // Phase 6+: set AUTH_SERVICE_JWKS_URI to activate JWT enforcement capability
  jwksUri:        process.env.AUTH_SERVICE_JWKS_URI ?? '',

  // Per-service upstream URLs (all empty in Phase 5 — flags are OFF)
  authServiceUrl:         process.env.AUTH_SERVICE_URL ?? '',
  userServiceUrl:         process.env.USER_SERVICE_URL ?? '',
  productsServiceUrl:     process.env.PRODUCTS_SERVICE_URL ?? '',
  subjectsServiceUrl:     process.env.SUBJECTS_SERVICE_URL ?? '',
  aiWriterServiceUrl:     process.env.AI_WRITER_SERVICE_URL ?? '',
  channelsServiceUrl:     process.env.CHANNELS_SERVICE_URL ?? '',
  schedulerServiceUrl:    process.env.SCHEDULER_SERVICE_URL ?? '',
  broadcasterServiceUrl:  process.env.BROADCASTER_SERVICE_URL ?? '',
};
