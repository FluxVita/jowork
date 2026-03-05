import { randomBytes } from 'node:crypto';

/** 生成 URL-safe 短 ID */
export function genId(prefix: string, length = 12): string {
  return `${prefix}_${randomBytes(length).toString('base64url').slice(0, length)}`;
}
