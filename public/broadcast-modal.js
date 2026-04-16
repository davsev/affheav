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
    opt.textContent = String(h).padStart(2, '0') + ':00';
    sel.appendChild(opt);
  }
}

// ── Recurrence preview ─────────────────────────────────────────────────────────
function updateRecurrencePreview() {
  const freq = el('bcast-freq').value;
  const day  = parseInt(el('bcast-day').value, 10);
  const n    = parseInt(el('bcast-n').value, 10);
  const hour = parseInt(el('bcast-hour').value, 10);
  const hh   = String(hour).padStart(2, '0');

  // Show/hide conditional rows
  el('bcast-day').style.display   = freq === 'weekly'       ? ''     : 'none';
  el('bcast-n-row').style.display = freq === 'every_n_days' ? 'flex' : 'none';

  let preview = '';
  if (freq === 'daily')        preview = `כל יום ב-${hh}:00`;
  if (freq === 'weekly')       preview = `כל ${DAYS_HE[day]} ב-${hh}:00`;
  if (freq === 'every_n_days') preview = `כל ${n} ימים ב-${hh}:00`;
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

  // Reset image state
  el('bcast-image-input').value = '';
  el('bcast-image-preview').style.display = 'none';
  el('bcast-image-preview').src = '';
  el('bcast-image-remove').style.display = 'none';
  el('bcast-existing-image').style.display = 'none';
  if (broadcast && broadcast.imageUrl) {
    el('bcast-existing-image').textContent = `תמונה קיימת: ${broadcast.imageUrl}`;
    el('bcast-existing-image').style.display = 'block';
    el('bcast-image-remove').style.display = '';
  }

  // Recurrence
  const r = broadcast && broadcast.recurrence;
  el('bcast-freq').value = r ? (r.frequency || 'daily') : 'daily';
  el('bcast-day').value  = r ? (r.day  ?? 5) : 5;  // default Friday
  el('bcast-n').value    = r ? (r.n    ?? 3) : 3;
  el('bcast-hour').value = r ? (r.hour ?? 18) : 18; // default 18:00
  updateRecurrencePreview();

  // Show modal
  el('broadcast-modal').style.display = 'flex';
}

// ── Remove image ───────────────────────────────────────────────────────────────
window.removeBroadcastImage = () => {
  el('bcast-image-input').value = '';
  el('bcast-image-preview').style.display = 'none';
  el('bcast-image-preview').src = '';
  el('bcast-image-remove').style.display = 'none';
  el('bcast-existing-image').style.display = 'none';
  _hasNewImage = false;
  // If editing, mark that image should be cleared (send empty string for imageUrl)
  // Actual clear happens on save — backend should handle null/empty imageUrl
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
  const fileInput = el('bcast-image-input');

  // Validation
  if (!label)     { alert('יש להזין שם להודעה'); return; }
  if (!subjectId) { alert('יש לבחור נישה'); return; }
  if (!text)      { alert('יש להזין תוכן הודעה'); return; }
  if (text.length > MAX_CHARS) { alert(`ההודעה ארוכה מדי (מקסימום ${MAX_CHARS} תווים)`); return; }

  const recurrence = { frequency: freq, hour };
  if (freq === 'weekly')       recurrence.day = day;
  if (freq === 'every_n_days') recurrence.n   = n;

  const btn = el('btn-save-broadcast');
  const origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span style="font-size:12px;">שומר...</span>';

  try {
    const hasFile = fileInput.files && fileInput.files[0];

    if (_editId) {
      // ── Edit mode ──────────────────────────────────────────────────────
      // Step 1: Update non-image fields via JSON PUT
      await api(`/api/broadcasts/${_editId}`, {
        method: 'PUT',
        body: { label, text, subjectId, recurrence },
      });

      // Step 2: Upload new image if selected
      if (hasFile) {
        const fd = new FormData();
        fd.append('image', fileInput.files[0]);
        const res = await fetch(`/api/broadcasts/${_editId}/image`, {
          method: 'POST',
          body: fd,
          // No Content-Type header — browser sets multipart boundary automatically
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || res.statusText);
        }
      }
    } else {
      // ── Create mode ────────────────────────────────────────────────────
      // Send everything as multipart FormData so image is included in one request
      const fd = new FormData();
      fd.append('label',      label);
      fd.append('text',       text);
      fd.append('subjectId',  subjectId);
      fd.append('recurrence', JSON.stringify(recurrence));
      if (hasFile) fd.append('image', fileInput.files[0]);

      const res = await fetch('/api/broadcasts', {
        method: 'POST',
        body: fd,
        // No Content-Type header — browser sets multipart boundary automatically
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

  // Recurrence dropdowns
  ['bcast-freq', 'bcast-day', 'bcast-n', 'bcast-hour'].forEach(id => {
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
