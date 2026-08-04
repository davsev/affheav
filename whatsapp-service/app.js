const express = require('express');
const { withRetry } = require('./utils');

// Puppeteer/whatsapp-web.js failure signatures that mean the underlying browser
// page is unusable (e.g. WhatsApp Web reloaded its own page mid-call, or the
// browser tab/context was torn down) — as opposed to a normal "chat not found"
// or transient hiccup. whatsapp-web.js doesn't reliably emit a 'disconnected'
// event for these, so the client can keep reporting CONNECTED while every real
// call keeps failing until something forces a fresh browser session.
const PAGE_DEAD_PATTERN = /detached Frame|Session closed|Target closed|Protocol error|Execution context was destroyed|Connection closed/i;
function isPageDeadError(message) {
  return PAGE_DEAD_PATTERN.test(message || '');
}

function createApp({
  getClient,
  apiKey = process.env.WHATSAPP_API_KEY,
  retryAttempts = 3,
  retryDelayMs = 2000,
  MessageMedia = require('whatsapp-web.js').MessageMedia,
  sharp = require('sharp'),
  onFatalError = () => {},
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
    const { groupId, text, imageUrl, videoUrl } = req.body;

    if (!groupId || !text) {
      return res.status(400).json({ error: 'groupId and text are required' });
    }
    if (clientState !== 'CONNECTED') {
      return res.status(503).json({ error: 'WhatsApp not connected', state: clientState });
    }

    const client = getClient();

    enqueue(async () => {
      // getChatById reads from whatsapp-web.js's local chat store, which is rebuilt
      // from scratch in memory on every process restart and can take a while to fully
      // sync (worse for group-heavy accounts) — 'ready'/CONNECTED fires well before
      // that sync finishes. getChats() forces a resync pass, and retrying a few times
      // with a delay gives a chat that hasn't landed yet a chance to show up before we
      // give up on it.
      // Tracks the last real error (client/Puppeteer crash) seen while resolving,
      // as opposed to a clean "not in the chat list" result — these need different
      // messages: one means "wrong group ID", the other means "we couldn't check".
      let lastClientErr = null;

      async function resolveChat() {
        let found = null;
        try {
          found = await client.getChatById(groupId);
          lastClientErr = null;
        } catch (err) {
          lastClientErr = err;
        }
        if (!found) {
          try {
            const chats = await client.getChats();
            found = chats.find(c => c.id?._serialized === groupId) || null;
            lastClientErr = null; // getChats() itself succeeded — a clean "not in the list"
          } catch (err) {
            lastClientErr = err;
          }
        }
        if (!found) throw new Error('not resolved yet');
        return found;
      }

      let chat;
      try {
        chat = await withRetry(resolveChat, { attempts: retryAttempts, delayMs: retryDelayMs });
      } catch (_) {
        chat = null;
      }
      if (!chat) {
        let err;
        if (lastClientErr) {
          // The WhatsApp client itself errored out (e.g. a Puppeteer/whatsapp-web.js
          // crash) — we never actually got a clean answer, so don't claim the group
          // is missing. Surface the real cause instead.
          err = new Error(`WhatsApp client error while looking up group ${groupId}: ${lastClientErr.message}`);
          err.status = 502;
        } else {
          err = new Error(`Group not found: ${groupId}`);
          err.status = 404;
        }
        throw err;
      }
      if (!chat.isGroup) {
        const err = new Error(`Not a group: ${groupId}`);
        err.status = 400;
        throw err;
      }

      let message;

      // Try video first
      if (videoUrl) {
        let media = null;
        try {
          media = await MessageMedia.fromUrl(videoUrl, { unsafeMime: true });
          const mime = media?.mimetype || '';
          if (!mime.startsWith('video/') && mime !== 'application/octet-stream') {
            console.log(`[whatsapp] video rejected — unexpected MIME type: ${mime}`);
            media = null;
          }
        } catch (err) {
          console.log(`[whatsapp] video download failed: ${err.message}`);
          media = null;
        }

        if (media) {
          try {
            message = await withRetry(() => client.sendMessage(groupId, media, { caption: text }), { attempts: retryAttempts, delayMs: retryDelayMs });
            console.log(`[whatsapp] video sent OK to ${groupId}`);
          } catch (err) {
            console.log(`[whatsapp] video send failed: ${err.message} — falling back to image`);
          }
        }
      }

      // Fall back to image
      if (!message && imageUrl) {
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
          } catch (_) { /* fall through to text-only */ }
        }
      }

      // Fall back to text-only
      if (!message) {
        message = await withRetry(() => client.sendMessage(groupId, text), { attempts: retryAttempts, delayMs: retryDelayMs });
      }

      return { chatName: chat.name, messageId: message.id._serialized };
    })
      .then(result => res.json({ success: true, ...result }))
      .catch(err => {
        // Puppeteer/whatsapp-web.js internals can throw with a bare, unhelpful
        // .message (sometimes a single minified token) when WhatsApp Web's own
        // client-side code errors out from underneath us — log the full error
        // here so Railway logs carry more than what we hand back to the caller.
        console.error(`[whatsapp] /send failed for ${groupId}:`, err);
        if (isPageDeadError(err.message)) onFatalError(err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
      });
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
      console.error('[whatsapp] /groups failed:', err);
      if (isPageDeadError(err.message)) onFatalError(err.message);
      res.status(502).json({ error: `WhatsApp client error while listing groups: ${err.message}` });
    }
  });

  return { app, setState, getState };
}

module.exports = { createApp, isPageDeadError };
