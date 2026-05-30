import { get, put, del, post } from '../api.js';
import { escHtml, fmtDate } from '../utils.js';
import { toast } from '../components/toast.js';
import { confirm } from '../components/modal.js';

let _state, _booted = false;

export function init(state) {
  if (_booted) return; _booted = true;
  _state = state;
  load();
  wireInvite();
  document.getElementById('btn-show-invite-form')?.addEventListener('click', () =>
    document.getElementById('invite-form')?.classList.toggle('hidden')
  );
}

async function load() { await Promise.all([loadUsers(), loadInvites()]); }

async function loadUsers() {
  try {
    const { users } = await get('/api/users');
    renderUsers(users || []);
  } catch {}
}

function renderUsers(users) {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  tbody.innerHTML = users.map(u => `
    <tr class="table__row">
      <td class="table__td table__td--shrink">
        ${u.photo ? `<img src="${escHtml(u.photo)}" class="avatar avatar--sm" alt="">` : `<div class="avatar avatar--sm">${escHtml((u.name||'?')[0])}</div>`}
      </td>
      <td class="table__td">${escHtml(u.name || '—')}</td>
      <td class="table__td table__td--muted">${escHtml(u.email)}</td>
      <td class="table__td table__td--shrink">
        <span class="badge ${u.role === 'admin' ? 'badge--primary' : 'badge--neutral'}">${escHtml(u.role)}</span>
      </td>
      <td class="table__td table__td--shrink">
        <span class="badge ${u.status === 'approved' ? 'badge--success' : u.status === 'suspended' ? 'badge--error' : 'badge--warning'}">${escHtml(u.status)}</span>
      </td>
      <td class="table__td table__td--shrink">
        ${u.role !== 'admin' ? `
          <div class="table__actions">
            <button class="btn btn--ghost btn--xs" data-toggle-status="${u.id}" data-current="${u.status}">
              ${u.status === 'suspended' ? 'Activate' : 'Suspend'}
            </button>
            <button class="btn btn--ghost btn--xs text-error" data-delete-user="${u.id}">Delete</button>
          </div>
        ` : '—'}
      </td>
    </tr>
  `).join('') || `<tr><td colspan="6" class="table__empty">No users</td></tr>`;

  tbody.querySelectorAll('[data-toggle-status]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id      = btn.dataset.toggleStatus;
      const current = btn.dataset.current;
      const next    = current === 'suspended' ? 'approved' : 'suspended';
      try { await put(`/api/users/${id}`, { status: next }); await loadUsers(); } catch (err) { toast.error('Failed', err.message); }
    });
  });

  tbody.querySelectorAll('[data-delete-user]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await confirm('Delete this user?', { okLabel: 'Delete' });
      if (!ok) return;
      try { await del(`/api/users/${btn.dataset.deleteUser}`); await loadUsers(); toast.success('Deleted'); } catch (err) { toast.error('Failed', err.message); }
    });
  });
}

async function loadInvites() {
  try {
    const { invitations } = await get('/api/users/invites');
    renderInvites((invitations || []).filter(i => !i.usedAt && !i.used_at && new Date(i.expiresAt || i.expires_at) > new Date()));
  } catch {}
}

function renderInvites(invites) {
  const tbody = document.getElementById('invites-tbody');
  if (!tbody) return;
  tbody.innerHTML = invites.map(i => {
    const url = i.inviteUrl || i.invite_url || `${location.origin}/auth/invite/${i.token}`;
    return `
      <tr class="table__row">
        <td class="table__td">${escHtml(i.email)}</td>
        <td class="table__td table__td--mono text-xs">
          <button class="btn btn--ghost btn--xs" onclick="navigator.clipboard.writeText('${escHtml(url)}')">Copy</button>
        </td>
        <td class="table__td table__td--shrink text-xs">${escHtml(new Date(i.expiresAt || i.expires_at).toLocaleDateString())}</td>
        <td class="table__td table__td--shrink">
          <button class="btn btn--ghost btn--xs text-error" data-delete-invite="${i.id}">Cancel</button>
        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="4" class="table__empty">No pending invites</td></tr>`;

  tbody.querySelectorAll('[data-delete-invite]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try { await del(`/api/users/invites/${btn.dataset.deleteInvite}`); await loadInvites(); } catch (err) { toast.error('Failed', err.message); }
    });
  });
}

function wireInvite() {
  document.getElementById('btn-send-invite')?.addEventListener('click', async () => {
    const email = document.getElementById('invite-email')?.value?.trim();
    const result = document.getElementById('invite-result');
    if (!email) return toast.error('Email required');
    try {
      const data = await post('/api/users/invites', { email });
      if (result) { result.textContent = `✅ Invite sent to ${email}`; result.className = 'px-5 pb-4 text-sm text-success'; result.classList.remove('hidden'); }
      await loadInvites();
    } catch (err) {
      if (result) { result.textContent = `❌ ${err.message}`; result.className = 'px-5 pb-4 text-sm text-error'; result.classList.remove('hidden'); }
    }
  });
}
