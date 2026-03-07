/**
 * License Client（Phase 4）
 * 自托管 Gateway 启动时向 jowork.work 验证 License Key，
 * 结果缓存到本地 SQLite（license_cache 表）。
 * Mac mini 不可达时使用缓存，7 天宽限期内仍可正常使用。
 */

import { getDb } from '../datamap/db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('license-client');

const CLOUD_LICENSE_SERVER = process.env['JOWORK_LICENSE_SERVER'] ?? 'https://jowork.work';
const VERIFY_INTERVAL_MS = 24 * 60 * 60 * 1000;    // 24h 重新验证
const GRACE_PERIOD_MS    = 7 * 24 * 60 * 60 * 1000; // 7 天宽限期

export interface LicenseStatus {
  valid: boolean;
  plan: string;
  features: string[];  // FeatureKey values as strings（避免循环依赖）
  expires_at: string | null;
  from_cache: boolean;
}

/** 从本地 SQLite 获取缓存的 License 状态 */
export function getCachedLicense(licenseKey: string): LicenseStatus | null {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT plan, features_json, expires_at, last_verified, grace_until
      FROM license_cache WHERE license_key = ?
    `).get(licenseKey) as {
      plan: string;
      features_json: string;
      expires_at: string | null;
      last_verified: string;
      grace_until: string | null;
    } | undefined;

    if (!row) return null;

    const now = new Date().toISOString();
    if (row.grace_until && row.grace_until < now) {
      // 宽限期已过，返回降级状态
      return { valid: false, plan: 'free', features: [], expires_at: null, from_cache: true };
    }

    return {
      valid: true,
      plan: row.plan,
      features: JSON.parse(row.features_json) as string[],
      expires_at: row.expires_at,
      from_cache: true,
    };
  } catch { return null; }
}

/** 向 Mac mini 验证 License Key，并将结果缓存到本地 */
export async function verifyLicense(licenseKey: string): Promise<LicenseStatus> {
  try {
    const resp = await fetch(`${CLOUD_LICENSE_SERVER}/api/license/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key: licenseKey,
        gateway_version: process.env['npm_package_version'] ?? 'unknown',
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) throw new Error(`License server returned ${resp.status}`);

    const data = await resp.json() as {
      valid: boolean;
      plan: string;
      features: string[];
      expires_at: string | null;
    };

    // 更新本地缓存
    const db = getDb();
    const now = new Date().toISOString();
    const graceUntil = new Date(Date.now() + GRACE_PERIOD_MS).toISOString();

    db.prepare(`
      INSERT INTO license_cache (license_key, plan, features_json, expires_at, last_verified, grace_until)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(license_key) DO UPDATE SET
        plan = excluded.plan,
        features_json = excluded.features_json,
        expires_at = excluded.expires_at,
        last_verified = excluded.last_verified,
        grace_until = excluded.grace_until
    `).run(licenseKey, data.plan, JSON.stringify(data.features), data.expires_at, now, graceUntil);

    log.info(`License verified: plan=${data.plan} valid=${data.valid}`);
    return { ...data, from_cache: false };
  } catch (err) {
    log.warn('License server unreachable, using cached status', String(err));
    const cached = getCachedLicense(licenseKey);
    if (cached) return cached;
    // 无缓存 + 不可达：降级到 free
    return { valid: false, plan: 'free', features: [], expires_at: null, from_cache: false };
  }
}

/** 获取当前 License 状态（同步，从缓存读取，供 features.ts 调用） */
export function getCurrentLicense(): LicenseStatus {
  const licenseKey = process.env['JOWORK_LICENSE_KEY'];
  if (!licenseKey) return { valid: false, plan: 'free', features: [], expires_at: null, from_cache: false };
  return getCachedLicense(licenseKey) ?? { valid: false, plan: 'free', features: [], expires_at: null, from_cache: false };
}

/** 启动时初始化 License Client（异步，不阻塞启动） */
export async function initLicenseClient(): Promise<void> {
  const licenseKey = process.env['JOWORK_LICENSE_KEY'];
  if (!licenseKey) return;  // 无 License Key：跳过（SaaS 模式或未配置）

  log.info('Initializing license client...');
  await verifyLicense(licenseKey);

  // 每 24h 后台重新验证
  setInterval(() => {
    verifyLicense(licenseKey).catch(err => log.error('License re-verify failed', err));
  }, VERIFY_INTERVAL_MS);
}
