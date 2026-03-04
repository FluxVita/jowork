// @jowork/premium/subscription — subscription verification + local cache
//
// Flow:
//   1. On startup: load cached status from disk (if fresh enough)
//   2. Daily (configurable): pull fresh status from jowork.work/api/subscription
//   3. State machine:
//      active        — valid paid subscription
//      grace_period  — last check succeeded but next renewal missed; 7 days leniency
//      expired       — grace period elapsed; premium features locked
//      dev_mode      — no token provided (local dev / community edition)
//
// The cache file lives at <dataDir>/subscription-cache.json and is checked first
// to allow offline use within the grace period.

import { get as httpsGet } from 'node:https';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@jowork/core';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SubscriptionPlan = 'free' | 'pro' | 'team' | 'business';
export type SubscriptionStatus = 'active' | 'grace_period' | 'expired' | 'dev_mode';

export interface SubscriptionState {
  status: SubscriptionStatus;
  plan: SubscriptionPlan;
  /** ISO 8601 string — when the current billing period ends */
  expiresAt: string | null;
  /** ISO 8601 string — when this cache record was created */
  cachedAt: string;
  /** ISO 8601 string — last successful remote fetch */
  lastFetchedAt: string | null;
}

// ─── Remote API response (jowork.work/api/subscription) ─────────────────────

interface RemoteSubscriptionResponse {
  valid: boolean;
  plan: SubscriptionPlan;
  expiresAt: string | null;
  customerId: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_FILENAME = 'subscription-cache.json';
const REMOTE_API_HOST = 'jowork.work';
const REMOTE_API_PATH = '/api/subscription';
const FETCH_INTERVAL_MS = 24 * 60 * 60 * 1000;    // 24 hours
const GRACE_PERIOD_MS  = 7 * 24 * 60 * 60 * 1000;  // 7 days

// ─── Module state ─────────────────────────────────────────────────────────────

let _state: SubscriptionState = {
  status: 'dev_mode',
  plan: 'free',
  expiresAt: null,
  cachedAt: new Date().toISOString(),
  lastFetchedAt: null,
};

let _dataDir = '';
let _token = '';
let _fetchTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Cache I/O ────────────────────────────────────────────────────────────────

function cachePath(): string {
  return join(_dataDir, CACHE_FILENAME);
}

function loadCache(): SubscriptionState | null {
  try {
    const raw = readFileSync(cachePath(), 'utf8');
    return JSON.parse(raw) as SubscriptionState;
  } catch {
    return null;
  }
}

function saveCache(state: SubscriptionState): void {
  try {
    mkdirSync(_dataDir, { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    logger.warn('Failed to save subscription cache', { err: String(err) });
  }
}

// ─── Remote fetch ─────────────────────────────────────────────────────────────

function fetchRemoteStatus(token: string): Promise<RemoteSubscriptionResponse> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      {
        host: REMOTE_API_HOST,
        path: REMOTE_API_PATH,
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'jowork-premium/0.1.0',
          'Accept': 'application/json',
        },
      },
      res => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Subscription API returned ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as RemoteSubscriptionResponse);
          } catch {
            reject(new Error('Failed to parse subscription response'));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(new Error('Subscription API timeout')); });
  });
}

// ─── State machine ────────────────────────────────────────────────────────────

function computeStatus(
  remote: RemoteSubscriptionResponse | null,
  cached: SubscriptionState | null,
): SubscriptionStatus {
  if (!_token) return 'dev_mode';

  if (remote) {
    if (!remote.valid) return 'expired';
    const expires = remote.expiresAt ? new Date(remote.expiresAt).getTime() : Infinity;
    return expires > Date.now() ? 'active' : 'expired';
  }

  // No remote data — fall back to cache
  if (cached && cached.lastFetchedAt) {
    const timeSinceFetch = Date.now() - new Date(cached.lastFetchedAt).getTime();
    if (timeSinceFetch < GRACE_PERIOD_MS) {
      return cached.status === 'active' ? 'grace_period' : cached.status;
    }
  }

  return 'expired';
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

async function refresh(): Promise<void> {
  if (!_token) {
    _state = { ..._state, status: 'dev_mode', lastFetchedAt: null };
    return;
  }

  let remote: RemoteSubscriptionResponse | null = null;
  try {
    remote = await fetchRemoteStatus(_token);
    logger.info('Subscription status refreshed', { plan: remote.plan, valid: remote.valid });
  } catch (err) {
    logger.warn('Subscription fetch failed, using cached state', { err: String(err) });
  }

  const now = new Date().toISOString();
  const status = computeStatus(remote, _state);

  _state = {
    status,
    plan: remote?.plan ?? _state.plan,
    expiresAt: remote?.expiresAt ?? _state.expiresAt,
    cachedAt: now,
    lastFetchedAt: remote ? now : _state.lastFetchedAt,
  };

  saveCache(_state);
}

function scheduleNext(): void {
  _fetchTimer = setTimeout(async () => {
    await refresh();
    scheduleNext();
  }, FETCH_INTERVAL_MS);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise the subscription subsystem.
 *
 * @param token    Subscription token from jowork.work (blank = dev_mode)
 * @param dataDir  Directory for the local cache file
 */
export async function initSubscription(token: string, dataDir: string): Promise<void> {
  _token = token;
  _dataDir = dataDir;

  // Load persisted state first (allows offline startup within grace period)
  const cached = loadCache();
  if (cached) {
    _state = cached;
    logger.info('Loaded subscription from cache', { status: cached.status, plan: cached.plan });
  }

  // Eagerly refresh if token provided and cache is stale
  const cacheAge = cached
    ? Date.now() - new Date(cached.cachedAt).getTime()
    : Infinity;

  if (token && cacheAge > FETCH_INTERVAL_MS) {
    await refresh();
  } else if (!token) {
    _state = { ..._state, status: 'dev_mode' };
  }

  scheduleNext();
}

/** Stop the background refresh timer (e.g. on graceful shutdown). */
export function stopSubscriptionRefresh(): void {
  if (_fetchTimer) {
    clearTimeout(_fetchTimer);
    _fetchTimer = null;
  }
}

/** Get the current subscription state (synchronous, uses cached value). */
export function getSubscriptionState(): Readonly<SubscriptionState> {
  return _state;
}

/** Returns true if the current plan is active or in grace period. */
export function isPremiumActive(): boolean {
  return _state.status === 'active' || _state.status === 'grace_period' || _state.status === 'dev_mode';
}

/** Returns true only when the subscription is fully active (not grace period). */
export function isSubscriptionActive(): boolean {
  return _state.status === 'active' || _state.status === 'dev_mode';
}
