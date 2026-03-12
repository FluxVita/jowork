# Phase 3: 记忆 + 上下文 + Skills

> **复杂度**: L | **依赖**: Phase 1（Skills 执行需要引擎）| **可与 Phase 2/4 并行**
> **验收**: Agent 跨会话记住用户偏好；Claude Code 的 skill 在 JoWork 中可见可用

---

## 目标

实现记忆系统（存储、检索、自动学习），两层上下文文档，工作风格编辑器，Skills 系统（多格式加载 + 统一执行）。

---

## 参考旧代码

| 旧文件 | 参考什么 |
|--------|---------|
| `packages/core/src/memory/user-memory.ts` | Memory CRUD、标签搜索、scope 过滤 |
| `packages/core/src/memory/embedding.ts` | 向量嵌入接口、语义搜索 |
| `packages/core/src/context/docs.ts` | 三层上下文组装、token 预算感知裁剪 |
| `packages/core/src/agent/workstyle.ts` | Agent 人格/风格配置 |
| `packages/core/src/skills/loader.ts` | Skill 发现、加载 |
| `packages/core/src/skills/manager.ts` | Skill 注册、管理 |
| `packages/core/src/skills/executor.ts` | Skill 执行 |
| `packages/core/src/skills/types.ts` | Skill manifest 类型定义 |

---

## 步骤

### 3.1 记忆系统

**目录**: `apps/desktop/src/main/memory/`

**Schema 扩展**（`packages/core/src/db/schema.ts`）:
```typescript
export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  tags: text('tags'),                    // JSON array
  scope: text('scope').notNull(),        // 'personal' | 'team'
  pinned: integer('pinned').default(0),
  source: text('source'),                // 'user' | 'auto' — 用户手动 vs agent 自动提取
  lastUsedAt: integer('last_used_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
```

**MemoryStore 类**:
```typescript
class MemoryStore {
  create(memory: NewMemory): Memory
  update(id: string, patch: Partial<Memory>): Memory
  delete(id: string): void
  list(opts: { scope?, tags?, pinned?, limit? }): Memory[]
  search(query: string): Memory[]          // FTS 搜索
  touchUsed(id: string): void              // 更新 lastUsedAt
}
```

**自动学习**:
- agent 对话结束后，分析对话内容提取潜在记忆（偏好、习惯、要求）
- 用引擎自身做提取："从这段对话中提取用户偏好/决策/重要信息，生成结构化记忆条目"
- 自动记忆标记 `source: 'auto'`，用户可在 UI 中审核/删除

### 3.2 两层上下文文档

**目录**: `apps/desktop/src/main/context/`

**Schema 扩展**（`packages/core/src/db/schema.ts`）:
```typescript
export const contextDocs = sqliteTable('context_docs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),     // Markdown
  scope: text('scope').notNull(),          // 'team' | 'personal'
  category: text('category'),              // 'standard' | 'okr' | 'knowledge' | 'preference'
  priority: integer('priority').default(0), // 高优先级的在 token 预算裁剪时保留
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
```

**团队层**（Team Context）:
- 公司规范、OKR、共享知识
- **云端为准，本地缓存**：Team 模式写入云端 PostgreSQL，本地 SQLite 只缓存最近可用内容
- Markdown 格式

**个人层**（Personal Context）:
- 用户偏好、工作习惯、个人目标
- **本地为准，可选同步**：默认只存本地 SQLite；若用户开启 Personal Sync，再增量同步到云端

**上下文组装器**:
```typescript
class ContextAssembler {
  // token 预算感知的上下文组装
  assemble(opts: {
    teamDocs: ContextDoc[];
    personalDocs: ContextDoc[];
    memories: Memory[];
    workstyle: string;
    tokenBudget: number;
  }): string {
    // 优先级: workstyle > pinned memories > team docs > personal docs > recent memories
    // 超过 token 预算时从低优先级开始裁剪
  }
}
```

### 3.3 工作风格文档

**文件**: `apps/desktop/src/renderer/features/workstyle/`

- Markdown 编辑器（简单的 textarea + 实时预览）
- 类似 CLAUDE.md，告诉 AI "你是谁、怎么工作、什么风格"
- 每次对话时自动注入 system prompt

**默认模板**:
```markdown
# 我的工作风格

## 角色
[你的职位和职责]

## 沟通偏好
- 回复风格：[简洁/详细]
- 语言：[中文/英文/双语]

## 工作习惯
[你的日常工作流程]

## 重要规则
[AI 必须遵守的规则]
```

### 3.4 Skills 系统

**目录**: `apps/desktop/src/main/skills/`

**四种 Skill 来源（统一加载）**:

1. **Claude Code Commands**:
   - 扫描 `.claude/commands/` 目录
   - 解析 Markdown 文件（frontmatter + prompt body）
   - 映射为 JoWork Skill

2. **Claude Code Skills**:
   - 扫描 `.claude/skills/` 目录
   - 解析 `SKILL.md` / manifest / 模板文件
   - 映射为 JoWork Skill

3. **OpenClaw Skills**:
   - 扫描 OpenClaw skill 目录
   - 路径做成设置项；首次自动检测常见目录，用户可手动覆盖
   - 解析其格式
   - 映射为 JoWork Skill

4. **JoWork 原生 Skills**:
   - JSON/YAML 定义
   - 支持多步骤 + 变量 + 条件分支
   - 内置模板（周报、审 PR、日报汇总等）

**统一 Skill 接口**:
```typescript
interface Skill {
  id: string;
  name: string;
  description: string;
  source: 'claude-code' | 'openclaw' | 'jowork' | 'community';
  trigger: string;               // 触发命令 (e.g., '/weekly-report')
  type: 'simple' | 'workflow';   // 简单 prompt vs 多步骤
  promptTemplate?: string;       // simple: 直接 prompt
  steps?: SkillStep[];           // workflow: 多步骤
  variables?: SkillVariable[];   // 用户输入变量
}
```

**Skill 加载器**:
```typescript
class SkillLoader {
  // 扫描所有来源
  async loadAll(): Promise<Skill[]> {
    const ccCommands = await this.loadClaudeCodeCommands();
    const ccSkills = await this.loadClaudeCodeSkills();
    const ocSkills = await this.loadOpenClawSkills();
    const jwSkills = await this.loadJoWorkSkills();
    const communitySkills = await this.loadCommunitySkills();
    return [...ccCommands, ...ccSkills, ...ocSkills, ...jwSkills, ...communitySkills];
  }

  private async loadClaudeCodeCommands(): Promise<Skill[]> {
    const dir = path.join(os.homedir(), '.claude', 'commands');
    // 递归扫描 .md 文件，解析 frontmatter + body
  }

  private async loadClaudeCodeSkills(): Promise<Skill[]> {
    const dir = path.join(os.homedir(), '.claude', 'skills');
    // 递归扫描 .md 文件，解析 frontmatter + body
  }
}
```

**Skill 执行器**:
```typescript
class SkillExecutor {
  // 简单 Skill: 直接发给引擎
  async executeSimple(skill: Skill, vars: Record<string, string>): Promise<void> {
    const prompt = interpolate(skill.promptTemplate!, vars);
    await engineManager.chat({ message: prompt });
  }

  // 工作流 Skill: 按步骤执行
  async executeWorkflow(skill: Skill, vars: Record<string, string>): Promise<void> {
    for (const step of skill.steps!) {
      // 变量替换 → 条件判断 → 调用引擎/工具 → 收集结果 → 下一步
    }
  }
}
```

### 3.5 记忆 UI

**目录**: `apps/desktop/src/renderer/features/memory/`

```
memory/
├── MemoryPage.tsx            # 记忆管理主页
├── MemoryCard.tsx            # 单条记忆卡片
├── MemoryEditor.tsx          # 创建/编辑记忆
├── MemorySearch.tsx          # 搜索过滤
└── hooks/useMemory.ts
```

### 3.6 Skills UI

**目录**: `apps/desktop/src/renderer/features/skills/`

```
skills/
├── SkillsPanel.tsx           # Skills 列表面板
├── SkillCard.tsx             # 单个 Skill 卡片
├── SkillRunner.tsx           # 执行 Skill（变量输入 → 确认 → 执行）
├── SkillEditor.tsx           # 创建/编辑自定义 Skill
├── SkillMarketplace.tsx      # 社区 Skills 市场
└── hooks/useSkills.ts
```

---

## 验收标准

- [ ] 手动创建记忆 → 跨会话可被 agent 召回
- [ ] Agent 自动从对话中提取记忆（标记 source: 'auto'）
- [ ] 记忆搜索（全文 + 标签）正常工作
- [ ] 工作风格文档编辑 → 影响 AI 回复风格
- [ ] 两层上下文（团队 + 个人）正确注入
- [ ] Claude Code 的 `~/.claude/commands/` 与 `~/.claude/skills/` 中内容出现在 JoWork Skills 列表
- [ ] OpenClaw skill 目录可自动发现或手动配置
- [ ] 点击 Skill → 变量填写 → 引擎执行
- [ ] 内置模板 Skill 可用（至少 3 个）

---

## 产出文件

```
apps/desktop/src/main/memory/
├── store.ts
└── auto-extract.ts

apps/desktop/src/main/context/
├── assembler.ts
└── docs.ts

apps/desktop/src/main/skills/
├── loader.ts
├── executor.ts
├── types.ts
└── templates/          # 内置 skill 模板

apps/desktop/src/renderer/features/memory/
apps/desktop/src/renderer/features/skills/
apps/desktop/src/renderer/features/workstyle/
```
