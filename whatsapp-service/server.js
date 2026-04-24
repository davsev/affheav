const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.WHATSAPP_API_KEY;

// In-memory state
let qrCodeBase64 = null;
let clientState = 'LOADING'; // LOADING | QR_READY | CONNECTED | DISCONNECTED

const DATA_PATH = process.env.DATA_PATH || './wwebjs_auth';

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: DATA_PATH }),
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
    ],
  },
});

client.on('qr', async (qr) => {
  clientState = 'QR_READY';
  qrCodeBase64 = await qrcode.toDataURL(qr);
  console.log('[WA] QR ready — visit /qr to scan');
});

client.on('ready', () => {
  clientState = 'CONNECTED';
  qrCodeBase64 = null;
  console.log('[WA] Client connected');
});

client.on('authenticated', () => {
  console.log('[WA] Authenticated');
});

client.on('auth_failure', (msg) => {
  clientState = 'DISCONNECTED';
  console.error('[WA] Auth failure:', msg);
});

client.on('disconnected', (reason) => {
  clientState = 'DISCONNECTED';
  console.warn('[WA] Disconnected:', reason);
  // Attempt reconnect after 5s
  setTimeout(() => {
    clientState = 'LOADING';
    client.initialize().catch((e) => console.error('[WA] Reinit error:', e));
  }, 5000);
});

client.initialize().catch((e) => console.error('[WA] Init error:', e));

// Auth middleware
function requireApiKey(req, res, next) {
  if (!API_KEY) return next(); // No key configured — open in dev
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
  });
});

// GET /qr — render QR as an HTML page for easy browser scanning
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

// POST /send
app.post('/send', requireApiKey, async (req, res) => {
  const { groupId, text, imageUrl } = req.body;

  if (!groupId || !text) {
    return res.status(400).json({ error: 'groupId and text are required' });
  }
  if (clientState !== 'CONNECTED') {
    return res.status(503).json({ error: 'WhatsApp not connected', state: clientState });
  }

  try {
    let message;
    if (imageUrl) {
      const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
      message = await client.sendMessage(groupId, media, { caption: text });
    } else {
      message = await client.sendMessage(groupId, text);
    }
    res.json({ success: true, messageId: message.id._serialized });
  } catch (err) {
    console.error('[WA] Send error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /groups — list joined groups (useful for finding groupId values)
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
