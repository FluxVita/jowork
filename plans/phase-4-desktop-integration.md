# Phase 4: 桌面深度集成

> **复杂度**: L | **依赖**: Phase 1 | **可与 Phase 2/3 完全并行**
> **验收**: Cmd+Shift+Space 唤出快捷窗口；终端可用；文件拖入对话

---

## 目标

实现 Raycast 风格快捷窗口、内置 PTY 终端、文件系统集成、系统通知、智能操作确认。

---

## 参考旧代码

| 旧文件 | 参考什么 |
|--------|---------|
| `apps/jowork/src-tauri/src/lib.rs` | PTY spawn 逻辑、子进程环境变量清理 |
| `packages/core/src/gateway/terminal.ts` | PTY session 管理、resize 处理 |

---

## 步骤

### 4.1 Raycast 快捷窗口

**文件**: `apps/desktop/src/main/windows/launcher-window.ts`

```typescript
class LauncherWindow {
  private win: BrowserWindow | null = null;

  create() {
    this.win = new BrowserWindow({
      width: 600,
      height: 400,
      frame: false,                     // 无边框
      transparent: true,                // 透明背景
      vibrancy: 'under-window',         // macOS 毛玻璃
      visualEffectState: 'active',
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      show: false,
      // 屏幕上方 1/3 居中
    });
  }

  toggle() {
    if (this.win?.isVisible()) {
      this.win.hide();
    } else {
      this.positionCenter();
      this.win?.show();
      this.win?.focus();
    }
  }
}
```

**全局快捷键**: `Cmd+Shift+Space`（macOS）/ `Ctrl+Shift+Space`（Windows）

**Launcher UI**:
```
┌───────────────────────────────────────┐
│  🔍 Ask JoWork anything...            │  ← 自动聚焦输入框
├───────────────────────────────────────┤
│  Recent:                              │
│  📝 Review today's PRs                │
│  💬 What's the status of Project X?   │
│  ⚡ /weekly-report                    │
├───────────────────────────────────────┤
│  流式回复区域                          │  ← 简洁模式，不显示工具调用细节
│  ...                                  │
└───────────────────────────────────────┘
```

- `Escape` 关闭
- `Cmd+Enter` 打开主窗口继续对话
- 只做快速问答，不展示工具调用细节
- Skill 触发：输入 `/` 显示 skill 列表自动补全

**渲染器**: `apps/desktop/src/renderer/layouts/LauncherLayout.tsx`

### 4.2 内置 PTY 终端

**文件**: `apps/desktop/src/main/system/pty-manager.ts`

```typescript
import * as pty from 'node-pty';

class PtyManager {
  private sessions: Map<string, pty.IPty> = new Map();

  create(id: string, opts?: { cwd?: string; shell?: string }): void {
    const shell = opts?.shell || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh');

    // 清理环境变量，避免嵌套问题
    const env = { ...process.env };
    delete env.CLAUDE_CODE;    // 避免 Claude Code 嵌套检测
    delete env.TMUX;           // 避免 tmux 嵌套

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: opts?.cwd || process.env.HOME,
      env,
    });

    this.sessions.set(id, ptyProcess);
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(cols, rows);
  }

  onData(id: string, callback: (data: string) => void): void {
    this.sessions.get(id)?.onData(callback);
  }

  destroy(id: string): void {
    this.sessions.get(id)?.kill();
    this.sessions.delete(id);
  }
}
```

**终端 UI**: `apps/desktop/src/renderer/pages/TerminalPage.tsx`
- `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-webgl`
- 多 Tab 终端
- IPC 桥接: renderer ↔ main (pty)

### 4.3 文件系统集成

**文件**: `apps/desktop/src/main/system/file-watcher.ts`

```typescript
import { watch } from 'chokidar';

class FileWatcher {
  // 监控用户指定的项目目录
  watchProject(dir: string): void {
    const watcher = watch(dir, {
      ignored: /(node_modules|\.git|\.DS_Store)/,
      persistent: true,
      ignoreInitial: true,
    });

    watcher.on('change', (path) => {
      // 通知 renderer 文件变化
      mainWindow.webContents.send('file:changed', path);
    });
  }
}
```

**文件拖拽到对话**:
- renderer 监听 `dragover` + `drop` 事件
- 文件路径通过 IPC 传给 main process
- main process 读取文件内容 → 注入对话消息
- 支持图片（转 base64）、文本文件（直接内容）、其他（显示路径）

### 4.4 系统通知

**文件**: `apps/desktop/src/main/system/notifications.ts`

```typescript
import { Notification } from 'electron';

class NotificationManager {
  send(opts: { title: string; body: string; urgency?: 'low' | 'normal' | 'critical' }): void {
    const notification = new Notification({
      title: opts.title,
      body: opts.body,
      urgency: opts.urgency,
    });
    notification.show();
    notification.on('click', () => {
      // 点击通知 → 打开主窗口 + 跳转到相关对话
    });
  }
}
```

### 4.5 剪贴板集成

**文件**: `apps/desktop/src/main/system/clipboard.ts`

```typescript
import { clipboard } from 'electron';

class ClipboardManager {
  read(): { text?: string; image?: string } {
    const text = clipboard.readText();
    const image = clipboard.readImage();
    return {
      text: text || undefined,
      image: image.isEmpty() ? undefined : image.toDataURL(),
    };
  }

  write(text: string): void {
    clipboard.writeText(text);
  }
}
```

### 4.6 智能操作确认

**文件**: `apps/desktop/src/renderer/features/conversation/ConfirmDialog.tsx`

当引擎要执行高风险操作时:
- **自动执行**: 查数据、读文件、搜索
- **需确认**: 发消息、创建 PR、删除文件、修改配置
- **始终阻止**: 明显危险操作

```typescript
interface ConfirmRule {
  toolPattern: string;        // glob: 'github/create_*', 'slack/send_*'
  action: 'auto' | 'confirm' | 'block';
  userOverridable: boolean;   // 用户是否可在设置中修改
}
```

UI: 模态对话框显示操作详情 + "允许" / "拒绝" / "始终允许此操作"

---

## 验收标准

- [ ] `Cmd+Shift+Space` 唤出浮动快捷窗口
- [ ] 快捷窗口输入问题 → 收到流式回复
- [ ] `Escape` 关闭快捷窗口，`Cmd+Enter` 转到主窗口
- [ ] 终端页面可打开 shell，执行命令
- [ ] 终端支持多 Tab
- [ ] 文件拖入对话区 → 文件内容注入对话
- [ ] 系统通知正常弹出（macOS + Windows）
- [ ] 高风险操作弹出确认对话框

---

## 产出文件

```
apps/desktop/src/main/windows/
└── launcher-window.ts

apps/desktop/src/main/system/
├── pty-manager.ts
├── file-watcher.ts
├── clipboard.ts
└── notifications.ts

apps/desktop/src/renderer/layouts/
└── LauncherLayout.tsx

apps/desktop/src/renderer/pages/
└── TerminalPage.tsx

apps/desktop/src/renderer/features/
├── launcher/
│   ├── LauncherInput.tsx
│   ├── LauncherResults.tsx
│   └── hooks/useLauncher.ts
└── conversation/
    └── ConfirmDialog.tsx
```
