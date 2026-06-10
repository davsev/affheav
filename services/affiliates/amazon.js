const axios   = require('axios');
const cheerio = require('cheerio');

const SCRAPE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

function extractAsin(url) {
  const m = url.match(/\/(?:dp|gp\/product|d)\/([A-Z0-9]{10})/);
  return m ? m[1] : null;
}

function buildAffiliateUrl(url, tag) {
  if (!tag) return url;
  try {
    const asin = extractAsin(url);
    if (asin) return `https://www.amazon.com/dp/${asin}?tag=${encodeURIComponent(tag)}`;
    const u = new URL(url);
    u.searchParams.set('tag', tag);
    ['ref', 'ref_', 'psc', 'smid', 'th'].forEach(k => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return url;
  }
}

module.exports = {
  id: 'amazon',
  label: 'Amazon',
  canSearch: false,
  canFetchByUrl: true,
  urlPattern: /amazon\.(com|co\.uk|de|fr|it|es|co\.jp|com\.au|in|ca|com\.br|com\.mx)(\/|$)/i,

  async fetchByUrl(url, { affiliateTag } = {}) {
    let res;
    try {
      res = await axios.get(url, {
        timeout:        15000,
        headers:        SCRAPE_HEADERS,
        validateStatus: () => true,
        maxRedirects:   5,
      });
    } catch {
      return { data: null };
    }

    if (res.status === 404) return { not_found: true };

    const $ = cheerio.load(res.data);

    const title = $('#productTitle').text().trim()
      || $('meta[name="title"]').attr('content')
      || $('meta[property="og:title"]').attr('content')
      || null;

    const image = $('#landingImage').attr('src')
      || $('meta[property="og:image"]').attr('content')
      || null;

    let salePrice = null;
    const priceSelectors = ['.a-price-whole', '#priceblock_ourprice', '#priceblock_dealprice', '.a-offscreen'];
    for (const sel of priceSelectors) {
      const raw = $(sel).first().text().replace(/[^0-9.]/g, '');
      const n   = parseFloat(raw);
      if (n > 0) { salePrice = n; break; }
    }

    const affiliateUrl = affiliateTag ? buildAffiliateUrl(url, affiliateTag) : url;

    return {
      data: {
        title,
        image,
        sale_price:    salePrice,
        affiliate_url: affiliateUrl,
        video_url:     null,
      },
    };
  },

  getDefaultCommission() { return 0.04; },

  buildAffiliateUrl,
  extractAsin,
};
