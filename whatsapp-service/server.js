const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3001;
const DATA_PATH = process.env.WHATSAPP_DATA_PATH || './wwebjs_auth';
const MAX_RECONNECT_DELAY_MS = 60 * 1000;
const INIT_TIMEOUT_MS = 120_000;

let reconnectDelay = 5000;
let initTimeoutId = null;
let currentClient = null;

function cleanupStaleLock() {
  const lockFile = path.join(DATA_PATH, 'session', 'SingletonLock');
  try { fs.unlinkSync(lockFile); console.log('[WA] Removed stale Chrome lock'); } catch (_) {}
}

function makeClient() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: DATA_PATH }),
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

currentClient = makeClient();
const { app, setState, getState } = createApp({ getClient: () => currentClient });

// GET /debug — full diagnostics (boot-layer only, needs execSync)
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
  const { clientState, lastError } = getState();
  res.json({
    state: clientState,
    error: lastError,
    reconnectDelaySec: reconnectDelay / 1000,
    chrome: { path: chromePath, version: chromeVersion, error: chromeError },
    node: process.version,
    dataPath: DATA_PATH,
  });
});

function startInitTimeout() {
  clearTimeout(initTimeoutId);
  initTimeoutId = setTimeout(() => {
    console.warn('[WA] Initialization timed out after 2 minutes');
    setState({ state: 'DISCONNECTED', lastError: 'Initialization timed out after 2 minutes' });
    scheduleReconnect();
  }, INIT_TIMEOUT_MS);
}

function scheduleReconnect() {
  console.log(`[WA] Reconnecting in ${reconnectDelay / 1000}s...`);
  setTimeout(async () => {
    try { await currentClient.destroy(); } catch (_) {}
    cleanupStaleLock();
    currentClient = makeClient();
    attachClientEvents();
    setState({ state: 'LOADING' });
    startInitTimeout();
    currentClient.initialize().catch((e) => {
      clearTimeout(initTimeoutId);
      setState({ state: 'DISCONNECTED', lastError: e.message });
      console.error('[WA] Reinit error:', e.message);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
      scheduleReconnect();
    });
  }, reconnectDelay);
}

function attachClientEvents() {
  currentClient.on('qr', async (qr) => {
    clearTimeout(initTimeoutId);
    setState({ state: 'QR_READY', qrCodeBase64: await qrcode.toDataURL(qr), lastError: null });
    console.log('[WA] QR ready — visit /qr to scan');
  });

  currentClient.on('ready', () => {
    clearTimeout(initTimeoutId);
    setState({ state: 'CONNECTED', qrCodeBase64: null, lastError: null });
    reconnectDelay = 5000;
    console.log('[WA] Client connected');
  });

  currentClient.on('authenticated', () => console.log('[WA] Authenticated'));

  currentClient.on('auth_failure', (msg) => {
    setState({ state: 'DISCONNECTED', lastError: `Auth failure: ${msg}` });
    console.error('[WA] Auth failure:', msg);
    scheduleReconnect();
  });

  currentClient.on('disconnected', (reason) => {
    setState({ state: 'DISCONNECTED', lastError: `Disconnected: ${reason}` });
    console.warn('[WA] Disconnected:', reason);
    scheduleReconnect();
  });
}

// DELETE /session — wipes auth data and forces a fresh QR scan.
// Protected by WHATSAPP_API_KEY. Safe to call remotely when the session is corrupt.
app.delete('/session', (req, res) => {
  const apiKey = process.env.WHATSAPP_API_KEY;
  if (apiKey && req.headers['x-api-key'] !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    fs.rmSync(DATA_PATH, { recursive: true, force: true });
    console.log('[WA] Session data wiped via /session endpoint — restarting init');
    res.json({ ok: true, message: 'Session wiped. QR will appear within 30s.' });
    // Restart init from clean state
    clearTimeout(initTimeoutId);
    try { currentClient.destroy(); } catch (_) {}
    currentClient = makeClient();
    attachClientEvents();
    setState({ state: 'LOADING', lastError: null });
    reconnectDelay = 5000;
    startInitTimeout();
    currentClient.initialize().catch((e) => {
      clearTimeout(initTimeoutId);
      setState({ state: 'DISCONNECTED', lastError: e.message });
      scheduleReconnect();
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Boot
cleanupStaleLock();
attachClientEvents();
startInitTimeout();
currentClient.initialize().catch((e) => {
  clearTimeout(initTimeoutId);
  setState({ state: 'DISCONNECTED', lastError: e.message });
  console.error('[WA] Init error:', e.message);
  scheduleReconnect();
});

app.listen(PORT, () => console.log(`[WA] Service listening on port ${PORT}`));
