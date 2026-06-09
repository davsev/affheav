const axios   = require('axios');
const cheerio = require('cheerio');

const SCRAPE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

module.exports = {
  id: 'manual',
  label: 'Manual / Other',
  canSearch: false,
  canFetchByUrl: true,
  urlPattern: null, // catch-all — matched last

  async fetchByUrl(url) {
    try {
      const res = await axios.get(url, {
        timeout:        12000,
        headers:        SCRAPE_HEADERS,
        validateStatus: () => true,
        maxRedirects:   5,
      });

      if (res.status === 404) return { not_found: true };

      const $ = cheerio.load(res.data);

      const title = $('meta[property="og:title"]').attr('content')
        || $('title').text().trim()
        || null;

      const image = $('meta[property="og:image"]').attr('content') || null;

      return { data: { title, image, sale_price: null, video_url: null } };
    } catch {
      return { data: null };
    }
  },

  getDefaultCommission() { return null; },
};
