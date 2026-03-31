const https = require('https');

const API_KEY = process.env.SPOOME_API_KEY;

function spooRequest(options, body) {
  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Shorten a URL using spoo.me (account-linked via Bearer auth for click tracking).
 * Returns the short URL string, or the original URL if shortening fails.
 */
async function shortenUrl(url) {
  if (!API_KEY) {
    console.warn('[spoo.me] SPOOME_API_KEY not set — skipping shortening');
    return url;
  }

  const body = JSON.stringify({ url });
  const json = await spooRequest({
    hostname: 'spoo.me',
    path: '/api/v1/shorten',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);

  const short = json?.short_url || json?.shortUrl;
  if (short) return short;
  console.warn('[spoo.me] shortenUrl unexpected response:', JSON.stringify(json));
  return url;
}

/**
 * Fetch click stats for all spoo.me URLs in the account.
 * Returns a map of { "https://spoo.me/{alias}": totalClicks }
 */
async function getAllClickStats() {
  if (!API_KEY) return {};

  const clicks = {};
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const result = await new Promise((resolve) => {
      const options = {
        hostname: 'spoo.me',
        path: `/api/v1/urls?page=${page}&pageSize=100`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Accept': 'application/json',
          'Content-Length': 0,
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.end();
    });

    if (!result || !Array.isArray(result.items)) break;

    for (const item of result.items) {
      clicks[`https://spoo.me/${item.alias}`] = item.total_clicks ?? 0;
    }

    hasNext = result.hasNext === true;
    page++;
  }

  return clicks;
}

module.exports = { shortenUrl, getAllClickStats };
