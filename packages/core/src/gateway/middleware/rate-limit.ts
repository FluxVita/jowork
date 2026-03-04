// @jowork/core/gateway/middleware/rate-limit — per-user LLM request rate limiter
// Token bucket: 1 request/second per user (burst = 5)

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/index.js';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const RATE = 1;   // tokens per second
const BURST = 5;  // max bucket size
const buckets = new Map<string, Bucket>();

function refill(bucket: Bucket): void {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(BURST, bucket.tokens + elapsed * RATE);
  bucket.lastRefill = now;
}

function getBucket(userId: string): Bucket {
  let bucket = buckets.get(userId);
  if (!bucket) {
    bucket = { tokens: BURST, lastRefill: Date.now() };
    buckets.set(userId, bucket);
  }
  return bucket;
}

/**
 * Express middleware that rate-limits LLM chat requests per user.
 * Attach to /api/chat routes only. Expects req.body.userId or
 * falls back to 'anonymous' for personal mode.
 */
export function llmRateLimit(req: Request, res: Response, next: NextFunction): void {
  const userId = (req.body as { userId?: string }).userId ?? 'anonymous';
  const bucket = getBucket(userId);
  refill(bucket);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    next();
  } else {
    logger.warn('LLM rate limit hit', { userId });
    res.status(429).json({
      error: 'RATE_LIMITED',
      message: 'Too many requests. Please wait a moment before sending another message.',
      retryAfterMs: Math.ceil((1 - bucket.tokens) / RATE * 1000),
    });
  }
}

/** Purge stale buckets older than 5 minutes to prevent memory leak. */
export function purgeStaleBuckets(): void {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, bucket] of buckets) {
    if (bucket.lastRefill < cutoff) buckets.delete(key);
  }
}
