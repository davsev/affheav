const axios = require('axios');

const BASE = 'https://graph.facebook.com/v24.0';

/**
 * Post a photo to an Instagram Business Account.
 * Uses the Meta Content Publishing API (two-step: create container → publish).
 *
 * @param {object} opts
 * @param {string} opts.igUserId     - Instagram Business Account ID
 * @param {string} opts.accessToken  - Page Access Token (needs instagram_content_publish scope)
 * @param {string} opts.imageUrl     - Publicly accessible image URL
 * @param {string} opts.caption      - Post caption text
 */
async function postPhoto({ igUserId, accessToken, imageUrl, caption }) {
  if (!igUserId || !accessToken) {
    throw new Error('Instagram Account ID and Access Token are required');
  }
  if (!imageUrl) {
    throw new Error('Image URL is required for Instagram posts');
  }

  // Step 1: Create media container
  let creationId;
  try {
    const containerRes = await axios.post(
      `${BASE}/${igUserId}/media`,
      null,
      {
        params: {
          image_url: imageUrl,
          caption: caption || '',
          access_token: accessToken,
        },
        timeout: 30000,
      }
    );
    creationId = containerRes.data?.id;
    if (!creationId) {
      throw new Error(`No creation_id in response: ${JSON.stringify(containerRes.data)}`);
    }
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Instagram container creation failed: ${detail}`);
  }

  // Step 1.5: Wait for container to be ready (Instagram needs time to process the image)
  const MAX_POLLS = 10;
  const POLL_INTERVAL_MS = 3000;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const statusRes = await axios.get(`${BASE}/${creationId}`, {
        params: { fields: 'status_code', access_token: accessToken },
        timeout: 15000,
      });
      const status = statusRes.data?.status_code;
      if (status === 'FINISHED') break;
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new Error(`Instagram container processing failed with status: ${status}`);
      }
      // IN_PROGRESS — keep polling
    } catch (err) {
      if (err.message.startsWith('Instagram container')) throw err;
      // network hiccup — continue polling
    }
    if (i === MAX_POLLS - 1) {
      throw new Error('Instagram container was not ready after 30 seconds');
    }
  }

  // Step 2: Publish the container
  try {
    const publishRes = await axios.post(
      `${BASE}/${igUserId}/media_publish`,
      null,
      {
        params: {
          creation_id: creationId,
          access_token: accessToken,
        },
        timeout: 30000,
      }
    );
    return { success: true, data: publishRes.data };
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Instagram publish failed: ${detail}`);
  }
}

module.exports = { postPhoto };
