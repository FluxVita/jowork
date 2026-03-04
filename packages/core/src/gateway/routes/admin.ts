// @jowork/core/gateway/routes — admin endpoints
//
// GET  /api/admin/updates/check   — check GitHub Releases for newer version
// GET  /api/admin/migrations      — list applied / pending migrations
// POST /api/admin/backup          — trigger manual DB backup

import { Router } from 'express';
import { get as httpsGet } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { getDb } from '../../datamap/db.js';
import { listMigrations, backupDb } from '../../datamap/migrator.js';
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

  return router;
}
