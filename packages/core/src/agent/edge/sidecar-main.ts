/**
 * Edge Sidecar 入口 — Tauri 通过 stdio 调用
 *
 * 协议：
 * - stdin: 一行 JSON（SidecarConfig）
 * - stdout: 每行一个 JSON（AgentEvent）
 * - stderr: 日志信息
 *
 * 启动模式：
 * - backend: "server" → 通过 HTTP 调 Gateway（个人服务器版/团队版）
 * - backend: "local"  → 纯本地运行（个人本地版，Phase 2 实现）
 */

import type { SidecarConfig, EdgeBackend } from './types.js';
import type { AgentEvent } from '../types.js';
import { ServerBackend } from './server-backend.js';
import { LocalBackend } from './local-backend.js';
import { edgeAgentLoop } from './edge-loop.js';

function emit(event: AgentEvent) {
  process.stdout.write(JSON.stringify(event) + '\n');
}

function logErr(msg: string) {
  process.stderr.write(`[edge-sidecar] ${msg}\n`);
}

async function main() {
  // 从 stdin 读取配置（单行 JSON）
  const input = await new Promise<string>((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
      // 读到换行符即完成
      const nlIdx = data.indexOf('\n');
      if (nlIdx !== -1) {
        resolve(data.slice(0, nlIdx));
      }
    });
    // 如果 stdin 关闭前没有换行，用全部数据
    process.stdin.on('end', () => resolve(data.trim()));
  });

  let config: SidecarConfig;
  try {
    config = JSON.parse(input);
  } catch (err) {
    logErr(`Invalid config JSON: ${String(err)}`);
    emit({ event: 'error', data: { message: 'Invalid config JSON' } });
    process.exit(1);
    return;
  }

  logErr(`Starting edge sidecar: backend=${config.backend} message="${config.message.slice(0, 50)}..."`);

  let backend: EdgeBackend;
  const cwd = config.cwd ?? process.cwd();

  if (config.backend === 'local') {
    // 个人本地版：BYOK 直连模型 API + JSON 文件存储
    if (!config.api_key) {
      emit({ event: 'error', data: { message: 'api_key is required for local backend' } });
      process.exit(1);
      return;
    }
    backend = new LocalBackend(config.api_key, config.api_provider ?? 'anthropic');
  } else {
    // 个人服务器版 / 团队版：通过 HTTP 调 Gateway
    if (!config.gateway_url || !config.jwt) {
      emit({ event: 'error', data: { message: 'gateway_url and jwt are required for server backend' } });
      process.exit(1);
      return;
    }
    backend = new ServerBackend(config.gateway_url, config.jwt);
  }

  try {
    for await (const event of edgeAgentLoop({
      backend,
      message: config.message,
      sessionId: config.session_id,
      cwd,
    })) {
      emit(event);
    }
  } catch (err) {
    logErr(`Fatal error: ${String(err)}`);
    emit({ event: 'error', data: { message: String(err) } });
    emit({ event: 'stopped', data: {} });
  }

  process.exit(0);
}

main();
