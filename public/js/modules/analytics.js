import { get, post } from '../api.js';
import { escHtml, fmtNum } from '../utils.js';
import { toast } from '../components/toast.js';

let _state, _booted = false, _days = 30;

export function init(state) {
  if (_booted) return; _booted = true;
  _state = state;
  wireTabs();
  wireDayFilters();
  wireSync();
  load();
}

async function load() {
  try {
    const [summary] = await Promise.all([
      get(`/api/analytics/summary`)
    ]);
    renderKpis(summary.niches || []);
  } catch {}
}

function renderKpis(niches) {
  const strip = document.getElementById('analytics-kpi-strip');
  if (!strip) return;
  const totals = niches.reduce((acc, n) => {
    acc.commission += parseFloat(n.total_commission || 0);
    acc.orders     += parseInt(n.total_orders || 0);
    acc.clicks     += parseInt(n.total_clicks || 0);
    return acc;
  }, { commission: 0, orders: 0, clicks: 0 });

  strip.innerHTML = [
    { label: 'Commission', value: `$${totals.commission.toFixed(2)}` },
    { label: 'Orders',     value: fmtNum(totals.orders) },
    { label: 'Clicks',     value: fmtNum(totals.clicks) },
  ].map(k => `
    <div class="card card--glass card--kpi">
      <div class="card__kpi-label">${escHtml(k.label)}</div>
      <div class="card__kpi-value">${escHtml(k.value)}</div>
    </div>
  `).join('');
}

function wireTabs() {
  document.querySelectorAll('[data-analytics-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-analytics-tab]').forEach(t => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      loadContent(tab.dataset.analyticsTab);
    });
  });
}

async function loadContent(tab) {
  const el = document.getElementById('analytics-content');
  if (!el) return;
  el.innerHTML = `<div class="flex items-center justify-center p-10"><span class="spinner"></span></div>`;
  try {
    if (tab === 'orders') await renderOrders(el);
    else if (tab === 'top-products') await renderTopProducts(el);
    else if (tab === 'reach') await renderReach(el);
    else { el.innerHTML = `<p class="text-muted text-sm">Section coming soon.</p>`; }
  } catch (err) {
    el.innerHTML = `<p class="text-error text-sm">${escHtml(err.message)}</p>`;
  }
}

async function renderOrders(el) {
  const { rows } = await get(`/api/analytics/daily-stats?days=${_days}`);
  const headers = ['Date','Orders','Commission','Order Value'];
  el.innerHTML = tableHtml(headers, (rows || []).map(r => [
    escHtml(r.day?.slice(0,10)),
    fmtNum(r.orders_count),
    `$${parseFloat(r.total_commission||0).toFixed(2)}`,
    `$${parseFloat(r.total_order_value||0).toFixed(2)}`,
  ]));
}

async function renderTopProducts(el) {
  const { products } = await get('/api/analytics/top-products');
  const headers = ['Product','Clicks','Commission'];
  el.innerHTML = tableHtml(headers, (products || []).slice(0,20).map(p => [
    escHtml(p.text?.slice(0,60) || p.id),
    fmtNum(p.clicks),
    `$${parseFloat(p.attributed_commission||0).toFixed(2)}`,
  ]));
}

async function renderReach(el) {
  const { subjects } = await get('/api/analytics/reach-summary');
  const headers = ['Niche','Avg Reach','Impressions','CTR'];
  el.innerHTML = tableHtml(headers, (subjects || []).map(s => [
    escHtml(s.name || s.subject_id),
    fmtNum(s.avg_reach_per_post),
    fmtNum(s.total_impressions),
    `${parseFloat(s.ctr||0).toFixed(2)}%`,
  ]));
}

function tableHtml(headers, rows) {
  return `
    <div class="table-wrap">
      <table class="table table--compact">
        <thead class="table__head">
          <tr>${headers.map(h => `<th class="table__th">${h}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map(r => `<tr class="table__row">${r.map(c => `<td class="table__td">${c}</td>`).join('')}</tr>`).join('') || `<tr><td class="table__empty" colspan="${headers.length}">No data</td></tr>`}
        </tbody>
      </table>
    </div>`;
}

function wireDayFilters() {
  document.querySelectorAll('[data-days]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-days]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _days = Number(btn.dataset.days);
      const activeTab = document.querySelector('[data-analytics-tab].is-active')?.dataset.analyticsTab;
      if (activeTab) loadContent(activeTab);
    });
  });
}

function wireSync() {
  document.getElementById('btn-sync-commissions')?.addEventListener('click', async () => {
    toast.info('Syncing commissions…');
    try {
      const r = await post('/api/analytics/sync-commissions');
      toast.success('Done', `${r.synced} orders synced`);
      load();
    } catch (err) { toast.error('Sync failed', err.message); }
  });

  document.getElementById('btn-sync-reach')?.addEventListener('click', async () => {
    toast.info('Syncing reach…');
    try {
      await post('/api/analytics/sync-reach');
      toast.success('Reach synced');
    } catch (err) { toast.error('Failed', err.message); }
  });
}
