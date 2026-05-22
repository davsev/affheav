import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test resolveUpstream in isolation by passing flagOverrides directly.
// This avoids needing a real DB or Redis in unit tests.
import { resolveUpstream } from '../proxy/upstream.js';

// Mock the config so monolithUrl and service URLs are deterministic in tests
vi.mock('../config.js', () => ({
  config: {
    monolithUrl: 'http://monolith:3000',
    authServiceUrl: 'http://auth-service:3001',
    userServiceUrl: '',
    productsServiceUrl: '',
    subjectsServiceUrl: '',
    aiWriterServiceUrl: '',
    channelsServiceUrl: '',
    schedulerServiceUrl: '',
    broadcasterServiceUrl: '',
    jwksUri: '',
    redisUrl: 'redis://redis:6379',
    dbUrl: '',
    port: 8080,
  },
}));

// Mock getFlag so resolveUpstream doesn't hit the DB
vi.mock('../flags/service.js', () => ({
  getFlag: vi.fn().mockResolvedValue(false),
}));

describe('resolveUpstream — path rewrite', () => {
  it('rewrites /api/v1/products to /api/products on monolith (flag OFF)', async () => {
    const url = await resolveUpstream('/api/v1/products', { 'products-service': false });
    expect(url).toBe('http://monolith:3000/api/products');
  });

  it('rewrites /api/v1/auth/login to /api/auth/login on monolith (flag OFF)', async () => {
    const url = await resolveUpstream('/api/v1/auth/login', { 'auth-service': false });
    expect(url).toBe('http://monolith:3000/api/auth/login');
  });

  it('routes /api/v1/auth/* to auth-service when flag is ON and URL is configured', async () => {
    const url = await resolveUpstream('/api/v1/auth/login', { 'auth-service': true });
    expect(url).toBe('http://auth-service:3001/api/v1/auth/login');
  });

  it('falls back to monolith when flag is ON but service URL is empty', async () => {
    const url = await resolveUpstream('/api/v1/users/me', { 'user-service': true });
    // user-service URL is empty string in mock config → monolith fallback
    expect(url).toBe('http://monolith:3000/api/users/me');
  });

  it('handles unmatched prefix by falling back to monolith', async () => {
    const url = await resolveUpstream('/api/v1/unknown/endpoint', {});
    expect(url).toBe('http://monolith:3000/api/unknown/endpoint');
  });

  it('preserves nested path segments in rewrite', async () => {
    const url = await resolveUpstream('/api/v1/products/123/details', { 'products-service': false });
    expect(url).toBe('http://monolith:3000/api/products/123/details');
  });
});
