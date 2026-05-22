import { serve } from '@hono/node-server';
import { app } from './app.js';
import { config } from './config.js';

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`[gateway] listening on port ${config.port}`);
  console.log(`[gateway] forwarding /api/v1/* → ${config.monolithUrl}/api/*`);
  if (config.jwksUri) {
    console.log(`[gateway] JWT enforcement available via JWKS: ${config.jwksUri}`);
  } else {
    console.log('[gateway] JWT enforcement INACTIVE (AUTH_SERVICE_JWKS_URI not set)');
  }
});
