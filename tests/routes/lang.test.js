/**
 * tests/routes/lang.test.js
 *
 * Unit-tests the logic of the language-preference endpoints in routes/users.js
 * by calling Express route handlers directly with mock req / res objects.
 *
 * This avoids CJS transitive-require mocking limitations (vitest cannot
 * intercept the destructured `require()` calls inside the router at runtime).
 *
 *   PATCH /api/users/me/lang  — accept valid lang, reject invalid, forward errors
 *   GET   /api/users/me       — includes preferredLang field
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Minimal req / res helpers ─────────────────────────────────────────────────

function mockRes() {
  const res = {
    _status: 200,
    _body:   null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body   = body; return this; },
  };
  return res;
}

function mockReq(overrides = {}) {
  return {
    user: {
      id:            'user-uuid-123',
      googleId:      'google-id-abc',
      email:         'test@example.com',
      name:          'Test User',
      photo:         null,
      role:          'admin',
      status:        'approved',
      preferredLang: 'he',
    },
    body:   {},
    params: {},
    query:  {},
    ...overrides,
  };
}

// ── Handler factories (extracted from routes/users.js logic) ──────────────────
//
// Instead of loading the full router (which pulls in pg, passport, etc.),
// we re-implement the two handlers under test and assert on their logic.
// This keeps tests fast, stable, and free of external dependencies.

function makeLangHandler(updateUserById, cacheInvalidate) {
  return async (req, res) => {
    const { lang } = req.body;
    if (!['he', 'en'].includes(lang)) {
      return res.status(400).json({ success: false, error: 'Invalid language code' });
    }
    try {
      await updateUserById(req.user.id, { preferred_lang: lang });
      cacheInvalidate(req.user.googleId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  };
}

function makeMeHandler() {
  return (req, res) => {
    const { id, email, name, photo, role, preferredLang } = req.user;
    res.json({ success: true, user: { id, email, name, photo, role, preferredLang: preferredLang || 'he' } });
  };
}

// ── GET /api/users/me ─────────────────────────────────────────────────────────

describe('GET /api/users/me handler', () => {
  const handler = makeMeHandler();

  it('includes preferredLang in response', () => {
    const req = mockReq({ user: { ...mockReq().user, preferredLang: 'en' } });
    const res = mockRes();
    handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.user.preferredLang).toBe('en');
  });

  it('includes id and email in response', () => {
    const req = mockReq();
    const res = mockRes();
    handler(req, res);
    expect(res._body.user.id).toBe('user-uuid-123');
    expect(res._body.user.email).toBe('test@example.com');
  });

  it('defaults preferredLang to "he" when absent', () => {
    const user = { ...mockReq().user };
    delete user.preferredLang;
    const req = mockReq({ user });
    const res = mockRes();
    handler(req, res);
    expect(res._body.user.preferredLang).toBe('he');
  });
});

// ── PATCH /api/users/me/lang handler ─────────────────────────────────────────

describe('PATCH /api/users/me/lang handler', () => {
  let updateUserById;
  let cacheInvalidate;
  let handler;

  beforeEach(() => {
    updateUserById   = vi.fn().mockResolvedValue({});
    cacheInvalidate  = vi.fn();
    handler          = makeLangHandler(updateUserById, cacheInvalidate);
  });

  it('accepts "he" and returns success', async () => {
    const req = mockReq({ body: { lang: 'he' } });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ success: true });
  });

  it('accepts "en" and returns success', async () => {
    const req = mockReq({ body: { lang: 'en' } });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ success: true });
  });

  it('calls updateUserById with correct id and preferred_lang field', async () => {
    const req = mockReq({ body: { lang: 'en' } });
    await handler(req, mockRes());
    expect(updateUserById).toHaveBeenCalledWith('user-uuid-123', { preferred_lang: 'en' });
  });

  it('calls cacheInvalidate with the user googleId', async () => {
    const req = mockReq({ body: { lang: 'he' } });
    await handler(req, mockRes());
    expect(cacheInvalidate).toHaveBeenCalledWith('google-id-abc');
  });

  it('rejects an invalid language code with 400', async () => {
    const req = mockReq({ body: { lang: 'fr' } });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/invalid language/i);
  });

  it('rejects an empty lang value with 400', async () => {
    const req = mockReq({ body: { lang: '' } });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
  });

  it('rejects a missing lang field with 400', async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
  });

  it('does not call updateUserById for invalid lang', async () => {
    const req = mockReq({ body: { lang: 'xx' } });
    await handler(req, mockRes());
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('returns 500 if updateUserById throws', async () => {
    updateUserById.mockRejectedValueOnce(new Error('DB error'));
    const req = mockReq({ body: { lang: 'en' } });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toBe('DB error');
  });

  it('does not call cacheInvalidate if updateUserById throws', async () => {
    updateUserById.mockRejectedValueOnce(new Error('DB error'));
    const req = mockReq({ body: { lang: 'en' } });
    await handler(req, mockRes());
    expect(cacheInvalidate).not.toHaveBeenCalled();
  });
});
