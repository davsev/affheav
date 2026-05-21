// Admin API: list and toggle feature flags.
// In Phase 5, these routes are only reachable from within the Docker network.
// Phase 6: once jwt-enforcement is ON, add JWT role check (super admin only).

import { Hono } from 'hono';
import { listFlags, setFlag } from '../flags/service.js';

const admin = new Hono();

// GET /api/v1/admin/flags — list all flags with current enabled state
admin.get('/flags', async (c) => {
  try {
    const flags = await listFlags();
    return c.json(flags);
  } catch (err) {
    return c.json({ error: 'Failed to fetch flags' }, 500);
  }
});

// PATCH /api/v1/admin/flags/:name — toggle a flag; body: { "enabled": true|false }
admin.patch('/flags/:name', async (c) => {
  const { name } = c.req.param();
  let body: { enabled: boolean };
  try {
    body = await c.req.json<{ enabled: boolean }>();
  } catch {
    return c.json({ error: 'Request body must be JSON with { "enabled": boolean }' }, 400);
  }

  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: '"enabled" must be a boolean' }, 400);
  }

  try {
    const updated = await setFlag(name, body.enabled);
    return c.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message }, message.includes('not found') ? 404 : 500);
  }
});

export default admin;
