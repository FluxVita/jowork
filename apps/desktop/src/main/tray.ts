import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron';
import { join } from 'path';
import { i18n } from '@jowork/core';

let tray: Tray | null = null;

function buildTrayMenu(mainWindow: BrowserWindow | null): Menu {
  const t = i18n.t.bind(i18n);
  return Menu.buildFromTemplate([
    {
      label: t('trayShow'),
      click: () => {
        const win = mainWindow ?? BrowserWindow.getAllWindows()[0];
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

export function setupTray(mainWindow: BrowserWindow | null): void {
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
  tray.setContextMenu(buildTrayMenu(mainWindow));
  tray.setToolTip('JoWork');

  // Rebuild tray menu when language changes
  i18n.on('languageChanged', () => {
    tray?.setContextMenu(buildTrayMenu(mainWindow));
  });
}
