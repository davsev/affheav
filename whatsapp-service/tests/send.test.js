import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { withRetry } from '../utils.js';

// ── helpers ────────────────────────────────────────────────────────────────
function makeMessageMedia() {
  // Must use a regular function (not arrow) so it can be called with `new`
  const MM = vi.fn(function(mimetype, data, filename) {
    this.mimetype = mimetype;
    this.data = data;
    this.filename = filename;
  });
  MM.fromUrl = vi.fn();
  return MM;
}

function makeSharp(toBufferImpl = vi.fn()) {
  return vi.fn(() => ({ jpeg: vi.fn(() => ({ toBuffer: toBufferImpl })) }));
}

function connectedApp({ clientOverrides = {}, MessageMedia, sharp } = {}) {
  const client = {
    getChatById: vi.fn().mockResolvedValue({ isGroup: true, name: 'Test Group', id: {} }),
    sendMessage: vi.fn().mockResolvedValue({ id: { _serialized: 'msg1' } }),
    ...clientOverrides,
  };
  const MM = MessageMedia || makeMessageMedia();
  const sh = sharp || makeSharp();
  const { app, setState } = createApp({
    getClient: () => client,
    retryDelayMs: 0,
    MessageMedia: MM,
    sharp: sh,
  });
  setState({ state: 'CONNECTED' });
  return { app, client, MessageMedia: MM, sharp: sh };
}

// ── retry behaviour ────────────────────────────────────────────────────────
describe('retry logic', () => {
  it('succeeds on first attempt', async () => {
    const { app, client } = connectedApp();
    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi' });
    expect(res.status).toBe(200);
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('retries and succeeds on third attempt', async () => {
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce({ id: { _serialized: 'msg1' } });
    const { app } = connectedApp({ clientOverrides: { sendMessage } });
    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi' });
    expect(res.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('returns 500 after exhausting all retry attempts', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('always fails'));
    const { app } = connectedApp({ clientOverrides: { sendMessage } });
    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('always fails');
  });
});

// ── send queue ─────────────────────────────────────────────────────────────
describe('send queue', () => {
  it('executes concurrent sends one at a time', async () => {
    const order = [];
    const sendMessage = vi.fn().mockImplementation(() => {
      order.push(order.length);
      return Promise.resolve({ id: { _serialized: `msg${order.length}` } });
    });
    const { app } = connectedApp({ clientOverrides: { sendMessage } });

    await Promise.all([
      request(app).post('/send').send({ groupId: '123@g.us', text: 'a' }),
      request(app).post('/send').send({ groupId: '123@g.us', text: 'b' }),
      request(app).post('/send').send({ groupId: '123@g.us', text: 'c' }),
    ]);

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(order).toEqual([0, 1, 2]);
  });
});

// ── image handling ─────────────────────────────────────────────────────────
describe('image handling', () => {
  it('sends image with caption when imageUrl loads a valid image', async () => {
    const MessageMedia = makeMessageMedia();
    MessageMedia.fromUrl.mockResolvedValue({ mimetype: 'image/jpeg', data: 'abc' });
    const sendMessage = vi.fn().mockResolvedValue({ id: { _serialized: 'msg1' } });
    const { app } = connectedApp({ clientOverrides: { sendMessage }, MessageMedia });

    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi', imageUrl: 'http://x.com/img.jpg' });
    expect(res.status).toBe(200);
    expect(sendMessage.mock.calls[0][1]).toMatchObject({ mimetype: 'image/jpeg' });
  });

  it('falls back to text-only when imageUrl returns non-image MIME', async () => {
    const MessageMedia = makeMessageMedia();
    MessageMedia.fromUrl.mockResolvedValue({ mimetype: 'text/html', data: 'abc' });
    const sendMessage = vi.fn().mockResolvedValue({ id: { _serialized: 'msg1' } });
    const { app } = connectedApp({ clientOverrides: { sendMessage }, MessageMedia });

    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi', imageUrl: 'http://x.com/page' });
    expect(res.status).toBe(200);
    expect(sendMessage.mock.calls[0][1]).toBe('hi');
  });

  it('converts webp to JPEG and sends as image', async () => {
    const MessageMedia = makeMessageMedia();
    MessageMedia.fromUrl.mockResolvedValue({ mimetype: 'image/webp', data: Buffer.from('webp').toString('base64') });
    const toBuffer = vi.fn().mockResolvedValue(Buffer.from('jpeg'));
    const sharp = makeSharp(toBuffer);
    const sendMessage = vi.fn().mockResolvedValue({ id: { _serialized: 'msg1' } });
    const { app } = connectedApp({ clientOverrides: { sendMessage }, MessageMedia, sharp });

    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi', imageUrl: 'http://x.com/img.webp' });
    expect(res.status).toBe(200);
    expect(sendMessage.mock.calls[0][1]).toMatchObject({ mimetype: 'image/jpeg' });
  });

  it('falls back to text-only when webp conversion fails', async () => {
    const MessageMedia = makeMessageMedia();
    MessageMedia.fromUrl.mockResolvedValue({ mimetype: 'image/webp', data: 'abc' });
    const toBuffer = vi.fn().mockRejectedValue(new Error('conversion failed'));
    const sharp = makeSharp(toBuffer);
    const sendMessage = vi.fn().mockResolvedValue({ id: { _serialized: 'msg1' } });
    const { app } = connectedApp({ clientOverrides: { sendMessage }, MessageMedia, sharp });

    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi', imageUrl: 'http://x.com/img.webp' });
    expect(res.status).toBe(200);
    expect(sendMessage.mock.calls[0][1]).toBe('hi');
  });

  it('falls back to text-only when imageUrl fetch throws', async () => {
    const MessageMedia = makeMessageMedia();
    MessageMedia.fromUrl.mockRejectedValue(new Error('network error'));
    const sendMessage = vi.fn().mockResolvedValue({ id: { _serialized: 'msg1' } });
    const { app } = connectedApp({ clientOverrides: { sendMessage }, MessageMedia });

    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi', imageUrl: 'http://x.com/img.jpg' });
    expect(res.status).toBe(200);
    expect(sendMessage.mock.calls[0][1]).toBe('hi');
  });

  it('falls back to text-only when image send fails all retries', async () => {
    const MessageMedia = makeMessageMedia();
    MessageMedia.fromUrl.mockResolvedValue({ mimetype: 'image/jpeg', data: 'abc' });
    // Must reject all 3 retry attempts before the text fallback is triggered
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error('img fail 1'))
      .mockRejectedValueOnce(new Error('img fail 2'))
      .mockRejectedValueOnce(new Error('img fail 3'))
      .mockResolvedValueOnce({ id: { _serialized: 'msg1' } });
    const { app } = connectedApp({ clientOverrides: { sendMessage }, MessageMedia });

    const res = await request(app).post('/send').send({ groupId: '123@g.us', text: 'hi', imageUrl: 'http://x.com/img.jpg' });
    expect(res.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(4);
    expect(sendMessage.mock.calls[3][1]).toBe('hi');
  });
});

// ── withRetry unit tests ───────────────────────────────────────────────────
describe('withRetry', () => {
  it('resolves immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { attempts: 3, delayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries up to the attempt limit then rejects', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(withRetry(fn, { attempts: 3, delayMs: 0 })).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops retrying once a call succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok');
    await expect(withRetry(fn, { attempts: 3, delayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
