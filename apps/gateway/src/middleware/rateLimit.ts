// Redis-backed rate limiter — fail-open if Redis is unavailable.
// Phase 5 keys by x-real-ip (set by load balancer) with x-forwarded-for fallback.
// Phase 6+: switch keyGenerator to use JWT `sub` claim when jwt-enforcement is ON.

import { rateLimiter } from 'hono-rate-limiter';
import { RedisStore } from '@hono-rate-limiter/redis';
import { Redis } from 'ioredis';
import { config } from '../config.js';

const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  enableOfflineQueue: false, // don't queue commands when Redis is down — fail immediately
  maxRetriesPerRequest: 1,
});

// Swallow Redis connection errors so the process doesn't crash when Redis is unavailable
redis.on('error', () => { /* fail-open: rate limiting skipped when Redis is down */ });

// Adapter: wrap ioredis to match @hono-rate-limiter/redis v0.1.4 RedisClient interface.
// Each method catches errors so the store fails open when Redis is unavailable.
const redisClient = {
  scriptLoad: (script: string) =>
    redis.script('LOAD', script).catch(() => '') as Promise<string>,
  evalsha: <TArgs extends unknown[], TData = unknown>(sha1: string, keys: string[], args: TArgs) =>
    (redis.evalsha(sha1, keys.length, ...keys, ...(args as string[])).catch(() => null)) as Promise<TData>,
  decr: (key: string) =>
    redis.decr(key).catch(() => 0),
  del: (key: string) =>
    redis.del(key).catch(() => 0),
};

const store = new RedisStore({ client: redisClient });

export const rateLimitMiddleware = rateLimiter({
  windowMs: 60 * 1000,  // 1-minute window
  limit: 120,           // 120 requests per minute per key
  keyGenerator: (c) => {
    return (
      c.req.header('x-real-ip') ??
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      'anonymous'
    );
  },
  store,
  handler: (c) => c.json({ error: 'Too Many Requests' }, 429),
});
