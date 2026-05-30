/**
 * settings/index.js — Settings tab coordinator.
 * Manages three sub-panels: general, whatsapp, niches.
 */
import { init as initWhatsApp } from './whatsapp.js';
import { init as initNiches }   from './niches.js';

let _booted = false;

export function init(state) {
  if (_booted) return;
  _booted = true;

  wireSettingsTabs();
  initGeneralSettings(state);
  initWhatsApp(state);
  initNiches(state);
}

function wireSettingsTabs() {
  document.querySelectorAll('[data-settings-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-settings-tab]').forEach(t => t.classList.remove('is-active'));
      tab.classList.add('is-active');

      document.querySelectorAll('[id^="settings-panel-"]').forEach(p => p.classList.remove('is-active'));
      const panel = document.getElementById(`settings-panel-${tab.dataset.settingsTab}`);
      panel?.classList.add('is-active');
    });
  });
}

function initGeneralSettings(state) {
  const { preferredLang } = state.user || {};

  const heBtn = document.getElementById('btn-lang-he');
  const enBtn = document.getElementById('btn-lang-en');

  if (preferredLang === 'he') {
    heBtn?.classList.add('btn--primary');
    heBtn?.classList.remove('btn--secondary');
  }

  heBtn?.addEventListener('click', () => setLang('he', state));
  enBtn?.addEventListener('click', () => setLang('en', state));
}

async function setLang(lang, state) {
  try {
    await fetch('/api/users/me/lang', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ lang }),
    });
    state.user.preferredLang = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir  = lang === 'he' ? 'rtl' : 'ltr';
    if (window.applyI18n) window.applyI18n(lang);
  } catch {}
}
