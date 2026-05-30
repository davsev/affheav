import { get, post } from '../api.js';
import { escHtml, trunc } from '../utils.js';
import { toast } from '../components/toast.js';

let _state, _booted = false;
let _results = [], _sort = 'score', _page = 1;
let _existingUrls = new Set();

export function init(state) {
  if (_booted) return; _booted = true;
  _state = state;
  populateSubject();
  wireSearch();
  wireSortButtons();
  wireNextPage();
  loadExisting();
}

async function loadExisting() {
  try {
    const { urls } = await get('/api/aliexpress/existing');
    _existingUrls = new Set(urls || []);
  } catch {}
}

function populateSubject() {
  const el = document.getElementById('ali-subject');
  if (!el) return;
  _state.subjects.forEach(s => el.appendChild(new Option(s.name, s.id)));
}

function wireSearch() {
  document.getElementById('btn-ali-search')?.addEventListener('click', () => { _page = 1; search(); });
  document.getElementById('ali-keywords')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { _page = 1; search(); }
  });
}

async function search() {
  const keywords = document.getElementById('ali-keywords')?.value?.trim();
  const subjectId = document.getElementById('ali-subject')?.value;
  if (!keywords) return toast.error('Keywords required');

  const btn = document.getElementById('btn-ali-search');
  btn?.classList.add('is-loading');

  try {
    const data = await post('/api/aliexpress/search', { keywords, subjectId, page_no: _page });
    _results = data.products || [];
    const summary = document.getElementById('ali-results-summary');
    if (summary) summary.textContent = `${data.filtered || _results.length} results (${data.total || _results.length} total)`;
    document.getElementById('btn-ali-next')?.classList.toggle('hidden', _results.length < 50);
    render();
  } catch (err) {
    toast.error('Search failed', err.message);
  } finally {
    btn?.classList.remove('is-loading');
  }
}

function wireSortButtons() {
  document.querySelectorAll('[data-ali-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-ali-sort]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _sort = btn.dataset.aliSort;
      render();
    });
  });
}

function wireNextPage() {
  document.getElementById('btn-ali-next')?.addEventListener('click', () => { _page++; search(); });
}

function sortResults(results) {
  const sorted = [...results];
  const parse = v => parseFloat(String(v).replace(/[^0-9.]/g,'')) || 0;
  if (_sort === 'rating')     return sorted.sort((a,b) => parse(b.evaluate_rate) - parse(a.evaluate_rate));
  if (_sort === 'volume')     return sorted.sort((a,b) => (b.lastest_volume||0) - (a.lastest_volume||0));
  if (_sort === 'price_asc')  return sorted.sort((a,b) => parse(a.app_sale_price) - parse(b.app_sale_price));
  if (_sort === 'price_desc') return sorted.sort((a,b) => parse(b.app_sale_price) - parse(a.app_sale_price));
  // score: 40% rating + 40% volume + 20% price-inverse
  return sorted.sort((a,b) => score(b) - score(a));
}

function score(p) {
  const r = parseFloat(p.evaluate_rate) || 0;
  const v = Math.min(p.lastest_volume || 0, 10000) / 10000;
  const pr = p.app_sale_price ? Math.max(0, 1 - parseFloat(p.app_sale_price) / 500) : 0;
  return r * 0.4 + v * 100 * 0.4 + pr * 100 * 0.2;
}

function render() {
  const grid = document.getElementById('ali-results-grid');
  if (!grid) return;
  const sorted = sortResults(_results);
  grid.innerHTML = sorted.map(p => productCard(p)).join('');

  grid.querySelectorAll('[data-add-ali]').forEach(btn => {
    btn.addEventListener('click', () => addProduct(btn.dataset.addAli));
  });
}

function productCard(p) {
  const exists = _existingUrls.has(p.promotion_link);
  return `
    <div class="card" style="overflow:hidden;">
      <div style="aspect-ratio:1/1;overflow:hidden;background:var(--color-surface-raised);position:relative;">
        <img src="${escHtml(p.product_main_image_url)}" alt="" loading="lazy"
          style="width:100%;height:100%;object-fit:contain;">
        ${exists ? `<span class="badge badge--info" style="position:absolute;top:8px;left:8px;">In list</span>` : ''}
      </div>
      <div style="padding:var(--space-3) var(--space-4);display:flex;flex-direction:column;gap:var(--space-2);">
        <div class="text-sm font-medium line-clamp-2">${escHtml(trunc(p.product_title, 80))}</div>
        <div class="flex gap-2 flex-wrap">
          <span class="badge badge--neutral">₪${escHtml(String(p.app_sale_price || '?'))}</span>
          <span class="badge badge--info">${escHtml(String(p.evaluate_rate || '?'))}%</span>
          <span class="badge badge--neutral">${(p.lastest_volume || 0).toLocaleString()} sold</span>
        </div>
        <div class="flex gap-2">
          <a href="${escHtml(p.promotion_link)}" target="_blank" class="btn btn--ghost btn--xs">Open</a>
          ${!exists ? `<button class="btn btn--primary btn--xs" data-add-ali="${escHtml(p.promotion_link)}">Add</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

async function addProduct(promotionLink) {
  const subjectId = document.getElementById('ali-subject')?.value;
  const waGroupId = document.getElementById('ali-wagroup')?.value;
  const product   = _results.find(p => p.promotion_link === promotionLink);
  if (!product) return;
  try {
    await post('/api/aliexpress/add', { product, subject: subjectId, whatsappGroupId: waGroupId });
    _existingUrls.add(promotionLink);
    toast.success('Added to list');
    render();
  } catch (err) { toast.error('Failed', err.message); }
}
