/**
 * GitLab 代码镜像管理
 * 用 git clone --bare 把 GitLab 仓库镜像到本地，AI 可直接读代码文件。
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { config } from '../../config.js';
import { createLogger } from '../../utils/logger.js';
import { getDirSizeMb } from '../../platform.js';

const log = createLogger('repo-mirror');

const REPOS_ROOT = join(dirname(config.db_path), 'repos', 'gitlab');
const CLONE_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0' };

export interface MirrorResult {
  projectId: number;
  action: 'cloned' | 'fetched' | 'skipped';
  durationMs: number;
  error?: string;
}

export interface TreeEntry {
  mode: string;
  type: 'blob' | 'tree';
  hash: string;
  size: number;
  path: string;
}

export interface MirrorInfo {
  projectId: number;
  path: string;
  sizeMb: number;
}

/** bare 仓库存储路径 */
function mirrorPath(projectId: number): string {
  return join(REPOS_ROOT, String(projectId));
}

/** 注入 token 到 clone URL */
function injectToken(cloneUrl: string): string {
  const token = config.gitlab.token;
  if (!token) return cloneUrl;
  // https://gitlab.example.com/group/repo.git → https://oauth2:TOKEN@gitlab.example.com/group/repo.git
  return cloneUrl.replace(/^https:\/\//, `https://oauth2:${token}@`);
}

/** 二进制/忽略文件过滤 */
export function shouldIgnoreFile(filePath: string): boolean {
  const ignoreDirs = ['node_modules', '.git', 'vendor', 'dist', 'build', '.next', '__pycache__', '.venv'];
  const binaryExts = [
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.zip', '.tar', '.gz', '.bz2', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib', '.bin',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.mp3', '.mp4', '.wav', '.avi', '.mov',
    '.db', '.sqlite', '.sqlite3',
    '.lock', '.sum',
  ];

  for (const dir of ignoreDirs) {
    if (filePath.includes(`${dir}/`) || filePath.startsWith(`${dir}/`)) return true;
  }

  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return binaryExts.includes(ext);
}

/** 克隆或更新 bare 仓库 */
export async function mirrorProject(projectId: number, cloneUrl: string): Promise<MirrorResult> {
  const repoDir = mirrorPath(projectId);
  const start = Date.now();

  try {
    if (existsSync(join(repoDir, 'HEAD'))) {
      // 已存在 → git fetch --all --prune（增量更新）
      execSync('git fetch --all --prune', {
        cwd: repoDir,
        timeout: CLONE_TIMEOUT_MS,
        env: { ...process.env, ...GIT_ENV },
        stdio: 'pipe',
      });
      const duration = Date.now() - start;
      log.info(`Mirror fetched: project ${projectId} in ${duration}ms`);
      return { projectId, action: 'fetched', durationMs: duration };
    }

    // 不存在 → git clone --bare
    mkdirSync(REPOS_ROOT, { recursive: true });
    const authUrl = injectToken(cloneUrl);
    execSync(`git clone --bare "${authUrl}" "${repoDir}"`, {
      timeout: CLONE_TIMEOUT_MS,
      env: { ...process.env, ...GIT_ENV },
      stdio: 'pipe',
    });
    const duration = Date.now() - start;
    log.info(`Mirror cloned: project ${projectId} in ${duration}ms`);
    return { projectId, action: 'cloned', durationMs: duration };
  } catch (err) {
    const duration = Date.now() - start;
    const errMsg = String(err);
    log.error(`Mirror failed: project ${projectId}`, errMsg);
    return { projectId, action: 'skipped', durationMs: duration, error: errMsg };
  }
}

/** 从 bare 仓库读文件 */
export function readFileFromMirror(projectId: number, filePath: string, ref = 'HEAD'): string | null {
  const repoDir = mirrorPath(projectId);
  if (!existsSync(join(repoDir, 'HEAD'))) return null;

  try {
    const content = execSync(`git show "${ref}:${filePath}"`, {
      cwd: repoDir,
      maxBuffer: 1024 * 1024, // 1MB
      env: { ...process.env, ...GIT_ENV },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return content.toString('utf-8');
  } catch {
    return null;
  }
}

/** 列目录树 */
export function listTree(projectId: number, path = '', ref = 'HEAD'): TreeEntry[] {
  const repoDir = mirrorPath(projectId);
  if (!existsSync(join(repoDir, 'HEAD'))) return [];

  try {
    const treeArg = path ? `"${ref}:${path}"` : ref;
    const output = execSync(`git ls-tree -l ${treeArg}`, {
      cwd: repoDir,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, ...GIT_ENV },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return output.toString('utf-8').trim().split('\n').filter(Boolean).map(line => {
      // 格式: mode type hash size\tpath
      const match = line.match(/^(\d+)\s+(\w+)\s+(\w+)\s+(-|\d+)\t(.+)$/);
      if (!match) return null;
      return {
        mode: match[1],
        type: match[2] as 'blob' | 'tree',
        hash: match[3],
        size: match[4] === '-' ? 0 : parseInt(match[4]),
        path: match[5],
      };
    }).filter((e): e is TreeEntry => e !== null);
  } catch {
    return [];
  }
}

/** 获取镜像磁盘大小（MB） */
export function getMirrorSize(projectId: number): number {
  const repoDir = mirrorPath(projectId);
  if (!existsSync(repoDir)) return 0;
  return getDirSizeMb(repoDir);
}

/** 列出所有镜像 */
export function listMirrors(): MirrorInfo[] {
  if (!existsSync(REPOS_ROOT)) return [];

  try {
    return readdirSync(REPOS_ROOT)
      .filter(name => /^\d+$/.test(name))
      .map(name => ({
        projectId: parseInt(name),
        path: join(REPOS_ROOT, name),
        sizeMb: getDirSizeMb(join(REPOS_ROOT, name)),
      }));
  } catch {
    return [];
  }
}

/** 检查某个项目是否有镜像 */
export function hasMirror(projectId: number): boolean {
  return existsSync(join(mirrorPath(projectId), 'HEAD'));
}

/** 更新所有已知项目的镜像 */
export async function updateAllMirrors(): Promise<void> {
  const mirrors = listMirrors();
  if (mirrors.length === 0) return;

  log.info(`Updating ${mirrors.length} mirrors...`);
  const results: MirrorResult[] = [];

  for (const mirror of mirrors) {
    // 只需 fetch，clone URL 不需要（已经 bare clone 过了）
    const repoDir = mirrorPath(mirror.projectId);
    const start = Date.now();
    try {
      execSync('git fetch --all --prune', {
        cwd: repoDir,
        timeout: CLONE_TIMEOUT_MS,
        env: { ...process.env, ...GIT_ENV },
        stdio: 'pipe',
      });
      results.push({ projectId: mirror.projectId, action: 'fetched', durationMs: Date.now() - start });
    } catch (err) {
      results.push({ projectId: mirror.projectId, action: 'skipped', durationMs: Date.now() - start, error: String(err) });
    }
  }

  const fetched = results.filter(r => r.action === 'fetched').length;
  const failed = results.filter(r => r.action === 'skipped').length;
  log.info(`Mirror update complete: ${fetched} fetched, ${failed} failed`);
}

/** 获取镜像根目录路径 */
export function getReposRoot(): string {
  return REPOS_ROOT;
}

