# Jowork — AI 开发记忆

## 当前进度

最后完成：Phase 45（2026-03-05）
测试：263/263 全绿

## 已完成 Phases（关键说明）

- Phase 0-10: Monorepo 骨架 + core/premium/apps + CI/CD
- Phase 11-20: 安全/性能/网络/备份/法律/付费/成本/GTM
- Phase 22-38: 连接器扩展 + 全套 REST API + SSE 流式 + 工具调用
- **Phase 39**: Markdown 渲染 + ⚙ 设置面板（Models/Connectors/System）
- **Phase 40**: 设置面板扩展（Agent 配置编辑 + Memories 管理）
- **Phase 41**: Scheduler 标签（任务 CRUD + toggle）+ Agent 标签 WorkStyle 编辑区
- **Phase 42**: Usage 标签（用量摘要+预算进度条+7日柱状图）+ Admin 标签（备份/更新/导出/恢复）
- **Phase 43**: Session 管理（重命名/删除，hover 菜单 + inline 编辑）
- **Phase 44**: Model Switcher UI（provider下拉+model下拉/输入+Apply+PUT /api/models/active）
- **Phase 45**: 键盘快捷键（globalKeydown：Cmd+N 新建会话 / Cmd+/ 开关设置 / Esc 关闭设置）

## 关键文件路径

- 前端（jowork）: `apps/jowork/public/index.html`
- 前端（fluxvita）: `apps/fluxvita/public/index.html`
- core 路由: `packages/core/src/gateway/routes/`
- core 入口: `packages/core/src/index.ts`
- jowork 服务入口: `apps/jowork/src/index.ts`
- 进度文档: `docs/JOWORK-PLAN.md` Section 0.7 + Appendix A

## 前端架构

- Vue 3 CDN（esm-browser.js）+ marked.js（esm.run）
- 无构建步骤，单文件 HTML
- 设置面板：8 标签 — Agent | Models | Connectors | Memories | Scheduler | **Usage** | **Admin** | System
- 默认打开 Agent 标签
- Agent 标签底部有 WorkStyle Document 编辑区
- 所有 API 都走 `/api/*`，personal mode 自动鉴权（role=owner）

## 下一步建议

- Tauri sidecar：将 Gateway 打包为 Bun --compile 二进制（apps/jowork Tauri 集成）
- Onboarding 流程 UI（引导用户完成首次配置）
- Phase 46: 消息搜索（全文搜索历史消息，FTS5 已有）

## pnpm 命令

```bash
pnpm lint    # tsc --noEmit 全部包
pnpm test    # packages/core 单测（263/263）
```
