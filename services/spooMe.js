const https = require('https');
const querystring = require('querystring');

const API_KEY = process.env.SPOOME_API_KEY;
const ENDPOINT = 'https://spoo.me/api/v1/shorten';

/**
 * Shorten a URL using spoo.me.
 * Returns the short URL string, or the original URL if shortening fails.
 */
async function shortenUrl(url) {
  if (!API_KEY) {
    console.warn('[spoo.me] SPOOME_API_KEY not set — skipping shortening');
    return url;
  }

  return new Promise((resolve) => {
    const body = querystring.stringify({ url });
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-API-Key': API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(ENDPOINT, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const short = json.short_url || json.shortUrl || json.url;
          if (short) {
            resolve(short);
          } else {
            console.warn('[spoo.me] Unexpected response:', data);
            resolve(url);
          }
        } catch {
          console.warn('[spoo.me] Failed to parse response:', data);
          resolve(url);
        }
      });
    });

    req.on('error', (err) => {
      console.warn('[spoo.me] Request error:', err.message);
      resolve(url); // fall back to original
    });

    req.write(body);
    req.end();
  });
}

module.exports = { shortenUrl };
