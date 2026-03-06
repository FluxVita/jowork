/**
 * 服务权限守卫 — 各页面引入后自动检查当前用户可用的服务。
 *
 * 用法：
 *   <script src="/services-guard.js"></script>
 *   // 等待就绪后使用：
 *   await ServicesGuard.ready;
 *   ServicesGuard.hasService('svc_page_chat'); // true/false
 *   ServicesGuard.getServices(); // ResolvedService[]
 */
window.ServicesGuard = (() => {
  let _services = [];
  let _resolved = false;
  let _resolveReady;
  const _ready = new Promise(r => { _resolveReady = r; });

  // 从 localStorage 取 token（chat 用 fluxvita_token，admin 用 fv_admin_token）
  function getToken() {
    return localStorage.getItem('fluxvita_token') || localStorage.getItem('fv_admin_token');
  }

  async function load() {
    const token = getToken();
    if (!token) {
      _resolved = true;
      _resolveReady(_services);
      return;
    }

    try {
      const resp = await fetch('/api/services/mine', {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (resp.ok) {
        const data = await resp.json();
        _services = data.services || [];
      }
    } catch {
      // 静默失败
    }

    _resolved = true;
    _resolveReady(_services);
  }

  function hasService(serviceId) {
    return _services.some(s => s.service_id === serviceId);
  }

  function hasServiceType(type) {
    return _services.some(s => s.type === type);
  }

  function getServices() {
    return _services;
  }

  function getByType(type) {
    return _services.filter(s => s.type === type);
  }

  /**
   * 检查页面访问权限。如果不允许，跳转到首页。
   * @param {string} pageServiceId - 页面对应的服务 ID（如 svc_page_chat）
   */
  function guardPage(pageServiceId) {
    if (!_resolved) return; // 还没加载完，不拦截
    const token = getToken();
    if (!token) return; // 未登录用户不拦截（交给页面自身登录逻辑）
    // iframe 内不执行跳转（shell 已控制 tab 可见性）
    if (window.parent !== window) return;
    if (!hasService(pageServiceId)) {
      // 没权限，跳转首页
      alert('您没有访问此页面的权限');
      location.href = '/';
    }
  }

  /**
   * 根据服务权限过滤导航链接。
   * 查找所有带 data-service 属性的元素，隐藏无权限的。
   * <a href="/chat.html" data-service="svc_page_chat">AI 助手</a>
   */
  function filterNavLinks() {
    document.querySelectorAll('[data-service]').forEach(el => {
      const svcId = el.getAttribute('data-service');
      if (svcId && !hasService(svcId)) {
        el.style.display = 'none';
      }
    });
  }

  // 自动加载
  load();

  return {
    ready: _ready,
    hasService,
    hasServiceType,
    getServices,
    getByType,
    guardPage,
    filterNavLinks,
    reload: load,
  };
})();
