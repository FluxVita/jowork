# GitLab → GitHub OSS 同步策略

## 1. 角色定义

- `GitLab (master/main)`：唯一真源（闭源 + 开源全量代码）
- `GitHub (FluxVita/jowork)`：自动生成的 OSS 视图（只含可开源内容）

> 原则：不在 GitHub 手改功能代码，所有改动回到 GitLab 合并后再同步。

## 2. 机器可执行机制

- 同步排除清单：`scripts/oss-sync-excludes.txt`
- 开源安全扫描：`scripts/check-opensource.sh --ci`
- OSS 可运行验证：`scripts/verify-oss-runnable.sh`
- 可选本地钩子：`scripts/install-git-hooks.sh`（安装 `.githooks/pre-push`）

## 3. CI 质量门禁

在同步到 GitHub 前必须全部通过：

1. `check-opensource`
2. `quality-gate`（`npm run lint` + `npm test`）
3. `verify-oss-runnable`

任一失败，不允许进行 GitHub 同步。

### 同步边界原则

- 默认同步全部开源资产（含 `docs/`、`.github/`、`src-tauri/`）
- 仅在 `scripts/oss-sync-excludes.txt` 中明确排除闭源/敏感路径
- 禁止在 CI 脚本中额外写一套临时 `--exclude` 规则

## 4. 边界变更流程

当新增/移动目录导致开源边界变化时，必须同时修改：

1. `scripts/oss-sync-excludes.txt`
2. `.gitlab-ci.yml`（如有流程变化）
3. 本文档（策略说明）

否则视为边界变更不完整。
