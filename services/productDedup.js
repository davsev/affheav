/**
 * Shared near-duplicate title detection for the AliExpress agents (discoveryAgent,
 * autoProductAgent). AliExpress product IDs differ per seller even for the exact same
 * physical item, so ID-only dedup misses e.g. the same LED strip listed by five
 * different suppliers — this catches that by comparing significant title words instead.
 */

const STOPWORDS = new Set([
  'for', 'with', 'and', 'the', 'an', 'of', 'to', 'in', 'on', 'new', 'hot',
  'sale', 'sales', 'free', 'shipping', 'high', 'quality', 'best', 'pcs', 'pc',
  'pack', 'set', 'style', 'fashion', '2024', '2025', '2026',
]);

function significantWords(title) {
  return new Set(
    (title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
  );
}

function titleSimilarity(a, b) {
  const wa = a instanceof Set ? a : significantWords(a);
  const wb = b instanceof Set ? b : significantWords(b);
  if (!wa.size || !wb.size) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  const union = wa.size + wb.size - intersection;
  return union ? intersection / union : 0;
}

// Jaccard similarity of significant words above which two titles are treated as the
// same physical product (e.g. listed by different suppliers). Deliberately loose
// rather than exact-match, since that's exactly the case ID-based dedup misses.
const DUPLICATE_TITLE_THRESHOLD = 0.5;

function isNearDuplicateTitle(title, otherTitlesOrWordSets, threshold = DUPLICATE_TITLE_THRESHOLD) {
  const words = significantWords(title);
  for (const other of otherTitlesOrWordSets) {
    if (titleSimilarity(words, other) >= threshold) return true;
  }
  return false;
}

module.exports = { significantWords, titleSimilarity, isNearDuplicateTitle, DUPLICATE_TITLE_THRESHOLD };
