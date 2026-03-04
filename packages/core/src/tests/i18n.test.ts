// Tests for i18n module

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { t, setLocale, getLocale, registerLocale, availableLocales } from '../i18n.js';

describe('i18n', () => {
  test('returns English by default', () => {
    setLocale('en');
    assert.equal(t('error.not_found'), 'Not found');
  });

  test('translates to Chinese when locale is zh', () => {
    assert.equal(t('error.not_found', 'zh'), '未找到');
  });

  test('falls back to English when key missing in zh', () => {
    // Temporarily register a locale without this key
    registerLocale('fr', {});
    assert.equal(t('error.not_found', 'fr'), 'Not found');
  });

  test('falls back to key when not found in any locale', () => {
    assert.equal(t('nonexistent.key'), 'nonexistent.key');
  });

  test('setLocale and getLocale round-trip', () => {
    setLocale('zh');
    assert.equal(getLocale(), 'zh');
    setLocale('en'); // reset
    assert.equal(getLocale(), 'en');
  });

  test('registerLocale adds new locale', () => {
    registerLocale('ja', { 'error.not_found': '見つかりません' });
    assert.equal(t('error.not_found', 'ja'), '見つかりません');
    assert.ok(availableLocales().includes('ja'));
  });

  test('availableLocales includes en and zh', () => {
    const locales = availableLocales();
    assert.ok(locales.includes('en'));
    assert.ok(locales.includes('zh'));
  });
});
