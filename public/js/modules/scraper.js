import { get, post } from '../api.js';
import { escHtml } from '../utils.js';
import { toast } from '../components/toast.js';

let _state, _booted = false;

export function init(state) {
  if (_booted) return; _booted = true;
  _state = state;
  populateSelects();
  wireFishing();
  wireSingle();
}

function populateSelects() {
  ['fishing-subject','scrape-subject'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    _state.subjects.forEach(s => el.appendChild(new Option(s.name, s.id)));
    el.addEventListener('change', () => fillGroups(el, id.replace('subject','wagroup')));
    if (_state.subjects.length) fillGroups(el, id.replace('subject','wagroup'));
  });
}

async function fillGroups(subjectEl, groupElId) {
  const groupEl = document.getElementById(groupElId);
  if (!groupEl) return;
  const subjectId = subjectEl.value;
  if (!subjectId) return;
  try {
    const { groups } = await get(`/api/subjects/${subjectId}/whatsapp-groups`);
    groupEl.innerHTML = (groups || []).map(g => `<option value="${escHtml(g.id)}">${escHtml(g.name)}</option>`).join('');
  } catch {}
}

function wireFishing() {
  document.getElementById('btn-fishing-search')?.addEventListener('click', async () => {
    const btn    = document.getElementById('btn-fishing-search');
    const result = document.getElementById('fishing-result');
    const qty    = document.getElementById('fishing-qty')?.value || 10;
    const subj   = document.getElementById('fishing-subject')?.value;
    const group  = document.getElementById('fishing-wagroup')?.value;

    btn.classList.add('is-loading');
    result?.classList.add('hidden');

    try {
      const data = await post('/api/scrape/fishing-search', { limit: Number(qty), subject: subj, whatsappGroupId: group });
      if (result) {
        result.textContent = `Added ${data.saved || 0}, skipped ${data.skipped || 0}`;
        result.classList.remove('hidden');
      }
      toast.success('Done', `Added ${data.saved || 0} products`);
    } catch (err) {
      toast.error('Search failed', err.message);
    } finally {
      btn.classList.remove('is-loading');
    }
  });
}

function wireSingle() {
  document.getElementById('btn-scrape')?.addEventListener('click', async () => {
    const btn    = document.getElementById('btn-scrape');
    const result = document.getElementById('scrape-result');
    const url    = document.getElementById('scrape-url')?.value?.trim();
    const subj   = document.getElementById('scrape-subject')?.value;
    const group  = document.getElementById('scrape-wagroup')?.value;
    const auto   = document.getElementById('scrape-autosend')?.checked;

    if (!url) return toast.error('URL required');

    btn.classList.add('is-loading');
    result?.classList.add('hidden');

    try {
      const data = await post('/api/scrape/aliexpress', { url, subject: subj, whatsappGroupId: group, autoSend: auto });
      if (result) {
        result.textContent = data.success ? 'Product saved!' : 'Failed';
        result.classList.remove('hidden');
      }
      toast.success('Product saved');
    } catch (err) {
      toast.error('Scrape failed', err.message);
    } finally {
      btn.classList.remove('is-loading');
    }
  });
}
