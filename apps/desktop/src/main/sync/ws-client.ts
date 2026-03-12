import WebSocket from 'ws';
import type { EngineManager } from '../engine/manager';

interface RemoteTask {
  id: string;
  type: 'chat' | 'skill' | 'local-action';
  payload: Record<string, unknown>;
}

interface RemoteResult {
  taskId: string;
  result: unknown;
  error?: string;
}

/**
 * WebSocket client that connects to JoWork Cloud for remote task execution.
 * Receives tasks from cloud (e.g., from Feishu bot) and executes locally.
 */
export class RemoteChannel {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private connected = false;

  constructor(private engineManager: EngineManager) {}

  connect(cloudUrl: string, token: string): void {
    if (this.ws) {
      this.disconnect();
    }

    const wsUrl = cloudUrl.replace(/^http/, 'ws') + '/ws/channel';
    this.ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    this.ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      console.log('[RemoteChannel] Connected to cloud');
    });

    this.ws.on('message', async (data) => {
      try {
        const task: RemoteTask = JSON.parse(data.toString());
        const result = await this.executeLocally(task);
        this.send({ taskId: task.id, result });
      } catch (err) {
        const parsed = JSON.parse(data.toString()) as { id?: string };
        this.send({ taskId: parsed.id ?? 'unknown', result: null, error: String(err) });
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.scheduleReconnect(cloudUrl, token);
    });

    this.ws.on('error', (err) => {
      console.error('[RemoteChannel] WebSocket error:', err.message);
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private send(result: RemoteResult): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(result));
    }
  }

  private async executeLocally(task: RemoteTask): Promise<unknown> {
    switch (task.type) {
      case 'chat': {
        const message = task.payload.message as string;
        let output = '';
        for await (const event of this.engineManager.chat({ message })) {
          const e = event as { type: string; content?: string };
          if (e.type === 'text' && e.content) output += e.content;
        }
        return { text: output };
      }
      case 'skill': {
        const skillId = task.payload.skillId as string;
        const vars = (task.payload.variables as Record<string, string>) ?? {};
        const { SkillLoader } = await import('../skills/loader');
        const { SkillExecutor } = await import('../skills/executor');
        const loader = new SkillLoader();
        const skills = await loader.loadAll();
        const skill = skills.find((s) => s.id === skillId);
        if (!skill) throw new Error(`Skill not found: ${skillId}`);

        const executor = new SkillExecutor(this.engineManager);
        let output = '';
        for await (const ev of executor.executeSimple(skill, vars)) {
          const e = ev as { type: string; content?: string };
          if (e.type === 'text' && e.content) output += e.content;
        }
        return { text: output };
      }
      case 'local-action':
        // Placeholder for local actions (open file, run command, etc.)
        return { status: 'not_implemented', action: task.payload.action };
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  private scheduleReconnect(cloudUrl: string, token: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[RemoteChannel] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      console.log(`[RemoteChannel] Reconnecting (attempt ${this.reconnectAttempts})...`);
      this.connect(cloudUrl, token);
    }, delay);
  }
}
