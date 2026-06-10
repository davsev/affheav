const aliexpress = require('./aliexpress');
const amazon     = require('./amazon');
const manual     = require('./manual');

// Ordered: most specific patterns first; manual is the catch-all (no urlPattern).
const providers = [aliexpress, amazon, manual];
const byId      = Object.fromEntries(providers.map(p => [p.id, p]));

function detectProvider(url) {
  if (!url) return manual;
  for (const p of providers) {
    if (p.urlPattern && p.urlPattern.test(url)) return p;
  }
  return manual;
}

function getProvider(id) {
  return byId[id] || manual;
}

function listProviders() {
  return providers.map(({ id, label, canSearch, canFetchByUrl }) => ({
    id, label, canSearch, canFetchByUrl,
  }));
}

module.exports = { detectProvider, getProvider, listProviders };
