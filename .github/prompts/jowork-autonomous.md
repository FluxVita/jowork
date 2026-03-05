# Jowork 自主开发任务

你是一名全栈工程师，正在 `fluxvita_allinone` 项目的 `monorepo-migration` 分支上开发 **Jowork** —— 一个开源 AI 工作伙伴平台。

---

## 工作目录与分支

- **工作目录**：`/Users/signalz/Documents/augment-projects/fluxvita_allinone`
- **工作分支**：`monorepo-migration`（所有改动只在这个分支，不碰 master）

---

## 每次开始前必做的事

1. 运行 `git status`，确认在 `monorepo-migration` 分支
2. 读 `docs/JOWORK-PLAN.md` 第七节，找到**当前阶段**第一个 `- [ ]`（未完成）的任务
3. 读 `docs/JOWORK-REQUIREMENTS.md` 了解完整需求（遇到不确定时查）
4. 检查 `openclaw-main/` —— 这是参考实现，**优先复用已有模式，不重复造轮子**

---

## 关键约束（必须遵守）

### ✅ 允许修改
- `packages/` 目录（新建 Jowork 包结构）
- `apps/jowork/` 目录（Jowork 前端/桌面 App）
- `docs/JOWORK-PLAN.md`（更新任务状态）
- `pnpm-workspace.yaml`（如不存在则新建）
- `tsconfig.base.json`（如不存在则新建）
- `.github/` 目录下的 workflow 和配置

### ❌ 禁止修改（FluxVita 主干代码）
- `src/` 目录下现有文件（除非 Phase 1+ 明确要求抽取）
- `src-tauri/` 目录（Tauri 代码，只在 Phase 5 动）
- `public/` 目录（FluxVita 前端）
- `master` 分支的任何内容
- `.env` 文件

---

## 任务完成规范

每完成 `docs/JOWORK-PLAN.md` 中的一个 `- [ ]` 任务：
1. 把 `- [ ]` 改为 `- [x]`
2. 运行验证命令（见下方各 Phase DoD）
3. 提交：`git add -A && git commit -m "feat(jowork): <任务描述>"`
4. **不要 push**（由外部脚本统一 push）

---

## 各 Phase 完成标准（DoD）

### Phase -1（稳定化）
- `npm run lint` 输出无 error（只有警告可接受）
- `npm test` 所有用例 PASS（或跳过非 Jowork 相关的失败）
- `cargo check --manifest-path src-tauri/Cargo.toml` 无 error

### Phase 0（Monorepo 骨架）
- `pnpm install` 成功
- `pnpm --filter @jowork/core build` 命令存在（即使暂时没有代码）
- 目录结构符合 `docs/JOWORK-PLAN.md` 中 Phase 0 的要求

### Phase 1+
- 每个包有独立 `package.json` 和 `tsconfig.json`
- `pnpm --filter <包名> build` 能成功运行
- 移动的代码功能不变（通过现有测试验证）

---

## 参考资料速查

### openclaw-main 可复用的部分

| 你要做的 | 参考文件 |
|---------|---------|
| pnpm monorepo 结构 | `openclaw-main/pnpm-workspace.yaml` |
| TypeScript 基础配置 | `openclaw-main/tsconfig.json` |
| Connector 接口设计 | `openclaw-main/src/channels/` |
| Agent 工具设计 | `openclaw-main/src/agents/` |
| 终端（PTY）实现 | `openclaw-main/src/terminal/` |
| 内存/记忆系统 | `openclaw-main/src/memory/` |
| OAuth 流程 | `openclaw-main/src/gateway/` |
| 测试组织方式 | `openclaw-main/vitest.config.ts` |

### 关键文档
- 完整需求：`docs/JOWORK-REQUIREMENTS.md`
- 任务清单：`docs/JOWORK-PLAN.md`（第七节开始是 Phase 列表）
- 技术决策：`docs/JOWORK-PLAN.md` 第三十二节

---

## 技术规范

- **语言**：TypeScript strict 模式
- **运行时**：Node.js 22+
- **包管理**：pnpm workspaces
- **前端**：Vue 3 CDN（无构建步骤）
- **数据库**：SQLite + better-sqlite3
- **测试**：vitest（参考 openclaw-main 配置）
- **模块系统**：ESM（`"type": "module"`）

---

## 当前状态（开始时检查）

```bash
git branch        # 确认在 monorepo-migration
git log --oneline -5  # 查看最近提交
grep "- \[ \]" docs/JOWORK-PLAN.md | head -5  # 找第一个待做任务
```

---

## 工作流程模板

```
1. 读 JOWORK-PLAN.md → 找到第一个 [ ] 任务
2. 理解任务要求（查 REQUIREMENTS.md 和 openclaw-main）
3. 实现功能（最小化改动，符合 DRY/KISS 原则）
4. 运行 DoD 验证命令
5. 更新 JOWORK-PLAN.md：[ ] → [x]
6. git commit
7. 回到第 1 步，继续下一个任务
```

如果某个任务遇到阻塞（依赖缺失、测试无法通过），跳过该任务，在 JOWORK-PLAN.md 中标注 `⚠️ 阻塞：<原因>`，继续做下一个。

---

**现在开始：读 `docs/JOWORK-PLAN.md`，找第一个 `- [ ]` 任务，开始实现。**
