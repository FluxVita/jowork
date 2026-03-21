import { readdirSync, readFileSync, statSync, lstatSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import Database from 'better-sqlite3';
import { createId } from '@jowork/core';
import { contentHash } from './feishu.js';
import { logInfo, logError } from '../utils/logger.js';

export interface IndexResult {
  indexed: number;
  skipped: number;
  errors: number;
}

export interface IndexOptions {
  maxDepth?: number;
  maxFileSize?: number;
  progress?: (indexed: number, total: number) => void;
}

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.DS_Store', '__pycache__', '.next', '.nuxt',
  '.turbo', 'dist', 'build', '.cache', '.vscode', '.idea', 'coverage',
  'vendor', '.svn', '.hg',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.flac',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.sqlite', '.db', '.db-wal', '.db-shm',
  '.o', '.a', '.pyc', '.class', '.wasm',
]);

const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_FILE_SIZE = 1024 * 1024; // 1MB

/** Recursively walk a directory, returning file paths. */
function walkDir(
  dirPath: string,
  basePath: string,
  depth: number,
  maxDepth: number,
  maxFileSize: number,
  result: { files: string[]; skipped: number },
): void {
  if (depth > maxDepth) {
    result.skipped++;
    return;
  }

  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    result.skipped++;
    return;
  }

  for (const name of entries) {
    const fullPath = join(dirPath, name);

    // Skip dotfiles and known skip dirs
    if (SKIP_DIRS.has(name) || name.startsWith('.')) {
      result.skipped++;
      continue;
    }

    // Use lstat to detect symlinks and get file info
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(fullPath);
    } catch {
      result.skipped++;
      continue;
    }

    if (stat.isSymbolicLink()) {
      result.skipped++;
      continue;
    }

    if (stat.isDirectory()) {
      walkDir(fullPath, basePath, depth + 1, maxDepth, maxFileSize, result);
      continue;
    }

    if (!stat.isFile()) {
      result.skipped++;
      continue;
    }

    // Skip binary extensions
    const ext = extname(name).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      result.skipped++;
      continue;
    }

    // Skip files > maxFileSize or empty files
    if (stat.size > maxFileSize || stat.size === 0) {
      result.skipped++;
      continue;
    }

    result.files.push(fullPath);
  }
}

/**
 * Index a local directory into objects + object_bodies + FTS.
 * Idempotent via uri UNIQUE constraint (INSERT OR IGNORE).
 */
export function indexDirectory(
  sqlite: Database.Database,
  dirPath: string,
  opts: IndexOptions = {},
): IndexResult {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxFileSize = opts.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  // Collect all files first
  const walkResult = { files: [] as string[], skipped: 0 };
  walkDir(dirPath, dirPath, 0, maxDepth, maxFileSize, walkResult);

  const totalFiles = walkResult.files.length;
  let indexed = 0;
  let errors = 0;

  const checkExists = sqlite.prepare('SELECT id FROM objects WHERE uri = ?');
  const insertObj = sqlite.prepare(`
    INSERT OR IGNORE INTO objects (id, source, source_type, uri, title, summary, tags, content_hash, last_synced_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBody = sqlite.prepare(`
    INSERT OR IGNORE INTO object_bodies (object_id, content, content_type, fetched_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertFts = sqlite.prepare(`
    INSERT INTO objects_fts(rowid, title, summary, tags, source, source_type, body_excerpt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const getRowid = sqlite.prepare('SELECT rowid FROM objects WHERE id = ?');

  // Process in batches of 100
  for (let i = 0; i < walkResult.files.length; i += 100) {
    const batch = walkResult.files.slice(i, i + 100);

    const txn = sqlite.transaction((files: string[]) => {
      for (const filePath of files) {
        try {
          const relPath = relative(dirPath, filePath);
          const uri = `local://${filePath}`;

          // Skip if already indexed
          const existing = checkExists.get(uri);
          if (existing) continue;

          const content = readFileSync(filePath, 'utf-8');
          const hash = contentHash(content);
          const now = Date.now();
          const id = createId('obj');
          const fileName = basename(filePath);
          const ext = extname(filePath);
          const summary = content.length > 200 ? content.slice(0, 200) + '...' : content;
          const tags = JSON.stringify(['local', 'file', ext.replace('.', '')].filter(Boolean));
          const sourceType = detectFileType(ext);

          insertObj.run(id, 'local', sourceType, uri, fileName, summary, tags, hash, now, now);
          insertBody.run(id, content, mimeForExt(ext), now);

          // Incremental FTS
          try {
            const rowid = getRowid.get(id) as { rowid: number } | undefined;
            if (rowid) {
              const excerpt = content.length > 500 ? content.slice(0, 500) : content;
              insertFts.run(rowid.rowid, fileName, summary, tags, 'local', sourceType, excerpt);
            }
          } catch { /* FTS insert non-critical */ }

          indexed++;
        } catch {
          errors++;
        }
      }
    });

    txn(batch);

    if (opts.progress) {
      opts.progress(Math.min(i + 100, totalFiles), totalFiles);
    }
  }

  logInfo('indexer', `Indexed ${indexed} files from ${dirPath}`, { skipped: walkResult.skipped, errors });
  return { indexed, skipped: walkResult.skipped, errors };
}

function detectFileType(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'code', '.js': 'code', '.tsx': 'code', '.jsx': 'code',
    '.py': 'code', '.go': 'code', '.rs': 'code', '.rb': 'code',
    '.java': 'code', '.kt': 'code', '.swift': 'code', '.c': 'code',
    '.cpp': 'code', '.h': 'code', '.cs': 'code', '.php': 'code',
    '.sh': 'code', '.bash': 'code', '.zsh': 'code',
    '.md': 'document', '.txt': 'document', '.rst': 'document',
    '.html': 'document', '.css': 'code', '.scss': 'code', '.less': 'code',
    '.json': 'config', '.yaml': 'config', '.yml': 'config',
    '.toml': 'config', '.xml': 'config', '.ini': 'config',
    '.env': 'config', '.gitignore': 'config',
    '.sql': 'code', '.graphql': 'code', '.gql': 'code',
    '.vue': 'code', '.svelte': 'code',
  };
  return map[ext.toLowerCase()] ?? 'file';
}

function mimeForExt(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'text/typescript', '.js': 'text/javascript',
    '.json': 'application/json', '.md': 'text/markdown',
    '.html': 'text/html', '.css': 'text/css',
    '.py': 'text/x-python', '.go': 'text/x-go',
    '.yaml': 'text/yaml', '.yml': 'text/yaml',
    '.toml': 'text/toml', '.xml': 'text/xml',
    '.sql': 'text/x-sql', '.sh': 'text/x-shellscript',
  };
  return map[ext.toLowerCase()] ?? 'text/plain';
}
