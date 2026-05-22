import { Hono } from 'hono';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { applyJwtMiddleware } from './middleware/jwtEnforce.js';
import adminRoutes from './routes/admin.js';
import { proxyToUpstream } from './proxy/upstream.js';

export const app = new Hono();

// 1. Rate limiting — applied to all /api/v1/* traffic (fail-open if Redis down)
app.use('/api/v1/*', rateLimitMiddleware);

// 2. JWT validation + enforcement gate (no-op in Phase 5 — JWKS_URI not set)
applyJwtMiddleware(app);

// 3. Admin API — served by gateway, NOT proxied to monolith
app.route('/api/v1/admin', adminRoutes);

// 4. Health check — useful for Docker Compose healthcheck and Railway
app.get('/health', (c) => c.json({ status: 'ok' }));

// 5. Proxy all remaining /api/v1/* to upstream (monolith or microservice per flags)
app.all('/api/v1/*', proxyToUpstream);
