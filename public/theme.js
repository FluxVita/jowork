/**
 * FluxVita Theme Manager
 *
 * 功能：
 * 1. 自动跟随系统 dark/light 偏好
 * 2. 手动切换覆盖系统偏好
 * 3. localStorage 持久化用户选择
 * 4. shell ↔ iframe 双向同步
 *
 * 使用：所有页面引入 <script src="/theme.js"></script>
 * 在 shell.html 中还需调用 ThemeManager.initShell() 启动同步
 */
;(function () {
  'use strict';

  const STORAGE_KEY = 'fluxvita_theme';

  // 三态：'dark' | 'light' | 'auto'
  function getSavedPreference() {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  }

  function savePreference(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* private browsing */ }
  }

  /** 检测系统偏好 */
  function systemPrefersDark() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /** 计算实际主题 */
  function resolveTheme(pref) {
    if (pref === 'dark' || pref === 'light') return pref;
    // auto: 跟随系统
    return systemPrefersDark() ? 'dark' : 'light';
  }

  /** 应用主题到当前文档 */
  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  /** 获取当前实际主题 */
  function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  // ─── 初始化：页面加载时立即应用（避免闪烁） ───
  const savedPref = getSavedPreference() || 'dark';
  const initialTheme = resolveTheme(savedPref);
  applyTheme(initialTheme);

  // ─── 监听系统偏好变化 ───
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    const pref = getSavedPreference() || 'dark';
    if (pref === 'auto') {
      applyTheme(resolveTheme('auto'));
      // 通知 iframe
      broadcastTheme();
    }
  });

  // ─── iframe 同步 ───

  /** 广播主题到所有 iframe（shell 调用） */
  function broadcastTheme() {
    const theme = getCurrentTheme();
    document.querySelectorAll('iframe').forEach(function (frame) {
      try {
        frame.contentWindow.postMessage({ type: 'THEME_CHANGE', theme: theme }, '*');
      } catch (e) { /* cross-origin safe */ }
    });
  }

  /** 监听来自 shell 的主题变更（iframe 内调用） */
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'THEME_CHANGE') {
      applyTheme(e.data.theme);
    }
  });

  // ─── 公共 API ───
  window.ThemeManager = {
    /** 获取当前偏好设置（dark/light/auto） */
    getPreference: function () {
      return getSavedPreference() || 'dark';
    },

    /** 获取当前实际显示的主题（dark/light） */
    getCurrent: getCurrentTheme,

    /** 设置主题偏好 */
    set: function (pref) {
      savePreference(pref);
      applyTheme(resolveTheme(pref));
      broadcastTheme();
    },

    /** 循环切换：auto → light → dark → auto */
    toggle: function () {
      var current = getSavedPreference() || 'dark';
      var next;
      if (current === 'auto') {
        // auto → 切换到当前相反的主题
        next = systemPrefersDark() ? 'light' : 'dark';
      } else if (current === 'light') {
        next = 'dark';
      } else {
        next = 'auto';
      }
      this.set(next);
      return next;
    },

    /** shell 初始化：让新加载的 iframe 也继承主题 */
    initShell: function () {
      // 监听 iframe 请求主题
      window.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'REQUEST_THEME') {
          var theme = getCurrentTheme();
          document.querySelectorAll('iframe').forEach(function (frame) {
            try {
              if (frame.contentWindow === e.source) {
                frame.contentWindow.postMessage({ type: 'THEME_CHANGE', theme: theme }, '*');
              }
            } catch (ex) { /* safe */ }
          });
        }
      });
    },

    /** iframe 初始化：向 shell 请求当前主题 */
    initIframe: function () {
      if (window.parent !== window) {
        try {
          window.parent.postMessage({ type: 'REQUEST_THEME' }, '*');
        } catch (e) { /* safe */ }
      }
    },

    /** 更新切换按钮 UI */
    updateToggleUI: function (iconEl) {
      if (!iconEl) return;
      var pref = getSavedPreference() || 'dark';
      if (pref === 'auto') {
        iconEl.textContent = '◑';
        iconEl.title = '主题：跟随系统';
      } else if (pref === 'light') {
        iconEl.textContent = '☀';
        iconEl.title = '主题：日间模式';
      } else {
        iconEl.textContent = '☾';
        iconEl.title = '主题：夜间模式';
      }
    }
  };

  // iframe 场景下自动请求主题
  if (window.parent !== window) {
    ThemeManager.initIframe();
  }

  // ─── Tauri 原生环境增强 ───
  if (typeof window.__TAURI__ !== 'undefined') {
    // 标记平台，供 CSS 精准控制原生样式
    document.documentElement.setAttribute('data-platform', 'tauri');
    // 禁止右键浏览器菜单（原生 App 不应弹出网页右键菜单）
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // brand-logo 从本地 Tauri bundle 加载，绕过 FRP 隧道延迟
    document.addEventListener('DOMContentLoaded', function () {
      var logo = document.getElementById('brand-logo');
      if (logo) logo.src = 'tauri://localhost/app-icon.png';
    });
  }
})();
