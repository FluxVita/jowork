/**
 * Tauri API Bridge
 *
 * 在 Tauri 桌面 App 中，UI 从 tauri://localhost 加载（本地文件），
 * 但 API 调用需要发到本地代理（http://127.0.0.1:19801）。
 *
 * 此脚本拦截 fetch() 和 WebSocket() 的相对路径调用，
 * 将它们重定向到正确的代理地址。
 *
 * 激活条件：window.__TAURI_PROXY_BASE__ 已设置（由 Rust initialization_script 注入）
 * 必须在 conn-retry.js 和业务脚本之前加载。
 */

/**
 * WKWebView Inline Event Handler Polyfill
 *
 * Tauri WKWebView 不执行 HTML 属性中的 inline event handler（onclick, onchange 等）。
 * 此 polyfill 自动将这些属性转为 addEventListener，包括后续通过 innerHTML 动态添加的元素。
 * 仅在 tauri:// 协议下激活，对浏览器无影响。
 */
(function () {
  var isTauri = location.protocol === 'tauri:';
  if (!isTauri) {
    try { isTauri = window.parent !== window && window.parent.location.protocol === 'tauri:'; } catch (e) {}
  }
  if (!isTauri) return;

  var EVENTS = 'click,change,input,submit,keydown,keyup,focus,blur,dblclick,contextmenu'.split(',');
  var SELECTOR = EVENTS.map(function (e) { return '[on' + e + ']'; }).join(',');

  function patchEl(el) {
    for (var i = 0; i < EVENTS.length; i++) {
      var attr = 'on' + EVENTS[i];
      var code = el.getAttribute(attr);
      if (!code) continue;
      el.removeAttribute(attr);
      el.addEventListener(EVENTS[i], (function (c, elem) {
        return function (e) {
          var result = (new Function('event', c)).call(elem, e);
          if (result === false) { e.preventDefault(); e.stopPropagation(); }
        };
      })(code, el));
    }
  }

  function patchTree(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.nodeType === 1 && root.matches && root.matches(SELECTOR)) patchEl(root);
    var nodes = root.querySelectorAll(SELECTOR);
    for (var i = 0; i < nodes.length; i++) patchEl(nodes[i]);
  }

  function init() {
    patchTree(document.body);
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) patchTree(added[j]);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
(function () {
  // 主框架通过 initialization_script 注入，iframe 从父窗口继承
  var PROXY_BASE = window.__TAURI_PROXY_BASE__;
  if (!PROXY_BASE && window.parent !== window) {
    try { PROXY_BASE = window.parent.__TAURI_PROXY_BASE__; } catch (e) { /* cross-origin */ }
  }
  if (!PROXY_BASE) return;

  // 缓存到当前 window，供子 iframe 继承
  window.__TAURI_PROXY_BASE__ = PROXY_BASE;

  var proxyUrl = new URL(PROXY_BASE);
  var PROXY_HOST = proxyUrl.hostname;
  var PROXY_PORT = proxyUrl.port;
  var WS_PROTOCOL = proxyUrl.protocol === 'https:' ? 'wss:' : 'ws:';

  // ── 恢复持久化 token ──
  var persistedToken = window.__PERSISTED_TOKEN__;
  if (persistedToken) {
    var tokenKey = window.__TOKEN_STORAGE_KEY__ || 'jowork_token';
    try {
      if (!localStorage.getItem(tokenKey)) {
        localStorage.setItem(tokenKey, persistedToken);
      }
    } catch (e) { /* localStorage 不可用 */ }
  }

  // ── Patch fetch：相对路径 → 代理 ──
  var _fetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === 'string' && input.startsWith('/')) {
      input = PROXY_BASE + input;
    }
    return _fetch.call(this, input, init);
  };

  // ── Patch WebSocket：同源连接 → 代理 ──
  var _WebSocket = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    if (typeof url === 'string') {
      // 不拦截已经指向 127.0.0.1 的连接（如本地 PTY WS）
      if (url.indexOf('127.0.0.1') === -1 && url.indexOf('[::1]') === -1) {
        try {
          var u = new URL(url);
          if (u.hostname === 'localhost' || u.hostname === location.hostname) {
            u.hostname = PROXY_HOST;
            u.port = PROXY_PORT;
            u.protocol = WS_PROTOCOL;
            url = u.toString();
          }
        } catch (e) { /* 无法解析的 URL，不处理 */ }
      }
    }
    return protocols !== undefined ? new _WebSocket(url, protocols) : new _WebSocket(url);
  };
  window.WebSocket.prototype = _WebSocket.prototype;
  window.WebSocket.CONNECTING = _WebSocket.CONNECTING;
  window.WebSocket.OPEN = _WebSocket.OPEN;
  window.WebSocket.CLOSING = _WebSocket.CLOSING;
  window.WebSocket.CLOSED = _WebSocket.CLOSED;
})();
