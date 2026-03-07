# 多 Session 协作协议（自动加载）

本项目常有多个 Claude Code 同时操作。你必须遵守以下协议。

## 会话开始时（必须执行）

1. 运行 `bash .claude/scripts/session-bus.sh status` 了解当前活跃 session
2. 给自己起一个简短名字（如 `api`、`frontend`、`db`、`agent`），注册：
   ```bash
   export CLAUDE_SESSION_NAME="<name>"
   bash .claude/scripts/session-bus.sh join "<name>" "<你的任务简述>"
   ```
3. 声明你将要操作的文件/目录范围：
   ```bash
   bash .claude/scripts/session-bus.sh claim "<name>" "src/agent/"
   ```

## 编辑文件前（必须执行）

在用 Edit 或 Write 修改任何文件之前，先检查冲突：
```bash
bash .claude/scripts/session-bus.sh check "<文件路径>"
```
- 如果返回 `OK` → 安全，可以编辑
- 如果返回 `CONFLICT` → **不要编辑**，告知用户冲突情况，等待指示

对于高危文件（`src/index.ts`、`src/gateway/server.ts`、`src/datamap/db.ts`、`package.json`），即使 check 通过也要额外谨慎，编辑后立刻 commit + push。

## 重要变更后

完成对公共接口/类型/配置的修改后，广播通知其他 session：
```bash
bash .claude/scripts/session-bus.sh broadcast "<name>" "改了 src/agent/tools/registry.ts 的工具注册接口"
```

## 会话结束时

```bash
bash .claude/scripts/session-bus.sh leave "<name>"
```

## 检查频率

每完成一个独立功能点后（commit 前），运行一次 `status` 了解其他 session 的状态。如果发现有新 session 注册了和你重叠的文件范围，主动联系用户确认。
