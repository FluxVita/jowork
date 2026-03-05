/**
 * auth/challenges.ts
 * 登录挑战码机制 — 防暴力破解
 * - sha256(salt:code) 存储，timingSafeEqual 比对
 * - 最多 6 次尝试，超限锁定
 */
import { createHash, randomBytes, timingSafeEqual, randomInt } from 'node:crypto';
import { getDb } from '../datamap/db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('challenges');

const MAX_ATTEMPTS = 6;
const CHALLENGE_TTL_SECONDS = 300; // 5 分钟有效期

interface AuthChallengeRow {
  challenge_id: string;
  purpose: string;
  feishu_open_id: string;
  payload_json: string;
  code_hash: string;
  salt: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  consumed_at: string | null;
}

function hashCode(salt: string, code: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

/**
 * 生成认证挑战码（6 位数字）
 */
export function createAuthChallenge(
  purpose: string,
  feishu_open_id: string,
  payload: Record<string, unknown> = {}
): { challenge_id: string; code: string } {
  const db = getDb();
  const challenge_id = randomBytes(16).toString('hex');
  const salt = randomBytes(16).toString('hex');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const code_hash = hashCode(salt, code);
  const expires_at = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString();

  db.prepare(`
    INSERT INTO auth_challenges
      (challenge_id, purpose, feishu_open_id, payload_json, code_hash, salt, attempts, max_attempts, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(challenge_id, purpose, feishu_open_id, JSON.stringify(payload), code_hash, salt, MAX_ATTEMPTS, expires_at);

  log.info('Challenge created', { challenge_id, purpose, feishu_open_id });
  return { challenge_id, code };
}

export type VerifyResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: 'not_found' | 'expired' | 'consumed' | 'too_many_attempts' | 'invalid_code'; attempts_left?: number };

/**
 * 校验挑战码（timingSafeEqual 防时序攻击）
 */
export function verifyAuthChallenge(challenge_id: string, code: string): VerifyResult {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM auth_challenges WHERE challenge_id = ?`)
    .get(challenge_id) as AuthChallengeRow | undefined;

  if (!row) return { ok: false, reason: 'not_found' };
  if (row.consumed_at) return { ok: false, reason: 'consumed' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'expired' };
  if (row.attempts >= row.max_attempts) return { ok: false, reason: 'too_many_attempts' };

  // 先自增尝试次数
  db.prepare(`UPDATE auth_challenges SET attempts = attempts + 1 WHERE challenge_id = ?`).run(challenge_id);

  const inputHash = hashCode(row.salt, code.trim());
  const expectedBuf = Buffer.from(row.code_hash, 'hex');
  const inputBuf = Buffer.from(inputHash, 'hex');

  let matches = false;
  try {
    matches = timingSafeEqual(expectedBuf, inputBuf);
  } catch {
    matches = false;
  }

  if (!matches) {
    const newAttempts = row.attempts + 1;
    const attemptsLeft = row.max_attempts - newAttempts;
    log.warn('Challenge verify failed', { challenge_id, attempts: newAttempts });
    if (attemptsLeft <= 0) return { ok: false, reason: 'too_many_attempts' };
    return { ok: false, reason: 'invalid_code', attempts_left: attemptsLeft };
  }

  // 标记为已使用
  db.prepare(`UPDATE auth_challenges SET consumed_at = datetime('now') WHERE challenge_id = ?`).run(challenge_id);

  log.info('Challenge verified', { challenge_id });
  return { ok: true, payload: JSON.parse(row.payload_json) };
}

/**
 * 清理过期挑战（由调度器定期调用）
 */
export function cleanExpiredChallenges(): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM auth_challenges WHERE expires_at < datetime('now')`).run();
  return result.changes;
}
