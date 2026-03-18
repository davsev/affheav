require('dotenv').config();
const express = require('express');
const path = require('path');
const workflow = require('./services/workflow');
const scheduler = require('./scheduler');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── SSE Log Stream ────────────────────────────────────────────────────────────
const sseClients = new Set();
const logHistory = [];   // replay buffer — keeps last 500 entries
const LOG_HISTORY_MAX = 500;

app.get('/api/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Replay existing history to the new client
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

// Wire the log emitter into workflow service
workflow.setEmitter(emitLog);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/products', require('./routes/products'));
app.use('/api/send', require('./routes/send'));
app.use('/api/schedules', require('./routes/schedules'));
app.use('/api/scrape', require('./routes/scrape'));
app.use('/api/facebook', require('./routes/facebook'));
app.use('/api/prompt', require('./routes/prompt'));

// Fallback: serve index.html for any unmatched route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🎯 Affiliate Heaven running at http://localhost:${PORT}\n`);

  // Wire the workflow runner into the scheduler
  scheduler.setWorkflowRunner(() => workflow.run());

  // Start all cron jobs
  const count = scheduler.startAll();
  console.log(`📅 ${count} schedule(s) loaded\n`);
});
