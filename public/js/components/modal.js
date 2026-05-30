/**
 * modal.js — Generic modal helpers.
 *
 * openModal(overlayId)   — adds is-open class
 * closeModal(overlayId)  — removes is-open class
 * confirm(message)       — returns Promise<boolean>
 */

export function openModal(overlayId) {
  document.getElementById(overlayId)?.classList.add('is-open');
}

export function closeModal(overlayId) {
  document.getElementById(overlayId)?.classList.remove('is-open');
}

/** Wire a close button to close its parent overlay */
export function wireCloseBtn(btnId, overlayId) {
  document.getElementById(btnId)?.addEventListener('click', () => closeModal(overlayId));
}

/** Close modal when clicking the overlay backdrop */
export function wireOverlayClose(overlayId) {
  const el = document.getElementById(overlayId);
  if (!el) return;
  el.addEventListener('click', (e) => {
    if (e.target === el) closeModal(overlayId);
  });
}

/** Show generic confirm dialog, returns true/false */
export function confirm(message, { title = 'Confirm', okLabel, okClass = 'btn--danger' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-modal-overlay');
    const msgEl   = document.getElementById('confirm-modal-message');
    const titleEl = document.getElementById('confirm-modal-title');
    const okBtn   = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');

    if (!overlay) { resolve(window.confirm(message)); return; }

    if (msgEl)   msgEl.textContent   = message;
    if (titleEl) titleEl.textContent = title;
    if (okBtn && okLabel) okBtn.textContent = okLabel;

    openModal('confirm-modal-overlay');

    const cleanup = (result) => {
      closeModal('confirm-modal-overlay');
      resolve(result);
    };

    okBtn?.addEventListener('click',     () => cleanup(true),  { once: true });
    cancelBtn?.addEventListener('click', () => cleanup(false), { once: true });
    document.getElementById('confirm-modal-close')?.addEventListener('click', () => cleanup(false), { once: true });
  });
}
