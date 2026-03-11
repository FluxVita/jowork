#!/usr/bin/env node
/**
 * 构建 Edge Sidecar 单文件 bundle
 *
 * 输出：data/edge-sidecar.js（Tauri 资源目录可引用）
 * 用法：node scripts/build-edge-sidecar.mjs
 */

import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 总是从项目根目录执行（支持从 apps/jowork/ 等子目录调用）
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
process.chdir(rootDir);

// 确保 data 目录存在
mkdirSync('data', { recursive: true });

const entry = 'packages/core/src/agent/edge/sidecar-main.ts';
const outfile = 'data/edge-sidecar.js';

execSync([
  'npx esbuild',
  entry,
  `--outfile=${outfile}`,
  '--bundle',
  '--platform=node',
  '--target=node18',
  '--format=esm',
  '--external:better-sqlite3',
  '--sourcemap',
  '--minify',
].join(' '), { stdio: 'inherit' });

console.log(`\n✅ Edge sidecar built → ${outfile}`);
