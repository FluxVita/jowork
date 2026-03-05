# AGENTS.md — AI 工程师协作规范

> 本项目由多个 Claude AI 实例在 **master 分支**上并行开发。
> 每次会话开始时必须读取本文件。

---

## 一、会话开始（必须执行）

```bash
git pull origin master
git log --oneline -10    # 了解其他 AI 最近改了什么
git status               # 确认工作区干净
```

**如果 `git status` 有未提交的改动**：
这是上一个 AI session 的遗留。先读懂是什么，再决定：
- 如果是完整可用的改动 → `git add . && git commit -m "chore: 提交上个 session 的遗留改动"` → `git push`
- 如果是明显错误的改动 → 告知 Aiden，等确认后再处理，**不要自行 `git checkout .`**

---

## 二、工作过程中的核心原则

### 小步提交，不要积累大改动

每完成一个独立的小改动就立刻提交并推送，不要攒到最后一起提：

```bash
# 每个小步骤完成后
npm run lint              # 必须无错误
git add <具体文件>        # 不要用 git add .，要明确指定文件
git commit -m "feat: xxx"
git push origin master
```

### 提交前必须再次 pull

这是防止冲突最重要的一步：

```bash
git pull origin master    # ← 提交前再 pull 一次
npm run lint
git add <具体文件>
git commit -m "feat: xxx"
git push origin master
```

这个顺序固定，不能省略中间的 pull。

---

## 三、遇到冲突时

如果 `git pull` 后出现 merge conflict：

```bash
# 查看冲突文件
git status

# 查看冲突内容（看清楚两边改了什么）
git diff
```

**冲突处理原则**：
- 理解冲突双方的改动意图，**两边的改动通常都要保留**
- 不要简单选"我的"或"他们的"，要手动合并逻辑
- 合并后确认功能完整，再 `npm run lint` 验证
- 如果冲突复杂（超过 5 个文件或涉及核心逻辑）→ 告知 Aiden

```bash
# 解决后
git add <冲突文件>
git commit -m "fix: 解决与其他 AI 改动的冲突"
git push origin master
```

---

## 四、高危文件——改之前先看最近的提交记录

以下文件容易被多个 AI 同时修改，操作前先检查：

```bash
git log --oneline -5 -- <文件路径>
```

| 文件 | 高危原因 |
|------|---------|
| `src/index.ts` | 所有模块的启动注册点 |
| `src/gateway/server.ts` | 所有路由挂载点 |
| `src/datamap/db.ts` | 数据库表结构定义 |
| `public/admin.html` | 所有管理功能入口，体积大 |
| `public/shell.html` | 前端主框架 |
| `src/auth/settings.ts` | 系统配置白名单 |
| `package.json` | 依赖声明 |
| `src-tauri/Cargo.toml` | Rust 依赖声明 |

如果这些文件在 10 分钟内有其他提交，**先 pull 后再改**，不要和别人的改动撞车。

---

## 五、提交消息格式

```
feat: 新功能描述
fix: 修复问题描述
refactor: 重构描述
chore: 构建/依赖/工具变更
docs: 文档变更
```

消息要让下一个 AI 看懂你改了什么，尤其是涉及高危文件时说明改了哪一块：

```bash
# 好的示例
git commit -m "feat: admin.html 新增 AI 模型 Tab（仅管理员可见）"
git commit -m "fix: router.ts 动态读取 provider 优先级配置"

# 不好的示例
git commit -m "update"
git commit -m "fix bug"
```

---

## 六、只改任务要求的范围

- **不要顺手"优化"**任务之外的代码
- **不要顺便修复**不在任务内的 bug（记录下来告知 Aiden）
- **不要删除文件**，除非 Aiden 明确要求
- **不要修改 `.env`**，除非 Aiden 明确要求

---

## 七、Rust/Tauri 改动的额外要求

改动 `src-tauri/` 下任何文件后，必须验证编译：

```bash
cd src-tauri && cargo check
```

Cargo check 通过后再提交。Tauri 改动不会自动部署，需告知 Aiden 手动打包。

---

## 八、会话结束前检查

```bash
git status       # 确认没有未提交的改动
git log --oneline -3   # 确认提交已推送到远端
```

**不能有未推送的本地提交就结束会话。** 下一个 AI 不会知道本地改动的存在。

---

## 九、必须停下来告知 Aiden 的情况

遇到下列情况，停止操作，说明情况，等 Aiden 决策：

1. 冲突涉及超过 5 个文件，或涉及核心逻辑（`db.ts`、`server.ts`、`index.ts`）
2. `npm run lint` 有错误但不知道如何修复
3. 任务要求删除文件或删除数据库表
4. 任务要求修改 `.env` 或生产配置
5. 发现 master 上有明显的破坏性 bug（影响所有用户）

---

## 快速参考卡

```
会话开始：git pull → git log -10 → git status
工作过程：小步完成 → lint → pull → add(具体文件) → commit → push
遇到冲突：读懂双方意图 → 手动合并 → lint → commit → push
会话结束：git status 确认干净 → git log 确认已推送
```
