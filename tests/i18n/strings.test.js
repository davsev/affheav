/**
 * tests/i18n/strings.test.js
 *
 * Validates the STRINGS dictionary:
 *   - Both locales export the exact same set of keys (key parity)
 *   - Every value is a non-empty string
 *   - No locale is missing or misspelled
 */

import { describe, it, expect } from 'vitest';
import { STRINGS } from '../../public/i18n/strings.js';

const LOCALES = ['he', 'en'];

describe('STRINGS shape', () => {
  it('exports an object', () => {
    expect(STRINGS).toBeTypeOf('object');
    expect(STRINGS).not.toBeNull();
  });

  it('contains exactly the expected locales', () => {
    expect(Object.keys(STRINGS).sort()).toEqual(LOCALES.slice().sort());
  });

  for (const locale of LOCALES) {
    it(`locale "${locale}" is a non-empty object`, () => {
      expect(STRINGS[locale]).toBeTypeOf('object');
      expect(Object.keys(STRINGS[locale]).length).toBeGreaterThan(0);
    });
  }
});

describe('key parity between he and en', () => {
  it('he and en have identical key sets', () => {
    const heKeys = Object.keys(STRINGS.he).sort();
    const enKeys = Object.keys(STRINGS.en).sort();
    expect(enKeys).toEqual(heKeys);
  });

  it('no key exists in he but is missing from en', () => {
    const enKeySet = new Set(Object.keys(STRINGS.en));
    const missing = Object.keys(STRINGS.he).filter(k => !enKeySet.has(k));
    expect(missing).toEqual([]);
  });

  it('no key exists in en but is missing from he', () => {
    const heKeySet = new Set(Object.keys(STRINGS.he));
    const missing = Object.keys(STRINGS.en).filter(k => !heKeySet.has(k));
    expect(missing).toEqual([]);
  });
});

// A small set of keys are intentionally empty in the 'en' locale:
// they form the "prefix" portion of a split decorative title where
// only the highlighted word is shown in English (e.g. "" + "Dashboard").
const INTENTIONALLY_EMPTY_EN = new Set([
  'dashboardTitle',
  'schedulesTitle',
  'analyticsTitle',
  'logsTitle',
]);

describe('value quality', () => {
  for (const locale of LOCALES) {
    it(`all values in "${locale}" are strings`, () => {
      const nonStrings = Object.entries(STRINGS[locale])
        .filter(([, v]) => typeof v !== 'string')
        .map(([k]) => k);
      expect(nonStrings).toEqual([]);
    });
  }

  it('all values in "he" are non-empty strings', () => {
    const bad = Object.entries(STRINGS.he)
      .filter(([, v]) => v.trim() === '')
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it('all values in "en" are non-empty strings (except known intentional blanks)', () => {
    const bad = Object.entries(STRINGS.en)
      .filter(([k, v]) => !INTENTIONALLY_EMPTY_EN.has(k) && v.trim() === '')
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });
});

describe('spot-checks', () => {
  it('he loginWithGoogle contains Google', () => {
    expect(STRINGS.he.loginWithGoogle).toContain('Google');
  });

  it('en loginWithGoogle contains Google', () => {
    expect(STRINGS.en.loginWithGoogle).toContain('Google');
  });

  it('he and en loginWithGoogle are different strings', () => {
    expect(STRINGS.he.loginWithGoogle).not.toBe(STRINGS.en.loginWithGoogle);
  });
});
