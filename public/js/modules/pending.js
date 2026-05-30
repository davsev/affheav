import { get, post } from '../api.js';
import { escHtml } from '../utils.js';
import { toast } from '../components/toast.js';

let _state, _booted = false;

export function init(state) {
  if (_booted) return; _booted = true;
  _state = state;
  load();
}

async function load() {
  try {
    const { users } = await get('/api/users/pending');
    renderPending(users || []);
  } catch {}
}

function renderPending(users) {
  const grid = document.getElementById('pending-grid');
  if (!grid) return;
  if (!users.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state__icon">✅</div><div class="empty-state__title">No pending approvals</div></div>`;
    return;
  }
  grid.innerHTML = users.map(u => `
    <div class="card card--glass" style="padding:var(--space-5);display:flex;flex-direction:column;gap:var(--space-4);" data-user="${u.id}">
      <div class="flex items-center gap-3">
        ${u.photo ? `<img src="${escHtml(u.photo)}" class="avatar avatar--lg" alt="">` : `<div class="avatar avatar--lg">${(u.name||'?')[0]}</div>`}
        <div>
          <div class="font-medium">${escHtml(u.name||'—')}</div>
          <div class="text-sm text-muted">${escHtml(u.email)}</div>
        </div>
      </div>
      <div class="flex gap-2">
        <button class="btn btn--success btn--sm" data-approve="${u.id}">Approve</button>
        <button class="btn btn--danger btn--sm" data-reject="${u.id}">Reject</button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-approve]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await post(`/api/users/${btn.dataset.approve}/approve`, { role: 'group_user' });
        toast.success('Approved'); await load();
      } catch (err) { toast.error('Failed', err.message); }
    });
  });
}
