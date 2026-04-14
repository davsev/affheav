// ── Schedule Edit Modal ───────────────────────────────────────────────────────
// Manages the add-form cron builder and the edit modal.

import { api }               from './utils.js';
import { createCronBuilder } from './cron-builder.js';

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

window.openEditSchedule = function(id, label, cron) {
  _editScheduleId = id;
  document.getElementById('edit-sched-label').value = label;
  _editBuilder?.setExpr(cron);
  document.getElementById('edit-sched-modal').style.display = 'flex';
  requestAnimationFrame(() => document.getElementById('edit-sched-label').focus());
};

window.closeEditModal = function() {
  document.getElementById('edit-sched-modal').style.display = 'none';
  _editScheduleId = null;
};

window.saveEditSchedule = async function() {
  const label = document.getElementById('edit-sched-label').value.trim();
  const cron  = _editCronExpr;
  if (!label || !cron) return alert('יש למלא שם וביטוי cron');
  const btn = document.getElementById('btn-save-edit-sched');
  btn.disabled = true; btn.textContent = 'שומר...';
  try {
    await api(`/api/schedules/${_editScheduleId}`, { method: 'PUT', body: { label, cron } });
    window.closeEditModal();
    await _refreshList();
  } catch (err) {
    alert('שגיאה: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px;">check</span>שמור';
  }
};

document.addEventListener('keydown', e => { if (e.key === 'Escape') window.closeEditModal(); });
