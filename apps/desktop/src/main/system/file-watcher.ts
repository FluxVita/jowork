import chokidar from 'chokidar';
import { BrowserWindow, app } from 'electron';
import { readFile, stat } from 'fs/promises';
import { extname, resolve, normalize } from 'path';

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.html', '.css',
  '.yml', '.yaml', '.toml', '.py', '.rs', '.go', '.java', '.sh', '.sql',
  '.env', '.gitignore', '.editorconfig',
]);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

// Directories that should never be read or watched
const BLOCKED_PATHS = [
  '/.ssh', '/.gnupg', '/.aws', '/.config/gcloud',
  '/etc/shadow', '/etc/passwd', '/etc/hosts',
  '/.env', '/.netrc',
];

function isPathSafe(targetPath: string): boolean {
  const resolved = normalize(resolve(targetPath));
  const home = app.getPath('home');

  // Block paths outside home directory (system files)
  if (!resolved.startsWith(home) && !resolved.startsWith('/tmp')) {
    return false;
  }

  // Block sensitive directories within home
  for (const blocked of BLOCKED_PATHS) {
    if (resolved.includes(blocked)) return false;
  }

  return true;
}

export class FileWatcher {
  private watchers = new Map<string, chokidar.FSWatcher>();
  private mainWindow: BrowserWindow | null = null;

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  watchProject(dir: string): void {
    if (this.watchers.has(dir)) return;
    if (!isPathSafe(dir)) {
      throw new Error(`Watching this directory is not allowed: ${dir}`);
    }

    const watcher = chokidar.watch(dir, {
      ignored: /(node_modules|\.git|\.DS_Store|dist|\.next|__pycache__)/,
      persistent: true,
      ignoreInitial: true,
      depth: 5,
    });

    watcher.on('change', (path) => {
      this.mainWindow?.webContents.send('file:changed', { path, event: 'change' });
    });

    watcher.on('add', (path) => {
      this.mainWindow?.webContents.send('file:changed', { path, event: 'add' });
    });

    watcher.on('unlink', (path) => {
      this.mainWindow?.webContents.send('file:changed', { path, event: 'unlink' });
    });

    watcher.on('error', (err) => {
      console.error(`[FileWatcher] Error watching ${dir}:`, err);
      // Auto-cleanup broken watcher
      watcher.close();
      this.watchers.delete(dir);
    });

    this.watchers.set(dir, watcher);
  }

  unwatchProject(dir: string): void {
    const watcher = this.watchers.get(dir);
    if (watcher) {
      watcher.close();
      this.watchers.delete(dir);
    }
  }

  async readFileForChat(filePath: string): Promise<{ type: 'text' | 'image' | 'binary'; content: string; name: string }> {
    if (!isPathSafe(filePath)) {
      throw new Error(`Reading this file is not allowed: ${filePath}`);
    }
    const ext = extname(filePath).toLowerCase();
    const fileStat = await stat(filePath);
    const name = filePath.split('/').pop() || filePath;

    if (IMAGE_EXTENSIONS.has(ext)) {
      const buffer = await readFile(filePath);
      const base64 = buffer.toString('base64');
      const mime = ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1)}`;
      return { type: 'image', content: `data:${mime};base64,${base64}`, name };
    }

    if (TEXT_EXTENSIONS.has(ext) || fileStat.size < 100_000) {
      const content = await readFile(filePath, 'utf-8');
      return { type: 'text', content, name };
    }

    return { type: 'binary', content: `[Binary file: ${name}, ${fileStat.size} bytes]`, name };
  }

  closeAll(): void {
    for (const [dir] of this.watchers) {
      this.unwatchProject(dir);
    }
  }
}
