// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
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

// ── Products ──────────────────────────────────────────────────────────────────
let _currentFilter = 'unsent';

window.setFilter = (f) => {
  _currentFilter = f;
  ['unsent','sent','all'].forEach(id => {
    const btn = document.getElementById('filter-' + id);
    if (btn) btn.className = 'btn btn-sm ' + (id === f ? 'btn-primary' : 'btn-neutral');
  });
  loadProducts();
};

function renderProducts(products) {
  const tbody = document.getElementById('products-body');
  const sentCount = products.filter(p => p.sent).length;
  document.getElementById('products-summary').textContent = `${sentCount} נשלחו מתוך ${products.length} סה"כ`;

  let filtered;
  if (_currentFilter === 'unsent') filtered = products.filter(p => !p.sent);
  else if (_currentFilter === 'sent') filtered = products.filter(p => p.sent);
  else filtered = products;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${_currentFilter === 'unsent' ? 'כל המוצרים נשלחו ✓' : 'אין מוצרים'}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(p => `
    <tr>
      <td>${p.image ? `<img class="img-thumb" src="${escHtml(p.image)}" onerror="this.style.display='none'" />` : '—'}</td>
      <td style="max-width:200px;word-break:break-word;">${escHtml(p.Text)}</td>
      <td><a href="${escHtml(p.Link)}" target="_blank" style="color:#38bdf8;font-size:12px;" dir="ltr">🔗 קישור</a></td>
      <td>${escHtml(p.wa_group)}</td>
      <td>${p.sent ? `<span class="badge badge-sent">${fmtDate(p.sent)}</span>` : '<span class="badge badge-unsent">טרם נשלח</span>'}</td>
      <td>${p.facebook ? `<span class="badge badge-fb">${fmtDate(p.facebook)}</span>` : '—'}</td>
      <td><button class="btn btn-sm ${p.sent ? 'btn-neutral' : 'btn-primary'}" onclick="sendProduct(${p.row_number}, this)" title="${p.sent ? 'שלח שוב' : 'שלח'}">▶ שלח</button></td>
    </tr>
  `).join('');
}

async function loadProducts() {
  const tbody = document.getElementById('products-body');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-state">טוען...</td></tr>';

  try {
    const { products } = await api('/api/products');
    if (!products.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">אין מוצרים בגיליון</td></tr>';
      return;
    }
    renderProducts(products);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:#f87171;">${escHtml(err.message)}</td></tr>`;
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
      await api(`/api/send/${rowNumber}`, { method: 'POST', body: { platforms } });
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

document.getElementById('btn-execute').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = '...מריץ';
  showLogTab();
  try {
    const result = await api('/api/send/execute', { method: 'POST' });
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
    container.innerHTML = schedules.map(s => `
      <div class="schedule-item" id="sched-${s.id}">
        <div>
          <div class="schedule-label">${escHtml(s.label)}</div>
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
    `).join('');
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
  const label = document.getElementById('sched-label').value.trim();
  const cron  = document.getElementById('sched-cron').value.trim();
  if (!label || !cron) return alert('יש למלא שם וביטוי cron');
  try {
    await api('/api/schedules', { method: 'POST', body: { label, cron } });
    document.getElementById('sched-label').value = '';
    document.getElementById('sched-cron').value  = '';
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
  const result   = document.getElementById('add-product-result');

  if (!Text || !Link) { result.textContent = '⚠ שם מוצר וקישור הם שדות חובה'; result.style.color='#fbbf24'; return; }

  try {
    await api('/api/products', { method: 'POST', body: { Link, image, Text, join_link, wa_group } });
    result.textContent = '✓ מוצר נוסף בהצלחה';
    result.style.color = '#4ade80';
    ['new-text','new-link','new-image','new-join','new-wa-group'].forEach(id => document.getElementById(id).value = '');
  } catch (err) {
    result.textContent = '✗ שגיאה: ' + err.message;
    result.style.color = '#f87171';
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
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadProducts();
loadSchedules();
