/**
 * toast.js — Toast notification system.
 * Usage: import { toast } from './components/toast.js'
 *        toast.success('Done!', 'Product sent')
 *        toast.error('Failed', err.message)
 */

const ICONS = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
const DEFAULT_DURATION = 4000;

let container;

function getContainer() {
  if (!container) container = document.getElementById('toast-container');
  return container;
}

function show(type, title, message = '', duration = DEFAULT_DURATION) {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `
    <span class="toast__icon" aria-hidden="true">${ICONS[type] || 'ℹ️'}</span>
    <div class="toast__content">
      <div class="toast__title">${title}</div>
      ${message ? `<div class="toast__message">${message}</div>` : ''}
    </div>
    <button class="toast__close" aria-label="Close">✕</button>
    <div class="toast__progress" style="animation-duration:${duration}ms"></div>
  `;

  const close = () => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };

  el.querySelector('.toast__close').addEventListener('click', close);
  getContainer()?.appendChild(el);

  const timer = setTimeout(close, duration);
  el.querySelector('.toast__close').addEventListener('click', () => clearTimeout(timer), { once: true });
}

export const toast = {
  success: (title, msg, dur) => show('success', title, msg, dur),
  error:   (title, msg, dur) => show('error',   title, msg, dur),
  warning: (title, msg, dur) => show('warning', title, msg, dur),
  info:    (title, msg, dur) => show('info',    title, msg, dur),
};
