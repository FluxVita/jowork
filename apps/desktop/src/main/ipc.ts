import { ipcMain, app, BrowserWindow } from 'electron';
import { EngineManager } from './engine/manager';
import type { EngineId } from './engine/types';

let engineManager: EngineManager;

export function getEngineManager(): EngineManager {
  return engineManager;
}

export function setupIPC(): void {
  engineManager = new EngineManager();

  // App
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:get-platform', () => process.platform);

  // Engine detection & management
  ipcMain.handle('engine:detect', async () => {
    const results = await engineManager.detectEngines();
    return Object.fromEntries(results);
  });

  ipcMain.handle('engine:switch', async (_e, engineId: EngineId) => {
    await engineManager.switchEngine(engineId);
  });

  ipcMain.handle('engine:get-active', () => {
    return engineManager.getActiveEngineId();
  });

  ipcMain.handle('engine:install', async (_e, engineId: EngineId) => {
    await engineManager.installEngine(engineId);
  });

  // Chat — streaming via events
  ipcMain.handle('chat:send', async (event, opts: { sessionId?: string; message: string; cwd?: string }) => {
    const hm = engineManager.getHistoryManager();
    const activeEngine = engineManager.getActiveEngineId();

    // Create session if needed
    let sessionId = opts.sessionId;
    if (!sessionId) {
      const session = hm.createSession(activeEngine, opts.message.slice(0, 50));
      sessionId = session.id;
      event.sender.send('session:created', session);
    }

    // Save user message
    hm.appendMessage(sessionId, {
      sessionId,
      role: 'user',
      content: opts.message,
    });

    // Resolve engine session ID for resume
    const engineSessionId = hm.getEngineSessionId(sessionId, activeEngine);
    const chatOpts = {
      message: opts.message,
      sessionId: engineSessionId ?? undefined,
      cwd: opts.cwd,
    };

    try {
      let assistantContent = '';
      for await (const engineEvent of engineManager.chat(chatOpts)) {
        event.sender.send('chat:event', { sessionId, ...engineEvent });

        // Accumulate assistant text for persistence
        if (engineEvent.type === 'text') {
          const textEvent = engineEvent as typeof engineEvent & { content?: string };
          if (textEvent.content) {
            assistantContent += textEvent.content;
          }
        }
      }

      // Save assistant message
      if (assistantContent) {
        hm.appendMessage(sessionId, {
          sessionId,
          role: 'assistant',
          content: assistantContent,
        });
      }
    } catch (err) {
      event.sender.send('chat:event', {
        sessionId,
        type: 'error',
        message: String(err),
      });
    }

    return { sessionId };
  });

  ipcMain.handle('chat:abort', async () => {
    await engineManager.abort();
  });

  // Session management
  ipcMain.handle('session:list', (_e, opts?: { limit?: number; offset?: number }) => {
    return engineManager.getHistoryManager().listSessions(opts);
  });

  ipcMain.handle('session:get', (_e, sessionId: string) => {
    const hm = engineManager.getHistoryManager();
    const session = hm.getSession(sessionId);
    if (!session) return null;
    const sessionMessages = hm.getMessages(sessionId);
    return { ...session, messages: sessionMessages };
  });

  ipcMain.handle('session:create', (_e, opts?: { engineId?: EngineId; title?: string }) => {
    const engineId = opts?.engineId ?? engineManager.getActiveEngineId();
    return engineManager.getHistoryManager().createSession(engineId, opts?.title);
  });

  ipcMain.handle('session:delete', (_e, sessionId: string) => {
    engineManager.getHistoryManager().deleteSession(sessionId);
  });

  ipcMain.handle('session:rename', (_e, sessionId: string, title: string) => {
    engineManager.getHistoryManager().renameSession(sessionId, title);
  });
}

// Cleanup on app quit
app.on('before-quit', () => {
  engineManager?.close();
});
