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
