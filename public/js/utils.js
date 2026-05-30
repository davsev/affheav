/** Escape HTML to prevent XSS */
export function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format an ISO date string as a localised short date+time */
export function fmtDate(iso, opts = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
    ...opts,
  });
}

export function fmtDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Debounce a function */
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Format number with commas */
export function fmtNum(n) {
  if (n == null || n === '') return '—';
  return Number(n).toLocaleString();
}

/** Format currency (ILS) */
export function fmtILS(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(n);
}

/** Truncate string */
export function trunc(str, len = 60) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

/** Generate a random colour for a niche chip */
const NICHE_COLORS = [
  '#702ae1','#0ea5e9','#16a34a','#d97706','#dc2626',
  '#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1',
];
export function nicheColor(index) {
  return NICHE_COLORS[index % NICHE_COLORS.length];
}

/** Copy text to clipboard */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

/** Sleep */
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
