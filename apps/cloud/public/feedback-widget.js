/**
 * FluxVita 精准标注反馈系统 v2
 *
 * 使用方式：
 *   - 单击铅笔按钮 → 打开/关闭标注列表
 *   - 双击铅笔按钮 → 进入/退出标注模式
 *   - 标注模式下点击页面任意位置 → 掉针 + 输入框
 *   - 列表面板点"导出给 AI" → 生成 markdown 文件
 *
 * 精准信息：面板名、坐标(%)、CSS 元素路径、时间、视口
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'fluxvita_annotations_v2';

  // 面板 ID → 显示名 / 文件名
  const PANEL_NAMES = {
    chat:       'AI 助手 (/chat.html)',
    dashboard:  '数据看板 (/dashboard.html)',
    admin:      '管理后台 (/admin.html)',
    aiservices: 'AI 服务 (/ai-services.html)',
    billing:    '订阅升级 (/billing.html)',
    logs:       '日志 (/logs.html)',
    geek:       '极客终端 (/geek.html)',
    context:    '上下文 (/context.html)',
  };
  const PANEL_FILES = {
    chat:       '/chat.html',
    dashboard:  '/dashboard.html',
    admin:      '/admin.html',
    aiservices: '/ai-services.html',
    billing:    '/billing.html',
    logs:       '/logs.html',
    geek:       '/geek.html',
    context:    '/context.html',
  };
  const FILE_TO_PANEL = Object.fromEntries(
    Object.entries(PANEL_FILES).map(([k, v]) => [v, k])
  );

  // ─── App 标识（从 <meta name="x-app-id"> 读取，区分 FluxVita / jowork）───
  const APP_ID = document.querySelector('meta[name="x-app-id"]')?.content || 'unknown';

  // ─── 数据 ───
  let annotations = [];
  try { annotations = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch {}

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations));
    updateBadge();
  }

  // ─── 获取当前激活面板 ───
  function getActivePanel() {
    const frame = document.querySelector('.panel-frame.active');
    if (frame) {
      const panelId = frame.id.replace('frame-', '');
      return {
        name:    PANEL_NAMES[panelId] || panelId,
        file:    PANEL_FILES[panelId] || '/' + panelId + '.html',
        panelId: panelId,
        iframe:  frame,
        rect:    frame.getBoundingClientRect(),
      };
    }
    return {
      name:    document.title || location.pathname,
      file:    location.pathname,
      panelId: '',
      iframe:  null,
      rect:    { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight },
    };
  }

  // ─── 元素信息收集（用于 AI 可读定位）───
  function getElementInfo(el) {
    if (!el || !el.tagName) return null;

    // 1. CSS 选择器路径（向上最多 5 层）
    const selectorParts = [];
    let cur = el;
    while (cur && cur.tagName && cur !== document.body && selectorParts.length < 5) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) { selectorParts.unshift('#' + cur.id); break; }
      const classes = [...cur.classList].filter(c => !/^(ng-|v-|__|--|\d)/.test(c)).slice(0, 3);
      if (classes.length) part += '.' + classes.join('.');
      const siblings = cur.parentElement
        ? [...cur.parentElement.children].filter(c => c.tagName === cur.tagName) : [];
      if (siblings.length > 1) part += ':nth-child(' + (siblings.indexOf(cur) + 1) + ')';
      selectorParts.unshift(part);
      cur = cur.parentElement;
    }
    const selector = selectorParts.join(' > ');

    // 2. 有意义的文字内容（最多 60 字符）
    const text = (el.textContent || el.value || el.placeholder || '').trim().slice(0, 60);

    // 3. 辅助定位属性
    const attrs = {};
    for (const attr of ['id', 'data-panel', 'data-action', 'aria-label', 'title', 'name', 'type', 'href', 'placeholder']) {
      const v = el.getAttribute(attr);
      if (v) attrs[attr] = v;
    }

    // 4. 最近的有 id 的祖先（帮助定位区域）
    let ancestor = el.parentElement;
    let nearestId = '';
    while (ancestor && ancestor !== document.body) {
      if (ancestor.id) { nearestId = ancestor.id; break; }
      ancestor = ancestor.parentElement;
    }

    return { selector, text, attrs, nearestId, tag: el.tagName.toLowerCase() };
  }

  // 兼容旧调用
  function getSelector(el) {
    return getElementInfo(el)?.selector || '';
  }

  // ─── 样式 ───
  const style = document.createElement('style');
  style.textContent = `
    #fba-btn {
      position:fixed;bottom:20px;right:20px;z-index:99999;
      width:48px;height:48px;border-radius:50%;
      background:#c8ff00;color:#000;border:none;cursor:pointer;
      font-size:20px;display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 12px rgba(200,255,0,.3);
      transition:transform .2s,box-shadow .2s,background .2s;user-select:none;
    }
    #fba-btn:hover{transform:scale(1.1);}
    #fba-btn.annotating{
      background:#ff4d6a;box-shadow:0 2px 16px rgba(255,77,106,.6);
      animation:fba-pulse 1.5s infinite;
    }
    @keyframes fba-pulse{
      0%,100%{box-shadow:0 2px 12px rgba(255,77,106,.5);}
      50%{box-shadow:0 0 24px rgba(255,77,106,.9);}
    }
    #fba-badge{
      position:absolute;top:-4px;right:-4px;
      min-width:18px;height:18px;border-radius:9px;
      background:#ff4d6a;color:#fff;font-size:11px;font-weight:700;
      display:none;align-items:center;justify-content:center;padding:0 4px;
    }
    #fba-badge.show{display:flex;}

    /* 全屏透明遮罩（标注模式） */
    #fba-overlay{
      position:fixed;inset:0;z-index:99990;
      cursor:crosshair;
      background:rgba(200,255,0,.03);
      border:2px solid rgba(200,255,0,.2);
      display:none;pointer-events:none;
      box-sizing:border-box;
    }
    #fba-overlay.active{display:block;pointer-events:all;}
    #fba-overlay-hint{
      position:fixed;top:12px;left:50%;transform:translateX(-50%);
      background:rgba(200,255,0,.9);color:#000;
      padding:6px 18px;border-radius:20px;font-size:12px;font-weight:600;
      z-index:99991;pointer-events:none;user-select:none;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
    }

    /* 标注针 */
    .fba-pin{
      position:fixed;z-index:99995;
      width:26px;height:26px;
      border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      background:#c8ff00;border:2px solid rgba(0,0,0,.5);
      display:flex;align-items:center;justify-content:center;
      cursor:grab;pointer-events:all;
      box-shadow:0 2px 8px rgba(0,0,0,.4);
      transition:box-shadow .15s;
    }
    .fba-pin.dragging{cursor:grabbing;box-shadow:0 4px 16px rgba(200,255,0,.6);}
    .fba-pin .fba-pin-num{
      transform:rotate(45deg);font-size:10px;font-weight:700;color:#000;line-height:1;
    }
    .fba-pin.fba-pin-temp{
      background:#ff4d6a;border-color:rgba(0,0,0,.4);
      animation:fba-drop .25s ease;
    }
    @keyframes fba-drop{from{transform:rotate(-45deg) scale(0) translateY(-10px);}to{transform:rotate(-45deg) scale(1);}}

    /* 输入气泡 */
    #fba-popup{
      position:fixed;z-index:99999;
      background:#1a1a25;border:1.5px solid #c8ff00;
      border-radius:10px;padding:12px;width:300px;
      box-shadow:0 8px 32px rgba(0,0,0,.7);
      display:none;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
    }
    #fba-popup.show{display:block;}
    .fba-popup-meta{font-size:10px;color:#888;margin-bottom:8px;display:flex;justify-content:space-between;}
    .fba-popup-meta .fba-popup-panel{color:#c8ff00;font-weight:600;font-size:11px;}
    .fba-popup-meta .fba-popup-coord{font-family:monospace;}
    #fba-popup textarea{
      width:100%;height:80px;background:#0c0c16;
      border:1px solid #2a2a3a;border-radius:6px;
      color:#e0e0e8;padding:8px;font-size:13px;
      resize:none;outline:none;box-sizing:border-box;
      font-family:inherit;
    }
    #fba-popup textarea:focus{border-color:#c8ff00;}
    #fba-popup textarea::placeholder{color:#444;}
    .fba-popup-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;}
    .fba-popup .fba-btn-cancel{
      padding:4px 12px;background:transparent;color:#666;
      border:1px solid #2a2a3a;border-radius:5px;font-size:12px;cursor:pointer;
    }
    .fba-popup .fba-btn-cancel:hover{color:#ff4d6a;border-color:#ff4d6a;}
    .fba-popup .fba-btn-save{
      padding:4px 14px;background:#c8ff00;color:#000;
      border:none;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;
    }
    .fba-popup .fba-btn-save:hover{opacity:.85;}
    .fba-popup-hint{font-size:10px;color:#444;margin-top:5px;text-align:right;}

    /* 列表面板 */
    #fba-panel{
      position:fixed;bottom:80px;right:20px;z-index:99999;
      width:400px;max-height:72vh;
      background:#1a1a25;border:1px solid #2a2a3a;
      border-radius:14px;display:none;flex-direction:column;
      box-shadow:0 8px 40px rgba(0,0,0,.7);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
    }
    #fba-panel.open{display:flex;}
    .fba-ph{padding:14px 16px 10px;border-bottom:1px solid #2a2a3a;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;}
    .fba-ph-title{font-size:15px;font-weight:600;color:#c8ff00;}
    .fba-status{display:flex;align-items:center;gap:10px;}
    .fba-status-dot{
      display:inline-flex;align-items:center;gap:4px;
      font-size:10px;color:#555;cursor:default;
    }
    .fba-status-dot::before{
      content:'';width:6px;height:6px;border-radius:50%;
      background:#555;flex-shrink:0;
    }
    .fba-status-dot.ok::before{background:#66bb6a;}
    .fba-status-dot.ok{color:#66bb6a;}
    .fba-status-dot.err::before{background:#ff4d6a;}
    .fba-status-dot.err{color:#ff4d6a;}
    .fba-status-dot.checking::before{background:#ffa726;animation:fba-blink 1s infinite;}
    @keyframes fba-blink{0%,100%{opacity:1;}50%{opacity:.3;}}
    .fba-mode-toggle{
      padding:4px 12px;background:#ff4d6a;color:#fff;
      border:none;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;
      transition:background .15s;
    }
    .fba-mode-toggle:hover{opacity:.85;}
    .fba-mode-toggle.on{background:#ff8c00;}
    .fba-list{flex:1;overflow-y:auto;padding:8px 12px;}
    .fba-empty{text-align:center;color:#555;font-size:13px;padding:24px 16px;line-height:1.8;}
    .fba-item{
      background:#0f0f1a;border:1px solid #252535;border-radius:8px;
      padding:10px 12px;margin-bottom:8px;position:relative;
    }
    .fba-item:hover{border-color:#3a3a5a;}
    .fba-item-header{display:flex;align-items:center;gap:6px;margin-bottom:4px;}
    .fba-num{
      width:20px;height:20px;border-radius:50%;flex-shrink:0;
      background:#c8ff00;color:#000;font-size:10px;font-weight:700;
      display:flex;align-items:center;justify-content:center;
    }
    .fba-item-page{font-size:10px;color:#9dbc3a;font-weight:500;}
    .fba-item-time{font-size:10px;color:#444;margin-left:auto;}
    .fba-item-loc{
      font-size:10px;color:#555;font-family:monospace;margin-bottom:5px;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    }
    .fba-item-text{font-size:13px;color:#ccc;line-height:1.5;white-space:pre-wrap;}
    .fba-item-del{position:absolute;top:8px;right:10px;color:#444;cursor:pointer;font-size:15px;line-height:1;}
    .fba-item-del:hover{color:#ff4d6a;}
    .fba-pf{padding:10px 16px;border-top:1px solid #2a2a3a;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;}
    .fba-clear{
      padding:5px 12px;background:transparent;color:#555;
      border:1px solid #2a2a3a;border-radius:6px;font-size:12px;cursor:pointer;
    }
    .fba-clear:hover{color:#ff4d6a;border-color:#ff4d6a;}
    .fba-copy-clear{
      padding:6px 14px;background:#6c63ff;color:#fff;
      border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;
    }
    .fba-copy-clear:hover{opacity:.85;}
    .fba-copy-clear:disabled{opacity:.4;cursor:not-allowed;}
    .fba-export{
      padding:6px 18px;background:#c8ff00;color:#000;
      border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;
    }
    .fba-export:hover{opacity:.85;}
    .fba-export:disabled{opacity:.4;cursor:not-allowed;}
    .fba-toast{font-size:12px;text-align:center;padding:4px 0;display:none;}
  `;
  document.head.appendChild(style);

  // ─── 主按钮 ───
  const btn = document.createElement('button');
  btn.id = 'fba-btn';
  btn.title = '标注反馈（单击列表 / 双击标注模式）';
  btn.innerHTML = '&#9998;<span id="fba-badge"></span>';
  document.body.appendChild(btn);

  // ─── 遮罩 + 提示 ───
  const overlay = document.createElement('div');
  overlay.id = 'fba-overlay';
  document.body.appendChild(overlay);

  const hint = document.createElement('div');
  hint.id = 'fba-overlay-hint';
  hint.textContent = '📍 标注模式 — 点击页面任意位置添加标注 · 双击铅笔退出';
  hint.style.display = 'none';
  document.body.appendChild(hint);

  // ─── 输入气泡 ───
  const popup = document.createElement('div');
  popup.id = 'fba-popup';
  popup.innerHTML = `
    <div class="fba-popup-meta">
      <span class="fba-popup-panel" id="fba-popup-panel">—</span>
      <span class="fba-popup-coord" id="fba-popup-coord"></span>
    </div>
    <textarea id="fba-ta" placeholder="描述这里的问题或修改建议…&#10;例如：按钮太小 / 文案需要改 / 间距不对"></textarea>
    <div class="fba-popup-actions">
      <button class="fba-btn-cancel" id="fba-cancel">取消</button>
      <button class="fba-btn-save" id="fba-save-pin">保存标注 ↵</button>
    </div>
    <div class="fba-popup-hint">Enter 保存 · Shift+Enter 换行 · Esc 取消</div>
  `;
  document.body.appendChild(popup);

  // ─── 列表面板 ───
  const panel = document.createElement('div');
  panel.id = 'fba-panel';
  panel.innerHTML = `
    <div class="fba-ph">
      <span class="fba-ph-title">📌 标注列表</span>
      <div class="fba-status">
        <span class="fba-status-dot" id="fba-mcp-status" title="MCP Server">MCP</span>
        <span class="fba-status-dot" id="fba-cc-status" title="Claude Code">CC</span>
        <button class="fba-mode-toggle" id="fba-mode-toggle">+ 进入标注模式</button>
      </div>
    </div>
    <div class="fba-list" id="fba-list"></div>
    <div class="fba-toast" id="fba-toast"></div>
    <div class="fba-pf">
      <button class="fba-clear" id="fba-clear">清空</button>
      <button class="fba-copy-clear" id="fba-copy-clear">📋 复制并清空</button>
      <button class="fba-export" id="fba-export">导出给 AI ↓</button>
    </div>
  `;
  document.body.appendChild(panel);

  // ─── 状态 ───
  let panelOpen   = false;
  let annotating  = false;
  let pending     = null;  // { xPct, yPct, page, pageFile, panelId, element }
  let tempPinEl   = null;
  let pinEls      = [];

  // ─── 单击/双击区分 ───
  let clickTimer = null;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      toggleAnnotating();
    } else {
      clickTimer = setTimeout(() => { clickTimer = null; togglePanel(); }, 220);
    }
  });

  // ─── 面板开关 ───
  function togglePanel() {
    panelOpen = !panelOpen;
    panel.classList.toggle('open', panelOpen);
    if (panelOpen) { renderList(); checkMcpStatus(); }
  }
  document.addEventListener('click', (e) => {
    if (panelOpen && !panel.contains(e.target) && e.target !== btn) {
      panelOpen = false; panel.classList.remove('open');
    }
  });

  // ─── 标注模式开关 ───
  function toggleAnnotating() {
    annotating = !annotating;
    overlay.classList.toggle('active', annotating);
    btn.classList.toggle('annotating', annotating);
    hint.style.display = annotating ? 'block' : 'none';
    const toggleBtn = document.getElementById('fba-mode-toggle');
    if (toggleBtn) {
      toggleBtn.textContent = annotating ? '✕ 退出标注模式' : '+ 进入标注模式';
      toggleBtn.classList.toggle('on', annotating);
    }
    if (annotating) {
      panelOpen = false; panel.classList.remove('open');
      renderPins();
    } else {
      cancelPending();
      clearPins();
    }
  }

  // ─── 遮罩点击：掉针 ───
  overlay.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popup.classList.contains('show')) { cancelPending(); return; }

    const ap = getActivePanel();
    const r  = ap.rect;
    const relX = e.clientX - r.left;
    const relY = e.clientY - r.top;
    const xPct = +((relX / r.width) * 100).toFixed(1);
    const yPct = +((relY / r.height) * 100).toFixed(1);

    // 尝试获取 iframe 内元素详细信息
    let elementInfo = null;
    if (ap.iframe) {
      try {
        const el = ap.iframe.contentDocument.elementFromPoint(relX, relY);
        if (el) elementInfo = getElementInfo(el);
      } catch {}
    } else {
      try {
        overlay.style.pointerEvents = 'none';
        const el = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = 'all';
        if (el && el !== overlay && el !== btn) elementInfo = getElementInfo(el);
      } catch {}
    }

    pending = { xPct, yPct, page: ap.name, pageFile: ap.file, panelId: ap.panelId, elementInfo, clientX: e.clientX, clientY: e.clientY };
    showPopup(e.clientX, e.clientY, xPct, yPct, ap.name);
  });

  // ─── 气泡定位 ───
  function showPopup(cx, cy, xPct, yPct, pageName) {
    const panelLabel = document.getElementById('fba-popup-panel');
    const coordLabel = document.getElementById('fba-popup-coord');
    if (panelLabel) panelLabel.textContent = pageName.split('(')[0].trim();
    if (coordLabel) coordLabel.textContent = `X:${xPct}%  Y:${yPct}%`;

    popup.classList.add('show');
    const W = 300, H = 180;
    let left = cx + 16, top = cy - 24;
    if (left + W > window.innerWidth - 12) left = cx - W - 16;
    if (top + H > window.innerHeight - 12) top = window.innerHeight - H - 12;
    if (top < 8) top = 8;
    popup.style.left = left + 'px';
    popup.style.top  = top + 'px';

    const ta = document.getElementById('fba-ta');
    ta.value = '';
    ta.focus();

    // 临时针
    if (tempPinEl) tempPinEl.remove();
    tempPinEl = createPinEl(cx, cy, annotations.length + 1, true);
  }

  function cancelPending() {
    pending = null;
    popup.classList.remove('show');
    if (tempPinEl) { tempPinEl.remove(); tempPinEl = null; }
  }

  // ─── 保存标注 ───
  document.getElementById('fba-save-pin').addEventListener('click', savePin);
  document.getElementById('fba-cancel').addEventListener('click', cancelPending);

  let composing = false;
  const ta = document.getElementById('fba-ta');
  ta.addEventListener('compositionstart', () => { composing = true; });
  ta.addEventListener('compositionend',   () => { composing = false; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !composing) { e.preventDefault(); savePin(); }
    if (e.key === 'Escape') cancelPending();
  });

  function savePin() {
    const text = (document.getElementById('fba-ta').value || '').trim();
    if (!text || !pending) return;
    annotations.push({
      id:          annotations.length + 1,
      appId:       APP_ID,
      page:        pending.page,
      pageFile:    pending.pageFile,
      panelId:     pending.panelId,
      xPct:        pending.xPct,
      yPct:        pending.yPct,
      elementInfo: pending.elementInfo,
      // 向后兼容旧格式
      element:     pending.elementInfo?.selector || '',
      comment:     text,
      clientX:     pending.clientX,
      clientY:     pending.clientY,
      viewport:    window.innerWidth + '×' + window.innerHeight,
      time:        new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
    });
    persist();
    if (tempPinEl) { tempPinEl.classList.remove('fba-pin-temp'); tempPinEl = null; }
    pending = null;
    popup.classList.remove('show');
  }

  // ─── 渲染针 ───
  function createPinEl(cx, cy, num, isTemp) {
    const el = document.createElement('div');
    el.className = 'fba-pin' + (isTemp ? ' fba-pin-temp' : '');
    el.style.left = (cx - 13) + 'px';
    el.style.top  = (cy - 13) + 'px';
    el.innerHTML  = '<span class="fba-pin-num">' + num + '</span>';
    document.body.appendChild(el);

    // ─── 拖拽移动（非临时针才可拖） ───
    if (!isTemp) {
      let dragging = false, startX, startY, origLeft, origTop;
      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        dragging = true; startX = e.clientX; startY = e.clientY;
        origLeft = parseFloat(el.style.left); origTop = parseFloat(el.style.top);
        el.classList.add('dragging');
      });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        el.style.left = (origLeft + e.clientX - startX) + 'px';
        el.style.top  = (origTop  + e.clientY - startY) + 'px';
      });
      window.addEventListener('mouseup', (e) => {
        if (!dragging) return;
        dragging = false; el.classList.remove('dragging');
        // 更新存储的百分比坐标
        const idx = num - 1;
        if (idx >= 0 && idx < annotations.length) {
          const ann = annotations[idx];
          const newCx = parseFloat(el.style.left) + 13;
          const newCy = parseFloat(el.style.top)  + 13;
          if (ann.panelId) {
            const iframe = document.getElementById('frame-' + ann.panelId);
            if (iframe) {
              const r = iframe.getBoundingClientRect();
              ann.xPct = +((newCx - r.left) / r.width  * 100).toFixed(2);
              ann.yPct = +((newCy - r.top)  / r.height * 100).toFixed(2);
            }
          } else {
            ann.xPct = +(newCx / window.innerWidth  * 100).toFixed(2);
            ann.yPct = +(newCy / window.innerHeight * 100).toFixed(2);
          }
          persist();
        }
      });
    }

    return el;
  }

  function renderPins() {
    clearPins();
    annotations.forEach((ann, i) => {
      // 将存储的百分比坐标换算回当前屏幕坐标
      let cx, cy;
      if (ann.panelId) {
        const iframe = document.getElementById('frame-' + ann.panelId);
        if (iframe) {
          const r = iframe.getBoundingClientRect();
          cx = r.left + (ann.xPct / 100) * r.width;
          cy = r.top  + (ann.yPct / 100) * r.height;
        }
      }
      if (cx == null) {
        cx = (ann.xPct / 100) * window.innerWidth;
        cy = (ann.yPct / 100) * window.innerHeight;
      }
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return;
      const pin = createPinEl(cx, cy, i + 1, false);
      pin.title = ann.comment;
      pinEls.push(pin);
    });
  }

  function clearPins() {
    pinEls.forEach(p => p.remove());
    pinEls = [];
  }

  // ─── 面板内的标注列表 ───
  function renderList() {
    const listEl = document.getElementById('fba-list');
    if (!listEl) return;
    if (!annotations.length) {
      listEl.innerHTML = `<div class="fba-empty">暂无标注<br><small style="color:#444">双击铅笔按钮进入标注模式<br>然后点击页面任意位置添加标注</small></div>`;
      return;
    }
    listEl.innerHTML = annotations.map((ann, i) => `
      <div class="fba-item">
        <div class="fba-item-header">
          <span class="fba-num">${i + 1}</span>
          <span class="fba-item-page">${esc(ann.page.split('(')[0].trim())}</span>
          <span class="fba-item-time">${ann.time || ''}</span>
        </div>
        <div class="fba-item-loc" title="${esc(ann.elementInfo?.selector || ann.element || '')}">
          ${ann.elementInfo?.selector
            ? '🔍 ' + esc(ann.elementInfo.selector.slice(0, 60)) + (ann.elementInfo.selector.length > 60 ? '…' : '')
            : '📍 X:' + ann.xPct + '%  Y:' + ann.yPct + '%'}${ann.elementInfo?.text ? '  "' + esc(ann.elementInfo.text.slice(0, 30)) + '"' : ''}
        </div>
        <div class="fba-item-text">${esc(ann.comment)}</div>
        <span class="fba-item-del" data-i="${i}" title="删除">×</span>
      </div>
    `).join('');

    listEl.querySelectorAll('.fba-item-del').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        annotations.splice(+e.target.dataset.i, 1);
        annotations.forEach((a, i) => a.id = i + 1);
        persist(); renderList();
      });
    });
  }

  // ─── 面板按钮 ───
  document.getElementById('fba-mode-toggle').addEventListener('click', (e) => {
    e.stopPropagation(); toggleAnnotating();
  });

  // ─── 清空全部（两次点击确认，避免 confirm() 在 Tauri 中被吞） ───
  let clearPending = false;
  const clearBtn = document.getElementById('fba-clear');
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!annotations.length) return;
    if (!clearPending) {
      clearPending = true;
      clearBtn.textContent = '确认清空？';
      clearBtn.style.color = '#ff4d6a';
      clearBtn.style.borderColor = '#ff4d6a';
      setTimeout(() => {
        if (clearPending) {
          clearPending = false;
          clearBtn.textContent = '清空全部';
          clearBtn.style.color = ''; clearBtn.style.borderColor = '';
        }
      }, 3000);
      return;
    }
    clearPending = false;
    clearBtn.textContent = '清空';
    clearBtn.style.color = ''; clearBtn.style.borderColor = '';
    annotations = []; persist(); clearPins(); renderPins(); renderList();
  });

  // ─── 复制并清空 ───
  document.getElementById('fba-copy-clear').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!annotations.length) return;
    const toastEl = document.getElementById('fba-toast');
    const md = buildMarkdown();
    const count = annotations.length;
    try {
      await navigator.clipboard.writeText(md);
      // 同时保存到服务端（fire & forget）
      const token = localStorage.getItem('jowork_token') || '';
      fetch('/api/feedback/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({
          items: annotations.map(a => ({ page: a.page, url: a.pageFile, content: a.comment })),
          annotations, markdown: md, timestamp: new Date().toISOString(), appId: APP_ID,
        }),
      }).catch(() => {});
      annotations = []; persist(); clearPins(); renderPins(); renderList();
      showToast(toastEl, `✓ 已复制 ${count} 条标注到剪贴板并清空`, '#66bb6a');
    } catch {
      showToast(toastEl, '复制失败，请手动复制', '#ff4d6a');
    }
  });

  document.getElementById('fba-export').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!annotations.length) return;
    const exportBtn = document.getElementById('fba-export');
    const toastEl   = document.getElementById('fba-toast');
    const md = buildMarkdown();
    exportBtn.disabled = true; exportBtn.textContent = '导出中…';

    let saved = false;
    try {
      const token = localStorage.getItem('jowork_token') || '';
      const resp  = await fetch('/api/feedback/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({
          items: annotations.map(a => ({ page: a.page, url: a.pageFile, content: a.comment })),
          annotations,   // 完整结构化数据，含 elementInfo / CSS selector（供 MCP 读取）
          markdown: md,
          timestamp: new Date().toISOString(),
          annotated: true,
          appId: APP_ID,
        }),
      });
      if (resp.ok) {
        const r = await resp.json();
        showToast(toastEl, '✓ 已保存到 ' + (r.path || 'data/feedback.md'), '#66bb6a');
        saved = true;
      }
    } catch {}

    // 同时向本地 MCP relay 发副本（Claude Code 读取用，fire & forget）
    fetch('http://127.0.0.1:18801/api/feedback/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annotations }),
    }).catch(() => {});

    if (!saved) {
      // 服务端不可用时直接下载文件
      const blob = new Blob([md], { type: 'text/markdown' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'feedback_' + new Date().toISOString().slice(0, 10) + '.md';
      a.click(); URL.revokeObjectURL(url);
      showToast(toastEl, '已下载 markdown 文件', '#c8ff00');
    }

    exportBtn.disabled = false; exportBtn.textContent = '导出给 AI ↓';
  });

  function showToast(el, msg, color) {
    el.textContent = msg; el.style.color = color; el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }

  // ─── 生成 Markdown 报告（AI 程序员可读）───
  function buildMarkdown() {
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    let md = `# 页面反馈标注报告\n\n`;
    md += `**生成时间**: ${now}  \n`;
    md += `**标注数量**: ${annotations.length}\n\n`;
    md += `> 每条标注已包含：前端文件路径、CSS 元素选择器、元素文字/属性、所在区域 ID。\n`;
    md += `> 直接用选择器在对应 HTML 文件中搜索即可定位。\n\n---\n\n`;

    annotations.forEach((ann, i) => {
      const ei = ann.elementInfo;
      md += `## 标注 #${i + 1}\n\n`;

      // 核心定位信息
      md += `### 位置\n\n`;
      md += `- **前端文件**: \`${ann.pageFile}\`\n`;
      if (ei?.selector)   md += `- **CSS 选择器**: \`${ei.selector}\`\n`;
      if (ei?.nearestId)  md += `- **所在区域** (最近祖先 id): \`#${ei.nearestId}\`\n`;
      if (ei?.tag)        md += `- **元素类型**: \`<${ei.tag}>\`\n`;
      if (ei?.text)       md += `- **元素文字**: \`${ei.text}\`\n`;

      // 有意义的属性
      const attrEntries = ei?.attrs ? Object.entries(ei.attrs) : [];
      if (attrEntries.length) {
        md += `- **定位属性**:`;
        attrEntries.forEach(([k, v]) => { md += ` \`${k}="${v}"\``; });
        md += `\n`;
      }

      md += `\n### 反馈内容\n\n${ann.comment}\n\n`;
      md += `<details><summary>辅助信息</summary>\n\n`;
      md += `位置 X:${ann.xPct}% Y:${ann.yPct}% · 视口 ${ann.viewport || '—'} · ${ann.time || ''}\n\n`;
      md += `</details>\n\n---\n\n`;
    });

    return md;
  }

  // ─── 工具 ───
  function updateBadge() {
    const badge = document.getElementById('fba-badge');
    if (!badge) return;
    const n = annotations.length;
    badge.textContent = n; badge.className = n > 0 ? 'show' : '';
  }
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ─── MCP / Claude Code 连接状态检测 ───
  async function checkMcpStatus() {
    const mcpDot = document.getElementById('fba-mcp-status');
    const ccDot  = document.getElementById('fba-cc-status');
    if (!mcpDot || !ccDot) return;

    mcpDot.className = 'fba-status-dot checking'; mcpDot.title = 'MCP Server: 检测中...';
    ccDot.className  = 'fba-status-dot checking'; ccDot.title  = 'Claude Code: 检测中...';

    // 检测 MCP feedback-server（端口 18801）
    try {
      const r = await fetch('http://127.0.0.1:18801/health', { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        mcpDot.className = 'fba-status-dot ok'; mcpDot.title = 'MCP Server: 已连接 (端口 18801)';
      } else {
        mcpDot.className = 'fba-status-dot err'; mcpDot.title = 'MCP Server: 响应异常';
      }
    } catch {
      mcpDot.className = 'fba-status-dot err'; mcpDot.title = 'MCP Server: 未运行';
    }

    // 检测 Claude Code（端口 4747，Agentation MCP）
    try {
      const r = await fetch('http://127.0.0.1:4747/health', { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        ccDot.className = 'fba-status-dot ok'; ccDot.title = 'Claude Code: 已连接 (端口 4747)';
      } else {
        ccDot.className = 'fba-status-dot err'; ccDot.title = 'Claude Code: 响应异常';
      }
    } catch {
      ccDot.className = 'fba-status-dot err'; ccDot.title = 'Claude Code: 未运行';
    }
  }

  updateBadge();
})();
