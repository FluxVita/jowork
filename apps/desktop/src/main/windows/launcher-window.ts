import { BrowserWindow, globalShortcut, screen } from 'electron';
import { join } from 'path';

export class LauncherWindow {
  private win: BrowserWindow | null = null;

  create(): void {
    if (this.win) return;

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;
    const winWidth = 600;
    const winHeight = 420;

    this.win = new BrowserWindow({
      width: winWidth,
      height: winHeight,
      x: Math.round((screenWidth - winWidth) / 2),
      y: 120,
      frame: false,
      transparent: true,
      vibrancy: 'under-window',
      visualEffectState: 'active',
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    // Load the launcher route
    if (process.env.ELECTRON_RENDERER_URL) {
      this.win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/launcher`);
    } else {
      this.win.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: '/launcher',
      });
    }

    this.win.on('blur', () => {
      this.win?.hide();
    });

    this.win.on('closed', () => {
      this.win = null;
    });
  }

  toggle(): void {
    if (!this.win) {
      this.create();
    }

    if (this.win?.isVisible()) {
      this.win.hide();
    } else {
      this.positionCenter();
      this.win?.show();
      this.win?.focus();
    }
  }

  hide(): void {
    this.win?.hide();
  }

  registerShortcut(): void {
    const accelerator = process.platform === 'darwin' ? 'Cmd+Shift+Space' : 'Ctrl+Shift+Space';
    globalShortcut.register(accelerator, () => {
      this.toggle();
    });
  }

  unregisterShortcut(): void {
    globalShortcut.unregisterAll();
  }

  getWindow(): BrowserWindow | null {
    return this.win;
  }

  destroy(): void {
    this.unregisterShortcut();
    this.win?.destroy();
    this.win = null;
  }

  private positionCenter(): void {
    if (!this.win) return;
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;
    const [winWidth] = this.win.getSize();
    this.win.setPosition(Math.round((screenWidth - winWidth) / 2), 120);
  }
}
