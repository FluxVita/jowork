# Dashboard 未完成功能实施计划

> 约束：不使用 Tauri/Electron 等桌面 app 框架，纯 Web + CLI 解决。

---

## Gap 1: 浏览器拖拽无法获取系统目录路径

### 问题

浏览器的 drag-and-drop API 出于安全限制，只能获取文件的 `name`（不含路径）。
当用户拖拽一个文件夹到 dashboard，JavaScript 能读取文件内容（通过 `DataTransferItem.webkitGetAsEntry()` + File System Access API），但**不能获取文件在操作系统中的绝对路径**。

当前实现：dashboard 的 drop zone 接受拖入的文件夹，但只能获取文件名和内容，无法构造 `local:///absolute/path/file.ts` 形式的 URI。

### 方案：Hybrid 模式（Web 读内容 + CLI 补路径）

**策略**：浏览器负责读取文件内容（File System Access API 可以递归读取目录），服务端负责索引。绕开路径限制的方式是——在 API 中接受文件内容而非路径。

#### 实现步骤

**Step 1: 前端 — 用 `DataTransferItem.webkitGetAsEntry()` 递归读目录**

```js
async function readDroppedDirectory(entry) {
  const files = [];
  async function traverse(dirEntry, path = '') {
    const reader = dirEntry.createReader();
    const entries = await new Promise(resolve => reader.readEntries(resolve));
    for (const e of entries) {
      if (e.isFile) {
        const file = await new Promise(resolve => e.file(resolve));
        files.push({ path: path + '/' + e.name, content: await file.text(), size: file.size });
      } else if (e.isDirectory) {
        // Skip .git, node_modules
        if (['.git', 'node_modules', '.DS_Store'].includes(e.name)) continue;
        await traverse(e, path + '/' + e.name);
      }
    }
  }
  await traverse(entry);
  return files;
}
```

**Step 2: 新 API 端点 — `POST /api/context/upload`**

接受文件内容数组（而非系统路径），索引到 objects 表：

```
POST /api/context/upload
Body: {
  label: "my-project",         // 用户可读名称（默认 = 拖入的目录名）
  files: [
    { path: "src/app.ts", content: "...", size: 1234 },
    { path: "README.md", content: "...", size: 567 }
  ]
}
```

URI 格式改为：`local://upload/{label}/{path}`（例如 `local://upload/my-project/src/app.ts`）

**Step 3: 大目录分块上传**

- 前端读取文件后，按 50 个一批发送
- 每批通过 WebSocket 推送进度：`{ indexed: 50, total: 200, done: false }`
- 前端显示进度条
- 跳过规则在前端执行（.git, node_modules, binary extension, >1MB, depth>10）

**Step 4: 保留 CLI 路径模式**

现有的 `POST /api/context` + `type: "directory"` + 系统路径的方式保留——供 CLI 调用（`jowork context add ~/project/src`）。浏览器拖拽走 `/api/context/upload`，CLI 走 `/api/context`。

#### 工作量

CC: ~30 min（前端 FileSystemEntry 递归 + 新 API + 分块上传 + 进度推送）

---

## Gap 2: 终端窗口聚焦

### 问题

Dashboard sessions tab 的 "cd" 按钮当前只复制命令到剪贴板。用户需要手动切到终端粘贴执行。理想体验是点击 session 直接聚焦到对应终端窗口。

### 方案：平台自适应 + 渐进增强

#### macOS: AppleScript + osascript

**核心难点**：从 PID 找到 Terminal.app/iTerm2 的对应 window/tab。

**Terminal.app 方案**：
```bash
# 通过 PID 找到 TTY
TTY=$(ps -p $PID -o tty= 2>/dev/null | tr -d ' ')
# 通过 TTY 找到 Terminal.app 的 tab
osascript -e "
  tell application \"Terminal\"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is \"/dev/$TTY\" then
          set frontmost of w to true
          set selected tab of w to t
          return
        end if
      end repeat
    end repeat
  end tell
"
```

**iTerm2 方案**：
```bash
# iTerm2 有 scripting API
osascript -e "
  tell application \"iTerm2\"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is \"/dev/$TTY\" then
            select w
            select t
            select s
            return
          end if
        end repeat
      end repeat
    end repeat
  end tell
"
```

**检测当前终端**：
```bash
# 检测父进程链中的终端 app
TERMINAL_APP=$(ps -p $(ps -p $PID -o ppid=) -o comm= 2>/dev/null)
# Terminal.app → "Terminal"
# iTerm2 → "iTerm2"
# Ghostty → "ghostty"（不支持 AppleScript）
# tmux → "tmux: server"（不支持从外部聚焦 pane）
```

#### 实现步骤

**Step 1: 新 API 端点 — `POST /api/sessions/:id/focus`**

```ts
app.post('/api/sessions/:id/focus', async (c) => {
  const session = sqlite.prepare('SELECT * FROM active_sessions WHERE id = ?').get(id);
  if (!session) return c.json({ error: 'Session not found' }, 404);

  if (process.platform === 'darwin') {
    const result = await focusMacOS(session.pid);
    return c.json({ focused: result.success, method: result.method });
  }

  // Linux/Windows: fallback to clipboard
  return c.json({ focused: false, fallback: `cd ${session.working_dir}` });
});
```

**Step 2: macOS focus 函数**

```ts
async function focusMacOS(pid: number): Promise<{ success: boolean; method: string }> {
  // 1. Get TTY from PID
  const tty = execSync(`ps -p ${pid} -o tty= 2>/dev/null`).toString().trim();
  if (!tty || tty === '??') return { success: false, method: 'no-tty' };

  // 2. Detect terminal app from parent process
  const ppid = execSync(`ps -p ${pid} -o ppid=`).toString().trim();
  const parentComm = execSync(`ps -p ${ppid} -o comm=`).toString().trim();

  // 3. Try AppleScript based on detected terminal
  if (parentComm.includes('Terminal')) {
    try {
      execSync(`osascript -e 'tell application "Terminal" ...'`);
      return { success: true, method: 'terminal-applescript' };
    } catch { /* fallthrough */ }
  }

  if (parentComm.includes('iTerm')) {
    try {
      execSync(`osascript -e 'tell application "iTerm2" ...'`);
      return { success: true, method: 'iterm-applescript' };
    } catch { /* fallthrough */ }
  }

  // 4. Fallback: bring Terminal.app to front generically
  try {
    execSync(`osascript -e 'tell application "Terminal" to activate'`);
    return { success: true, method: 'generic-activate' };
  } catch {
    return { success: false, method: 'failed' };
  }
}
```

**Step 3: 前端按钮升级**

session 卡片的按钮从纯 "cd" 变为 "Focus" + "cd" 两个：
- "Focus" → `POST /api/sessions/:id/focus` → 如果成功，终端窗口被聚焦
- 如果 focus 返回 `{ focused: false }`，自动 fallback 到 copy-cd + toast 提示
- "cd" 保留为备用

**Step 4: 测试矩阵**

| 终端 | 方案 | 预期 |
|------|------|------|
| Terminal.app | AppleScript tty 匹配 | ✅ 直接聚焦对应 tab |
| iTerm2 | AppleScript tty 匹配 | ✅ 直接聚焦对应 session |
| Ghostty | generic activate | ⚠️ 打开 Ghostty 但不能定位 tab |
| tmux | 不支持 | ❌ fallback 到 copy-cd |
| Warp | 待验证 | ❓ |

#### 工作量

CC: ~30 min（API 端点 + macOS AppleScript + 前端按钮 + 测试）

---

## Gap 3: 浏览器文件夹拖入的 UX 优化（非必须但体验更好）

### 当前状态

drop zone 存在但拖入后的反馈不够直观（没有进度条、没有索引完成的 toast 动画）。

### 方案

1. 拖入时 drop zone 变色 + 显示 "Release to index"
2. 索引中显示进度条（顶部固定条，类似 GitHub loading bar）
3. 索引完成显示 toast："Indexed 234 files from my-project"
4. 如果索引失败显示错误 toast + 具体原因

#### 工作量

CC: ~15 min

---

## 实施顺序

```
1. Gap 1 — 浏览器拖拽上传（最关键，解锁核心 aha moment）
   ↓
2. Gap 3 — 拖拽 UX 优化（与 Gap 1 一起做，成本极低）
   ↓
3. Gap 2 — 终端聚焦（增强体验，非阻塞）
```

**总工作量**：CC ~1.5h / Human ~3 days
