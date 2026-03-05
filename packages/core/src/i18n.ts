/**
 * 轻量 i18n 模块
 *
 * 设计原则：
 * - 不引入任何外部依赖，保持零依赖
 * - 英文为默认语言（开源版首选）
 * - 支持简单的 {variable} 占位符替换
 * - 前端使用 data-i18n 属性方案（见 applyI18n）
 */

import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const en = _require('./locales/en.json') as Record<string, string>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const zh = _require('./locales/zh.json') as Record<string, string>;

type Locale = 'en' | 'zh';
type Messages = Record<string, string>;

const locales: Record<Locale, Messages> = { en, zh };

/** 当前运行时语言（默认英文） */
let currentLocale: Locale = (process.env['JOWORK_LOCALE'] as Locale) || 'en';

/** 获取当前语言 */
export function getLocale(): Locale {
  return currentLocale;
}

/** 设置当前语言 */
export function setLocale(locale: Locale): void {
  if (locales[locale]) currentLocale = locale;
}

/**
 * 翻译文本。
 * @param key 翻译键，如 "error.unauthorized"
 * @param vars 可选占位符替换，如 { tool: 'search_data' }
 * @param locale 可选语言覆盖
 */
export function t(key: string, vars?: Record<string, string | number>, locale?: Locale): string {
  const lang = locale ?? currentLocale;
  const messages = locales[lang] ?? locales.en;
  let text = messages[key] ?? locales.en[key] ?? key;

  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return text;
}

/**
 * 前端 i18n 辅助函数（注入到 HTML 页面的 <script> 块）。
 * 基于 data-i18n 属性：<span data-i18n="nav.chat">Chat</span>
 *
 * 此函数序列化为字符串后注入 HTML，不在 Node.js 侧运行。
 */
export function clientI18nScript(messages: Messages, locale: string): string {
  return `
(function() {
  var i18n = ${JSON.stringify(messages)};
  var locale = ${JSON.stringify(locale)};
  window.__jowork_i18n = i18n;
  window.__jowork_locale = locale;
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      if (i18n[key]) el.textContent = i18n[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (i18n[key]) el.setAttribute('placeholder', i18n[key]);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyI18n);
  } else {
    applyI18n();
  }
})();
`.trim();
}

/** 获取当前语言对应的所有翻译（供客户端注入使用） */
export function getClientMessages(locale?: Locale): Messages {
  const lang = locale ?? currentLocale;
  return { ...locales.en, ...(locales[lang] ?? {}) };
}
