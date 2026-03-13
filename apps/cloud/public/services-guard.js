/**
 * 服务权限守卫 — JoWork 版
 */
window.ServicesGuard = (() => {
  let _services = [];
  let _resolved = false;
  let _resolveReady;
  const _ready = new Promise(r => { _resolveReady = r; });

  function getToken() {
    return localStorage.getItem('jowork_token');
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

  function guardPage(pageServiceId) {
    if (!_resolved) return;
    const token = getToken();
    if (!token) return;
    if (window.parent !== window) return;
    if (!hasService(pageServiceId)) {
      alert('您没有访问此页面的权限');
      location.href = '/';
    }
  }

  function filterNavLinks() {
    document.querySelectorAll('[data-service]').forEach(el => {
      const svcId = el.getAttribute('data-service');
      if (svcId && !hasService(svcId)) {
        el.style.display = 'none';
      }
    });
  }

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
