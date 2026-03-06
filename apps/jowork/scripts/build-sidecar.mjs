import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');       // scripts/ -> apps/jowork/
const root = resolve(appRoot, '../..');         // apps/jowork/ -> project root
const sidecarDir = resolve(appRoot, 'src-tauri/sidecar');
const distEntry = resolve(appRoot, 'dist/index.js');

mkdirSync(sidecarDir, { recursive: true });

const unixLauncher = `#!/usr/bin/env bash\nset -euo pipefail\nDIR="$(cd "$(dirname "$0")" && pwd)"\nROOT="${root}"\nexec node "${distEntry}" "$@"\n`;
const winLauncher = `@echo off\r\nsetlocal\r\nnode "${distEntry.replaceAll('/', '\\\\')}" %*\r\n`;

const unixPaths = [
  resolve(sidecarDir, 'jowork-gateway'),
  resolve(sidecarDir, 'jowork-gateway-aarch64-apple-darwin'),
  resolve(sidecarDir, 'jowork-gateway-x86_64-apple-darwin'),
  resolve(sidecarDir, 'jowork-gateway-x86_64-unknown-linux-gnu'),
  resolve(sidecarDir, 'jowork-gateway-aarch64-unknown-linux-gnu'),
];
const winPaths = [
  resolve(sidecarDir, 'jowork-gateway.cmd'),
  resolve(sidecarDir, 'jowork-gateway-x86_64-pc-windows-msvc.cmd'),
];

for (const p of unixPaths) {
  writeFileSync(p, unixLauncher, 'utf8');
  chmodSync(p, 0o755);
}
for (const p of winPaths) {
  writeFileSync(p, winLauncher, 'utf8');
}

console.log(`[sidecar] launchers generated at ${dirname(unixPaths[0])}`);
