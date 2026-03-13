import type { Context } from 'hono';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Read version once at startup
let _version = '0.0.1';
try {
  const dir = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(dir, '..', 'package.json'), 'utf-8'));
  _version = pkg.version;
} catch {
  // Fallback to default
}

export function healthCheck(c: Context) {
  return c.json({
    ok: true,
    version: _version,
    timestamp: new Date().toISOString(),
  });
}
