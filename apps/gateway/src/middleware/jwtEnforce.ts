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

  // Dynamic import to avoid loading jose until it's actually needed.
  // Phase 6 will use hono/jwt's verifyWithJwks-based middleware.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  void import('hono/jwt').then((honoJwt: any) => {
    const jwk = honoJwt.jwk ?? honoJwt.verifyWithJwks;
    if (!jwk) return; // Guard: middleware not available in this Hono version

    // allow_anon: true — this middleware never rejects on its own;
    // the enforceJwt middleware below makes the enforcement decision.
    app.use('/api/v1/*', jwk({
      jwks_uri: config.jwksUri,
      alg: 'RS256',
      allow_anon: true,
    }));

    // Enforcement gate: check flag then inspect jwtPayload
    app.use('/api/v1/*', async (c, next) => {
      const enforcement = await getFlag('jwt-enforcement');
      if (enforcement) {
        const payload = c.get('jwtPayload' as never);
        if (!payload) {
          return c.json({ error: 'Unauthorized' }, 401);
        }
      }
      await next();
    });
  });
}
