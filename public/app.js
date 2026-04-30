import { api, escHtml, fmtDate }  from './utils.js';
import { init as initScheduleModal, resetCronBuilder } from './schedule-modal.js';
import { initBroadcastModal } from './broadcast-modal.js';

// ── Sidebar mobile toggle ─────────────────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const isOpen = sidebar.classList.toggle('open');
  overlay.classList.toggle('active', isOpen);
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}
// Expose to window — called from static onclick attributes in index.html
window.toggleSidebar = toggleSidebar;
window.closeSidebar  = closeSidebar;

// Close sidebar when a nav item is tapped on mobile
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab-btn, .subject-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeSidebar();
    });
  });
});

// ── Auth ──────────────────────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = '@keyframes fadeOut { to { opacity:0; transform:scale(1.02); } }';
document.head.appendChild(style);

function showLoginPage(errorMsg) {
  const loginPage = document.getElementById('login-page');
  if (loginPage) loginPage.style.display = 'flex';
  if (errorMsg) {
    const el = document.getElementById('login-error');
    if (el) el.textContent = errorMsg;
  }
}

function hideLoginPage() {
  const loginPage = document.getElementById('login-page');
  if (!loginPage) return;
  loginPage.style.animation = 'fadeOut 0.4s ease forwards';
  setTimeout(() => { loginPage.style.display = 'none'; }, 400);
}

function updateSidebarUser(user) {
  const el = document.getElementById('sidebar-user');
  if (!el) return;
  el.style.display = 'flex';
  const photo = document.getElementById('sidebar-user-photo');
  if (photo && user.photo) { photo.src = user.photo; photo.style.display = ''; }
  else if (photo) photo.style.display = 'none';
  const name = document.getElementById('sidebar-user-name');
  if (name) name.textContent = user.name || '';
  const email = document.getElementById('sidebar-user-email');
  if (email) email.textContent = user.email || '';
}

window.doLogout = async () => {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.reload();
};

(async function initAuth() {
  const params = new URLSearchParams(window.location.search);
  const errorMap = {
    unauthorized:   'החשבון לא מורשה לגשת למערכת',
    suspended:      'החשבון הושעה. פנה למנהל המערכת.',
    no_invite:      'נדרשת הזמנה כדי להירשם למערכת.',
    invalid_invite: 'קישור ההזמנה אינו תקין או שפג תוקפו.',
  };
  const errMsg = errorMap[params.get('error')];
  if (errMsg) { showLoginPage(errMsg); return; }

  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      const data = await res.json();
      updateSidebarUser(data.user);
      if (data.user.role === 'admin') {
        const navUsers = document.getElementById('nav-users');
        if (navUsers) navUsers.style.display = '';
      }
      hideLoginPage();
    } else {
      showLoginPage();
    }
  } catch {
    showLoginPage();
  }
})();

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    // Update topbar section name
    const el = document.getElementById('topbar-section');
    if (el && typeof tabNames !== 'undefined') el.textContent = tabNames[btn.dataset.tab] || '';
    // Load dashboard when switching to it
    if (btn.dataset.tab === 'dashboard') renderDashboard();
    if (btn.dataset.tab === 'analytics') renderAnalyticsSummary();
  });
});

// ── Server time ───────────────────────────────────────────────────────────────
function updateTime() {
  document.getElementById('server-time').textContent = new Date().toLocaleTimeString('he-IL');
}
setInterval(updateTime, 1000);
updateTime();

// ── SSE Logs ──────────────────────────────────────────────────────────────────
const logPanel = document.getElementById('log-panel');
const logDot = document.getElementById('log-dot');

const es = new EventSource('/api/logs');
es.onopen = () => { logDot.classList.remove('idle'); };
es.onerror = () => { logDot.classList.add('idle'); };
es.onmessage = (e) => {
  const entry = JSON.parse(e.data);
  appendLog(entry);
};

function appendLog({ ts, level, msg }) {
  const el = document.createElement('div');
  el.className = 'log-entry';
  el.innerHTML = `<span class="log-ts">${ts.split('T')[1].slice(0,8)}</span><span class="log-${level}">${escHtml(msg)}</span>`;
  logPanel.appendChild(el);
  logPanel.scrollTop = logPanel.scrollHeight;
}

document.getElementById('btn-clear-log').addEventListener('click', () => {
  logPanel.innerHTML = '';
});

document.getElementById('btn-log-history').addEventListener('click', async () => {
  const btn = document.getElementById('btn-log-history');
  btn.disabled = true;
  try {
    const data = await api('/api/logs/history?limit=500');
    logPanel.innerHTML = '';
    if (!data.logs || data.logs.length === 0) {
      logPanel.innerHTML = '<div style="color:var(--on-surface-var);font-size:13px;padding:8px;">אין לוגים שמורים עדיין</div>';
      return;
    }
    data.logs.forEach(entry => appendLog(entry));
    logPanel.scrollTop = logPanel.scrollHeight;
  } catch (err) {
    alert('שגיאה בטעינת ההיסטוריה: ' + err.message);
  } finally {
    btn.disabled = false;
  }
});

// ── Subjects ──────────────────────────────────────────────────────────────────
let _subjects = [];
let _currentSubject = ''; // empty = all subjects

async function loadSubjects() {
  try {
    const { subjects } = await api('/api/subjects');
    _subjects = subjects || [];
    window._subjects = _subjects;
    populateSubjectSelects();
    renderSettingsPage();
  } catch (err) {
    console.error('Failed to load subjects:', err);
  }
}

const SUBJECT_COLORS = [
  '#34C759', // green  (index 0 — first real subject)
  '#FF9500', // orange
  '#AF52DE', // purple
  '#FF2D55', // pink
  '#5AC8FA', // teal
  '#FF6B6B', // coral
  '#64D2FF', // sky
  '#30D158', // mint
];

function getSubjectColor(idx) {
  return SUBJECT_COLORS[idx % SUBJECT_COLORS.length];
}

function setAccentColor(hexColor) {
  const root = document.documentElement;
  if (!hexColor) {
    root.style.setProperty('--accent', '#007AFF');
    root.style.setProperty('--accent-light', 'rgba(0,122,255,0.12)');
    root.style.setProperty('--accent-mid',   'rgba(0,122,255,0.22)');
    return;
  }
  const r = parseInt(hexColor.slice(1,3), 16);
  const g = parseInt(hexColor.slice(3,5), 16);
  const b = parseInt(hexColor.slice(5,7), 16);
  root.style.setProperty('--accent', hexColor);
  root.style.setProperty('--accent-light', `rgba(${r},${g},${b},0.12)`);
  root.style.setProperty('--accent-mid',   `rgba(${r},${g},${b},0.22)`);
}

function renderSubjectBar() {
  const container = document.getElementById('sidebar-subjects');
  if (!container) return;

  const items = [
    `<button class="subject-item ${_currentSubject === '' ? 'active' : ''}" data-subject="" data-color="#007AFF" style="--item-color:#007AFF">
      <span class="subject-dot" style="background:#007AFF;"></span>
      <span class="subject-item-name">הכל</span>
    </button>`
  ];

  _subjects.forEach((s, i) => {
    const color = getSubjectColor(i);
    const isActive = _currentSubject === s.id;
    items.push(`
      <button class="subject-item ${isActive ? 'active' : ''}"
              data-subject="${escHtml(s.id)}"
              data-color="${color}"
              style="--item-color:${color}">
        <span class="subject-dot" style="background:${color};"></span>
        <span class="subject-item-name">${escHtml(s.name)}</span>
      </button>
    `);
  });

  container.innerHTML = items.join('');

  container.querySelectorAll('.subject-item').forEach(item => {
    item.addEventListener('click', () => {
      const id    = item.dataset.subject;
      const color = item.dataset.color;
      _currentSubject = id;

      container.querySelectorAll('.subject-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      setAccentColor(id === '' ? null : color);

      const sel = document.getElementById('subject-select');
      if (sel) sel.value = id;

      // Navigate to products tab when a subject is selected
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelector('[data-tab="products"]').classList.add('active');
      document.getElementById('tab-products').classList.add('active');
      const topbarEl = document.getElementById('topbar-section');
      if (topbarEl) topbarEl.textContent = tabNames['products'] || 'מוצרים';

      loadProducts();
    });
  });

  // Apply current accent
  const active = container.querySelector('.subject-item.active');
  if (active) setAccentColor(_currentSubject === '' ? null : active.dataset.color);
}

function populateSubjectSelects() {
  refreshAliSubjectSelect();
  const options = _subjects.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`).join('');

  // Render the visual pill bar
  renderSubjectBar();

  // Schedules form
  const schedSel = document.getElementById('sched-subject');
  if (schedSel) schedSel.innerHTML = '<option value="">כל הנישות</option>' + options;

  // Add-product form
  const newSubj = document.getElementById('new-subject');
  if (newSubj) {
    newSubj.innerHTML = '<option value="">ללא נישה</option>' + options;
    newSubj.addEventListener('change', () => loadWaGroupsForSelect('new-wa-group-select', newSubj.value));
  }

  // Fishing auto-search form
  const fishingSubj = document.getElementById('fishing-subject-select');
  if (fishingSubj) {
    fishingSubj.innerHTML = '<option value="">ללא נישה</option>' + options;
    fishingSubj.addEventListener('change', () => loadWaGroupsForSelect('fishing-wa-group-select', fishingSubj.value));
  }

  // URL scraper form
  const scrapeSubj = document.getElementById('scrape-subject-select');
  if (scrapeSubj) {
    scrapeSubj.innerHTML = '<option value="">ללא נישה</option>' + options;
    scrapeSubj.addEventListener('change', () => loadWaGroupsForSelect('scrape-wa-group-select', scrapeSubj.value));
  }
}

// ── WhatsApp Groups helpers ───────────────────────────────────────────────────
let _waGroupsCache = {}; // subjectId → groups[]

async function loadWaGroupsForSubject(subjectId) {
  if (!subjectId) return [];
  if (_waGroupsCache[subjectId]) return _waGroupsCache[subjectId];
  try {
    const data = await api(`/api/subjects/${subjectId}/whatsapp-groups`);
    _waGroupsCache[subjectId] = data.groups || [];
  } catch {
    _waGroupsCache[subjectId] = [];
  }
  return _waGroupsCache[subjectId];
}

function invalidateWaCache(subjectId) {
  delete _waGroupsCache[subjectId];
}

async function loadWaGroupsForSelect(selectId, subjectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  if (!subjectId) {
    sel.innerHTML = '<option value="">בחר נישה קודם...</option>';
    return;
  }
  const groups = await loadWaGroupsForSubject(subjectId);
  if (!groups.length) {
    sel.innerHTML = '<option value="">אין קבוצות לנישה זו</option>';
  } else {
    sel.innerHTML = '<option value="">בחר קבוצה...</option>' +
      groups.map(g => `<option value="${escHtml(g.id)}">${escHtml(g.name)}</option>`).join('');
  }
}

async function populateSendModalWaGroups(subjectId) {
  const section  = document.getElementById('modal-wa-groups-section');
  const list     = document.getElementById('modal-wa-groups-list');
  const empty    = document.getElementById('modal-wa-groups-empty');
  const waChk    = document.getElementById('modal-chk-wa');
  if (!section || !list || !empty) return;

  if (!waChk.checked || !subjectId) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  const groups = await loadWaGroupsForSubject(subjectId);
  if (!groups.length) {
    list.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = groups.map(g => `
    <label class="modal-option" style="padding:6px 8px;">
      <input type="checkbox" class="modal-wa-group-chk" data-id="${escHtml(g.id)}" checked />
      <span style="font-size:13px;">${escHtml(g.name)}</span>
    </label>`).join('');
}

document.getElementById('modal-chk-wa')?.addEventListener('change', () => {
  const subjectId = _currentSubject;
  populateSendModalWaGroups(subjectId);
});

// ── Settings page (Stitch design) ─────────────────────────────────────────────
let _settingsActiveId = null;

function getSubjectIcon(idx) {
  const ICONS = ['🐠','🎣','🌿','🐾','🏋️','🍳','📱','🎮','👗','🏕️','🌸','⚽'];
  return ICONS[idx % ICONS.length];
}

function hexToRgba(hex, a) {
  const h = hex.replace('#','');
  const r = parseInt(h.slice(0,2),16);
  const g = parseInt(h.slice(2,4),16);
  const b = parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

function passField(id, isSet, placeholder) {
  const ph = isSet ? 'השאר ריק לשמור ערך קיים' : placeholder;
  return `<div class="pass-wrap">
    <input class="form-input" type="password" id="${id}" value="" placeholder="${ph}" dir="ltr" style="font-size:13px;" />
    <button type="button" class="pass-eye" onclick="togglePassEye(this)" aria-label="הצג/הסתר">
      <span class="material-symbols-outlined">visibility</span>
    </button>
  </div>`;
}

function credBadge(isSet) {
  return isSet
    ? '<span class="cred-badge cred-set">✓ מוגדר</span>'
    : '<span class="cred-badge cred-unset">לא מוגדר</span>';
}

window.togglePassEye = (btn) => {
  const inp = btn.closest('.pass-wrap').querySelector('input');
  const icon = btn.querySelector('.material-symbols-outlined');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  icon.textContent = inp.type === 'password' ? 'visibility' : 'visibility_off';
};

function renderSettingsPage() {
  renderActiveNicheCard();
  renderNicheGrid();
}

function renderActiveNicheCard() {
  const container = document.getElementById('active-niche-container');
  if (!container) return;

  // Auto-select first subject if none selected
  if (!_settingsActiveId && _subjects.length > 0) {
    _settingsActiveId = _subjects[0].id;
  }

  if (!_settingsActiveId || !_subjects.length) {
    container.innerHTML = `
      <div class="niche-select-placeholder">
        <span class="material-symbols-outlined" style="font-size:48px;opacity:0.3;display:block;margin-bottom:12px;">category</span>
        <div style="font-size:14px;">הוסף נישה חדשה כדי להתחיל</div>
      </div>`;
    return;
  }

  const idx = _subjects.findIndex(s => s.id === _settingsActiveId);
  if (idx === -1) { container.innerHTML = ''; return; }
  const s = _subjects[idx];
  const color = getSubjectColor(idx);
  const icon = getSubjectIcon(idx);
  const bg = hexToRgba(color, 0.1);
  const waEnabled = s.waEnabled !== false;
  const fbEnabled = s.fbEnabled !== false;
  const igEnabled = s.instagramEnabled !== false;
  const waProvider = s.waProvider || 'macrodroid';

  container.innerHTML = `
    <section style="margin-bottom:48px;">
      <div class="niche-config-panel">
        <div class="niche-config-inner">
          <div class="niche-config-header">
            <div class="niche-config-header-left">
              <div class="niche-icon-box" style="background:${bg};">${icon}</div>
              <div>
                <h2 class="niche-name-h2">${escHtml(s.name)}</h2>
                <div class="niche-status-row">
                  <span class="niche-pulse"></span>
                  <span class="niche-status-label" id="niche-status-label-${s.id}">הגדרות נישה פעילה</span>
                </div>
              </div>
            </div>
            <div class="niche-header-actions">
              <button class="niche-action-btn danger" onclick="deleteSubject('${s.id}')" title="מחק נישה">
                <span class="material-symbols-outlined">delete</span>
              </button>
            </div>
          </div>

          <div class="niche-settings-grid">
            <!-- Right col: AI Prompt -->
            <div style="order:2;">
              <div class="niche-field-label">
                <span class="material-symbols-outlined">psychology</span>
                הנחיית (Prompt) AI
              </div>
              <textarea class="niche-prompt-textarea" id="niche-prompt-${s.id}" placeholder="הגדר כיצד ה-AI יכתוב את הפוסט..." dir="rtl">${escHtml(s.prompt || '')}</textarea>
              <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
                <code class="code-tag">{{Text}}</code>
                <code class="code-tag">{{Link}}</code>
                <code class="code-tag">{{join_link}}</code>
              </div>
            </div>

            <!-- Left col: Channels + Credentials -->
            <div style="order:1;">
              <div class="niche-field-label" style="margin-bottom:10px;">
                <span class="material-symbols-outlined">hub</span>
                ערוצי יעד
              </div>
              <div class="channel-toggles-grid" style="margin-bottom:28px;grid-template-columns:1fr 1fr 1fr;">
                <div class="channel-toggle-card">
                  <div class="channel-toggle-info">
                    <div class="channel-icon-box" style="background:rgba(37,211,102,0.12);">
                      <span class="material-symbols-outlined" style="font-size:20px;color:#16a34a;">forum</span>
                    </div>
                    <span style="font-weight:700;font-size:13px;">WhatsApp</span>
                  </div>
                  <div class="ios-toggle ${waEnabled ? 'active' : ''}" id="wa-toggle-${s.id}" onclick="this.classList.toggle('active')" role="switch" aria-checked="${waEnabled}" aria-label="הפעל WhatsApp"></div>
                </div>
                <div class="channel-toggle-card">
                  <div class="channel-toggle-info">
                    <div class="channel-icon-box" style="background:rgba(66,103,178,0.12);">
                      <span class="material-symbols-outlined" style="font-size:20px;color:#4267B2;">thumb_up</span>
                    </div>
                    <span style="font-weight:700;font-size:13px;">Facebook</span>
                  </div>
                  <div class="ios-toggle ${fbEnabled ? 'active' : ''}" id="fb-toggle-${s.id}" onclick="this.classList.toggle('active')" role="switch" aria-checked="${fbEnabled}" aria-label="הפעל Facebook"></div>
                </div>
                <div class="channel-toggle-card">
                  <div class="channel-toggle-info">
                    <div class="channel-icon-box" style="background:rgba(193,53,132,0.12);">
                      <span class="material-symbols-outlined" style="font-size:20px;color:#C13584;">photo_camera</span>
                    </div>
                    <span style="font-weight:700;font-size:13px;">Instagram</span>
                  </div>
                  <div class="ios-toggle ${igEnabled ? 'active' : ''}" id="ig-toggle-${s.id}" onclick="this.classList.toggle('active')" role="switch" aria-checked="${igEnabled}" aria-label="הפעל Instagram"></div>
                </div>
              </div>

              <!-- WhatsApp accordion -->
              <details class="niche-cred-section" ${waEnabled ? 'open' : ''}>
                <summary class="niche-cred-summary">
                  <span class="material-symbols-outlined" style="color:#16a34a;">forum</span>
                  <span>הגדרות WhatsApp</span>
                  ${credBadge(!!s.macrodroidUrl)}
                  <span class="material-symbols-outlined niche-cred-chevron">expand_more</span>
                </summary>
                <div class="niche-cred-body">
                  <div class="form-group" style="margin-bottom:16px;">
                    <label class="form-label" style="margin-bottom:6px;display:block;">ספק שליחה</label>
                    <input type="hidden" id="wa-provider-${s.id}" value="${waProvider}" />
                    <div style="display:flex;gap:0;background:var(--surface-low);border-radius:10px;padding:3px;">
                      <button id="wa-provider-btn-macrodroid-${s.id}" onclick="window.setWaProvider('${s.id}', 'macrodroid')"
                        style="flex:1;padding:7px 10px;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s;
                               background:${waProvider === 'macrodroid' ? 'var(--primary)' : 'transparent'};
                               color:${waProvider === 'macrodroid' ? 'white' : 'var(--on-surface-var)'};">
                        MacroDroid
                      </button>
                      <button id="wa-provider-btn-webjs-${s.id}" onclick="window.setWaProvider('${s.id}', 'webjs')"
                        style="flex:1;padding:7px 10px;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s;
                               background:${waProvider === 'webjs' ? 'var(--primary)' : 'transparent'};
                               color:${waProvider === 'webjs' ? 'white' : 'var(--on-surface-var)'};">
                        WhatsApp Web JS
                      </button>
                    </div>
                  </div>
                  <div class="form-group" style="margin-bottom:16px;">
                    <label class="form-label">Webhook URL (MacroDroid)</label>
                    ${passField(`niche-wa-url-${s.id}`, !!s.macrodroidUrl, 'הזן Webhook URL')}
                  </div>
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                    <label class="form-label" style="margin:0;">קבוצות WhatsApp</label>
                    <button class="btn btn-ghost btn-sm" onclick="showAddWaGroup('${s.id}')" style="font-size:11px;padding:4px 10px;">
                      <span class="material-symbols-outlined" style="font-size:13px;">add</span>הוסף קבוצה
                    </button>
                  </div>
                  <div id="wa-groups-list-${s.id}" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;">
                    <div style="font-size:12px;color:var(--on-surface-var);">טוען קבוצות...</div>
                  </div>
                  <div id="add-wa-group-form-${s.id}" style="display:none;margin-top:12px;padding:14px;background:var(--surface-low);border-radius:1rem;border:1px solid var(--outline-var);">
                    <div class="form-grid">
                      <div class="form-group">
                        <label class="form-label">שם לתצוגה</label>
                        <input class="form-input" id="new-wa-name-${s.id}" placeholder="קבוצת דיג צפון" style="font-size:13px;" />
                      </div>
                      <div class="form-group">
                        <label class="form-label">מזהה קבוצה (MacroDroid)</label>
                        <input class="form-input" id="new-wa-group-id-${s.id}" placeholder="fishing_north" dir="ltr" style="font-size:13px;" />
                      </div>
                      <div class="form-group form-full">
                        <label class="form-label">קישור הצטרפות</label>
                        <input class="form-input" id="new-wa-join-${s.id}" placeholder="https://chat.whatsapp.com/..." dir="ltr" style="font-size:13px;" />
                      </div>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:8px;">
                      <button class="btn btn-ghost btn-sm" onclick="hideAddWaGroup('${s.id}')">ביטול</button>
                      <button class="btn btn-primary btn-sm" onclick="saveNewWaGroup('${s.id}')">
                        <span class="material-symbols-outlined" style="font-size:13px;">save</span>שמור קבוצה
                      </button>
                    </div>
                  </div>
                </div>
              </details>

              <!-- Facebook accordion -->
              <details class="niche-cred-section" ${fbEnabled ? 'open' : ''}>
                <summary class="niche-cred-summary">
                  <span class="material-symbols-outlined" style="color:#4267B2;">thumb_up</span>
                  <span>הגדרות Facebook</span>
                  ${credBadge(!!(s.facebookPageId && s.facebookToken))}
                  <span class="material-symbols-outlined niche-cred-chevron">expand_more</span>
                </summary>
                <div class="niche-cred-body">
                  <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">
                    <button class="btn btn-ghost btn-sm" onclick="checkNicheToken('${s.id}')" style="font-size:11px;padding:4px 12px;border-radius:20px;">
                      <span class="material-symbols-outlined" style="font-size:14px;">manage_search</span>בדוק טוקן
                    </button>
                    <button class="btn btn-ghost btn-sm" onclick="openGenerateTokenModal('${s.id}')" style="font-size:11px;padding:4px 12px;border-radius:20px;background:rgba(112,42,225,0.08);color:#702ae1;">
                      <span class="material-symbols-outlined" style="font-size:14px;">key</span>צור טוקן קבוע
                    </button>
                  </div>
                  <div id="niche-token-info-${s.id}" style="margin-bottom:12px;font-size:12px;color:var(--on-surface-var);min-height:0;"></div>
                  <div class="form-grid">
                    <div class="form-group">
                      <label class="form-label">Page ID</label>
                      <input class="form-input" id="niche-fb-page-${s.id}" value="${escHtml(s.facebookPageId||'')}" dir="ltr" style="font-size:13px;" />
                    </div>
                    <div class="form-group">
                      <label class="form-label">Access Token ${credBadge(!!s.facebookToken)}</label>
                      ${passField(`niche-fb-token-${s.id}`, !!s.facebookToken, 'הזן Access Token')}
                    </div>
                    <div class="form-group">
                      <label class="form-label">App ID ${credBadge(!!s.facebookAppId)}</label>
                      ${passField(`niche-fb-app-id-${s.id}`, !!s.facebookAppId, 'הזן App ID')}
                    </div>
                    <div class="form-group">
                      <label class="form-label">App Secret ${credBadge(!!s.facebookAppSecret)}</label>
                      ${passField(`niche-fb-app-secret-${s.id}`, !!s.facebookAppSecret, 'הזן App Secret')}
                    </div>
                  </div>
                </div>
              </details>

              <!-- Instagram accordion -->
              <details class="niche-cred-section" ${igEnabled ? 'open' : ''}>
                <summary class="niche-cred-summary">
                  <span class="material-symbols-outlined" style="color:#C13584;">photo_camera</span>
                  <span>הגדרות Instagram</span>
                  ${credBadge(!!s.instagramAccountId)}
                  <span class="material-symbols-outlined niche-cred-chevron">expand_more</span>
                </summary>
                <div class="niche-cred-body">
                  <div class="form-group">
                    <label class="form-label">Instagram Business Account ID ${credBadge(!!s.instagramAccountId)}</label>
                    ${passField(`niche-ig-account-${s.id}`, !!s.instagramAccountId, '17841400000000000')}
                    <div class="form-hint">נמצא ב-Meta Graph API Explorer: GET /me/accounts → Instagram Business Account ID. משתמש באותו Access Token של Facebook.</div>
                  </div>
                </div>
              </details>

              <!-- AliExpress accordion -->
              <details class="niche-cred-section">
                <summary class="niche-cred-summary">
                  <span class="material-symbols-outlined" style="color:#e4572e;">shopping_bag</span>
                  <span>הגדרות AliExpress</span>
                  ${s.aliexpressTrackingId
                    ? '<span class="cred-badge cred-set">✓ מוגדר</span>'
                    : '<span class="cred-badge" style="background:var(--surface-container);color:var(--on-surface-var);">ברירת מחדל</span>'}
                  <span class="material-symbols-outlined niche-cred-chevron">expand_more</span>
                </summary>
                <div class="niche-cred-body">
                  <div class="form-group">
                    <label class="form-label">Tracking ID</label>
                    ${passField(`niche-ali-tracking-${s.id}`, !!s.aliexpressTrackingId, 'הזן Tracking ID (ישתמש בברירת מחדל אם ריק)')}
                    <div class="form-hint">ה-Tracking ID ישמש בחיפוש מוצרי AliExpress עבור נישה זו. כל לינק שותפים שייווצר יהיה משויך ל-ID זה.</div>
                  </div>
                </div>
              </details>
            </div>
          </div>

          <div class="niche-config-footer">
            <button class="btn btn-primary" style="padding:14px 40px;font-size:15px;" onclick="saveNiche('${s.id}')">
              שמור הגדרות נישה
            </button>
            <button class="btn btn-ghost" style="padding:14px 28px;font-size:15px;" onclick="renderSettingsPage()">
              ביטול שינויים
            </button>
            <span id="niche-save-result-${s.id}" style="font-size:13px;"></span>
          </div>
        </div>
      </div>
    </section>`;

  // Load WA groups for this niche after rendering
  loadAndRenderWaGroups(s.id);
  attachNicheAutoSave(s.id);
}

function renderNicheGrid() {
  const section = document.getElementById('niche-grid-section');
  if (!section) return;

  const others = _subjects.filter(s => s.id !== _settingsActiveId);
  if (!others.length) { section.innerHTML = ''; return; }

  const cards = others.map(s => {
    const idx = _subjects.findIndex(x => x.id === s.id);
    const color = getSubjectColor(idx);
    const icon = getSubjectIcon(idx);
    const bg = hexToRgba(color, 0.1);
    const isActive = !!(s.macrodroidUrl || s.facebookPageId || s.instagramAccountId);
    const channelCount = [s.waEnabled, s.fbEnabled, s.instagramEnabled].filter(Boolean).length;
    return `
      <div class="niche-mini-card" onclick="selectSettingsSubject('${s.id}')">
        <div class="niche-mini-card-header">
          <div class="niche-mini-icon" style="background:${bg};">${icon}</div>
          <span class="niche-status-chip ${isActive ? 'active' : 'inactive'}">${isActive ? 'פעיל' : 'טרם הוגדר'}</span>
        </div>
        <div class="niche-mini-name">${escHtml(s.name)}</div>
        <div class="niche-mini-stat">${channelCount ? `${channelCount} ערוצים מופעלים` : 'אין ערוצים מופעלים'}</div>
        <button class="niche-mini-edit-btn">ערוך הגדרות</button>
      </div>`;
  }).join('');

  section.innerHTML = `
    <section style="margin-bottom:32px;">
      <div class="niche-section-title">
        <span class="niche-title-bar"></span>
        נישות נוספות בניהול
      </div>
      <div class="niche-mini-grid">${cards}</div>
    </section>`;
}

window.selectSettingsSubject = (id) => {
  _settingsActiveId = id;
  renderSettingsPage();
  const el = document.getElementById('active-niche-container');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.checkNicheToken = async (id) => {
  const el = document.getElementById(`niche-token-info-${id}`);
  if (!el) return;
  el.textContent = 'בודק טוקן...';
  el.style.color = 'var(--on-surface-var)';
  try {
    const d = await api(`/api/facebook/token-info?subjectId=${encodeURIComponent(id)}`);
    const daysLeft = d.days_left;
    const color = daysLeft === null ? '#16a34a' : daysLeft > 14 ? '#16a34a' : daysLeft > 3 ? '#d97706' : '#dc2626';
    const validIcon = d.valid ? '✓' : '✗';
    const expiry = daysLeft === null
      ? '<span style="color:#16a34a">לא פג תוקף (Page Token ✓)</span>'
      : `<span style="color:${color}">${d.expires_at} · ${daysLeft} ימים נותרו</span>`;
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;line-height:1.9;background:rgba(255,255,255,0.7);border-radius:1rem;padding:12px 14px;border:1px solid rgba(112,42,225,0.08);">
        <span style="color:var(--on-surface-var);">תקף:</span>
        <span style="color:${d.valid ? '#16a34a' : '#dc2626'};font-weight:700;">${validIcon} ${d.valid ? 'כן' : 'לא'}</span>
        <span style="color:var(--on-surface-var);">אפליקציה:</span>
        <span>${escHtml(d.app || '—')}</span>
        <span style="color:var(--on-surface-var);">תפוגה:</span>
        ${expiry}
        <span style="color:var(--on-surface-var);">הרשאות:</span>
        <span style="font-size:10px;font-family:var(--font-mono);">${(d.scopes || []).join(', ')}</span>
      </div>`;
  } catch (err) {
    el.style.color = '#dc2626';
    el.textContent = `✗ שגיאה: ${err.message}`;
  }
};

let _genTokenSubjectId = null;

window.openGenerateTokenModal = (id) => {
  _genTokenSubjectId = id;
  document.getElementById('gen-token-input').value = '';
  document.getElementById('gen-token-status').textContent = '';
  document.getElementById('gen-token-confirm').disabled = false;
  const modal = document.getElementById('gen-token-modal');
  modal.style.display = 'flex';
};

window.closeGenerateTokenModal = () => {
  document.getElementById('gen-token-modal').style.display = 'none';
  _genTokenSubjectId = null;
};

window.doGeneratePageToken = async () => {
  const shortToken = document.getElementById('gen-token-input').value.trim();
  const status = document.getElementById('gen-token-status');
  if (!shortToken) { status.style.color = '#dc2626'; status.textContent = 'נא להזין טוקן'; return; }

  const btn = document.getElementById('gen-token-confirm');
  btn.disabled = true;
  status.style.color = 'var(--on-surface-var)';
  status.textContent = 'ממיר טוקן...';

  try {
    const d = await api('/api/facebook/generate-page-token', {
      method: 'POST',
      body: { shortUserToken: shortToken, subjectId: _genTokenSubjectId },
    });
    // Auto-fill the token field in the niche settings card
    const tokenInput = document.getElementById(`niche-fb-token-${_genTokenSubjectId}`);
    if (tokenInput) tokenInput.value = d.pageToken;
    status.style.color = '#16a34a';
    status.innerHTML = `✓ טוקן קבוע נוצר לדף: <strong>${escHtml(d.pageName)}</strong><br><span style="font-size:10px;color:var(--on-surface-var);">הטוקן מולא אוטומטית — לחץ "שמור הגדרות" כדי לשמור</span>`;
    btn.disabled = false;
  } catch (err) {
    status.style.color = '#dc2626';
    status.textContent = `✗ ${err.message}`;
    btn.disabled = false;
  }
};

// Close modal on backdrop click
document.getElementById('gen-token-modal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeGenerateTokenModal();
});

window.setWaProvider = (id, provider) => {
  const hidden = document.getElementById(`wa-provider-${id}`);
  if (hidden) hidden.value = provider;
  ['macrodroid', 'webjs'].forEach(p => {
    const btn = document.getElementById(`wa-provider-btn-${p}-${id}`);
    if (!btn) return;
    btn.style.background = p === provider ? 'var(--primary)' : 'transparent';
    btn.style.color = p === provider ? 'white' : 'var(--on-surface-var)';
  });
  scheduleNicheSave(id);
};

const _nicheDebounceTimers = {};
function scheduleNicheSave(id) {
  clearTimeout(_nicheDebounceTimers[id]);
  _nicheDebounceTimers[id] = setTimeout(() => saveNiche(id), 800);
}

function attachNicheAutoSave(id) {
  const inputIds = [
    `niche-prompt-${id}`,
    `niche-wa-url-${id}`,
    `niche-fb-page-${id}`,
    `niche-fb-token-${id}`,
    `niche-fb-app-id-${id}`,
    `niche-fb-app-secret-${id}`,
    `niche-ig-account-${id}`,
  ];
  inputIds.forEach(fieldId => {
    const el = document.getElementById(fieldId);
    if (el) el.addEventListener('input', () => scheduleNicheSave(id));
  });
  ['wa-toggle', 'fb-toggle', 'ig-toggle'].forEach(prefix => {
    const el = document.getElementById(`${prefix}-${id}`);
    if (el) el.addEventListener('click', () => scheduleNicheSave(id));
  });
}

window.saveNiche = async (id) => {
  const result = document.getElementById(`niche-save-result-${id}`);
  try {
    await api(`/api/subjects/${id}`, {
      method: 'PUT',
      body: {
        prompt:              document.getElementById(`niche-prompt-${id}`)?.value || '',
        waEnabled:           document.getElementById(`wa-toggle-${id}`)?.classList.contains('active') ?? true,
        fbEnabled:           document.getElementById(`fb-toggle-${id}`)?.classList.contains('active') ?? true,
        instagramEnabled:    document.getElementById(`ig-toggle-${id}`)?.classList.contains('active') ?? true,
        waProvider:          document.getElementById(`wa-provider-${id}`)?.value || 'macrodroid',
        macrodroidUrl:       document.getElementById(`niche-wa-url-${id}`)?.value.trim() || '',
        facebookPageId:      document.getElementById(`niche-fb-page-${id}`)?.value.trim() || '',
        facebookToken:       document.getElementById(`niche-fb-token-${id}`)?.value.trim() || '',
        facebookAppId:       document.getElementById(`niche-fb-app-id-${id}`)?.value.trim() || '',
        facebookAppSecret:   document.getElementById(`niche-fb-app-secret-${id}`)?.value.trim() || '',
        instagramAccountId:      document.getElementById(`niche-ig-account-${id}`)?.value.trim() || '',
        aliexpressTrackingId:    document.getElementById(`niche-ali-tracking-${id}`)?.value.trim() || '',
      },
    });
    if (result) { result.style.color = '#16a34a'; result.textContent = '✓ נשמר'; }
    await loadSubjects();
  } catch (err) {
    if (result) { result.style.color = '#dc2626'; result.textContent = '✗ שגיאה: ' + err.message; }
  }
  setTimeout(() => { if (result) result.textContent = ''; }, 3000);
};

window.deleteSubject = async (id) => {
  if (!confirm('למחוק נישה זו? כל הקבוצות והמוצרים המשויכים יינותקו.')) return;
  try {
    await api(`/api/subjects/${id}`, { method: 'DELETE' });
    if (_currentSubject === id) {
      _currentSubject = '';
      const sel = document.getElementById('subject-select');
      if (sel) sel.value = '';
    }
    if (_settingsActiveId === id) _settingsActiveId = null;
    await loadSubjects();
    await loadProducts();
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
};

document.getElementById('btn-new-niche').addEventListener('click', () => {
  const sec = document.getElementById('new-niche-form-section');
  if (sec) { sec.style.display = 'block'; document.getElementById('subj-name').focus(); }
});

document.getElementById('btn-cancel-new-niche').addEventListener('click', () => {
  const sec = document.getElementById('new-niche-form-section');
  if (sec) sec.style.display = 'none';
});

document.getElementById('btn-add-subject').addEventListener('click', async () => {
  const name = document.getElementById('subj-name').value.trim();
  const waGroupName = document.getElementById('subj-wa-group-name').value.trim();
  const joinLink = document.getElementById('subj-join-link').value.trim();
  const whatsappUrl = document.getElementById('subj-wa-url').value.trim();
  const facebookPageId = document.getElementById('subj-fb-page-id').value.trim();
  const facebookToken = document.getElementById('subj-fb-token').value.trim();
  const facebookAppId = document.getElementById('subj-fb-app-id').value.trim();
  const facebookAppSecret = document.getElementById('subj-fb-app-secret').value.trim();
  const prompt = document.getElementById('subj-prompt').value.trim();
  const instagramAccountId = document.getElementById('subj-ig-account').value.trim();
  const result = document.getElementById('subject-form-result');

  if (!name) { result.style.color = '#d97706'; result.textContent = '⚠ שם נושא הוא שדה חובה'; return; }

  try {
    const res = await api('/api/subjects', { method: 'POST', body: { name, waGroupName, joinLink, whatsappUrl, facebookPageId, facebookToken, facebookAppId, facebookAppSecret, prompt, instagramAccountId } });
    result.style.color = '#16a34a';
    result.textContent = '✓ נושא נוסף בהצלחה';
    ['subj-name','subj-wa-group-name','subj-join-link','subj-wa-url','subj-fb-page-id','subj-fb-token','subj-fb-app-id','subj-fb-app-secret','subj-prompt','subj-ig-account'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('new-niche-form-section').style.display = 'none';
    // Auto-select the new niche
    if (res.subject) _settingsActiveId = res.subject.id;
    await loadSubjects();
  } catch (err) {
    result.style.color = '#dc2626';
    result.textContent = '✗ שגיאה: ' + err.message;
  }
  setTimeout(() => { result.textContent = ''; }, 4000);
});

// ── Products ──────────────────────────────────────────────────────────────────
let _currentFilter = 'unsent';
let _currentSort = 'none';
let _currentView = 'table';

window.setView = (v) => {
  _currentView = v;
  ['table','cards'].forEach(id => {
    const btn = document.getElementById('view-' + id);
    if (btn) btn.className = 'view-btn' + (id === v ? ' active' : '');
  });
  document.getElementById('products-table-view').style.display = v === 'table' ? '' : 'none';
  document.getElementById('products-card-view').style.display  = v === 'cards' ? '' : 'none';
  renderProducts(_lastProducts);
};

function updateKPIs(products) {
  const total   = products.length;
  const sent    = products.filter(p => p.sent).length;
  const unsent  = total - sent;
  const clicks  = products.reduce((sum, p) => sum + (p.clicks || 0), 0);
  const kpiTotal  = document.getElementById('kpi-total');
  const kpiUnsent = document.getElementById('kpi-unsent');
  const kpiSent   = document.getElementById('kpi-sent');
  const kpiClicks = document.getElementById('kpi-clicks');
  if (kpiTotal)  kpiTotal.textContent  = total;
  if (kpiUnsent) kpiUnsent.textContent = unsent;
  if (kpiSent)   kpiSent.textContent   = sent;
  if (kpiClicks) kpiClicks.textContent = clicks;
}

window.setSort = (s) => {
  _currentSort = s;
  ['none', 'sent', 'clicks'].forEach(id => {
    const btn = document.getElementById('sort-' + id);
    if (btn) btn.className = 'filter-btn' + (id === s ? ' active' : '');
  });
  renderProducts(_lastProducts);
};

let _lastProducts = [];

window.setFilter = (f) => {
  _currentFilter = f;
  ['unsent','sent','all'].forEach(id => {
    const btn = document.getElementById('filter-' + id);
    if (btn) {
      btn.className = 'filter-btn' + (id === f ? ' active' : '');
    }
  });
  loadProducts();
};

function renderProducts(products) {
  _lastProducts = products;
  updateKPIs(products);
  const tbody = document.getElementById('products-body');
  const sentCount = products.filter(p => p.sent).length;
  document.getElementById('products-summary').textContent = `${sentCount} נשלחו מתוך ${products.length} סה"כ`;

  let filtered;
  if (_currentFilter === 'unsent') filtered = products.filter(p => !p.sent);
  else if (_currentFilter === 'sent') filtered = products.filter(p => p.sent);
  else filtered = [...products];

  // Sort
  if (_currentSort === 'sent') {
    filtered.sort((a, b) => {
      if (!a.sent && !b.sent) return 0;
      if (!a.sent) return 1;
      if (!b.sent) return -1;
      return new Date(b.sent) - new Date(a.sent);
    });
  } else if (_currentSort === 'clicks') {
    filtered.sort((a, b) => (b.clicks ?? -1) - (a.clicks ?? -1));
  }

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">${_currentFilter === 'unsent' ? 'כל המוצרים נשלחו ✓' : 'אין מוצרים'}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    const todayBadge = p.today_clicks != null
      ? `<span style="font-size:10px;color:var(--green);margin-right:3px;" title="קליקים היום">+${p.today_clicks}</span>`
      : '';
    const clicksCell = p.clicks == null
      ? '<span style="color:var(--label-4);font-size:11px;">—</span>'
      : `${todayBadge}<span style="font-weight:600;color:var(--blue);">${p.clicks}</span>`;
    const sendCountBadge = p.send_count > 1
      ? `<span style="font-size:10px;color:var(--on-surface-var);margin-right:4px;" title="נשלח ${p.send_count} פעמים">(×${p.send_count})</span>`
      : '';
    return `
    <tr draggable="true" data-id="${p.id}">
      <td><span class="drag-handle" title="גרור לסידור מחדש">⠿</span></td>
      <td>${p.image ? `<img class="img-thumb" src="${escHtml(p.image)}" onerror="this.style.display='none'" />` : '—'}</td>
      <td style="max-width:200px;word-break:break-word;">${escHtml(p.Text)}</td>
      <td><a href="${escHtml(p.Link)}" target="_blank" style="color:var(--blue);font-size:12px;" dir="ltr">🔗 קישור</a></td>
      <td>${escHtml(p.wa_group)}</td>
      <td>${sendCountBadge}${p.sent ? `<span class="badge badge-sent">${fmtDate(p.sent)}</span>` : '<span class="badge badge-unsent">טרם נשלח</span>'}</td>
      <td>${p.facebook ? `<span class="badge badge-fb">${fmtDate(p.facebook)}</span>` : '—'}</td>
      <td>${clicksCell}</td>
      <td style="white-space:nowrap;display:flex;gap:4px;align-items:center;">
        <button class="btn btn-sm ${p.sent ? 'btn-ghost' : 'btn-primary'}" onclick="sendProduct('${p.id}', this)" title="${p.sent ? 'שלח שוב' : 'שלח'}">▶ שלח</button>
        <button class="btn btn-sm btn-ghost" onclick="editProduct('${p.id}')" title="ערוך טקסט">✏</button>
        ${p.sent ? `<button class="btn btn-sm btn-ghost" onclick="unsendProduct('${p.id}', this)" title="החזר למוצרים שלא נשלחו" style="font-size:11px;">↩</button>` : ''}
        <button class="btn btn-sm btn-ghost" onclick="deleteProduct('${p.id}', this)" title="מחק מוצר" style="color:#f87171;">✕</button>
      </td>
    </tr>`;
  }).join('');

  initDragAndDrop(tbody);

  // Render card view
  const grid = document.getElementById('products-grid');
  if (grid) {
    if (!filtered.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">${_currentFilter === 'unsent' ? 'כל המוצרים נשלחו ✓' : 'אין מוצרים'}</div>`;
    } else {
      grid.innerHTML = filtered.map(p => {
        const todayClicksHtml = p.today_clicks != null
          ? `<span style="font-size:10px;color:var(--green);margin-right:4px;" title="קליקים היום">+${p.today_clicks} היום</span>`
          : '';
        const clicksHtml = p.clicks != null
          ? `<span class="product-card-clicks">${todayClicksHtml}👁 ${p.clicks} קליקים</span>`
          : '';
        const sentBadge = p.sent
          ? `<span class="badge badge-sent">${fmtDate(p.sent)}</span>`
          : `<span class="badge badge-unsent">ממתין</span>`;
        const sendCountBadge = p.send_count > 1
          ? `<span style="font-size:10px;color:var(--on-surface-var);" title="נשלח ${p.send_count} פעמים">×${p.send_count}</span>`
          : '';
        return `
        <div class="product-card">
          ${p.image
            ? `<img class="product-card-img" src="${escHtml(p.image)}" onerror="this.style.display='none'" loading="lazy" />`
            : `<div class="product-card-img-placeholder">📦</div>`}
          <div class="product-card-body">
            <div class="product-card-title">${escHtml(p.Text)}</div>
            <div class="product-card-meta">
              ${sentBadge}
              ${sendCountBadge}
              ${clicksHtml}
            </div>
          </div>
          <div class="product-card-footer">
            <a href="${escHtml(p.Link)}" target="_blank" style="color:var(--accent);font-size:12px;" dir="ltr">🔗 קישור</a>
            <div style="display:flex;gap:4px;">
              <button class="btn btn-sm ${p.sent ? 'btn-ghost' : 'btn-primary'}" onclick="sendProduct('${p.id}', this)">▶ שלח</button>
              <button class="btn btn-sm btn-ghost" onclick="editProduct('${p.id}')" title="ערוך טקסט">✏</button>
              ${p.sent ? `<button class="btn btn-sm btn-ghost" onclick="unsendProduct('${p.id}', this)" title="החזר למוצרים שלא נשלחו" style="font-size:11px;">↩</button>` : ''}
              <button class="btn btn-sm btn-ghost" onclick="deleteProduct('${p.id}', this)" title="מחק מוצר" style="color:#f87171;">✕</button>
            </div>
          </div>
        </div>`;
      }).join('');
    }
  }
}

function initDragAndDrop(tbody) {
  let dragSrc = null;

  tbody.querySelectorAll('tr[draggable]').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragSrc = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
    });

    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
      if (row !== dragSrc) row.classList.add('drag-over');
    });

    row.addEventListener('drop', async e => {
      e.preventDefault();
      if (!dragSrc || dragSrc === row) return;

      const fromId = dragSrc.dataset.id;
      const toId   = row.dataset.id;

      // Optimistic UI: move the row visually
      const allRows = [...tbody.querySelectorAll('tr')];
      const fromIdx = allRows.indexOf(dragSrc);
      const toIdx   = allRows.indexOf(row);
      if (fromIdx < toIdx) tbody.insertBefore(dragSrc, row.nextSibling);
      else                  tbody.insertBefore(dragSrc, row);

      try {
        await api('/api/products/reorder', { method: 'POST', body: { fromId, toId } });
      } catch (err) {
        alert('שגיאה בסידור מחדש: ' + err.message);
        loadProducts(); // revert on failure
      }
    });
  });
}

async function loadProducts() {
  const tbody = document.getElementById('products-body');
  tbody.innerHTML = '<tr><td colspan="9" class="empty-state">טוען...</td></tr>';

  try {
    const url = _currentSubject ? `/api/products?subject=${encodeURIComponent(_currentSubject)}` : '/api/products';
    const { products } = await api(url);
    if (!products.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">אין מוצרים בגיליון</td></tr>';
      return;
    }
    renderProducts(products);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state" style="color:#f87171;">${escHtml(err.message)}</td></tr>`;
  }
}

window.deleteProduct = async (id, btn) => {
  if (!confirm('למחוק את המוצר לצמיתות?')) return;
  btn.disabled = true;
  try {
    await api(`/api/products/${id}`, { method: 'DELETE' });
    await loadProducts();
  } catch (err) {
    alert('שגיאה במחיקה: ' + err.message);
    btn.disabled = false;
  }
};

window.unsendProduct = async (id, btn) => {
  if (!confirm('להחזיר את המוצר לרשימת המוצרים שטרם נשלחו?')) return;
  btn.disabled = true;
  try {
    await api(`/api/products/${id}/unsend`, { method: 'POST' });
    await loadProducts();
  } catch (err) {
    alert('שגיאה: ' + err.message);
    btn.disabled = false;
  }
};

window.editProduct = (id) => {
  const product = _lastProducts.find(p => p.id === id);
  if (!product) return;

  const modal   = document.getElementById('edit-product-modal');
  const textarea = document.getElementById('edit-product-text');
  const skipAi  = document.getElementById('edit-product-skip-ai');
  const result  = document.getElementById('edit-product-result');
  const confirmBtn = document.getElementById('edit-product-confirm');
  const cancelBtn  = document.getElementById('edit-product-cancel');

  textarea.value   = product.Text;
  skipAi.checked   = product.skip_ai || false;
  result.textContent = '';
  modal.style.display = 'flex';

  const cleanup = () => {
    modal.style.display = 'none';
    confirmBtn.removeEventListener('click', onConfirm);
    cancelBtn.removeEventListener('click', onCancel);
  };

  const onCancel = () => cleanup();

  const onConfirm = async () => {
    const newText = textarea.value.trim();
    if (!newText) { result.textContent = 'טקסט לא יכול להיות ריק'; result.style.color = '#f87171'; return; }
    confirmBtn.disabled = true;
    result.textContent = 'שומר...';
    result.style.color = 'var(--on-surface-var)';
    try {
      await api(`/api/products/${id}`, { method: 'PUT', body: { Text: newText, skip_ai: skipAi.checked } });
      result.textContent = '✓ נשמר';
      result.style.color = '#4ade80';
      await loadProducts();
      setTimeout(cleanup, 800);
    } catch (err) {
      result.textContent = '✗ ' + err.message;
      result.style.color = '#f87171';
    } finally {
      confirmBtn.disabled = false;
    }
  };

  confirmBtn.addEventListener('click', onConfirm);
  cancelBtn.addEventListener('click', onCancel);
};

window.sendProduct = async (rowNumber, btn) => {
  const modal = document.getElementById('send-modal');
  modal.style.display = 'flex';

  // Pre-populate WA groups for current niche
  await populateSendModalWaGroups(_currentSubject);

  const onConfirm = async () => {
    cleanup();
    const platforms = [];
    if (document.getElementById('modal-chk-wa').checked) platforms.push('whatsapp');
    if (document.getElementById('modal-chk-fb').checked) platforms.push('facebook');
    if (document.getElementById('modal-chk-ig').checked) platforms.push('instagram');
    if (!platforms.length) { alert('יש לבחור לפחות פלטפורמה אחת'); return; }

    // Collect selected WA group ids
    const waGroupIds = [...document.querySelectorAll('.modal-wa-group-chk:checked')]
      .map(el => el.dataset.id);

    btn.disabled = true;
    btn.textContent = '...';
    showLogTab();
    try {
      const sendBody = { platforms };
      if (_currentSubject) sendBody.subject = _currentSubject;
      if (waGroupIds.length) sendBody.waGroupIds = waGroupIds;
      await api(`/api/send/${rowNumber}`, { method: 'POST', body: sendBody });
      await loadProducts();
    } catch (err) {
      alert('שגיאה: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '▶ שלח';
    }
  };

  const onCancel = () => cleanup();

  function cleanup() {
    modal.style.display = 'none';
    document.getElementById('modal-confirm').removeEventListener('click', onConfirm);
    document.getElementById('modal-cancel').removeEventListener('click', onCancel);
  }

  document.getElementById('modal-confirm').addEventListener('click', onConfirm);
  document.getElementById('modal-cancel').addEventListener('click', onCancel);
};

document.getElementById('btn-refresh-products').addEventListener('click', loadProducts);

document.getElementById('btn-shuffle-products').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.querySelector('span').style.animation = 'spin 0.6s linear infinite';
  try {
    const body = _currentSubject ? { subject: _currentSubject } : {};
    const res = await api('/api/products/shuffle', { method: 'POST', body });
    if (res.success) {
      await loadProducts();
      btn.querySelector('span').textContent = 'check';
      btn.querySelector('span').style.animation = '';
    } else {
      btn.querySelector('span').style.animation = '';
    }
  } catch {
    btn.querySelector('span').style.animation = '';
  }
  setTimeout(() => {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'shuffle';
  }, 1500);
});

document.getElementById('btn-sync-clicks').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined" style="animation:spin 1s linear infinite;font-size:17px;">sync</span>';
  try {
    const res = await api('/api/products/sync-clicks', { method: 'POST' });
    if (res.success) {
      btn.innerHTML = `<span style="font-size:12px;font-weight:700;">✓ ${res.synced}</span>`;
      renderProducts(res.products);
    } else {
      btn.innerHTML = '<span style="font-size:12px;">✗</span>';
    }
  } catch {
    btn.innerHTML = '<span style="font-size:12px;">✗</span>';
  }
  setTimeout(() => { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined">sync</span>'; }, 3000);
});

document.getElementById('btn-shorten-all').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined" style="animation:spin 1s linear infinite;font-size:17px;">sync</span>';
  try {
    const res = await api('/api/products/shorten-all', { method: 'POST' });
    if (res.success) {
      btn.innerHTML = `<span style="font-size:12px;font-weight:700;">✓ ${res.converted}</span>`;
      await loadProducts();
    } else {
      btn.innerHTML = '<span style="font-size:12px;">✗</span>';
      alert(res.error);
    }
  } catch (err) {
    btn.innerHTML = '<span style="font-size:12px;">✗</span>';
  }
  setTimeout(() => { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined">link</span>'; }, 3000);
});

document.getElementById('btn-execute').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = '...מריץ';
  showLogTab();
  try {
    const body = _currentSubject ? { subject: _currentSubject } : {};
    const result = await api('/api/send/execute', { method: 'POST', body });
    if (!result.success && result.reason === 'no_unsent_products') {
      alert('אין מוצרים שלא נשלחו');
    } else {
      await loadProducts();
    }
  } catch (err) {
    alert('שגיאה: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ הרץ עכשיו';
  }
});

// ── Schedules ─────────────────────────────────────────────────────────────────
async function loadSchedules() {
  const container = document.getElementById('schedules-list');
  try {
    const { schedules } = await api('/api/schedules');
    if (!schedules.length) {
      container.innerHTML = '<div class="empty-state">אין לוחות זמנים</div>';
      return;
    }
    const subjectOptions = _subjects.map(s =>
      `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`
    ).join('');

    container.innerHTML = schedules.map(s => {
      const subj = s.subject ? _subjects.find(x => x.id === s.subject) : null;
      const subjChip = subj
        ? `<span style="font-size:10.5px;background:rgba(2,132,199,0.12);color:#0284c7;padding:2px 8px;border-radius:20px;font-weight:600;">${escHtml(subj.name)}</span>`
        : `<span style="font-size:10.5px;background:rgba(100,116,139,0.1);color:#64748b;padding:2px 8px;border-radius:20px;">כל הנישות</span>`;
      return `
      <div class="schedule-item" id="sched-${s.id}">
        <div style="flex:1;min-width:0;">
          <div class="schedule-label" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">${escHtml(s.label)}${subjChip}</div>
          <div class="schedule-cron" dir="ltr" style="margin-bottom:6px;">${escHtml(s.cron)}</div>
          <div style="display:flex;align-items:center;gap:6px;">
            <select class="form-input" style="font-size:11px;padding:3px 6px;height:28px;width:auto;max-width:160px;"
              onchange="assignScheduleSubject('${s.id}', this.value)">
              <option value="">כל הנישות</option>
              ${subjectOptions}
            </select>
            <span id="sched-assign-ok-${s.id}" style="font-size:11px;color:#16a34a;min-width:40px;"></span>
          </div>
        </div>
        <div class="schedule-actions">
          <button class="btn btn-sm" style="background:rgba(22,163,74,0.12);color:#16a34a;border:1px solid rgba(22,163,74,0.2);font-size:13px;padding:4px 10px;" onclick="fireScheduleNow('${s.id}')" title="הרץ עכשיו">▶</button>
          <button class="btn btn-sm" style="background:rgba(112,42,225,0.08);color:var(--primary);border:1px solid rgba(112,42,225,0.2);padding:4px 8px;" onclick="openEditSchedule('${s.id}', ${JSON.stringify(s.label)}, ${JSON.stringify(s.cron)})" title="ערוך">
            <span class="material-symbols-outlined" style="font-size:15px;line-height:1;">edit</span>
          </button>
          <label class="toggle" title="${s.enabled ? 'פעיל' : 'לא פעיל'}">
            <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleSchedule('${s.id}', this.checked)" />
            <span class="slider"></span>
          </label>
          <button class="btn btn-danger btn-sm" onclick="deleteSchedule('${s.id}')">🗑</button>
        </div>
      </div>
    `;}).join('');

    // Set current subject value on each select
    schedules.forEach(s => {
      const sel = document.querySelector(`#sched-${s.id} select`);
      if (sel && s.subject) sel.value = s.subject;
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:#f87171;">${escHtml(err.message)}</div>`;
  }
}

window.assignScheduleSubject = async (id, subject) => {
  try {
    await api(`/api/schedules/${id}`, { method: 'PUT', body: { subject } });
    const ok = document.getElementById(`sched-assign-ok-${id}`);
    if (ok) { ok.textContent = '✓ נשמר'; setTimeout(() => { ok.textContent = ''; }, 2000); }
    await loadSchedules();
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
};

window.toggleSchedule = async (id, enabled) => {
  try {
    await api(`/api/schedules/${id}`, { method: 'PUT', body: { enabled } });
  } catch (err) {
    alert('שגיאה: ' + err.message);
    await loadSchedules();
  }
};

window.deleteSchedule = async (id) => {
  if (!confirm('למחוק לוח זמנים זה?')) return;
  try {
    await api(`/api/schedules/${id}`, { method: 'DELETE' });
    await loadSchedules();
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
};

window.fireScheduleNow = async (id) => {
  try {
    await api(`/api/schedules/${id}/fire`, { method: 'POST' });
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
};

// Inject loadSchedules callback into schedule-modal so it can refresh the list after saving
initScheduleModal({ loadSchedules });

document.getElementById('btn-add-schedule').addEventListener('click', async () => {
  const label   = document.getElementById('sched-label').value.trim();
  const cron    = document.getElementById('sched-cron').value.trim();
  const subject = document.getElementById('sched-subject').value;
  if (!label || !cron) return alert('יש למלא שם וביטוי cron');
  try {
    await api('/api/schedules', { method: 'POST', body: { label, cron, subject } });
    document.getElementById('sched-label').value = '';
    document.getElementById('sched-subject').value = '';
    resetCronBuilder();
    await loadSchedules();
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
});

// ── Broadcasts ─────────────────────────────────────────────────────────────────
let _broadcasts = [];

async function loadBroadcasts() {
  const container = document.getElementById('broadcasts-list');
  if (!container) return;
  try {
    const data = await api('/api/broadcasts');
    _broadcasts = data.broadcasts || [];
    window._broadcasts = _broadcasts;
    if (!_broadcasts.length) {
      container.innerHTML = '<div class="empty-state">אין הודעות שידור</div>';
      return;
    }
    const DAYS_HE = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
    function bcastRecurrenceLabel(b) {
      if (b.recurrenceLabel) return b.recurrenceLabel;
      const r = b.recurrence;
      if (!r) return b.cron || '';
      const hh = String(r.hour ?? 0).padStart(2, '0');
      if (r.frequency === 'daily')        return `כל יום ב-${hh}:00`;
      if (r.frequency === 'weekly')       return `כל ${DAYS_HE[r.day ?? 0]} ב-${hh}:00`;
      if (r.frequency === 'every_n_days') return `כל ${r.n ?? 2} ימים ב-${hh}:00`;
      return b.cron || '';
    }
    container.innerHTML = _broadcasts.map(b => {
      const subj = _subjects.find(x => x.id === b.subjectId);
      const subjChip = subj
        ? `<span style="font-size:10.5px;background:rgba(2,132,199,0.12);color:#0284c7;padding:2px 8px;border-radius:20px;font-weight:600;">${escHtml(subj.name)}</span>`
        : '';
      const platformChips = [
        `<span style="font-size:10.5px;background:rgba(29,161,242,0.1);color:#1d9bf0;padding:2px 8px;border-radius:20px;">WhatsApp</span>`,
        `<span style="font-size:10.5px;background:rgba(24,119,242,0.1);color:#1877f2;padding:2px 8px;border-radius:20px;">Facebook</span>`,
      ].join(' ');
      const preview = escHtml((b.text || '').slice(0, 80)) + ((b.text || '').length > 80 ? '…' : '');
      const schedLabel = bcastRecurrenceLabel(b);
      const imgIcon = b.imageUrl
        ? `<span class="material-symbols-outlined" title="יש תמונה" style="font-size:14px;color:var(--on-surface-var);vertical-align:middle;">image</span>`
        : '';
      return `
      <div class="schedule-item" id="bcast-${escHtml(String(b.id))}">
        <div style="flex:1;min-width:0;">
          <div class="schedule-label" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
            ${escHtml(b.label)}${imgIcon}${subjChip}${platformChips}
          </div>
          <div class="bcast-msg-preview">${preview}</div>
          <div class="schedule-cron">${escHtml(schedLabel)}</div>
          ${b.nextRunAt ? `<div style="font-size:11px;color:var(--on-surface-var);">הבא: ${fmtDate(b.nextRunAt)}</div>` : ''}
        </div>
        <div class="schedule-actions">
          <button class="btn btn-sm" style="background:rgba(22,163,74,0.12);color:#16a34a;border:1px solid rgba(22,163,74,0.2);font-size:13px;padding:4px 10px;" onclick="fireBroadcastNow('${escHtml(String(b.id))}')" title="שלח עכשיו">▶</button>
          <button class="btn btn-sm" style="background:rgba(112,42,225,0.08);color:var(--primary);border:1px solid rgba(112,42,225,0.2);padding:4px 8px;" onclick="openEditBroadcast('${escHtml(String(b.id))}')" title="ערוך">
            <span class="material-symbols-outlined" style="font-size:15px;line-height:1;">edit</span>
          </button>
          <label class="toggle" title="${b.enabled ? 'פעיל' : 'לא פעיל'}">
            <input type="checkbox" ${b.enabled ? 'checked' : ''} onchange="toggleBroadcast('${escHtml(String(b.id))}', this.checked)" />
            <span class="slider"></span>
          </label>
          <button class="btn btn-danger btn-sm" onclick="deleteBroadcast('${escHtml(String(b.id))}')">🗑</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:#f87171;">${escHtml(err.message)}</div>`;
  }
}

window.fireBroadcastNow = async (id) => {
  try {
    await api(`/api/broadcasts/${id}/fire-now`, { method: 'POST' });
    alert('ההודעה נשלחת!');
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
};

window.toggleBroadcast = async (id, enabled) => {
  try {
    await api(`/api/broadcasts/${id}/enabled`, { method: 'PATCH', body: { enabled } });
  } catch (err) {
    alert('שגיאה: ' + err.message);
    await loadBroadcasts();
  }
};

window.deleteBroadcast = async (id) => {
  if (!confirm('למחוק הודעת שידור זו?')) return;
  try {
    await api(`/api/broadcasts/${id}`, { method: 'DELETE' });
    await loadBroadcasts();
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
};

// Initialize broadcast modal (replaces stubs with real handlers)
initBroadcastModal({ loadBroadcasts });

document.getElementById('btn-add-broadcast').addEventListener('click', () => openAddBroadcast());

// ── Scraper ───────────────────────────────────────────────────────────────────
document.getElementById('btn-scrape').addEventListener('click', async (btn) => {
  const url = document.getElementById('scrape-url').value.trim();
  if (!url) return alert('יש להזין קישור');

  const button = document.getElementById('btn-scrape');
  button.disabled = true;
  button.textContent = 'סורק...';

  const resultDiv = document.getElementById('scrape-result');
  resultDiv.style.display = 'none';

  const scrapeSubject  = document.getElementById('scrape-subject-select').value;
  const scrapeGroupSel = document.getElementById('scrape-wa-group-select');
  const scrapeGroupId  = scrapeGroupSel ? scrapeGroupSel.value : '';
  const scrapeGroup    = scrapeGroupId && _waGroupsCache[scrapeSubject]
    ? (_waGroupsCache[scrapeSubject].find(g => g.id === scrapeGroupId) || null)
    : null;

  try {
    const result = await api('/api/scrape/aliexpress', {
      method: 'POST',
      body: {
        url,
        join_link: scrapeGroup?.joinLink || '',
        wa_group:  scrapeGroup?.waGroup  || '',
        subject:   scrapeSubject,
        autoSend:  document.getElementById('scrape-auto-send').checked,
      },
    });

    if (result.success) {
      const p = result.product;
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = `
        <strong style="color:#4ade80;">✓ מוצר נוסף לגיליון</strong><br/>
        <div style="margin-top:8px;display:flex;gap:12px;align-items:flex-start;">
          ${p.image ? `<img src="${escHtml(p.image)}" style="width:80px;height:80px;object-fit:cover;border-radius:6px;">` : ''}
          <div>
            <div style="font-weight:600;">${escHtml(p.Text)}</div>
            <a href="${escHtml(p.Link)}" target="_blank" style="color:#38bdf8;font-size:12px;" dir="ltr">${escHtml(p.Link)}</a>
          </div>
        </div>
      `;
      if (document.getElementById('scrape-auto-send').checked) showLogTab();
    }
  } catch (err) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `<span style="color:#f87171;">שגיאה: ${escHtml(err.message)}</span>`;
  } finally {
    button.disabled = false;
    button.textContent = 'סרוק ושמור';
  }
});

// ── Add Product ───────────────────────────────────────────────────────────────
document.getElementById('btn-add-product').addEventListener('click', async () => {
  const Text     = document.getElementById('new-text').value.trim();
  const Link     = document.getElementById('new-link').value.trim();
  const image    = document.getElementById('new-image').value.trim();
  const subject  = document.getElementById('new-subject').value;
  const result   = document.getElementById('add-product-result');

  const waGroupSel      = document.getElementById('new-wa-group-select');
  const whatsappGroupId = waGroupSel ? waGroupSel.value : '';

  if (!Text || !Link) { result.textContent = '⚠ שם מוצר וקישור הם שדות חובה'; result.style.color='#d97706'; return; }

  try {
    await api('/api/products', { method: 'POST', body: { Link, image, Text, subject, whatsappGroupId } });
    result.textContent = '✓ מוצר נוסף בהצלחה';
    result.style.color = '#16a34a';
    ['new-text','new-link','new-image'].forEach(id => document.getElementById(id).value = '');
  } catch (err) {
    result.textContent = '✗ שגיאה: ' + err.message;
    result.style.color = '#dc2626';
  }
});

// ── Facebook Token ────────────────────────────────────────────────────────────
document.getElementById('btn-refresh-fb').addEventListener('click', async () => {
  const el = document.getElementById('fb-token-result');
  try {
    const data = await api('/api/facebook/refresh-token', { method: 'POST' });
    el.textContent = `✓ טוקן חדש: ${data.access_token}\n${data.note}`;
    el.style.color = '#4ade80';
  } catch (err) {
    el.textContent = '✗ שגיאה: ' + err.message;
    el.style.color = '#f87171';
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function showLogTab() {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-tab="logs"]').classList.add('active');
  document.getElementById('tab-logs').classList.add('active');
  const el = document.getElementById('topbar-section');
  if (el && typeof tabNames !== 'undefined') el.textContent = tabNames['logs'] || '';
}

// ── Fishing Product Search ────────────────────────────────────────────────────
document.getElementById('btn-fishing-search').addEventListener('click', async () => {
  const limit       = parseInt(document.getElementById('fishing-limit').value) || 10;
  const subject     = document.getElementById('fishing-subject-select').value;
  const waGroupSel  = document.getElementById('fishing-wa-group-select');
  const waGroupId   = waGroupSel ? waGroupSel.value : '';
  const selectedGroup = waGroupId && _waGroupsCache[subject]
    ? (_waGroupsCache[subject].find(g => g.id === waGroupId) || null)
    : null;
  const wa_group  = selectedGroup?.waGroup  || '';
  const join_link = selectedGroup?.joinLink || '';
  const status    = document.getElementById('fishing-search-status');
  const result    = document.getElementById('fishing-search-result');
  const btn       = document.getElementById('btn-fishing-search');

  btn.disabled = true;
  status.textContent = 'מחפש מוצרים... (עשוי לקחת 1-2 דקות)';
  result.style.display = 'none';

  try {
    const data = await api('/api/scrape/fishing-search', {
      method: 'POST',
      body: { limit, wa_group, join_link, subject },
    });

    status.textContent = '';
    result.style.display = 'block';
    result.style.color = '#4ade80';
    result.innerHTML = `✓ נוספו <strong>${data.saved}</strong> מוצרים לגוגל שיטס${data.skipped ? ` (${data.skipped} דולגו)` : ''}`;
    loadProducts();
  } catch (err) {
    status.textContent = '';
    result.style.display = 'block';
    result.style.color = '#f87171';
    result.textContent = `✗ שגיאה: ${err.message || err}`;
  } finally {
    btn.disabled = false;
  }
});

// ── Prompt Editor ─────────────────────────────────────────────────────────────
async function loadPrompt() {
  const data = await api('/api/prompt');
  document.getElementById('prompt-editor').value = data.prompt;
}

document.getElementById('btn-save-prompt').addEventListener('click', async () => {
  const prompt = document.getElementById('prompt-editor').value.trim();
  const res = document.getElementById('prompt-save-result');
  if (!prompt) return;
  try {
    await api('/api/prompt', { method: 'POST', body: { prompt } });
    res.style.color = '#16a34a';
    res.textContent = '✓ הפרומפט נשמר בהצלחה';
  } catch (e) {
    res.style.color = '#dc2626';
    res.textContent = '✗ שגיאה בשמירה';
  }
  setTimeout(() => { res.textContent = ''; }, 3000);
});

document.getElementById('btn-reset-prompt').addEventListener('click', async () => {
  const res = document.getElementById('prompt-save-result');
  try {
    const data = await api('/api/prompt/reset', { method: 'POST' });
    document.getElementById('prompt-editor').value = data.prompt;
    res.style.color = '#16a34a';
    res.textContent = '✓ הפרומפט אופס לברירת המחדל';
  } catch (e) {
    res.style.color = '#dc2626';
    res.textContent = '✗ שגיאה באיפוס';
  }
  setTimeout(() => { res.textContent = ''; }, 3000);
});

// ── Facebook Token Info ────────────────────────────────────────────────────────
async function loadTokenInfo() {
  const el = document.getElementById('fb-token-info');
  try {
    const d = await api('/api/facebook/token-info');
    const daysLeft = d.days_left;
    const color = daysLeft === null ? '#4ade80' : daysLeft > 14 ? '#4ade80' : daysLeft > 3 ? '#fbbf24' : '#f87171';
    const expiry = daysLeft === null
      ? '<span style="color:#4ade80">לא פג תוקף (Page Token ✓)</span>'
      : `<span style="color:${color}">${d.expires_at} (${daysLeft} ימים נותרו)</span>`;
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:120px 1fr;gap:6px 12px;line-height:1.8;">
        <span style="color:#64748b;">תקף:</span><span style="color:${d.valid ? '#4ade80' : '#f87171'}">${d.valid ? '✓ כן' : '✗ לא'}</span>
        <span style="color:#64748b;">אפליקציה:</span><span>${d.app || '—'}</span>
        <span style="color:#64748b;">תפוגה:</span>${expiry}
        <span style="color:#64748b;">הרשאות:</span><span style="font-size:11px;font-family:monospace;">${(d.scopes || []).join(', ')}</span>
      </div>`;
  } catch (e) {
    el.innerHTML = `<span style="color:#f87171">שגיאה: ${e.message}</span>`;
  }
}

document.getElementById('btn-check-token').addEventListener('click', loadTokenInfo);

// Load prompt + subjects when settings tab is opened
document.querySelector('[data-tab="settings"]').addEventListener('click', () => {
  loadPrompt();
  loadSubjects();
  loadWWebjsStatus();
});

// ── WhatsApp Web JS panel ──────────────────────────────────────────────────────
async function loadWWebjsStatus() {
  const dot        = document.getElementById('wwebjs-status-dot');
  const label      = document.getElementById('wwebjs-status-label');
  const qrWrap     = document.getElementById('wwebjs-qr-wrap');
  const qrImg      = document.getElementById('wwebjs-qr-img');
  const groupsWrap = document.getElementById('wwebjs-groups-wrap');
  const noConfig   = document.getElementById('wwebjs-no-config');
  if (!dot) return;

  try {
    const status = await api('/api/whatsapp-service/status');

    qrWrap.style.display     = 'none';
    groupsWrap.style.display = 'none';
    noConfig.style.display   = 'none';

    if (status.state === 'CONNECTED') {
      dot.style.background = '#22c55e';
      label.textContent    = 'מחובר';
      groupsWrap.style.display = 'block';
      loadWWebjsGroups();
    } else if (status.state === 'QR_READY') {
      dot.style.background = '#f59e0b';
      label.textContent    = 'ממתין לסריקת QR';
      if (status.qr) {
        qrImg.src = status.qr;
        qrWrap.style.display = 'block';
      }
      // Auto-refresh every 20s while waiting for scan
      setTimeout(loadWWebjsStatus, 20000);
    } else {
      dot.style.background = '#94a3b8';
      label.textContent    = 'מאתחל...';
      setTimeout(loadWWebjsStatus, 5000);
    }
  } catch (err) {
    dot.style.background   = '#ef4444';
    label.textContent      = 'שגיאת חיבור לשירות';
    if (err.message?.includes('not configured')) {
      noConfig.style.display = 'block';
      label.textContent      = 'שירות לא מוגדר';
    }
  }
}

async function loadWWebjsGroups() {
  const list = document.getElementById('wwebjs-groups-list');
  if (!list) return;
  list.innerHTML = '<div style="font-size:12px;color:var(--on-surface-var);">טוען קבוצות...</div>';
  try {
    const groups = await api('/api/whatsapp-service/groups');
    if (!groups.length) {
      list.innerHTML = '<div style="font-size:12px;color:var(--on-surface-var);">אין קבוצות זמינות</div>';
      return;
    }
    list.innerHTML = groups.map(g => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:10px;gap:10px;">
        <div>
          <div style="font-size:12px;font-weight:600;">${escHtml(g.name)}</div>
          <div style="font-size:10px;color:var(--on-surface-var);direction:ltr;">${escHtml(g.id)}</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="copyToClipboard('${escHtml(g.id)}')" style="font-size:11px;flex-shrink:0;">
          <span class="material-symbols-outlined" style="font-size:13px;">content_copy</span>העתק ID
        </button>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<div style="font-size:12px;color:#ef4444;">שגיאה: ${escHtml(err.message)}</div>`;
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => showToast('ID הועתק ללוח'));
}

function showToast(msg) {
  let t = document.getElementById('_toast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_toast';
    t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#1e1e2e;color:white;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);transition:opacity 0.3s;pointer-events:none;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2000);
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function renderDashboard() {
  const grid = document.getElementById('dashboard-subjects-grid');
  if (!grid) return;

  // Fetch products for all subjects
  let allProducts = [];
  try {
    const { products } = await api('/api/products');
    allProducts = products || [];
  } catch (e) { /* ignore */ }

  const SUBJECT_ICONS = ['🐠','🎣','🌿','🐾','🏋️','🍳','📱','🎮','👗','🏕️','🌸','⚽'];
  const SUBJECT_BG    = [
    'rgba(112,42,225,0.08)','rgba(0,122,255,0.08)','rgba(22,163,74,0.08)',
    'rgba(234,88,12,0.08)', 'rgba(160,45,112,0.08)','rgba(14,165,233,0.08)',
  ];

  const cards = [];

  // "All" summary card
  const totalSent   = allProducts.filter(p => p.sent).length;
  const totalUnsent = allProducts.length - totalSent;
  const totalClicks = allProducts.reduce((s,p) => s + (p.clicks||0), 0);
  cards.push(`
    <div class="dashboard-subject-card" onclick="navigateTo('products','')">
      <div class="dashboard-subject-icon" style="background:rgba(112,42,225,0.1);">🌐</div>
      <div class="dashboard-subject-name">כלל הנושאים</div>
      <div class="dashboard-subject-stat">${allProducts.length} מוצרים</div>
      <div class="dashboard-subject-kpi">
        <div class="dashboard-kpi-item">
          <div class="dashboard-kpi-label">ממתינים</div>
          <div class="dashboard-kpi-val" style="color:#ea580c;">${totalUnsent}</div>
        </div>
        <div class="dashboard-kpi-item">
          <div class="dashboard-kpi-label">נשלחו</div>
          <div class="dashboard-kpi-val" style="color:#16a34a;">${totalSent}</div>
        </div>
        <div class="dashboard-kpi-item">
          <div class="dashboard-kpi-label">קליקים</div>
          <div class="dashboard-kpi-val" style="color:#702ae1;">${totalClicks}</div>
        </div>
      </div>
    </div>
  `);

  if (_subjects.length === 0) {
    cards.push(`
      <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--on-surface-var);">
        <span class="material-symbols-outlined" style="font-size:48px;opacity:0.3;display:block;margin-bottom:12px;">category</span>
        <div style="font-size:14px;">אין נושאים מוגדרים — הוסף נושאים בהגדרות</div>
      </div>
    `);
  } else {
    _subjects.forEach((s, i) => {
      const color   = getSubjectColor(i);
      const subProds= allProducts.filter(p => p.subject === s.id);
      const sent    = subProds.filter(p => p.sent).length;
      const unsent  = subProds.length - sent;
      const clicks  = subProds.reduce((sum,p) => sum + (p.clicks||0), 0);
      const icon    = SUBJECT_ICONS[i % SUBJECT_ICONS.length];
      const bg      = SUBJECT_BG[i % SUBJECT_BG.length];
      cards.push(`
        <div class="dashboard-subject-card" onclick="navigateTo('products','${escHtml(s.id)}')">
          <div class="dashboard-subject-icon" style="background:${bg};">${icon}</div>
          <div class="dashboard-subject-name">${escHtml(s.name)}</div>
          <div class="dashboard-subject-stat">${subProds.length} מוצרים</div>
          <div class="dashboard-subject-kpi">
            <div class="dashboard-kpi-item">
              <div class="dashboard-kpi-label">ממתינים</div>
              <div class="dashboard-kpi-val" style="color:#ea580c;">${unsent}</div>
            </div>
            <div class="dashboard-kpi-item">
              <div class="dashboard-kpi-label">נשלחו</div>
              <div class="dashboard-kpi-val" style="color:#16a34a;">${sent}</div>
            </div>
            <div class="dashboard-kpi-item">
              <div class="dashboard-kpi-label">קליקים</div>
              <div class="dashboard-kpi-val" style="color:${color};">${clicks}</div>
            </div>
          </div>
        </div>
      `);
    });
  }

  grid.innerHTML = cards.join('');
  // Re-apply grid columns
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
}

// Navigate to products page filtered by subject
window.navigateTo = (tab, subjectId) => {
  // Switch to products tab
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const tabBtn = document.querySelector(`[data-tab="${tab}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  const panel = document.getElementById('tab-' + tab);
  if (panel) panel.classList.add('active');
  const el = document.getElementById('topbar-section');
  if (el && typeof tabNames !== 'undefined') el.textContent = tabNames[tab] || '';

  // Set subject filter
  if (tab === 'products') {
    _currentSubject = subjectId;
    // Update sidebar subject items
    document.querySelectorAll('.subject-item').forEach(item => {
      item.classList.toggle('active', item.dataset.subject === subjectId);
    });
    // Update accent color
    if (subjectId === '') {
      setAccentColor(null);
    } else {
      const idx = _subjects.findIndex(s => s.id === subjectId);
      if (idx >= 0) setAccentColor(getSubjectColor(idx));
    }
    loadProducts();
  }
};

// ── AliExpress API Search ─────────────────────────────────────────────────────
let _aliPage         = 1;
let _aliLastProducts = [];
let _aliSort         = 'score';
let _aliExistingUrls = new Set(); // long_urls already in the sheet

function refreshAliSubjectSelect() {
  const sel = document.getElementById('ali-subject-select');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">ללא נישה</option>';
  (_subjects || []).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

// Load WA groups when niche is selected in AliExpress form
document.getElementById('ali-subject-select').addEventListener('change', function() {
  loadWaGroupsForSelect('ali-wa-group-select', this.value);
});

// Weighted score: rate 40%, volume 40%, price 20% (lower = better), stock bonus
function computeAliScore(p) {
  const rate   = parseFloat((p.evaluate_rate || '0').replace('%', '')) || 0;
  const vol    = Number(p.lastest_volume || 0);
  const price  = parseFloat(p.app_sale_price || '999') || 999;
  const stock  = Number(p.available_stock || 0);

  const rateScore   = (rate / 100) * 40;
  const volScore    = (Math.min(Math.log10(Math.max(vol, 1)) / Math.log10(5000), 1)) * 40;
  const priceScore  = Math.max(0, 1 - price / 500) * 20;
  const stockBonus  = Math.min(stock / 2000, 1) * 5;

  return Math.round((rateScore + volScore + priceScore + stockBonus) * 10) / 10;
}

function sortAliProducts(products, sortBy) {
  const arr = [...products];
  switch (sortBy) {
    case 'rate':
      return arr.sort((a, b) => (parseFloat(b.evaluate_rate) || 0) - (parseFloat(a.evaluate_rate) || 0));
    case 'volume':
      return arr.sort((a, b) => (Number(b.lastest_volume) || 0) - (Number(a.lastest_volume) || 0));
    case 'price_asc':
      return arr.sort((a, b) => (parseFloat(a.app_sale_price) || 9999) - (parseFloat(b.app_sale_price) || 9999));
    case 'price_desc':
      return arr.sort((a, b) => (parseFloat(b.app_sale_price) || 0) - (parseFloat(a.app_sale_price) || 0));
    case 'stock':
      return arr.sort((a, b) => (Number(b.available_stock) || 0) - (Number(a.available_stock) || 0));
    case 'score':
    default:
      return arr.sort((a, b) => computeAliScore(b) - computeAliScore(a));
  }
}

function renderAliCard(p, originalIdx) {
  const score    = computeAliScore(p);
  const isOwned  = _aliExistingUrls.has(p.promotion_link);
  const title    = escHtml((p.product_title || '').slice(0, 80));
  const price    = p.app_sale_price ? `₪${escHtml(String(p.app_sale_price))}` : '—';
  const rate     = p.evaluate_rate  ? escHtml(String(p.evaluate_rate))        : '—';
  const vol      = p.lastest_volume  != null ? Number(p.lastest_volume).toLocaleString('he-IL') : '—';
  const stock    = (p.available_stock != null && p.available_stock !== '')
    ? Number(p.available_stock).toLocaleString('he-IL')
    : '<span style="color:var(--on-surface-var)">אין כמות</span>';
  const imgHtml  = p.product_main_image_url
    ? `<img src="${escHtml(p.product_main_image_url)}" alt="" style="width:100%;height:180px;object-fit:cover;border-radius:10px 10px 0 0;display:block;" loading="lazy" />`
    : `<div style="width:100%;height:180px;background:rgba(112,42,225,0.07);border-radius:10px 10px 0 0;display:flex;align-items:center;justify-content:center;"><span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);opacity:0.3;">image</span></div>`;

  const scoreColor = score >= 70 ? '#16a34a' : score >= 45 ? '#d97706' : '#dc2626';
  const ownedBadge = isOwned
    ? `<div style="position:absolute;top:8px;right:8px;background:#16a34a;color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;letter-spacing:0.3px;">✓ ברשימה</div>`
    : '';
  const scoreBadge = `<div style="position:absolute;top:8px;left:8px;background:${scoreColor};color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;">${score}</div>`;

  const addBtn = isOwned
    ? `<button class="btn btn-ghost btn-sm btn-ali-add" style="justify-content:center;font-size:12px;opacity:0.6;" title="כבר ברשימה">
         <span class="material-symbols-outlined" style="font-size:13px;">check_circle</span>כבר ברשימה
       </button>`
    : `<button class="btn btn-primary btn-sm btn-ali-add" style="justify-content:center;font-size:12px;">
         <span class="material-symbols-outlined" style="font-size:13px;">add_circle</span>הוסף לנישה
       </button>`;

  return `
    <div class="card" style="padding:0;overflow:hidden;display:flex;flex-direction:column;${isOwned ? 'opacity:0.75;' : ''}" data-product-idx="${originalIdx}">
      <div style="position:relative;">
        ${imgHtml}
        ${scoreBadge}
        ${ownedBadge}
      </div>
      <div style="padding:14px;flex:1;display:flex;flex-direction:column;gap:8px;">
        <div style="font-size:13px;font-weight:600;color:var(--on-surface);line-height:1.4;">${title}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:12px;color:var(--on-surface-var);margin-top:2px;">
          <span>💰 ${price}</span>
          <span>⭐ ${rate}</span>
          <span>🛒 ${vol} רכישות</span>
          <span>📦 ${stock}</span>
        </div>
        <div style="margin-top:auto;padding-top:10px;display:flex;flex-direction:column;gap:6px;">
          <a href="${escHtml(p.promotion_link || '#')}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="justify-content:center;font-size:12px;">
            <span class="material-symbols-outlined" style="font-size:13px;">open_in_new</span>קישור אפיליאציה
          </a>
          ${addBtn}
          <div class="ali-add-feedback" style="font-size:11px;min-height:14px;text-align:center;"></div>
        </div>
      </div>
    </div>`;
}

function renderAliGrid() {
  const grid    = document.getElementById('ali-products-grid');
  const sorted  = sortAliProducts(_aliLastProducts, _aliSort);

  if (sorted.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--on-surface-var);">לא נמצאו מוצרים העומדים בקריטריונים</div>';
    return;
  }

  // Map sorted products back to original indices for the add handler
  grid.innerHTML = sorted.map(p => {
    const originalIdx = _aliLastProducts.indexOf(p);
    return renderAliCard(p, originalIdx);
  }).join('');

  grid.querySelectorAll('.btn-ali-add').forEach(addBtn => {
    if (addBtn.title === 'כבר ברשימה') return; // skip owned
    addBtn.addEventListener('click', async () => {
      const card     = addBtn.closest('[data-product-idx]');
      const idx      = parseInt(card.dataset.productIdx, 10);
      const product  = _aliLastProducts[idx];
      const subject        = document.getElementById('ali-subject-select').value;
      const waGroupSel     = document.getElementById('ali-wa-group-select');
      const whatsappGroupId = waGroupSel ? waGroupSel.value : '';
      const feedback       = card.querySelector('.ali-add-feedback');

      addBtn.disabled = true;
      feedback.textContent = 'שומר...';
      feedback.style.color = 'var(--on-surface-var)';

      try {
        await api('/api/aliexpress/add', {
          method: 'POST',
          body: { product, subject, whatsappGroupId },
        });
        feedback.textContent = '✓ נוסף לנישה';
        feedback.style.color = '#16a34a';
        addBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:13px;">check_circle</span>נוסף';
        addBtn.style.opacity = '0.5';
        _aliExistingUrls.add(product.promotion_link); // mark as owned locally
      } catch (err) {
        feedback.textContent = `✗ שגיאה: ${err.message}`;
        feedback.style.color = '#dc2626';
        addBtn.disabled = false;
      }
    });
  });
}

async function doAliSearch(page) {
  const keywords = document.getElementById('ali-keywords').value.trim();
  if (!keywords) {
    document.getElementById('ali-search-status').textContent = 'יש להזין מילת מפתח';
    return;
  }
  _aliPage = page;

  const searchBtn = document.getElementById('btn-ali-search');
  const status    = document.getElementById('ali-search-status');
  const section   = document.getElementById('ali-results-section');

  searchBtn.disabled = true;
  status.textContent = `מחפש "${keywords}"...`;
  section.style.display = 'none';

  try {
    // Fetch search results and existing products in parallel
    const [data, existingData] = await Promise.all([
      api('/api/aliexpress/search', { method: 'POST', body: { keywords, page_no: page, subjectId: document.getElementById('ali-subject-select')?.value || undefined } }),
      api('/api/aliexpress/existing').catch(() => ({ urls: [] })),
    ]);

    _aliExistingUrls = new Set(existingData.urls || []);
    _aliLastProducts = data.products;
    status.textContent = '';
    section.style.display = 'block';

    const ownedCount = data.products.filter(p => _aliExistingUrls.has(p.promotion_link)).length;
    const ownedNote  = ownedCount > 0 ? ` · ${ownedCount} כבר ברשימה` : '';
    document.getElementById('ali-results-summary').textContent =
      `נמצאו ${data.filtered} מוצרים (מתוך ${data.total} תוצאות) — עמוד ${page}${ownedNote}`;

    document.getElementById('btn-ali-next-page').style.display = data.total >= 50 ? '' : 'none';

    renderAliGrid();

  } catch (err) {
    status.textContent = '';
    section.style.display = 'block';
    document.getElementById('ali-results-summary').textContent = '';
    document.getElementById('ali-products-grid').innerHTML =
      `<div style="grid-column:1/-1;padding:20px;color:#f87171;">✗ שגיאה: ${escHtml(err.message)}</div>`;
  } finally {
    searchBtn.disabled = false;
  }
}

// Sort button handlers
document.querySelectorAll('[data-ali-sort]').forEach(btn => {
  btn.addEventListener('click', () => {
    _aliSort = btn.dataset.aliSort;
    document.querySelectorAll('[data-ali-sort]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (_aliLastProducts.length > 0) renderAliGrid();
  });
});

document.getElementById('btn-ali-search').addEventListener('click', () => doAliSearch(1));
document.getElementById('ali-keywords').addEventListener('keydown', e => { if (e.key === 'Enter') doAliSearch(1); });
document.getElementById('btn-ali-next-page').addEventListener('click', () => doAliSearch(_aliPage + 1));

// ── Init ──────────────────────────────────────────────────────────────────────
// Add spin keyframe for icon buttons
(function() {
  const s = document.createElement('style');
  s.textContent = '@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }';
  document.head.appendChild(s);
})();

// ── WA Groups Management (niche settings card) ────────────────────────────────

async function loadAndRenderWaGroups(subjectId) {
  const listEl = document.getElementById(`wa-groups-list-${subjectId}`);
  if (!listEl) return;
  invalidateWaCache(subjectId);
  const groups = await loadWaGroupsForSubject(subjectId);
  renderWaGroupsList(subjectId, groups);
  // Update status label to reflect current group count
  const statusLabel = document.getElementById(`niche-status-label-${subjectId}`);
  if (statusLabel) {
    statusLabel.textContent = groups.length
      ? `${groups.length} קבוצת WA מחוברת`
      : 'הגדרות נישה פעילה';
  }
}

function renderWaGroupsList(subjectId, groups) {
  const listEl = document.getElementById(`wa-groups-list-${subjectId}`);
  if (!listEl) return;
  if (!groups.length) {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--on-surface-var);">אין קבוצות עדיין — הוסף קבוצה ראשונה</div>';
    return;
  }
  listEl.innerHTML = groups.map(g => `
    <div id="wa-group-row-${g.id}" style="background:rgba(255,255,255,0.04);border-radius:8px;border:1px solid rgba(255,255,255,0.07);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;">
        <div>
          <div style="font-size:13px;font-weight:600;">${escHtml(g.name)}</div>
          <div style="font-size:11px;color:var(--on-surface-var);direction:ltr;">${escHtml(g.waGroup)}${g.joinLink ? ' · קישור ✓' : ''}</div>
        </div>
        <div style="display:flex;gap:4px;">
          <button class="btn btn-ghost btn-sm" onclick="showEditWaGroup('${g.id}')" style="padding:4px 8px;">
            <span class="material-symbols-outlined" style="font-size:14px;">edit</span>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="deleteWaGroup('${g.id}','${subjectId}')" style="color:#dc2626;padding:4px 8px;">
            <span class="material-symbols-outlined" style="font-size:14px;">delete</span>
          </button>
        </div>
      </div>
      <div id="wa-group-edit-${g.id}" style="display:none;padding:8px 12px;border-top:1px solid rgba(255,255,255,0.07);">
        <div style="display:flex;flex-direction:column;gap:6px;">
          <input class="form-input" id="edit-wa-name-${g.id}" value="${escHtml(g.name)}" placeholder="שם הקבוצה" style="font-size:13px;" />
          <input class="form-input" id="edit-wa-group-id-${g.id}" value="${escHtml(g.waGroup)}" placeholder="מזהה קבוצה" dir="ltr" style="font-size:13px;" />
          <input class="form-input" id="edit-wa-join-${g.id}" value="${escHtml(g.joinLink || '')}" placeholder="https://chat.whatsapp.com/..." dir="ltr" style="font-size:13px;" />
          <div style="display:flex;gap:6px;justify-content:flex-end;">
            <button class="btn btn-ghost btn-sm" onclick="hideEditWaGroup('${g.id}')">ביטול</button>
            <button class="btn btn-primary btn-sm" onclick="saveEditWaGroup('${g.id}','${subjectId}')">שמור</button>
          </div>
        </div>
      </div>
    </div>`).join('');
}

window.showAddWaGroup = (subjectId) => {
  document.getElementById(`add-wa-group-form-${subjectId}`).style.display = '';
};
window.hideAddWaGroup = (subjectId) => {
  document.getElementById(`add-wa-group-form-${subjectId}`).style.display = 'none';
};

window.saveNewWaGroup = async (subjectId) => {
  const name    = document.getElementById(`new-wa-name-${subjectId}`).value.trim();
  const waGroup = document.getElementById(`new-wa-group-id-${subjectId}`).value.trim();
  const joinLink= document.getElementById(`new-wa-join-${subjectId}`).value.trim();
  if (!name || !waGroup) { alert('שם ומזהה קבוצה הם שדות חובה'); return; }
  try {
    await api(`/api/subjects/${subjectId}/whatsapp-groups`, {
      method: 'POST',
      body: { name, waGroup, joinLink },
    });
    ['new-wa-name','new-wa-group-id','new-wa-join'].forEach(id =>
      document.getElementById(`${id}-${subjectId}`).value = ''
    );
    hideAddWaGroup(subjectId);
    await loadAndRenderWaGroups(subjectId);
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
};

window.deleteWaGroup = async (groupId, subjectId) => {
  if (!confirm('למחוק את הקבוצה?')) return;
  try {
    await api(`/api/subjects/whatsapp-groups/${groupId}`, { method: 'DELETE' });
    await loadAndRenderWaGroups(subjectId);
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
};

window.showEditWaGroup = (groupId) => {
  document.getElementById(`wa-group-edit-${groupId}`).style.display = '';
};
window.hideEditWaGroup = (groupId) => {
  document.getElementById(`wa-group-edit-${groupId}`).style.display = 'none';
};
window.saveEditWaGroup = async (groupId, subjectId) => {
  const name     = document.getElementById(`edit-wa-name-${groupId}`).value.trim();
  const waGroup  = document.getElementById(`edit-wa-group-id-${groupId}`).value.trim();
  const joinLink = document.getElementById(`edit-wa-join-${groupId}`).value.trim();
  if (!name || !waGroup) { alert('שם ומזהה קבוצה הם שדות חובה'); return; }
  try {
    await api(`/api/subjects/whatsapp-groups/${groupId}`, {
      method: 'PUT',
      body: { name, waGroup, joinLink },
    });
    await loadAndRenderWaGroups(subjectId);
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
};

// Load subjects first so selects are populated before products/schedules render
loadSubjects().then(() => {
  loadProducts();
  loadSchedules();
});

// ── Users Admin ───────────────────────────────────────────────────────────────
// Load users when the tab is opened
document.querySelectorAll('.tab-btn').forEach(btn => {
  if (btn.dataset.tab === 'users') {
    btn.addEventListener('click', () => {
      loadUsers();
      loadInvites();
    });
  }
  if (btn.dataset.tab === 'schedules') {
    btn.addEventListener('click', () => {
      loadBroadcasts();
    });
  }
});

async function loadUsers() {
  const wrap = document.getElementById('users-table-wrap');
  if (!wrap) return;
  try {
    const res  = await fetch('/api/users');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    renderUsersTable(data.users);
  } catch (err) {
    wrap.innerHTML = `<div style="padding:20px;color:#f87171;">שגיאה: ${escHtml(err.message)}</div>`;
  }
}

function renderUsersTable(users) {
  const wrap = document.getElementById('users-table-wrap');
  if (!wrap) return;
  if (!users.length) {
    wrap.innerHTML = '<div style="padding:40px;text-align:center;color:var(--on-surface-var);">אין משתמשים רשומים</div>';
    return;
  }
  const rows = users.map(u => `
    <tr>
      <td>
        ${u.photo
          ? `<img src="${escHtml(u.photo)}" width="32" height="32" style="border-radius:50%;object-fit:cover;vertical-align:middle;" />`
          : `<span class="material-symbols-outlined" style="font-size:32px;vertical-align:middle;color:var(--on-surface-var);">account_circle</span>`}
      </td>
      <td style="font-weight:600;">${escHtml(u.name || '')}</td>
      <td style="direction:ltr;text-align:right;">${escHtml(u.email)}</td>
      <td>
        <span style="padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${u.role === 'admin' ? 'rgba(112,42,225,0.12)' : 'rgba(30,150,90,0.10)'};color:${u.role === 'admin' ? '#702ae1' : '#16a34a'};">
          ${u.role === 'admin' ? 'אדמין' : 'משתמש'}
        </span>
      </td>
      <td>
        <span style="padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${u.status === 'active' ? 'rgba(22,163,74,0.10)' : 'rgba(220,38,38,0.10)'};color:${u.status === 'active' ? '#16a34a' : '#dc2626'};">
          ${u.status === 'active' ? 'פעיל' : 'מושעה'}
        </span>
      </td>
      <td style="white-space:nowrap;">
        ${u.status === 'active'
          ? `<button class="btn btn-ghost btn-sm" onclick="setUserStatus('${u.id}','suspended')" style="color:#dc2626;">השעה</button>`
          : `<button class="btn btn-ghost btn-sm" onclick="setUserStatus('${u.id}','active')" style="color:#16a34a;">הפעל</button>`}
        ${u.role !== 'admin'
          ? `<button class="btn btn-ghost btn-sm" onclick="deleteUserConfirm('${u.id}','${escHtml(u.name || u.email)}')" style="color:#dc2626;margin-right:4px;">מחק</button>`
          : ''}
      </td>
    </tr>`).join('');

  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th style="width:40px;"></th>
          <th>שם</th><th>מייל</th><th>תפקיד</th><th>סטטוס</th><th>פעולות</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

window.setUserStatus = async (id, status) => {
  try {
    const res  = await fetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    loadUsers();
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
};

window.deleteUserConfirm = async (id, name) => {
  if (!confirm(`למחוק את המשתמש "${name}"? פעולה זו תמחק את כל הנתונים שלו.`)) return;
  try {
    const res  = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    loadUsers();
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
};

// ── Invitations ───────────────────────────────────────────────────────────────
async function loadInvites() {
  const wrap = document.getElementById('invites-table-wrap');
  if (!wrap) return;
  try {
    const res  = await fetch('/api/users/invites');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    renderInvitesTable(data.invitations);
  } catch (err) {
    wrap.innerHTML = `<div style="padding:20px;color:#f87171;">שגיאה: ${escHtml(err.message)}</div>`;
  }
}

function renderInvitesTable(invites) {
  const wrap = document.getElementById('invites-table-wrap');
  if (!wrap) return;
  const pending = invites.filter(i => !i.used_at && new Date(i.expires_at) > new Date());
  if (!pending.length) {
    wrap.innerHTML = '<div style="padding:40px;text-align:center;color:var(--on-surface-var);">אין הזמנות פעילות</div>';
    return;
  }
  const baseUrl = window.location.origin;
  const rows = pending.map(i => `
    <tr>
      <td style="direction:ltr;text-align:right;">${escHtml(i.email)}</td>
      <td style="direction:ltr;font-size:11px;word-break:break-all;">
        <a href="${baseUrl}/auth/invite/${escHtml(i.token)}" target="_blank" style="color:var(--primary);">${baseUrl}/auth/invite/${escHtml(i.token)}</a>
      </td>
      <td style="font-size:12px;">${new Date(i.expires_at).toLocaleDateString('he-IL')}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="deleteInvite('${i.id}')" style="color:#dc2626;">בטל</button>
      </td>
    </tr>`).join('');

  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>מייל</th><th>קישור הזמנה</th><th>תפוגה</th><th>פעולות</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

window.deleteInvite = async (id) => {
  try {
    const res  = await fetch(`/api/users/invites/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    loadInvites();
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
};

// Invite form toggle
document.getElementById('btn-invite-user')?.addEventListener('click', () => {
  document.getElementById('invite-form-section').style.display = '';
  document.getElementById('invite-email-input').focus();
});
document.getElementById('btn-invite-cancel')?.addEventListener('click', () => {
  document.getElementById('invite-form-section').style.display = 'none';
  document.getElementById('invite-result').textContent = '';
  document.getElementById('invite-email-input').value = '';
});
document.getElementById('btn-invite-submit')?.addEventListener('click', async () => {
  const email  = document.getElementById('invite-email-input').value.trim();
  const result = document.getElementById('invite-result');
  if (!email) { result.style.color = '#dc2626'; result.textContent = 'נדרשת כתובת מייל'; return; }

  try {
    const res  = await fetch('/api/users/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    result.style.color = '#16a34a';
    result.innerHTML = `קישור נוצר: <a href="${escHtml(data.invitation.inviteUrl)}" target="_blank" style="direction:ltr;word-break:break-all;">${escHtml(data.invitation.inviteUrl)}</a>`;
    document.getElementById('invite-email-input').value = '';
    loadInvites();
  } catch (err) {
    result.style.color = '#dc2626';
    result.textContent = 'שגיאה: ' + err.message;
  }
});

document.getElementById('btn-refresh-users')?.addEventListener('click', () => {
  loadUsers();
  loadInvites();
});

// ── Migrate products from Google Sheets ──────────────────────────────────────
document.getElementById('btn-migrate-products')?.addEventListener('click', async () => {
  const btn    = document.getElementById('btn-migrate-products');
  const result = document.getElementById('migrate-products-result');
  btn.disabled = true;
  btn.textContent = 'מייבא...';
  result.textContent = '';
  result.style.color = 'var(--on-surface-var)';
  try {
    const data = await fetch('/api/users/migrate-products', { method: 'POST' }).then(r => r.json());
    if (!data.success) throw new Error(data.error);
    result.style.color = 'var(--success, #4caf50)';
    result.textContent = `✓ יובאו ${data.inserted} מוצרים, דולגו ${data.skipped} קיימים.`;
    if (data.inserted > 0) loadProducts();
  } catch (err) {
    result.style.color = 'var(--error, #f44336)';
    result.textContent = `✗ שגיאה: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px;">table_rows</span> ייבא מוצרים';
  }
});

// ── Migrate subjects from Google Sheets ───────────────────────────────────────
document.getElementById('btn-migrate-subjects')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-migrate-subjects');
  const result = document.getElementById('migrate-subjects-result');
  btn.disabled = true;
  btn.textContent = 'מייבא...';
  result.textContent = '';
  result.style.color = 'var(--on-surface-var)';
  try {
    const data = await fetch('/api/users/migrate-subjects', { method: 'POST' }).then(r => r.json());
    if (!data.success) throw new Error(data.error);
    result.style.color = 'var(--success, #4caf50)';
    result.textContent = `✓ יובאו ${data.inserted} נישות, דולגו ${data.skipped} קיימות.`;
    if (data.inserted > 0) {
      // Refresh niches list
      loadSubjects();
    }
  } catch (err) {
    result.style.color = 'var(--error, #f44336)';
    result.textContent = `✗ שגיאה: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px;">cloud_download</span> הפעל ייבוא';
  }
});

// ── Analytics (Profitability) ─────────────────────────────────────────────────

// Set default date range (last 30 days) on page load
(function initAnalyticsDates() {
  const now   = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  const startEl = document.getElementById('analytics-start-date');
  const endEl   = document.getElementById('analytics-end-date');
  if (startEl) startEl.value = start.toISOString().slice(0, 10);
  if (endEl)   endEl.value   = now.toISOString().slice(0, 10);
})();

async function renderAnalyticsSummary() {
  const grid = document.getElementById('analytics-niches-grid');
  if (!grid) return;
  grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--on-surface-var);">טוען נתוני עמלות...</div>';

  try {
    const data   = await api('/api/analytics/summary');
    const niches = data.niches || [];

    if (!niches.length) {
      grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--on-surface-var);">אין נישות מוגדרות</div>';
      return;
    }

    grid.innerHTML = niches.map(n => renderNicheRow(n)).join('');

    // KPI strip totals
    const totalCommission  = niches.reduce((s, n) => s + parseFloat(n.total_commission || 0), 0);
    const confirmedTotal   = niches.reduce((s, n) => s + parseFloat(n.confirmed_commission || 0), 0);
    const totalOrders      = niches.reduce((s, n) => s + parseInt(n.total_orders || 0, 10), 0);
    const totalClicks      = niches.reduce((s, n) => s + parseInt(n.total_clicks || 0, 10), 0);
    const strip = document.getElementById('analytics-kpi-strip');
    if (strip) {
      strip.innerHTML = [
        { label: 'עמלה כוללת',   value: `$${totalCommission.toFixed(2)}`, color: '#16a34a', icon: 'paid' },
        { label: 'עמלה מאושרת', value: `$${confirmedTotal.toFixed(2)}`,  color: '#059669', icon: 'verified' },
        { label: 'הזמנות',       value: totalOrders.toLocaleString(),      color: 'var(--on-surface)', icon: 'shopping_bag' },
        { label: 'קליקים',       value: totalClicks.toLocaleString(),      color: '#702ae1', icon: 'ads_click' },
      ].map(k => `
        <div class="card an-kpi-card">
          <span class="material-symbols-outlined an-kpi-icon" style="color:${k.color};">${k.icon}</span>
          <div>
            <div class="an-kpi-val" style="color:${k.color};">${k.value}</div>
            <div class="an-kpi-label">${k.label}</div>
          </div>
        </div>`).join('');
    }

    // Populate niche filters
    const nicheOptions = '<option value="">כל הנישות</option>' +
      niches.map(n => `<option value="${escHtml(n.id)}">${escHtml(n.name)}</option>`).join('');
    ['analytics-niche-filter','analytics-top-niche-filter','analytics-real-orders-niche-filter','analytics-timing-niche-filter'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = nicheOptions;
    });
    const roasSel = document.getElementById('roas-form-subject');
    if (roasSel) roasSel.innerHTML = '<option value="">בחר נישה</option>' +
      niches.map(n => `<option value="${escHtml(n.id)}">${escHtml(n.name)}</option>`).join('');

    loadTopProducts();
    loadRealProductOrders();
    loadTimingHeatmap();
    loadRoas();
    loadReachSummary().catch(() => {});
    loadInsights();
    loadSalesDashboard();
    loadJoinLinkStats();
  } catch (err) {
    grid.innerHTML = `<div style="padding:40px;text-align:center;color:#f87171;">שגיאה: ${escHtml(err.message)}</div>`;
  }
}

function renderNicheRow(n) {
  const commission = parseFloat(n.total_commission || 0);
  const confirmed  = parseFloat(n.confirmed_commission || 0);
  const orderValue = parseFloat(n.total_order_value || 0);
  const orders     = parseInt(n.total_orders || 0, 10);
  const clicks     = parseInt(n.total_clicks || 0, 10);
  const color      = n.color || '#702ae1';
  const convPct    = clicks > 0 && orders > 0 ? ((orders / clicks) * 100).toFixed(2) + '%' : '—';
  const hasNoOrders = n.tracking_id && orders === 0;
  const probeLink   = hasNoOrders
    ? ` · <a href="/api/analytics/probe-raw-orders?subjectId=${encodeURIComponent(n.id)}" target="_blank" style="color:#3b82f6;font-size:10px;text-decoration:underline;">בדוק API ←</a>`
    : '';
  const statusDot  = n.tracking_id
    ? `<span style="font-size:10px;color:#16a34a;white-space:nowrap;">● מחובר${probeLink}</span>`
    : `<span style="font-size:10px;color:#f59e0b;white-space:nowrap;">● חסר Tracking ID</span>`;

  return `
    <div class="an-niche-row" data-subject-id="${escHtml(n.id)}">
      <div class="an-niche-name-cell" style="display:flex;align-items:center;gap:10px;">
        <div style="width:3px;height:34px;border-radius:2px;background:${escHtml(color)};flex-shrink:0;"></div>
        <div>
          <div style="font-weight:700;font-size:14px;color:var(--on-surface);">${escHtml(n.name)}</div>
          ${statusDot}
        </div>
      </div>
      <div class="an-col-c">
        <div class="an-niche-label">עמלה</div>
        <div style="font-size:19px;font-weight:900;color:#16a34a;">$${commission.toFixed(2)}</div>
      </div>
      <div class="an-col-c">
        <div class="an-niche-label">מאושרת</div>
        <div style="font-size:15px;font-weight:700;color:#059669;">$${confirmed.toFixed(2)}</div>
      </div>
      <div class="an-col-c">
        <div class="an-niche-label">הזמנות</div>
        <div style="font-size:17px;font-weight:700;color:var(--on-surface);">${orders}</div>
      </div>
      <div class="an-col-c">
        <div class="an-niche-label">ערך</div>
        <div style="font-size:13px;color:var(--on-surface-var);">$${orderValue.toFixed(2)}</div>
      </div>
      <div class="an-col-c">
        <div class="an-niche-label">קליקים</div>
        <div style="font-size:15px;font-weight:700;color:#702ae1;">${clicks.toLocaleString()}</div>
      </div>
      <div class="an-col-c">
        <div class="an-niche-label">המרה</div>
        <div style="font-size:14px;font-weight:600;color:var(--on-surface);">${convPct}</div>
      </div>
    </div>`;
}

// Sync button
document.getElementById('btn-sync-commissions').addEventListener('click', async () => {
  const btn    = document.getElementById('btn-sync-commissions');
  const status = document.getElementById('analytics-sync-status');
  const start  = document.getElementById('analytics-start-date').value;
  const end    = document.getElementById('analytics-end-date').value;

  btn.disabled = true;
  status.textContent = 'מסנכרן עמלות...';
  status.style.color = 'var(--on-surface-var)';

  try {
    const data = await api('/api/analytics/sync-commissions', {
      method: 'POST',
      body:   { startDate: start || undefined, endDate: end || undefined },
    });

    status.style.color = '#16a34a';
    const perNiche = (data.subjects || []).map(s =>
      s.error ? `${s.subjectName}: ✗ ${s.error}` : `${s.subjectName}: ${s.synced}`
    ).join(' | ');
    const unmatched = data.unmatched > 0 ? ` · ${data.unmatched} לא מזוהים` : '';
    status.textContent = `✓ ${data.synced} הזמנות — ${perNiche}${unmatched}`;

    // Refresh summary cards and orders
    await renderAnalyticsSummary();
    await loadAnalyticsOrders();
  } catch (err) {
    status.style.color = '#f87171';
    status.textContent = `✗ שגיאה: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

// Section tab switching
document.querySelectorAll('.an-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.an-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('[id^="an-section-"]').forEach(s => s.style.display = 'none');
    btn.classList.add('active');
    const sec = document.getElementById(`an-section-${btn.dataset.section}`);
    if (sec) sec.style.display = '';
  });
});

async function loadAnalyticsOrders(subjectId = '') {
  const el = document.getElementById('analytics-orders-table');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--on-surface-var);">טוען...</div>';

  try {
    const qs   = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : '';
    const data = await api(`/api/analytics/orders${qs}`);
    const orders = data.orders || [];

    if (!orders.length) {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--on-surface-var);">אין הזמנות בטווח הנבחר</div>';
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>מס׳ הזמנה</th>
              <th>נישה</th>
              <th>ערך הזמנה</th>
              <th>עמלה</th>
              <th>סטטוס</th>
              <th>תאריך</th>
            </tr>
          </thead>
          <tbody>
            ${orders.map(o => {
              const statusColor = (o.payment_status === 'confirmed' || o.order_status === 'finished')
                ? '#16a34a' : '#f59e0b';
              return `<tr>
                <td style="font-family:var(--font-mono);font-size:11px;color:var(--on-surface-var);">${escHtml(String(o.order_id))}</td>
                <td>
                  <span style="display:inline-flex;align-items:center;gap:6px;">
                    <span style="width:8px;height:8px;border-radius:50%;background:${escHtml(o.subject_color||'#702ae1')};flex-shrink:0;"></span>
                    ${escHtml(o.subject_name || '—')}
                  </span>
                </td>
                <td>$${parseFloat(o.order_amount||0).toFixed(2)}</td>
                <td style="color:#16a34a;font-weight:700;">$${parseFloat(o.commission_usd||0).toFixed(2)}</td>
                <td><span style="color:${statusColor};font-size:12px;font-weight:600;">${escHtml(o.payment_status || o.order_status || '—')}</span></td>
                <td style="font-size:12px;color:var(--on-surface-var);">${o.order_time ? fmtDate(o.order_time) : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div style="padding:20px;color:#f87171;">שגיאה: ${escHtml(err.message)}</div>`;
  }
}

// Niche filter for orders table
document.getElementById('analytics-niche-filter').addEventListener('change', function () {
  loadAnalyticsOrders(this.value);
});

// ── Analytics: Top Products (real attribution) ───────────────────────────────

async function loadTopProducts(subjectId = '') {
  const el = document.getElementById('analytics-top-products-table');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--on-surface-var);">טוען...</div>';

  try {
    const qs      = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : '';
    const data    = await api(`/api/analytics/top-products${qs}`);
    const products = data.products || [];

    if (!products.length) {
      el.innerHTML = `<div style="padding:32px;text-align:center;">
        <div style="font-size:13px;color:var(--on-surface-var);">אין נתוני עמלות אמיתיות לנישות אלו — לחץ "עדכן עמלות" כדי למשוך נתוני הזמנות מ-AliExpress.</div>
      </div>`;
      return;
    }

    const rows = products.map((p, i) => {
      const attributed = p.attributed_commission != null ? parseFloat(p.attributed_commission) : null;
      const rpc        = p.commission_per_click  != null ? parseFloat(p.commission_per_click)  : null;
      const color      = p.subject_color || '#702ae1';
      const rankColor  = i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'var(--on-surface-var)';

      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
        <td style="padding:10px 8px;text-align:center;font-weight:700;font-size:13px;color:${rankColor};">${i + 1}</td>
        <td style="padding:10px 8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            ${p.image ? `<img src="${escHtml(p.image)}" style="width:36px;height:36px;object-fit:cover;border-radius:8px;flex-shrink:0;" loading="lazy" />` : `<div style="width:36px;height:36px;border-radius:8px;background:rgba(112,42,225,0.08);flex-shrink:0;"></div>`}
            <div>
              <div style="font-size:12px;font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(p.text || '')}">${escHtml(p.text || '—')}</div>
              ${p.short_link ? `<a href="${escHtml(p.short_link)}" target="_blank" style="font-size:10px;color:var(--on-surface-var);direction:ltr;font-family:monospace;">${escHtml(p.short_link)}</a>` : ''}
            </div>
          </div>
        </td>
        <td style="padding:10px 8px;">
          <span style="display:inline-flex;align-items:center;gap:5px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
            <span style="font-size:12px;">${escHtml(p.subject_name || '—')}</span>
          </span>
        </td>
        <td style="padding:10px 8px;font-weight:700;color:#702ae1;text-align:center;">${(p.clicks || 0).toLocaleString()}</td>
        <td style="padding:10px 8px;text-align:center;font-size:12px;color:var(--on-surface-var);">${rpc != null ? `$${rpc.toFixed(5)}` : '—'}</td>
        <td style="padding:10px 8px;text-align:center;font-weight:900;font-size:16px;color:#16a34a;">${attributed != null ? `$${attributed.toFixed(2)}` : '—'}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="border-bottom:2px solid rgba(255,255,255,0.08);">
              <th style="padding:8px;width:36px;"></th>
              <th style="padding:8px;text-align:right;font-weight:600;color:var(--on-surface-var);">מוצר</th>
              <th style="padding:8px;text-align:right;font-weight:600;color:var(--on-surface-var);">נישה</th>
              <th style="padding:8px;text-align:center;font-weight:600;color:var(--on-surface-var);">קליקים</th>
              <th style="padding:8px;text-align:center;font-weight:600;color:var(--on-surface-var);">$/קליק (נישה)</th>
              <th style="padding:8px;text-align:center;font-weight:600;color:var(--on-surface-var);">עמלה מיוחסת</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--on-surface-var);padding:0 4px;">
        עמלה מיוחסת = קליקי מוצר × (עמלת נישה ÷ קליקי נישה) — ללא הנחות, מבוסס על נתוני AliExpress בפועל
      </div>`;
  } catch (err) {
    el.innerHTML = `<div style="padding:20px;color:#f87171;">שגיאה: ${escHtml(err.message)}</div>`;
  }
}

document.getElementById('analytics-top-niche-filter').addEventListener('change', function () {
  loadTopProducts(this.value);
});

// ── Analytics: Real Product Orders (from order_items) ────────────────────────

async function loadRealProductOrders(subjectId = '') {
  const el = document.getElementById('analytics-real-orders-table');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--on-surface-var);">טוען...</div>';

  try {
    const qs   = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : '';
    const data = await api(`/api/analytics/product-orders${qs}`);
    const products = data.products || [];

    if (!products.length) {
      const msg = data.totalItems === 0
        ? `<div style="padding:32px;text-align:center;">
             <div style="font-size:36px;margin-bottom:12px;">📦</div>
             <div style="font-weight:700;margin-bottom:8px;">אין נתוני הזמנות ברמת מוצר</div>
             <div style="font-size:12px;color:var(--on-surface-var);max-width:380px;margin:0 auto;">
               ה-API של AliExpress לא מחזיר פרטי מוצר בתוך ההזמנות עבור חשבונך.
               לחץ "עדכן עמלות" כדי לנסות שוב — אם עדיין ריק, ממשק ה-API שלך לא כולל פירוט מוצרים.
             </div>
             <a href="/api/analytics/probe-raw-orders" target="_blank" style="display:inline-block;margin-top:16px;font-size:12px;color:#3b82f6;text-decoration:underline;">בדוק תגובת API גולמית ←</a>
           </div>`
        : '<div style="padding:20px;text-align:center;color:var(--on-surface-var);">אין מוצרים תואמים לסינון זה.</div>';
      el.innerHTML = msg;
      return;
    }

    const rows = products.map((p, i) => {
      const color   = p.subject_color || '#888';
      const title   = escHtml(p.product_title || p.product_id || '—');
      const niche   = escHtml(p.subject_name || '—');
      const comm    = parseFloat(p.total_commission) || 0;
      const value   = parseFloat(p.total_order_value) || 0;
      const orders  = parseInt(p.order_count, 10) || 0;
      const items   = parseInt(p.total_items, 10) || 0;
      const rank    = i + 1;
      const rankColor = rank === 1 ? '#f59e0b' : rank === 2 ? '#94a3b8' : rank === 3 ? '#b45309' : 'var(--on-surface-var)';

      return `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
          <td style="padding:10px 8px;font-weight:700;font-size:13px;color:${rankColor};text-align:center;">${rank}</td>
          <td style="padding:10px 8px;">
            <div style="font-size:13px;font-weight:600;line-height:1.4;max-width:340px;">${title}</div>
            <div style="font-size:11px;color:var(--on-surface-var);margin-top:2px;direction:ltr;font-family:monospace;">${escHtml(p.product_id)}</div>
          </td>
          <td style="padding:10px 8px;">
            <span style="display:inline-flex;align-items:center;gap:5px;">
              <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
              <span style="font-size:12px;">${niche}</span>
            </span>
          </td>
          <td style="padding:10px 8px;text-align:center;font-weight:700;font-size:15px;">${orders}</td>
          <td style="padding:10px 8px;text-align:center;font-size:13px;color:var(--on-surface-var);">${items}</td>
          <td style="padding:10px 8px;text-align:center;font-size:12px;color:var(--on-surface-var);">$${value.toFixed(2)}</td>
          <td style="padding:10px 8px;text-align:center;font-size:17px;font-weight:900;color:#16a34a;">$${comm.toFixed(2)}</td>
        </tr>`;
    }).join('');

    el.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="border-bottom:2px solid rgba(255,255,255,0.08);">
              <th style="padding:8px;text-align:center;font-weight:600;color:var(--on-surface-var);width:36px;">#</th>
              <th style="padding:8px;text-align:right;font-weight:600;color:var(--on-surface-var);">מוצר</th>
              <th style="padding:8px;text-align:right;font-weight:600;color:var(--on-surface-var);">נישה</th>
              <th style="padding:8px;text-align:center;font-weight:600;color:var(--on-surface-var);">הזמנות</th>
              <th style="padding:8px;text-align:center;font-weight:600;color:var(--on-surface-var);">יחידות</th>
              <th style="padding:8px;text-align:center;font-weight:600;color:var(--on-surface-var);">שווי הזמנות</th>
              <th style="padding:8px;text-align:center;font-weight:600;color:var(--on-surface-var);">עמלה בפועל</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--on-surface-var);text-align:left;">
        <a href="/api/analytics/probe-raw-orders" target="_blank" style="color:#3b82f6;text-decoration:none;">בדוק תגובת API גולמית ←</a>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div style="padding:20px;color:#f87171;">שגיאה: ${escHtml(err.message)}</div>`;
  }
}

document.getElementById('analytics-real-orders-niche-filter').addEventListener('change', function () {
  loadRealProductOrders(this.value);
});

// ── Analytics: Timing Heatmap ─────────────────────────────────────────────────

const DOW_LABELS = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

async function loadTimingHeatmap(subjectId = '') {
  const el = document.getElementById('analytics-timing-content');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--on-surface-var);">טוען...</div>';

  try {
    const qs   = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : '';
    const data = await api(`/api/analytics/timing${qs}`);
    const slots = data.slots || [];

    if (!slots.length) {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--on-surface-var);">אין נתונים — שלח לפחות פוסט אחד כדי לראות תזמונים.</div>';
      return;
    }

    // Build lookup: dow → hour → avg_clicks
    const map = {};
    let maxAvg = 0;
    for (const s of slots) {
      const dow  = parseInt(s.dow,  10);
      const hour = parseInt(s.hour, 10);
      const avg  = parseFloat(s.avg_clicks);
      if (!map[dow]) map[dow] = {};
      map[dow][hour] = { avg, sends: parseInt(s.sends, 10) };
      if (avg > maxAvg) maxAvg = avg;
    }

    // Top 5 slots for badges
    const top5 = slots.slice(0, 5).map(s => `${s.dow}_${s.hour}`);

    // Build header row (hours 0–23)
    const hours = Array.from({ length: 24 }, (_, i) => i);

    let html = `
      <div style="overflow-x:auto;">
        <table style="border-collapse:collapse;font-size:11px;min-width:700px;width:100%;">
          <thead>
            <tr>
              <th style="padding:4px 8px;text-align:right;font-weight:600;color:var(--on-surface-var);white-space:nowrap;position:sticky;right:0;background:var(--surface);">יום \\ שעה</th>
              ${hours.map(h => `<th style="padding:4px 3px;text-align:center;font-weight:500;color:var(--on-surface-var);min-width:26px;">${h}</th>`).join('')}
            </tr>
          </thead>
          <tbody>`;

    for (let dow = 0; dow < 7; dow++) {
      html += `<tr>
        <td style="padding:4px 8px;font-weight:600;color:var(--on-surface-var);white-space:nowrap;position:sticky;right:0;background:var(--surface);">${DOW_LABELS[dow]}</td>`;

      for (const hour of hours) {
        const cell   = map[dow]?.[hour];
        const avg    = cell?.avg  ?? 0;
        const sends  = cell?.sends ?? 0;
        const isTop  = top5.includes(`${dow}_${hour}`);
        const intensity = maxAvg > 0 ? avg / maxAvg : 0;
        // Color: purple at full intensity, transparent at zero
        const alpha  = (0.08 + intensity * 0.82).toFixed(2);
        const bg     = avg > 0 ? `rgba(112,42,225,${alpha})` : 'transparent';
        const color  = intensity > 0.5 ? '#fff' : 'var(--on-surface-var)';
        const border = isTop ? '2px solid #16a34a' : '1px solid transparent';
        const title  = avg > 0 ? `${DOW_LABELS[dow]} ${hour}:00 — ממוצע ${avg.toFixed(1)} קליקים (${sends} שליחות)` : '';

        html += `<td style="padding:3px 2px;text-align:center;" title="${escHtml(title)}">
          <div style="width:24px;height:24px;border-radius:4px;margin:0 auto;background:${bg};border:${border};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:${color};cursor:${avg > 0 ? 'default' : 'default'};">
            ${avg > 0 ? (avg >= 10 ? Math.round(avg) : avg.toFixed(1)) : ''}
          </div>
        </td>`;
      }
      html += '</tr>';
    }

    html += `</tbody></table></div>`;

    // Top 5 summary pills
    if (top5.length) {
      html += `<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <span style="font-size:11px;color:var(--on-surface-var);font-weight:600;">5 זמנים מובילים:</span>`;
      for (const s of slots.slice(0, 5)) {
        const dow  = parseInt(s.dow, 10);
        const hour = parseInt(s.hour, 10);
        const avg  = parseFloat(s.avg_clicks).toFixed(1);
        html += `<span style="font-size:11px;background:rgba(22,163,74,0.1);color:#16a34a;padding:3px 10px;border-radius:20px;font-weight:600;">
          ${DOW_LABELS[dow]} ${hour}:00 · ${avg} קליקים
        </span>`;
      }
      html += '</div>';
    }

    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = `<div style="padding:20px;color:#f87171;">שגיאה: ${escHtml(err.message)}</div>`;
  }
}

document.getElementById('analytics-timing-niche-filter').addEventListener('change', function () {
  loadTimingHeatmap(this.value);
});

// ── Analytics: Meta Organic Reach ─────────────────────────────────────────────

document.getElementById('btn-analytics-sync-clicks').addEventListener('click', async () => {
  const btn    = document.getElementById('btn-analytics-sync-clicks');
  const status = document.getElementById('analytics-sync-status');

  btn.disabled = true;
  status.textContent = 'מסנכרן קליקים...';
  status.style.color = 'var(--on-surface-var)';

  try {
    const data = await api('/api/products/sync-clicks', { method: 'POST' });
    status.style.color = '#16a34a';
    status.textContent = `✓ עודכנו ${data.synced} קישורים`;
    await renderAnalyticsSummary();
  } catch (err) {
    status.style.color = '#f87171';
    status.textContent = `✗ שגיאה: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btn-sync-reach').addEventListener('click', async () => {
  const btn    = document.getElementById('btn-sync-reach');
  const status = document.getElementById('analytics-sync-status');

  btn.disabled = true;
  status.textContent = 'מסנכרן חשיפה...';
  status.style.color = 'var(--on-surface-var)';

  try {
    const data = await api('/api/analytics/sync-reach', { method: 'POST' });
    status.style.color = '#16a34a';
    status.textContent = `✓ סונכרנו ${data.synced} פוסטים`;
    await loadReachSummary();
    document.getElementById('analytics-reach-card').style.display = '';
  } catch (err) {
    status.style.color = '#f87171';
    status.textContent = `✗ שגיאה: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

// Manual sync modal
document.getElementById('btn-manual-sync').addEventListener('click', () => {
  const niches = Array.from(document.querySelectorAll('#analytics-niches-grid .an-niche-row'))
    .map(row => ({
      id:   row.dataset.subjectId,
      name: row.querySelector('[style*="font-weight:700"]')?.textContent?.trim(),
    }))
    .filter(n => n.id);

  // Build options from already-loaded niches or fallback to empty
  const opts = niches.length
    ? niches.map(n => `<option value="${escHtml(n.id)}">${escHtml(n.name)}</option>`).join('')
    : '<option value="">טען קודם את הנישות (לחץ עדכן עמלות)</option>';

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:460px;padding:24px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <span style="font-weight:700;font-size:16px;">סנכרן Tracking ID ידנית</span>
        <button id="modal-close" class="btn btn-ghost btn-sm">✕</button>
      </div>
      <div style="font-size:13px;color:var(--on-surface-var);margin-bottom:16px;">
        שמושי ל-Tracking ID ישן שלא משויך לנישה ספציפית — הזמנות ישויכו לנישה שתבחר.
      </div>
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">Tracking ID</label>
      <input id="manual-tracking-id" class="form-input" style="width:100%;margin-bottom:14px;" placeholder="לדוגמה: affheav123" />
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">שייך לנישה</label>
      <select id="manual-subject-id" class="form-input" style="width:100%;margin-bottom:14px;">${opts}</select>
      <div style="display:flex;gap:10px;margin-bottom:14px;">
        <div style="flex:1;">
          <label style="font-size:12px;color:var(--on-surface-var);display:block;margin-bottom:4px;">מתאריך</label>
          <input type="date" id="manual-start-date" class="form-input" style="width:100%;font-size:13px;" />
        </div>
        <div style="flex:1;">
          <label style="font-size:12px;color:var(--on-surface-var);display:block;margin-bottom:4px;">עד תאריך</label>
          <input type="date" id="manual-end-date" class="form-input" style="width:100%;font-size:13px;" />
        </div>
      </div>
      <div id="manual-sync-result" style="font-size:13px;min-height:20px;margin-bottom:14px;"></div>
      <button id="manual-sync-go" class="btn btn-primary" style="width:100%;">
        <span class="material-symbols-outlined" style="font-size:15px;">cloud_sync</span>סנכרן
      </button>
    </div>`;
  document.body.appendChild(modal);

  // Pre-fill dates from main toolbar
  const mainStart = document.getElementById('analytics-start-date').value;
  const mainEnd   = document.getElementById('analytics-end-date').value;
  if (mainStart) document.getElementById('manual-start-date').value = mainStart;
  if (mainEnd)   document.getElementById('manual-end-date').value   = mainEnd;

  document.getElementById('modal-close').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  document.getElementById('manual-sync-go').addEventListener('click', async () => {
    const trackingId = document.getElementById('manual-tracking-id').value.trim();
    const subjectId  = document.getElementById('manual-subject-id').value;
    const startDate  = document.getElementById('manual-start-date').value;
    const endDate    = document.getElementById('manual-end-date').value;
    const result     = document.getElementById('manual-sync-result');
    const btn        = document.getElementById('manual-sync-go');

    if (!trackingId) { result.style.color = '#f87171'; result.textContent = 'יש להזין Tracking ID'; return; }
    if (!subjectId)  { result.style.color = '#f87171'; result.textContent = 'יש לבחור נישה'; return; }

    btn.disabled = true;
    result.style.color = 'var(--on-surface-var)';
    result.textContent = 'מסנכרן...';

    try {
      const data = await api('/api/analytics/sync-commissions-manual', {
        method: 'POST',
        body: { trackingId, subjectId, startDate: startDate || undefined, endDate: endDate || undefined },
      });
      result.style.color = '#16a34a';
      result.textContent = `✓ סונכרנו ${data.synced} הזמנות ל-${data.subjectName}`;
      await renderAnalyticsSummary();
    } catch (err) {
      result.style.color = '#f87171';
      result.textContent = `✗ שגיאה: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });
});

async function loadReachSummary() {
  const grid = document.getElementById('analytics-reach-grid');
  if (!grid) return;
  grid.innerHTML = '<div style="padding:20px;text-align:center;color:var(--on-surface-var);grid-column:1/-1;">טוען...</div>';

  try {
    const data = await api('/api/analytics/reach-summary');
    const rows = data.reach || [];

    if (!rows.length) {
      grid.innerHTML = '<div style="padding:20px;text-align:center;color:var(--on-surface-var);grid-column:1/-1;">אין נתוני חשיפה. לחץ "עדכן חשיפה" לאחר שליחת פוסטים.</div>';
      return;
    }

    // Group by niche, then platform
    const byNiche = {};
    for (const r of rows) {
      if (!byNiche[r.id]) byNiche[r.id] = { name: r.name, color: r.color, platforms: [] };
      byNiche[r.id].platforms.push(r);
    }

    grid.innerHTML = Object.values(byNiche).map(n => {
      const fb  = n.platforms.find(p => p.platform === 'facebook');
      const ig  = n.platforms.find(p => p.platform === 'instagram');
      const totalReach = (parseInt(fb?.total_reach||0,10)) + (parseInt(ig?.total_reach||0,10));
      const avgReach   = Math.round(((fb ? parseFloat(fb.avg_reach_per_post) : 0) + (ig ? parseFloat(ig.avg_reach_per_post) : 0)) / ((fb?1:0)+(ig?1:0)) || 0);
      const ctr        = fb?.ctr_pct || ig?.ctr_pct || 0;

      return `<div class="dashboard-subject-card" style="border-top:3px solid ${escHtml(n.color||'#702ae1')};">
        <div style="font-size:15px;font-weight:800;margin-bottom:12px;">${escHtml(n.name)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          <div class="dashboard-kpi-item">
            <div class="dashboard-kpi-label">סה״כ חשיפה</div>
            <div class="dashboard-kpi-val" style="color:#3b82f6;">${totalReach.toLocaleString()}</div>
          </div>
          <div class="dashboard-kpi-item">
            <div class="dashboard-kpi-label">חשיפה ממוצעת</div>
            <div class="dashboard-kpi-val">${avgReach.toLocaleString()}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px;">
          ${fb ? `<div style="background:rgba(59,130,246,0.1);color:#3b82f6;padding:3px 8px;border-radius:20px;">FB: ${parseInt(fb.total_reach,10).toLocaleString()} חשיפה · ${fb.posts_tracked} פוסטים</div>` : ''}
          ${ig ? `<div style="background:rgba(168,85,247,0.1);color:#a855f7;padding:3px 8px;border-radius:20px;">IG: ${parseInt(ig.total_reach,10).toLocaleString()} חשיפה · ${ig.posts_tracked} פוסטים</div>` : ''}
        </div>
        ${parseFloat(ctr) > 0 ? `<div style="margin-top:8px;font-size:11px;color:var(--on-surface-var);">CTR: <strong style="color:var(--on-surface);">${parseFloat(ctr).toFixed(2)}%</strong> (קליקים / חשיפה)</div>` : ''}
      </div>`;
    }).join('');
  } catch (err) {
    grid.innerHTML = `<div style="padding:20px;color:#f87171;grid-column:1/-1;">שגיאה: ${escHtml(err.message)}</div>`;
  }
}

// ── Analytics: ROAS ───────────────────────────────────────────────────────────

document.getElementById('btn-roas-add-toggle').addEventListener('click', () => {
  const form = document.getElementById('roas-add-form');
  form.style.display = form.style.display === 'none' ? '' : 'none';
});

document.getElementById('btn-roas-save').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-roas-save');
  const status   = document.getElementById('roas-form-status');
  const subjectId = document.getElementById('roas-form-subject').value;
  const platform  = document.getElementById('roas-form-platform').value;
  const spendUsd  = document.getElementById('roas-form-spend').value;
  const periodStart = document.getElementById('roas-form-start').value;
  const periodEnd   = document.getElementById('roas-form-end').value;
  const notes       = document.getElementById('roas-form-notes').value;

  if (!subjectId || !spendUsd || !periodStart || !periodEnd) {
    status.style.color = '#f87171';
    status.textContent = 'יש למלא נישה, סכום ותאריכים';
    return;
  }

  btn.disabled = true;
  status.textContent = 'שומר...';
  status.style.color = 'var(--on-surface-var)';

  try {
    await api('/api/analytics/spend', {
      method: 'POST',
      body: { subjectId, platform, spendUsd, periodStart, periodEnd, notes },
    });
    status.style.color = '#16a34a';
    status.textContent = '✓ נשמר';
    document.getElementById('roas-form-spend').value = '';
    document.getElementById('roas-form-notes').value = '';
    await loadRoas();
  } catch (err) {
    status.style.color = '#f87171';
    status.textContent = `✗ ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

async function loadRoas() {
  const grid    = document.getElementById('analytics-roas-grid');
  const records = document.getElementById('analytics-roas-records');
  if (!grid) return;

  try {
    const data   = await api('/api/analytics/roas');
    const niches = (data.niches || []).filter(n => parseFloat(n.total_spend) > 0 || parseFloat(n.total_commission) > 0);
    const recs   = data.records || [];

    if (!niches.length) {
      grid.innerHTML = '<div style="padding:20px;text-align:center;color:var(--on-surface-var);grid-column:1/-1;">אין הוצאות פרסום מוגדרות. לחץ "הוסף הוצאה" להזנה ידנית.</div>';
    } else {
      grid.innerHTML = niches.map(n => {
        const spend      = parseFloat(n.total_spend || 0);
        const commission = parseFloat(n.total_commission || 0);
        const roas       = n.roas != null ? parseFloat(n.roas) : null;
        const color      = n.color || '#702ae1';

        let roasColor = '#f59e0b';
        if (roas != null) roasColor = roas >= 1 ? '#16a34a' : '#ef4444';

        return `<div class="dashboard-subject-card" style="border-top:3px solid ${escHtml(color)};">
          <div style="font-size:15px;font-weight:800;margin-bottom:12px;">${escHtml(n.name)}</div>
          <div class="dashboard-subject-kpi" style="grid-template-columns:1fr 1fr;gap:8px;">
            <div class="dashboard-kpi-item">
              <div class="dashboard-kpi-label">הוצאה ($)</div>
              <div class="dashboard-kpi-val" style="color:#ef4444;">$${spend.toFixed(2)}</div>
            </div>
            <div class="dashboard-kpi-item">
              <div class="dashboard-kpi-label">עמלה ($)</div>
              <div class="dashboard-kpi-val" style="color:#16a34a;">$${commission.toFixed(2)}</div>
            </div>
          </div>
          <div style="margin-top:12px;text-align:center;">
            <div style="font-size:11px;color:var(--on-surface-var);margin-bottom:2px;">ROAS</div>
            <div style="font-size:28px;font-weight:900;color:${roasColor};">
              ${roas != null ? roas.toFixed(2) + 'x' : '—'}
            </div>
            ${roas != null ? `<div style="font-size:10px;color:var(--on-surface-var);">${roas >= 1 ? 'רווחי ✓' : 'הפסד ✗'}</div>` : ''}
          </div>
        </div>`;
      }).join('');
    }

    if (!recs.length) {
      records.innerHTML = '';
      return;
    }

    records.innerHTML = `
      <div style="margin-top:16px;">
        <div style="font-size:13px;font-weight:700;color:var(--on-surface);margin-bottom:8px;">רשומות הוצאות</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>נישה</th>
                <th>פלטפורמה</th>
                <th>סכום</th>
                <th>מתאריך</th>
                <th>עד תאריך</th>
                <th>הערות</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${recs.map(r => `<tr>
                <td>
                  <span style="display:inline-flex;align-items:center;gap:5px;">
                    <span style="width:8px;height:8px;border-radius:50%;background:${escHtml(r.subject_color||'#702ae1')};flex-shrink:0;"></span>
                    ${escHtml(r.subject_name)}
                  </span>
                </td>
                <td style="font-size:12px;">${escHtml(r.platform)}</td>
                <td style="color:#ef4444;font-weight:700;">$${parseFloat(r.spend_usd).toFixed(2)}</td>
                <td style="font-size:12px;">${fmtDate(r.period_start)}</td>
                <td style="font-size:12px;">${fmtDate(r.period_end)}</td>
                <td style="font-size:12px;color:var(--on-surface-var);">${escHtml(r.notes || '—')}</td>
                <td>
                  <button class="icon-btn" title="מחק" onclick="deleteSpend('${escHtml(r.id)}')">
                    <span class="material-symbols-outlined" style="font-size:16px;color:#f87171;">delete</span>
                  </button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch (err) {
    grid.innerHTML = `<div style="padding:20px;color:#f87171;grid-column:1/-1;">שגיאה: ${escHtml(err.message)}</div>`;
  }
}

async function deleteSpend(id) {
  if (!confirm('למחוק רשומה זו?')) return;
  try {
    await api(`/api/analytics/spend/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadRoas();
  } catch (err) {
    alert(`שגיאה: ${err.message}`);
  }
}

// ── Analytics: Insights (Profit Analysis) ────────────────────────────────────

async function loadInsights() {
  const el = document.getElementById('analytics-insights-content');
  if (!el) return;
  el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--on-surface-var);">טוען...</div>';

  try {
    const data   = await api('/api/analytics/insights');
    const niches = (data.niches || []).filter(n => parseInt(n.total_clicks, 10) > 0 || parseFloat(n.real_commission) > 0);
    const totals = data.totals || {};

    const hasRealData = parseFloat(totals.real_commission) > 0;

    // ── Global assumption-vs-reality banner ───────────────────────────────────
    const avgRealConv  = totals.real_orders > 0 && totals.total_clicks > 0
      ? (totals.real_orders / totals.total_clicks * 100)
      : null;
    const avgRealComm  = hasRealData
      ? (niches.filter(n => n.real_commission_rate).reduce((s, n) => s + parseFloat(n.real_commission_rate || 0), 0) /
         Math.max(1, niches.filter(n => n.real_commission_rate).length) * 100)
      : null;
    const overallRpc   = totals.total_clicks > 0 && hasRealData
      ? totals.real_commission / totals.total_clicks
      : null;
    const modelAccuracy = totals.est_default > 0 && hasRealData
      ? (totals.real_commission / totals.est_default * 100)
      : null;

    function diffBadge(assumed, real, unit = '%', higherIsBetter = true) {
      if (real == null) return '<span style="color:var(--on-surface-var);font-size:11px;">אין נתונים</span>';
      const diff    = real - assumed;
      const pct     = Math.abs(diff / assumed * 100).toFixed(0);
      const up      = higherIsBetter ? diff > 0 : diff < 0;
      const color   = up ? '#16a34a' : '#ef4444';
      const arrow   = diff > 0 ? '↑' : '↓';
      return `<span style="color:${color};font-weight:700;font-size:13px;">${arrow} ${pct}% ${diff > 0 ? 'מעל ההנחה' : 'מתחת להנחה'}</span>`;
    }

    const globalCards = [
      {
        icon: 'conversion_path', label: 'שיעור המרה ממוצע',
        assumed: '2.0%', real: avgRealConv != null ? `${avgRealConv.toFixed(2)}%` : null,
        badge: diffBadge(2, avgRealConv),
        hint: 'אחוז הקליקים שהפכו להזמנה בפועל',
      },
      {
        icon: 'percent', label: 'עמלת AliExpress ממוצעת',
        assumed: '8.0%', real: avgRealComm != null ? `${avgRealComm.toFixed(1)}%` : null,
        badge: diffBadge(8, avgRealComm),
        hint: 'ממוצע אחוז העמלה מהזמנות שהתקבלו',
      },
      {
        icon: 'ads_click', label: 'הכנסה לקליק',
        assumed: '—', real: overallRpc != null ? `$${overallRpc.toFixed(4)}` : null,
        badge: overallRpc != null ? `<span style="color:#16a34a;font-weight:700;">$${(overallRpc * 1000).toFixed(2)} לאלף קליקים</span>` : '',
        hint: 'כמה $ מרווח בפועל על כל קליק',
      },
      {
        icon: 'target', label: 'דיוק המודל',
        assumed: '100%', real: modelAccuracy != null ? `${modelAccuracy.toFixed(0)}%` : null,
        badge: modelAccuracy != null ? diffBadge(100, modelAccuracy, '%', true) : '<span style="color:var(--on-surface-var);font-size:11px;">חסר מחיר מוצר</span>',
        hint: 'יחס עמלה אמיתית לעמלה משוערת בהנחות ברירת מחדל',
      },
    ];

    let html = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-bottom:24px;">
        ${globalCards.map(c => `
          <div class="card an-kpi-card" style="flex-direction:column;align-items:flex-start;gap:10px;padding:18px 20px;">
            <div style="display:flex;align-items:center;gap:8px;width:100%;">
              <span class="material-symbols-outlined" style="font-size:20px;color:#702ae1;">${c.icon}</span>
              <span style="font-size:12px;color:var(--on-surface-var);font-weight:600;">${c.label}</span>
            </div>
            <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;">
              <span style="font-size:11px;color:var(--on-surface-var);">הנחה: <s>${c.assumed}</s></span>
              ${c.real != null ? `<span style="font-size:22px;font-weight:900;color:var(--on-surface);">${c.real}</span>` : '<span style="font-size:15px;color:var(--on-surface-var);">אין נתונים</span>'}
            </div>
            <div>${c.badge}</div>
            <div style="font-size:11px;color:var(--on-surface-var);border-top:1px solid rgba(255,255,255,0.06);padding-top:8px;width:100%;">${c.hint}</div>
          </div>`).join('')}
      </div>`;

    // ── No real data notice ────────────────────────────────────────────────────
    if (!hasRealData) {
      html += `
        <div class="card" style="padding:32px;text-align:center;border:1px dashed rgba(112,42,225,0.3);">
          <div style="font-size:36px;margin-bottom:12px;">📊</div>
          <div style="font-weight:700;margin-bottom:8px;">אין עדיין נתוני הזמנות אמיתיות</div>
          <div style="font-size:13px;color:var(--on-surface-var);">לחץ "עדכן עמלות" כדי למשוך הזמנות מ-AliExpress — לאחר מכן התובנות יתמלאו אוטומטית.</div>
        </div>`;
      el.innerHTML = html;
      return;
    }

    // ── Per-niche breakdown table ─────────────────────────────────────────────
    const nicheRows = niches.map(n => {
      const color      = n.color || '#702ae1';
      const realConv   = n.real_conversion_rate != null ? parseFloat(n.real_conversion_rate) : null;
      const realComm   = n.real_commission_rate  != null ? parseFloat(n.real_commission_rate)  : null;
      const rpc        = n.revenue_per_click      != null ? parseFloat(n.revenue_per_click)      : null;
      const clicks     = parseInt(n.total_clicks   || 0, 10);
      const commission = parseFloat(n.real_commission || 0);
      const orders     = parseInt(n.real_orders || 0, 10);

      const convCell = realConv != null
        ? `<span style="font-weight:700;">${(realConv * 100).toFixed(2)}%</span>
           <span style="font-size:10px;color:${realConv > 0.02 ? '#16a34a' : '#ef4444'};margin-right:4px;">${realConv > 0.02 ? '↑' : '↓'} ℅ הנחה 2%</span>`
        : '<span style="color:var(--on-surface-var);">—</span>';

      const commCell = realComm != null
        ? `<span style="font-weight:700;color:${realComm > 0.08 ? '#16a34a' : '#ef4444'};">${(realComm * 100).toFixed(1)}%</span>
           <span style="font-size:10px;color:var(--on-surface-var);">℅ הנחה 8%</span>`
        : '<span style="color:var(--on-surface-var);">—</span>';

      const rpcCell = rpc != null
        ? `<span style="font-weight:700;color:#16a34a;">$${rpc.toFixed(4)}</span>
           <small style="color:var(--on-surface-var);display:block;font-size:10px;">$${(rpc * 1000).toFixed(2)} / 1K קליקים</small>`
        : '<span style="color:var(--on-surface-var);">—</span>';

      // Projection: clicks * real rpc * 30-day extrapolation hint
      const projMonthly = rpc != null && clicks > 0
        ? `<span style="font-size:11px;color:var(--on-surface-var);">+50% קליקים → +$${(clicks * 0.5 * rpc).toFixed(2)}</span>`
        : '—';

      return `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
          <td style="padding:12px 8px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="width:3px;height:36px;border-radius:2px;background:${color};flex-shrink:0;"></div>
              <div>
                <div style="font-weight:700;font-size:13px;">${escHtml(n.name)}</div>
                <div style="font-size:11px;color:var(--on-surface-var);">${orders} הזמנות · ${clicks.toLocaleString()} קליקים</div>
              </div>
            </div>
          </td>
          <td style="padding:12px 8px;">${convCell}</td>
          <td style="padding:12px 8px;">${commCell}</td>
          <td style="padding:12px 8px;">${rpcCell}</td>
          <td style="padding:12px 8px;font-weight:900;font-size:16px;color:#16a34a;">$${commission.toFixed(2)}</td>
          <td style="padding:12px 8px;font-size:12px;color:var(--on-surface-var);">${projMonthly}</td>
        </tr>`;
    }).join('');

    html += `
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:24px;">
        <div style="padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:8px;">
          <span class="material-symbols-outlined" style="font-size:18px;color:#702ae1;">leaderboard</span>
          <span style="font-weight:700;">ביצועי נישות — הנחות מול מציאות</span>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:2px solid rgba(255,255,255,0.08);">
                <th style="padding:10px 8px;text-align:right;color:var(--on-surface-var);font-weight:600;">נישה</th>
                <th style="padding:10px 8px;text-align:right;color:var(--on-surface-var);font-weight:600;">המרה בפועל <small style="font-weight:400;">(הנחה 2%)</small></th>
                <th style="padding:10px 8px;text-align:right;color:var(--on-surface-var);font-weight:600;">עמלה בפועל <small style="font-weight:400;">(הנחה 8%)</small></th>
                <th style="padding:10px 8px;text-align:right;color:var(--on-surface-var);font-weight:600;">$/קליק</th>
                <th style="padding:10px 8px;text-align:right;color:var(--on-surface-var);font-weight:600;">עמלה כוללת</th>
                <th style="padding:10px 8px;text-align:right;color:var(--on-surface-var);font-weight:600;">פוטנציאל</th>
              </tr>
            </thead>
            <tbody>${nicheRows}</tbody>
          </table>
        </div>
      </div>`;

    // ── Goal calculator ───────────────────────────────────────────────────────
    if (overallRpc) {
      const clicksPer1k  = Math.ceil(1000  / overallRpc);
      const clicksPer5k  = Math.ceil(5000  / overallRpc);
      const clicksPer10k = Math.ceil(10000 / overallRpc);

      html += `
        <div class="card" style="margin-bottom:24px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
            <span class="material-symbols-outlined" style="font-size:18px;color:#702ae1;">calculate</span>
            <span style="font-weight:700;">מחשבון יעד רווח</span>
            <span style="font-size:11px;background:rgba(22,163,74,0.1);color:#16a34a;padding:2px 8px;border-radius:20px;">מבוסס נתונים אמיתיים</span>
          </div>
          <div style="font-size:13px;color:var(--on-surface-var);margin-bottom:16px;">
            הכנסה לקליק: <strong style="color:var(--on-surface);">$${overallRpc.toFixed(4)}</strong> — כמה קליקים תצטרך כדי להגיע ליעד?
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px;">
            ${[
              { target: '$1,000', clicks: clicksPer1k },
              { target: '$5,000', clicks: clicksPer5k },
              { target: '$10,000', clicks: clicksPer10k },
            ].map(g => `
              <div style="background:var(--surface-1);border-radius:12px;padding:16px;text-align:center;">
                <div style="font-size:22px;font-weight:900;color:#702ae1;margin-bottom:4px;">${g.target}</div>
                <div style="font-size:12px;color:var(--on-surface-var);margin-bottom:8px;">יעד חודשי</div>
                <div style="font-size:28px;font-weight:900;">${g.clicks.toLocaleString()}</div>
                <div style="font-size:11px;color:var(--on-surface-var);">קליקים נדרשים</div>
              </div>`).join('')}
          </div>
          <div style="font-size:12px;color:var(--on-surface-var);border-top:1px solid rgba(255,255,255,0.06);padding-top:12px;">
            💡 כדי להגיע ל-$1,000/חודש תצטרך בממוצע <strong>${Math.ceil(clicksPer1k / 30).toLocaleString()} קליקים ביום</strong> —
            כלומר בערך ${Math.ceil(clicksPer1k / 30 / (totals.sent_products || 1)).toFixed(0)} קליקים לפוסט אם שולחים ${totals.sent_products || '?'} פוסטים פעילים.
          </div>
        </div>`;
    }

    // ── What-if levers ────────────────────────────────────────────────────────
    const topNiches = niches.filter(n => parseFloat(n.revenue_per_click) > 0).slice(0, 3);
    if (topNiches.length) {
      html += `
        <div class="card">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
            <span class="material-symbols-outlined" style="font-size:18px;color:#702ae1;">tune</span>
            <span style="font-weight:700;">מנופי צמיחה — מה אם...</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;">
            ${topNiches.map(n => {
              const rpc    = parseFloat(n.revenue_per_click);
              const clicks = parseInt(n.total_clicks, 10);
              const color  = n.color || '#702ae1';
              return `
                <div style="background:var(--surface-1);border-radius:12px;padding:16px;">
                  <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;">
                    <div style="width:10px;height:10px;border-radius:50%;background:${color};"></div>
                    <strong style="font-size:13px;">${escHtml(n.name)}</strong>
                  </div>
                  <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
                    <div style="display:flex;justify-content:space-between;padding:6px 10px;background:rgba(22,163,74,0.06);border-radius:8px;">
                      <span style="color:var(--on-surface-var);">+50% קליקים</span>
                      <span style="color:#16a34a;font-weight:700;">+$${(clicks * 0.5 * rpc).toFixed(2)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:6px 10px;background:rgba(22,163,74,0.06);border-radius:8px;">
                      <span style="color:var(--on-surface-var);">+100% קליקים</span>
                      <span style="color:#16a34a;font-weight:700;">+$${(clicks * rpc).toFixed(2)}</span>
                    </div>
                    <div style="font-size:11px;color:var(--on-surface-var);padding-top:4px;">
                      בסיס: ${clicks.toLocaleString()} קליקים · $${rpc.toFixed(4)}/קליק
                    </div>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }

    el.innerHTML = html;

    // Append suggested products after main content
    loadSuggestedProducts(el);
  } catch (err) {
    document.getElementById('analytics-insights-content').innerHTML =
      `<div style="padding:20px;color:#f87171;">שגיאה: ${escHtml(err.message)}</div>`;
  }
}

async function loadSuggestedProducts(container) {
  try {
    const data     = await api('/api/analytics/suggested-products');
    const products = data.products || [];
    if (!products.length) return;

    const rows = products.map((p, i) => {
      const comm    = parseFloat(p.attributed_commission || 0);
      const cps     = parseFloat(p.commission_per_send   || 0);
      const sends   = parseInt(p.send_count || 1, 10);
      const color   = p.subject_color || '#702ae1';

      // Compute days since last sent
      let daysAgo = '—';
      if (p.sent_at) {
        const ms = Date.now() - new Date(p.sent_at).getTime();
        daysAgo  = Math.floor(ms / 86400000);
      }
      const stale    = typeof daysAgo === 'number' && daysAgo > 14;
      const staleTag = stale
        ? `<span style="font-size:10px;background:rgba(245,158,11,0.15);color:#f59e0b;padding:1px 6px;border-radius:10px;margin-right:4px;">לא פורסם ${daysAgo} ימים</span>`
        : `<span style="font-size:10px;color:var(--on-surface-var);">${daysAgo} ימים</span>`;

      return `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.04);">
          <div style="font-size:18px;font-weight:900;color:var(--on-surface-var);width:24px;text-align:center;flex-shrink:0;">${i + 1}</div>
          ${p.image ? `<img src="${escHtml(p.image)}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;flex-shrink:0;" loading="lazy" />` : `<div style="width:44px;height:44px;border-radius:8px;background:rgba(112,42,225,0.08);flex-shrink:0;"></div>`}
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(p.text || '')}">${escHtml(p.text || '—')}</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:3px;flex-wrap:wrap;">
              <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;">
                <span style="width:7px;height:7px;border-radius:50%;background:${color};"></span>
                ${escHtml(p.subject_name || '—')}
              </span>
              <span style="font-size:11px;color:var(--on-surface-var);">${(p.clicks || 0).toLocaleString()} קליקים · ${sends} שליחות</span>
              ${staleTag}
            </div>
          </div>
          <div style="text-align:left;flex-shrink:0;">
            <div style="font-size:18px;font-weight:900;color:#16a34a;">$${cps.toFixed(2)}</div>
            <div style="font-size:10px;color:var(--on-surface-var);">לשליחה</div>
          </div>
        </div>`;
    }).join('');

    const section = document.createElement('div');
    section.className = 'card';
    section.style.marginTop = '24px';
    section.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span class="material-symbols-outlined" style="font-size:18px;color:#702ae1;">recommend</span>
        <span style="font-weight:700;">המלצות לפרסום — מוצרים שכדאי לפרסם שוב</span>
        <span style="font-size:11px;background:rgba(22,163,74,0.12);color:#16a34a;padding:2px 8px;border-radius:20px;">נתונים אמיתיים</span>
      </div>
      <div style="font-size:11px;color:var(--on-surface-var);margin-bottom:14px;">
        מדורגים לפי עמלה מיוחסת לשליחה — המוצרים שהרוויחו הכי הרבה ביחס למספר הפעמים שפורסמו
      </div>
      <div>${rows}</div>`;
    container.appendChild(section);
  } catch (_) {
    // suggestions are additive — fail silently
  }
}

// ── Analytics: Sales Dashboard ────────────────────────────────────────────────

async function loadJoinLinkStats() {
  const el = document.getElementById('analytics-join-links-content');
  if (!el) return;
  el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--on-surface-var);">טוען...</div>';

  try {
    const data   = await api('/api/analytics/join-link-stats');
    const groups = data.groups || [];

    if (!groups.length) {
      el.innerHTML = `<div class="card" style="padding:40px;text-align:center;">
        <div style="font-size:36px;margin-bottom:12px;">👥</div>
        <div style="font-weight:700;margin-bottom:8px;">אין קבוצות WhatsApp מוגדרות</div>
        <div style="font-size:13px;color:var(--on-surface-var);">הוסף קבוצות בהגדרות הנישה</div>
      </div>`;
      return;
    }

    // ── Sync button header ────────────────────────────────────────────────────
    let html = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-weight:700;font-size:16px;">קליקים על קישורי הצטרפות</div>
          <div style="font-size:12px;color:var(--on-surface-var);">מעקב יומי דרך spoo.me — לחץ "עדכן היום" לקחת צילום</div>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-sync-join-clicks">
          <span class="material-symbols-outlined" style="font-size:14px;">update</span>עדכן היום
        </button>
      </div>`;

    // ── One card per group ────────────────────────────────────────────────────
    for (const g of groups) {
      const color   = g.subject_color || '#702ae1';
      const days    = g.days || [];
      const today   = days[0];
      const totalToday = today ? today.total_clicks : null;

      // last 14 days of daily_clicks
      const recentDays = days.slice(0, 14).reverse();
      const maxDaily   = Math.max(...recentDays.map(d => d.daily_clicks || 0), 1);

      const bars = recentDays.map(d => {
        const dc    = d.daily_clicks != null ? Math.max(d.daily_clicks, 0) : 0;
        const h     = Math.round(dc / maxDaily * 40);
        const dateStr = new Date(d.date).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
        return `
          <div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;">
            <span style="font-size:9px;color:var(--on-surface-var);">${dc > 0 ? dc : ''}</span>
            <div style="width:100%;height:40px;display:flex;align-items:flex-end;">
              <div style="width:100%;height:${h}px;background:${color};border-radius:2px 2px 0 0;min-height:${dc>0?2:0}px;opacity:0.85;"></div>
            </div>
            <span style="font-size:9px;color:var(--on-surface-var);white-space:nowrap;">${dateStr}</span>
          </div>`;
      }).join('');

      // Daily table (last 10 days)
      const tableRows = days.slice(0, 10).map(d => {
        const dc = d.daily_clicks != null ? Math.max(d.daily_clicks, 0) : '—';
        const dateStr = new Date(d.date).toLocaleDateString('he-IL', { weekday: 'short', day: '2-digit', month: '2-digit' });
        return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
          <td style="padding:7px 12px;font-size:13px;">${dateStr}</td>
          <td style="padding:7px 12px;text-align:center;font-weight:700;font-size:15px;color:${color};">${typeof dc === 'number' ? dc.toLocaleString() : dc}</td>
          <td style="padding:7px 12px;text-align:center;font-size:12px;color:var(--on-surface-var);">${d.total_clicks.toLocaleString()} סה"כ</td>
        </tr>`;
      }).join('');

      html += `
        <div class="card" style="margin-bottom:16px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>
              <span style="font-weight:700;font-size:15px;">${escHtml(g.group_name)}</span>
              <span style="font-size:12px;color:var(--on-surface-var);">${escHtml(g.subject_name)}</span>
            </div>
            ${totalToday != null
              ? `<div style="font-size:24px;font-weight:900;color:${color};">${totalToday.toLocaleString()} <span style="font-size:12px;font-weight:400;color:var(--on-surface-var);">קליקים כולל</span></div>`
              : `<span style="font-size:12px;color:var(--on-surface-var);">לחץ "עדכן היום" להתחיל מעקב</span>`}
          </div>
          ${recentDays.length ? `
            <div style="display:flex;gap:2px;align-items:flex-end;margin-bottom:16px;padding:0 4px;">
              ${bars}
            </div>` : ''}
          ${tableRows ? `
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;">
                <thead>
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                    <th style="padding:6px 12px;text-align:right;font-size:11px;color:var(--on-surface-var);font-weight:600;">תאריך</th>
                    <th style="padding:6px 12px;text-align:center;font-size:11px;color:var(--on-surface-var);font-weight:600;">קליקים היום</th>
                    <th style="padding:6px 12px;text-align:center;font-size:11px;color:var(--on-surface-var);font-weight:600;">סה"כ מצטבר</th>
                  </tr>
                </thead>
                <tbody>${tableRows}</tbody>
              </table>
            </div>` : '<div style="font-size:13px;color:var(--on-surface-var);padding:8px 0;">לחץ "עדכן היום" כדי להתחיל לצבור נתונים יומיים</div>'}
        </div>`;
    }

    el.innerHTML = html;

    document.getElementById('btn-sync-join-clicks').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">update</span>מעדכן...';
      try {
        const r = await api('/api/analytics/sync-join-clicks', { method: 'POST', body: {} });
        await loadJoinLinkStats();
      } catch (err) {
        alert('שגיאה: ' + err.message);
        btn.disabled = false;
      }
    });
  } catch (err) {
    el.innerHTML = `<div style="padding:20px;color:#f87171;">שגיאה: ${escHtml(err.message)}</div>`;
  }
}

async function sendProductById(productId) {
  if (!productId) return;
  if (!confirm('לשלוח את המוצר הזה עכשיו לכל הקבוצות של הנישה?')) return;
  try {
    const res = await api('/api/send', { method: 'POST', body: JSON.stringify({ productId }), headers: { 'Content-Type': 'application/json' } });
    alert(res.message || 'המוצר נשלח בהצלחה ✓');
    loadSalesDashboard();
  } catch (err) {
    alert('שגיאה בשליחה: ' + err.message);
  }
}

async function loadSalesDashboard() {
  const el = document.getElementById('analytics-sales-content');
  if (!el) return;
  el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--on-surface-var);">טוען...</div>';

  try {
    const [profData, mktData] = await Promise.all([
      api('/api/analytics/product-profitability'),
      api('/api/analytics/marketing-insights'),
    ]);

    const products  = profData.products  || [];
    const buckets   = mktData.priceBuckets  || [];
    const hot       = mktData.hotVsRegular   || [];
    const buyers    = mktData.buyerTypes     || [];
    const momentum  = mktData.momentum       || {};

    if (!products.length) {
      el.innerHTML = `<div class="card" style="padding:40px;text-align:center;">
        <div style="font-size:36px;margin-bottom:12px;">📦</div>
        <div style="font-weight:700;margin-bottom:8px;">אין עדיין נתוני מכירות</div>
        <div style="font-size:13px;color:var(--on-surface-var);">לחץ "עדכן עמלות" כדי למשוך הזמנות מ-AliExpress</div>
      </div>`;
      return;
    }

    let html = '';

    // ── Momentum strip ────────────────────────────────────────────────────────
    const last7    = parseInt(momentum.last_7  || 0, 10);
    const prev7    = parseInt(momentum.prev_7  || 0, 10);
    const commL7   = parseFloat(momentum.comm_last_7 || 0);
    const commP7   = parseFloat(momentum.comm_prev_7 || 0);
    const momPct   = prev7 > 0 ? ((last7 - prev7) / prev7 * 100).toFixed(0) : null;
    const momColor = momPct != null ? (parseFloat(momPct) >= 0 ? '#16a34a' : '#ef4444') : '#702ae1';
    const momArrow = momPct != null ? (parseFloat(momPct) >= 0 ? '↑' : '↓') : '';

    html += `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:24px;">
        <div class="card an-kpi-card" style="flex-direction:column;align-items:flex-start;gap:6px;padding:16px;">
          <span style="font-size:11px;color:var(--on-surface-var);">7 ימים אחרונים</span>
          <div style="font-size:28px;font-weight:900;color:#702ae1;">${last7}</div>
          <div style="font-size:12px;color:var(--on-surface-var);">הזמנות</div>
          ${momPct != null ? `<div style="font-size:13px;font-weight:700;color:${momColor};">${momArrow} ${Math.abs(momPct)}% vs שבוע קודם</div>` : ''}
        </div>
        <div class="card an-kpi-card" style="flex-direction:column;align-items:flex-start;gap:6px;padding:16px;">
          <span style="font-size:11px;color:var(--on-surface-var);">עמלה 7 ימים</span>
          <div style="font-size:28px;font-weight:900;color:#16a34a;">$${commL7.toFixed(2)}</div>
          <div style="font-size:12px;color:var(--on-surface-var);">vs $${commP7.toFixed(2)} שבוע קודם</div>
        </div>
        <div class="card an-kpi-card" style="flex-direction:column;align-items:flex-start;gap:6px;padding:16px;">
          <span style="font-size:11px;color:var(--on-surface-var);">מוצרים שמכרו</span>
          <div style="font-size:28px;font-weight:900;color:#702ae1;">${products.length}</div>
          <div style="font-size:12px;color:var(--on-surface-var);">פריטים ייחודיים</div>
        </div>
        <div class="card an-kpi-card" style="flex-direction:column;align-items:flex-start;gap:6px;padding:16px;">
          <span style="font-size:11px;color:var(--on-surface-var);">מוצרים מקושרים</span>
          <div style="font-size:28px;font-weight:900;color:#702ae1;">${products.filter(p => p.local_product_id).length}</div>
          <div style="font-size:12px;color:var(--on-surface-var);">נמצאו בקטלוג שלך</div>
        </div>
      </div>`;

    // ── Product profitability table ───────────────────────────────────────────
    const prodRows = products.map((p, i) => {
      const comm     = parseFloat(p.total_commission || 0);
      const rev      = parseFloat(p.total_revenue    || 0);
      const orders   = parseInt(p.total_orders       || 0, 10);
      const newB     = parseInt(p.new_buyers          || 0, 10);
      const color    = p.subject_color || '#702ae1';
      const isHot    = p.is_hot;
      const hasLocal = !!p.local_product_id;
      const daysStale = p.local_sent_at
        ? Math.floor((Date.now() - new Date(p.local_sent_at)) / 86400000)
        : null;
      const rankColor = i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'var(--on-surface-var)';

      const actionBtn = hasLocal && daysStale != null && daysStale > 7
        ? `<button class="btn btn-primary btn-sm" style="font-size:11px;padding:4px 10px;white-space:nowrap;"
             onclick="sendProductById('${escHtml(p.local_product_id)}')">
             <span class="material-symbols-outlined" style="font-size:13px;">send</span>שלח שוב
           </button>`
        : hasLocal ? `<span style="font-size:11px;color:#16a34a;">✓ נשלח לאחרונה</span>`
          : `<span style="font-size:11px;color:var(--on-surface-var);">לא בקטלוג</span>`;

      return `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
          <td style="padding:12px 8px;text-align:center;font-weight:700;color:${rankColor};">${i + 1}</td>
          <td style="padding:12px 8px;">
            <div style="display:flex;align-items:center;gap:10px;">
              ${p.product_image ? `<img src="${escHtml(p.product_image)}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;flex-shrink:0;" loading="lazy" />` : `<div style="width:48px;height:48px;border-radius:8px;background:rgba(112,42,225,0.08);flex-shrink:0;"></div>`}
              <div style="min-width:0;">
                <div style="font-size:12px;font-weight:600;line-height:1.4;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(p.product_title || '')}">${escHtml(p.product_title || p.local_text || '—')}</div>
                <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;">
                  ${isHot ? '<span style="font-size:10px;background:rgba(239,68,68,0.1);color:#ef4444;padding:1px 6px;border-radius:10px;">🔥 מוצר חם</span>' : ''}
                  ${hasLocal ? '<span style="font-size:10px;background:rgba(22,163,74,0.1);color:#16a34a;padding:1px 6px;border-radius:10px;">✓ בקטלוג</span>' : '<span style="font-size:10px;background:rgba(255,255,255,0.06);color:var(--on-surface-var);padding:1px 6px;border-radius:10px;">לא בקטלוג</span>'}
                  ${newB > 0 ? `<span style="font-size:10px;background:rgba(59,130,246,0.1);color:#3b82f6;padding:1px 6px;border-radius:10px;">${newB} קונים חדשים</span>` : ''}
                </div>
              </div>
            </div>
          </td>
          <td style="padding:12px 8px;">
            <span style="display:inline-flex;align-items:center;gap:5px;">
              <span style="width:8px;height:8px;border-radius:50%;background:${color};"></span>
              <span style="font-size:12px;">${escHtml(p.subject_name || '—')}</span>
            </span>
          </td>
          <td style="padding:12px 8px;text-align:center;font-weight:700;font-size:18px;">${orders}</td>
          <td style="padding:12px 8px;text-align:center;font-size:13px;">$${rev.toFixed(2)}</td>
          <td style="padding:12px 8px;text-align:center;font-weight:900;font-size:18px;color:#16a34a;">$${comm.toFixed(2)}</td>
          <td style="padding:12px 8px;text-align:center;">${actionBtn}</td>
        </tr>`;
    }).join('');

    html += `
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:24px;">
        <div style="padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:8px;">
          <span class="material-symbols-outlined" style="font-size:18px;color:#702ae1;">storefront</span>
          <span style="font-weight:700;font-size:15px;">מוצרים שמכרו בפועל</span>
          <span style="font-size:11px;background:rgba(22,163,74,0.12);color:#16a34a;padding:2px 8px;border-radius:20px;">נתונים אמיתיים מ-AliExpress</span>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:2px solid rgba(255,255,255,0.08);">
                <th style="padding:10px 8px;width:36px;"></th>
                <th style="padding:10px 8px;text-align:right;font-weight:600;color:var(--on-surface-var);">מוצר</th>
                <th style="padding:10px 8px;text-align:right;font-weight:600;color:var(--on-surface-var);">נישה</th>
                <th style="padding:10px 8px;text-align:center;font-weight:600;color:var(--on-surface-var);">הזמנות</th>
                <th style="padding:10px 8px;text-align:center;font-weight:600;color:var(--on-surface-var);">מחזור</th>
                <th style="padding:10px 8px;text-align:center;font-weight:600;color:var(--on-surface-var);">עמלה</th>
                <th style="padding:10px 8px;text-align:center;font-weight:600;color:var(--on-surface-var);">פעולה</th>
              </tr>
            </thead>
            <tbody>${prodRows}</tbody>
          </table>
        </div>
      </div>`;

    // ── Marketing analysis grid ───────────────────────────────────────────────
    // Price buckets
    const maxBucketComm = Math.max(...buckets.map(b => parseFloat(b.total_commission || 0)), 0.01);
    const bucketBars = buckets.map(b => {
      const comm  = parseFloat(b.total_commission || 0);
      const cnt   = parseInt(b.order_count || 0, 10);
      const width = Math.round(comm / maxBucketComm * 100);
      return `
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
            <span style="font-weight:600;">${escHtml(b.bucket)}</span>
            <span style="color:var(--on-surface-var);">${cnt} הזמנות · <span style="color:#16a34a;font-weight:700;">$${comm.toFixed(2)}</span></span>
          </div>
          <div style="height:8px;border-radius:4px;background:rgba(255,255,255,0.06);overflow:hidden;">
            <div style="height:100%;width:${width}%;background:linear-gradient(90deg,#702ae1,#16a34a);border-radius:4px;"></div>
          </div>
        </div>`;
    }).join('');

    // Hot vs regular
    const hotRow  = hot.find(r => r.is_hot)  || {};
    const regRow  = hot.find(r => !r.is_hot) || {};
    const hotOrd  = parseInt(hotRow.order_count || 0, 10);
    const regOrd  = parseInt(regRow.order_count || 0, 10);
    const totalOrd = hotOrd + regOrd || 1;

    // New vs returning buyers
    const newRow  = buyers.find(r => r.is_new)  || {};
    const retRow  = buyers.find(r => !r.is_new) || {};
    const newCnt  = parseInt(newRow.order_count || 0, 10);
    const retCnt  = parseInt(retRow.order_count || 0, 10);
    const totalB  = newCnt + retCnt || 1;

    html += `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">
        <div class="card">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
            <span class="material-symbols-outlined" style="font-size:18px;color:#702ae1;">price_change</span>
            <span style="font-weight:700;">טווח מחירים מנצח</span>
          </div>
          ${bucketBars || '<div style="color:var(--on-surface-var);font-size:13px;">אין נתונים</div>'}
          <div style="font-size:11px;color:var(--on-surface-var);margin-top:8px;">
            בחר מוצרים בטווח המחיר שמייצר הכי הרבה עמלה
          </div>
        </div>

        <div class="card">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
            <span class="material-symbols-outlined" style="font-size:18px;color:#ef4444;">local_fire_department</span>
            <span style="font-weight:700;">מוצרים חמים vs רגילים</span>
          </div>
          <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
              <span>🔥 מוצרים חמים</span>
              <span style="font-weight:700;color:#ef4444;">${hotOrd} הזמנות (${Math.round(hotOrd/totalOrd*100)}%)</span>
            </div>
            <div style="height:10px;border-radius:5px;background:rgba(255,255,255,0.06);">
              <div style="height:100%;width:${Math.round(hotOrd/totalOrd*100)}%;background:#ef4444;border-radius:5px;"></div>
            </div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
              <span>📦 מוצרים רגילים</span>
              <span style="font-weight:700;color:#702ae1;">${regOrd} הזמנות (${Math.round(regOrd/totalOrd*100)}%)</span>
            </div>
            <div style="height:10px;border-radius:5px;background:rgba(255,255,255,0.06);">
              <div style="height:100%;width:${Math.round(regOrd/totalOrd*100)}%;background:#702ae1;border-radius:5px;"></div>
            </div>
          </div>
          <div style="font-size:11px;color:var(--on-surface-var);margin-top:12px;">
            ${hotOrd > regOrd ? '✅ תעדף פרסום מוצרים חמים — הם ממירים טוב יותר' : '💡 המוצרים הרגילים שלך מצליחים — תמשיך לגוון'}
          </div>
        </div>

        <div class="card">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
            <span class="material-symbols-outlined" style="font-size:18px;color:#3b82f6;">group</span>
            <span style="font-weight:700;">סוגי קונים</span>
          </div>
          <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
              <span>🆕 קונים חדשים ב-AliExpress</span>
              <span style="font-weight:700;color:#3b82f6;">${newCnt} (${Math.round(newCnt/totalB*100)}%)</span>
            </div>
            <div style="height:10px;border-radius:5px;background:rgba(255,255,255,0.06);">
              <div style="height:100%;width:${Math.round(newCnt/totalB*100)}%;background:#3b82f6;border-radius:5px;"></div>
            </div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
              <span>🔄 קונים חוזרים</span>
              <span style="font-weight:700;color:#16a34a;">${retCnt} (${Math.round(retCnt/totalB*100)}%)</span>
            </div>
            <div style="height:10px;border-radius:5px;background:rgba(255,255,255,0.06);">
              <div style="height:100%;width:${Math.round(retCnt/totalB*100)}%;background:#16a34a;border-radius:5px;"></div>
            </div>
          </div>
          <div style="font-size:11px;color:var(--on-surface-var);margin-top:12px;">
            ${retCnt > newCnt ? '💪 הלקוחות שלך חוזרים לקנות — הם סומכים על הפלטפורמה' : '🌱 רוב הקונים הם חדשים — הפוטנציאל לצמיחה גבוה'}
          </div>
        </div>
      </div>`;

    el.innerHTML = html;
  } catch (err) {
    document.getElementById('analytics-sales-content').innerHTML =
      `<div style="padding:20px;color:#f87171;">שגיאה: ${escHtml(err.message)}</div>`;
  }
}

