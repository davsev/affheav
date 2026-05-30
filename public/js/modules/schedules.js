import { get, post, put, del, patch } from '../api.js';
import { escHtml } from '../utils.js';
import { toast } from '../components/toast.js';
import { confirm } from '../components/modal.js';

let _state;
let _booted = false;

export function init(state) {
  if (_booted) return; _booted = true;
  _state = state;
  populateCronBuilder();
  populateTimezones();
  populateSubjectSelects();
  wireAddSchedule();
  wireAddBroadcast();
  load();
}

async function load() {
  loadSchedules();
  loadBroadcasts();
}

async function loadSchedules() {
  try {
    const { schedules } = await get('/api/schedules');
    renderSchedules(schedules || []);
  } catch {}
}

function renderSchedules(schedules) {
  const list = document.getElementById('schedules-list');
  if (!list) return;
  if (!schedules.length) { list.innerHTML = '<p class="text-sm text-muted">No schedules yet.</p>'; return; }
  list.innerHTML = schedules.map(s => `
    <div class="card card--glass" data-sched-id="${escHtml(s.id)}">
      <div class="card__body flex items-center gap-3 flex-wrap py-3">
        <label class="toggle" title="${s.enabled ? 'Enabled' : 'Disabled'}">
          <input type="checkbox" class="sched-toggle" ${s.enabled ? 'checked' : ''}>
          <span class="toggle__track"><span class="toggle__thumb"></span></span>
        </label>
        <div class="flex-1">
          <div class="text-sm font-medium">${escHtml(s.label || 'Untitled')}</div>
          <div class="text-xs text-muted font-mono">${escHtml(s.cron)} · ${escHtml(s.timezone || 'UTC')}</div>
        </div>
        <div class="flex gap-1">
          <button class="btn btn--ghost btn--sm" data-action="fire">▶️</button>
          <button class="btn btn--ghost btn--icon btn--sm text-error" data-action="delete">🗑️</button>
        </div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-sched-id]').forEach(card => {
    const id = card.dataset.schedId;
    card.querySelector('.sched-toggle')?.addEventListener('change', (e) =>
      put(`/api/schedules/${id}`, { enabled: e.target.checked }).catch(() => toast.error('Failed'))
    );
    card.querySelector('[data-action="fire"]')?.addEventListener('click', () =>
      post(`/api/schedules/${id}/fire`).then(() => toast.success('Fired!')).catch(e => toast.error('Failed', e.message))
    );
    card.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      const ok = await confirm('Delete this schedule?', { okLabel: 'Delete' });
      if (!ok) return;
      del(`/api/schedules/${id}`).then(() => { toast.success('Deleted'); loadSchedules(); }).catch(e => toast.error('Failed', e.message));
    });
  });
}

async function loadBroadcasts() {
  try {
    const { broadcasts } = await get('/api/broadcasts');
    renderBroadcasts(broadcasts || []);
  } catch {}
}

function renderBroadcasts(broadcasts) {
  const list = document.getElementById('broadcasts-list');
  if (!list) return;
  if (!broadcasts.length) { list.innerHTML = '<p class="text-sm text-muted">No broadcasts yet.</p>'; return; }
  list.innerHTML = broadcasts.map(b => `
    <div class="card card--glass" data-bcast-id="${escHtml(b.id)}">
      <div class="card__body flex items-center gap-3 flex-wrap py-3">
        <label class="toggle">
          <input type="checkbox" class="bcast-toggle" ${b.enabled ? 'checked' : ''}>
          <span class="toggle__track"><span class="toggle__thumb"></span></span>
        </label>
        <div class="flex-1">
          <div class="text-sm font-medium">${escHtml(b.label || 'Untitled')}</div>
          <div class="text-xs text-muted">${escHtml(b.cron)} · ${escHtml(b.timezone || 'UTC')}</div>
        </div>
        <div class="flex gap-1">
          <button class="btn btn--ghost btn--sm" data-action="fire">▶️</button>
          <button class="btn btn--ghost btn--icon btn--sm text-error" data-action="delete">🗑️</button>
        </div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-bcast-id]').forEach(card => {
    const id = card.dataset.bcastId;
    card.querySelector('.bcast-toggle')?.addEventListener('change', (e) =>
      patch(`/api/broadcasts/${id}/enabled`, { enabled: e.target.checked }).catch(() => toast.error('Failed'))
    );
    card.querySelector('[data-action="fire"]')?.addEventListener('click', () =>
      post(`/api/broadcasts/${id}/fire-now`).then(() => toast.success('Sent!')).catch(e => toast.error('Failed', e.message))
    );
    card.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      const ok = await confirm('Delete this broadcast?', { okLabel: 'Delete' });
      if (!ok) return;
      del(`/api/broadcasts/${id}`).then(() => { toast.success('Deleted'); loadBroadcasts(); }).catch(e => toast.error('Failed', e.message));
    });
  });
}

function wireAddSchedule() {
  document.getElementById('btn-add-schedule')?.addEventListener('click', async () => {
    const label    = document.getElementById('sched-label')?.value?.trim();
    const cron     = buildCron();
    const timezone = document.getElementById('sched-timezone')?.value;
    const subject  = document.getElementById('sched-subject')?.value || null;
    if (!cron) return toast.error('Invalid schedule');
    try {
      await post('/api/schedules', { label, cron, timezone, subject });
      toast.success('Schedule added');
      loadSchedules();
    } catch (err) { toast.error('Failed', err.message); }
  });
}

function wireAddBroadcast() {
  document.getElementById('btn-add-broadcast')?.addEventListener('click', () => {
    toast.info('Broadcast editor', 'Coming soon — use the API for now.');
  });
}

function buildCron() {
  const activeMode = document.querySelector('.cron-tab.is-active')?.dataset.cronMode;
  if (activeMode === 'daily') {
    const h = document.getElementById('cron-daily-hour')?.value || '10';
    const m = document.getElementById('cron-daily-min')?.value || '0';
    return `${m} ${h} * * *`;
  }
  if (activeMode === 'days') {
    const h    = document.getElementById('cron-days-hour')?.value || '10';
    const m    = document.getElementById('cron-days-min')?.value || '0';
    const days = [...document.querySelectorAll('.day-btn.is-selected')].map(b => b.dataset.day).join(',') || '*';
    return `${m} ${h} * * ${days}`;
  }
  if (activeMode === 'hourly') {
    const n = document.getElementById('cron-hourly-n')?.value || '4';
    return `0 */${n} * * *`;
  }
  if (activeMode === 'custom') {
    return document.getElementById('cron-custom-expr')?.value?.trim() || '';
  }
  return '';
}

function populateCronBuilder() {
  // Hour selects
  ['cron-daily-hour','cron-days-hour'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    for (let h = 0; h < 24; h++) el.appendChild(new Option(String(h).padStart(2,'0'), h));
    el.value = 10;
  });
  // Min selects
  ['cron-daily-min','cron-days-min'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    [0,15,30,45].forEach(m => el.appendChild(new Option(String(m).padStart(2,'0'), m)));
  });

  // Day picker
  const picker = document.getElementById('cron-day-picker');
  if (picker) {
    const days = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    picker.innerHTML = days.map((d,i) => `
      <button type="button" class="day-btn" data-day="${i}">${d}</button>
    `).join('');
    picker.querySelectorAll('.day-btn').forEach(btn => {
      btn.addEventListener('click', () => btn.classList.toggle('is-selected'));
    });
  }

  // Tab switching
  document.querySelectorAll('.cron-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cron-tab').forEach(t => t.classList.remove('is-active'));
      document.querySelectorAll('.cron-builder__panel').forEach(p => p.classList.remove('is-active'));
      tab.classList.add('is-active');
      document.getElementById(`cron-panel-${tab.dataset.cronMode}`)?.classList.add('is-active');
    });
  });
}

function populateTimezones() {
  const el = document.getElementById('sched-timezone');
  if (!el || typeof TIMEZONES === 'undefined') return;
  TIMEZONES.forEach(tz => el.appendChild(new Option(tz, tz)));
  el.value = 'Asia/Jerusalem';
}

function populateSubjectSelects() {
  const el = document.getElementById('sched-subject');
  if (!el) return;
  _state.subjects.forEach(s => el.appendChild(new Option(s.name, s.id)));
}
