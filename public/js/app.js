/**
 * app.js — Entry point.
 * Handles auth check, navigation routing, global state, and boots all modules.
 */

import { get, post } from './api.js';
import { escHtml, fmtDate, nicheColor } from './utils.js';
import { toast } from './components/toast.js';
import { openModal, closeModal, wireCloseBtn, wireOverlayClose, confirm } from './components/modal.js';

// ── Global state ─────────────────────────────────────────────────────────────
export const state = {
  user:       null,
  subjects:   [],
  activeSubjectId: null,
  products:   [],
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  // Show error in URL params
  const params = new URLSearchParams(location.search);
  const err = params.get('error');
  if (err) {
    const el = document.getElementById('login-error');
    if (el) { el.textContent = err === 'suspended' ? 'Account suspended.' : 'Authentication failed.'; el.classList.remove('hidden'); }
  }

  // Fetch current user
  try {
    const { user } = await get('/api/me');
    state.user = user;
    await onAuthenticated();
  } catch {
    // Not authenticated — show login page (already visible)
  }
}

async function onAuthenticated() {
  // Swap login → app
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // Populate user info in sidebar
  const { id, name, email, photo, role } = state.user;
  document.getElementById('user-name').textContent  = name || email;
  document.getElementById('user-email').textContent = email;
  const avatarEl = document.getElementById('user-avatar');
  if (photo) {
    avatarEl.innerHTML = `<img src="${escHtml(photo)}" alt="${escHtml(name)}" loading="lazy">`;
  } else {
    avatarEl.textContent = (name || email || '?')[0].toUpperCase();
  }

  // Show admin-only nav items
  if (role === 'admin') {
    document.getElementById('nav-users')?.classList.remove('hidden');
    document.getElementById('nav-pending')?.classList.remove('hidden');
  }
  if (role === 'admin' || role === 'group_admin') {
    document.getElementById('nav-team')?.classList.remove('hidden');
  }

  // Wire global UI
  wireNav();
  wireLogout();
  wireMobileMenu();
  wireModalCloses();
  startServerClock();

  // Load subjects then boot active tab
  await loadSubjects();
  bootCurrentTab();

  // Lazy-import modules
  const { initLogs } = await import('./modules/logs.js');
  initLogs(state);
}

// ── Navigation ────────────────────────────────────────────────────────────────
const TAB_TITLES = {
  dashboard:       'navDashboard',
  products:        'navProducts',
  schedules:       'navSchedules',
  scraper:         'navScraper',
  'add-product':   'navAddProduct',
  'aliexpress-search': 'navAliSearch',
  discover:        'navDiscover',
  analytics:       'navAnalytics',
  logs:            'navLogs',
  settings:        'navSettings',
  users:           'navUsers',
  pending:         'navPending',
  team:            'navTeam',
};

let currentTab = 'dashboard';

function wireNav() {
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

async function switchTab(tab) {
  if (tab === currentTab) return;
  currentTab = tab;

  // Update nav active state
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));

  // Update page title
  const titleKey = TAB_TITLES[tab] || tab;
  document.getElementById('page-title').textContent = t(titleKey) || tab;

  // Show correct panel
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('is-active'));
  const panel = document.getElementById(`tab-${tab}`);
  if (panel) { panel.classList.add('is-active'); panel.classList.remove('hidden'); }

  // Close mobile sidebar
  closeMobileSidebar();

  // Boot tab module on first visit
  await bootTab(tab);
}

const _bootedTabs = new Set();

function bootCurrentTab() { bootTab(currentTab); }

async function bootTab(tab) {
  if (_bootedTabs.has(tab)) return;
  _bootedTabs.add(tab);

  switch (tab) {
    case 'dashboard':       { const m = await import('./modules/dashboard.js');        m.init(state); break; }
    case 'products':        { const m = await import('./modules/products.js');         m.init(state); break; }
    case 'schedules':       { const m = await import('./modules/schedules.js');        m.init(state); break; }
    case 'scraper':         { const m = await import('./modules/scraper.js');          m.init(state); break; }
    case 'add-product':     { const m = await import('./modules/add-product.js');      m.init(state); break; }
    case 'aliexpress-search':{ const m = await import('./modules/aliexpress-search.js'); m.init(state); break; }
    case 'discover':        { const m = await import('./modules/discover.js');         m.init(state); break; }
    case 'analytics':       { const m = await import('./modules/analytics.js');        m.init(state); break; }
    case 'settings':        { const m = await import('./modules/settings/index.js');   m.init(state); break; }
    case 'users':           { const m = await import('./modules/users.js');            m.init(state); break; }
    case 'pending':         { const m = await import('./modules/pending.js');          m.init(state); break; }
    case 'team':            { const m = await import('./modules/team.js');             m.init(state); break; }
  }
}

// ── Subjects / niche bar ──────────────────────────────────────────────────────
async function loadSubjects() {
  try {
    const { subjects } = await get('/api/subjects');
    state.subjects = subjects || [];
    renderSubjectBar();
  } catch {}
}

function renderSubjectBar() {
  const bar = document.getElementById('subject-bar');
  if (!bar) return;

  const subjects = state.subjects;
  bar.innerHTML = '';

  const allBtn = el('button', 'chip' + (state.activeSubjectId == null ? ' is-active' : ''));
  allBtn.dataset.subjectId = '';
  allBtn.innerHTML = `<span class="chip__label">${t('all') || 'All'}</span>`;
  allBtn.addEventListener('click', () => setActiveSubject(null));
  bar.appendChild(allBtn);

  subjects.forEach((s, i) => {
    const btn = el('button', 'chip' + (state.activeSubjectId === s.id ? ' is-active' : ''));
    btn.dataset.subjectId = s.id;
    btn.style.setProperty('--chip-color', nicheColor(i));
    btn.innerHTML = `
      ${s.icon ? `<span class="chip__icon">${escHtml(s.icon)}</span>` : ''}
      <span class="chip__label">${escHtml(s.name)}</span>
    `;
    btn.addEventListener('click', () => setActiveSubject(s.id));
    bar.appendChild(btn);
  });
}

export function setActiveSubject(id) {
  state.activeSubjectId = id || null;
  document.querySelectorAll('.chip[data-subject-id]').forEach(b => {
    b.classList.toggle('is-active', b.dataset.subjectId === (id || ''));
  });
  document.dispatchEvent(new CustomEvent('subjectChanged', { detail: { subjectId: id } }));
}

// ── Logout ────────────────────────────────────────────────────────────────────
function wireLogout() {
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await post('/auth/logout');
    location.href = '/';
  });
}

// ── Mobile sidebar ────────────────────────────────────────────────────────────
function wireMobileMenu() {
  const btn     = document.getElementById('hamburger-btn');
  const overlay = document.getElementById('sidebar-overlay');
  btn?.addEventListener('click', toggleMobileSidebar);
  overlay?.addEventListener('click', closeMobileSidebar);
}

function toggleMobileSidebar() {
  document.getElementById('sidebar')?.classList.toggle('is-open');
  document.getElementById('sidebar-overlay')?.classList.toggle('is-visible');
}

function closeMobileSidebar() {
  document.getElementById('sidebar')?.classList.remove('is-open');
  document.getElementById('sidebar-overlay')?.classList.remove('is-visible');
}

// ── Modal infrastructure ──────────────────────────────────────────────────────
function wireModalCloses() {
  const modals = [
    ['send-modal-close',         'send-modal-overlay'],
    ['send-modal-cancel',        'send-modal-overlay'],
    ['edit-product-modal-close', 'edit-product-modal-overlay'],
    ['edit-product-modal-cancel','edit-product-modal-overlay'],
    ['gen-token-modal-close',    'gen-token-modal-overlay'],
    ['gen-token-cancel',         'gen-token-modal-overlay'],
    ['qr-modal-close',           'qr-modal-overlay'],
    ['confirm-modal-close',      'confirm-modal-overlay'],
    ['schedule-modal-close',     'schedule-modal-overlay'],
    ['schedule-modal-cancel',    'schedule-modal-overlay'],
    ['broadcast-modal-close',    'broadcast-modal-overlay'],
    ['broadcast-modal-cancel',   'broadcast-modal-overlay'],
  ];
  modals.forEach(([btnId, overlayId]) => {
    wireCloseBtn(btnId, overlayId);
    wireOverlayClose(overlayId);
  });
}

// ── Server clock ──────────────────────────────────────────────────────────────
function startServerClock() {
  const el = document.getElementById('server-time');
  if (!el) return;
  function tick() {
    el.textContent = new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour12: false });
  }
  tick();
  setInterval(tick, 1000);
}

// ── DOM helper ────────────────────────────────────────────────────────────────
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// ── i18n stub (filled by i18n/index.js) ──────────────────────────────────────
window.t = window.t || ((k) => k);
function t(k) { return window.t(k); }

// ── Boot ──────────────────────────────────────────────────────────────────────
bootstrap();
