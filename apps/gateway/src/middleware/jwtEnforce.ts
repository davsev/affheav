// JWT enforcement middleware — wired but inactive in Phase 5.
//
// IMPORTANT: Only register JWK middleware if AUTH_SERVICE_JWKS_URI is set.
// In Phase 5, this env var is UNSET so the entire block is skipped.
// This prevents ECONNREFUSED crashes when auth-service doesn't exist yet.
//
// Phase 6 activation: set AUTH_SERVICE_JWKS_URI in the gateway environment.
// Then flip the 'jwt-enforcement' feature flag ON via admin API.

import type { Hono } from 'hono';
import { getFlag } from '../flags/service.js';
import { config } from '../config.js';

/**
 * Conditionally register JWK + enforcement middleware on the app.
 * Called once during app construction. No-op if JWKS URI is not configured.
 */
export function applyJwtMiddleware(app: Hono) {
  if (!config.jwksUri) {
    // Phase 5: AUTH_SERVICE_JWKS_URI not set — skip entirely
    return;
  }

  // Phase 6+: when JWKS URI is configured, register JWT enforcement.
  // Enforcement gate: check flag then inspect jwtPayload set by upstream JWT middleware.
  app.use('/api/v1/*', async (c, next) => {
    const enforcement = await getFlag('jwt-enforcement');
    if (enforcement) {
      // In Phase 6 the upstream jwt() middleware will populate jwtPayload.
      // Here we just gate on its presence; absence means unauthenticated.
      const payload = c.get('jwtPayload' as never);
      if (!payload) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    }
    await next();
  });
}
