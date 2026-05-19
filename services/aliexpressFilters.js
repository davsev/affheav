/**
 * Shared AliExpress product filter utility.
 * Used by routes/aliexpress-api.js and services/discoveryAgent.js.
 */

function passesFilters(product) {
  const rate = parseFloat((product.evaluate_rate || '0').replace('%', '')) || 0;
  const volume = Number(product.lastest_volume || 0);
  const stockRaw = product.available_stock;
  const stockOk = stockRaw === undefined || stockRaw === null || stockRaw === '' || Number(stockRaw) > 100;
  return rate > 80 && volume > 50 && stockOk;
}

module.exports = { passesFilters };
