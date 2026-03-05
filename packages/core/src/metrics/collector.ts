// @jowork/core/metrics — Prometheus-compatible metrics collector
// Tracks HTTP request counts/durations + system metrics (memory, uptime, DB size).
// No external dependencies — produces Prometheus text exposition format.

import { getDb } from '../datamap/db.js';
import { config } from '../config.js';

// ─── Histogram buckets (seconds) ─────────────────────────────────────────────

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

// ─── Counter storage ─────────────────────────────────────────────────────────

interface RequestEntry {
  count: number;
  /** Duration buckets: count of requests <= bucket threshold */
  buckets: number[];
  /** Sum of all durations */
  durationSum: number;
}

/** key = `method:routePattern:status` */
const requests = new Map<string, RequestEntry>();
let totalRequests = 0;
const startTime = Date.now();

// ─── Record ──────────────────────────────────────────────────────────────────

function requestKey(method: string, route: string, status: number): string {
  return `${method}:${route}:${status}`;
}

export function recordRequest(method: string, route: string, status: number, durationSec: number): void {
  totalRequests++;
  const key = requestKey(method, route, status);
  let entry = requests.get(key);
  if (!entry) {
    entry = { count: 0, buckets: new Array(DURATION_BUCKETS.length).fill(0) as number[], durationSum: 0 };
    requests.set(key, entry);
  }
  entry.count++;
  entry.durationSum += durationSec;
  for (let i = 0; i < DURATION_BUCKETS.length; i++) {
    if (durationSec <= DURATION_BUCKETS[i]!) {
      entry.buckets[i]!++;
    }
  }
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export interface MetricsSnapshot {
  uptime: number;
  totalRequests: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  rssBytes: number;
  externalBytes: number;
  dbSizeBytes: number | null;
  activeHandles: number;
  requests: Map<string, RequestEntry>;
}

export function collectSnapshot(): MetricsSnapshot {
  const mem = process.memoryUsage();

  let dbSizeBytes: number | null = null;
  try {
    const db = getDb();
    const row = db.prepare(`SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()`).get() as { size: number } | undefined;
    dbSizeBytes = row?.size ?? null;
  } catch { /* DB not ready yet */ }

  return {
    uptime: (Date.now() - startTime) / 1000,
    totalRequests,
    heapUsedBytes: mem.heapUsed,
    heapTotalBytes: mem.heapTotal,
    rssBytes: mem.rss,
    externalBytes: mem.external,
    dbSizeBytes,
    activeHandles: (process as NodeJS.Process & { _getActiveHandles?: () => unknown[] })._getActiveHandles?.().length ?? 0,
    requests: new Map(requests),
  };
}

// ─── Prometheus text format ─────────────────────────────────────────────────

function line(name: string, labels: Record<string, string | number>, value: number): string {
  const lbls = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  return `${name}{${lbls}} ${value}`;
}

export function renderPrometheus(): string {
  const snap = collectSnapshot();
  const lines: string[] = [];

  // ─── Process metrics ──────────────────────────────────────────────────────
  lines.push('# HELP jowork_uptime_seconds Gateway uptime in seconds');
  lines.push('# TYPE jowork_uptime_seconds gauge');
  lines.push(`jowork_uptime_seconds ${snap.uptime.toFixed(1)}`);

  lines.push('# HELP jowork_heap_used_bytes Node.js heap used bytes');
  lines.push('# TYPE jowork_heap_used_bytes gauge');
  lines.push(`jowork_heap_used_bytes ${snap.heapUsedBytes}`);

  lines.push('# HELP jowork_heap_total_bytes Node.js heap total bytes');
  lines.push('# TYPE jowork_heap_total_bytes gauge');
  lines.push(`jowork_heap_total_bytes ${snap.heapTotalBytes}`);

  lines.push('# HELP jowork_rss_bytes Node.js RSS bytes');
  lines.push('# TYPE jowork_rss_bytes gauge');
  lines.push(`jowork_rss_bytes ${snap.rssBytes}`);

  lines.push('# HELP jowork_external_bytes Node.js external memory bytes');
  lines.push('# TYPE jowork_external_bytes gauge');
  lines.push(`jowork_external_bytes ${snap.externalBytes}`);

  if (snap.dbSizeBytes !== null) {
    lines.push('# HELP jowork_db_size_bytes SQLite database size in bytes');
    lines.push('# TYPE jowork_db_size_bytes gauge');
    lines.push(`jowork_db_size_bytes ${snap.dbSizeBytes}`);
  }

  // ─── HTTP request metrics ─────────────────────────────────────────────────
  lines.push('# HELP jowork_http_requests_total Total HTTP requests');
  lines.push('# TYPE jowork_http_requests_total counter');
  lines.push(`jowork_http_requests_total ${snap.totalRequests}`);

  lines.push('# HELP jowork_http_request_duration_seconds HTTP request duration');
  lines.push('# TYPE jowork_http_request_duration_seconds histogram');

  for (const [key, entry] of snap.requests) {
    const [method, route, statusStr] = key.split(':');
    const labels = { method: method!, route: route!, status: statusStr! };

    // Histogram buckets
    for (let i = 0; i < DURATION_BUCKETS.length; i++) {
      lines.push(line('jowork_http_request_duration_seconds_bucket', { ...labels, le: DURATION_BUCKETS[i]! }, entry.buckets[i]!));
    }
    lines.push(line('jowork_http_request_duration_seconds_bucket', { ...labels, le: '+Inf' }, entry.count));
    lines.push(line('jowork_http_request_duration_seconds_sum', labels, Math.round(entry.durationSum * 1000) / 1000));
    lines.push(line('jowork_http_request_duration_seconds_count', labels, entry.count));
  }

  // ─── Info metric ──────────────────────────────────────────────────────────
  lines.push('# HELP jowork_info Jowork instance info');
  lines.push('# TYPE jowork_info gauge');
  lines.push(line('jowork_info', {
    version: '0.1.0',
    mode: config.personalMode ? 'personal' : 'team',
    node_version: process.version,
  }, 1));

  lines.push('');
  return lines.join('\n');
}

// ─── Reset (for testing) ────────────────────────────────────────────────────

export function resetMetrics(): void {
  requests.clear();
  totalRequests = 0;
}
