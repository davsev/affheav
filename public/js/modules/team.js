import { get, post, del } from '../api.js';
import { escHtml } from '../utils.js';
import { toast } from '../components/toast.js';

let _state, _booted = false;

export function init(state) {
  if (_booted) return; _booted = true;
  _state = state;
  load();
  wireInvite();
}

async function load() {
  try {
    const { users } = await get('/api/users/group');
    const el = document.getElementById('team-members-list');
    if (!el) return;
    if (!users?.length) { el.innerHTML = '<p class="text-sm text-muted">No team members yet.</p>'; return; }
    el.innerHTML = `
      <div class="table-wrap">
        <table class="table table--compact">
          <thead class="table__head"><tr>
            <th class="table__th">Member</th>
            <th class="table__th">Email</th>
            <th class="table__th table__td--shrink">Actions</th>
          </tr></thead>
          <tbody>
            ${users.map(u => `
              <tr class="table__row">
                <td class="table__td">${escHtml(u.name||'—')}</td>
                <td class="table__td table__td--muted">${escHtml(u.email)}</td>
                <td class="table__td table__td--shrink">
                  <button class="btn btn--ghost btn--xs text-error" data-remove="${u.id}">Remove</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;

    el.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try { await del(`/api/users/${btn.dataset.remove}`); await load(); } catch (err) { toast.error('Failed', err.message); }
      });
    });
  } catch {}
}

function wireInvite() {
  document.getElementById('btn-invite-team')?.addEventListener('click', async () => {
    const email = prompt('Team member email:');
    if (!email) return;
    try {
      await post('/api/users/invites', { email, invitedRole: 'group_user' });
      toast.success('Invite sent');
    } catch (err) { toast.error('Failed', err.message); }
  });
}
