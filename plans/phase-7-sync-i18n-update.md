# Phase 7: 同步 + i18n + 自动更新

> **复杂度**: M | **依赖**: Phase 6 (认证 + 团队)
> **验收**: 两台设备对话 5 秒内同步；完整中文 UI

---

## 目标

实现多设备对话同步、设置同步、离线模式、完整 i18n 中文翻译、Electron 自动更新。

---

## 步骤

### 7.1 多设备同步

**策略**: Team 云端主库 + Personal 本地主库 + Push/Pull + WebSocket Fast Path

```typescript
// 每条可同步记录带 syncVersion
interface Syncable {
  syncVersion: number;
  updatedAt: number;
  deletedAt?: number;  // 软删除
}
```

**同步数据分类**:

| 数据 | 同步方式 | 说明 |
|------|---------|------|
| 对话 + 消息 | Team 必须，Personal 可选 | Team 云端为准；关键操作立即 push |
| 记忆 | 团队层必须，个人层可选 | Team 云端为准；Personal 本地为准 |
| 上下文文档 | 团队层必须 | Team 云端主库，本地缓存 |
| Connector 本地凭据 | **不同步** | 仍只存在本地安全存储 |
| Connector 云端代执行凭据 | 不走常规 sync | 仅在用户显式授权后写入云端 vault |
| 偏好设置 | 同步 | 多设备一致 |
| 定时任务 | 同步 | 云端执行 |
| 积分 | 云端为准 | |

**同步 API**:
```typescript
POST /sync/push     → { changes: SyncRecord[] }
POST /sync/pull     → { since: number } → { changes: SyncRecord[] }
GET  /sync/status   → { lastSyncAt, pendingCount }
GET  /sync/stream   → WebSocket / SSE fast path（关键操作 5 秒内送达）
```

**冲突解决**:
- Team 数据: 云端版本为准，本地收到 server ack 后回写缓存
- Personal 数据: 本地版本为准；若开启 Personal Sync，云端仅作备份/跨设备分发
- 文档/设置类记录默认 Last-Writer-Wins（`updatedAt` 更大的胜出）
- 消息/事件类记录默认 append-only，不做覆盖合并

**同步频率 / SLA**:
- 关键操作（发消息、完成任务、修改 Team 文档、变更任务开关）立即 push
- 设备在线时用 WebSocket / 长连加速，目标 5 秒内同步到其他设备
- 后台兜底仍保留 30 秒轮询 + 手动触发

### 7.2 离线模式

- App 无网络时仍可:
  - 查看历史对话
  - 浏览已同步的数据
  - 使用本地引擎对话
  - 修改设置
- 产生的变更排队，上线后自动同步
- UI 显示离线状态指示器

### 7.3 i18n

**文件**: `packages/core/src/i18n/`

**架构**: react-i18next + i18next

**翻译文件结构**:
```
packages/core/src/i18n/
├── index.ts           # i18next 初始化
├── locales/
│   ├── zh/
│   │   ├── common.json    # 通用词汇
│   │   ├── sidebar.json   # 侧边栏
│   │   ├── chat.json      # 对话
│   │   ├── connectors.json
│   │   ├── settings.json
│   │   ├── billing.json
│   │   ├── team.json
│   │   ├── memory.json
│   │   ├── skills.json
│   │   ├── scheduler.json
│   │   └── onboarding.json
│   └── en/
│       └── (同上结构)
```

**实现优先级**:
1. 先写中文（主要用户群）
2. 代码/注释保持英文
3. 架构从第一天 ready（所有用户可见文本用 `t()` 包裹）

### 7.4 Electron 自动更新

**文件**: `apps/desktop/src/main/updater.ts`

```typescript
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

export function setupAutoUpdater() {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    // 通知 renderer: 新版本可用
    mainWindow.webContents.send('update:available', info);
  });

  autoUpdater.on('update-downloaded', (info) => {
    // 通知 renderer: 下载完成，重启安装
    mainWindow.webContents.send('update:downloaded', info);
  });

  // 每小时检查一次
  setInterval(() => autoUpdater.checkForUpdates(), 60 * 60 * 1000);

  // 启动时检查
  autoUpdater.checkForUpdatesAndNotify();
}
```

**更新 UI**:
- 系统通知 "JoWork 新版本可用"
- 设置页面显示当前版本 + 更新状态
- "立即重启更新" 按钮

**发布流程**:
- GitHub Actions: push tag → electron-builder 打包 → GitHub Releases
- electron-updater 从 GitHub Releases 拉取更新

---

## 验收标准

- [ ] 两台设备登录同一账号，关键对话与任务变更 5 秒内同步
- [ ] 设置变更跨设备同步
- [ ] 离线时可查看历史、使用本地引擎
- [ ] 上线后自动同步离线期间的变更
- [ ] 完整中文 UI（所有用户可见文本）
- [ ] 自动更新检测 + 下载 + 安装重启

---

## 产出文件

```
apps/desktop/src/main/sync/
├── sync-manager.ts
├── conflict-resolver.ts
└── offline-queue.ts

apps/cloud/src/sync/
├── push.ts
├── pull.ts
└── status.ts

packages/core/src/i18n/
├── index.ts
└── locales/ (zh/, en/)

apps/desktop/src/main/updater.ts
```
