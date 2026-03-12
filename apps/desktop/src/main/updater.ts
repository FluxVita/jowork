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

  autoUpdater.on('checking-for-update', () => {
    mainWindow.webContents.send('update:checking');
  });

  autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send('update:available', {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow.webContents.send('update:up-to-date');
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('update:progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('update:downloaded', {
      version: info.version,
    });
  });

  autoUpdater.on('error', (err) => {
    mainWindow.webContents.send('update:error', {
      message: err.message,
    });
  });

  // Check every hour
  setInterval(() => {
    autoUpdater?.checkForUpdates().catch(() => {});
  }, 60 * 60 * 1000);

  // Initial check (delay 10s to not block startup)
  setTimeout(() => {
    autoUpdater?.checkForUpdatesAndNotify().catch(() => {});
  }, 10_000);
}

/** Manually trigger an update check. */
export function checkForUpdates(): void {
  autoUpdater?.checkForUpdatesAndNotify().catch(() => {});
}

/** Quit and install the downloaded update. */
export function quitAndInstall(): void {
  autoUpdater?.quitAndInstall();
}
