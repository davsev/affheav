const axios = require('axios');
require('dotenv').config();

async function send({ text, image, wa_group, webhookUrl }) {
  const url = webhookUrl || process.env.MACRODROID_WEBHOOK_URL;
  if (!url) throw new Error('MACRODROID_WEBHOOK_URL not set in .env');

  const params = { text, image, wa_group };
  console.log('[WhatsApp] Sending webhook:', url);
  console.log('[WhatsApp] Params:', JSON.stringify({ text: text?.slice(0, 80) + '...', image, wa_group }));

  const response = await axios.get(url, { params, timeout: 30000 });

  const data = response.data;
  console.log('[WhatsApp] Response status:', response.status, '| body:', JSON.stringify(data));

  // MacroDroid returns "OK" on success
  const success = typeof data === 'string'
    ? data.trim() === 'OK'
    : data?.data === 'OK' || data === 'OK';

  return { success, raw: data };
}

module.exports = { send };
