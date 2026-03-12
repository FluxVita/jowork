import { ipcMain, app } from 'electron';

export function setupIPC(): void {
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:get-platform', () => process.platform);
}
