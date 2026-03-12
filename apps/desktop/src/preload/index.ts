import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Generic IPC
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => { ipcRenderer.removeListener(channel, handler); };
  },

  // App
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version') as Promise<string>,
    getPlatform: () => ipcRenderer.invoke('app:get-platform') as Promise<string>,
  },

  // Engine
  engine: {
    detect: () => ipcRenderer.invoke('engine:detect'),
    switchEngine: (id: string) => ipcRenderer.invoke('engine:switch', id),
    getActive: () => ipcRenderer.invoke('engine:get-active') as Promise<string>,
    install: (id: string) => ipcRenderer.invoke('engine:install', id),
    onCrashed: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data);
      ipcRenderer.on('engine:crashed', handler);
      return () => { ipcRenderer.removeListener('engine:crashed', handler); };
    },
  },

  // Chat
  chat: {
    send: (opts: { sessionId?: string; message: string; cwd?: string }) =>
      ipcRenderer.invoke('chat:send', opts) as Promise<{ sessionId: string }>,
    abort: () => ipcRenderer.invoke('chat:abort'),
    onEvent: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data);
      ipcRenderer.on('chat:event', handler);
      return () => { ipcRenderer.removeListener('chat:event', handler); };
    },
  },

  // Session
  session: {
    list: (opts?: { limit?: number; offset?: number }) =>
      ipcRenderer.invoke('session:list', opts),
    get: (id: string) => ipcRenderer.invoke('session:get', id),
    create: (opts?: { engineId?: string; title?: string }) =>
      ipcRenderer.invoke('session:create', opts),
    delete: (id: string) => ipcRenderer.invoke('session:delete', id),
    rename: (id: string, title: string) => ipcRenderer.invoke('session:rename', id, title),
    onCreated: (cb: (session: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, session: unknown) => cb(session);
      ipcRenderer.on('session:created', handler);
      return () => { ipcRenderer.removeListener('session:created', handler); };
    },
  },
};

contextBridge.exposeInMainWorld('jowork', api);

export type JoWorkAPI = typeof api;
