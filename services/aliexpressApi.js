const crypto = require('crypto');
const axios  = require('axios');

const ENDPOINT = 'https://api-sg.aliexpress.com/sync';

function signAndCall(params) {
  const APP_KEY    = process.env.ALIEXPRESS_APP_KEY;
  const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET;

  if (!APP_KEY || !APP_SECRET) {
    throw new Error('ALIEXPRESS_APP_KEY or ALIEXPRESS_APP_SECRET not configured');
  }

  const full = {
    app_key:     APP_KEY,
    timestamp:   Date.now().toString(),
    format:      'json',
    v:           '2.0',
    sign_method: 'md5',
    ...params,
  };

  const sortedKeys = Object.keys(full).sort();
  let signString = APP_SECRET;
  sortedKeys.forEach(k => { signString += k + full[k]; });
  signString += APP_SECRET;

  full.sign = crypto.createHash('md5').update(signString).digest('hex').toUpperCase();

  const qs = Object.keys(full)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(full[k]))
    .join('&');

  return axios.get(ENDPOINT + '?' + qs, { timeout: 20000 });
}

module.exports = { signAndCall };
