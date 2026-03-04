// Tests for auth/jwt and policy modules using Node built-in test runner

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../auth/index.js';
import { hasRole, assertRole, canReadSensitivity, filterBySensitivity, maxSensitivityFor } from '../policy/index.js';
import type { SensitivityLevel } from '../types.js';
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

describe('Sensitivity PEP', () => {
  test('maxSensitivityFor maps roles correctly', () => {
    assert.equal(maxSensitivityFor('guest'),  'public');
    assert.equal(maxSensitivityFor('member'), 'internal');
    assert.equal(maxSensitivityFor('admin'),  'confidential');
    assert.equal(maxSensitivityFor('owner'),  'secret');
  });

  test('canReadSensitivity: guest can read public, not internal+', () => {
    assert.ok(canReadSensitivity('guest', 'public'));
    assert.ok(!canReadSensitivity('guest', 'internal'));
    assert.ok(!canReadSensitivity('guest', 'confidential'));
    assert.ok(!canReadSensitivity('guest', 'secret'));
  });

  test('canReadSensitivity: member can read internal and below', () => {
    assert.ok(canReadSensitivity('member', 'public'));
    assert.ok(canReadSensitivity('member', 'internal'));
    assert.ok(!canReadSensitivity('member', 'confidential'));
    assert.ok(!canReadSensitivity('member', 'secret'));
  });

  test('canReadSensitivity: owner can read everything', () => {
    assert.ok(canReadSensitivity('owner', 'public'));
    assert.ok(canReadSensitivity('owner', 'internal'));
    assert.ok(canReadSensitivity('owner', 'confidential'));
    assert.ok(canReadSensitivity('owner', 'secret'));
  });

  test('filterBySensitivity removes docs above clearance', () => {
    const docs: Array<{ id: string; sensitivity: SensitivityLevel }> = [
      { id: '1', sensitivity: 'public' },
      { id: '2', sensitivity: 'internal' },
      { id: '3', sensitivity: 'confidential' },
      { id: '4', sensitivity: 'secret' },
    ];
    const memberView = filterBySensitivity(docs, 'member');
    assert.deepEqual(memberView.map(d => d.id), ['1', '2']);

    const adminView = filterBySensitivity(docs, 'admin');
    assert.deepEqual(adminView.map(d => d.id), ['1', '2', '3']);

    const ownerView = filterBySensitivity(docs, 'owner');
    assert.equal(ownerView.length, 4);
  });
});
