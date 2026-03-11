/**
 * ServerBackend — Edge sidecar 的服务器模式后端
 *
 * 通过 HTTP 调用 Gateway 的 /api/edge/* 端点。
 * 用于个人服务器版和团队版。
 */

import type {
  EdgeBackend,
  ModelEvent,
  EdgeMessage,
  EdgeSessionResponse,
  EdgeToolsResponse,
  EdgeToolResponse,
  EdgeMessagesResponse,
} from './types.js';
import type { AnthropicToolDef, ToolContext } from '../types.js';

export class ServerBackend implements EdgeBackend {
  private gatewayUrl: string;
  private jwt: string;
  private remoteToolsCache: AnthropicToolDef[] | null = null;

  constructor(gatewayUrl: string, jwt: string) {
    this.gatewayUrl = gatewayUrl.replace(/\/$/, '');
    this.jwt = jwt;
  }

  private async fetch(path: string, opts: RequestInit = {}): Promise<Response> {
    const url = `${this.gatewayUrl}/api/edge${path}`;
    const res = await fetch(url, {
      ...opts,
      headers: {
        'Authorization': `Bearer ${this.jwt}`,
        'Content-Type': 'application/json',
        ...opts.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Edge API ${path} failed (${res.status}): ${body}`);
    }
    return res;
  }

  async *callModel(
    system: string,
    messages: Array<{ role: string; content: unknown }>,
    tools: AnthropicToolDef[],
  ): AsyncGenerator<ModelEvent> {
    // Gateway edge/model 端点返回完整结果（非 streaming），
    // 我们将其转换为 ModelEvent
    try {
      const res = await this.fetch('/model', {
        method: 'POST',
        body: JSON.stringify({ system, messages, tools, session_id: this.currentSessionId }),
      });

      const result = await res.json() as {
        stop_reason: string;
        content: string;
        tool_calls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
        tokens_in: number;
        tokens_out: number;
        cost_usd: number;
        model: string;
        provider: string;
      };

      // 发送文本内容
      if (result.content) {
        yield { type: 'text_delta', delta: result.content };
      }

      // 发送工具调用
      if (result.tool_calls && result.tool_calls.length > 0) {
        for (const tc of result.tool_calls) {
          yield { type: 'tool_use', id: tc.id, name: tc.name, input: tc.input };
        }
      }

      // 发送结束事件
      yield {
        type: 'end_turn',
        content: result.content,
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
        cost_usd: result.cost_usd,
        model: result.model,
      };
    } catch (err) {
      yield { type: 'error', message: String(err) };
    }
  }

  async listRemoteTools(): Promise<AnthropicToolDef[]> {
    if (this.remoteToolsCache) return this.remoteToolsCache;

    const res = await this.fetch('/tools');
    const data = await res.json() as EdgeToolsResponse;
    this.remoteToolsCache = data.tools;
    return data.tools;
  }

  async executeRemoteTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const res = await this.fetch('/tool', {
      method: 'POST',
      body: JSON.stringify({ name, input, session_id: ctx.session_id }),
    });
    const data = await res.json() as EdgeToolResponse;
    if (data.status === 'error') {
      throw new Error(data.result);
    }
    return data.result;
  }

  async saveMessage(msg: EdgeMessage): Promise<void> {
    await this.fetch('/messages', {
      method: 'POST',
      body: JSON.stringify({ messages: [msg] }),
    });
  }

  async loadHistory(sessionId: string): Promise<EdgeMessage[]> {
    // 通过现有 agent sessions API 获取历史
    const url = `${this.gatewayUrl}/api/agent/sessions/${sessionId}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${this.jwt}` },
    });
    if (!res.ok) return [];

    const data = await res.json() as { messages: Array<{
      role: string; content: string;
      tool_name?: string; tool_call_id?: string; tool_status?: string;
      metadata_json?: string;
    }> };

    return (data.messages ?? []).map((m, i) => ({
      client_msg_id: `history-${i}`,
      session_id: sessionId,
      role: m.role as EdgeMessage['role'],
      content: m.content,
      tool_name: m.tool_name,
      tool_call_id: m.tool_call_id,
      tool_status: m.tool_status as EdgeMessage['tool_status'],
      source: (() => {
        try {
          const meta = JSON.parse(m.metadata_json ?? 'null');
          return meta?.source;
        } catch { return undefined; }
      })(),
    }));
  }

  async ensureSession(sessionId?: string, title?: string): Promise<string> {
    const res = await this.fetch('/session', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, title }),
    });
    const data = await res.json() as EdgeSessionResponse;
    this.currentSessionId = data.session_id;
    return data.session_id;
  }

  // 内部跟踪当前 session ID（供 callModel 使用）
  private currentSessionId = '';
}
