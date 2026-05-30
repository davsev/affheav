/**
 * dashboard.js — Per-niche overview cards.
 */
import { get } from '../api.js';
import { escHtml, nicheColor } from '../utils.js';

let _state;

export function init(state) {
  _state = state;
  load();
  document.addEventListener('subjectChanged', load);
}

async function load() {
  try {
    const { products } = await get('/api/products');
    renderKpis(products);
    renderGrid(products);
  } catch {}
}

function renderKpis(products) {
  const strip = document.getElementById('dashboard-kpi-strip');
  if (!strip) return;

  const total  = products.length;
  const sent   = products.filter(p => p.sentAt || p.sent_at).length;
  const unsent = total - sent;
  const clicks = products.reduce((s, p) => s + (p.clicks || 0), 0);

  strip.innerHTML = kpiCard('Total', total, 'badge--neutral') +
    kpiCard('Unsent', unsent, 'badge--warning') +
    kpiCard('Sent', sent, 'badge--success') +
    kpiCard('Clicks', clicks, 'badge--info');
}

function kpiCard(label, value, cls) {
  return `
    <div class="card card--glass card--kpi">
      <div class="card__kpi-label">${escHtml(label)}</div>
      <div class="card__kpi-value">${value.toLocaleString()}</div>
    </div>
  `;
}

function renderGrid(products) {
  const grid = document.getElementById('dashboard-grid');
  if (!grid) return;

  const { subjects } = _state;
  if (!subjects.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-state__title">No niches configured yet</div></div>';
    return;
  }

  grid.innerHTML = subjects.map((s, i) => {
    const sp     = products.filter(p => p.subjectId === s.id || p.subject_id === s.id);
    const sent   = sp.filter(p => p.sentAt || p.sent_at).length;
    const unsent = sp.length - sent;
    const clicks = sp.reduce((a, p) => a + (p.clicks || 0), 0);
    const color  = nicheColor(i);

    return `
      <div class="card card--interactive niche-card" data-subject="${escHtml(s.id)}" style="--chip-color:${color}">
        <div class="niche-card__icon" style="background:${color}22;">${escHtml(s.icon || '🏷️')}</div>
        <div>
          <div class="niche-card__name">${escHtml(s.name)}</div>
        </div>
        <div class="niche-card__meta">
          <span class="badge badge--neutral">${sp.length} total</span>
          <span class="badge badge--warning">${unsent} unsent</span>
          <span class="badge badge--success">${sent} sent</span>
          <span class="badge badge--info">${clicks.toLocaleString()} clicks</span>
        </div>
      </div>
    `;
  }).join('');

  // Click to switch tab + filter by niche
  grid.querySelectorAll('.niche-card[data-subject]').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.subject;
      import('../app.js').then(({ setActiveSubject }) => setActiveSubject(id));
      document.querySelector('[data-tab="products"]')?.click();
    });
  });
}
