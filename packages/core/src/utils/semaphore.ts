// @jowork/core/utils/semaphore — async concurrency limiter

/**
 * Semaphore limits the number of concurrent async operations.
 * Used for connector sync staggering (max 2 concurrent syncs).
 */
export class Semaphore {
  private _count: number;
  private _queue: Array<() => void> = [];

  constructor(concurrency: number) {
    if (concurrency < 1) throw new Error('Semaphore concurrency must be >= 1');
    this._count = concurrency;
  }

  /** Acquire a slot, waiting if all slots are busy. */
  async acquire(): Promise<void> {
    if (this._count > 0) {
      this._count--;
      return;
    }
    await new Promise<void>(resolve => this._queue.push(resolve));
  }

  /** Release a slot, waking up the next waiter if any. */
  release(): void {
    const next = this._queue.shift();
    if (next) {
      next();
    } else {
      this._count++;
    }
  }

  /**
   * Run fn with the semaphore acquired.
   * Guarantees release even on throw.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
