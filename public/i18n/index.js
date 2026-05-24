import { STRINGS } from './strings.js';

// RTL language codes
const RTL_LANGS = new Set(['he', 'ar', 'fa', 'ur']);

let _lang = 'he';

// Resolved strings for the active language, falling back to 'he'
function strings() {
  return STRINGS[_lang] || STRINGS['he'];
}

/** Translate a key. Falls back to Hebrew, then to the key itself. */
export function t(key) {
  const s = strings();
  return s[key] ?? STRINGS['he'][key] ?? key;
}

/** Current language code, e.g. 'he' or 'en' */
export function getLang() {
  return _lang;
}

/** Whether the current language is RTL */
export function isRTL() {
  return RTL_LANGS.has(_lang);
}

/**
 * Switch language, update the <html> element, and re-apply all translations.
 * Persists to the server if a user is logged in.
 */
export async function setLang(lang, { persist = true } = {}) {
  if (!STRINGS[lang]) {
    console.warn(`[i18n] Unknown language "${lang}", falling back to "he"`);
    lang = 'he';
  }
  _lang = lang;

  const html = document.documentElement;
  html.lang = lang;
  html.dir  = isRTL() ? 'rtl' : 'ltr';

  applyTranslations();

  if (persist) {
    try {
      await fetch('/api/users/me/lang', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ lang }),
      });
    } catch {
      // non-critical
    }
  }
}

/**
 * Walk the DOM and replace text for elements carrying data-i18n attributes.
 *
 *   data-i18n="key"              → element.textContent = t(key)
 *   data-i18n-html="key"         → element.innerHTML   = t(key)
 *   data-i18n-placeholder="key"  → element.placeholder = t(key)
 *   data-i18n-title="key"        → element.title       = t(key)
 *   data-i18n-aria-label="key"   → element.ariaLabel   = t(key)
 */
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
}

/**
 * Initialise from the user's preferred language.
 * Call once after the user object is available.
 */
export function initLang(preferredLang) {
  const lang = preferredLang && STRINGS[preferredLang] ? preferredLang : 'he';
  // setLang without persisting — it's already stored server-side
  _lang = lang;
  const html = document.documentElement;
  html.lang = lang;
  html.dir  = isRTL() ? 'rtl' : 'ltr';
  applyTranslations();
}
