import { BrowserWindow } from 'electron';

/**
 * Auto-updater module.
 *
 * Uses electron-updater (from electron-builder) to check GitHub Releases
 * for new versions, download, and prompt the user to restart.
 *
 * electron-updater is an optional dependency — if not installed or in dev mode,
 * the updater gracefully no-ops.
 */

let autoUpdater: typeof import('electron-updater').autoUpdater | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;
let initialCheckTimeout: ReturnType<typeof setTimeout> | null = null;

export async function setupAutoUpdater(mainWindow: BrowserWindow): Promise<void> {
  // Skip in dev mode — updates only work with packaged apps
  if (process.env.NODE_ENV === 'development' || !mainWindow) return;

  try {
    const mod = await import('electron-updater');
    autoUpdater = mod.autoUpdater;
  } catch {
    // electron-updater not installed — skip
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  /** Send IPC to main window, safely handling destroyed windows. */
  function sendToWindow(channel: string, data?: unknown): void {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  }

  autoUpdater.on('checking-for-update', () => {
    sendToWindow('update:checking');
  });

  autoUpdater.on('update-available', (info) => {
    sendToWindow('update:available', {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendToWindow('update:up-to-date');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendToWindow('update:progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendToWindow('update:downloaded', {
      version: info.version,
    });
  });

  autoUpdater.on('error', (err) => {
    sendToWindow('update:error', {
      message: err.message,
    });
  });

  // Check every hour
  checkInterval = setInterval(() => {
    autoUpdater?.checkForUpdates().catch(() => {});
  }, 60 * 60 * 1000);

  // Initial check (delay 10s to not block startup)
  initialCheckTimeout = setTimeout(() => {
    autoUpdater?.checkForUpdatesAndNotify().catch(() => {});
  }, 10_000);
}

/** Clean up all listeners and timers. Call on app quit. */
export function teardownAutoUpdater(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  if (initialCheckTimeout) {
    clearTimeout(initialCheckTimeout);
    initialCheckTimeout = null;
  }
  autoUpdater?.removeAllListeners();
  autoUpdater = null;
}

/** Manually trigger an update check. */
export function checkForUpdates(): void {
  autoUpdater?.checkForUpdatesAndNotify().catch(() => {});
}

/** Quit and install the downloaded update. */
export function quitAndInstall(): void {
  autoUpdater?.quitAndInstall();
}
