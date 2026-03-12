import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron';
import { join } from 'path';

let tray: Tray | null = null;

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

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show JoWork',
      click: () => {
        const win = mainWindow ?? BrowserWindow.getAllWindows()[0];
        if (win) {
          win.show();
          win.focus();
        }
      },
    },
    { type: 'separator' },
    { label: 'Quick Chat', accelerator: 'CmdOrCtrl+Shift+Space' },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip('JoWork');
}
