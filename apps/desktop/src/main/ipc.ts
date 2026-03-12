import { ipcMain, app, BrowserWindow } from 'electron';
import { EngineManager } from './engine/manager';
import { ConnectorHub } from './connectors/hub';
import { MemoryStore, type NewMemory } from './memory/store';
import { SkillLoader } from './skills/loader';
import { LauncherWindow } from './windows/launcher-window';
import { NotificationManager } from './system/notifications';
import { ClipboardManager } from './system/clipboard';
import { PtyManager } from './system/pty-manager';
import { FileWatcher } from './system/file-watcher';
import { Scheduler, type NewScheduledTask } from './scheduler';
import type { EngineId } from './engine/types';

let engineManager: EngineManager;
let connectorHub: ConnectorHub;
let memoryStore: MemoryStore;
let skillLoader: SkillLoader;
let launcherWindow: LauncherWindow;
let notificationManager: NotificationManager;
let clipboardManager: ClipboardManager;
let ptyManager: PtyManager;
let fileWatcher: FileWatcher;
let scheduler: Scheduler;

export function getEngineManager(): EngineManager {
  return engineManager;
}

export function setupIPC(): void {
  engineManager = new EngineManager();
  connectorHub = new ConnectorHub(engineManager.getHistoryManager());
  memoryStore = new MemoryStore(engineManager.getHistoryManager().getSqliteInstance());
  skillLoader = new SkillLoader();
  launcherWindow = new LauncherWindow();
  notificationManager = new NotificationManager();
  clipboardManager = new ClipboardManager();
  ptyManager = new PtyManager();
  fileWatcher = new FileWatcher();
  scheduler = new Scheduler(engineManager.getHistoryManager().getSqliteInstance());
  scheduler.setEngineManager(engineManager);
  scheduler.startAll();

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

  // --- Connector management ---

  ipcMain.handle('connector:list', () => {
    return connectorHub.getManifests().map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      category: m.category,
      tier: m.tier,
      status: connectorHub.hasCredential(m.id) ? 'disconnected' : 'disconnected',
      hasCredential: connectorHub.hasCredential(m.id),
    }));
  });

  ipcMain.handle('connector:save-credential', (_e, connectorId: string, credential: unknown) => {
    connectorHub.saveCredential(connectorId, credential);
  });

  ipcMain.handle('connector:start', async (_e, connectorId: string) => {
    await connectorHub.start(connectorId);
  });

  ipcMain.handle('connector:stop', async (_e, connectorId: string) => {
    await connectorHub.stop(connectorId);
  });

  ipcMain.handle('connector:health', async () => {
    const results = await connectorHub.healthCheck();
    return Object.fromEntries(results);
  });

  ipcMain.handle('connector:tools', async () => {
    return connectorHub.listAllTools();
  });

  // --- Memory management ---

  ipcMain.handle('memory:list', (_e, opts: { scope?: string; pinned?: boolean; limit?: number }) => {
    return memoryStore.list(opts);
  });

  ipcMain.handle('memory:search', (_e, query: string) => {
    return memoryStore.search(query);
  });

  ipcMain.handle('memory:create', (_e, mem: NewMemory) => {
    return memoryStore.create(mem);
  });

  ipcMain.handle('memory:update', (_e, id: string, patch: Partial<NewMemory>) => {
    return memoryStore.update(id, patch);
  });

  ipcMain.handle('memory:delete', (_e, id: string) => {
    memoryStore.delete(id);
  });

  ipcMain.handle('memory:get', (_e, id: string) => {
    return memoryStore.get(id);
  });

  // --- Skills ---

  ipcMain.handle('skill:list', async () => {
    return skillLoader.loadAll();
  });

  ipcMain.handle('skill:run', async (event, skillId: string, vars: Record<string, string>, sessionId?: string) => {
    const skills = await skillLoader.loadAll();
    const skill = skills.find((s) => s.id === skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);

    const { SkillExecutor } = await import('./skills/executor');
    const executor = new SkillExecutor(engineManager);

    if (skill.type === 'workflow' && skill.steps?.length) {
      for await (const ev of executor.executeWorkflow(skill, vars, sessionId)) {
        event.sender.send('chat:event', { sessionId, ...ev as object });
      }
    } else {
      for await (const ev of executor.executeSimple(skill, vars, sessionId)) {
        event.sender.send('chat:event', { sessionId, ...ev as object });
      }
    }
  });

  // --- Settings (key-value) ---

  ipcMain.handle('settings:get', (_e, key: string) => {
    return engineManager.getHistoryManager().getSetting(key);
  });

  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    engineManager.getHistoryManager().setSetting(key, value);
  });

  // --- Launcher ---

  ipcMain.handle('launcher:toggle', () => {
    launcherWindow.toggle();
  });

  ipcMain.handle('launcher:hide', () => {
    launcherWindow.hide();
  });

  // --- System: Notifications ---

  ipcMain.handle('system:notify', (_e, opts: { title: string; body: string; sessionId?: string }) => {
    notificationManager.send(opts);
  });

  // --- System: Clipboard ---

  ipcMain.handle('clipboard:read', () => {
    return clipboardManager.read();
  });

  ipcMain.handle('clipboard:write', (_e, text: string) => {
    clipboardManager.write(text);
  });

  // --- PTY Terminal ---

  ipcMain.handle('pty:create', (event, opts?: { cwd?: string; shell?: string }) => {
    const id = ptyManager.create(opts);

    // Forward PTY output to renderer
    ptyManager.onData(id, (data) => {
      event.sender.send('pty:data', id, data);
    });

    ptyManager.onExit(id, (exitCode) => {
      event.sender.send('pty:exit', id, exitCode);
    });

    return id;
  });

  ipcMain.handle('pty:write', (_e, id: string, data: string) => {
    ptyManager.write(id, data);
  });

  ipcMain.handle('pty:resize', (_e, id: string, cols: number, rows: number) => {
    ptyManager.resize(id, cols, rows);
  });

  ipcMain.handle('pty:destroy', (_e, id: string) => {
    ptyManager.destroy(id);
  });

  ipcMain.handle('pty:list', () => {
    return ptyManager.list();
  });

  // --- File system ---

  ipcMain.handle('file:watch', (_e, dir: string) => {
    fileWatcher.watchProject(dir);
  });

  ipcMain.handle('file:unwatch', (_e, dir: string) => {
    fileWatcher.unwatchProject(dir);
  });

  ipcMain.handle('file:read-for-chat', async (_e, filePath: string) => {
    return fileWatcher.readFileForChat(filePath);
  });

  // --- Scheduler ---

  ipcMain.handle('scheduler:list', () => {
    return scheduler.list();
  });

  ipcMain.handle('scheduler:get', (_e, id: string) => {
    return scheduler.get(id);
  });

  ipcMain.handle('scheduler:create', (_e, task: NewScheduledTask) => {
    return scheduler.create(task);
  });

  ipcMain.handle('scheduler:update', (_e, id: string, patch: Partial<NewScheduledTask>) => {
    return scheduler.update(id, patch);
  });

  ipcMain.handle('scheduler:delete', (_e, id: string) => {
    scheduler.delete(id);
  });

  ipcMain.handle('scheduler:executions', (_e, taskId: string, limit?: number) => {
    return scheduler.getExecutions(taskId, limit);
  });
}

export function getLauncherWindow(): LauncherWindow {
  return launcherWindow;
}

export function getNotificationManager(): NotificationManager {
  return notificationManager;
}

// Cleanup on app quit
app.on('before-quit', () => {
  scheduler?.stopAll();
  connectorHub?.stopAll();
  ptyManager?.destroyAll();
  fileWatcher?.closeAll();
  launcherWindow?.destroy();
  engineManager?.close();
});
