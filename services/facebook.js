const axios = require('axios');
require('dotenv').config();

const BASE = 'https://graph.facebook.com/v23.0';

async function getPageToken() {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const userToken = process.env.FACEBOOK_ACCESS_TOKEN;

  // Fetch all pages the user manages and find the matching one
  const response = await axios.get(`${BASE}/me/accounts`, {
    params: { access_token: userToken },
  });

  const pages = response.data?.data || [];
  const page = pages.find(p => p.id === pageId);

  if (!page) {
    const ids = pages.map(p => `${p.name} (${p.id})`).join(', ');
    throw new Error(`Page ${pageId} not found in managed pages. Available: ${ids || 'none'}`);
  }

  return page.access_token;
}

async function postPhoto({ message, imageUrl }) {
  const pageId = process.env.FACEBOOK_PAGE_ID;

  if (!pageId || !process.env.FACEBOOK_ACCESS_TOKEN) {
    throw new Error('FACEBOOK_PAGE_ID or FACEBOOK_ACCESS_TOKEN not set in .env');
  }

  let pageToken;
  try {
    pageToken = await getPageToken();
    console.log('[Facebook] Got page token successfully');
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`getPageToken failed: ${detail}`);
  }

  try {
    const response = await axios.post(
      `${BASE}/${pageId}/photos`,
      null,
      {
        params: {
          message,
          url: imageUrl,
          access_token: pageToken,
        },
        timeout: 30000,
      }
    );
    return { success: true, data: response.data };
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`postPhoto failed: ${detail}`);
  }
}

async function refreshToken() {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const shortToken = process.env.FACEBOOK_ACCESS_TOKEN;

  if (!appId || !appSecret || !shortToken) {
    throw new Error('FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, and FACEBOOK_ACCESS_TOKEN must be set');
  }

  const response = await axios.get(`${BASE}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken,
    },
  });

  return response.data; // { access_token, token_type, expires_in }
}

module.exports = { postPhoto, refreshToken };
