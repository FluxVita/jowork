import { ipcMain, app, BrowserWindow, shell, dialog } from 'electron';
import { writeFile } from 'fs/promises';
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
import { getApiBaseUrl, getHealthBaseUrl } from './config/urls';
import type { SyncRecord } from '@jowork/core';
import type { EngineId } from './engine/types';

/** Safely send IPC to renderer — no-op if sender is destroyed (e.g. window closed during streaming). */
function safeSend(sender: Electron.WebContents, channel: string, ...args: unknown[]): void {
  try {
    if (!sender.isDestroyed()) {
      sender.send(channel, ...args);
    }
  } catch {
    // Sender gone — swallow silently
  }
}

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

export function getFileWatcher(): FileWatcher {
  return fileWatcher;
}

export function setupIPC(): void {
  const cloudUrl = getApiBaseUrl();
  const healthUrl = getHealthBaseUrl();
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
  engineManager.configureCloudEngine({
    apiUrl: cloudUrl,
    healthUrl,
    getToken: () => authManager.getToken(),
  });
  contextAssembler = new ContextAssembler();
  contextDocsStore = new ContextDocsStore(hm.getSqliteInstance());
  autoExtractor = new AutoExtractor(memoryStore);
  confirmRuleEngine = new ConfirmRuleEngine(hm.getSqliteInstance());

  let deviceId = hm.getSetting('device_id');
  if (!deviceId) {
    deviceId = `device_${Date.now()}`;
    hm.setSetting('device_id', deviceId);
  }
  syncManager = new SyncManager({
    sqlite: hm.getSqliteInstance(),
    cloudUrl,
    getToken: () => authManager.getToken(),
    mode: modeManager.isTeam() ? 'team' : 'personal',
    deviceId,
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
      safeSend(event.sender, 'session:created', session);
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
          safeSend(event.sender, 'chat:event', {
            sessionId,
            ...engineEvent,
            confirmAction: action,
            confirmRisk: risk,
          });
        } else {
          safeSend(event.sender, 'chat:event', { sessionId, ...engineEvent });
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
      safeSend(event.sender, 'chat:event', {
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
    // Load initial page of messages (most recent 40)
    const { messages: sessionMessages, hasMore } = hm.getMessagesPaginated(sessionId, { limit: 40 });
    return { ...session, messages: sessionMessages, hasMore };
  });

  ipcMain.handle('session:messages', (_e, sessionId: string, opts?: { limit?: number; beforeId?: string }) => {
    const hm = engineManager.getHistoryManager();
    return hm.getMessagesPaginated(sessionId, opts);
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

  ipcMain.handle('session:search-messages', (_e, query: string, opts?: { limit?: number }) => {
    return engineManager.getHistoryManager().searchMessages(query, opts);
  });

  ipcMain.handle('session:export', async (_e, sessionId: string, format: 'markdown' | 'json') => {
    const hm = engineManager.getHistoryManager();
    const session = hm.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    const msgs = hm.getMessages(sessionId);

    const safeTitle = session.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
    const ext = format === 'json' ? 'json' : 'md';
    const defaultPath = `${safeTitle}.${ext}`;

    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win!, {
      defaultPath,
      filters: format === 'json'
        ? [{ name: 'JSON', extensions: ['json'] }]
        : [{ name: 'Markdown', extensions: ['md'] }],
    });

    if (result.canceled || !result.filePath) return { saved: false };

    let content: string;
    if (format === 'json') {
      content = JSON.stringify({
        session: { id: session.id, title: session.title, engine: session.engineId, createdAt: session.createdAt },
        messages: msgs.map((m) => ({
          role: m.role, content: m.content, toolName: m.toolName, createdAt: m.createdAt,
        })),
        exportedAt: new Date().toISOString(),
      }, null, 2);
    } else {
      const lines: string[] = [`# ${session.title}`, ''];
      lines.push(`**Engine**: ${session.engineId} | **Created**: ${new Date(session.createdAt).toLocaleString()}`, '');
      lines.push('---', '');
      for (const m of msgs) {
        const ts = new Date(m.createdAt).toLocaleTimeString();
        if (m.role === 'user') {
          lines.push(`### User (${ts})`, '', m.content, '');
        } else if (m.role === 'assistant') {
          lines.push(`### Assistant (${ts})`, '', m.content, '');
        } else if (m.role === 'tool_call') {
          lines.push(`> **Tool Call**: \`${m.toolName ?? 'tool'}\``, `> \`\`\``, `> ${m.content.slice(0, 500)}`, `> \`\`\``, '');
        } else if (m.role === 'tool_result') {
          lines.push(`> **Tool Result**: \`${m.toolName ?? ''}\``, `> ${m.content.slice(0, 500)}`, '');
        } else {
          lines.push(`*${m.role}*: ${m.content}`, '');
        }
      }
      content = lines.join('\n');
    }

    await writeFile(result.filePath, content, 'utf-8');
    return { saved: true, path: result.filePath };
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
    // Validate: credential must be a plain object with string values, not too large
    if (!credential || typeof credential !== 'object' || Array.isArray(credential)) {
      throw new Error('Credential must be a plain object');
    }
    const json = JSON.stringify(credential);
    if (json.length > 10_000) {
      throw new Error('Credential too large');
    }
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
          safeSend(event.sender, 'chat:event', { sessionId, ...ev as object });
        }
      } else {
        for await (const ev of executor.executeSimple(skill, vars, sessionId)) {
          safeSend(event.sender, 'chat:event', { sessionId, ...ev as object });
        }
      }
    } catch (err) {
      safeSend(event.sender, 'chat:event', { sessionId, type: 'error', message: String(err) });
    }
    safeSend(event.sender, 'chat:event', { sessionId, type: 'done' });
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
    const sender = event.sender;

    // Forward PTY output to renderer (safeSend guards against destroyed sender)
    ptyManager.onData(id, (data) => {
      safeSend(sender, 'pty:data', id, data);
    });

    ptyManager.onExit(id, (exitCode) => {
      safeSend(sender, 'pty:exit', id, exitCode);
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

  // --- Cloud API proxy helper ---

  async function cloudFetch<T = unknown>(
    path: string,
    opts: { method?: string; body?: unknown; errorMsg?: string } = {},
  ): Promise<T> {
    const token = authManager.getToken();
    if (!token) throw new Error('Not logged in');

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    let bodyStr: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyStr = JSON.stringify(opts.body);
    }

    const res = await fetch(`${cloudUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: bodyStr,
    });
    if (!res.ok) throw new Error(opts.errorMsg ?? `Cloud API error: ${res.status}`);
    return res.json() as T;
  }

  // --- Billing (proxy to cloud API) ---

  ipcMain.handle('billing:get-credits', () => cloudFetch('/billing/credits'));
  ipcMain.handle('billing:checkout', (_e, planId: string) =>
    cloudFetch<{ url: string }>('/billing/checkout', { method: 'POST', body: { planId } }).then((d) => d.url));
  ipcMain.handle('billing:portal', () =>
    cloudFetch<{ url: string }>('/billing/portal').then((d) => d.url));
  ipcMain.handle('billing:top-up', (_e, amount: number) =>
    cloudFetch<{ url: string }>('/billing/top-up', { method: 'POST', body: { credits: amount } }).then((d) => d.url));

  // --- Team (proxy to cloud API) ---

  ipcMain.handle('team:list', async () => {
    try { return await cloudFetch('/teams'); } catch { return []; }
  });
  ipcMain.handle('team:get', (_e, teamId: string) =>
    cloudFetch(`/teams/${teamId}`));
  ipcMain.handle('team:create', (_e, name: string) =>
    cloudFetch('/teams', { method: 'POST', body: { name } }));
  ipcMain.handle('team:invite', (_e, teamId: string) =>
    cloudFetch(`/teams/${teamId}/invite`, { method: 'POST' }));
  ipcMain.handle('team:remove-member', (_e, teamId: string, userId: string) =>
    cloudFetch(`/teams/${teamId}/members/${userId}`, { method: 'DELETE' }));
  ipcMain.handle('team:update-role', (_e, teamId: string, userId: string, role: string) =>
    cloudFetch(`/teams/${teamId}/members/${userId}`, { method: 'PATCH', body: { role } }));
  ipcMain.handle('team:update-settings', (_e, teamId: string, settings: { name?: string }) =>
    cloudFetch(`/teams/${teamId}`, { method: 'PATCH', body: settings }));

  // --- Shell ---

  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    // Security: only allow http/https URLs
    if (typeof url !== 'string' || !(url.startsWith('https://') || url.startsWith('http://'))) {
      throw new Error('Only http/https URLs are allowed');
    }
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
