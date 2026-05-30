/**
 * Re-export from the existing i18n module and expose window.t + window.applyI18n
 * for any non-module legacy code that still uses them.
 */
export { t, getLang, isRTL, setLang, applyTranslations, initLang } from '../../i18n/index.js';

import { t, applyTranslations, setLang } from '../../i18n/index.js';

// Expose globally so app.js's t() stub and settings module can call without import
window.t = t;
window.applyI18n = (lang) => setLang(lang, { persist: false });
