# Phase 6: 认证 + 计费 + 团队

> **复杂度**: L | **依赖**: Phase 5 (云服务基础)
> **验收**: 完整付费流程可走通；Team 模式可邀请成员

---

## 目标

实现 Personal 模式（无需登录）、可选登录（云端同步）、Team 模式、Stripe 计费（积分 + 功能阶梯）、团队管理。

---

## 参考旧代码

| 旧文件 | 参考什么 |
|--------|---------|
| `packages/core/src/billing/` | Stripe Checkout/Portal/Webhook、积分追踪、功能门控 |
| `packages/core/src/auth/jwt.ts` | JWT 生成/验证 |
| `packages/core/src/auth/users.ts` | 用户 CRUD |
| `packages/core/src/policy/engine.ts` | RBAC 检查（简化版用于 Team） |

---

## 步骤

### 6.1 Personal 模式（默认）

- **无需登录**: App 启动即可使用（本地引擎）
- **无需注册**: 所有数据存本地 SQLite
- **本地永久免费**: 本地引擎 / 本地 Connector / 本地记忆 / 本地 Skills 不收费，不按 connector 数量收费
- **可选登录**: 想用云服务（云引擎、同步、远程通道、云定时任务、托管 API）时才需要
- **本地用户标识**: 自动生成 `local_user_id`（UUID），存 electron-store

### 6.2 认证（可选）

**文件**: `apps/desktop/src/main/auth/`

**Google OAuth 流程**:
```typescript
class AuthManager {
  async loginWithGoogle(): Promise<User> {
    // 打开 Electron 窗口加载 Google OAuth
    const authWindow = new BrowserWindow({ width: 500, height: 600 });
    authWindow.loadURL(`${cloudUrl}/auth/google`);

    // 拦截回调 → 获取 JWT
    return new Promise((resolve) => {
      authWindow.webContents.on('will-redirect', async (event, url) => {
        if (url.includes('/auth/callback')) {
          const token = new URL(url).searchParams.get('token');
          await this.saveToken(token);
          resolve(this.decodeUser(token));
          authWindow.close();
        }
      });
    });
  }

  async logout(): Promise<void> {
    await this.clearToken();
    // 切换回 Personal 模式
  }
}
```

**云服务认证端点** (`apps/cloud/src/auth/`):
```typescript
// Google OAuth
GET  /auth/google          → redirect to Google
GET  /auth/google/callback → exchange code → issue JWT → redirect to app
POST /auth/refresh         → refresh JWT
POST /auth/logout          → revoke
```

### 6.3 Stripe 计费

**文件**: `apps/cloud/src/billing/`

**三档订阅**:

| Plan | 月费 | 积分/月 | 功能 |
|------|------|---------|------|
| Free | $0 | 50/天（登录后体验积分） | 本地模式全部功能 + 可一键购买云积分 |
| Pro | $19 | 5000/月 | 云引擎、云定时任务、远程通道、同步、托管 API，且支持额外充值 |
| Team | $29/人 | 按 seat 叠加（如 base × N 人/月）共享池 | Pro 全部 + 团队工作区 + 多成员 + 管理后台 + 团队统一充值 |

**计费原则（已确认）**:
- 收费对象是**云能力**，不是本地 connector 数量
- 用户可直接购买 JoWork 托管 API 所需积分，不要求自行去外部单独采购 API
- 自带本地引擎的用户仍可完全免费使用本地模式

**积分消耗规则**:
```typescript
const CREDIT_COSTS = {
  'cloud-engine-message': 10,    // 一次云引擎对话
  'ai-notification-summary': 2,   // AI 通知摘要
  'cloud-scheduled-task': 5,      // 云端定时任务执行
};
```

**积分钱包**:
- 任意已登录用户都可直接充值积分包（top-up）
- Pro/Team 自带月度额度；超出后继续从积分钱包扣减
- Team 积分为共享池，按 seat 叠加月度赠送额度

**积分耗尽行为**:
- 不能发新消息到云引擎
- 仍可使用本地引擎（如果已安装）
- 仍可查看历史、浏览数据、改设置
- Free 版每日 00:00 UTC 重置

**Stripe 集成**:
```typescript
// 创建 Checkout Session
POST /billing/checkout     → Stripe Checkout URL
// 客户门户（管理订阅）
GET  /billing/portal       → Stripe Portal URL
// Webhook（订阅变更、付款成功/失败）
POST /billing/webhook      → 处理 Stripe events
// 积分查询
GET  /billing/credits      → { used, remaining, resetAt }
// 单独购买积分包
POST /billing/top-up       → Stripe Checkout URL
```

### 6.4 Team 模式

**云端数据库** (`apps/cloud/src/db/`):

```sql
-- 用户表
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  plan TEXT DEFAULT 'free',
  stripe_customer_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 团队/工作区
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT REFERENCES users(id),
  plan TEXT DEFAULT 'team',
  invite_code TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 团队成员
CREATE TABLE team_members (
  team_id TEXT REFERENCES teams(id),
  user_id TEXT REFERENCES users(id),
  role TEXT DEFAULT 'member',  -- 'owner' | 'admin' | 'member'
  joined_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

-- Team 对话（云端主库，本地缓存）
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  team_id TEXT REFERENCES teams(id),
  user_id TEXT REFERENCES users(id),
  title TEXT,
  engine_id TEXT,
  message_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_name TEXT,
  tokens INTEGER,
  cost INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Team 记忆（scope='team' 的记忆云端为准）
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  team_id TEXT REFERENCES teams(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags JSONB,
  scope TEXT NOT NULL DEFAULT 'team',
  pinned BOOLEAN DEFAULT FALSE,
  source TEXT,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Team 上下文文档（云端主库）
CREATE TABLE context_docs (
  id TEXT PRIMARY KEY,
  team_id TEXT REFERENCES teams(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'team',
  category TEXT,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 积分追踪
CREATE TABLE credits (
  user_id TEXT REFERENCES users(id),
  team_id TEXT REFERENCES teams(id),  -- NULL for personal
  used INTEGER DEFAULT 0,
  monthly_limit INTEGER,              -- Pro/Team 订阅自带月度额度
  wallet_balance INTEGER DEFAULT 0,   -- 充值积分包余额（top-up）
  daily_free_limit INTEGER DEFAULT 50,
  daily_free_used INTEGER DEFAULT 0,
  daily_free_reset_at TIMESTAMP,
  period_start TIMESTAMP,
  period_end TIMESTAMP
);

-- 积分扣减顺序: daily_free → monthly_limit → wallet_balance
-- 充值积分不过期，不随月度周期重置
-- Team 月度额度 = credit_per_seat × 当前 seat 数（从 team_members 表 COUNT）
-- credit_per_seat 由 Plan 决定，存在 plans 配置中，不在此表
```

**团队管理 API**:
```typescript
POST /teams              → 创建团队
GET  /teams/:id          → 团队详情
POST /teams/:id/invite   → 生成邀请链接
POST /teams/join/:code   → 通过邀请链接加入
DELETE /teams/:id/members/:userId → 移除成员
PATCH /teams/:id/members/:userId → 修改角色
```

**数据主从**:
- Team 数据以云端为准，本地只做缓存和离线副本
- Personal 数据以本地为准；如果用户开启 Personal Sync，再推送到云端

### 6.5 模式切换

**侧边栏品牌区**: 显示当前模式 badge
- "Personal" — 本地模式
- "Team: [团队名]" — 团队模式

**切换逻辑**:
- 切换时重新加载对话列表、数据源、记忆（各模式独立）
- 设置/偏好跨模式共享
- 类似 IDE 切换项目

### 6.6 计费 UI

**目录**: `apps/desktop/src/renderer/features/billing/`

```
billing/
├── BillingPage.tsx          # 计费主页（当前 plan、积分余额、用量图表）
├── PlanSelector.tsx         # Plan 选择（Free/Pro/Team 对比卡片）
├── CreditBar.tsx            # 积分进度条（侧边栏底部）
├── UsageChart.tsx           # 用量趋势图
└── hooks/useBilling.ts
```

### 6.7 团队管理 UI

**目录**: `apps/desktop/src/renderer/features/team/`

```
team/
├── TeamPage.tsx             # 团队管理主页
├── MemberList.tsx           # 成员列表（角色、操作）
├── InviteDialog.tsx         # 邀请链接弹窗
├── TeamSettings.tsx         # 团队设置（名称、头像）
└── hooks/useTeam.ts
```

---

## 验收标准

- [ ] Personal 模式无需登录即可使用
- [ ] Google OAuth 登录流程完整
- [ ] 登录后可切换到 Team 模式
- [ ] Stripe Checkout → 订阅成功 → Plan 升级
- [ ] 未订阅用户也可直接购买积分包并消费云能力
- [ ] 积分追踪正确（消耗、查询、每日重置）
- [ ] 积分耗尽时云引擎不可用，本地引擎仍可用
- [ ] 团队邀请链接可用，新成员可加入
- [ ] 团队管理（角色修改、成员移除）

---

## 产出文件

```
apps/desktop/src/main/auth/
├── manager.ts
├── token-store.ts
└── mode.ts          # Personal/Team 模式管理

apps/cloud/src/auth/
├── google.ts
├── jwt.ts
└── middleware.ts

apps/cloud/src/billing/
├── stripe.ts
├── credits.ts
├── webhook.ts
└── plans.ts

apps/cloud/src/team/
├── teams.ts
├── members.ts
└── invites.ts

apps/cloud/src/db/
├── schema.ts        # PostgreSQL Drizzle schema
└── migrate.ts

apps/desktop/src/renderer/features/billing/
apps/desktop/src/renderer/features/team/
```
