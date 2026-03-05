/**
 * FluxVita 测试反馈收集器
 * 在每个页面引入即可：<script src="/feedback-widget.js"></script>
 *
 * 功能：
 * - 右下角悬浮按钮，点击展开反馈面板
 * - 当前页面可写多条反馈，每条自动标记页面名
 * - 跨页面累积（localStorage），badge 显示总数
 * - "保存全部" 一键提交到服务端，生成 data/feedback.md
 * - 支持清空已保存的反馈
 */
(function() {
  const PAGE_MAP = {
    '/': 'Dashboard（数据看板）',
    '/index.html': 'Dashboard（数据看板）',
    '/chat.html': 'Chat（AI 聊天）',
    '/admin.html': 'Admin（管理后台）',
    '/onboarding.html': 'Onboarding（引导）',
  };
  const pageName = PAGE_MAP[location.pathname] || location.pathname;
  const STORAGE_KEY = 'fluxvita_feedback_items';

  // 读写 localStorage
  function getItems() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  }
  function saveItems(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    updateBadge();
    renderList();
  }

  // ─── 样式 ───
  const style = document.createElement('style');
  style.textContent = `
    #fb-widget-btn {
      position: fixed; bottom: 20px; right: 20px; z-index: 99999;
      width: 48px; height: 48px; border-radius: 50%;
      background: #c8ff00; color: #000; border: none; cursor: pointer;
      font-size: 22px; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 12px rgba(200,255,0,0.3);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #fb-widget-btn:hover { transform: scale(1.1); box-shadow: 0 4px 20px rgba(200,255,0,0.5); }
    #fb-badge {
      position: absolute; top: -4px; right: -4px;
      min-width: 18px; height: 18px; border-radius: 9px;
      background: #ff4d6a; color: #fff; font-size: 11px; font-weight: 700;
      display: none; align-items: center; justify-content: center;
      padding: 0 4px; line-height: 18px;
    }
    #fb-badge.show { display: flex; }

    #fb-panel {
      position: fixed; bottom: 80px; right: 20px; z-index: 99999;
      width: 380px; max-height: 70vh; background: #1a1a25; border: 1px solid #2a2a3a;
      border-radius: 14px; display: none; overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      flex-direction: column;
    }
    #fb-panel.open { display: flex; }

    .fb-panel-header {
      padding: 14px 16px 10px; border-bottom: 1px solid #2a2a3a;
      display: flex; justify-content: space-between; align-items: center;
    }
    .fb-panel-header .fb-title { font-size: 15px; font-weight: 600; color: #c8ff00; }
    .fb-panel-header .fb-page {
      font-size: 11px; color: #8888a0; background: #12121a;
      padding: 2px 8px; border-radius: 4px;
    }

    .fb-input-area { padding: 12px 16px; border-bottom: 1px solid #2a2a3a; }
    .fb-input-area textarea {
      width: 100%; height: 68px; background: #12121a; border: 1px solid #2a2a3a;
      border-radius: 8px; color: #e0e0e8; padding: 10px; font-size: 13px;
      resize: none; outline: none; font-family: inherit;
    }
    .fb-input-area textarea:focus { border-color: #c8ff00; }
    .fb-input-area textarea::placeholder { color: #555; }
    .fb-input-row {
      display: flex; justify-content: space-between; align-items: center; margin-top: 8px;
    }
    .fb-input-row .fb-hint { font-size: 11px; color: #555; }
    .fb-add-btn {
      padding: 5px 14px; background: #2a2a3a; color: #c8ff00;
      border: 1px solid #3a3a4a; border-radius: 6px; font-size: 12px;
      font-weight: 600; cursor: pointer; transition: all 0.15s;
    }
    .fb-add-btn:hover { background: #3a3a4a; border-color: #c8ff00; }

    .fb-list-area {
      flex: 1; overflow-y: auto; padding: 8px 16px; max-height: 280px;
    }
    .fb-list-empty {
      text-align: center; color: #555; font-size: 12px; padding: 20px 0;
    }
    .fb-item {
      background: #12121a; border: 1px solid #2a2a3a; border-radius: 8px;
      padding: 8px 10px; margin-bottom: 6px; font-size: 12px;
      position: relative;
    }
    .fb-item .fb-item-page {
      font-size: 10px; color: #c8ff00; opacity: 0.7; margin-bottom: 2px;
    }
    .fb-item .fb-item-text { color: #ccc; line-height: 1.4; white-space: pre-wrap; }
    .fb-item .fb-item-del {
      position: absolute; top: 6px; right: 8px;
      color: #555; cursor: pointer; font-size: 14px; line-height: 1;
    }
    .fb-item .fb-item-del:hover { color: #ff4d6a; }

    .fb-panel-footer {
      padding: 10px 16px; border-top: 1px solid #2a2a3a;
      display: flex; justify-content: space-between; align-items: center;
    }
    .fb-clear-btn {
      padding: 5px 12px; background: transparent; color: #555;
      border: 1px solid #2a2a3a; border-radius: 6px; font-size: 12px;
      cursor: pointer; transition: all 0.15s;
    }
    .fb-clear-btn:hover { color: #ff4d6a; border-color: #ff4d6a; }
    .fb-save-btn {
      padding: 6px 18px; background: #c8ff00; color: #000;
      border: none; border-radius: 6px; font-size: 13px; font-weight: 600;
      cursor: pointer; transition: opacity 0.2s;
    }
    .fb-save-btn:hover { opacity: 0.85; }
    .fb-save-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .fb-toast {
      font-size: 12px; color: #66bb6a; text-align: center;
      padding: 6px; display: none;
    }
  `;
  document.head.appendChild(style);

  // ─── 按钮 ───
  const btn = document.createElement('button');
  btn.id = 'fb-widget-btn';
  btn.innerHTML = '&#9998;<span id="fb-badge"></span>'; // ✎ + badge
  btn.title = '测试反馈';
  document.body.appendChild(btn);

  // ─── 面板 ───
  const panel = document.createElement('div');
  panel.id = 'fb-panel';
  panel.innerHTML = `
    <div class="fb-panel-header">
      <span class="fb-title">测试反馈</span>
      <span class="fb-page">${pageName}</span>
    </div>
    <div class="fb-input-area">
      <textarea id="fb-textarea" placeholder="描述问题或修改建议...\n例如：这个按钮应该改为中文、布局需要调整"></textarea>
      <div class="fb-input-row">
        <span class="fb-hint">Enter 添加，Cmd+S 全部保存</span>
        <button class="fb-add-btn" id="fb-add-btn">+ 添加</button>
      </div>
    </div>
    <div class="fb-list-area" id="fb-list"></div>
    <div class="fb-toast" id="fb-toast"></div>
    <div class="fb-panel-footer">
      <button class="fb-clear-btn" id="fb-clear-btn">清空</button>
      <button class="fb-save-btn" id="fb-save-btn">保存全部</button>
    </div>
  `;
  document.body.appendChild(panel);

  // ─── 交互 ───
  let isOpen = false;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    if (isOpen) {
      renderList();
      document.getElementById('fb-textarea').focus();
    }
  });

  document.addEventListener('click', (e) => {
    if (isOpen && !panel.contains(e.target) && e.target !== btn) {
      isOpen = false;
      panel.classList.remove('open');
    }
  });

  // 添加反馈
  function addItem() {
    const textarea = document.getElementById('fb-textarea');
    const text = textarea.value.trim();
    if (!text) return;
    const items = getItems();
    items.push({
      page: pageName,
      url: location.href,
      content: text,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
    });
    saveItems(items);
    textarea.value = '';
    textarea.focus();
  }

  document.getElementById('fb-add-btn').addEventListener('click', addItem);
  let fbComposing = false;
  let fbComposingJustEnded = false;
  const fbTextarea = document.getElementById('fb-textarea');
  fbTextarea.addEventListener('compositionstart', () => { fbComposing = true; fbComposingJustEnded = false; });
  fbTextarea.addEventListener('compositionend', () => {
    fbComposing = false;
    fbComposingJustEnded = true;
    setTimeout(() => { fbComposingJustEnded = false; }, 30);
  });
  fbTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !fbComposing && !fbComposingJustEnded) {
      e.preventDefault();
      addItem();
    }
    // Cmd+S 保存全部
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveAll();
    }
  });

  // 全局 Cmd+S 保存
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (getItems().length > 0) saveAll();
    }
  });

  // 清空
  document.getElementById('fb-clear-btn').addEventListener('click', () => {
    if (!confirm('确定清空所有反馈？')) return;
    saveItems([]);
  });

  // 保存全部
  document.getElementById('fb-save-btn').addEventListener('click', saveAll);

  function formatTimestamp() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  async function saveAll() {
    const items = getItems();
    if (items.length === 0) return;
    const saveBtn = document.getElementById('fb-save-btn');
    const toast = document.getElementById('fb-toast');
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';

    try {
      const timestamp = formatTimestamp();
      const token = localStorage.getItem('jowork_token') || localStorage.getItem('jw_admin_token') || '';
      const resp = await fetch('/api/feedback/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: JSON.stringify({ items, timestamp }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result = await resp.json();

      // 清空本地
      saveItems([]);
      toast.textContent = `✓ 已保存到 ${result.path}`;
      toast.style.color = '#66bb6a';
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 4000);
    } catch (err) {
      toast.textContent = '保存失败，请重试';
      toast.style.color = '#ff4d6a';
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 3000);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存全部';
    }
  }

  // 渲染列表
  function renderList() {
    const list = document.getElementById('fb-list');
    if (!list) return;
    const items = getItems();
    if (items.length === 0) {
      list.innerHTML = '<div class="fb-list-empty">暂无反馈，在上方输入后按 Enter 添加</div>';
      return;
    }
    list.innerHTML = items.slice().reverse().map((item, revIdx) => {
      const i = items.length - 1 - revIdx; // 原始下标（用于删除）
      return `
      <div class="fb-item">
        <div class="fb-item-page">${escHtml(item.page)} · ${item.time || ''}</div>
        <div class="fb-item-text">${escHtml(item.content)}</div>
        <span class="fb-item-del" data-idx="${i}" title="删除">×</span>
      </div>
    `}).join('');

    // 删除按钮——stopPropagation 防止关闭面板
    list.querySelectorAll('.fb-item-del').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(e.target.dataset.idx);
        const items = getItems();
        items.splice(idx, 1);
        saveItems(items);
      });
    });
  }

  function updateBadge() {
    const badge = document.getElementById('fb-badge');
    if (!badge) return;
    const count = getItems().length;
    badge.textContent = count;
    badge.classList.toggle('show', count > 0);
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // 初始化
  updateBadge();
})();
