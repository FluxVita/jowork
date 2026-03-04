// @jowork/core/datamap/export — backup export and import utilities
//
// Export formats:
//   ZIP      — all tables as deflate-compressed JSON files + manifest (default backup format)
//   JSON     — single JSON object { manifest, tables }
//   CSV      — single table as comma-separated values
//   Markdown — human-readable summary (max 50 rows per table)
//
// Import: accepts ZIP buffer, validates manifest version, restores all tables in a transaction.

import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib';
import type Database from 'better-sqlite3';
import { logger } from '../utils/index.js';
import { migrate } from './migrator.js';

const EXPORT_VERSION = '1';
const APP_VERSION = '0.1.0';

const TABLES = [
  'users', 'agents', 'sessions', 'messages',
  'memories', 'connectors', 'scheduler_tasks', 'context_docs',
] as const;

export type ExportTableName = typeof TABLES[number];

const TABLE_SET = new Set<string>(TABLES);

export function isValidTableName(name: string): name is ExportTableName {
  return TABLE_SET.has(name);
}

// ─── Manifest ────────────────────────────────────────────────────────────────

interface ExportManifest {
  exportVersion: string;
  appVersion: string;
  exportedAt: string;
  tables: string[];
}

// ─── ZIP builder (pure Node.js, no external deps) ────────────────────────────

interface ZipFile {
  name: string;
  data: Buffer;
}

function buildZip(files: ZipFile[]): Buffer {
  const parts: Buffer[] = [];
  const cdEntries: Buffer[] = [];
  let localOffset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const compressed = deflateRawSync(file.data, { level: 6 });
    const checksum = crc32(file.data) as number;

    // Local file header: signature + 28 bytes of fields + filename
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);         // signature
    local.writeUInt16LE(20, 4);                  // version needed: 2.0
    local.writeUInt16LE(0, 6);                   // general purpose flags
    local.writeUInt16LE(8, 8);                   // compression: deflate
    local.writeUInt16LE(0, 10);                  // last mod time
    local.writeUInt16LE(0, 12);                  // last mod date
    local.writeUInt32LE(checksum, 14);           // CRC-32
    local.writeUInt32LE(compressed.length, 18);  // compressed size
    local.writeUInt32LE(file.data.length, 22);   // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);   // filename length
    local.writeUInt16LE(0, 28);                  // extra field length
    nameBytes.copy(local, 30);

    // Central directory entry
    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);             // signature
    cd.writeUInt16LE(20, 4);                     // version made by
    cd.writeUInt16LE(20, 6);                     // version needed
    cd.writeUInt16LE(0, 8);                      // general purpose flags
    cd.writeUInt16LE(8, 10);                     // compression: deflate
    cd.writeUInt16LE(0, 12);                     // last mod time
    cd.writeUInt16LE(0, 14);                     // last mod date
    cd.writeUInt32LE(checksum, 16);              // CRC-32
    cd.writeUInt32LE(compressed.length, 20);     // compressed size
    cd.writeUInt32LE(file.data.length, 24);      // uncompressed size
    cd.writeUInt16LE(nameBytes.length, 28);      // filename length
    cd.writeUInt16LE(0, 30);                     // extra field length
    cd.writeUInt16LE(0, 32);                     // file comment length
    cd.writeUInt16LE(0, 34);                     // disk number start
    cd.writeUInt16LE(0, 36);                     // internal attributes
    cd.writeUInt32LE(0, 38);                     // external attributes
    cd.writeUInt32LE(localOffset, 42);           // local header offset
    nameBytes.copy(cd, 46);

    parts.push(local, compressed);
    cdEntries.push(cd);
    localOffset += local.length + compressed.length;
  }

  const cdBuf = Buffer.concat(cdEntries);
  const cdOffset = localOffset;

  // End of central directory record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);             // signature
  eocd.writeUInt16LE(0, 4);                       // disk number
  eocd.writeUInt16LE(0, 6);                       // start disk number
  eocd.writeUInt16LE(files.length, 8);            // entries on this disk
  eocd.writeUInt16LE(files.length, 10);           // total entries
  eocd.writeUInt32LE(cdBuf.length, 12);           // central directory size
  eocd.writeUInt32LE(cdOffset, 16);               // central directory offset
  eocd.writeUInt16LE(0, 20);                      // comment length

  return Buffer.concat([...parts, cdBuf, eocd]);
}

// ─── ZIP parser ───────────────────────────────────────────────────────────────

function parseZip(buf: Buffer): ZipFile[] {
  // Locate EOCD by scanning backward (max comment length = 65535 + 22 bytes)
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Invalid ZIP archive: EOCD record not found');

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  let cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const files: ZipFile[] = [];

  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) {
      throw new Error('Invalid ZIP archive: central directory signature mismatch');
    }
    const compressionMethod = buf.readUInt16LE(cdOffset + 10);
    const filenameLen = buf.readUInt16LE(cdOffset + 28);
    const extraLen = buf.readUInt16LE(cdOffset + 30);
    const commentLen = buf.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = buf.readUInt32LE(cdOffset + 42);
    const name = buf.subarray(cdOffset + 46, cdOffset + 46 + filenameLen).toString('utf8');

    // Parse local file header to find actual data offset
    if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error('Invalid ZIP archive: local file header signature mismatch');
    }
    const compressedSize = buf.readUInt32LE(localHeaderOffset + 18);
    const localFilenameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFilenameLen + localExtraLen;

    const compressedData = buf.subarray(dataOffset, dataOffset + compressedSize);

    const data: Buffer =
      compressionMethod === 0 ? Buffer.from(compressedData) :
      compressionMethod === 8 ? inflateRawSync(compressedData) :
      (() => { throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`); })();

    files.push({ name, data });
    cdOffset += 46 + filenameLen + extraLen + commentLen;
  }

  return files;
}

// ─── Table helpers ────────────────────────────────────────────────────────────

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName) as { cnt: number };
  return row.cnt > 0;
}

function exportTableRows(db: Database.Database, tableName: string): Record<string, unknown>[] {
  if (!tableExists(db, tableName)) return [];
  return db.prepare(`SELECT * FROM ${tableName}`).all() as Record<string, unknown>[];
}

// ─── Public export API ────────────────────────────────────────────────────────

/**
 * Build a ZIP archive containing all table data as deflate-compressed JSON files.
 * Returns a Buffer suitable for streaming as a download.
 */
export function buildExportZip(db: Database.Database): Buffer {
  const files: ZipFile[] = [];

  for (const table of TABLES) {
    const rows = exportTableRows(db, table);
    files.push({
      name: `${table}.json`,
      data: Buffer.from(JSON.stringify(rows, null, 2)),
    });
  }

  const manifest: ExportManifest = {
    exportVersion: EXPORT_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    tables: [...TABLES],
  };
  files.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) });

  return buildZip(files);
}

/**
 * Export all tables as a single JSON object.
 */
export function buildExportJson(db: Database.Database): string {
  const tables: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    tables[table] = exportTableRows(db, table);
  }
  return JSON.stringify({
    manifest: {
      exportVersion: EXPORT_VERSION,
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      tables: [...TABLES],
    },
    tables,
  }, null, 2);
}

/**
 * Export a single table as CSV. Returns an empty string if the table is empty.
 */
export function buildExportCsv(db: Database.Database, tableName: ExportTableName): string {
  const rows = exportTableRows(db, tableName);
  if (rows.length === 0) return '';

  const headers = Object.keys(rows[0] ?? {});
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

/**
 * Export all tables as a Markdown document (max 50 rows per table for readability).
 */
export function buildExportMarkdown(db: Database.Database): string {
  const lines = [
    `# Jowork Data Export`,
    ``,
    `Exported: ${new Date().toISOString()}`,
    ``,
  ];

  for (const table of TABLES) {
    const rows = exportTableRows(db, table);
    lines.push(`## ${table}`, ``, `*${rows.length} rows*`, ``);

    if (rows.length > 0 && rows[0]) {
      const headers = Object.keys(rows[0]);
      lines.push(`| ${headers.join(' | ')} |`);
      lines.push(`| ${headers.map(() => '---').join(' | ')} |`);

      const preview = rows.slice(0, 50);
      for (const row of preview) {
        const cells = headers.map(h => {
          const v = String(row[h] ?? '');
          return v.replace(/\|/g, '\\|').slice(0, 80);
        });
        lines.push(`| ${cells.join(' | ')} |`);
      }

      if (rows.length > 50) {
        lines.push(``, `*… and ${rows.length - 50} more rows*`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Import / Restore ─────────────────────────────────────────────────────────

export interface RestoreResult {
  tablesRestored: string[];
  rowsRestored: Record<string, number>;
  migrationsApplied: string[];
}

/**
 * Restore all tables from a ZIP export buffer.
 *
 * Steps:
 *   1. Parse and validate the ZIP (manifest version check)
 *   2. Restore all tables inside a single transaction (FK enforcement disabled during restore)
 *   3. Run pending migrations to bring schema up to date
 */
export async function restoreFromZip(
  db: Database.Database,
  buf: Buffer,
  dataDir: string,
): Promise<RestoreResult> {
  const files = parseZip(buf);

  const manifestFile = files.find(f => f.name === 'manifest.json');
  if (!manifestFile) throw new Error('Invalid export archive: manifest.json not found');

  const manifest = JSON.parse(manifestFile.data.toString('utf8')) as ExportManifest;
  if (manifest.exportVersion !== EXPORT_VERSION) {
    throw new Error(
      `Export version mismatch: expected ${EXPORT_VERSION}, got ${manifest.exportVersion}`,
    );
  }

  // Build table → rows map from ZIP files
  const tableData = new Map<string, Record<string, unknown>[]>();
  for (const file of files) {
    if (file.name === 'manifest.json') continue;
    const tableName = file.name.replace(/\.json$/, '');
    tableData.set(tableName, JSON.parse(file.data.toString('utf8')) as Record<string, unknown>[]);
  }

  const rowsRestored: Record<string, number> = {};

  // Restore in FK-safe order, inside one transaction
  db.transaction(() => {
    db.pragma('foreign_keys = OFF');

    for (const table of TABLES) {
      if (!tableExists(db, table)) {
        rowsRestored[table] = 0;
        continue;
      }

      const rows = tableData.get(table) ?? [];
      db.prepare(`DELETE FROM ${table}`).run();

      if (rows.length === 0) {
        rowsRestored[table] = 0;
        continue;
      }

      const cols = Object.keys(rows[0] ?? {});
      if (cols.length === 0) { rowsRestored[table] = 0; continue; }

      const stmt = db.prepare(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(c => `@${c}`).join(', ')})`,
      );
      for (const row of rows) {
        stmt.run(row as Record<string, unknown>);
      }
      rowsRestored[table] = rows.length;
    }

    db.pragma('foreign_keys = ON');
  })();

  // Run any pending migrations after restore
  const { applied: migrationsApplied } = await migrate(db, { dataDir });

  logger.info('Restore complete', { rowsRestored, migrationsApplied });

  return {
    tablesRestored: TABLES.filter(t => (rowsRestored[t] ?? 0) >= 0),
    rowsRestored,
    migrationsApplied,
  };
}
