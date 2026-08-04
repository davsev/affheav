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

// getChats()/getState() used to throw "r: r" because WhatsApp renamed an internal
// minified property that our WhatsApp automation dependency read by the old name,
// breaking its Store bindings -- now fixed via a patch applied at install time
// (see patches/). We also tried pinning webVersionCache to an older cached WhatsApp
// Web build as a workaround, but the archive that came from only ever mirrors a
// rolling window of recent builds *within the same broken rollout* and prunes old
// ones within days -- there was never an actual pre-bug build available there. Left
// unpinned (tracks live) now that the real fix is in place; WA_VERSION_HTML_URL
// stays available as an override if a version-specific issue ever needs it again.
const WA_VERSION_HTML_URL = process.env.WA_VERSION_HTML_URL || null;
const webVersionCache = WA_VERSION_HTML_URL
  ? { type: 'remote', remotePath: WA_VERSION_HTML_URL }
  : { type: 'none' };

let reconnectDelay = 5000;
let reconnectScheduled = false;
let initTimeoutId = null;
let currentClient = null;
let setState, getState;

function cleanupStaleLock() {
  const lockFile = path.join(DATA_PATH, 'session', 'SingletonLock');
  try { fs.unlinkSync(lockFile); console.log('[WA] Removed stale Chrome lock'); } catch (_) {}
}

function makeClient() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: DATA_PATH }),
    webVersionCache,
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

// Forces a fresh browser session when a request hits a Puppeteer failure that
// means the underlying page is dead (see isPageDeadError in app.js) --
// whatsapp-web.js doesn't reliably emit 'disconnected' for these, so without
// this the service can keep reporting CONNECTED while every real call fails.
function handleClientFailure(reason) {
  console.warn('[WA] Client failure detected, forcing reconnect:', reason);
  setState({ state: 'DISCONNECTED', lastError: reason });
  scheduleReconnect();
}

currentClient = makeClient();
const appHandles = createApp({ getClient: () => currentClient, onFatalError: handleClientFailure });
const app = appHandles.app;
setState = appHandles.setState;
getState = appHandles.getState;

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
  // Several failure signals (a request's onFatalError, plus whatsapp-web.js's own
  // events) can fire in the same window -- only run one reconnect cycle at a time.
  if (reconnectScheduled) return;
  reconnectScheduled = true;
  console.log(`[WA] Reconnecting in ${reconnectDelay / 1000}s...`);
  setTimeout(async () => {
    reconnectScheduled = false;
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
