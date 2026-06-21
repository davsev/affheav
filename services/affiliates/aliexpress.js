const { signAndCall }         = require('../aliexpressApi');
const { passesFilters }       = require('../aliexpressFilters');
const { fetchProductDataByUrl } = require('../aliexpressSync');

const DEFAULT_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || 'TechSalebuy';

module.exports = {
  id: 'aliexpress',
  label: 'AliExpress',
  canSearch: true,
  canFetchByUrl: true,
  urlPattern: /aliexpress\.com|s\.click\.aliexpress/i,

  async search({ keywords, trackingId = DEFAULT_TRACKING_ID, page = 1 }) {
    const res = await signAndCall({
      method:          'aliexpress.affiliate.product.query',
      keywords,
      target_currency: 'ILS',
      target_language: 'HE',
      tracking_id:     trackingId,
      sort:            'LAST_VOLUME_DESC',
      page_no:         String(page),
      page_size:       '50',
      fields:          'product_id,product_title,product_main_image_url,product_video_url,promotion_link,app_sale_price,evaluate_rate,lastest_volume,available_stock',
    });

    const products =
      res.data?.aliexpress_affiliate_product_query_response
        ?.resp_result?.result?.products?.product || [];

    return products.filter(passesFilters);
  },

  async fetchByUrl(url, { trackingId = DEFAULT_TRACKING_ID } = {}) {
    const result = await fetchProductDataByUrl(url, trackingId);

    // If API + axios scraper both failed to return title/image, fall back to Playwright
    if (!result.not_found && !result.data?.title && !result.data?.image) {
      try {
        const { scrapeProduct } = require('../../scrapers/aliexpress');
        const scraped = await scrapeProduct(url);
        if (scraped.text || scraped.image) {
          return {
            data: {
              title:      scraped.text  || null,
              image:      scraped.image || null,
              sale_price: null,
              video_url:  null,
            },
          };
        }
      } catch { /* Playwright not available or scrape failed — return original result */ }
    }

    return result;
  },

  getDefaultCommission() { return 0.08; },
};
