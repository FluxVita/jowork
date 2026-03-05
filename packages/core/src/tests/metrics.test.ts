// Tests for Phase 79: Prometheus metrics collector + middleware + route

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { metricsMiddleware } from '../gateway/middleware/metrics.js';
import { metricsRouter } from '../gateway/routes/metrics.js';
import {
  recordRequest,
  collectSnapshot,
  renderPrometheus,
  resetMetrics,
} from '../metrics/collector.js';

afterEach(() => {
  resetMetrics();
});

// ─── recordRequest + collectSnapshot ─────────────────────────────────────────

describe('MetricsCollector', () => {
  test('recordRequest increments totalRequests', () => {
    recordRequest('GET', '/health', 200, 0.01);
    recordRequest('POST', '/api/sessions', 201, 0.05);
    const snap = collectSnapshot();
    assert.equal(snap.totalRequests, 2);
  });

  test('recordRequest groups by method:route:status', () => {
    recordRequest('GET', '/health', 200, 0.01);
    recordRequest('GET', '/health', 200, 0.02);
    recordRequest('GET', '/health', 500, 0.1);
    const snap = collectSnapshot();
    assert.equal(snap.requests.size, 2);
    const ok = snap.requests.get('GET:/health:200');
    assert.ok(ok, 'should have entry for 200');
    assert.equal(ok.count, 2);
    const err = snap.requests.get('GET:/health:500');
    assert.ok(err, 'should have entry for 500');
    assert.equal(err.count, 1);
  });

  test('duration sum is accumulated', () => {
    recordRequest('GET', '/api', 200, 0.1);
    recordRequest('GET', '/api', 200, 0.2);
    const entry = collectSnapshot().requests.get('GET:/api:200');
    assert.ok(entry);
    assert.ok(Math.abs(entry.durationSum - 0.3) < 0.001);
  });

  test('histogram buckets are populated', () => {
    // 5ms request should be in the 0.005 bucket and all higher buckets
    recordRequest('GET', '/fast', 200, 0.005);
    const entry = collectSnapshot().requests.get('GET:/fast:200');
    assert.ok(entry);
    // First bucket is 0.005 → should have count 1
    assert.equal((entry.buckets as number[])[0], 1);
  });

  test('snapshot includes system metrics', () => {
    const snap = collectSnapshot();
    assert.ok(snap.uptime > 0);
    assert.ok(snap.heapUsedBytes > 0);
    assert.ok(snap.rssBytes > 0);
  });

  test('resetMetrics clears all data', () => {
    recordRequest('GET', '/x', 200, 0.01);
    resetMetrics();
    const snap = collectSnapshot();
    assert.equal(snap.totalRequests, 0);
    assert.equal(snap.requests.size, 0);
  });
});

// ─── renderPrometheus ────────────────────────────────────────────────────────

describe('renderPrometheus', () => {
  test('returns valid Prometheus text format', () => {
    recordRequest('GET', '/health', 200, 0.01);
    const text = renderPrometheus();

    // Must contain HELP and TYPE lines
    assert.ok(text.includes('# HELP jowork_uptime_seconds'));
    assert.ok(text.includes('# TYPE jowork_uptime_seconds gauge'));
    assert.ok(text.includes('# HELP jowork_http_requests_total'));
    assert.ok(text.includes('# TYPE jowork_http_requests_total counter'));
    assert.ok(text.includes('jowork_http_requests_total 1'));

    // Histogram lines
    assert.ok(text.includes('jowork_http_request_duration_seconds_bucket'));
    assert.ok(text.includes('le="+Inf"'));
    assert.ok(text.includes('jowork_http_request_duration_seconds_count'));
    assert.ok(text.includes('jowork_http_request_duration_seconds_sum'));

    // Info metric
    assert.ok(text.includes('jowork_info'));
    assert.ok(text.includes('version="0.1.0"'));
  });

  test('includes memory metrics', () => {
    const text = renderPrometheus();
    assert.ok(text.includes('jowork_heap_used_bytes'));
    assert.ok(text.includes('jowork_rss_bytes'));
  });
});

// ─── metricsMiddleware ───────────────────────────────────────────────────────

describe('metricsMiddleware', () => {
  test('records request after response finishes', async () => {
    const app = express();
    app.use(metricsMiddleware);
    app.get('/test-route', (_req, res) => res.json({ ok: true }));

    // Use node:http to make a request
    const { createServer } = await import('node:http');
    const server = createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const response = await fetch(`http://127.0.0.1:${port}/test-route`);
    assert.equal(response.status, 200);

    // Give the 'finish' event a tick to fire
    await new Promise(r => setTimeout(r, 20));

    const snap = collectSnapshot();
    assert.ok(snap.totalRequests >= 1, `Expected at least 1 request recorded, got ${snap.totalRequests}`);

    server.close();
  });
});

// ─── metricsRouter (GET /metrics) ────────────────────────────────────────────

describe('metricsRouter', () => {
  test('GET /metrics returns Prometheus text format', async () => {
    recordRequest('POST', '/api/chat', 200, 0.5);

    const app = express();
    app.use(metricsRouter());

    const { createServer } = await import('node:http');
    const server = createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const response = await fetch(`http://127.0.0.1:${port}/metrics`);
    assert.equal(response.status, 200);

    const ct = response.headers.get('content-type');
    assert.ok(ct?.includes('text/plain'), `Expected text/plain, got ${ct}`);

    const body = await response.text();
    assert.ok(body.includes('jowork_http_requests_total'));
    assert.ok(body.includes('jowork_uptime_seconds'));

    server.close();
  });
});
