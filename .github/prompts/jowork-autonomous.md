# Jowork 自主开发任务

你是一名全栈工程师，正在 **jowork** 开源仓库的 `main` 分支上自主开发。

---

## 环境说明

- **工作目录**：当前 checkout 目录（即 jowork repo 根目录）
- **分支**：`main`（已 checkout，无需切换）
- **包管理**：pnpm workspaces
- **关键文档**：`docs/JOWORK-PLAN.md`（任务清单）、`CLAUDE.md`（项目约定）

---

## 每轮工作流程

**第一步：找任务**

```bash
grep -n "- \[ \]" docs/JOWORK-PLAN.md | head -5
```

找到第一个 `- [ ]` 任务，读懂它要做什么。

**第二步：检查现有代码**

很多任务对应的代码可能已在仓库中存在（参考状态表），先检查再实现：
- 读 `packages/core/src/` 下的代码
- 读 `apps/jowork/src/` 和 `apps/fluxvita/src/`
- 看 `pnpm-workspace.yaml` 和各包的 `package.json`

**第三步：实现或验证**

- 若代码**已存在且正确** → 直接进入第四步
- 若代码**不存在或不完整** → 实现它（遵循 CLAUDE.md 中的技术规范）

**第四步：验证**

```bash
cd packages/core && pnpm lint && pnpm test
```

如果 lint/test 失败，修复后再继续。

**第五步：更新任务状态**

在 `docs/JOWORK-PLAN.md` 中把完成的 `- [ ]` 改为 `- [x]`。

**第六步：提交**

```bash
git add -A
git commit -m "feat(jowork): <任务描述>"
```

**第七步：回到第一步，继续下一个任务**

在同一轮 session 内，尽量完成多个任务。遇到阻塞的任务，在 JOWORK-PLAN.md 里标注 `⚠️ 阻塞：<原因>`，跳过继续下一个。

---

## 技术规范（来自 CLAUDE.md）

- **语言**：TypeScript strict 模式
- **运行时**：Node.js 22+
- **包管理**：pnpm workspaces
- **前端**：Vue 3 CDN（无构建步骤）
- **数据库**：SQLite + better-sqlite3
- **测试**：vitest
- **模块系统**：ESM（`"type": "module"`）
- Express 5 wildcard 写法：`/{*path}`
- 路径别名：`@/*` → `src/*`

---

## 项目结构

```
jowork/
  packages/
    core/          # @jowork/core — 核心功能（AGPL-3.0）
    premium/       # @jowork/premium — 商业功能
  apps/
    jowork/        # 开源桌面应用
    fluxvita/      # 内部版（FluxVita 品牌）
  docs/            # 文档（含 JOWORK-PLAN.md）
  scripts/         # 工具脚本
```

---

**现在开始：读 `docs/JOWORK-PLAN.md`，找第一个 `- [ ]` 任务，实现它，提交，继续下一个。**
