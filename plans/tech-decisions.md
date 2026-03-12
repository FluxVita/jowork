# 技术栈决策记录

> 基于 2026-03-13 调研结果。每项记录选择、拒绝方案及理由。

---

## 构建 & Monorepo

### 选择: pnpm 10.x + Turborepo 2.8+

- **pnpm**: 已全局安装 10.17.1，workspace 原生支持
- **Turborepo**: 任务编排 + 缓存，Rust 核心速度快
- `.npmrc` 必须设置 `package-import-method=copy`（macOS hard link + mmap 死锁）

**拒绝方案**:
- Nx: 过重，学习曲线高，2 个 app 不需要
- 纯 pnpm workspace（无 Turborepo）: 可行，但缺少任务缓存和依赖图编排。如果发现 Turborepo 增加了不必要的复杂度，可随时退回

---

## 桌面框架

### 选择: Electron 41.x

- 当前最新稳定版，Chromium 146 + Node.js 24
- 完整的系统 API（Tray、globalShortcut、safeStorage、nativeTheme）
- electron-builder 26.8 成熟打包方案

**拒绝方案**:
- Tauri (Rust): 旧版使用，AI 写 Rust 效率低于 JS，跨语言调试成本高
- Tauri v2 (Swift/Kotlin): 不够成熟，MCP SDK 等核心依赖无 Swift 生态
- Electron Forge: 官方推荐但 auto-update 体验不如 electron-builder。若 electron-builder 出现打包问题可迁移

**注意事项**:
- Electron 41 用 Node.js 24.x，所有 native module 需确认兼容
- 8 周发布周期，`package.json` 中 pin 到具体 major 版本

---

## 构建工具

### 选择: electron-vite 5.0

- 专为 Electron 设计（main + preload + renderer 三入口）
- 基于 Vite 5，HMR 快
- `npm create @electron-vite` 直接生成 React + TypeScript 模板

**拒绝方案**:
- Webpack: 慢，配置复杂
- `vite-plugin-electron`（另一个 electron-vite 组织）: 功能类似但社区更小
- 自定义 Vite 配置: 不值得，electron-vite 已封装好

**注意事项**:
- v5.0 废弃了 `externalizeDepsPlugin`，改用 `build.externalizeDeps`（默认开启）
- Vite 6 支持尚未确认（issue #673），暂用 Vite 5

---

## 前端

### 选择: React 19 + TypeScript + Tailwind CSS 4 + Zustand 5

- React: 最大生态、AI 生成代码质量最高
- Tailwind 4: 零配置 CSS，原子化
- Zustand: 轻量状态管理，比 Redux 简洁 10x

**额外依赖**:
| 包 | 版本 | 用途 |
|---|---|---|
| react-router | 7.x | 路由 |
| @tanstack/react-query | 5.x | IPC 调用缓存 + 异步状态 |
| react-i18next | 15.x | 国际化 |
| @xterm/xterm | 5.x | 终端模拟器 |
| lucide-react | latest | 图标 |
| sonner | latest | Toast 通知 |
| @radix-ui/* | latest | 无障碍组件原语 |

**拒绝方案**:
- Vue 3: 旧版使用 CDN 模式，组件生态不如 React
- Svelte: AI 生成质量不稳定
- Solid: 生态太小

---

## 数据库

### 选择: better-sqlite3 12.x + drizzle-orm 0.45+

- better-sqlite3: 同步 API，Electron main process 中性能最优
- drizzle-orm: 类型安全 ORM，schema-first，迁移工具好用

**关键注意**:
- 每次 Electron 版本升级后必须 `npx @electron/rebuild -f -w better-sqlite3`
- `electron-builder.yml` 中 ASAR unpack: `**/*.node`
- `drizzle-kit` 不能在打包后的 Electron 中运行，迁移用 `drizzle-orm` 的 `migrate()` 在 app 启动时执行

**拒绝方案**:
- Prisma: 运行时需要 Rust binary，Electron 打包复杂
- TypeORM: 类型推导弱
- 手写 SQL（旧版方式）: 可行但缺少类型安全和迁移管理

---

## MCP SDK

### 选择: @modelcontextprotocol/sdk 1.27.x

- 官方 SDK，支持 stdio/SSE/Streamable HTTP
- 同时支持 Client 和 Server
- peer dep: zod

**注意事项**:
- Import 用子路径: `@modelcontextprotocol/sdk/server/mcp.js`，无 barrel export
- v2 预期将拆分为 `@modelcontextprotocol/server` + `@modelcontextprotocol/client`
- v1.27.1 修复了命令注入漏洞，不要用更早版本

---

## 终端

### 选择: node-pty 1.1.0 + @xterm/xterm 5.x

- node-pty: Microsoft 维护（VS Code 同款）
- xterm.js: 标准终端渲染方案

**打包注意**:
- ASAR unpack: `{**/*.node,**/spawn-helper}`
- 打包后需 `chmod +x spawn-helper`
- 只在 main process 使用，renderer 通过 IPC 通信

**备选**: `@lydell/node-pty` 1.2.0-beta.3（更轻量 fork，打包问题更少）

---

## 凭据存储

### 选择: Electron safeStorage API

- 内置 Electron，无需额外 native module
- macOS: Keychain Access, Windows: DPAPI, Linux: kwallet/libsecret
- 配合 electron-store 持久化加密 Buffer

**拒绝方案**:
- keytar: **已归档**（2022 年 12 月），不再维护
- 自研 AES 加密（旧版方式）: 密钥管理不如系统钥匙串安全

**注意事项**:
- `isEncryptionAvailable()` 在 Windows 上 `app.ready` 之前返回 false
- macOS Electron 大版本升级可能触发 Keychain 密码提示

---

## AI 引擎集成

### 选择: Claude Agent SDK 0.2.x（本地）+ Claude Agent SDK 服务端（云端）

**本地引擎** — subprocess 模式:
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
for await (const msg of query({ prompt, options: { cwd, resume: sessionId } })) { ... }
```

**云端引擎** — 服务端 agent loop:
- JoWork Cloud 用同一个 SDK 运行 agent loop
- 用户通过 API 调用，消耗积分

**CLI 模式备选**:
```bash
claude -p --output-format stream-json "query"
claude --resume <session-id> -p "continue"
```

**注意事项**:
- SDK 版本变动频繁（0.2.x），pin 具体版本
- 需要用户有 `ANTHROPIC_API_KEY` 或 Claude Code 订阅
- SDK 底层 spawn `claude` CLI，必须预装

---

## 云服务

### 选择: Hono + PostgreSQL + BullMQ + Fly.io

| 组件 | 选择 | 理由 |
|------|------|------|
| HTTP | Hono | 轻量、TypeScript-first、Edge-ready |
| 数据库 | PostgreSQL (Fly.io 托管) | 团队数据 + ACID |
| 队列 | BullMQ + Upstash Redis | 任务调度、云端扫描 |
| 部署 | Fly.io | 自动扩缩容、按用量付费、多区域 |
| 支付 | Stripe | 已有集成经验 |
| JWT | jose | 纯 JS，无 native dep |
| 验证 | zod 4 | 类型安全 |

---

## 打包 & 分发

### 选择: electron-builder 26.x

- DMG (macOS) + NSIS (Windows)
- `electron-updater` 自动更新
- 支持 GitHub Releases / S3 / generic HTTP 作为更新源

**配置要点**:
```yaml
mac:
  target: [dmg, zip]      # zip 用于自动更新
  hardenedRuntime: true
  notarize: true
win:
  target: nsis
publish:
  provider: github         # 或 generic URL
```

---

## 测试

### 选择: Vitest + Testing Library + Playwright

| 层级 | 工具 | 覆盖 |
|------|------|------|
| 单元 | Vitest | 核心逻辑、工具函数 |
| 组件 | @testing-library/react | React 组件 |
| E2E | Playwright + playwright-electron | 完整用户流程 |
| 代码质量 | ESLint 9 + Prettier | 风格一致性 |

---

## Electron 路由

### 选择: HashRouter（react-router）

- Electron 生产构建用 `file://` 协议，不支持 HTML5 history API
- `BrowserRouter` 在 `file://` 下刷新页面会 404
- `HashRouter` 用 `#/path` 格式，完全兼容 `file://`

**拒绝方案**:
- `BrowserRouter`: 仅 dev server 模式可用，生产 `file://` 不兼容
- `createMemoryRouter`: 可行但不支持浏览器前进/后退

---

## Markdown 流式渲染

### 选择: 自定义增量渲染方案

- `react-markdown` 每次更新重新解析整个 markdown，流式场景性能差
- 方案: `remark-parse` + 手动增量 token 追加 + `react-markdown` 仅渲染完成的 block
- 或用 `markdown-it`（增量友好）+ 自定义 React wrapper

**拒绝方案**:
- 纯 `react-markdown`：流式场景每帧重新解析全文，长回复时卡顿
- `@mdx-js/react`：过重，针对 MDX 不是纯 markdown

---

## Preload 安全

### 决策: `sandbox: false`（已知安全退让）

- preload 需要 `ipcRenderer` 等 Node API
- `sandbox: true` 下 preload 无法 `require('electron')`
- 安全补偿: `contextIsolation: true` + `nodeIntegration: false` + preload 只暴露最小 API
- 后续优化: 把所有 Node 操作移到 main process，preload 仅做 IPC 桥接

---

## Windows 构建

### 注意事项

- better-sqlite3 和 node-pty 需要 Windows 编译环境:
  - Visual Studio Build Tools (含 C++ 桌面开发工作负载)
  - Python 3.x
- GitHub Actions Windows runner 需要 `windows-latest` + `npm install --global windows-build-tools`
- electron-builder NSIS 打包无需额外配置
- 每次 Electron 大版本更新后 Windows 需要重新 rebuild native modules

---

## 版本锁定清单

```json
{
  "electron": "^41.0.0",
  "electron-vite": "^5.0.0",
  "electron-builder": "^26.8.0",
  "electron-updater": "^6.0.0",
  "electron-store": "^10.0.0",
  "electron-log": "^6.0.0",
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "react-router": "^7.0.0",
  "zustand": "^5.0.0",
  "tailwindcss": "^4.0.0",
  "@tanstack/react-query": "^5.0.0",
  "@tanstack/react-virtual": "^3.0.0",
  "react-i18next": "^15.0.0",
  "i18next": "^24.0.0",
  "lucide-react": "latest",
  "sonner": "latest",
  "@radix-ui/react-dialog": "latest",
  "@radix-ui/react-dropdown-menu": "latest",
  "markdown-it": "^14.0.0",
  "better-sqlite3": "^12.7.0",
  "drizzle-orm": "^0.45.0",
  "drizzle-kit": "^0.30.0",
  "@modelcontextprotocol/sdk": "^1.27.0",
  "node-pty": "^1.1.0",
  "@xterm/xterm": "^5.0.0",
  "@xterm/addon-fit": "^0.10.0",
  "@xterm/addon-webgl": "^0.18.0",
  "@anthropic-ai/claude-agent-sdk": "~0.2.74",
  "chokidar": "^4.0.0",
  "croner": "^9.0.0",
  "nanoid": "^5.0.0",
  "hono": "^4.0.0",
  "bullmq": "^5.0.0",
  "ioredis": "^5.0.0",
  "stripe": "^17.0.0",
  "jose": "^6.0.0",
  "zod": "^4.0.0",
  "vitest": "^3.0.0",
  "@testing-library/react": "^16.0.0",
  "playwright": "^1.50.0",
  "eslint": "^9.0.0",
  "prettier": "^3.0.0",
  "turborepo": "^2.8.0",
  "typescript": "^5.9.0"
}
```
