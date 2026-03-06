/**
 * Klaude 认证代理 — 独立进程入口
 *
 * 与 Gateway (18800) 完全解耦，重启 Gateway 不会影响此进程。
 *
 * 启动方式：
 *   npm run klaude-auth        # 开发模式（tsx 热重载）
 *   npm run klaude-auth:start  # 生产模式（node dist）
 */

import { startKlaudeAuthServer } from './gateway/klaude-auth-server.js';

const port = parseInt(process.env['KLAUDE_PROXY_PORT'] ?? '8899');
startKlaudeAuthServer(port);
