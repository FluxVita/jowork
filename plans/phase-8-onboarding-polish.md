# Phase 8: Onboarding + 打磨

> **复杂度**: S | **依赖**: Phase 7
> **验收**: 新用户 3 分钟内完成 onboarding 并体验到"它知道我的工作！"

---

## 目标

实现 6 步引导式 onboarding，Aha Moment 设计，性能优化，错误边界，无障碍审计。

---

## 步骤

### 8.1 Onboarding 流程（6 步）

**目录**: `apps/desktop/src/renderer/features/onboarding/`

#### Step 1: 欢迎 + 语言选择
- Logo 动画
- "你好！我是 JoWork，你的 AI 工作搭档"
- 语言切换（中文/English）

#### Step 2: 登录/跳过
- "想让 JoWork 更强大？登录获得云端 AI 和团队协作"
- Google 登录按钮
- "跳过，先用本地模式" 链接
- Personal 模式用户可完全跳过

#### Step 3: AI 引擎检测
- 后台自动检测 Claude Code / OpenClaw
- 已安装 → 显示绿勾 "已检测到 Claude Code"，自动跳过
- 未安装 → "后台安装中..." 进度条，**不阻塞下一步**
- "不想装？用 JoWork 云 AI（需登录）" 备选

#### Step 4: 连接工作工具（关键步骤）
- 主界面只突出**核心首发集合**
- 推荐连接 3-5 个最重要的：GitHub、GitLab、Figma、飞书（群消息 / 文档）、本地项目文件夹
- OAuth 型 connector 点击后进入授权弹窗；本地项目文件夹走目录选择器
- 底部: "跳过，稍后在设置中连接"
- **与 Step 3 引擎安装并行进行**

#### Step 5: 告诉 JoWork 你是谁（可跳过）
- 工作风格文档简化版
  - "你的角色？"（下拉: 工程师/PM/设计师/运营/创始人/其他）
  - "你的沟通偏好？"（简洁/详细）
  - "任何 AI 必须遵守的规则？"（可选文本框）
- "跳过，让 JoWork 自己了解你"

#### Step 6: Aha Moment — 第一个问题
- 基于已连接的数据源推荐 3 个问题:
  - 连了 GitHub → "帮我看看这周有哪些 PR 需要 review"
  - 连了飞书群消息 → "总结一下这个飞书群今天的重点"
  - 连了飞书文档 → "总结这篇飞书文档的关键结论"
  - 连了本地项目文件夹 → "这个项目目录最近最值得我关注的文件是什么？"
- Agent 用真实数据回答，**这是 Aha Moment**
- 如果引擎还没装好且用户**已登录** → 自动回退到 JoWork 云代理（消耗体验积分 / 充值积分）
- 如果引擎还没装好且用户**未登录** → 明确给两条路径:
  - 先登录，领取体验积分并立即体验云引擎
  - 继续等待本地引擎安装完成

**Onboarding 状态持久化**:
```typescript
// electron-store
{
  onboardingCompleted: boolean;
  onboardingStep: number;         // 断点续接
  skipLogin: boolean;
  connectedDuringOnboarding: string[];
}
```

### 8.2 性能优化

- **启动优化**:
  - 主窗口延迟加载非关键模块
  - Preload 只暴露最小 API
  - Connector 进程延迟启动（用到时才 spawn）
- **渲染优化**:
  - 消息列表虚拟滚动（`@tanstack/react-virtual`）
  - 流式文本增量更新（不重绘整个列表）
  - 大文件预览懒加载
- **数据库优化**:
  - SQLite WAL 模式
  - 关键查询建索引
  - FTS 索引定期 rebuild
- **目标**: App 启动 < 2 秒，消息渲染 < 16ms（60fps）

### 8.3 错误边界 + 优雅降级

```tsx
// 全局错误边界
class AppErrorBoundary extends React.Component {
  // 捕获 render 错误 → 显示友好错误页面
  // 记录错误日志 → 支持用户上报
}

// 功能级错误边界
// Connector 失败 → 显示 "连接中断，点击重试"
// 引擎崩溃 → "AI 引擎异常，正在重启..."
// 网络断开 → "离线模式，部分功能不可用"
```

### 8.4 无障碍审计

- 所有交互元素有 `aria-label`
- 键盘导航完整（Tab 顺序、Focus 管理）
- 颜色对比度 ≥ 4.5:1（WCAG AA）
- 屏幕阅读器兼容

---

## 验收标准

- [ ] 新用户首次启动 → 进入 onboarding
- [ ] 3 分钟内可完成 onboarding 核心路径（语言、登录/跳过、引擎检测、至少 1 个核心 connector、首个问题）
- [ ] Step 6 用真实数据回答问题（Aha Moment）
- [ ] 引擎未装好且已登录时自动回退云代理
- [ ] 引擎未装好且未登录时给出明确分流：登录领体验积分 / 等待本地引擎
- [ ] App 启动时间 < 2 秒
- [ ] 长对话列表滚动流畅（60fps）
- [ ] 引擎崩溃后自动恢复
- [ ] 键盘可完成所有操作

---

## 产出文件

```
apps/desktop/src/renderer/features/onboarding/
├── OnboardingFlow.tsx
├── steps/
│   ├── WelcomeStep.tsx
│   ├── LoginStep.tsx
│   ├── EngineStep.tsx
│   ├── ConnectorsStep.tsx
│   ├── ProfileStep.tsx
│   └── AhaMomentStep.tsx
└── hooks/useOnboarding.ts

apps/desktop/src/renderer/components/
├── ErrorBoundary.tsx
└── VirtualList.tsx
```
