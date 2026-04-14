import { api, escHtml, fmtDate }  from './utils.js';
import { init as initScheduleModal, resetCronBuilder } from './schedule-modal.js';

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
                    <div class="channel-icon-box" style="background:rgba(37,211,102,0.1);">💬</div>
                    <span style="font-weight:700;font-size:13px;">WhatsApp</span>
                  </div>
                  <div class="ios-toggle ${waEnabled ? 'active' : ''}" id="wa-toggle-${s.id}" onclick="this.classList.toggle('active')"></div>
                </div>
                <div class="channel-toggle-card">
                  <div class="channel-toggle-info">
                    <div class="channel-icon-box" style="background:rgba(66,103,178,0.1);">📘</div>
                    <span style="font-weight:700;font-size:13px;">Facebook</span>
                  </div>
                  <div class="ios-toggle ${fbEnabled ? 'active' : ''}" id="fb-toggle-${s.id}" onclick="this.classList.toggle('active')"></div>
                </div>
                <div class="channel-toggle-card">
                  <div class="channel-toggle-info">
                    <div class="channel-icon-box" style="background:rgba(193,53,132,0.1);">📸</div>
                    <span style="font-weight:700;font-size:13px;">Instagram</span>
                  </div>
                  <div class="ios-toggle ${igEnabled ? 'active' : ''}" id="ig-toggle-${s.id}" onclick="this.classList.toggle('active')"></div>
                </div>
              </div>

              <div class="niche-field-label">
                <span class="material-symbols-outlined">groups</span>
                הגדרות WhatsApp
              </div>
              <div class="form-grid" style="margin-bottom:16px;">
                <div class="form-group form-full">
                  <label class="form-label">Webhook URL ${s.macrodroidUrl ? '<span style="color:#16a34a;font-size:10px;">✓ מוגדר</span>' : '<span style="color:#dc2626;font-size:10px;">לא מוגדר</span>'}</label>
                  <input class="form-input" type="password" id="niche-wa-url-${s.id}" value="" placeholder="${s.macrodroidUrl ? 'השאר ריק לשמור ערך קיים' : 'הזן Webhook URL'}" dir="ltr" style="font-size:13px;" />
                </div>
              </div>

              <!-- WA Groups management -->
              <div style="margin-bottom:24px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                  <div style="font-size:12px;font-weight:600;color:var(--on-surface-var);">קבוצות WhatsApp</div>
                  <button class="btn btn-ghost btn-sm" onclick="showAddWaGroup('${s.id}')" style="font-size:11px;padding:4px 10px;">
                    <span class="material-symbols-outlined" style="font-size:13px;">add</span>הוסף קבוצה
                  </button>
                </div>
                <div id="wa-groups-list-${s.id}" style="display:flex;flex-direction:column;gap:6px;">
                  <div style="font-size:12px;color:var(--on-surface-var);">טוען קבוצות...</div>
                </div>
                <!-- Add group inline form -->
                <div id="add-wa-group-form-${s.id}" style="display:none;margin-top:12px;padding:12px;background:rgba(255,255,255,0.04);border-radius:10px;border:1px solid rgba(255,255,255,0.08);">
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

              <div class="niche-field-label" style="justify-content:space-between;">
                <span style="display:flex;align-items:center;gap:6px;">
                  <span class="material-symbols-outlined">thumb_up</span>
                  הגדרות Facebook
                </span>
                <div style="display:flex;gap:6px;">
                  <button class="btn btn-ghost btn-sm" onclick="checkNicheToken('${s.id}')" style="font-size:11px;padding:4px 12px;border-radius:20px;">
                    <span class="material-symbols-outlined" style="font-size:14px;">manage_search</span>
                    בדוק טוקן
                  </button>
                  <button class="btn btn-ghost btn-sm" onclick="openGenerateTokenModal('${s.id}')" style="font-size:11px;padding:4px 12px;border-radius:20px;background:rgba(112,42,225,0.08);color:#702ae1;">
                    <span class="material-symbols-outlined" style="font-size:14px;">key</span>
                    צור טוקן קבוע
                  </button>
                </div>
              </div>
              <div id="niche-token-info-${s.id}" style="margin-bottom:12px;font-size:12px;color:var(--on-surface-var);min-height:0;"></div>
              <div class="form-grid" style="margin-bottom:24px;">
                <div class="form-group">
                  <label class="form-label">Page ID</label>
                  <input class="form-input" id="niche-fb-page-${s.id}" value="${escHtml(s.facebookPageId||'')}" dir="ltr" style="font-size:13px;" />
                </div>
                <div class="form-group">
                  <label class="form-label">Access Token ${s.facebookToken ? '<span style="color:#16a34a;font-size:10px;">✓ מוגדר</span>' : '<span style="color:#dc2626;font-size:10px;">לא מוגדר</span>'}</label>
                  <input class="form-input" type="password" id="niche-fb-token-${s.id}" value="" placeholder="${s.facebookToken ? 'השאר ריק לשמור ערך קיים' : 'הזן Access Token'}" dir="ltr" style="font-size:13px;" />
                </div>
                <div class="form-group">
                  <label class="form-label">App ID ${s.facebookAppId ? '<span style="color:#16a34a;font-size:10px;">✓ מוגדר</span>' : '<span style="color:#dc2626;font-size:10px;">לא מוגדר</span>'}</label>
                  <input class="form-input" type="password" id="niche-fb-app-id-${s.id}" value="" placeholder="${s.facebookAppId ? 'השאר ריק לשמור ערך קיים' : 'הזן App ID'}" dir="ltr" style="font-size:13px;" />
                </div>
                <div class="form-group">
                  <label class="form-label">App Secret ${s.facebookAppSecret ? '<span style="color:#16a34a;font-size:10px;">✓ מוגדר</span>' : '<span style="color:#dc2626;font-size:10px;">לא מוגדר</span>'}</label>
                  <input class="form-input" type="password" id="niche-fb-app-secret-${s.id}" value="" placeholder="${s.facebookAppSecret ? 'השאר ריק לשמור ערך קיים' : 'הזן App Secret'}" dir="ltr" style="font-size:13px;" />
                </div>
              </div>

              <div class="niche-field-label">
                <span class="material-symbols-outlined">photo_camera</span>
                הגדרות Instagram
              </div>
              <div class="form-grid" style="margin-bottom:24px;">
                <div class="form-group form-full" style="grid-column:1/-1;">
                  <label class="form-label">Instagram Business Account ID ${s.instagramAccountId ? '<span style="color:#16a34a;font-size:10px;">✓ מוגדר</span>' : '<span style="color:#dc2626;font-size:10px;">לא מוגדר</span>'}</label>
                  <input class="form-input" type="password" id="niche-ig-account-${s.id}" value="" placeholder="${s.instagramAccountId ? 'השאר ריק לשמור ערך קיים' : '17841400000000000'}" dir="ltr" style="font-size:13px;" />
                  <div style="font-size:10px;color:var(--on-surface-var);margin-top:4px;">נמצא ב-Meta Graph API Explorer: GET /me/accounts → Instagram Business Account ID. משתמש באותו Access Token של Facebook.</div>
                </div>
              </div>

              <div class="niche-field-label">
                <span class="material-symbols-outlined">shopping_bag</span>
                הגדרות AliExpress
              </div>
              <div class="form-grid">
                <div class="form-group form-full" style="grid-column:1/-1;">
                  <label class="form-label">Tracking ID ${s.aliexpressTrackingId ? '<span style="color:#16a34a;font-size:10px;">✓ מוגדר</span>' : '<span style="color:#6b7280;font-size:10px;">ברירת מחדל</span>'}</label>
                  <input class="form-input" type="password" id="niche-ali-tracking-${s.id}" value="" placeholder="${s.aliexpressTrackingId ? 'השאר ריק לשמור ערך קיים' : 'הזן Tracking ID (ישתמש בברירת מחדל אם ריק)'}" dir="ltr" style="font-size:13px;" />
                  <div style="font-size:10px;color:var(--on-surface-var);margin-top:4px;">ה-Tracking ID ישמש בחיפוש מוצרי AliExpress עבור נישה זו. כל לינק שותפים שייווצר יהיה משויך ל-ID זה.</div>
                </div>
              </div>
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
    const isActive = !!(s.whatsappUrl || s.facebookPageId);
    return `
      <div class="niche-mini-card" onclick="selectSettingsSubject('${s.id}')">
        <div class="niche-mini-card-header">
          <div class="niche-mini-icon" style="background:${bg};">${icon}</div>
          <span class="niche-status-chip ${isActive ? 'active' : 'inactive'}">${isActive ? 'פעיל' : 'טרם הוגדר'}</span>
        </div>
        <div class="niche-mini-name">${escHtml(s.name)}</div>
        <div class="niche-mini-stat">${s.waGroupName ? `📋 ${escHtml(s.waGroupName)}` : 'קבוצת WA לא הוגדרה'}</div>
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
    const clicksCell = p.clicks == null
      ? '<span style="color:var(--label-4);font-size:11px;">—</span>'
      : `<span style="font-weight:600;color:var(--blue);">${p.clicks}</span>`;
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
        const clicksHtml = p.clicks != null
          ? `<span class="product-card-clicks">👁 ${p.clicks} קליקים</span>`
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
});

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
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:8px;border:1px solid rgba(255,255,255,0.07);">
      <div>
        <div style="font-size:13px;font-weight:600;">${escHtml(g.name)}</div>
        <div style="font-size:11px;color:var(--on-surface-var);direction:ltr;">${escHtml(g.waGroup)}${g.joinLink ? ' · קישור ✓' : ''}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="deleteWaGroup('${g.id}','${subjectId}')" style="color:#dc2626;padding:4px 8px;">
        <span class="material-symbols-outlined" style="font-size:14px;">delete</span>
      </button>
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
