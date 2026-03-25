require('dotenv').config();
const express = require('express');
const path = require('path');
const workflow = require('./services/workflow');
const scheduler = require('./scheduler');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load persisted prompts from Google Sheets on startup (per channel)
const promptStore = require('./services/promptStore');
const channelStore = require('./services/channelStore');
const { getSetting } = require('./services/googleSheets');

async function loadPersistedPrompts() {
  try {
    const channels = await channelStore.getAll();
    for (const ch of channels) {
      // Try new per-channel key first, fall back to old global key for fishing
      let saved = await getSetting(`openai_prompt_${ch.id}`);
      if (!saved && ch.id === 'fishing') {
        saved = await getSetting('openai_prompt');
      }
      if (saved) {
        promptStore.set(ch.id, saved);
        console.log(`✓ Loaded prompt for channel: ${ch.id}`);
      }
    }
  } catch (err) {
    console.warn('Could not load prompts from Sheets:', err.message);
  }
}

loadPersistedPrompts();

// ── SSE Log Stream ────────────────────────────────────────────────────────────
const sseClients = new Set();
const logHistory = [];   // replay buffer — keeps last 500 entries
const LOG_HISTORY_MAX = 500;

app.get('/api/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  for (const entry of logHistory) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function emitLog(entry) {
  logHistory.push(entry);
  if (logHistory.length > LOG_HISTORY_MAX) logHistory.shift();

  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const client of sseClients) {
    client.write(data);
  }
}

workflow.setEmitter(emitLog);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/channels',  require('./routes/channels'));
app.use('/api/products',  require('./routes/products'));
app.use('/api/send',      require('./routes/send'));
app.use('/api/schedules', require('./routes/schedules'));
app.use('/api/scrape',    require('./routes/scrape'));
app.use('/api/facebook',  require('./routes/facebook'));
app.use('/api/prompt',    require('./routes/prompt'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`\n🎯 Affiliate Heaven running at http://localhost:${PORT}\n`);

  // Wire the workflow runner — receives channelId from scheduler
  scheduler.setWorkflowRunner(async (channelId = 'fishing') => {
    const ch = await channelStore.getById(channelId);
    if (!ch) {
      console.warn(`[scheduler] Channel not found: ${channelId}`);
      return;
    }
    const fbCfg = await channelStore.getFacebookConfig(channelId);
    const channel = { ...ch, facebookPageId: fbCfg.pageId, facebookPageToken: fbCfg.pageToken };
    return workflow.run(null, { channel });
  });

  const count = await scheduler.startAll();
  console.log(`📅 ${count} schedule(s) loaded\n`);
});
