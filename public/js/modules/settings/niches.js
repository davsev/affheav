/**
 * settings/niches.js — Niche CRUD and per-niche credential forms.
 */
import { get, post, put, del } from '../../api.js';
import { escHtml, nicheColor } from '../../utils.js';
import { toast } from '../../components/toast.js';
import { confirm } from '../../components/modal.js';

let _state;
let _activeNicheId = null;

export function init(state) {
  _state = state;
  load();
  wireAddNicheToggle();
  wireCreateNiche();
}

async function load() {
  try {
    const { subjects } = await get('/api/subjects');
    _state.subjects = subjects || [];
    renderNicheGrid(subjects);
    if (subjects.length) showNicheDetail(subjects[0]);
  } catch {}
}

function renderNicheGrid(subjects) {
  const grid = document.getElementById('niches-grid');
  if (!grid) return;

  grid.innerHTML = subjects.map((s, i) => `
    <div class="card card--interactive niche-card${_activeNicheId === s.id ? ' is-active' : ''}"
         data-niche-id="${escHtml(s.id)}" style="--chip-color:${nicheColor(i)};">
      <div class="niche-card__icon">${escHtml(s.icon || '🏷️')}</div>
      <div>
        <div class="niche-card__name">${escHtml(s.name)}</div>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-niche-id]').forEach(card => {
    card.addEventListener('click', () => {
      const s = subjects.find(x => x.id === card.dataset.nicheId);
      if (s) showNicheDetail(s);
    });
  });
}

function showNicheDetail(subject) {
  _activeNicheId = subject.id;
  const panel = document.getElementById('active-niche-panel');
  if (!panel) return;

  document.querySelectorAll('[data-niche-id]').forEach(c =>
    c.classList.toggle('is-active', c.dataset.nicheId === subject.id)
  );

  panel.innerHTML = nicheDetailHTML(subject);
  wireNicheDetail(subject);
}

function nicheDetailHTML(s) {
  return `
    <div class="card card--glass">
      <div class="card__header">
        <h3 class="card__title">${escHtml(s.name)}</h3>
        <button class="btn btn--ghost btn--icon btn--sm text-error" id="btn-delete-niche" title="Delete niche">🗑️</button>
      </div>
      <div class="card__body flex flex-col gap-5">

        <!-- Channel toggles -->
        <div class="flex flex-col gap-2">
          <label class="toggle">
            <input type="checkbox" id="niche-wa-enabled" ${s.waEnabled || s.wa_enabled ? 'checked' : ''}>
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
            <span class="toggle__label">WhatsApp</span>
          </label>
          <label class="toggle">
            <input type="checkbox" id="niche-fb-enabled" ${s.fbEnabled || s.fb_enabled ? 'checked' : ''}>
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
            <span class="toggle__label">Facebook</span>
          </label>
          <label class="toggle">
            <input type="checkbox" id="niche-ig-enabled" ${s.instagramEnabled || s.instagram_enabled ? 'checked' : ''}>
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
            <span class="toggle__label">Instagram</span>
          </label>
        </div>

        <hr>

        <!-- Facebook credentials -->
        <div class="flex flex-col gap-3">
          <div class="text-sm font-semibold">📘 Facebook</div>
          <div class="field">
            <label class="field__label">Page ID</label>
            <input type="text" id="niche-fb-page-id" class="input input--sm" dir="ltr"
              value="${escHtml(s.facebookPageId || s.facebook_page_id || '')}">
          </div>
          <div class="field">
            <label class="field__label">
              Access Token
              ${s.facebook_token || s.facebookToken ? `<span class="badge badge--success badge--sm">Set</span>` : `<span class="badge badge--neutral badge--sm">Not set</span>`}
            </label>
            <div class="input-wrap">
              <input type="password" id="niche-fb-token" class="input input--sm" dir="ltr" placeholder="Leave blank to keep">
              <button class="input-wrap__suffix" type="button" tabindex="-1">👁</button>
            </div>
          </div>
          <div class="flex gap-2">
            <button class="btn btn--secondary btn--sm" id="btn-check-fb-token">Check Token</button>
            <button class="btn btn--ghost btn--sm" id="btn-gen-fb-token">Generate Permanent</button>
          </div>
          <div id="fb-token-status" class="text-xs text-muted"></div>
        </div>

        <hr>

        <!-- Instagram -->
        <div class="flex flex-col gap-3">
          <div class="text-sm font-semibold">📸 Instagram</div>
          <div class="field">
            <label class="field__label">
              Account ID
              ${s.instagram_account_id || s.instagramAccountId ? `<span class="badge badge--success badge--sm">Set</span>` : `<span class="badge badge--neutral badge--sm">Not set</span>`}
            </label>
            <input type="password" id="niche-ig-id" class="input input--sm" dir="ltr" placeholder="Leave blank to keep">
          </div>
        </div>

        <hr>

        <!-- AI Prompt -->
        <div class="flex flex-col gap-3">
          <div class="text-sm font-semibold">✨ AI Prompt</div>
          <div class="field">
            <textarea id="niche-prompt" class="textarea" rows="4">${escHtml(s.openaiPrompt || s.openai_prompt || '')}</textarea>
            <div class="field__hint">Variables: {{Text}} {{Link}} {{join_link}}</div>
          </div>
        </div>

        <!-- AliExpress tracking ID -->
        <div class="field">
          <label class="field__label">AliExpress Tracking ID</label>
          <input type="text" id="niche-tracking-id" class="input input--sm" dir="ltr"
            value="${escHtml(s.aliexpressTrackingId || s.aliexpress_tracking_id || '')}">
        </div>

        <div class="flex gap-2">
          <button class="btn btn--primary" id="btn-save-niche">Save Changes</button>
        </div>
      </div>
    </div>
  `;
}

function wireNicheDetail(subject) {
  // Toggle password visibility
  document.querySelectorAll('.input-wrap__suffix').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = btn.previousElementSibling;
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });
  });

  // Save
  document.getElementById('btn-save-niche')?.addEventListener('click', () => saveNiche(subject.id));

  // Delete
  document.getElementById('btn-delete-niche')?.addEventListener('click', async () => {
    const ok = await confirm(`Delete niche "${subject.name}"? This cannot be undone.`, { okLabel: 'Delete' });
    if (!ok) return;
    try {
      await del(`/api/subjects/${subject.id}`);
      toast.success('Niche deleted');
      _activeNicheId = null;
      document.getElementById('active-niche-panel').innerHTML = '';
      load();
    } catch (err) {
      toast.error('Failed', err.message);
    }
  });

  // Check FB token
  document.getElementById('btn-check-fb-token')?.addEventListener('click', async () => {
    const el = document.getElementById('fb-token-status');
    try {
      const { token } = await get(`/api/facebook/token-info?subjectId=${subject.id}`);
      el.textContent = token?.is_valid
        ? `✅ Valid – expires ${token.expires_at || 'never'}`
        : '❌ Invalid token';
    } catch (err) { el.textContent = `Error: ${err.message}`; }
  });

  // Generate permanent token
  document.getElementById('btn-gen-fb-token')?.addEventListener('click', () => {
    document.getElementById('gen-token-modal-overlay')?.classList.add('is-open');
    document.getElementById('gen-token-confirm')?.addEventListener('click', async () => {
      const shortToken = document.getElementById('gen-token-input')?.value?.trim();
      if (!shortToken) return;
      try {
        const { pageToken } = await post('/api/facebook/generate-page-token', { shortUserToken: shortToken, subjectId: subject.id });
        document.getElementById('gen-token-status').textContent = '✅ Token generated!';
        document.getElementById('niche-fb-token').value = pageToken;
      } catch (err) {
        document.getElementById('gen-token-status').textContent = `❌ ${err.message}`;
      }
    }, { once: true });
  });

  // Auto-save on toggle changes
  ['niche-wa-enabled', 'niche-fb-enabled', 'niche-ig-enabled'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => saveNiche(subject.id));
  });
}

async function saveNiche(subjectId) {
  const body = {
    waEnabled:           document.getElementById('niche-wa-enabled')?.checked,
    fbEnabled:           document.getElementById('niche-fb-enabled')?.checked,
    instagramEnabled:    document.getElementById('niche-ig-enabled')?.checked,
    facebookPageId:      document.getElementById('niche-fb-page-id')?.value || undefined,
    openaiPrompt:        document.getElementById('niche-prompt')?.value || undefined,
    aliexpressTrackingId: document.getElementById('niche-tracking-id')?.value || undefined,
  };

  const fbToken = document.getElementById('niche-fb-token')?.value;
  if (fbToken) body.facebookToken = fbToken;

  const igId = document.getElementById('niche-ig-id')?.value;
  if (igId) body.instagramAccountId = igId;

  try {
    await put(`/api/subjects/${subjectId}`, body);
    toast.success('Saved');
  } catch (err) {
    toast.error('Failed to save', err.message);
  }
}

function wireAddNicheToggle() {
  document.getElementById('btn-show-add-niche')?.addEventListener('click', () => {
    document.getElementById('add-niche-form')?.classList.toggle('hidden');
  });
}

function wireCreateNiche() {
  document.getElementById('btn-create-niche')?.addEventListener('click', async () => {
    const name = document.getElementById('new-niche-name')?.value?.trim();
    if (!name) return toast.error('Name required');
    try {
      await post('/api/subjects', {
        name,
        wa_group:      document.getElementById('new-niche-wagroup')?.value,
        join_link:     document.getElementById('new-niche-joinlink')?.value,
        facebook_page_id: document.getElementById('new-niche-fbpageid')?.value,
        facebook_token:   document.getElementById('new-niche-fbtoken')?.value,
        instagram_account_id: document.getElementById('new-niche-igid')?.value,
        openai_prompt:    document.getElementById('new-niche-prompt')?.value,
      });
      toast.success('Niche created');
      document.getElementById('add-niche-form')?.classList.add('hidden');
      load();
    } catch (err) {
      toast.error('Failed', err.message);
    }
  });
}
