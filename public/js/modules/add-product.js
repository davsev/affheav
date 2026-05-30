import { get, post } from '../api.js';
import { escHtml } from '../utils.js';
import { toast } from '../components/toast.js';

let _state, _booted = false;

export function init(state) {
  if (_booted) return; _booted = true;
  _state = state;
  populateSubject();
  wire();
}

function populateSubject() {
  const el = document.getElementById('ap-subject');
  if (!el) return;
  el.innerHTML = '';
  _state.subjects.forEach(s => el.appendChild(new Option(s.name, s.id)));
  el.addEventListener('change', async () => {
    const groups = document.getElementById('ap-wagroup');
    if (!groups) return;
    const { groups: g } = await get(`/api/subjects/${el.value}/whatsapp-groups`).catch(() => ({ groups: [] }));
    groups.innerHTML = (g || []).map(gr => `<option value="${escHtml(gr.id)}">${escHtml(gr.name)}</option>`).join('');
  });
  el.dispatchEvent(new Event('change'));
}

function wire() {
  document.getElementById('btn-add-product')?.addEventListener('click', async () => {
    const name  = document.getElementById('ap-name')?.value?.trim();
    const link  = document.getElementById('ap-link')?.value?.trim();
    const image = document.getElementById('ap-image')?.value?.trim();
    const subj  = document.getElementById('ap-subject')?.value;
    const group = document.getElementById('ap-wagroup')?.value;
    const result = document.getElementById('add-product-result');

    if (!name || !link) return toast.error('Name and link required');
    try {
      await post('/api/products', { Text: name, Link: link, image, subject: subj, whatsappGroupId: group });
      if (result) { result.textContent = '✅ Product added!'; result.className = 'text-sm text-success'; result.classList.remove('hidden'); }
      toast.success('Added');
    } catch (err) {
      if (result) { result.textContent = `❌ ${err.message}`; result.className = 'text-sm text-error'; result.classList.remove('hidden'); }
      toast.error('Failed', err.message);
    }
  });
}
