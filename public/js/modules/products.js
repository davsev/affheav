/**
 * products.js — Product list, filter, sort, table/card view, CRUD.
 */
import { get, post, put, del, patch } from '../api.js';
import { escHtml, fmtDate, trunc } from '../utils.js';
import { toast } from '../components/toast.js';
import { confirm, openModal, closeModal } from '../components/modal.js';

let _state;
let _products   = [];
let _filter     = 'unsent';
let _sort       = 'default';
let _view       = 'table';
let _editId     = null;
let _sendId     = null;

export function init(state) {
  _state = state;
  wireToolbar();
  wireProductActions();
  wireModals();
  load();

  document.addEventListener('subjectChanged', load);
}

async function load() {
  try {
    const params = _state.activeSubjectId ? `?subject=${_state.activeSubjectId}` : '';
    const { products } = await get(`/api/products${params}`);
    _products = products || [];
    render();
    updateCountBadge();
  } catch (err) {
    toast.error('Failed to load products', err.message);
  }
}

function render() {
  const filtered = applyFilter(_products);
  const sorted   = applySort(filtered);
  if (_view === 'table') renderTable(sorted);
  else renderCards(sorted);
}

function applyFilter(products) {
  if (_filter === 'sent')   return products.filter(p => p.sentAt || p.sent_at);
  if (_filter === 'unsent') return products.filter(p => !p.sentAt && !p.sent_at);
  return products;
}

function applySort(products) {
  if (_sort === 'clicks')    return [...products].sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
  if (_sort === 'sent_date') return [...products].sort((a, b) => new Date(b.sentAt || b.sent_at || 0) - new Date(a.sentAt || a.sent_at || 0));
  return products;
}

function renderTable(products) {
  document.getElementById('products-table-wrap')?.classList.remove('hidden');
  document.getElementById('products-card-grid')?.classList.add('hidden');

  const tbody = document.getElementById('products-tbody');
  if (!tbody) return;

  if (!products.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="table__empty">No products</td></tr>`;
    return;
  }

  tbody.innerHTML = products.map(p => {
    const sentBadge = p.sentAt || p.sent_at
      ? `<span class="badge badge--success">Sent</span>`
      : `<span class="badge badge--warning">Unsent</span>`;
    const sendCount = (p.sendCount || p.send_count || 0) > 1
      ? `<span class="badge badge--neutral">×${p.sendCount || p.send_count}</span>` : '';
    const fbBadge = p.facebookAt || p.facebook_at ? '📘' : '';
    const igBadge = p.instagramAt || p.instagram_at ? '📸' : '';

    return `
      <tr class="table__row" data-product-id="${escHtml(p.id)}">
        <td class="table__td table__td--shrink">
          <input type="checkbox" class="checkbox" aria-label="Select product">
        </td>
        <td class="table__td table__td--shrink">
          <span class="drag-handle" draggable="true" aria-label="Drag to reorder">⠿</span>
        </td>
        <td class="table__td table__td--shrink">
          ${p.image
            ? `<img src="${escHtml(p.image)}" class="table__thumb" alt="" loading="lazy">`
            : `<div class="table__thumb" style="display:flex;align-items:center;justify-content:center;font-size:18px;">📦</div>`}
        </td>
        <td class="table__td">
          <div class="text-sm font-medium truncate" style="max-width:280px;">${escHtml(trunc(p.text || p.title || 'No title', 80))}</div>
          ${p.shortLink || p.short_link
            ? `<a href="${escHtml(p.shortLink || p.short_link)}" target="_blank" class="text-xs text-muted" dir="ltr">${escHtml((p.shortLink || p.short_link || '').replace('https://', ''))}</a>`
            : ''}
        </td>
        <td class="table__td table__td--shrink table__td--muted text-xs truncate" style="max-width:120px;">${escHtml(p.waGroup || p.wa_group || '—')}</td>
        <td class="table__td table__td--shrink">
          <div class="flex flex-col gap-1 items-start">${sentBadge}${sendCount}</div>
        </td>
        <td class="table__td table__td--shrink text-sm">${fbBadge}${igBadge}</td>
        <td class="table__td table__td--shrink table__td--mono">${(p.clicks || 0).toLocaleString()}</td>
        <td class="table__td table__td--shrink">
          <div class="table__actions">
            <button class="btn btn--primary btn--xs" data-action="send" title="Send">✉️</button>
            <button class="btn btn--ghost btn--xs" data-action="edit" title="Edit text">✏️</button>
            ${p.sentAt || p.sent_at ? `<button class="btn btn--ghost btn--xs" data-action="unsend" title="Mark unsent">↩️</button>` : ''}
            <button class="btn btn--ghost btn--xs" data-action="sync" title="Sync from AliExpress">🏪</button>
            <button class="btn btn--ghost btn--xs text-error" data-action="delete" title="Delete">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderCards(products) {
  document.getElementById('products-table-wrap')?.classList.add('hidden');
  const grid = document.getElementById('products-card-grid');
  if (!grid) return;
  grid.classList.remove('hidden');

  grid.innerHTML = products.map(p => `
    <div class="card product-card" data-product-id="${escHtml(p.id)}">
      <div class="product-card__image">
        ${p.image ? `<img src="${escHtml(p.image)}" alt="" loading="lazy">` : '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:40px;">📦</div>'}
        <div class="product-card__badges">
          ${p.sentAt || p.sent_at ? `<span class="badge badge--success">Sent</span>` : `<span class="badge badge--warning">Unsent</span>`}
          ${(p.sendCount || p.send_count) > 1 ? `<span class="badge badge--neutral">×${p.sendCount || p.send_count}</span>` : ''}
        </div>
      </div>
      <div class="product-card__body">
        <div class="product-card__title">${escHtml(p.text || p.title || 'No title')}</div>
        <div class="text-xs text-muted">${(p.clicks || 0)} clicks</div>
        <div class="product-card__actions">
          <button class="btn btn--primary btn--xs" data-action="send">✉️ Send</button>
          <button class="btn btn--ghost btn--xs" data-action="edit">✏️</button>
          <button class="btn btn--ghost btn--xs text-error" data-action="delete">✕</button>
        </div>
      </div>
    </div>
  `).join('');
}

function updateCountBadge() {
  const badge = document.getElementById('products-count-badge');
  if (badge) {
    const sent   = _products.filter(p => p.sentAt || p.sent_at).length;
    const unsent = _products.length - sent;
    badge.textContent = `${sent}/${_products.length}`;
  }

  // Topbar chips
  const total  = document.getElementById('kpi-total');
  const unsentEl = document.getElementById('kpi-unsent');
  const sentEl   = document.getElementById('kpi-sent');
  if (total)   total.textContent   = _products.length;
  if (unsentEl) unsentEl.textContent = _products.filter(p => !p.sentAt && !p.sent_at).length;
  if (sentEl)   sentEl.textContent   = _products.filter(p => p.sentAt || p.sent_at).length;
}

function wireToolbar() {
  // Filter buttons
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _filter = btn.dataset.filter;
      render();
    });
  });

  // Sort buttons
  document.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-sort]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _sort = btn.dataset.sort;
      render();
    });
  });

  // View toggle
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _view = btn.dataset.view;
      render();
    });
  });

  // Bulk actions
  document.getElementById('btn-refresh-products')?.addEventListener('click', load);
  document.getElementById('btn-shuffle')?.addEventListener('click', shuffle);
  document.getElementById('btn-sync-clicks')?.addEventListener('click', syncClicks);
  document.getElementById('btn-shorten-all')?.addEventListener('click', shortenAll);
  document.getElementById('btn-sync-bulk')?.addEventListener('click', syncBulk);
  document.getElementById('btn-clean-404')?.addEventListener('click', clean404);

  // 404 panel actions
  document.getElementById('btn-delete-dead')?.addEventListener('click', deleteDeadLinks);
  document.getElementById('btn-dismiss-dead')?.addEventListener('click', () => {
    document.getElementById('dead-links-panel')?.classList.add('hidden');
  });
}

function wireProductActions() {
  const products = document.getElementById('tab-products');
  if (!products) return;

  products.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    const row    = e.target.closest('[data-product-id]');
    if (!row || !action) return;
    const id = row.dataset.productId;
    const product = _products.find(p => p.id === id);
    if (!product) return;

    switch (action) {
      case 'send':   openSendModal(product); break;
      case 'edit':   openEditModal(product); break;
      case 'unsend': unsend(id); break;
      case 'sync':   syncOne(id); break;
      case 'delete': deleteProduct(id); break;
    }
  });
}

function wireModals() {
  // Send modal confirm
  document.getElementById('send-modal-confirm')?.addEventListener('click', doSend);

  // Edit modal save
  document.getElementById('edit-product-modal-save')?.addEventListener('click', doSaveEdit);
}

// ── Send ────────────────────────────────────────────────────────────────────

function openSendModal(product) {
  _sendId = product.id;

  // Populate WA group checkboxes for this product's niche
  const groups = _state.subjects
    .find(s => s.id === (product.subjectId || product.subject_id))?.whatsappGroups || [];

  const waGroupsEl = document.getElementById('send-wa-groups-list');
  if (waGroupsEl) {
    waGroupsEl.innerHTML = groups.map(g => `
      <label class="checkbox">
        <input type="checkbox" class="wa-group-chk" value="${escHtml(g.waGroup || g.wa_group)}" checked>
        <span class="checkbox__label">${escHtml(g.name)}</span>
      </label>
    `).join('') || '<p class="text-sm text-muted">No groups configured</p>';
  }

  openModal('send-modal-overlay');
}

async function doSend() {
  if (!_sendId) return;
  const platforms = [];
  if (document.getElementById('send-chk-wa')?.checked) platforms.push('whatsapp');
  if (document.getElementById('send-chk-fb')?.checked) platforms.push('facebook');
  if (document.getElementById('send-chk-ig')?.checked) platforms.push('instagram');

  const waGroupIds = [...document.querySelectorAll('.wa-group-chk:checked')].map(c => c.value);

  closeModal('send-modal-overlay');
  try {
    await post(`/api/send/${_sendId}`, { platforms, waGroupIds });
    toast.success('Sent!');
    await load();
  } catch (err) {
    toast.error('Send failed', err.message);
  }
  _sendId = null;
}

// ── Edit ────────────────────────────────────────────────────────────────────

function openEditModal(product) {
  _editId = product.id;
  const textEl   = document.getElementById('edit-product-text');
  const skipEl   = document.getElementById('edit-skip-ai');
  if (textEl) textEl.value = product.text || '';
  if (skipEl) skipEl.checked = product.skipAi || product.skip_ai || false;
  openModal('edit-product-modal-overlay');
}

async function doSaveEdit() {
  if (!_editId) return;
  const text   = document.getElementById('edit-product-text')?.value;
  const skipAi = document.getElementById('edit-skip-ai')?.checked;
  try {
    await put(`/api/products/${_editId}`, { Text: text, skip_ai: skipAi });
    toast.success('Saved');
    closeModal('edit-product-modal-overlay');
    await load();
  } catch (err) {
    toast.error('Save failed', err.message);
  }
  _editId = null;
}

// ── CRUD helpers ─────────────────────────────────────────────────────────────

async function unsend(id) {
  try {
    await post(`/api/products/${id}/unsend`);
    toast.success('Marked unsent');
    await load();
  } catch (err) { toast.error('Failed', err.message); }
}

async function syncOne(id) {
  try {
    await post(`/api/aliexpress/sync/${id}`);
    toast.success('Synced');
    await load();
  } catch (err) { toast.error('Sync failed', err.message); }
}

async function deleteProduct(id) {
  const ok = await confirm('Delete this product?', { okLabel: 'Delete' });
  if (!ok) return;
  try {
    await del(`/api/products/${id}`);
    toast.success('Deleted');
    await load();
  } catch (err) { toast.error('Delete failed', err.message); }
}

async function shuffle() {
  try {
    await post('/api/products/shuffle', { subject: _state.activeSubjectId });
    toast.success('Shuffled');
    await load();
  } catch (err) { toast.error('Failed', err.message); }
}

async function syncClicks() {
  try {
    await post('/api/products/sync-clicks');
    toast.success('Clicks synced');
    await load();
  } catch (err) { toast.error('Failed', err.message); }
}

async function shortenAll() {
  try {
    await post('/api/products/shorten-all');
    toast.success('Links shortened');
    await load();
  } catch (err) { toast.error('Failed', err.message); }
}

async function syncBulk() {
  const panel  = document.getElementById('sync-progress-wrap');
  const bar    = document.getElementById('sync-progress-bar');
  const label  = document.getElementById('sync-progress-label');
  const value  = document.getElementById('sync-progress-value');

  panel?.classList.remove('hidden');
  if (bar)   bar.style.width = '0%';
  if (label) label.textContent = 'Syncing…';

  try {
    const unsent = _products.filter(p => !p.sentAt && !p.sent_at).map(p => p.id);
    const { succeeded, failed } = await post('/api/aliexpress/sync-bulk', { ids: unsent });
    if (bar)   bar.style.width   = '100%';
    if (value) value.textContent = '100%';
    if (label) label.textContent = `Done: ${succeeded} synced, ${failed} failed`;
    await load();
  } catch (err) {
    if (label) label.textContent = `Error: ${err.message}`;
    toast.error('Sync failed', err.message);
  }
}

async function clean404() {
  const panel = document.getElementById('dead-links-panel');
  const list  = document.getElementById('dead-links-list');

  try {
    const ids   = _products.filter(p => !p.sentAt && !p.sent_at).map(p => p.id);
    const dead  = [];

    for (const id of ids) {
      try {
        const { not_found } = await post(`/api/aliexpress/check-url/${id}`);
        if (not_found) dead.push(id);
      } catch {}
    }

    if (!dead.length) { toast.info('No dead links found'); return; }

    list.innerHTML = dead.map(id => {
      const p = _products.find(x => x.id === id);
      return `<div class="text-xs text-muted truncate">${escHtml(trunc(p?.text || id, 60))}</div>`;
    }).join('');

    panel?.classList.remove('hidden');
    panel.dataset.deadIds = JSON.stringify(dead);
  } catch (err) {
    toast.error('Scan failed', err.message);
  }
}

async function deleteDeadLinks() {
  const panel = document.getElementById('dead-links-panel');
  const ids   = JSON.parse(panel?.dataset.deadIds || '[]');
  if (!ids.length) return;

  const ok = await confirm(`Delete ${ids.length} dead-link product(s)?`, { okLabel: 'Delete All' });
  if (!ok) return;

  try {
    await post('/api/products/batch', { ids });
    toast.success(`Deleted ${ids.length} products`);
    panel?.classList.add('hidden');
    await load();
  } catch (err) {
    toast.error('Failed', err.message);
  }
}
