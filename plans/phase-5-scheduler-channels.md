# Phase 5: 定时任务 + 远程通道

> **复杂度**: M | **依赖**: Phase 2 (Connector) + Phase 3 (Skills/记忆)
> **验收**: "每天早上 10 点告诉我今天的工作重点" 在电脑关机时云端执行，结果推到飞书

---

## 目标

实现 Cron 调度器（本地 + 云端），飞书 Bot 远程通道（智能路由），主动通知系统。

---

## 参考旧代码

| 旧文件 | 参考什么 |
|--------|---------|
| `packages/core/src/scheduler/executor.ts` | Cron 任务分发、并行执行 |
| `packages/core/src/scheduler/nl-parser.ts` | 自然语言 → cron 表达式解析 |
| `packages/core/src/channels/feishu.ts` | 飞书 Bot 消息发送、卡片格式 |
| `packages/core/src/channels/registry.ts` | 多通道注册工厂 |

---

## 步骤

### 5.0 Cloud Service 骨架（前置步骤）

> Phase 5/6/7 都需要云服务。在此统一搭建骨架。

**创建 `apps/cloud/`**:
```
apps/cloud/
├── package.json           # name: "@jowork/cloud"
├── tsconfig.json
├── Dockerfile
├── fly.toml               # Fly.io 部署配置
└── src/
    ├── server.ts           # Hono HTTP 框架入口
    ├── db/
    │   ├── schema.ts       # PostgreSQL Drizzle schema（独立于本地 SQLite schema）
    │   └── migrate.ts
    ├── middleware/
    │   └── auth.ts         # JWT 验证中间件（Phase 6 填充）
    └── health.ts           # /health 端点
```

**关键配置**:
```typescript
// server.ts
import { Hono } from 'hono';
const app = new Hono();
app.get('/health', (c) => c.json({ ok: true }));
export default app;
```

**`pnpm-workspace.yaml` 更新**: 添加 `'apps/cloud'`（如果不在 `'apps/*'` glob 内）

**PostgreSQL schema 与本地 SQLite 的关系**:
- 共享类型定义: `packages/core/src/types/` 中的 Session, Message, Memory 等接口
- 各自 schema 文件: `packages/core/src/db/schema.ts`（SQLite）vs `apps/cloud/src/db/schema.ts`（PostgreSQL）
- 同步时通过 JSON 序列化传输，不要求表结构完全一致

### 5.1 本地 Cron 调度器

**文件**: `apps/desktop/src/main/scheduler/index.ts`

```typescript
import { Cron } from 'croner';

class Scheduler {
  private jobs: Map<string, Cron> = new Map();

  schedule(task: ScheduledTask): void {
    const job = new Cron(task.cronExpression, {
      timezone: task.timezone || 'Asia/Shanghai',
    }, async () => {
      await this.execute(task);
    });
    this.jobs.set(task.id, job);
  }

  private async execute(task: ScheduledTask): Promise<void> {
    switch (task.type) {
      case 'scan':      // 主动扫描数据源
        await this.executeScan(task);
        break;
      case 'skill':     // 执行 Skill — 委托给 Phase 3 的 SkillExecutor
        await skillExecutor.execute(task.config.skillId, task.config.variables);
        break;
      case 'notify':    // 发送通知
        await this.executeNotify(task);
        break;
    }
  }
}
```

**Schema**（`packages/core/src/db/schema.ts` 新增）:
```typescript
export const scheduledTasks = sqliteTable('scheduled_tasks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  cronExpression: text('cron_expression').notNull(),
  timezone: text('timezone').default('Asia/Shanghai'),
  type: text('type').notNull(),         // 'scan' | 'skill' | 'notify'
  config: text('config'),               // JSON
  enabled: integer('enabled').default(1),
  lastRunAt: integer('last_run_at'),
  nextRunAt: integer('next_run_at'),
  cloudSync: integer('cloud_sync').default(0),  // 是否同步到云端执行
  createdAt: integer('created_at').notNull(),
});
```

### 5.2 主动通知系统

**混合模式**:
- App 开着 → 本地 Cron 定期扫描（零云端成本）
- App 关了 → 云端只接管**已开启“允许云端代执行”**的 connector（需登录 + 云端凭据授权）

**云端代执行授权模型**:
- 默认关闭：普通 connector 只在本地可用
- 单 connector 开关：在 connector 详情页单独开启“允许云端代执行”
- 一键全开：设置页提供批量授权，给所有支持云端执行的 connector 一次性开通云端副本凭据
- 不支持云端代执行的本地能力（如本地项目文件夹、剪贴板）不会进入云端任务池

**规则过滤 + AI 摘要**:
```typescript
interface NotificationRule {
  id: string;
  connectorId: string;
  condition: string;         // 'mention_me' | 'p0_issue' | 'pr_review_requested' | 'custom'
  customFilter?: string;     // 自定义过滤表达式
  channels: string[];        // ['system', 'feishu', 'app']
  silentHours?: { start: string; end: string };
  aiSummary: boolean;        // 命中后是否用 AI 生成摘要（消耗积分）
}
```

**扫描流程**:
1. Cron 触发 → 调用 Connector 获取最新数据
2. 与上次扫描对比，找出新增/变更
3. 规则匹配 → 命中的生成通知
4. 如果 `aiSummary: true` → 调用引擎生成人类可读摘要
5. 发送到指定通道

### 5.3 飞书 Bot 远程通道

**文件**: `apps/cloud/src/channels/feishu-bot.ts`（云服务侧）

**智能路由**:
```
用户在飞书发消息给 JoWork Bot
        │
        ▼
  云端收到消息
        │
        ├─ 能在云端处理的（查数据、发消息、查日历）
        │  → 云端直接调用 Connector API → 回复飞书
        │
        ├─ 需要操作电脑的（打开文件、跑命令、读剪贴板）
        │  → WebSocket 转发到用户本地 JoWork
        │  → 本地执行 → 结果回传云端 → 回复飞书
        │
        └─ 电脑不在线
           → 排队等待，上线后请求用户确认
           → 回复飞书 "已记录，电脑上线后确认执行"
```

**本地 WebSocket 客户端**:
```typescript
// apps/desktop/src/main/sync/ws-client.ts
class RemoteChannel {
  private ws: WebSocket;

  connect(cloudUrl: string, token: string): void {
    this.ws = new WebSocket(`${cloudUrl}/ws/channel`);
    this.ws.on('message', async (data) => {
      const task = JSON.parse(data);
      const result = await this.executeLocally(task);
      this.ws.send(JSON.stringify({ taskId: task.id, result }));
    });
  }
}
```

### 5.4 云端代执行授权（"一键全开"）

**云端 credential vault**（`apps/cloud/src/db/schema.ts` 新增）:
```sql
CREATE TABLE cloud_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  connector_id TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,  -- 服务端加密存储
  authorized_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,                  -- 可选有效期
  UNIQUE (user_id, connector_id)
);
```

**API 端点**（`apps/cloud/src/credentials/`）:
```typescript
POST   /credentials/authorize      → 单个 connector 授权（上传加密凭据到云端 vault）
DELETE /credentials/revoke/:id     → 撤销单个 connector 云端凭据
POST   /credentials/authorize-all  → 一键全开（批量授权所有支持云端执行的 connector）
GET    /credentials/status         → 查询各 connector 云端授权状态
```

**本地侧**:
- 设置页 "云端代执行" 区域：每个 connector 一个开关 + 顶部"一键全开"按钮
- 开启时：本地读取 `CredentialStore` 中的凭据 → 加密传输到云端 vault
- 关闭时：调 `/credentials/revoke` 删除云端副本，本地凭据不受影响
- 不支持云端执行的 connector（本地项目文件夹、剪贴板）灰色不可开启

**云端 Scheduler 执行路径**:
- `scan` 类任务：云端直接用 `cloud_credentials` 中的凭据调 connector API
- `skill` 类任务：云端调用 Cloud Engine（Phase 6 的 Claude Agent SDK 服务端），消耗积分
- `notify` 类任务：云端读取扫描结果 + 发送到通道（飞书等）
- 无云端凭据的 connector：跳过，不执行

### 5.5 定时任务 UI

**目录**: `apps/desktop/src/renderer/features/scheduler/`

```
scheduler/
├── SchedulerPage.tsx         # 定时任务管理主页
├── TaskCard.tsx              # 单个任务卡片（状态、下次执行时间）
├── TaskEditor.tsx            # 创建/编辑任务
├── CronPicker.tsx            # Cron 表达式选择器（可视化 + 自然语言输入）
├── TaskHistory.tsx           # 任务执行历史
└── hooks/useScheduler.ts
```

### 5.6 通知设置 UI

**目录**: `apps/desktop/src/renderer/features/notifications/`

```
notifications/
├── NotificationCenter.tsx    # 通知中心（App 内通知列表）
├── NotificationRules.tsx     # 通知规则配置
├── RuleEditor.tsx            # 编辑单条规则
└── hooks/useNotifications.ts
```

---

## 验收标准

- [ ] 创建定时任务 "每天早上 10 点汇总 GitHub PR"
- [ ] 任务按时执行，结果出现在 App 通知中心
- [ ] 飞书 Bot 收到消息 → 云端路由 → 正确回复
- [ ] 需要本地操作的飞书请求 → WebSocket 转发到本地执行
- [ ] 电脑关机时，已开启云端代执行的 connector 任务仍可在云端执行
- [ ] 一键全开可批量授权所有支持云端执行的 connector
- [ ] 通知规则配置正常（静默时段、通道选择）
- [ ] 主动扫描发现新 PR → 系统通知弹出

---

## 产出文件

```
apps/desktop/src/main/scheduler/
├── index.ts
├── scanner.ts
└── notification-rules.ts

apps/desktop/src/main/sync/
└── ws-client.ts

apps/cloud/src/channels/
├── feishu-bot.ts
└── router.ts

apps/cloud/src/credentials/
├── vault.ts               # 云端 credential vault CRUD
├── authorize.ts           # 授权/撤销 API
└── status.ts

apps/cloud/src/scheduler/
├── cloud-executor.ts      # scan 直调 connector API; skill 调 Cloud Engine
└── task-queue.ts

apps/desktop/src/renderer/features/scheduler/
apps/desktop/src/renderer/features/notifications/
```
