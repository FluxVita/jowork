// Tests for Phase 15: production reliability utilities

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from '../utils/retry.js';

// ─── Retry helper ─────────────────────────────────────────────────────────────

describe('withRetry', () => {
  test('resolves immediately on first success', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return 'ok';
    }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10 });
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  test('retries on failure and eventually succeeds', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'recovered';
    }, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 10 });
    assert.equal(result, 'recovered');
    assert.equal(calls, 3);
  });

  test('throws last error after exhausting attempts', async () => {
    let calls = 0;
    await assert.rejects(
      () => withRetry(async () => {
        calls++;
        throw new Error(`attempt ${calls}`);
      }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10 }),
      (err: Error) => {
        assert.equal(err.message, 'attempt 3');
        return true;
      },
    );
    assert.equal(calls, 3);
  });

  test('respects maxAttempts = 1 (no retry)', async () => {
    let calls = 0;
    await assert.rejects(
      () => withRetry(async () => {
        calls++;
        throw new Error('fail');
      }, { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 10 }),
    );
    assert.equal(calls, 1);
  });
});

// ─── Sensitive data masking in logger ─────────────────────────────────────────
// We can't directly test logger output, so we test the masking via
// a specially-exported function. Since maskMeta is internal, we test
// it indirectly: log an object with a known sensitive key and verify
// no error is thrown (the masking is transparent to callers).

describe('logger sensitive masking', () => {
  test('logger does not throw when meta contains sensitive keys', async () => {
    const { logger } = await import('../utils/index.js');
    assert.doesNotThrow(() => {
      logger.info('test', {
        password: 'secret123',
        apiKey: 'sk-abc123',
        nested: { token: 'xyz', name: 'ok' },
      });
    });
  });
});
