// Tests for auth/jwt and policy modules using Node built-in test runner

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../auth/index.js';
import { hasRole, assertRole } from '../policy/index.js';
import { UnauthorizedError, ForbiddenError } from '../types.js';

describe('JWT', () => {
  test('sign and verify round-trip', () => {
    const token = signToken('user-1', 'admin');
    const payload = verifyToken(token);
    assert.equal(payload.sub, 'user-1');
    assert.equal(payload.role, 'admin');
  });

  test('rejects tampered token', () => {
    const token = signToken('user-1', 'admin');
    const tampered = token.slice(0, -3) + 'xxx';
    assert.throws(() => verifyToken(tampered), UnauthorizedError);
  });

  test('rejects malformed token', () => {
    assert.throws(() => verifyToken('not.a.jwt'), UnauthorizedError);
  });
});

describe('Policy', () => {
  test('role hierarchy: owner > admin > member > guest', () => {
    assert.ok(hasRole('owner', 'admin'));
    assert.ok(hasRole('admin', 'member'));
    assert.ok(hasRole('member', 'guest'));
    assert.ok(!hasRole('guest', 'member'));
    assert.ok(!hasRole('member', 'admin'));
  });

  test('assertRole throws ForbiddenError on insufficient role', () => {
    assert.throws(() => assertRole('guest', 'admin'), ForbiddenError);
  });

  test('assertRole passes when role is sufficient', () => {
    assert.doesNotThrow(() => assertRole('admin', 'member'));
  });
});
