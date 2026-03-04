# Jowork — AI 开发记忆

## 当前进度

最后完成：Phase 40（2026-03-05）
最新 commit：575c057

## 已完成 Phases（关键说明）

- Phase 0-10: Monorepo 骨架 + core/premium/apps + CI/CD
- Phase 11-20: 安全/性能/网络/备份/法律/付费/成本/GTM
- Phase 22-38: 连接器扩展 + 全套 REST API + SSE 流式 + 工具调用
- **Phase 39**: Markdown 渲染 + ⚙ 设置面板（Models/Connectors/System）
- **Phase 40**: 设置面板扩展（Agent 配置编辑 + Memories 管理）

## 关键文件路径

- 前端（jowork）: `apps/jowork/public/index.html`
- 前端（fluxvita）: `apps/fluxvita/public/index.html`
- core 路由: `packages/core/src/gateway/routes/`
- core 入口: `packages/core/src/index.ts`
- jowork 服务入口: `apps/jowork/src/index.ts`

## 前端架构

- Vue 3 CDN（esm-browser.js）+ marked.js（esm.run）
- 无构建步骤，单文件 HTML
- 设置面板：5 标签 — Agent | Models | Connectors | Memories | System
- 默认打开 Agent 标签
- 所有 API 都走 `/api/*`，personal mode 自动鉴权（role=owner）

## 下一步建议

- Phase 41: 定时任务管理 UI（Scheduler tab in settings）
- Phase 41: 工作方式文档 UI（PUT /api/context/workstyle）
- Tauri sidecar（Phase 32.1）：将 Gateway 打包为 Bun --compile 二进制

## pnpm 命令

```bash
pnpm lint    # tsc --noEmit 全部包
pnpm test    # packages/core 单测（260/260）
```
