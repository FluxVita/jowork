import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt } from '../auth/jwt';

describe('JWT', () => {
  const payload = {
    sub: 'user_123',
    email: 'test@example.com',
    name: 'Test User',
    plan: 'free',
  };

  it('signs and verifies a valid token', () => {
    const token = signJwt(payload);
    expect(token).toBeTruthy();
    expect(token.split('.')).toHaveLength(3);

    const verified = verifyJwt(token);
    expect(verified).not.toBeNull();
    expect(verified!.sub).toBe('user_123');
    expect(verified!.email).toBe('test@example.com');
    expect(verified!.plan).toBe('free');
  });

  it('sets iat and exp automatically', () => {
    const token = signJwt(payload);
    const verified = verifyJwt(token);
    expect(verified!.iat).toBeDefined();
    expect(verified!.exp).toBeDefined();
    expect(verified!.exp).toBeGreaterThan(verified!.iat);
    // Default 7 days
    expect(verified!.exp - verified!.iat).toBe(7 * 24 * 60 * 60);
  });

  it('rejects token with tampered signature', () => {
    const token = signJwt(payload);
    const parts = token.split('.');
    parts[2] = 'tamperedsignature';
    const tampered = parts.join('.');
    expect(verifyJwt(tampered)).toBeNull();
  });

  it('rejects token with tampered payload', () => {
    const token = signJwt(payload);
    const parts = token.split('.');
    // Change the payload
    const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    decoded.sub = 'hacker_999';
    parts[1] = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    const tampered = parts.join('.');
    expect(verifyJwt(tampered)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyJwt('')).toBeNull();
    expect(verifyJwt('not.a.jwt.token')).toBeNull();
    expect(verifyJwt('x')).toBeNull();
  });

  it('preserves optional fields', () => {
    const tokenWithAvatar = signJwt({
      ...payload,
      avatar_url: 'https://example.com/avatar.png',
    });
    const verified = verifyJwt(tokenWithAvatar);
    expect(verified!.avatar_url).toBe('https://example.com/avatar.png');
  });
});
