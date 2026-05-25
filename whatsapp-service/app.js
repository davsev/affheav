const express = require('express');
const { withRetry } = require('./utils');

function createApp({
  getClient,
  apiKey = process.env.WHATSAPP_API_KEY,
  retryAttempts = 3,
  retryDelayMs = 2000,
  MessageMedia = require('whatsapp-web.js').MessageMedia,
  sharp = require('sharp'),
} = {}) {
  const app = express();
  app.use(express.json());

  let clientState = 'LOADING';
  let qrCodeBase64 = null;
  let lastError = null;

  let sendQueue = Promise.resolve();
  function enqueue(task) {
    return new Promise((resolve, reject) => {
      sendQueue = sendQueue.then(() => task().then(resolve, reject));
    });
  }

  function setState(patch) {
    if ('state' in patch) clientState = patch.state;
    if ('qrCodeBase64' in patch) qrCodeBase64 = patch.qrCodeBase64;
    if ('lastError' in patch) lastError = patch.lastError;
  }

  function getState() {
    return { clientState, qrCodeBase64, lastError };
  }

  function requireApiKey(req, res, next) {
    if (!apiKey) return next();
    if (req.headers['x-api-key'] !== apiKey) return res.status(401).json({ error: 'Unauthorized' });
    next();
  }

  app.get('/status', (req, res) => {
    res.json({
      state: clientState,
      qr: clientState === 'QR_READY' ? qrCodeBase64 : undefined,
      error: lastError || undefined,
    });
  });

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

  app.post('/send', requireApiKey, (req, res) => {
    const { groupId, text, imageUrl } = req.body;

    if (!groupId || !text) {
      return res.status(400).json({ error: 'groupId and text are required' });
    }
    if (clientState !== 'CONNECTED') {
      return res.status(503).json({ error: 'WhatsApp not connected', state: clientState });
    }

    const client = getClient();

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
        let media = null;
        try {
          media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
          if (!media.mimetype?.startsWith('image/')) {
            media = null;
          } else if (media.mimetype === 'image/webp') {
            try {
              const jpegBuf = await sharp(Buffer.from(media.data, 'base64')).jpeg({ quality: 85 }).toBuffer();
              media = new MessageMedia('image/jpeg', jpegBuf.toString('base64'), 'image.jpg');
            } catch (_) {
              media = null;
            }
          }
        } catch (_) {
          media = null;
        }

        if (media) {
          try {
            message = await withRetry(() => client.sendMessage(groupId, media, { caption: text }), { attempts: retryAttempts, delayMs: retryDelayMs });
          } catch (_) {
            message = await withRetry(() => client.sendMessage(groupId, text), { attempts: retryAttempts, delayMs: retryDelayMs });
          }
        } else {
          message = await withRetry(() => client.sendMessage(groupId, text), { attempts: retryAttempts, delayMs: retryDelayMs });
        }
      } else {
        message = await withRetry(() => client.sendMessage(groupId, text), { attempts: retryAttempts, delayMs: retryDelayMs });
      }

      return { chatName: chat.name, messageId: message.id._serialized };
    })
      .then(result => res.json({ success: true, ...result }))
      .catch(err => res.status(err.status || 500).json({ success: false, error: err.message }));
  });

  app.get('/groups', requireApiKey, async (req, res) => {
    if (clientState !== 'CONNECTED') {
      return res.status(503).json({ error: 'WhatsApp not connected', state: clientState });
    }
    const client = getClient();
    try {
      const chats = await client.getChats();
      const groups = chats
        .filter(c => c.isGroup)
        .map(c => ({ id: c.id._serialized, name: c.name, participants: c.participants?.length }));
      res.json(groups);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return { app, setState, getState };
}

module.exports = { createApp };
