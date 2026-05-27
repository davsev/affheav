// ── Schedule Edit Modal ───────────────────────────────────────────────────────
// Manages the add-form cron builder and the edit modal.

import { api }               from './utils.js';
import { createCronBuilder } from './cron-builder.js';
import { t }                 from './i18n/index.js';
import { populateTimezoneSelect } from './timezones.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _addCronExpr    = '0 12 * * *';
let _editCronExpr   = '0 12 * * *';
let _editScheduleId = null;
let _refreshList    = () => {};  // injected by app.js via init()

// ── Mount both builders ───────────────────────────────────────────────────────
const _addBuilder = createCronBuilder('cron-builder', expr => {
  _addCronExpr = expr;
  const hidden = document.getElementById('sched-cron');
  if (hidden) hidden.value = expr;
});

const _editBuilder = createCronBuilder('edit-cron-builder', expr => {
  _editCronExpr = expr;
});

// Pre-populate timezone selects; default add-form to browser's local timezone
document.addEventListener('DOMContentLoaded', () => {
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const addSel  = document.getElementById('sched-timezone');
  const editSel = document.getElementById('edit-sched-timezone');
  if (addSel)  populateTimezoneSelect(addSel,  localTz);
  if (editSel) populateTimezoneSelect(editSel, 'UTC');
});

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called once from app.js to inject cross-module callbacks.
 * @param {{ loadSchedules: function }} callbacks
 */
export function init({ loadSchedules }) {
  _refreshList = loadSchedules;
}

/** Reset the add-form builder to defaults (called after a successful add). */
export function resetCronBuilder() {
  _addBuilder?.reset();
}

// ── Edit modal ────────────────────────────────────────────────────────────────

window.openEditSchedule = function(id, label, cron, timezone) {
  _editScheduleId = id;
  document.getElementById('edit-sched-label').value = label;
  _editBuilder?.setExpr(cron);
  const tzSel = document.getElementById('edit-sched-timezone');
  if (tzSel) populateTimezoneSelect(tzSel, timezone || 'UTC');
  document.getElementById('edit-sched-modal').style.display = 'flex';
  requestAnimationFrame(() => document.getElementById('edit-sched-label').focus());
};

window.closeEditModal = function() {
  document.getElementById('edit-sched-modal').style.display = 'none';
  _editScheduleId = null;
};

window.saveEditSchedule = async function() {
  const label    = document.getElementById('edit-sched-label').value.trim();
  const cron     = _editCronExpr;
  const timezone = document.getElementById('edit-sched-timezone')?.value || 'UTC';
  if (!label || !cron) return alert(t('scheduleRequired'));
  const btn = document.getElementById('btn-save-edit-sched');
  btn.disabled = true; btn.textContent = t('savingEllipsis');
  try {
    await api(`/api/schedules/${_editScheduleId}`, { method: 'PUT', body: { label, cron, timezone } });
    window.closeEditModal();
    await _refreshList();
  } catch (err) {
    alert(t('errGeneral') + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:15px;">check</span>${t('btnSave')}`;
  }
};

document.addEventListener('keydown', e => { if (e.key === 'Escape') window.closeEditModal(); });
