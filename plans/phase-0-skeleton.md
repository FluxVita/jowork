# Phase 0: 项目骨架

> **复杂度**: L | **依赖**: 无 | **验收**: App 启动 < 2 秒，显示三栏布局空壳

---

## 目标

初始化 monorepo，搭建 Electron + React 骨架，实现三栏布局空壳和系统托盘。

---

## 参考旧代码

| 旧文件 | 参考什么 |
|--------|---------|
| `apps/jowork/public/styles/tokens.css` | 设计 Token 变量命名（新项目用 Tailwind 重写） |
| `apps/jowork/public/shell.html` | 三栏布局比例（220px 侧边栏 + 主区域 + 320px 上下文面板） |
| `packages/core/src/types.ts` | 核心类型命名惯例（DataSource, SourceType, Role 等） |
| `packages/core/src/datamap/db.ts` | SQLite 表结构设计参考（sessions, objects, users 等） |

---

## 步骤

### 0.1 初始化 Monorepo

```bash
cd /Users/signalz/Documents/augment-projects/jowork
git init
pnpm init
```

**创建文件**:

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", "out/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": { "dependsOn": ["^build"] },
    "test": {}
  }
}
```

`.npmrc`:
```
package-import-method=copy
shamefully-hoist=false
strict-peer-dependencies=false
```

`.gitignore`:
```
node_modules/
dist/
out/
*.db
*.db-wal
*.db-shm
.env
.env.local
.DS_Store
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  }
}
```

`LICENSE` — AGPL-3.0 全文

根 `package.json`:
```json
{
  "name": "jowork",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "test": "turbo test"
  },
  "devDependencies": {
    "turbo": "^2.8.0",
    "typescript": "^5.9.0"
  }
}
```

### 0.2 创建 `packages/ui`（共享组件库空壳）

**目录结构**:
```
packages/ui/
├── package.json
├── tsconfig.json
└── src/
    └── index.ts              # barrel export（暂为空）
```

Phase 0 只创建空壳。Phase 1 开始填充 UI 组件（如 Button、Input、Card 等）。
Launcher 和 MainWindow 共享组件都放这里。

### 0.3 创建 `packages/core`

**目录结构**:
```
packages/core/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # barrel export
│   ├── types/
│   │   ├── index.ts
│   │   ├── engine.ts         # AgentEngine, EngineType, ChatOpts, EngineEvent
│   │   ├── connector.ts      # DataSource, SourceType, ConnectorConfig
│   │   ├── conversation.ts   # Session, Message, MessageRole
│   │   ├── memory.ts         # Memory, MemoryScope
│   │   ├── skill.ts          # Skill, SkillManifest
│   │   ├── user.ts           # User, Role, Team
│   │   └── billing.ts        # Plan, Credits, Subscription
│   ├── db/
│   │   ├── schema.ts         # Drizzle schema（所有表定义）
│   │   ├── migrate.ts        # 启动时迁移逻辑
│   │   └── index.ts
│   ├── i18n/
│   │   ├── index.ts          # i18next 初始化
│   │   ├── zh.json           # 中文翻译（初始骨架）
│   │   └── en.json           # 英文翻译（初始骨架）
│   └── utils/
│       ├── id.ts             # nanoid 生成
│       ├── logger.ts         # 结构化日志
│       └── index.ts
```

**核心类型定义**（参考旧 `packages/core/src/types.ts` 但重新设计）:

`types/engine.ts` — 引擎相关:
```typescript
export type EngineId = 'claude-code' | 'openclaw' | 'codex' | 'jowork-cloud';
export type EngineType = 'local' | 'cloud';

export interface EngineEvent {
  type: 'system' | 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'error' | 'done' | 'usage';
  // ...每种 type 的 payload
}

export interface ChatOpts {
  sessionId?: string;
  message: string;
  images?: string[];
  cwd?: string;
}

export interface AgentEngine {
  id: EngineId;
  type: EngineType;
  checkInstalled(): Promise<InstallStatus>;
  install?(): Promise<void>;
  chat(opts: ChatOpts): AsyncGenerator<EngineEvent>;
  abort(): Promise<void>;
  process?: import('child_process').ChildProcess;  // 本地引擎暴露给 EngineRecovery 监听
}
```

`types/conversation.ts` — 对话:
```typescript
export interface Session {
  id: string;
  title: string;
  engineId: EngineId;       // 当前活跃引擎
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  mode: 'personal' | 'team';
}

// 引擎 session 映射（一个 JoWork session 可能跨多个引擎，每个引擎各有自己的 session ID）
// DB 表定义见 Phase 1 HistoryManager
export interface EngineSessionMapping {
  sessionId: string;         // JoWork session.id
  engineId: EngineId;        // 'claude-code' | 'openclaw' | ...
  engineSessionId: string;   // 引擎侧 session ID（如 Claude Code 的 --resume ID）
  createdAt: Date;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system';
  content: string;
  toolName?: string;
  tokens?: number;
  cost?: number;
  createdAt: Date;
}
```

**Drizzle Schema**（`db/schema.ts`）:
```typescript
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  engineId: text('engine_id').notNull(),      // 当前活跃引擎
  mode: text('mode').notNull().default('personal'), // 'personal' | 'team'
  messageCount: integer('message_count').default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  role: text('role').notNull(),               // 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system'
  content: text('content').notNull(),
  toolName: text('tool_name'),
  tokens: integer('tokens'),
  cost: integer('cost'),                      // 以 0.001 美分为单位的整数
  createdAt: integer('created_at').notNull(),
});

// memories, settings, connector_configs 在 Phase 3/1/2 按需新增
// 后续 Phase 按需 ALTER TABLE 或新增表
```

**i18n 骨架**: 只定义 `app.name`, `sidebar.*`, `settings.*` 等基础 key

### 0.4 创建 `apps/desktop` — Electron 应用

**使用 electron-vite 模板初始化**:
```bash
cd apps
npm create @electron-vite@latest desktop -- --template react-ts
```

然后调整为 monorepo 结构:
- `package.json` 添加 `@jowork/core` 和 `@jowork/ui` workspace 依赖
- 配置 `electron-vite.config.ts` 识别 workspace 包
- `postinstall` 脚本: `electron-rebuild -f -w better-sqlite3`

**目录结构**:
```
apps/desktop/
├── package.json
├── electron-vite.config.ts
├── electron-builder.yml
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
├── src/
│   ├── main/
│   │   ├── index.ts              # 入口: app.ready → 创建窗口
│   │   ├── ipc.ts                # IPC handler 注册中心
│   │   └── tray.ts               # 系统托盘 + 菜单
│   ├── preload/
│   │   └── index.ts              # contextBridge 暴露 API
│   └── renderer/
│       ├── index.html
│       ├── main.tsx              # React 入口
│       ├── App.tsx               # 根组件 + Router
│       ├── layouts/
│       │   └── MainLayout.tsx    # 三栏布局
│       ├── pages/
│       │   ├── ConversationPage.tsx  # 对话（空壳）
│       │   ├── ConnectorsPage.tsx    # 连接器（空壳）
│       │   └── SettingsPage.tsx      # 设置（空壳）
│       ├── components/
│       │   ├── Sidebar.tsx       # 左侧边栏
│       │   └── ContextPanel.tsx  # 右侧上下文面板
│       ├── stores/
│       │   └── app.ts            # Zustand: 全局状态（侧边栏展开、当前页面等）
│       └── styles/
│           └── globals.css       # Tailwind 入口 + 基础样式
```

### 0.5 Electron 主进程

**`main/index.ts`**:
```typescript
import { app, BrowserWindow } from 'electron';
import { setupIPC } from './ipc';
import { setupTray } from './tray';

let mainWindow: BrowserWindow | null = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',  // macOS 无边框 + 红绿灯
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // ⚠️ sandbox: false 是已知安全退让，preload 需要 ipcRenderer
      // 补偿: contextIsolation + 最小化 preload API
      // 后续优化: 全部 Node 操作移到 main，preload 仅 IPC
      sandbox: false,
    },
  });

  // Dev: Vite dev server; Prod: file://
  if (is.dev) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']!);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  setupIPC();
  setupTray();
  createMainWindow();
});

app.on('window-all-closed', () => {
  // macOS: 不退出，保持托盘
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createMainWindow();
});
```

**`main/tray.ts`**:
```typescript
import { Tray, Menu, nativeImage } from 'electron';

export function setupTray() {
  const icon = nativeImage.createFromPath(/* tray icon path */);
  const tray = new Tray(icon.resize({ width: 18, height: 18 }));

  const menu = Menu.buildFromTemplate([
    { label: 'Show JoWork', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quick Chat', accelerator: 'CmdOrCtrl+Shift+Space' },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip('JoWork');
}
```

**`preload/index.ts`**:
```typescript
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // 通用 IPC 调用
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  off: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  },

  // 类型安全的 API（Phase 1+ 逐步添加）
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  },
};

contextBridge.exposeInMainWorld('jowork', api);
```

### 0.6 React 前端骨架

**`renderer/App.tsx`**:
```tsx
// ⚠️ 必须用 HashRouter — Electron 生产 file:// 不支持 HTML5 history API
import { HashRouter, Routes, Route } from 'react-router';
import { MainLayout } from './layouts/MainLayout';
import { ConversationPage } from './pages/ConversationPage';
import { ConnectorsPage } from './pages/ConnectorsPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<ConversationPage />} />
          <Route path="connectors" element={<ConnectorsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
```

**`renderer/layouts/MainLayout.tsx`** — 核心三栏布局:
```tsx
// 三栏: 左侧边栏 (220px, 可收起) + 主内容 (flex-1) + 右侧面板 (320px, 可收起)
// 顶部: macOS 拖拽区（-webkit-app-region: drag）
// 左栏内容: 品牌 Logo + 模式 badge, 快速搜索, 导航项, Connector 列表, 底部设置/用户
// 主区域: <Outlet /> 渲染子路由
// 右栏: 上下文面板（Phase 2 填充内容）
```

**`renderer/components/Sidebar.tsx`**:
```tsx
// 导航项: AI 助手（对话）, 仪表盘, Connectors
// Connector 列表: 绿点/红点状态指示器
// 底部: 设置, 计费, 积分条, 用户头像
// 品牌区: 显示 "Personal" / "Team [名称]" 模式 badge
```

**i18n 从第一天开始**: 所有用户可见文本必须用 `t()` 包裹:
```tsx
import { useTranslation } from 'react-i18next';

function Sidebar() {
  const { t } = useTranslation();
  return <nav>{t('sidebar.conversation')}</nav>;
}
```
Phase 0 只需中文翻译 key，Phase 7 补全英文。

### 0.7 Tailwind + 主题系统

**`renderer/styles/globals.css`**:
```css
@import 'tailwindcss';

/* 参考旧 tokens.css，用 Tailwind CSS 变量重写 */
@theme {
  --color-surface-0: #ffffff;
  --color-surface-1: #f8f9fa;
  --color-surface-2: #f1f3f5;
  --color-text-primary: #1a1a1e;
  --color-text-secondary: #6c6c72;
  --color-accent: #4f46e5;       /* Indigo — JoWork 品牌色 */
  --color-accent-hover: #4338ca;
  --color-border: #e5e7eb;
  /* ... */
}

/* 暗色主题 */
.dark {
  --color-surface-0: #0f0f12;
  --color-surface-1: #1a1a1e;
  --color-surface-2: #252528;
  --color-text-primary: #e8e8ec;
  --color-text-secondary: #9898a0;
  --color-accent: #6366f1;
  --color-border: #2a2a30;
}
```

### 0.8 electron-builder 配置

**`electron-builder.yml`**:
```yaml
appId: com.jowork.app
productName: JoWork
directories:
  output: dist
  buildResources: build

mac:
  target: [dmg, zip]
  category: public.app-category.productivity
  icon: build/icon.icns
  hardenedRuntime: true

win:
  target: nsis
  icon: build/icon.ico

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true

asar:
  unpack: "{**/*.node,**/spawn-helper}"

publish:
  provider: github
```

---

## 验收标准

- [ ] `pnpm install` 成功
- [ ] `pnpm dev` 启动 Electron 窗口
- [ ] 窗口显示三栏布局（左侧边栏 + 中间空白 + 右侧面板）
- [ ] 侧边栏导航可切换页面（对话/连接器/设置）
- [ ] 系统托盘图标可见
- [ ] macOS 窗口拖拽区正常工作
- [ ] `pnpm build` 编译成功
- [ ] `pnpm lint` 无错误
- [ ] 亮色/暗色主题可切换
- [ ] App 启动时间 < 2 秒

---

## 产出文件清单

```
jowork/
├── .gitignore
├── .npmrc
├── LICENSE
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── turbo.json
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/ (types/, db/, i18n/, utils/)
│   └── ui/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/ (index.ts — 空壳)
└── apps/desktop/
    ├── package.json
    ├── electron-builder.yml
    ├── electron-vite.config.ts
    ├── tsconfig*.json
    └── src/ (main/, preload/, renderer/)
```
