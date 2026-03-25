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

async function postPhoto({ message, imageUrl }, channelCfg = {}) {
  const pageId    = channelCfg.pageId    || process.env.FACEBOOK_PAGE_ID;
  const pageToken = channelCfg.pageToken || process.env.FACEBOOK_ACCESS_TOKEN;

  if (!pageId || !pageToken) {
    throw new Error('FACEBOOK_PAGE_ID or FACEBOOK_ACCESS_TOKEN not set');
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

async function getTokenInfo(channelCfg = {}) {
  const appId     = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const token     = channelCfg.pageToken || process.env.FACEBOOK_ACCESS_TOKEN;

  if (!appId || !appSecret || !token) {
    throw new Error('FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, and FACEBOOK_ACCESS_TOKEN must be set');
  }

  const response = await axios.get(`${BASE}/debug_token`, {
    params: {
      input_token: token,
      access_token: `${appId}|${appSecret}`,
    },
  });

  const data = response.data?.data;
  return {
    valid: data.is_valid,
    app: data.application,
    user_id: data.user_id,
    scopes: data.scopes,
    expires_at: data.expires_at
      ? new Date(data.expires_at * 1000).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })
      : 'לא פג תוקף (Page Token)',
    expires_at_raw: data.expires_at || 0,
    days_left: data.expires_at
      ? Math.ceil((data.expires_at * 1000 - Date.now()) / (1000 * 60 * 60 * 24))
      : null,
  };
}

async function refreshToken(channelCfg = {}) {
  const appId      = process.env.FACEBOOK_APP_ID;
  const appSecret  = process.env.FACEBOOK_APP_SECRET;
  const shortToken = channelCfg.userToken || process.env.FACEBOOK_ACCESS_TOKEN;

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

module.exports = { postPhoto, refreshToken, getTokenInfo };
