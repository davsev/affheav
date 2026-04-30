// broadcast-modal.js — Add/Edit modal for broadcast messages
// Follows schedule-modal.js module pattern

import { api, escHtml } from './utils.js';

// ── Module state ───────────────────────────────────────────────────────────────
let _editId = null;          // null = create mode, string = edit mode (broadcast id)
let _hasNewImage = false;    // true if user selected a new file in this session
let _onSaved = null;         // callback: called after successful save (loadBroadcasts)

const DAYS_HE = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const MAX_CHARS = 500;

// ── DOM helpers ────────────────────────────────────────────────────────────────
const el = (id) => document.getElementById(id);

// ── Hour select population ─────────────────────────────────────────────────────
function populateHourSelect() {
  const sel = el('bcast-hour');
  if (sel.options.length > 0) return; // already populated
  for (let h = 0; h < 24; h++) {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = String(h).padStart(2, '0');
    sel.appendChild(opt);
  }
}

// ── Recurrence preview ─────────────────────────────────────────────────────────
function updateRecurrencePreview() {
  const freq    = el('bcast-freq').value;
  const day     = parseInt(el('bcast-day').value, 10);
  const n       = parseInt(el('bcast-n').value, 10);
  const hour    = parseInt(el('bcast-hour').value, 10);
  const minute  = parseInt(el('bcast-minute').value, 10);
  const hh      = String(hour).padStart(2, '0');
  const mm      = String(minute).padStart(2, '0');
  const skipFri = el('bcast-skip-fri').checked;
  const skipSat = el('bcast-skip-sat').checked;

  // Show/hide conditional rows
  el('bcast-day').style.display    = freq === 'weekly'       ? ''     : 'none';
  el('bcast-n-row').style.display  = freq === 'every_n_days' ? 'flex' : 'none';
  // Skip checkboxes only make sense for daily / every_n_days
  el('bcast-skip-row').style.display = freq === 'weekly' ? 'none' : 'flex';

  let skip = '';
  if (skipFri && skipSat) skip = ' (לא שישי ושבת)';
  else if (skipFri)       skip = ' (לא שישי)';
  else if (skipSat)       skip = ' (לא שבת)';

  let preview = '';
  if (freq === 'daily')        preview = `כל יום ב-${hh}:${mm}${skip}`;
  if (freq === 'weekly')       preview = `כל ${DAYS_HE[day]} ב-${hh}:${mm}`;
  if (freq === 'every_n_days') preview = `כל ${n} ימים ב-${hh}:${mm}${skip}`;
  el('bcast-recurrence-preview').textContent = preview;
}

// ── Character counter ──────────────────────────────────────────────────────────
function updateCharCount() {
  const len = el('bcast-text').value.length;
  const counter = el('bcast-char-count');
  counter.textContent = `${len}/${MAX_CHARS}`;
  counter.style.color = len > MAX_CHARS ? '#dc2626' : 'var(--on-surface-var)';
}

// ── Image preview ──────────────────────────────────────────────────────────────
function setupImagePreview() {
  const fileInput = el('bcast-image-input');
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) { return; }
    _hasNewImage = true;
    el('bcast-image-url').value = ''; // clear URL field when file chosen
    const reader = new FileReader();
    reader.onload = (e) => {
      const preview = el('bcast-image-preview');
      preview.src = e.target.result;
      preview.style.display = 'block';
      el('bcast-image-remove').style.display = '';
      el('bcast-existing-image').style.display = 'none';
    };
    reader.readAsDataURL(file);
  });

  el('bcast-image-url').addEventListener('input', () => {
    const url = el('bcast-image-url').value.trim();
    const preview = el('bcast-image-preview');
    if (url.startsWith('http')) {
      preview.src = url;
      preview.style.display = 'block';
      el('bcast-image-remove').style.display = '';
      el('bcast-existing-image').style.display = 'none';
      el('bcast-image-input').value = '';
      _hasNewImage = false;
    } else {
      preview.style.display = 'none';
    }
  });
}

// ── Open modal ─────────────────────────────────────────────────────────────────
function openModal(broadcast = null) {
  _editId = broadcast ? String(broadcast.id) : null;
  _hasNewImage = false;

  // Set title
  el('broadcast-modal-title').textContent = broadcast ? 'עריכת הודעת שידור' : 'הוסף הודעת שידור';

  // Populate niche select from window._subjects
  const subjSel = el('bcast-subject');
  subjSel.innerHTML = '<option value="" disabled selected>בחר נישה</option>';
  (window._subjects || []).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    subjSel.appendChild(opt);
  });

  // Populate hour select (idempotent)
  populateHourSelect();

  // Reset / pre-fill fields
  el('bcast-label').value = broadcast ? (broadcast.label || '') : '';
  el('bcast-text').value  = broadcast ? (broadcast.text  || '') : '';
  if (broadcast && broadcast.subjectId) {
    subjSel.value = broadcast.subjectId;
  }

  // Character counter
  updateCharCount();

  // Reset tracked link state
  el('bcast-link-url').value = '';
  el('bcast-short-link-display').style.display = 'none';
  el('bcast-short-link-display').textContent = '';
  if (broadcast && broadcast.shortLink) {
    el('bcast-short-link-display').textContent = `קישור מקוצר קיים: ${broadcast.shortLink}`;
    el('bcast-short-link-display').style.display = 'block';
  }

  // Reset image state
  el('bcast-image-input').value = '';
  el('bcast-image-url').value = '';
  el('bcast-image-preview').style.display = 'none';
  el('bcast-image-preview').src = '';
  el('bcast-image-remove').style.display = 'none';
  el('bcast-existing-image').style.display = 'none';
  if (broadcast && broadcast.imageUrl) {
    if (broadcast.imageUrl.startsWith('http')) {
      el('bcast-image-url').value = broadcast.imageUrl;
      el('bcast-image-preview').src = broadcast.imageUrl;
      el('bcast-image-preview').style.display = 'block';
      el('bcast-image-remove').style.display = '';
    } else {
      el('bcast-existing-image').textContent = `תמונה קיימת: ${broadcast.imageUrl}`;
      el('bcast-existing-image').style.display = 'block';
      el('bcast-image-remove').style.display = '';
    }
  }

  // Recurrence
  const r = broadcast && broadcast.recurrence;
  el('bcast-freq').value        = r ? (r.mode       || 'daily') : 'daily';
  el('bcast-day').value         = r ? (r.day        ?? 5) : 5;   // default Friday
  el('bcast-n').value           = r ? (r.n          ?? 3) : 3;
  el('bcast-hour').value        = r ? (r.hour       ?? 18) : 18; // default 18:00
  el('bcast-minute').value      = r ? (r.minute     ?? 0)  : 0;
  el('bcast-skip-fri').checked  = r ? (r.skipFriday  || false) : false;
  el('bcast-skip-sat').checked  = r ? (r.skipSaturday || false) : false;
  updateRecurrencePreview();

  // Show modal
  el('broadcast-modal').style.display = 'flex';
}

// ── Remove image ───────────────────────────────────────────────────────────────
window.removeBroadcastImage = () => {
  el('bcast-image-input').value = '';
  el('bcast-image-url').value = '';
  el('bcast-image-preview').style.display = 'none';
  el('bcast-image-preview').src = '';
  el('bcast-image-remove').style.display = 'none';
  el('bcast-existing-image').style.display = 'none';
  _hasNewImage = false;
};

// ── Close modal ────────────────────────────────────────────────────────────────
function closeModal() {
  el('broadcast-modal').style.display = 'none';
  _editId = null;
  _hasNewImage = false;
}

// ── Save ───────────────────────────────────────────────────────────────────────
async function saveBroadcast() {
  const label     = el('bcast-label').value.trim();
  const subjectId = el('bcast-subject').value;
  const text      = el('bcast-text').value.trim();
  const freq      = el('bcast-freq').value;
  const day       = parseInt(el('bcast-day').value, 10);
  const n         = parseInt(el('bcast-n').value, 10);
  const hour      = parseInt(el('bcast-hour').value, 10);
  const minute    = parseInt(el('bcast-minute').value, 10);
  const skipFri   = el('bcast-skip-fri').checked;
  const skipSat   = el('bcast-skip-sat').checked;
  const fileInput   = el('bcast-image-input');
  const externalUrl = el('bcast-image-url').value.trim();
  const linkUrl     = el('bcast-link-url').value.trim();

  // Validation
  if (!label)     { alert('יש להזין שם להודעה'); return; }
  if (!subjectId) { alert('יש לבחור נישה'); return; }
  if (!text)      { alert('יש להזין תוכן הודעה'); return; }
  if (text.length > MAX_CHARS) { alert(`ההודעה ארוכה מדי (מקסימום ${MAX_CHARS} תווים)`); return; }

  const recurrence = { mode: freq, hour, minute };
  if (freq === 'weekly')       recurrence.day = day;
  if (freq === 'every_n_days') recurrence.n   = n;
  if (freq !== 'weekly' && skipFri) recurrence.skipFriday  = true;
  if (freq !== 'weekly' && skipSat) recurrence.skipSaturday = true;

  const btn = el('btn-save-broadcast');
  const origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span style="font-size:12px;">שומר...</span>';

  try {
    const hasFile = fileInput.files && fileInput.files[0];

    if (_editId) {
      // ── Edit mode ──────────────────────────────────────────────────────
      const putBody = { label, text, subjectId, recurrence };
      if (!hasFile && externalUrl) putBody.imageUrl = externalUrl;
      if (linkUrl) putBody.linkUrl = linkUrl;
      await api(`/api/broadcasts/${_editId}`, { method: 'PUT', body: putBody });

      // Upload new file if selected (overrides URL)
      if (hasFile) {
        const fd = new FormData();
        fd.append('image', fileInput.files[0]);
        const res = await fetch(`/api/broadcasts/${_editId}/image`, {
          method: 'POST',
          body: fd,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || res.statusText);
        }
      }
    } else {
      // ── Create mode ────────────────────────────────────────────────────
      const fd = new FormData();
      fd.append('label',      label);
      fd.append('text',       text);
      fd.append('subjectId',  subjectId);
      fd.append('recurrence', JSON.stringify(recurrence));
      if (hasFile) {
        fd.append('image', fileInput.files[0]);
      } else if (externalUrl) {
        fd.append('imageUrl', externalUrl);
      }
      if (linkUrl) fd.append('linkUrl', linkUrl);

      const res = await fetch('/api/broadcasts', {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText);
      }
    }

    closeModal();
    if (typeof _onSaved === 'function') await _onSaved();

  } catch (err) {
    alert('שגיאה בשמירה: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
  }
}

// ── Init (called from app.js) ──────────────────────────────────────────────────
export function initBroadcastModal({ loadBroadcasts }) {
  _onSaved = loadBroadcasts;

  // Character counter
  el('bcast-text').addEventListener('input', updateCharCount);

  // Recurrence controls — all trigger preview update
  ['bcast-freq', 'bcast-day', 'bcast-n', 'bcast-hour', 'bcast-minute'].forEach(id => {
    el(id).addEventListener('change', updateRecurrencePreview);
  });
  ['bcast-skip-fri', 'bcast-skip-sat'].forEach(id => {
    el(id).addEventListener('change', updateRecurrencePreview);
  });

  // Image preview
  setupImagePreview();

  // Escape key closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el('broadcast-modal').style.display !== 'none') {
      closeModal();
    }
  });

  // Expose entry points to window (called from onclick attributes in app.js cards)
  window.openAddBroadcast  = () => openModal(null);
  window.openEditBroadcast = (id) => {
    const b = (window._broadcasts || []).find(x => String(x.id) === String(id));
    if (!b) { alert('לא נמצאה הודעה'); return; }
    openModal(b);
  };
  window.closeBroadcastModal = closeModal;
  window.saveBroadcast       = saveBroadcast;
}
