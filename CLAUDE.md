# CLAUDE.md — JoWork v2

## 项目状态

**阶段**: 计划完成，尚未开始开发
**计划文件**: `PLAN.md` (总览) + `plans/` (分阶段详细计划)

## 与旧项目的关系

- **旧项目**: `/Users/signalz/Documents/augment-projects/jowork-v1-archived`（归档，仅作参考）
- **旧项目**: `/Users/signalz/Documents/augment-projects/fluxvita_allinone`（同上）
- **本项目**: 从零重写，不直接复用旧代码

## 技术栈

- Monorepo: pnpm + Turborepo
- 桌面: Electron 41 + electron-vite 5
- 前端: React 19 + TypeScript + Tailwind CSS 4 + Zustand 5
- 数据库: better-sqlite3 + Drizzle ORM (本地), PostgreSQL (云端)
- AI 引擎: Claude Agent SDK (本地 subprocess + 云端 agent loop)
- MCP: @modelcontextprotocol/sdk 1.27+ (Client + Server)
- 云服务: Hono + Fly.io + BullMQ + Stripe

## 开发流程

1. 开始新 Phase 前先读对应的 `plans/phase-X-*.md`
2. 参考旧代码时去 `jowork-v1-archived` 或 `fluxvita_allinone` 目录
3. 每个 Phase 完成后对照验收标准逐项检查

## 常用命令（待 Phase 0 完成后可用）

```bash
pnpm install
pnpm dev          # electron-vite dev
pnpm build        # 全量构建
pnpm lint         # TypeScript + ESLint
pnpm test         # Vitest
pnpm test:e2e     # Playwright
```
