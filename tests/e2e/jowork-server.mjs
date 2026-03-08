/**
 * 轻量 Jowork 静态服务器 + API 代理
 *
 * 用途：E2E 测试时 serve Jowork 前端页面，API 请求转发到 FluxVita Gateway。
 * 不启动完整 Gateway，避免 SQLite native binding 冲突。
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';

const PORT = parseInt(process.env.JOWORK_PORT || '18810', 10);
const API_TARGET = process.env.FLUXVITA_URL || 'http://localhost:18800';

// Jowork 页面优先，fallback 到 root public/（共享样式/脚本）
const JOWORK_DIR = resolve(import.meta.dirname, '../../apps/jowork/public');
const FALLBACK_DIR = resolve(import.meta.dirname, '../../public');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function serveFile(res, filePath) {
  const ext = extname(filePath);
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API / health / WebSocket → proxy to FluxVita Gateway
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
    const target = new URL(API_TARGET);
    const proxyReq = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${target.hostname}:${target.port}` },
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', () => {
      res.writeHead(502);
      res.end('Gateway unreachable');
    });
    req.pipe(proxyReq);
    return;
  }

  // Static files: Jowork dir first, fallback to root public/
  let filePath = url.pathname === '/' ? '/shell.html' : url.pathname;
  const joworkPath = join(JOWORK_DIR, filePath);
  const fallbackPath = join(FALLBACK_DIR, filePath);

  if (existsSync(joworkPath) && statSync(joworkPath).isFile()) {
    serveFile(res, joworkPath);
  } else if (existsSync(fallbackPath) && statSync(fallbackPath).isFile()) {
    serveFile(res, fallbackPath);
  } else {
    if (extname(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    // SPA fallback → shell.html
    const shellPath = join(JOWORK_DIR, 'shell.html');
    if (existsSync(shellPath)) serveFile(res, shellPath);
    else { res.writeHead(404); res.end('Not found'); }
  }
});

server.listen(PORT, () => {
  console.log(`Jowork E2E server: http://localhost:${PORT} → API proxy: ${API_TARGET}`);
});
