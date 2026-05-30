import { get, post, patch } from '../api.js';
import { escHtml } from '../utils.js';
import { toast } from '../components/toast.js';

let _state, _booted = false;

export function init(state) {
  if (_booted) return; _booted = true;
  _state = state;
  loadSettings();
  loadSuggestions();
  wireControls();
}

async function loadSettings() {
  try {
    const { aiEnabled, aiPrompt, defaultPrompt } = await get('/api/discover/settings');
    const toggle = document.getElementById('discovery-ai-enabled');
    const textarea = document.getElementById('discovery-ai-prompt');
    if (toggle) toggle.checked = aiEnabled;
    if (textarea) textarea.value = aiPrompt || defaultPrompt || '';
  } catch {}
}

async function loadSuggestions() {
  try {
    const { suggestions } = await get('/api/discover');
    renderSuggestions(suggestions || []);
  } catch {}
}

function renderSuggestions(suggestions) {
  const grid = document.getElementById('discover-grid');
  if (!grid) return;
  if (!suggestions.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state__icon">✨</div><div class="empty-state__title">No suggestions yet</div><div class="empty-state__message">Run Discovery to get AI-powered product suggestions.</div></div>`;
    return;
  }
  grid.innerHTML = suggestions.map(s => `
    <div class="card" data-suggestion="${escHtml(s.id)}">
      <div style="aspect-ratio:1/1;overflow:hidden;background:var(--color-surface-raised);">
        <img src="${escHtml(s.imageUrl || s.image_url || '')}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:contain;">
      </div>
      <div style="padding:var(--space-3) var(--space-4);display:flex;flex-direction:column;gap:var(--space-2);">
        <div class="text-sm font-medium line-clamp-2">${escHtml(s.title)}</div>
        <div class="flex gap-2">
          <button class="btn btn--primary btn--xs" data-action="add">Add</button>
          <button class="btn btn--ghost btn--xs" data-action="dismiss">Dismiss</button>
        </div>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-suggestion]').forEach(card => {
    const id = card.dataset.suggestion;
    card.querySelector('[data-action="add"]')?.addEventListener('click', () => updateSuggestion(id, 'added', card));
    card.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => updateSuggestion(id, 'dismissed', card));
  });
}

async function updateSuggestion(id, status, card) {
  try {
    await patch(`/api/discover/${id}`, { status });
    card.remove();
    toast.success(status === 'added' ? 'Product added!' : 'Dismissed');
  } catch (err) { toast.error('Failed', err.message); }
}

function wireControls() {
  document.getElementById('btn-run-discovery')?.addEventListener('click', async () => {
    toast.info('Running…', 'This may take a minute');
    try {
      await post('/api/discover/run');
      await loadSuggestions();
      toast.success('Discovery complete');
    } catch (err) { toast.error('Failed', err.message); }
  });

  document.getElementById('btn-save-discovery')?.addEventListener('click', async () => {
    const aiEnabled = document.getElementById('discovery-ai-enabled')?.checked;
    const aiPrompt  = document.getElementById('discovery-ai-prompt')?.value;
    try {
      await patch('/api/discover/settings', { aiEnabled, aiPrompt });
      toast.success('Saved');
    } catch (err) { toast.error('Failed', err.message); }
  });

  document.getElementById('btn-reset-discovery')?.addEventListener('click', async () => {
    try {
      await patch('/api/discover/settings', { aiPrompt: null });
      await loadSettings();
      toast.success('Reset to default');
    } catch (err) { toast.error('Failed', err.message); }
  });
}
