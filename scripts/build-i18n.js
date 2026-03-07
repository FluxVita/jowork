#!/usr/bin/env node
/**
 * scripts/build-i18n.js
 * 从 packages/core/src/locales/*.json 生成 public/i18n.js
 *
 * 用法：node scripts/build-i18n.js
 * 在 core 包 build 后自动执行（见 package.json postbuild）
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const en = JSON.parse(readFileSync(resolve(root, 'packages/core/src/locales/en.json'), 'utf8'));
const zh = JSON.parse(readFileSync(resolve(root, 'packages/core/src/locales/zh.json'), 'utf8'));

const output = `/**
 * Jowork 前端 i18n 模块（自动生成，勿手动修改）
 * 源文件：packages/core/src/locales/*.json
 * 生成命令：node scripts/build-i18n.js
 *
 * - 从 localStorage('jowork_locale') 或浏览器语言自动选择语言
 * - 支持 data-i18n="key"（textContent）
 * - 支持 data-i18n-default="key"（初始占位文本，等同 data-i18n，JS 可后续覆盖）
 * - 支持 data-i18n-placeholder="key"（placeholder 属性）
 * - 支持 data-i18n-html="key"（innerHTML，用于含 HTML 标签的翻译）
 * - 暴露全局 window.t(key, vars) 供 JS 代码使用
 */
(function () {
  var MESSAGES = {
    en: ${JSON.stringify(en, null, 4).replace(/^/gm, '    ').trim()},
    zh: ${JSON.stringify(zh, null, 4).replace(/^/gm, '    ').trim()}
  };

  function detectLocale() {
    try {
      var stored = localStorage.getItem('jowork_locale');
      if (stored === 'zh' || stored === 'en') return stored;
    } catch (e) { /* ignore */ }
    var lang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    return lang.startsWith('zh') ? 'zh' : 'en';
  }

  var locale = detectLocale();
  var msgs = Object.assign({}, MESSAGES.en, MESSAGES[locale] || {});

  window.__jowork_locale = locale;
  window.__jowork_i18n = msgs;

  window.t = function (key, vars) {
    var text = msgs[key] !== undefined ? msgs[key] : key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        text = text.replace(new RegExp('{' + k + '}', 'g'), String(vars[k]));
      });
    }
    return text;
  };

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (msgs[key] !== undefined) el.textContent = msgs[key];
    });
    document.querySelectorAll('[data-i18n-default]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-default');
      if (msgs[key] !== undefined) el.textContent = msgs[key];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (msgs[key] !== undefined) el.innerHTML = msgs[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (msgs[key] !== undefined) el.setAttribute('placeholder', msgs[key]);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyI18n);
  } else {
    applyI18n();
  }

  window.__applyI18n = applyI18n;
})();
`;

const targets = [
  resolve(root, 'public/i18n.js'),
  resolve(root, 'apps/jowork/public/i18n.js'),
];

for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, output, 'utf8');
}

console.log('[build-i18n] Generated i18n.js for public/ and apps/jowork/public/');
