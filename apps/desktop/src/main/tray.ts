import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron';
import { join } from 'path';
import { i18n } from '@jowork/core';

let tray: Tray | null = null;

function buildTrayMenu(): Menu {
  const t = i18n.t.bind(i18n);
  return Menu.buildFromTemplate([
    {
      label: t('trayShow'),
      click: () => {
        // Always pick the first live window (avoids stale reference to destroyed window)
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
        if (win) {
          win.show();
          win.focus();
        }
      },
    },
    { type: 'separator' },
    { label: t('trayQuickChat'), accelerator: 'CmdOrCtrl+Shift+Space' },
    { type: 'separator' },
    { label: t('trayQuit'), click: () => app.quit() },
  ]);
}

export function setupTray(): void {
  // Use a simple 18x18 template icon for macOS
  const iconPath = join(__dirname, '../../build/tray-icon.png');
  let icon: nativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  } catch {
    // Fallback: create an empty icon if file doesn't exist
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setContextMenu(buildTrayMenu());
  tray.setToolTip('JoWork');

  // Rebuild tray menu when language changes
  i18n.on('languageChanged', () => {
    tray?.setContextMenu(buildTrayMenu());
  });
}
