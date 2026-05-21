import type { Context } from 'hono';
import { proxy } from 'hono/proxy';
import { getFlag } from '../flags/service.js';
import { config } from '../config.js';

// SERVICE_ROUTES maps URL prefixes to their feature flag name and upstream URL env var.
// Flag OFF → strip /v1 prefix and forward to monolith.
// Flag ON → forward to the microservice as-is (microservice owns its own /api/v1/... path).
const SERVICE_ROUTES: Array<{
  prefix: string;
  flag: string;
  serviceUrl: string;
}> = [
  { prefix: '/api/v1/auth',        flag: 'auth-service',        serviceUrl: config.authServiceUrl },
  { prefix: '/api/v1/users',       flag: 'user-service',        serviceUrl: config.userServiceUrl },
  { prefix: '/api/v1/products',    flag: 'products-service',    serviceUrl: config.productsServiceUrl },
  { prefix: '/api/v1/subjects',    flag: 'subjects-service',    serviceUrl: config.subjectsServiceUrl },
  { prefix: '/api/v1/generate',    flag: 'ai-writer-service',   serviceUrl: config.aiWriterServiceUrl },
  { prefix: '/api/v1/channels',    flag: 'channels-service',    serviceUrl: config.channelsServiceUrl },
  { prefix: '/api/v1/schedules',   flag: 'scheduler-service',   serviceUrl: config.schedulerServiceUrl },
  { prefix: '/api/v1/broadcasts',  flag: 'broadcaster-service', serviceUrl: config.broadcasterServiceUrl },
];

/**
 * Resolve the upstream URL for a given request path.
 * If the service flag is ON and a service URL is configured, route to the microservice.
 * Otherwise, rewrite /api/v1/ → /api/ and route to the monolith.
 * Exported for unit testing.
 */
export async function resolveUpstream(
  path: string,
  flagOverrides?: Record<string, boolean>,
): Promise<string> {
  for (const route of SERVICE_ROUTES) {
    if (path.startsWith(route.prefix)) {
      const enabled = flagOverrides
        ? (flagOverrides[route.flag] ?? false)
        : await getFlag(route.flag);

      if (enabled && route.serviceUrl) {
        // Route to microservice — no path rewrite (microservice owns /api/v1/...)
        return `${route.serviceUrl}${path}`;
      }
      // Flag OFF or no service URL → monolith with /v1 stripped
      return `${config.monolithUrl}${path.replace(/^\/api\/v1/, '/api')}`;
    }
  }
  // No matched prefix → monolith fallback with /v1 stripped
  return `${config.monolithUrl}${path.replace(/^\/api\/v1/, '/api')}`;
}

export async function proxyToUpstream(c: Context) {
  const upstreamUrl = await resolveUpstream(c.req.path);
  const qs = new URL(c.req.url).search;
  // Forward request verbatim including Cookie and Authorization headers.
  // Hono's proxy() strips hop-by-hop headers automatically.
  // DO NOT strip Cookie — monolith session auth depends on it.
  // DO NOT strip Authorization — Phase 6 dual-auth depends on it.
  return proxy(`${upstreamUrl}${qs}`, {
    ...c.req.raw,
    headers: c.req.raw.headers,
  });
}
