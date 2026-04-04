// ── Login ─────────────────────────────────────────────────────────────────────
(function initLogin() {
  const loginPage = document.getElementById('login-page');
  if (!loginPage) return;

  // Skip login if already authenticated in this session
  if (sessionStorage.getItem('ah_auth') === '1') {
    loginPage.style.display = 'none';
    return;
  }

  const btnLogin = document.getElementById('btn-login');
  const passInput = document.getElementById('login-pass');

  function doLogin() {
    sessionStorage.setItem('ah_auth', '1');
    loginPage.style.animation = 'fadeOut 0.4s ease forwards';
    setTimeout(() => { loginPage.style.display = 'none'; }, 400);
  }

  btnLogin.addEventListener('click', doLogin);
  passInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('login-user').addEventListener('keydown', e => { if (e.key === 'Enter') passInput.focus(); });

  // Add fadeOut animation
  const style = document.createElement('style');
  style.textContent = '@keyframes fadeOut { to { opacity:0; transform:scale(1.02); } }';
  document.head.appendChild(style);
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

// ── Subjects ──────────────────────────────────────────────────────────────────
let _subjects = [];
let _currentSubject = ''; // empty = all subjects

async function loadSubjects() {
  try {
    const { subjects } = await api('/api/subjects');
    _subjects = subjects || [];
    populateSubjectSelects();
    renderSubjectsList();
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

      loadProducts();
    });
  });

  // Apply current accent
  const active = container.querySelector('.subject-item.active');
  if (active) setAccentColor(_currentSubject === '' ? null : active.dataset.color);
}

function populateSubjectSelects() {
  const options = _subjects.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`).join('');

  // Render the visual pill bar
  renderSubjectBar();

  // Schedules form
  const schedSel = document.getElementById('sched-subject');
  if (schedSel) schedSel.innerHTML = '<option value="">כל הנושאים</option>' + options;

  // Add-product form
  const newSubj = document.getElementById('new-subject');
  if (newSubj) newSubj.innerHTML = '<option value="">ללא נושא</option>' + options;
}

function renderSubjectsList() {
  const container = document.getElementById('subjects-list');
  if (!container) return;
  if (!_subjects.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:32px 20px;color:var(--on-surface-var);">
        <span class="material-symbols-outlined" style="font-size:36px;opacity:0.3;display:block;margin-bottom:8px;">category</span>
        <div style="font-size:13px;">אין נושאים מוגדרים עדיין.</div>
      </div>`;
    return;
  }
  container.innerHTML = _subjects.map((s, i) => {
    const color = getSubjectColor(i);
    return `
    <div class="subject-settings-item" id="subject-item-${s.id}">
      <span class="subject-settings-dot" style="background:${color};box-shadow:0 0 0 4px ${color}22;"></span>
      <div class="subject-settings-info">
        <div class="subject-settings-name">${escHtml(s.name)}</div>
        <div class="subject-settings-meta">
          ${s.whatsappUrl ? `💬 ${escHtml(s.whatsappUrl.slice(0,55))}…` : '💬 WhatsApp לא הוגדר'}
          &nbsp;·&nbsp;
          ${s.facebookPageId ? `📘 Page ${escHtml(s.facebookPageId)}` : '📘 Facebook לא הוגדר'}
        </div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="deleteSubject('${s.id}')">
        <span class="material-symbols-outlined" style="font-size:14px;">delete</span>
      </button>
    </div>`;
  }).join('');
}

window.deleteSubject = async (id) => {
  if (!confirm('למחוק נושא זה?')) return;
  try {
    await api(`/api/subjects/${id}`, { method: 'DELETE' });
    if (_currentSubject === id) {
      _currentSubject = '';
      const sel = document.getElementById('subject-select');
      if (sel) sel.value = '';
    }
    await loadSubjects();
    await loadProducts();
  } catch (err) {
    alert('שגיאה: ' + err.message);
  }
};

document.getElementById('btn-add-subject').addEventListener('click', async () => {
  const name = document.getElementById('subj-name').value.trim();
  const whatsappUrl = document.getElementById('subj-wa-url').value.trim();
  const facebookPageId = document.getElementById('subj-fb-page-id').value.trim();
  const facebookToken = document.getElementById('subj-fb-token').value.trim();
  const facebookAppId = document.getElementById('subj-fb-app-id').value.trim();
  const facebookAppSecret = document.getElementById('subj-fb-app-secret').value.trim();
  const result = document.getElementById('subject-form-result');

  if (!name) { result.style.color = '#d97706'; result.textContent = '⚠ שם נושא הוא שדה חובה'; return; }

  try {
    await api('/api/subjects', { method: 'POST', body: { name, whatsappUrl, facebookPageId, facebookToken, facebookAppId, facebookAppSecret } });
    result.style.color = '#16a34a';
    result.textContent = '✓ נושא נוסף בהצלחה';
    ['subj-name','subj-wa-url','subj-fb-page-id','subj-fb-token','subj-fb-app-id','subj-fb-app-secret'].forEach(id => {
      document.getElementById(id).value = '';
    });
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
    return `
    <tr draggable="true" data-row="${p.row_number}">
      <td><span class="drag-handle" title="גרור לסידור מחדש">⠿</span></td>
      <td>${p.image ? `<img class="img-thumb" src="${escHtml(p.image)}" onerror="this.style.display='none'" />` : '—'}</td>
      <td style="max-width:200px;word-break:break-word;">${escHtml(p.Text)}</td>
      <td><a href="${escHtml(p.Link)}" target="_blank" style="color:var(--blue);font-size:12px;" dir="ltr">🔗 קישור</a></td>
      <td>${escHtml(p.wa_group)}</td>
      <td>${p.sent ? `<span class="badge badge-sent">${fmtDate(p.sent)}</span>` : '<span class="badge badge-unsent">טרם נשלח</span>'}</td>
      <td>${p.facebook ? `<span class="badge badge-fb">${fmtDate(p.facebook)}</span>` : '—'}</td>
      <td>${clicksCell}</td>
      <td><button class="btn btn-sm ${p.sent ? 'btn-ghost' : 'btn-primary'}" onclick="sendProduct(${p.row_number}, this)" title="${p.sent ? 'שלח שוב' : 'שלח'}">▶ שלח</button></td>
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
        return `
        <div class="product-card">
          ${p.image
            ? `<img class="product-card-img" src="${escHtml(p.image)}" onerror="this.style.display='none'" loading="lazy" />`
            : `<div class="product-card-img-placeholder">📦</div>`}
          <div class="product-card-body">
            <div class="product-card-title">${escHtml(p.Text)}</div>
            <div class="product-card-meta">
              ${sentBadge}
              ${clicksHtml}
            </div>
          </div>
          <div class="product-card-footer">
            <a href="${escHtml(p.Link)}" target="_blank" style="color:var(--accent);font-size:12px;" dir="ltr">🔗 קישור</a>
            <button class="btn btn-sm ${p.sent ? 'btn-ghost' : 'btn-primary'}" onclick="sendProduct(${p.row_number}, this)">▶ שלח</button>
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

      const fromRow = parseInt(dragSrc.dataset.row);
      const toRow   = parseInt(row.dataset.row);

      // Optimistic UI: move the row visually
      const allRows = [...tbody.querySelectorAll('tr')];
      const fromIdx = allRows.indexOf(dragSrc);
      const toIdx   = allRows.indexOf(row);
      if (fromIdx < toIdx) tbody.insertBefore(dragSrc, row.nextSibling);
      else                  tbody.insertBefore(dragSrc, row);

      try {
        await api('/api/products/reorder', { method: 'POST', body: { fromRow, toRow } });
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

window.sendProduct = (rowNumber, btn) => {
  const modal = document.getElementById('send-modal');
  modal.style.display = 'flex';

  const onConfirm = async () => {
    cleanup();
    const platforms = [];
    if (document.getElementById('modal-chk-wa').checked) platforms.push('whatsapp');
    if (document.getElementById('modal-chk-fb').checked) platforms.push('facebook');
    if (!platforms.length) { alert('יש לבחור לפחות פלטפורמה אחת'); return; }

    btn.disabled = true;
    btn.textContent = '...';
    showLogTab();
    try {
      const sendBody = { platforms };
      if (_currentSubject) sendBody.subject = _currentSubject;
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
    container.innerHTML = schedules.map(s => {
      const subj = s.subject ? _subjects.find(x => x.id === s.subject) : null;
      const subjChip = subj ? `<span style="font-size:10.5px;background:var(--blue-light);color:var(--blue);padding:1px 7px;border-radius:20px;margin-right:6px;">${escHtml(subj.name)}</span>` : '';
      return `
      <div class="schedule-item" id="sched-${s.id}">
        <div>
          <div class="schedule-label">${subjChip}${escHtml(s.label)}</div>
          <div class="schedule-cron" dir="ltr">${escHtml(s.cron)}</div>
        </div>
        <div class="schedule-actions">
          <label class="toggle" title="${s.enabled ? 'פעיל' : 'לא פעיל'}">
            <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleSchedule('${s.id}', this.checked)" />
            <span class="slider"></span>
          </label>
          <button class="btn btn-danger btn-sm" onclick="deleteSchedule('${s.id}')">🗑</button>
        </div>
      </div>
    `;}).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:#f87171;">${escHtml(err.message)}</div>`;
  }
}

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

document.getElementById('btn-add-schedule').addEventListener('click', async () => {
  const label   = document.getElementById('sched-label').value.trim();
  const cron    = document.getElementById('sched-cron').value.trim();
  const subject = document.getElementById('sched-subject').value;
  if (!label || !cron) return alert('יש למלא שם וביטוי cron');
  try {
    await api('/api/schedules', { method: 'POST', body: { label, cron, subject } });
    document.getElementById('sched-label').value = '';
    document.getElementById('sched-cron').value  = '';
    document.getElementById('sched-subject').value = '';
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

  try {
    const result = await api('/api/scrape/aliexpress', {
      method: 'POST',
      body: {
        url,
        join_link: document.getElementById('scrape-join').value.trim(),
        wa_group:  document.getElementById('scrape-wa-group').value.trim(),
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
  const join_link= document.getElementById('new-join').value.trim();
  const wa_group = document.getElementById('new-wa-group').value.trim();
  const subject  = document.getElementById('new-subject').value;
  const result   = document.getElementById('add-product-result');

  if (!Text || !Link) { result.textContent = '⚠ שם מוצר וקישור הם שדות חובה'; result.style.color='#d97706'; return; }

  try {
    await api('/api/products', { method: 'POST', body: { Link, image, Text, join_link, wa_group, subject } });
    result.textContent = '✓ מוצר נוסף בהצלחה';
    result.style.color = '#16a34a';
    ['new-text','new-link','new-image','new-join','new-wa-group'].forEach(id => document.getElementById(id).value = '');
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
async function api(url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso; // show raw value if unparseable
    return d.toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  } catch { return iso; }
}

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
  const limit     = parseInt(document.getElementById('fishing-limit').value) || 10;
  const wa_group  = document.getElementById('fishing-wa-group').value.trim();
  const join_link = document.getElementById('fishing-join-link').value.trim();
  const status    = document.getElementById('fishing-search-status');
  const result    = document.getElementById('fishing-search-result');
  const btn       = document.getElementById('btn-fishing-search');

  btn.disabled = true;
  status.textContent = 'מחפש מוצרים... (עשוי לקחת 1-2 דקות)';
  result.style.display = 'none';

  try {
    const data = await api('/api/scrape/fishing-search', {
      method: 'POST',
      body: { limit, wa_group, join_link },
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

// Load prompt + token info + subjects when settings tab is opened
document.querySelector('[data-tab="settings"]').addEventListener('click', () => {
  loadPrompt();
  loadTokenInfo();
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

// ── Init ──────────────────────────────────────────────────────────────────────
// Add spin keyframe for icon buttons
(function() {
  const s = document.createElement('style');
  s.textContent = '@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }';
  document.head.appendChild(s);
})();

// Load subjects first so selects are populated before products/schedules render
loadSubjects().then(() => {
  loadProducts();
  loadSchedules();
});
