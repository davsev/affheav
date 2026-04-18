const axios = require('axios');
require('dotenv').config();

// Send via the whatsapp-service microservice (whatsapp-web.js)
async function sendViaWebJs({ text, image, groupId }) {
  const baseUrl = process.env.WHATSAPP_SERVICE_URL;
  const response = await axios.post(
    `${baseUrl}/send`,
    { groupId, text, imageUrl: image || undefined },
    {
      headers: { 'X-API-Key': process.env.WHATSAPP_API_KEY || '' },
      timeout: 30000,
    }
  );
  const data = response.data;
  return { success: !!data.success, raw: data };
}

// Send via MacroDroid webhook (legacy Android-based approach)
async function sendViaMacroDroid({ text, image, wa_group, webhookUrl }) {
  const url = webhookUrl || process.env.MACRODROID_WEBHOOK_URL;
  if (!url) throw new Error('MACRODROID_WEBHOOK_URL not set in .env');

  console.log('[WhatsApp] Sending webhook:', url);
  console.log('[WhatsApp] Params:', JSON.stringify({ text: text?.slice(0, 80) + '...', image, wa_group }));

  const response = await axios.get(url, { params: { text, image, wa_group }, timeout: 30000 });
  const data = response.data;
  console.log('[WhatsApp] Response status:', response.status, '| body:', JSON.stringify(data));

  const success = typeof data === 'string'
    ? data.trim() === 'OK'
    : data?.data === 'OK' || data === 'OK';

  return { success, raw: data };
}

async function send({ text, image, wa_group, webhookUrl, groupId }) {
  if (process.env.WHATSAPP_SERVICE_URL) {
    // groupId (whatsapp-web.js format, e.g. "120363...@g.us") takes priority;
    // fall back to wa_group for backwards compat if groupId not provided
    const target = groupId || wa_group;
    console.log('[WhatsApp] Sending via whatsapp-web.js service to:', target);
    return sendViaWebJs({ text, image, groupId: target });
  }
  return sendViaMacroDroid({ text, image, wa_group, webhookUrl });
}

module.exports = { send };
