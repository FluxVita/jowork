// @jowork/core/i18n — lightweight internationalization
//
// Simple key-value lookup with inlined locale data.
// No runtime file I/O, no external dependencies, no build-time complications.
// English is the default; community can contribute new locales via registerLocale().
//
// Usage:
//   import { t, setLocale, registerLocale } from '@jowork/core';
//   t('error.not_found')          // → 'Not found'
//   t('error.not_found', 'zh')    // → '未找到'

type LocaleMap = Record<string, string>;
type Locales = Record<string, LocaleMap>;

// ─── Built-in locale data ─────────────────────────────────────────────────────

const en: LocaleMap = {
  'error.unauthorized':      'Unauthorized',
  'error.forbidden':         'Forbidden',
  'error.not_found':         'Not found',
  'error.bad_request':       'Bad request',
  'error.internal':          'Internal server error',
  'error.connector_not_found': 'Connector not found',
  'error.session_not_found': 'Session not found',
  'error.agent_not_found':   'Agent not found',
  'error.invalid_model':     'Invalid model',
  'error.rate_limited':      'Rate limit exceeded, please try again later',

  'session.default_title':   'New chat',
  'session.created':         'Session created',
  'session.deleted':         'Session deleted',

  'agent.greeting':          "Hello! I'm your AI coworker. How can I help you today?",
  'agent.thinking':          'Thinking...',
  'agent.error':             'Sorry, I encountered an error. Please try again.',

  'connector.connected':     'Connected',
  'connector.disconnected':  'Disconnected',
  'connector.syncing':       'Syncing...',
  'connector.sync_complete': 'Sync complete',
  'connector.auth_required': 'Authentication required',

  'context.saved':           'Context saved',
  'context.not_found':       'Context document not found',

  'memory.saved':            'Memory saved',
  'memory.not_found':        'Memory not found',

  'onboarding.welcome':      'Welcome to Jowork!',
  'onboarding.setup_agent':  'Set up your AI agent',
  'onboarding.connect_tools':'Connect your tools',
  'onboarding.complete':     "You're all set!",

  'health.ok':               'OK',
  'health.degraded':         'Degraded',
  'health.error':            'Error',

  'ui.new_chat':             'New chat',
  'ui.send':                 'Send',
  'ui.connected':            'Connected',
  'ui.offline':              'Offline',
  'ui.start_conversation':   'Start a conversation with your AI coworker.',
  'ui.input_placeholder':    'Ask your AI coworker anything... (Enter to send, Shift+Enter for newline)',
  'ui.your_ai_coworker':     'Your AI coworker',
};

const zh: LocaleMap = {
  'error.unauthorized':      '未授权',
  'error.forbidden':         '禁止访问',
  'error.not_found':         '未找到',
  'error.bad_request':       '请求无效',
  'error.internal':          '服务器内部错误',
  'error.connector_not_found': '连接器不存在',
  'error.session_not_found': '会话不存在',
  'error.agent_not_found':   'Agent 不存在',
  'error.invalid_model':     '无效的模型',
  'error.rate_limited':      '请求过于频繁，请稍后再试',

  'session.default_title':   '新对话',
  'session.created':         '会话已创建',
  'session.deleted':         '会话已删除',

  'agent.greeting':          '你好！我是你的 AI 同事，有什么可以帮你的？',
  'agent.thinking':          '正在思考...',
  'agent.error':             '抱歉，遇到了一个错误，请重试。',

  'connector.connected':     '已连接',
  'connector.disconnected':  '已断开',
  'connector.syncing':       '同步中...',
  'connector.sync_complete': '同步完成',
  'connector.auth_required': '需要身份验证',

  'context.saved':           '上下文已保存',
  'context.not_found':       '上下文文档不存在',

  'memory.saved':            '记忆已保存',
  'memory.not_found':        '记忆不存在',

  'onboarding.welcome':      '欢迎使用 Jowork！',
  'onboarding.setup_agent':  '配置你的 AI Agent',
  'onboarding.connect_tools':'连接你的工具',
  'onboarding.complete':     '一切就绪！',

  'health.ok':               '正常',
  'health.degraded':         '降级',
  'health.error':            '错误',

  'ui.new_chat':             '新对话',
  'ui.send':                 '发送',
  'ui.connected':            '已连接',
  'ui.offline':              '离线',
  'ui.start_conversation':   '开始和你的 AI 同事对话吧。',
  'ui.input_placeholder':    '问你的 AI 同事任何问题...（Enter 发送，Shift+Enter 换行）',
  'ui.your_ai_coworker':     '你的 AI 同事',
};

// ─── Registry ─────────────────────────────────────────────────────────────────

const locales: Locales = { en, zh };
let _defaultLocale = 'en';

// ─── Public API ───────────────────────────────────────────────────────────────

/** Set the process-wide default locale (e.g. from config or user preference) */
export function setLocale(locale: string): void {
  _defaultLocale = locale;
}

/** Get the current default locale */
export function getLocale(): string {
  return _defaultLocale;
}

/**
 * Translate a key.
 * Falls back to English when locale or key is missing.
 * Returns the key itself as last resort (safe for production).
 */
export function t(key: string, locale?: string): string {
  const lang = locale ?? _defaultLocale;
  return locales[lang]?.[key] ?? locales['en']?.[key] ?? key;
}

/**
 * Register a custom locale (e.g. from a plugin or community contribution).
 * Merges with an existing locale if already loaded.
 */
export function registerLocale(name: string, messages: LocaleMap): void {
  locales[name] = { ...(locales[name] ?? {}), ...messages };
}

/** List all registered locale codes */
export function availableLocales(): string[] {
  return Object.keys(locales);
}
