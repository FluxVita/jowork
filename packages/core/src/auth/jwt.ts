// @jowork/core/auth — minimal JWT using node:crypto (no external dependency)

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { UserId, Role } from '../types.js';
import { config } from '../config.js';
import { UnauthorizedError } from '../types.js';

export interface JwtPayload {
  sub: UserId;
  role: Role;
  iat: number;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlEncode(str: string): string {
  return b64url(Buffer.from(str, 'utf8'));
}

function sign(data: string): string {
  return b64url(createHmac('sha256', config.jwtSecret).update(data).digest());
}

export function signToken(userId: UserId, role: Role, ttlSeconds = 86_400 * 30): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64urlEncode(JSON.stringify({ sub: userId, role, iat: now, exp: now + ttlSeconds }));
  const sig = sign(`${header}.${payload}`);
  return `${header}.${payload}.${sig}`;
}

export function verifyToken(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new UnauthorizedError();
  const [header, payload, sig] = parts as [string, string, string];

  const expected = Buffer.from(sign(`${header}.${payload}`));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new UnauthorizedError();
  }

  let decoded: JwtPayload;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as JwtPayload;
  } catch {
    throw new UnauthorizedError();
  }

  if (decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedError();
  }

  return decoded;
}
