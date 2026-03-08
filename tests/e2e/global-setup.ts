import { test as setup, expect } from '@playwright/test';
import { authenticate } from './fixtures/auth';

const FLUXVITA_URL = process.env['FLUXVITA_URL'] || 'http://localhost:18800';
const JOWORK_URL = process.env['JOWORK_URL'] || 'http://localhost:18810';

/**
 * 全局 setup：分别为 FluxVita 和 Jowork 获取 dev token，
 * 保存到 .auth/ 供 fixtures 注入 localStorage。
 *
 * 优化：先尝试复用已有 token（/api/auth/me 验证），
 * 仅在 token 无效时才重新登录，减少 rate limit 消耗。
 */
setup('authenticate', async ({ request }) => {
  const { writeFileSync, mkdirSync, readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(import.meta.dirname, '.auth');
  mkdirSync(dir, { recursive: true });

  const fvPath = join(dir, 'fluxvita.json');
  const jwPath = join(dir, 'jowork.json');

  // 尝试复用已有 token
  async function tryExistingToken(filePath: string, baseURL: string): Promise<boolean> {
    if (!existsSync(filePath)) return false;
    try {
      const saved = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (!saved.token) return false;
      const res = await request.get(`${baseURL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${saved.token}` },
      });
      return res.ok();
    } catch {
      return false;
    }
  }

  // FluxVita token
  const fvValid = await tryExistingToken(fvPath, FLUXVITA_URL);
  if (!fvValid) {
    const fv = await authenticate(request, FLUXVITA_URL, 'ou_test_e2e_fluxvita_001', 'FV-E2E');
    writeFileSync(fvPath, JSON.stringify(fv));
  }

  // Jowork token（共享同一个 Gateway，用不同 open_id 避免冲突）
  const jwValid = await tryExistingToken(jwPath, JOWORK_URL);
  if (!jwValid) {
    const jw = await authenticate(request, JOWORK_URL, 'ou_test_e2e_jowork_001', 'JW-E2E');
    writeFileSync(jwPath, JSON.stringify(jw));
  }
});
