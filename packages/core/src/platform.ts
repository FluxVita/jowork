/**
 * 跨平台兼容层
 *
 * 抽象不同操作系统的差异，使 Jowork 可以运行在
 * macOS、Windows、Linux 上而无需散落各处的 platform 判断。
 */

import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, chmodSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';

// ─── 平台检测 ─────────────────────────────────────────────────────────────────

export const isWindows = process.platform === 'win32';
export const isMac    = process.platform === 'darwin';
export const isLinux  = process.platform === 'linux';

// ─── Shell 环境（LaunchAgent 安全）────────────────────────────────────────────

/**
 * 构造包含完整 PATH 的环境变量对象。
 * LaunchAgent 启动时 /bin/sh 的 PATH 通常只有 /usr/bin:/bin:/usr/sbin:/sbin，
 * 不包含 npm/node/brew 安装的工具。此函数从 process.execPath 推断 Node bin 目录，
 * 并补充常见的 homebrew / 系统路径。
 */
export function getShellEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const nodeBinDir = dirname(process.execPath);
  const basePath = process.env['PATH'] || '/usr/bin:/bin:/usr/sbin:/sbin';
  // 确保 nodeBinDir 在最前面，同时补充 homebrew 路径
  const brewPaths = isMac
    ? '/opt/homebrew/bin:/usr/local/bin'
    : '/usr/local/bin';
  return {
    ...process.env,
    PATH: `${nodeBinDir}:${brewPaths}:${basePath}`,
    ...extra,
  };
}

// ─── 数据目录（遵循各平台规范）─────────────────────────────────────────────────

/**
 * 返回应用数据目录（用户级）。
 * - Windows: %APPDATA%\jowork
 * - macOS:   ~/Library/Application Support/jowork
 * - Linux:   ~/.config/jowork
 *
 * 优先使用 DATA_DIR 环境变量（Docker / 自定义路径场景）。
 */
export function getDataDir(): string {
  if (process.env['DATA_DIR']) return process.env['DATA_DIR'];

  if (isWindows) {
    return join(process.env['APPDATA'] ?? homedir(), 'jowork');
  }
  if (isMac) {
    return join(homedir(), 'Library', 'Application Support', 'jowork');
  }
  // Linux 默认
  return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'jowork');
}

/**
 * 返回日志目录。
 * - Windows: %LOCALAPPDATA%\jowork\logs
 * - macOS:   ~/Library/Logs/jowork
 * - Linux:   ~/.local/share/jowork/logs
 *
 * 优先使用 LOG_DIR 环境变量。
 */
export function getLogDir(): string {
  if (process.env['LOG_DIR']) return process.env['LOG_DIR'];

  if (isWindows) {
    return join(process.env['LOCALAPPDATA'] ?? homedir(), 'jowork', 'logs');
  }
  if (isMac) {
    return join(homedir(), 'Library', 'Logs', 'jowork');
  }
  return join(process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'), 'jowork', 'logs');
}

// ─── 文件权限（Windows 不支持 chmod）─────────────────────────────────────────

/**
 * 跨平台设置文件权限。
 * Windows 忽略此操作（NT ACL 模型不同，不需要 chmod）。
 */
export function chmodSafe(path: string, mode: number): void {
  if (isWindows) return;
  try { chmodSync(path, mode); } catch { /* 权限不足时静默忽略 */ }
}

// ─── 目录创建 ─────────────────────────────────────────────────────────────────

/** 递归创建目录，跨平台安全。 */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ─── 进程 / 守护进程管理 ─────────────────────────────────────────────────────

/**
 * 启动后台守护进程（平台差异封装）。
 * - macOS/Linux：使用 nohup 或 pm2（如已安装）
 * - Windows：使用 pm2（如已安装）
 *
 * 注意：Jowork 在容器化场景下建议直接在前台运行，不使用此函数。
 */
export function daemonize(command: string, args: string[] = []): void {
  const cmdStr = [command, ...args].join(' ');

  const env = getShellEnv();
  if (isWindows) {
    // Windows: 尝试用 pm2，否则用 cmd.exe start /B
    try {
      execSync(`pm2 start ${cmdStr} --name jowork`, { stdio: 'ignore', env });
    } catch {
      execSync(`cmd.exe /c start /B ${cmdStr}`, { stdio: 'ignore', env });
    }
  } else {
    // macOS/Linux: 尝试 pm2，否则 nohup
    try {
      execSync(`pm2 start ${cmdStr} --name jowork`, { stdio: 'ignore', env });
    } catch {
      execSync(`/bin/sh -c "nohup ${cmdStr} &"`, { stdio: 'ignore', env });
    }
  }
}

// ─── 自签名证书生成（无需 openssl CLI）───────────────────────────────────────

/**
 * 通过 Node.js crypto 生成自签名证书（Windows 上 openssl 可能不可用）。
 * 返回 PEM 格式的 { key, cert }。
 *
 * 注意：此函数依赖 Node.js 内置 `crypto` 模块，
 * 若需要完整 X.509 支持，请安装 `@peculiar/x509` 包。
 */
export async function generateSelfSignedCert(cn: string = 'jowork'): Promise<{ key: string; cert: string } | null> {
  try {
    // 优先使用 openssl（macOS / Linux 通常已安装）
    if (!isWindows) {
      const { execSync: exec } = await import('node:child_process');
      const { tmpdir } = await import('node:os');
      const { join: pjoin } = await import('node:path');
      const { randomUUID } = await import('node:crypto');
      const { readFileSync, unlinkSync } = await import('node:fs');

      const tmpKey  = pjoin(tmpdir(), `${randomUUID().slice(0, 8)}.key`);
      const tmpCert = pjoin(tmpdir(), `${randomUUID().slice(0, 8)}.crt`);
      try {
        exec(
          `openssl req -x509 -newkey rsa:2048 -keyout "${tmpKey}" -out "${tmpCert}" ` +
          `-days 3650 -nodes -subj "/CN=${cn}"`,
          { stdio: 'ignore', env: getShellEnv() },
        );
        const key  = readFileSync(tmpKey, 'utf-8');
        const cert = readFileSync(tmpCert, 'utf-8');
        try { unlinkSync(tmpKey); unlinkSync(tmpCert); } catch { /* ignore */ }
        return { key, cert };
      } catch {
        return null;
      }
    }
    // Windows: 提示用户手动生成（或集成 win-ca 包）
    return null;
  } catch {
    return null;
  }
}

// ─── 路径工具 ─────────────────────────────────────────────────────────────────

/**
 * 规范化路径（兼容 Windows 反斜杠）。
 * 用于日志输出和 URI 构建，非文件系统操作请用 path.join()。
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

// ─── 磁盘使用量（跨平台）─────────────────────────────────────────────────────

/**
 * 计算目录大小（MB），跨平台实现。
 * macOS/Linux 使用 `du -sm`，Windows 使用 Node.js 递归遍历。
 */
export function getDirSizeMb(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;

  if (!isWindows) {
    // Unix/macOS: du -sm 最快
    try {
      const output = execSync(`du -sm "${dirPath}"`, { stdio: ['pipe', 'pipe', 'pipe'], env: getShellEnv() });
      return parseFloat(output.toString().split('\t')[0]) || 0;
    } catch {
      return 0;
    }
  }

  // Windows: 递归遍历文件大小（同步）
  function walk(dir: string): number {
    let total = 0;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) total += walk(full);
        else try { total += statSync(full).size; } catch { /* skip */ }
      }
    } catch { /* skip unreadable dirs */ }
    return total;
  }
  try {
    return walk(dirPath) / (1024 * 1024);
  } catch {
    return 0;
  }
}
