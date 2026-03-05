# Jowork 自主开发

你在 **GitHub Actions ubuntu-latest** 环境，jowork repo `main` 分支，工作目录是 repo 根。

---

## 关键背景（必读）

这个 `jowork` repo 是**从零全新构建**的，不是从别处迁移来的。代码已经实现并在正确位置：

```
packages/core/src/        ← 核心模块（utils, types, config, datamap, auth, agent...）
packages/premium/src/     ← 高级功能
apps/jowork/src/          ← 开源版应用入口
apps/fluxvita/src/        ← FluxVita 内部版入口
```

`docs/JOWORK-PLAN.md` 里的 `- [ ]` 任务描述了各模块的实现要求，这些模块大多**已经实现**。你的工作是**逐一验证并标记完成**，如果发现真的缺失则补充实现。

---

## 行动规则（严格按顺序）

**每个任务只允许 3 步：**

```
第1步（最多2次工具调用）：快速验证相关代码是否存在
  → ls packages/core/src/ 或 cat 某个关键文件头几行

第2步（必须做）：编辑 docs/JOWORK-PLAN.md
  → 把对应的 "- [ ]" 改为 "- [x]"
  → 如果代码确实不存在，先用 Write/Edit 工具创建文件，然后再标记

第3步（每5个任务一次）：git commit
  → git add -A
  → git commit -m "chore(jowork): mark tasks done [skip ci]"
```

**禁止行为：**
- 不要运行 `pnpm test`（CI 环境耗时太长）
- 不要运行 `pnpm install`（已预装）
- 不要为了"理解全局"而读超过 3 个文件
- 不要等验证 100% 确定才标记——代码存在就标记

---

## 任务完成参考

| PLAN.md 里描述的任务 | 对应验证方式 |
|---------------------|-------------|
| 移动 utils/、types.ts、config.ts | `ls packages/core/src/utils` + `ls packages/core/src/types.ts` |
| 移动 datamap/ | `ls packages/core/src/datamap/` |
| 移动 auth/、policy/ | `ls packages/core/src/auth/` |
| 移动 agent/ | `ls packages/core/src/agent/` |
| 实现 edition.ts | `cat packages/core/src/edition.ts` |
| 创建 apps/jowork/src/index.ts | `ls apps/jowork/src/index.ts` |
| 实现 premium 包 | `ls packages/premium/src/` |

---

## git 操作

```bash
# 标记 5 个任务后提交
git add -A
git commit -m "chore(jowork): mark tasks done [skip ci]"
# 不要 push（外部脚本负责 push）
```

---

**开始：** 根据下方本轮任务，立即执行——先标记 PLAN.md，再继续下一个。目标：本轮标记尽量多的 `- [ ]` 为 `- [x]`。
