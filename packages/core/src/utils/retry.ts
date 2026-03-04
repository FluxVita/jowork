// @jowork/core/utils — exponential backoff retry helper

export interface RetryOptions {
  /** Maximum number of attempts (including first try) */
  maxAttempts: number;
  /** Initial delay in ms (doubles each retry) */
  baseDelayMs: number;
  /** Maximum delay cap in ms */
  maxDelayMs: number;
  /** Optional jitter: adds up to jitterMs random ms to each delay */
  jitterMs?: number;
}

/**
 * Retry an async function with exponential backoff.
 * Throws the last error if all attempts fail.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, jitterMs = 0 } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
        const jitter = jitterMs > 0 ? Math.random() * jitterMs : 0;
        await sleep(backoff + jitter);
      }
    }
  }

  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
