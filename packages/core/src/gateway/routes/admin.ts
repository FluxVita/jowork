// @jowork/core/gateway/routes — admin endpoints
//
// GET  /api/admin/updates/check      — check GitHub Releases for newer version
// GET  /api/admin/migrations         — list applied / pending migrations
// POST /api/admin/backup             — trigger manual DB backup
// GET  /api/admin/export             — stream full ZIP backup download
// GET  /api/admin/export/json        — full JSON export
// GET  /api/admin/export/csv/:table  — single-table CSV export
// GET  /api/admin/export/markdown    — human-readable Markdown export
// POST /api/admin/import             — restore from uploaded ZIP buffer

import express, { Router } from 'express';
import { get as httpsGet } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { getDb } from '../../datamap/db.js';
import { listMigrations, backupDb } from '../../datamap/migrator.js';
import {
  buildExportZip,
  buildExportJson,
  buildExportCsv,
  buildExportMarkdown,
  restoreFromZip,
  isValidTableName,
} from '../../datamap/export.js';
import { config } from '../../config.js';
import { logger } from '../../utils/index.js';

const CURRENT_VERSION = '0.1.0';
const GITHUB_RELEASES_API = 'https://api.github.com/repos/fluxvita/jowork/releases/latest';

// ─── Version comparison (semver: major.minor.patch) ──────────────────────────

function parseSemver(v: string): [number, number, number] {
  const clean = v.replace(/^v/, '');
  const parts = clean.split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function isNewer(remote: string, local: string): boolean {
  const [rM, rm, rp] = parseSemver(remote);
  const [lM, lm, lp] = parseSemver(local);
  if (rM !== lM) return rM > lM;
  if (rm !== lm) return rm > lm;
  return rp > lp;
}

// ─── GitHub API fetch ─────────────────────────────────────────────────────────

interface GithubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  body: string;
  published_at: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

function fetchLatestRelease(): Promise<GithubRelease> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      GITHUB_RELEASES_API,
      {
        headers: {
          'User-Agent': `jowork/${CURRENT_VERSION}`,
          'Accept': 'application/vnd.github+json',
        },
      },
      (res: IncomingMessage) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`GitHub API returned ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as GithubRelease);
          } catch {
            reject(new Error('Failed to parse GitHub release JSON'));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(8_000, () => { req.destroy(new Error('GitHub API timeout')); });
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function adminRouter(): Router {
  const router = Router();

  // GET /api/admin/updates/check
  // Returns whether a newer version is available on GitHub Releases.
  // Used by Tauri Updater and the admin UI.
  router.get('/api/admin/updates/check', (_req, res, next) => {
    fetchLatestRelease()
      .then(release => {
        const remoteVersion = release.tag_name.replace(/^v/, '');
        const hasUpdate = isNewer(remoteVersion, CURRENT_VERSION);
        res.json({
          currentVersion: CURRENT_VERSION,
          latestVersion: remoteVersion,
          hasUpdate,
          releaseUrl: release.html_url,
          releaseName: release.name,
          publishedAt: release.published_at,
          // Platform-specific download URLs (empty until assets are published)
          assets: release.assets.map(a => ({
            name: a.name,
            url: a.browser_download_url,
          })),
        });
      })
      .catch((err: Error) => {
        logger.warn('Update check failed', { err: err.message });
        // Return degraded response instead of 500 (network may be offline)
        res.json({
          currentVersion: CURRENT_VERSION,
          latestVersion: null,
          hasUpdate: false,
          error: err.message,
        });
      });
  });

  // GET /api/admin/migrations
  // Lists applied and pending migrations. Useful for debugging.
  router.get('/api/admin/migrations', (_req, res, next) => {
    try {
      const db = getDb();
      const migrations = listMigrations(db);
      res.json({ migrations });
    } catch (err) { next(err); }
  });

  // POST /api/admin/backup
  // Triggers a manual hot-backup of the SQLite database.
  router.post('/api/admin/backup', (_req, res, next) => {
    backupDb(getDb(), config.dataDir)
      .then(path => res.json({ ok: true, path }))
      .catch(next);
  });

  // GET /api/admin/export
  // Streams a full ZIP archive containing all table data.
  router.get('/api/admin/export', (_req, res, next) => {
    try {
      const zip = buildExportZip(getDb());
      const filename = `jowork-export-${new Date().toISOString().slice(0, 10)}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', String(zip.length));
      res.end(zip);
    } catch (err) { next(err); }
  });

  // GET /api/admin/export/json
  // Returns all table data as a single JSON object.
  router.get('/api/admin/export/json', (_req, res, next) => {
    try {
      const json = buildExportJson(getDb());
      const filename = `jowork-export-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.end(json);
    } catch (err) { next(err); }
  });

  // GET /api/admin/export/csv/:table
  // Returns a single table as CSV.
  router.get('/api/admin/export/csv/:table', (req, res, next) => {
    try {
      const { table } = req.params as { table: string };
      if (!isValidTableName(table)) {
        res.status(400).json({ error: `Unknown table: ${table}` });
        return;
      }
      const csv = buildExportCsv(getDb(), table);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${table}.csv"`);
      res.end(csv);
    } catch (err) { next(err); }
  });

  // GET /api/admin/export/markdown
  // Returns all tables as a human-readable Markdown document.
  router.get('/api/admin/export/markdown', (_req, res, next) => {
    try {
      const md = buildExportMarkdown(getDb());
      const filename = `jowork-export-${new Date().toISOString().slice(0, 10)}.md`;
      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.end(md);
    } catch (err) { next(err); }
  });

  // POST /api/admin/import
  // Restore from a ZIP export. Body must be raw ZIP bytes (Content-Type: application/zip).
  // Also accepts multipart uploads via ?source=body (raw buffer in req.body after express.raw).
  router.post('/api/admin/import', express.raw({ type: 'application/zip', limit: '100mb' }), (req, res, next) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Request body must be a non-empty ZIP buffer (Content-Type: application/zip)' });
      return;
    }
    restoreFromZip(getDb(), req.body as Buffer, config.dataDir)
      .then(result => res.json({ ok: true, ...result }))
      .catch(next);
  });

  return router;
}
