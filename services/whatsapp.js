const axios = require('axios');
require('dotenv').config();

async function send({ text, image, wa_group }) {
  const baseUrl = process.env.WHATSAPP_SERVICE_URL?.replace(/\/$/, '');
  if (!baseUrl) throw new Error('WHATSAPP_SERVICE_URL not configured');

  let response;
  try {
    response = await axios.post(
      `${baseUrl}/send`,
      { groupId: wa_group, text, imageUrl: image || undefined },
      {
        headers: { 'X-API-Key': process.env.WHATSAPP_API_KEY || '' },
        timeout: 60000,
        validateStatus: () => true,
      }
    );
  } catch (err) {
    throw new Error(`WhatsApp service unreachable: ${err.message}`);
  }

  const data = response.data;
  if (response.status >= 400) {
    throw new Error(data?.error || `WhatsApp service returned HTTP ${response.status}`);
  }
  return { success: true, chatName: data.chatName, raw: data };
}

module.exports = { send };
