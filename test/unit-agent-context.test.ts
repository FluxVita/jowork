import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArchiveTextForSummary } from '../packages/core/dist/agent/context.js';

describe('unit-agent-context: archive summary sanitization', () => {
  test('redacts credentials before sending archive text to summarizer', () => {
    const archiveText = buildArchiveTextForSummary([
      {
        id: 1,
        session_id: 's1',
        role: 'tool_result',
        content: 'deployment token: sk-live-1234567890abcdefghijklmn',
        tool_name: 'query_oss_sessions',
        tool_call_id: 'tc1',
        tool_status: 'success',
        duration_ms: 10,
        tokens: 20,
        model: null,
        provider: null,
        cost_usd: 0,
        metadata_json: null,
        created_at: new Date().toISOString(),
      },
    ], 'u_test');

    assert.ok(archiveText.includes('[凭证已隐藏]'));
    assert.ok(!archiveText.includes('sk-live-1234567890abcdefghijklmn'));
  });

  test('keeps role labels for user/assistant/tool messages', () => {
    const archiveText = buildArchiveTextForSummary([
      {
        id: 1,
        session_id: 's2',
        role: 'user',
        content: '请帮我看下 PR 进度',
        tool_name: null,
        tool_call_id: null,
        tool_status: null,
        duration_ms: null,
        tokens: 0,
        model: null,
        provider: null,
        cost_usd: 0,
        metadata_json: null,
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        session_id: 's2',
        role: 'tool_call',
        content: '{"query":"project status"}',
        tool_name: 'search_data',
        tool_call_id: 'tc2',
        tool_status: null,
        duration_ms: null,
        tokens: 0,
        model: null,
        provider: null,
        cost_usd: 0,
        metadata_json: null,
        created_at: new Date().toISOString(),
      },
      {
        id: 3,
        session_id: 's2',
        role: 'assistant',
        content: '我已经开始检查。',
        tool_name: null,
        tool_call_id: null,
        tool_status: null,
        duration_ms: null,
        tokens: 0,
        model: null,
        provider: null,
        cost_usd: 0,
        metadata_json: null,
        created_at: new Date().toISOString(),
      },
    ], 'u_test');

    assert.ok(archiveText.includes('[用户]:'));
    assert.ok(archiveText.includes('[工具调用] search_data:'));
    assert.ok(archiveText.includes('[助手]:'));
  });
});
