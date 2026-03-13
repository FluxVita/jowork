import { app, BrowserWindow, shell, Menu, ipcMain } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { i18n } from '@jowork/core';
import { setupIPC, getLauncherWindow, getNotificationManager, getFileWatcher } from './ipc';
import { setupTray } from './tray';
import { setupAutoUpdater } from './updater';

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function buildAppMenu(): void {
  const t = i18n.t.bind(i18n);
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { label: t('title', { ns: 'settings' }), accelerator: 'CmdOrCtrl+,', click: () => mainWindow?.webContents.send('nav:goto', '/settings') },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),
    {
      label: t('menuFile'),
      submenu: [
        { label: t('newConversation', { ns: 'chat' }), accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('shortcut:new-session') },
        { label: t('exportConversation', { ns: 'chat' }), accelerator: 'CmdOrCtrl+E', click: () => mainWindow?.webContents.send('shortcut:export') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: t('menuView'),
      submenu: [
        { label: t('terminal', { ns: 'sidebar' }), accelerator: 'CmdOrCtrl+Shift+T', click: () => mainWindow?.webContents.send('nav:goto', '/terminal') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  setupIPC();
  createMainWindow();
  buildAppMenu();
  setupTray();

  // Rebuild menu when renderer changes language
  ipcMain.on('language-changed', (_event, lang: string) => {
    if (lang && (lang === 'zh' || lang === 'en')) {
      i18n.changeLanguage(lang);
      buildAppMenu();
    }
  });

  // Register launcher global shortcut and set main window reference
  const launcher = getLauncherWindow();
  launcher.registerShortcut();

  if (mainWindow) {
    getNotificationManager().setMainWindow(mainWindow);
    getFileWatcher().setMainWindow(mainWindow);
    setupAutoUpdater(mainWindow);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
    buildAppMenu();
    if (mainWindow) {
      getNotificationManager().setMainWindow(mainWindow);
      getFileWatcher().setMainWindow(mainWindow);
      setupAutoUpdater(mainWindow);
    }
  }
});
