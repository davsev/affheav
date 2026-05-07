const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.WHATSAPP_API_KEY;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 60 * 1000;

let qrCodeBase64 = null;
let clientState = 'LOADING'; // LOADING | QR_READY | CONNECTED | DISCONNECTED
let reconnectDelay = 5000;
let lastError = null;
let initTimeoutId = null;
const INIT_TIMEOUT_MS = 120_000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Sequential send queue — one message at a time to avoid WA rate-limiting
let sendQueue = Promise.resolve();
function enqueue(task) {
  return new Promise((resolve, reject) => {
    sendQueue = sendQueue.then(() => task().then(resolve, reject));
  });
}

// Retry wrapper — retries on any error up to RETRY_ATTEMPTS times
async function withRetry(fn) {
  let lastErr;
  for (let i = 0; i < RETRY_ATTEMPTS; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (i < RETRY_ATTEMPTS - 1) {
        console.warn(`[WA] Attempt ${i + 1} failed (${err.message}) — retrying in ${RETRY_DELAY_MS}ms`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  throw lastErr;
}

const DATA_PATH = process.env.WHATSAPP_DATA_PATH || './wwebjs_auth';

// Remove the Chrome SingletonLock if left behind by a crashed process
function cleanupStaleLock() {
  const lockFile = path.join(DATA_PATH, 'session', 'SingletonLock');
  try { fs.unlinkSync(lockFile); console.log('[WA] Removed stale Chrome lock'); } catch (_) {}
}

function makeClient() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: DATA_PATH }),
    // Always fetch the current WA Web version rather than a pinned snapshot.
    webVersionCache: { type: 'none' },
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions',
        '--disable-background-networking',
      ],
    },
  });
}

let client = makeClient();

function startInitTimeout() {
  clearTimeout(initTimeoutId);
  initTimeoutId = setTimeout(() => {
    if (clientState === 'LOADING') {
      lastError = 'Initialization timed out after 2 minutes';
      console.warn('[WA]', lastError);
      clientState = 'DISCONNECTED';
      scheduleReconnect();
    }
  }, INIT_TIMEOUT_MS);
}

function scheduleReconnect() {
  console.log(`[WA] Reconnecting in ${reconnectDelay / 1000}s...`);
  setTimeout(async () => {
    // Destroy old client + clean up stale Chrome lock before re-init
    try { await client.destroy(); } catch (_) {}
    cleanupStaleLock();
    client = makeClient();
    attachClientEvents();
    clientState = 'LOADING';
    startInitTimeout();
    client.initialize().catch((e) => {
      clearTimeout(initTimeoutId);
      lastError = e.message;
      console.error('[WA] Reinit error:', e.message);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
      scheduleReconnect();
    });
  }, reconnectDelay);
}

function attachClientEvents() {
  client.on('qr', async (qr) => {
    clearTimeout(initTimeoutId);
    lastError = null;
    clientState = 'QR_READY';
    qrCodeBase64 = await qrcode.toDataURL(qr);
    console.log('[WA] QR ready — visit /qr to scan');
  });

  client.on('ready', () => {
    clearTimeout(initTimeoutId);
    lastError = null;
    clientState = 'CONNECTED';
    qrCodeBase64 = null;
    reconnectDelay = 5000;
    console.log('[WA] Client connected');
  });

  client.on('authenticated', () => {
    console.log('[WA] Authenticated');
  });

  client.on('auth_failure', (msg) => {
    lastError = `Auth failure: ${msg}`;
    clientState = 'DISCONNECTED';
    console.error('[WA] Auth failure:', msg);
    scheduleReconnect();
  });

  client.on('disconnected', (reason) => {
    lastError = `Disconnected: ${reason}`;
    clientState = 'DISCONNECTED';
    console.warn('[WA] Disconnected:', reason);
    scheduleReconnect();
  });
}

// Boot
cleanupStaleLock();
attachClientEvents();
startInitTimeout();
client.initialize().catch((e) => {
  clearTimeout(initTimeoutId);
  lastError = e.message;
  console.error('[WA] Init error:', e.message);
  clientState = 'DISCONNECTED';
  scheduleReconnect();
});

function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// GET /status
app.get('/status', (req, res) => {
  res.json({
    state: clientState,
    qr: clientState === 'QR_READY' ? qrCodeBase64 : undefined,
    error: lastError || undefined,
  });
});

// GET /debug — full diagnostics to help troubleshoot deployment issues
app.get('/debug', (req, res) => {
  const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || '(auto-detect)';
  let chromeVersion = null;
  let chromeError = null;
  try {
    chromeVersion = execSync(
      `"${process.env.PUPPETEER_EXECUTABLE_PATH || 'google-chrome-stable'}" --version --no-sandbox 2>&1`,
      { timeout: 5000 }
    ).toString().trim();
  } catch (e) {
    chromeError = e.message.split('\n')[0];
  }
  res.json({
    state: clientState,
    error: lastError || null,
    reconnectDelaySec: reconnectDelay / 1000,
    chrome: { path: chromePath, version: chromeVersion, error: chromeError },
    node: process.version,
    dataPath: DATA_PATH,
  });
});

// GET /qr
app.get('/qr', (req, res) => {
  if (clientState === 'CONNECTED') {
    return res.send('<p style="font-family:sans-serif;font-size:1.5rem">✅ Already connected</p>');
  }
  if (clientState !== 'QR_READY' || !qrCodeBase64) {
    return res.send('<p style="font-family:sans-serif;font-size:1.5rem">⏳ QR not ready yet — refresh in a few seconds</p>');
  }
  res.send(`<!DOCTYPE html>
<html>
<head><title>WhatsApp QR</title></head>
<body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif;padding:2rem">
  <h2>Scan with WhatsApp</h2>
  <img src="${qrCodeBase64}" style="width:300px;height:300px"/>
  <p style="color:#888">Page auto-refreshes every 20s</p>
  <script>setTimeout(()=>location.reload(),20000)</script>
</body>
</html>`);
});

// POST /send — queued + retried
app.post('/send', requireApiKey, (req, res) => {
  const { groupId, text, imageUrl } = req.body;

  if (!groupId || !text) {
    return res.status(400).json({ error: 'groupId and text are required' });
  }
  if (clientState !== 'CONNECTED') {
    return res.status(503).json({ error: 'WhatsApp not connected', state: clientState });
  }

  enqueue(async () => {
    let chat;
    try { chat = await client.getChatById(groupId); } catch (_) { chat = null; }
    if (!chat) {
      const err = new Error(`Group not found: ${groupId}`);
      err.status = 404;
      throw err;
    }
    if (!chat.isGroup) {
      const err = new Error(`Not a group: ${groupId}`);
      err.status = 400;
      throw err;
    }

    let message;
    if (imageUrl) {
      console.log(`[WA] Loading image from: ${imageUrl}`);
      let media = null;
      try {
        media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
        if (!media.mimetype?.startsWith('image/')) {
          console.warn(`[WA] Image URL returned non-image content (${media.mimetype}) — falling back to text-only`);
          media = null;
        } else if (media.mimetype === 'image/webp') {
          try {
            const jpegBuf = await sharp(Buffer.from(media.data, 'base64')).jpeg({ quality: 85 }).toBuffer();
            media = new MessageMedia('image/jpeg', jpegBuf.toString('base64'), 'image.jpg');
            console.log('[WA] Converted webp → JPEG');
          } catch (convErr) {
            console.warn(`[WA] webp conversion failed (${convErr.message}) — sending text-only`);
            media = null;
          }
        }
      } catch (imgErr) {
        console.warn(`[WA] Failed to load image (${imgErr.message}) — falling back to text-only`);
      }

      if (media) {
        try {
          message = await withRetry(() => client.sendMessage(groupId, media, { caption: text }));
        } catch (sendErr) {
          console.warn(`[WA] Image send failed (${sendErr.message}) — falling back to text-only`);
          message = await withRetry(() => client.sendMessage(groupId, text));
        }
      } else {
        message = await withRetry(() => client.sendMessage(groupId, text));
      }
    } else {
      message = await withRetry(() => client.sendMessage(groupId, text));
    }

    console.log(`[WA] Sent to "${chat.name}" (${groupId}) — ${message.id._serialized}`);
    return { chatName: chat.name, messageId: message.id._serialized };
  })
    .then(result => res.json({ success: true, ...result }))
    .catch(err => {
      console.error('[WA] Send failed:', err.message, err.stack);
      res.status(err.status || 500).json({ success: false, error: err.message });
    });
});

// GET /groups
app.get('/groups', requireApiKey, async (req, res) => {
  if (clientState !== 'CONNECTED') {
    return res.status(503).json({ error: 'WhatsApp not connected', state: clientState });
  }
  try {
    const chats = await client.getChats();
    const groups = chats
      .filter((c) => c.isGroup)
      .map((c) => ({ id: c.id._serialized, name: c.name, participants: c.participants?.length }));
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`[WA] Service listening on port ${PORT}`));
