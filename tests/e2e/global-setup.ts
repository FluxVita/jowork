import { test as setup } from '@playwright/test';
import { authenticate } from './fixtures/auth';

const FLUXVITA_URL = process.env['FLUXVITA_URL'] || 'http://localhost:18800';
const JOWORK_URL = process.env['JOWORK_URL'] || 'http://localhost:18810';

/**
 * 全局 setup：分别为 FluxVita 和 Jowork 获取 dev token，
 * 保存到 .auth/ 供 fixtures 注入 localStorage。
 */
setup('authenticate', async ({ request }) => {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(import.meta.dirname, '.auth');
  mkdirSync(dir, { recursive: true });

  // FluxVita token
  const fv = await authenticate(request, FLUXVITA_URL, 'ou_test_e2e_fluxvita_001', 'FV-E2E');
  const fvMe = await request.get(`${FLUXVITA_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${fv.token}` },
  });
  if (!fvMe.ok()) throw new Error(`FluxVita auth verify failed: ${fvMe.status()}`);
  writeFileSync(join(dir, 'fluxvita.json'), JSON.stringify(fv));

  // Jowork token
  const jw = await authenticate(request, JOWORK_URL, 'ou_test_e2e_jowork_001', 'JW-E2E');
  const jwMe = await request.get(`${JOWORK_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${jw.token}` },
  });
  if (!jwMe.ok()) throw new Error(`Jowork auth verify failed: ${jwMe.status()}`);
  writeFileSync(join(dir, 'jowork.json'), JSON.stringify(jw));
});
