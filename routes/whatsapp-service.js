const express = require('express');
const axios   = require('axios');
const router  = express.Router();

function getServiceBase() {
  return process.env.WHATSAPP_SERVICE_URL?.replace(/\/$/, '');
}

function getApiKey() {
  return process.env.WHATSAPP_API_KEY || '';
}

async function proxyGet(path, res) {
  const base = getServiceBase();
  if (!base) return res.status(503).json({ error: 'WHATSAPP_SERVICE_URL not configured' });
  try {
    const { data } = await axios.get(`${base}${path}`, {
      headers: { 'X-API-Key': getApiKey() },
      timeout: 10000,
    });
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 502;
    res.status(status).json({ error: err.response?.data?.error || err.message });
  }
}

router.get('/status', (req, res) => proxyGet('/status', res));
router.get('/groups', (req, res) => proxyGet('/groups', res));

module.exports = router;
