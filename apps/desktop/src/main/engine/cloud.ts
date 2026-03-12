import type { AgentEngine, EngineEvent, ChatOpts, InstallStatus } from './types';

/**
 * Cloud Engine adapter.
 * Sends chat requests to JoWork Cloud API and streams SSE responses.
 * Requires the user to be authenticated (JWT token).
 */
export class CloudEngine implements AgentEngine {
  readonly id = 'jowork-cloud' as const;
  readonly type = 'cloud' as const;
  private abortController?: AbortController;
  private apiUrl: string;
  private getToken: () => string | null;

  constructor(opts?: { apiUrl?: string; getToken?: () => string | null }) {
    this.apiUrl = opts?.apiUrl ?? 'https://cloud.jowork.dev';
    this.getToken = opts?.getToken ?? (() => null);
  }

  async checkInstalled(): Promise<InstallStatus> {
    const token = this.getToken();
    if (!token) {
      return {
        installed: false,
        error: 'Sign in to use Cloud Engine. Go to Settings > Auth to log in.',
      };
    }

    try {
      const res = await fetch(`${this.apiUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        return { installed: true, version: 'cloud' };
      }
      return { installed: false, error: `Cloud service unreachable (${res.status})` };
    } catch {
      return { installed: false, error: 'Cloud service unreachable' };
    }
  }

  async *chat(opts: ChatOpts): AsyncGenerator<EngineEvent> {
    const token = this.getToken();
    if (!token) {
      yield { type: 'error' } as EngineEvent;
      yield { type: 'done' };
      return;
    }

    this.abortController = new AbortController();

    try {
      const res = await fetch(`${this.apiUrl}/api/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          message: opts.message,
          sessionId: opts.sessionId,
          systemContext: opts.systemContext,
          images: opts.images,
        }),
        signal: this.abortController.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        yield { type: 'error', message: `Cloud API error: ${res.status} ${errText}` } as EngineEvent & { message: string };
        yield { type: 'done' };
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        yield { type: 'error', message: 'No response stream' } as EngineEvent & { message: string };
        yield { type: 'done' };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const eventStr of events) {
          const lines = eventStr.split('\n');
          let eventType = '';
          let data = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7);
            else if (line.startsWith('data: ')) data += line.slice(6);
          }

          if (!data) continue;

          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            yield this.mapToEngineEvent(eventType || (parsed.type as string) || 'text', parsed);
          } catch {
            // Non-JSON data line — treat as text
            yield { type: 'text', content: data } as EngineEvent & { content: string };
          }
        }
      }

      yield { type: 'done' };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        yield { type: 'done' };
      } else {
        yield { type: 'error', message: String(err) } as EngineEvent & { message: string };
        yield { type: 'done' };
      }
    }
  }

  async abort(): Promise<void> {
    this.abortController?.abort();
  }

  private mapToEngineEvent(type: string, data: Record<string, unknown>): EngineEvent {
    switch (type) {
      case 'text':
      case 'content_block_delta':
        return { type: 'text', content: data.text ?? data.content ?? '' } as EngineEvent & { content: string };
      case 'thinking':
        return { type: 'thinking' };
      case 'tool_use':
        return {
          type: 'tool_use',
          toolName: data.name ?? data.toolName,
          input: typeof data.input === 'string' ? data.input : JSON.stringify(data.input ?? {}),
        } as EngineEvent & { toolName: string; input: string };
      case 'tool_result':
        return {
          type: 'tool_result',
          toolName: data.toolName,
          result: data.result ?? data.output,
        } as EngineEvent & { toolName: string; result: unknown };
      case 'error':
        return { type: 'error', message: data.message ?? data.error ?? 'Unknown error' } as EngineEvent & { message: string };
      case 'usage':
        return { type: 'usage', ...data } as EngineEvent;
      case 'done':
        return { type: 'done' };
      default:
        return { type: 'text' };
    }
  }
}
