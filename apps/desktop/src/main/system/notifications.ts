import { Notification, BrowserWindow } from 'electron';

interface NotifyOpts {
  title: string;
  body: string;
  urgency?: 'low' | 'normal' | 'critical';
  sessionId?: string;
}

export class NotificationManager {
  private mainWindow: BrowserWindow | null = null;

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  send(opts: NotifyOpts): void {
    if (!Notification.isSupported()) return;

    const notification = new Notification({
      title: opts.title,
      body: opts.body,
      urgency: opts.urgency ?? 'normal',
    });

    notification.once('click', () => {
      if (this.mainWindow) {
        this.mainWindow.show();
        this.mainWindow.focus();
        if (opts.sessionId) {
          this.mainWindow.webContents.send('navigate:session', opts.sessionId);
        }
      }
    });

    notification.show();
  }
}
