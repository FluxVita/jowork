import { contextBridge, ipcRenderer } from 'electron';

/** Helper: subscribe to an IPC event and return an unsubscribe function. */
function listen<T = unknown>(channel: string, cb: (data: T) => void) {
  const handler = (_e: Electron.IpcRendererEvent, data: T) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
}

// Allowlisted channels for the generic `on` listener
const ALLOWED_CHANNELS = new Set([
  'pty:data', 'pty:exit', 'chat:event', 'session:created',
  'engine:crashed', 'engine:crash-fatal', 'engine:restart-ready',
  'nav:goto', 'shortcut:new-session', 'shortcut:export',
]);

const api = {
  // Channel-restricted event listener (only allows known channels)
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (!ALLOWED_CHANNELS.has(channel)) {
      console.warn(`[preload] Blocked listener on unknown channel: ${channel}`);
      return () => {};
    }
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => { ipcRenderer.removeListener(channel, handler); };
  },

  // ── App ──
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version') as Promise<string>,
    getPlatform: () => ipcRenderer.invoke('app:get-platform') as Promise<string>,
  },

  // ── Engine ──
  engine: {
    detect: () => ipcRenderer.invoke('engine:detect') as Promise<Record<string, { installed: boolean; version?: string; error?: string }>>,
    switchEngine: (id: string) => ipcRenderer.invoke('engine:switch', id) as Promise<void>,
    getActive: () => ipcRenderer.invoke('engine:get-active') as Promise<string>,
    install: (id: string) => ipcRenderer.invoke('engine:install', id) as Promise<void>,
    onCrashed: (cb: (data: unknown) => void) => listen('engine:crashed', cb),
  },

  // ── Chat ──
  chat: {
    send: (opts: { sessionId?: string; message: string; cwd?: string }) =>
      ipcRenderer.invoke('chat:send', opts) as Promise<{ sessionId: string }>,
    abort: () => ipcRenderer.invoke('chat:abort') as Promise<void>,
    onEvent: (cb: (data: unknown) => void) => listen('chat:event', cb),
  },

  // ── Session ──
  session: {
    list: (opts?: { limit?: number; offset?: number }) =>
      ipcRenderer.invoke('session:list', opts) as Promise<unknown[]>,
    get: (id: string) => ipcRenderer.invoke('session:get', id),
    messages: (id: string, opts?: { limit?: number; beforeId?: string }) =>
      ipcRenderer.invoke('session:messages', id, opts) as Promise<{ messages: unknown[]; hasMore: boolean }>,
    create: (opts?: { engineId?: string; title?: string }) =>
      ipcRenderer.invoke('session:create', opts),
    delete: (id: string) => ipcRenderer.invoke('session:delete', id) as Promise<void>,
    rename: (id: string, title: string) => ipcRenderer.invoke('session:rename', id, title) as Promise<void>,
    export: (id: string, format: 'markdown' | 'json') =>
      ipcRenderer.invoke('session:export', id, format) as Promise<{ saved: boolean; path?: string }>,
    onCreated: (cb: (session: unknown) => void) => listen('session:created', cb),
  },

  // ── Connector ──
  connector: {
    list: () => ipcRenderer.invoke('connector:list') as Promise<Array<{
      id: string; name: string; description: string;
      category: string; tier: string;
      status: 'connected' | 'disconnected' | 'unconfigured';
      hasCredential: boolean;
    }>>,
    saveCredential: (connectorId: string, credential: unknown) =>
      ipcRenderer.invoke('connector:save-credential', connectorId, credential) as Promise<void>,
    start: (connectorId: string) => ipcRenderer.invoke('connector:start', connectorId) as Promise<void>,
    stop: (connectorId: string) => ipcRenderer.invoke('connector:stop', connectorId) as Promise<void>,
    health: () => ipcRenderer.invoke('connector:health') as Promise<Record<string, {
      connectorId: string; status: 'healthy' | 'unhealthy' | 'stopped';
      lastCheck: number; error?: string;
    }>>,
    tools: () => ipcRenderer.invoke('connector:tools') as Promise<Array<{
      connectorId: string; name: string; namespacedName: string;
      description?: string; inputSchema?: Record<string, unknown>;
    }>>,
  },

  // ── Memory ──
  memory: {
    list: (opts?: { scope?: string; pinned?: boolean; limit?: number }) =>
      ipcRenderer.invoke('memory:list', opts) as Promise<Array<{
        id: string; title: string; content: string; tags: string[];
        scope: string; pinned: boolean; source: string;
        lastUsedAt: number | null; createdAt: number; updatedAt: number;
      }>>,
    search: (query: string) => ipcRenderer.invoke('memory:search', query),
    create: (mem: { title: string; content: string; tags?: string[]; scope?: string; pinned?: boolean; source?: string }) =>
      ipcRenderer.invoke('memory:create', mem),
    update: (id: string, patch: { title?: string; content?: string; tags?: string[]; scope?: string; pinned?: boolean }) =>
      ipcRenderer.invoke('memory:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('memory:delete', id) as Promise<void>,
    get: (id: string) => ipcRenderer.invoke('memory:get', id),
  },

  // ── Skill ──
  skill: {
    list: () => ipcRenderer.invoke('skill:list'),
    run: (skillId: string, vars: Record<string, string>, sessionId?: string) =>
      ipcRenderer.invoke('skill:run', skillId, vars, sessionId) as Promise<void>,
    save: (skill: { name: string; description: string; trigger: string; type: 'simple' | 'workflow'; promptTemplate?: string; variables?: Array<{ name: string; label: string; type: 'text' | 'select' | 'multiline'; required?: boolean; default?: string; options?: string[] }>; steps?: Array<{ id: string; prompt: string; condition?: string; outputVar?: string }> }) =>
      ipcRenderer.invoke('skill:save', skill),
    delete: (skillId: string) => ipcRenderer.invoke('skill:delete', skillId) as Promise<void>,
  },

  // ── Notification Rules ──
  notifRules: {
    list: () => ipcRenderer.invoke('notif-rules:list'),
    add: (rule: { id: string; connectorId: string; condition: string; customFilter?: string; channels: string[]; silentHours?: { start: string; end: string }; aiSummary: boolean }) =>
      ipcRenderer.invoke('notif-rules:add', rule) as Promise<void>,
    update: (id: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('notif-rules:update', id, patch) as Promise<void>,
    delete: (id: string) => ipcRenderer.invoke('notif-rules:delete', id) as Promise<void>,
  },

  // ── Settings ──
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key) as Promise<string | null>,
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value) as Promise<void>,
    notifyLanguageChanged: (lang: string) => ipcRenderer.send('language-changed', lang),
  },

  // ── Launcher ──
  launcher: {
    toggle: () => ipcRenderer.invoke('launcher:toggle') as Promise<void>,
    hide: () => ipcRenderer.invoke('launcher:hide') as Promise<void>,
  },

  // ── System ──
  system: {
    notify: (opts: { title: string; body: string; sessionId?: string }) =>
      ipcRenderer.invoke('system:notify', opts) as Promise<void>,
  },

  // ── Clipboard ──
  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read') as Promise<string>,
    write: (text: string) => ipcRenderer.invoke('clipboard:write', text) as Promise<void>,
  },

  // ── PTY Terminal ──
  pty: {
    create: (opts?: { cwd?: string; shell?: string }) =>
      ipcRenderer.invoke('pty:create', opts) as Promise<string>,
    write: (id: string, data: string) => ipcRenderer.invoke('pty:write', id, data) as Promise<void>,
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('pty:resize', id, cols, rows) as Promise<void>,
    destroy: (id: string) => ipcRenderer.invoke('pty:destroy', id) as Promise<void>,
    list: () => ipcRenderer.invoke('pty:list') as Promise<string[]>,
    onData: (cb: (id: string, data: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string, data: string) => cb(id, data);
      ipcRenderer.on('pty:data', handler);
      return () => { ipcRenderer.removeListener('pty:data', handler); };
    },
    onExit: (cb: (id: string, exitCode: number) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string, exitCode: number) => cb(id, exitCode);
      ipcRenderer.on('pty:exit', handler);
      return () => { ipcRenderer.removeListener('pty:exit', handler); };
    },
  },

  // ── File ──
  file: {
    watch: (dir: string) => ipcRenderer.invoke('file:watch', dir) as Promise<void>,
    unwatch: (dir: string) => ipcRenderer.invoke('file:unwatch', dir) as Promise<void>,
    readForChat: (filePath: string) => ipcRenderer.invoke('file:read-for-chat', filePath) as Promise<string | null>,
  },

  // ── Scheduler ──
  scheduler: {
    list: () => ipcRenderer.invoke('scheduler:list') as Promise<Array<{
      id: string; name: string; cronExpression: string; timezone: string;
      type: string; config: Record<string, unknown>; enabled: boolean;
      lastRunAt: number | null; nextRunAt: number | null; cloudSync: boolean;
      createdAt: number;
    }>>,
    get: (id: string) => ipcRenderer.invoke('scheduler:get', id),
    create: (task: {
      name: string; cronExpression: string; timezone?: string;
      type: 'scan' | 'skill' | 'notify'; config?: Record<string, unknown>;
      enabled?: boolean; cloudSync?: boolean;
    }) => ipcRenderer.invoke('scheduler:create', task),
    update: (id: string, patch: {
      name?: string; cronExpression?: string; timezone?: string;
      type?: string; config?: Record<string, unknown>;
      enabled?: boolean; cloudSync?: boolean;
    }) => ipcRenderer.invoke('scheduler:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('scheduler:delete', id) as Promise<void>,
    executions: (taskId: string, limit?: number) =>
      ipcRenderer.invoke('scheduler:executions', taskId, limit),
  },

  // ── Auth ──
  auth: {
    loginGoogle: () => ipcRenderer.invoke('auth:login-google') as Promise<{
      id: string; email: string; name?: string; avatarUrl?: string; plan: string;
    }>,
    logout: () => ipcRenderer.invoke('auth:logout') as Promise<void>,
    getUser: () => ipcRenderer.invoke('auth:get-user') as Promise<{
      id: string; email: string; name?: string; avatarUrl?: string; plan: string;
    } | null>,
    getMode: () => ipcRenderer.invoke('auth:get-mode') as Promise<{
      mode: 'personal' | 'team'; localUserId: string;
      cloudUserId?: string; teamId?: string; teamName?: string;
    }>,
    switchPersonal: () => ipcRenderer.invoke('auth:switch-personal') as Promise<void>,
    switchTeam: (teamId: string, teamName: string) =>
      ipcRenderer.invoke('auth:switch-team', teamId, teamName) as Promise<void>,
  },

  // ── Billing ──
  billing: {
    getCredits: () => ipcRenderer.invoke('billing:get-credits'),
    checkout: (planId: string) => ipcRenderer.invoke('billing:checkout', planId) as Promise<string>,
    portal: () => ipcRenderer.invoke('billing:portal') as Promise<string>,
    topUp: (amount: number) => ipcRenderer.invoke('billing:top-up', amount) as Promise<string>,
  },

  // ── Team ──
  team: {
    list: () => ipcRenderer.invoke('team:list'),
    get: (teamId: string) => ipcRenderer.invoke('team:get', teamId),
    create: (name: string) => ipcRenderer.invoke('team:create', name),
    invite: (teamId: string) => ipcRenderer.invoke('team:invite', teamId),
    removeMember: (teamId: string, userId: string) =>
      ipcRenderer.invoke('team:remove-member', teamId, userId),
    updateRole: (teamId: string, userId: string, role: string) =>
      ipcRenderer.invoke('team:update-role', teamId, userId, role),
    updateSettings: (teamId: string, settings: { name?: string }) =>
      ipcRenderer.invoke('team:update-settings', teamId, settings),
  },

  // ── Shell ──
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url) as Promise<void>,
  },

  // ── Sync ──
  sync: {
    start: () => ipcRenderer.invoke('sync:start') as Promise<void>,
    stop: () => ipcRenderer.invoke('sync:stop') as Promise<void>,
    now: () => ipcRenderer.invoke('sync:now') as Promise<void>,
    status: () => ipcRenderer.invoke('sync:status') as Promise<{
      pendingCount: number; lastSyncVersion: number; online: boolean;
    }>,
    trackChange: (record: { table: string; rowId: string; operation: string; data?: unknown }) =>
      ipcRenderer.invoke('sync:track-change', record) as Promise<void>,
  },

  // ── Updater ──
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install') as Promise<void>,
  },

  // ── Confirm Rules ──
  confirm: {
    evaluate: (toolName: string) => ipcRenderer.invoke('confirm:evaluate', toolName) as Promise<{
      action: 'auto' | 'confirm' | 'block';
      risk: 'low' | 'medium' | 'high';
    }>,
    alwaysAllow: (toolName: string) => ipcRenderer.invoke('confirm:always-allow', toolName) as Promise<void>,
    getRules: () => ipcRenderer.invoke('confirm:get-rules'),
    getAllowed: () => ipcRenderer.invoke('confirm:get-allowed') as Promise<string[]>,
  },
};

contextBridge.exposeInMainWorld('jowork', api);

export type JoWorkAPI = typeof api;
