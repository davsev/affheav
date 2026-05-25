/**
 * tests/i18n/engine.test.js
 *
 * Tests the i18n engine (public/i18n/index.js):
 *   - t()             key lookup, fallback to 'he', unknown-key passthrough
 *   - getLang()       reflects current language
 *   - isRTL()         correct for he/en and unknown codes
 *   - initLang()      sets html[lang] / html[dir], applies translations
 *   - applyTranslations() walks DOM data-i18n* attributes
 *   - setLang()       updates lang + dir, calls fetch when persist=true
 *
 * Runs in jsdom so document / HTMLElement are available.
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Re-import the module with a fresh module state each time. */
async function freshEngine() {
  // Vitest caches ESM modules; bust the cache with a unique query string
  const url = `../../public/i18n/index.js?t=${Date.now()}`;
  return import(url);
}

// ── t() ──────────────────────────────────────────────────────────────────────

describe('t()', () => {
  it('returns the Hebrew string for a known key (default lang = he)', async () => {
    const { t } = await import('../../public/i18n/index.js');
    const { STRINGS } = await import('../../public/i18n/strings.js');
    expect(t('loginWithGoogle')).toBe(STRINGS.he.loginWithGoogle);
  });

  it('returns the key itself for an unknown key', async () => {
    const { t } = await import('../../public/i18n/index.js');
    expect(t('__nonExistentKey__')).toBe('__nonExistentKey__');
  });
});

// ── getLang() / isRTL() ──────────────────────────────────────────────────────

describe('getLang() and isRTL()', () => {
  it('getLang() returns "he" by default', async () => {
    const { getLang } = await import('../../public/i18n/index.js');
    expect(getLang()).toBe('he');
  });

  it('isRTL() is true for he', async () => {
    const { isRTL } = await import('../../public/i18n/index.js');
    expect(isRTL()).toBe(true);
  });

  it('isRTL() is false after switching to en (via setLang without persist)', async () => {
    const { setLang, isRTL } = await import('../../public/i18n/index.js');
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    await setLang('en', { persist: false });
    expect(isRTL()).toBe(false);
    // Restore
    await setLang('he', { persist: false });
  });
});

// ── initLang() ───────────────────────────────────────────────────────────────

describe('initLang()', () => {
  beforeEach(() => {
    document.documentElement.lang = '';
    document.documentElement.dir  = '';
    document.body.innerHTML = '';
  });

  it('sets html[lang] and html[dir="rtl"] for "he"', async () => {
    const { initLang } = await import('../../public/i18n/index.js');
    initLang('he');
    expect(document.documentElement.lang).toBe('he');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('sets html[lang] and html[dir="ltr"] for "en"', async () => {
    const { initLang } = await import('../../public/i18n/index.js');
    initLang('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('falls back to "he" for an unrecognised locale', async () => {
    const { initLang } = await import('../../public/i18n/index.js');
    initLang('xx');
    expect(document.documentElement.lang).toBe('he');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('applies translations to data-i18n elements', async () => {
    const { initLang } = await import('../../public/i18n/index.js');
    const { STRINGS } = await import('../../public/i18n/strings.js');
    document.body.innerHTML = `<span data-i18n="navDashboard"></span>`;
    initLang('he');
    const span = document.querySelector('[data-i18n="navDashboard"]');
    expect(span.textContent).toBe(STRINGS.he.navDashboard);
  });
});

// ── applyTranslations() ──────────────────────────────────────────────────────

describe('applyTranslations()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('fills data-i18n textContent', async () => {
    const { applyTranslations, initLang } = await import('../../public/i18n/index.js');
    const { STRINGS } = await import('../../public/i18n/strings.js');
    initLang('en');
    document.body.innerHTML = `<span data-i18n="navDashboard"></span>`;
    applyTranslations();
    expect(document.querySelector('[data-i18n]').textContent).toBe(STRINGS.en.navDashboard);
  });

  it('fills data-i18n-placeholder', async () => {
    const { applyTranslations, initLang } = await import('../../public/i18n/index.js');
    const { STRINGS } = await import('../../public/i18n/strings.js');
    initLang('he');

    // Find a key that is used as a placeholder in the real app; use any valid key
    const key = 'navDashboard';
    document.body.innerHTML = `<input data-i18n-placeholder="${key}" />`;
    applyTranslations();
    expect(document.querySelector('input').placeholder).toBe(STRINGS.he[key]);
  });

  it('fills data-i18n-title', async () => {
    const { applyTranslations, initLang } = await import('../../public/i18n/index.js');
    const { STRINGS } = await import('../../public/i18n/strings.js');
    initLang('he');
    const key = 'navSettings';
    document.body.innerHTML = `<button data-i18n-title="${key}"></button>`;
    applyTranslations();
    expect(document.querySelector('button').title).toBe(STRINGS.he[key]);
  });

  it('fills data-i18n-aria-label', async () => {
    const { applyTranslations, initLang } = await import('../../public/i18n/index.js');
    const { STRINGS } = await import('../../public/i18n/strings.js');
    initLang('he');
    const key = 'navLogs';
    document.body.innerHTML = `<button data-i18n-aria-label="${key}"></button>`;
    applyTranslations();
    expect(document.querySelector('button').getAttribute('aria-label')).toBe(STRINGS.he[key]);
  });

  it('fills data-i18n-html innerHTML', async () => {
    const { applyTranslations, initLang } = await import('../../public/i18n/index.js');
    const { STRINGS } = await import('../../public/i18n/strings.js');
    initLang('he');
    const key = 'navDashboard';
    document.body.innerHTML = `<div data-i18n-html="${key}"></div>`;
    applyTranslations();
    expect(document.querySelector('div').innerHTML).toBe(STRINGS.he[key]);
  });

  it('leaves elements with no data-i18n attributes untouched', async () => {
    const { applyTranslations } = await import('../../public/i18n/index.js');
    document.body.innerHTML = `<p id="plain">original</p>`;
    applyTranslations();
    expect(document.getElementById('plain').textContent).toBe('original');
  });
});

// ── setLang() ────────────────────────────────────────────────────────────────

describe('setLang()', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy;
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates html[lang] and html[dir] for en', async () => {
    const { setLang } = await import('../../public/i18n/index.js');
    await setLang('en', { persist: false });
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    // restore
    await setLang('he', { persist: false });
  });

  it('calls fetch when persist=true', async () => {
    const { setLang } = await import('../../public/i18n/index.js');
    await setLang('en', { persist: true });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/users/me/lang');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ lang: 'en' });
    // restore
    await setLang('he', { persist: false });
  });

  it('does NOT call fetch when persist=false', async () => {
    const { setLang } = await import('../../public/i18n/index.js');
    await setLang('en', { persist: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    // restore
    await setLang('he', { persist: false });
  });

  it('falls back to he for an unknown language code', async () => {
    const { setLang, getLang } = await import('../../public/i18n/index.js');
    await setLang('zz', { persist: false });
    expect(getLang()).toBe('he');
  });
});
