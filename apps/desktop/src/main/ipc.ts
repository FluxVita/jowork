import { ipcMain, app, BrowserWindow, shell } from 'electron';
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
import { AuthManager } from './auth/manager';
import { ModeManager } from './auth/mode';
import { SyncManager } from './sync/sync-manager';
import { checkForUpdates, quitAndInstall } from './updater';
import { ContextAssembler } from './context/assembler';
import { ContextDocsStore } from './context/docs';
import { AutoExtractor } from './memory/auto-extract';
import { Scanner } from './scheduler/scanner';
import { NotificationRuleManager } from './scheduler/notification-rules';
import { ConfirmRuleEngine } from './engine/confirm-rules';
import type { SyncRecord } from '@jowork/core';
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
let authManager: AuthManager;
let modeManager: ModeManager;
let syncManager: SyncManager;
let contextAssembler: ContextAssembler;
let contextDocsStore: ContextDocsStore;
let autoExtractor: AutoExtractor;
let confirmRuleEngine: ConfirmRuleEngine;

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
  const ruleManager = new NotificationRuleManager(engineManager.getHistoryManager().getSqliteInstance());
  const scanner = new Scanner(connectorHub, ruleManager, notificationManager, engineManager.getHistoryManager().getSqliteInstance());
  scheduler.setScanner(scanner);
  scheduler.startAll();

  const hm = engineManager.getHistoryManager();
  modeManager = new ModeManager(
    (key) => hm.getSetting(key),
    (key, value) => hm.setSetting(key, value),
  );
  authManager = new AuthManager(modeManager);
  contextAssembler = new ContextAssembler();
  contextDocsStore = new ContextDocsStore(hm.getSqliteInstance());
  autoExtractor = new AutoExtractor(memoryStore);
  confirmRuleEngine = new ConfirmRuleEngine(hm.getSqliteInstance());

  syncManager = new SyncManager({
    sqlite: hm.getSqliteInstance(),
    cloudUrl: 'https://api.jowork.dev',
    getToken: () => authManager.getToken(),
    mode: modeManager.isTeam() ? 'team' : 'personal',
    deviceId: hm.getSetting('device_id') || `device_${Date.now()}`,
  });

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

    // Assemble context (workstyle + memories + docs)
    const workstyle = hm.getSetting('workstyle') ?? '';
    const memories = memoryStore.list({ limit: 20 });
    const teamDocs = contextDocsStore.listByScope('team');
    const personalDocs = contextDocsStore.listByScope('personal');
    const systemContext = contextAssembler.assemble({
      teamDocs,
      personalDocs,
      memories,
      workstyle,
      tokenBudget: 4000,
    });

    // Resolve engine session ID for resume
    const engineSessionId = hm.getEngineSessionId(sessionId, activeEngine);
    const chatOpts = {
      message: opts.message,
      sessionId: engineSessionId ?? undefined,
      cwd: opts.cwd,
      systemContext: systemContext || undefined,
    };

    try {
      let assistantContent = '';
      for await (const engineEvent of engineManager.chat(chatOpts)) {
        // Enrich tool_use events with confirm rule evaluation
        if (engineEvent.type === 'tool_use') {
          const toolEvent = engineEvent as typeof engineEvent & { toolName?: string; input?: string };
          const toolName = toolEvent.toolName ?? '';
          const action = confirmRuleEngine.evaluate(toolName);
          const risk = confirmRuleEngine.getRisk(toolName);
          event.sender.send('chat:event', {
            sessionId,
            ...engineEvent,
            confirmAction: action,
            confirmRisk: risk,
          });
        } else {
          event.sender.send('chat:event', { sessionId, ...engineEvent });
        }

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

      // Auto-extract memories from the conversation
      const allMessages = hm.getMessages(sessionId);
      autoExtractor.extractFromConversation(allMessages);
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
      status: connectorHub.isStarted(m.id) ? 'connected' : connectorHub.hasCredential(m.id) ? 'disconnected' : 'unconfigured',
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

  ipcMain.handle('skill:save', async (_e, skill: Parameters<typeof skillLoader.saveCustomSkill>[0]) => {
    return skillLoader.saveCustomSkill(skill);
  });

  ipcMain.handle('skill:delete', async (_e, skillId: string) => {
    return skillLoader.deleteCustomSkill(skillId);
  });

  ipcMain.handle('skill:run', async (event, skillId: string, vars: Record<string, string>, sessionId?: string) => {
    const skills = await skillLoader.loadAll();
    const skill = skills.find((s) => s.id === skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);

    const { SkillExecutor } = await import('./skills/executor');
    const executor = new SkillExecutor(engineManager);

    try {
      if (skill.type === 'workflow' && skill.steps?.length) {
        for await (const ev of executor.executeWorkflow(skill, vars, sessionId)) {
          event.sender.send('chat:event', { sessionId, ...ev as object });
        }
      } else {
        for await (const ev of executor.executeSimple(skill, vars, sessionId)) {
          event.sender.send('chat:event', { sessionId, ...ev as object });
        }
      }
    } catch (err) {
      event.sender.send('chat:event', { sessionId, type: 'error', message: String(err) });
    }
    event.sender.send('chat:event', { sessionId, type: 'done' });
  });

  // --- Notification Rules ---

  ipcMain.handle('notif-rules:list', () => {
    return ruleManager.getRules();
  });

  ipcMain.handle('notif-rules:add', (_e, rule: Parameters<typeof ruleManager.addRule>[0]) => {
    ruleManager.addRule(rule);
  });

  ipcMain.handle('notif-rules:update', (_e, id: string, patch: Record<string, unknown>) => {
    ruleManager.updateRule(id, patch);
  });

  ipcMain.handle('notif-rules:delete', (_e, id: string) => {
    ruleManager.deleteRule(id);
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

  // --- Auth & Mode ---

  ipcMain.handle('auth:login-google', async () => {
    return authManager.loginWithGoogle();
  });

  ipcMain.handle('auth:logout', async () => {
    await authManager.logout();
  });

  ipcMain.handle('auth:get-user', () => {
    return authManager.getCurrentUser();
  });

  ipcMain.handle('auth:get-mode', () => {
    return modeManager.getState();
  });

  ipcMain.handle('auth:switch-personal', () => {
    modeManager.switchToPersonal();
  });

  ipcMain.handle('auth:switch-team', (_e, teamId: string, teamName: string) => {
    modeManager.switchToTeam(teamId, teamName);
  });

  // --- Billing (proxy to cloud API) ---

  ipcMain.handle('billing:get-credits', async () => {
    const token = authManager.getToken();
    if (!token) throw new Error('Not logged in');

    const cloudUrl = 'https://api.jowork.dev';
    const res = await fetch(`${cloudUrl}/billing/credits`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch credits');
    return res.json();
  });

  ipcMain.handle('billing:checkout', async (_e, planId: string) => {
    const token = authManager.getToken();
    if (!token) throw new Error('Not logged in');

    const cloudUrl = 'https://api.jowork.dev';
    const res = await fetch(`${cloudUrl}/billing/checkout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId }),
    });
    if (!res.ok) throw new Error('Failed to create checkout');
    const data = await res.json() as { url: string };
    return data.url;
  });

  ipcMain.handle('billing:portal', async () => {
    const token = authManager.getToken();
    if (!token) throw new Error('Not logged in');

    const cloudUrl = 'https://api.jowork.dev';
    const res = await fetch(`${cloudUrl}/billing/portal`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to create portal');
    const data = await res.json() as { url: string };
    return data.url;
  });

  ipcMain.handle('billing:top-up', async (_e, amount: number) => {
    const token = authManager.getToken();
    if (!token) throw new Error('Not logged in');

    const cloudUrl = 'https://api.jowork.dev';
    const res = await fetch(`${cloudUrl}/billing/top-up`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ credits: amount }),
    });
    if (!res.ok) throw new Error('Failed to create top-up');
    const data = await res.json() as { url: string };
    return data.url;
  });

  // --- Team (proxy to cloud API) ---

  ipcMain.handle('team:list', async () => {
    const token = authManager.getToken();
    if (!token) return [];

    const cloudUrl = 'https://api.jowork.dev';
    try {
      const res = await fetch(`${cloudUrl}/teams`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    } catch {
      return [];
    }
  });

  ipcMain.handle('team:get', async (_e, teamId: string) => {
    const token = authManager.getToken();
    if (!token) throw new Error('Not logged in');

    const cloudUrl = 'https://api.jowork.dev';
    const res = await fetch(`${cloudUrl}/teams/${teamId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch team');
    return res.json();
  });

  ipcMain.handle('team:create', async (_e, name: string) => {
    const token = authManager.getToken();
    if (!token) throw new Error('Not logged in');

    const cloudUrl = 'https://api.jowork.dev';
    const res = await fetch(`${cloudUrl}/teams`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error('Failed to create team');
    return res.json();
  });

  ipcMain.handle('team:invite', async (_e, teamId: string) => {
    const token = authManager.getToken();
    if (!token) throw new Error('Not logged in');

    const cloudUrl = 'https://api.jowork.dev';
    const res = await fetch(`${cloudUrl}/teams/${teamId}/invite`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to generate invite');
    return res.json();
  });

  ipcMain.handle('team:remove-member', async (_e, teamId: string, userId: string) => {
    const token = authManager.getToken();
    if (!token) throw new Error('Not logged in');

    const cloudUrl = 'https://api.jowork.dev';
    const res = await fetch(`${cloudUrl}/teams/${teamId}/members/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to remove member');
    return res.json();
  });

  ipcMain.handle('team:update-role', async (_e, teamId: string, userId: string, role: string) => {
    const token = authManager.getToken();
    if (!token) throw new Error('Not logged in');

    const cloudUrl = 'https://api.jowork.dev';
    const res = await fetch(`${cloudUrl}/teams/${teamId}/members/${userId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) throw new Error('Failed to update role');
    return res.json();
  });

  ipcMain.handle('team:update-settings', async (_e, teamId: string, settings: { name?: string }) => {
    const token = authManager.getToken();
    if (!token) throw new Error('Not logged in');

    const cloudUrl = 'https://api.jowork.dev';
    const res = await fetch(`${cloudUrl}/teams/${teamId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('Failed to update team settings');
    return res.json();
  });

  // --- Shell ---

  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    await shell.openExternal(url);
  });

  // --- Sync ---

  ipcMain.handle('sync:start', () => {
    if (authManager.isLoggedIn()) {
      syncManager.start();
    }
  });

  ipcMain.handle('sync:stop', () => {
    syncManager.stop();
  });

  ipcMain.handle('sync:now', async () => {
    await syncManager.sync();
  });

  ipcMain.handle('sync:status', () => {
    return syncManager.getStatus();
  });

  ipcMain.handle('sync:track-change', (_e, record: SyncRecord) => {
    syncManager.trackChange(record);
  });

  // --- Updater IPC ---
  ipcMain.handle('updater:check', () => checkForUpdates());
  ipcMain.handle('updater:install', () => quitAndInstall());

  // --- Confirm rules ---
  ipcMain.handle('confirm:evaluate', (_e, toolName: string) => {
    return {
      action: confirmRuleEngine.evaluate(toolName),
      risk: confirmRuleEngine.getRisk(toolName),
    };
  });

  ipcMain.handle('confirm:always-allow', (_e, toolName: string) => {
    confirmRuleEngine.alwaysAllow(toolName);
  });

  ipcMain.handle('confirm:get-rules', () => {
    return confirmRuleEngine.getRules();
  });

  ipcMain.handle('confirm:get-allowed', () => {
    return confirmRuleEngine.getAllowedTools();
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
  syncManager?.stop();
  scheduler?.stopAll();
  connectorHub?.stopAll();
  ptyManager?.destroyAll();
  fileWatcher?.closeAll();
  launcherWindow?.destroy();
  engineManager?.close();
});
