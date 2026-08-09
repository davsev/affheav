import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp, isPageDeadError } from '../app.js';

const MockMessageMedia = Object.assign(
  vi.fn(function(mimetype, data, filename) {
    this.mimetype = mimetype; this.data = data; this.filename = filename;
  }),
  { fromUrl: vi.fn() }
);
const mockSharp = vi.fn(() => ({ jpeg: vi.fn(() => ({ toBuffer: vi.fn() })) }));

function makeClient(overrides = {}) {
  return { getChatById: vi.fn(), sendMessage: vi.fn(), getChats: vi.fn(), ...overrides };
}

function makeApp(clientOverrides = {}, appOptions = {}) {
  const client = makeClient(clientOverrides);
  const { app, setState } = createApp({
    getClient: () => client,
    MessageMedia: MockMessageMedia,
    sharp: mockSharp,
    ...appOptions,
  });
  return { app, setState, client };
}

describe('isPageDeadError', () => {
  it('matches known dead-page Puppeteer failure signatures', () => {
    expect(isPageDeadError("Attempted to use detached Frame 'ABC123'.")).toBe(true);
    expect(isPageDeadError('Session closed. Most likely the page has been closed.')).toBe(true);
    expect(isPageDeadError('Protocol error (Runtime.callFunctionOn): Target closed.')).toBe(true);
    expect(isPageDeadError('Execution context was destroyed, most likely because of a navigation.')).toBe(true);
  });

  it('does not match ordinary client errors', () => {
    expect(isPageDeadError('r')).toBe(false);
    expect(isPageDeadError('Group not found: 123@g.us')).toBe(false);
    expect(isPageDeadError(undefined)).toBe(false);
  });
});

describe('GET /status', () => {
  it('returns LOADING state with no qr field', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('LOADING');
    expect(res.body.qr).toBeUndefined();
  });

  it('returns QR_READY with qr data url', async () => {
    const { app, setState } = makeApp();
    setState({ state: 'QR_READY', qrCodeBase64: 'data:image/png;base64,abc' });
    const res = await request(app).get('/status');
    expect(res.body.state).toBe('QR_READY');
    expect(res.body.qr).toBe('data:image/png;base64,abc');
  });

  it('returns CONNECTED with no qr field', async () => {
    const { app, setState } = makeApp();
    setState({ state: 'CONNECTED' });
    const res = await request(app).get('/status');
    expect(res.body.state).toBe('CONNECTED');
    expect(res.body.qr).toBeUndefined();
  });

  it('includes error field when an error is set', async () => {
    const { app, setState } = makeApp();
    setState({ state: 'DISCONNECTED', lastError: 'Auth failure' });
    const res = await request(app).get('/status');
    expect(res.body.error).toBe('Auth failure');
  });
});

describe('GET /qr', () => {
  it('returns already-connected message when CONNECTED', async () => {
    const { app, setState } = makeApp();
    setState({ state: 'CONNECTED' });
    const res = await request(app).get('/qr');
    expect(res.text).toContain('Already connected');
  });

  it('returns not-ready message when LOADING', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/qr');
    expect(res.text).toContain('not ready yet');
  });

  it('returns QR image page when QR_READY', async () => {
    const { app, setState } = makeApp();
    setState({ state: 'QR_READY', qrCodeBase64: 'data:image/png;base64,abc' });
    const res = await request(app).get('/qr');
    expect(res.text).toContain('<img src="data:image/png;base64,abc"');
  });
});

describe('POST /send — input guards', () => {
  it('returns 400 when groupId is missing', async () => {
    const { app, setState } = makeApp();
    setState({ state: 'CONNECTED' });
    const res = await request(app).post('/send').send({ text: 'hello' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when text is missing', async () => {
    const { app, setState } = makeApp();
    setState({ state: 'CONNECTED' });
    const res = await request(app).post('/send').send({ groupId: '123@g.us' });
    expect(res.status).toBe(400);
  });

  it('returns 503 when not CONNECTED', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not connected/i);
  });

  it('returns 401 when API key is wrong', async () => {
    const { app, setState } = makeApp({}, { apiKey: 'secret' });
    setState({ state: 'CONNECTED' });
    const res = await request(app)
      .post('/send')
      .set('x-api-key', 'wrong')
      .send({ groupId: '123@g.us', text: 'hi' });
    expect(res.status).toBe(401);
  });

  it('passes through when no API key is configured', async () => {
    const { app, setState } = makeApp({
      getChatById: vi.fn().mockResolvedValue({ isGroup: true, name: 'G', id: {} }),
      sendMessage: vi.fn().mockResolvedValue({ id: { _serialized: 'msg1' } }),
    }, { apiKey: undefined, retryDelayMs: 0 });
    setState({ state: 'CONNECTED' });
    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi' });
    expect(res.status).toBe(200);
  });
});

describe('POST /send — group resolution', () => {
  it('returns 404 when group is not found', async () => {
    const { app, setState } = makeApp({
      getChatById: vi.fn().mockResolvedValue(null),
      getChats: vi.fn().mockResolvedValue([]),
    }, { retryDelayMs: 0 });
    setState({ state: 'CONNECTED' });
    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi' });
    expect(res.status).toBe(404);
  });

  it('falls back to getChats() when getChatById misses a group the store has not cached yet', async () => {
    const { app, setState } = makeApp({
      getChatById: vi.fn().mockResolvedValue(null),
      getChats: vi.fn().mockResolvedValue([
        { isGroup: true, name: 'Late-synced Group', id: { _serialized: '123@g.us' } },
      ]),
      sendMessage: vi.fn().mockResolvedValue({ id: { _serialized: 'msg1' } }),
    }, { retryDelayMs: 0 });
    setState({ state: 'CONNECTED' });
    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi' });
    expect(res.status).toBe(200);
    expect(res.body.chatName).toBe('Late-synced Group');
  });

  it('retries until a group that syncs in on a later attempt is found', async () => {
    const getChatById = vi.fn().mockResolvedValue(null);
    let getChatsCalls = 0;
    const getChats = vi.fn(() => {
      getChatsCalls += 1;
      // Store sync completes on the 3rd poll, not the 1st.
      if (getChatsCalls < 3) return Promise.resolve([]);
      return Promise.resolve([{ isGroup: true, name: 'Slow Group', id: { _serialized: '123@g.us' } }]);
    });
    const { app, setState } = makeApp({
      getChatById,
      getChats,
      sendMessage: vi.fn().mockResolvedValue({ id: { _serialized: 'msg1' } }),
    }, { retryDelayMs: 0, retryAttempts: 3 });
    setState({ state: 'CONNECTED' });
    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi' });
    expect(res.status).toBe(200);
    expect(res.body.chatName).toBe('Slow Group');
    expect(getChatsCalls).toBe(3);
  });

  it('returns 400 when chat exists but is not a group', async () => {
    const { app, setState } = makeApp({ getChatById: vi.fn().mockResolvedValue({ isGroup: false }) }, { retryDelayMs: 0 });
    setState({ state: 'CONNECTED' });
    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi' });
    expect(res.status).toBe(400);
  });

  it('returns 502 with the real cause when the client errors instead of cleanly finding nothing', async () => {
    const { app, setState } = makeApp({
      getChatById: vi.fn().mockRejectedValue(new Error('r')),
      getChats: vi.fn().mockRejectedValue(new Error('r')),
    }, { retryDelayMs: 0 });
    setState({ state: 'CONNECTED' });
    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/WhatsApp client error while looking up group 123@g\.us: r/);
  });

  it('calls onFatalError once when resolution exhausts retries on a dead-page error', async () => {
    const onFatalError = vi.fn();
    const deadPageErr = new Error("Attempted to use detached Frame 'ABC123'.");
    const { app, setState } = makeApp({
      getChatById: vi.fn().mockRejectedValue(deadPageErr),
      getChats: vi.fn().mockRejectedValue(deadPageErr),
    }, { retryDelayMs: 0, retryAttempts: 3, onFatalError });
    setState({ state: 'CONNECTED' });
    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi' });
    expect(res.status).toBe(502);
    expect(onFatalError).toHaveBeenCalledTimes(1);
    expect(onFatalError).toHaveBeenCalledWith(expect.stringContaining('detached Frame'));
  });

  it('does not call onFatalError for an ordinary client error like the "r" bug', async () => {
    const onFatalError = vi.fn();
    const { app, setState } = makeApp({
      getChatById: vi.fn().mockRejectedValue(new Error('r')),
      getChats: vi.fn().mockRejectedValue(new Error('r')),
    }, { retryDelayMs: 0, onFatalError });
    setState({ state: 'CONNECTED' });
    await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi' });
    expect(onFatalError).not.toHaveBeenCalled();
  });
});

describe('GET /groups', () => {
  it('returns 503 when not CONNECTED', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/groups');
    expect(res.status).toBe(503);
  });

  it('filters out non-group chats', async () => {
    const chats = [
      { isGroup: true, id: { _serialized: 'g1@g.us' }, name: 'Group A', participants: [1, 2] },
      { isGroup: false, id: { _serialized: 'dm1' }, name: 'DM', participants: [1] },
    ];
    const { app, setState } = makeApp({ getChats: vi.fn().mockResolvedValue(chats) });
    setState({ state: 'CONNECTED' });
    const res = await request(app).get('/groups');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 'g1@g.us', name: 'Group A', participants: 2 });
  });

  it('returns 502 with a clear message when getChats() throws', async () => {
    const { app, setState } = makeApp({ getChats: vi.fn().mockRejectedValue(new Error('r')) });
    setState({ state: 'CONNECTED' });
    const res = await request(app).get('/groups');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('WhatsApp client error while listing groups: r');
  });

  it('calls onFatalError when getChats() throws a dead-page error', async () => {
    const onFatalError = vi.fn();
    const { app, setState } = makeApp(
      { getChats: vi.fn().mockRejectedValue(new Error("Attempted to use detached Frame 'ABC123'.")) },
      { onFatalError }
    );
    setState({ state: 'CONNECTED' });
    await request(app).get('/groups');
    expect(onFatalError).toHaveBeenCalledTimes(1);
    expect(onFatalError).toHaveBeenCalledWith(expect.stringContaining('detached Frame'));
  });

  it('does not call onFatalError for an ordinary client error like the "r" bug', async () => {
    const onFatalError = vi.fn();
    const { app, setState } = makeApp({ getChats: vi.fn().mockRejectedValue(new Error('r')) }, { onFatalError });
    setState({ state: 'CONNECTED' });
    await request(app).get('/groups');
    expect(onFatalError).not.toHaveBeenCalled();
  });

  it('returns 401 when API key is wrong', async () => {
    const { app, setState } = makeApp({}, { apiKey: 'secret' });
    setState({ state: 'CONNECTED' });
    const res = await request(app).get('/groups').set('x-api-key', 'bad');
    expect(res.status).toBe(401);
  });
});
