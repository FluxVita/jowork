import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { DbManager } from '../db/manager.js';
import { dbPath, fileRepoDir } from '../utils/paths.js';
import { loadCredential, listCredentials } from '../connectors/credential-store.js';
import { logError } from '../utils/logger.js';
import { linkAllUnprocessed } from '../sync/linker.js';
import { syncFeishu, syncFeishuMeetings, syncFeishuDocs, syncFeishuApprovals } from '../sync/feishu.js';
import { syncGitHub } from '../sync/github.js';
import { syncGitLab } from '../sync/gitlab.js';
import { syncLinear } from '../sync/linear.js';
import { syncPostHog } from '../sync/posthog.js';
import { syncFirebase } from '../sync/firebase.js';
import { FileWriter } from '../sync/file-writer.js';
import { GitManager, type SyncSummary } from '../sync/git-manager.js';

// ── Visual output helpers ──────────────────────────────────────────

const isTTY = process.stdout.isTTY;

const c = {
  reset: isTTY ? '\x1b[0m' : '',
  bold: isTTY ? '\x1b[1m' : '',
  dim: isTTY ? '\x1b[2m' : '',
  green: isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  red: isTTY ? '\x1b[31m' : '',
  cyan: isTTY ? '\x1b[36m' : '',
  gray: isTTY ? '\x1b[90m' : '',
  white: isTTY ? '\x1b[37m' : '',
  bgGreen: isTTY ? '\x1b[42m' : '',
  bgRed: isTTY ? '\x1b[41m' : '',
  bgYellow: isTTY ? '\x1b[43m' : '',
};

const icon = {
  ok: `${c.green}✓${c.reset}`,
  warn: `${c.yellow}⚠${c.reset}`,
  fail: `${c.red}✗${c.reset}`,
  skip: `${c.gray}○${c.reset}`,
  sync: `${c.cyan}↻${c.reset}`,
  link: `${c.cyan}⟡${c.reset}`,
  git: `${c.gray}⎇${c.reset}`,
};

function header(text: string): void {
  console.log('');
  console.log(`  ${c.bold}${text}${c.reset}`);
  console.log(`  ${c.dim}${'─'.repeat(Math.min(text.length + 4, 50))}${c.reset}`);
}

function progressBar(current: number, total: number, width = 20): string {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const bar = `${c.green}${'█'.repeat(filled)}${c.gray}${'░'.repeat(empty)}${c.reset}`;
  return `${bar} ${c.dim}${current}/${total}${c.reset}`;
}

function sourceLabel(name: string): string {
  const colors: Record<string, string> = {
    feishu: c.cyan,
    github: c.white,
    gitlab: c.yellow,
    linear: c.cyan,
    posthog: c.red,
    firebase: c.yellow,
  };
  return `${colors[name] ?? c.white}${c.bold}${name}${c.reset}`;
}

function resultLine(ok: boolean, msg: string): void {
  console.log(`    ${ok ? icon.ok : icon.warn} ${msg}`);
}

function elapsed(start: number): string {
  const ms = Date.now() - start;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ── Core sync logic ──────────────────────────────────────────────

/**
 * Core sync logic — callable from both the CLI command and the setup wizard.
 */
export async function runSync(sources: string[]): Promise<void> {
  const db = new DbManager(dbPath());
  db.ensureTables();
  const fileWriter = new FileWriter();
  const syncResults: SyncSummary['sources'] = [];
  const t0 = Date.now();
  let totalNew = 0;

  // Initialize git repo
  let gitManager: GitManager | null = null;
  try {
    gitManager = new GitManager(fileRepoDir());
    await gitManager.init();
  } catch { /* Git not available */ }

  header(`Syncing ${sources.length} source${sources.length > 1 ? 's' : ''}`);

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const cred = loadCredential(source);
    if (!cred) {
      console.log(`  ${icon.skip} ${sourceLabel(source)} ${c.dim}no credentials, skipping${c.reset}`);
      continue;
    }

    const sourceStart = Date.now();
    console.log(`  ${icon.sync} ${sourceLabel(source)} ${c.dim}syncing...${c.reset}`);

    const logger = {
      info: (_msg: string) => { /* suppress during visual mode */ },
      warn: (msg: string) => resultLine(false, `${c.dim}${msg}${c.reset}`),
      error: (msg: string) => console.error(`    ${icon.fail} ${c.red}${msg}${c.reset}`),
    };

    try {
      switch (source) {
        case 'feishu': {
          const result = await syncFeishu(db.getSqlite(), cred.data, logger, fileWriter);
          resultLine(true, `${result.newMessages} new messages from ${result.chats} chats`);
          totalNew += result.newMessages;
          syncResults.push({ source: 'feishu', newObjects: result.newMessages, label: 'messages' });

          try {
            const mr = await syncFeishuMeetings(db.getSqlite(), cred.data, logger, fileWriter);
            if (mr.newObjects > 0) resultLine(true, `${mr.newObjects} calendar events`);
            syncResults.push({ source: 'feishu/meetings', newObjects: mr.newObjects, label: 'events' });
          } catch { /* warned by logger */ }

          try {
            const dr = await syncFeishuDocs(db.getSqlite(), cred.data, logger, fileWriter);
            if (dr.newObjects > 0) resultLine(true, `${dr.newObjects} documents`);
            syncResults.push({ source: 'feishu/docs', newObjects: dr.newObjects, label: 'docs' });
          } catch { /* warned by logger */ }

          try {
            const ar = await syncFeishuApprovals(db.getSqlite(), cred.data, logger, fileWriter);
            if (ar.newObjects > 0) resultLine(true, `${ar.newObjects} approvals`);
            syncResults.push({ source: 'feishu/approvals', newObjects: ar.newObjects, label: 'approvals' });
          } catch { /* warned by logger */ }
          break;
        }
        case 'github': {
          const r = await syncGitHub(db.getSqlite(), cred.data, logger, fileWriter);
          resultLine(true, `${r.repos} repos, ${r.prs} PRs, ${r.issues} issues ${c.dim}(${r.newObjects} new)${c.reset}`);
          totalNew += r.newObjects;
          syncResults.push({ source: 'github', newObjects: r.newObjects });
          break;
        }
        case 'gitlab': {
          const r = await syncGitLab(db.getSqlite(), cred.data, logger, fileWriter);
          resultLine(true, `${r.projects} projects, ${r.mrs} MRs, ${r.issues} issues ${c.dim}(${r.newObjects} new)${c.reset}`);
          totalNew += r.newObjects;
          syncResults.push({ source: 'gitlab', newObjects: r.newObjects });
          break;
        }
        case 'linear': {
          const r = await syncLinear(db.getSqlite(), cred.data, logger, fileWriter);
          resultLine(true, `${r.issues} issues ${c.dim}(${r.newObjects} new)${c.reset}`);
          totalNew += r.newObjects;
          syncResults.push({ source: 'linear', newObjects: r.newObjects, label: 'issues' });
          break;
        }
        case 'posthog': {
          const r = await syncPostHog(db.getSqlite(), cred.data, logger, fileWriter);
          resultLine(true, `${r.insights} insights, ${r.events} events ${c.dim}(${r.newObjects} new)${c.reset}`);
          totalNew += r.newObjects;
          syncResults.push({ source: 'posthog', newObjects: r.newObjects });
          break;
        }
        case 'firebase': {
          const r = await syncFirebase(db.getSqlite(), cred.data, logger, fileWriter);
          resultLine(true, `${r.events} events ${c.dim}(${r.newObjects} new)${c.reset}`);
          totalNew += r.newObjects;
          syncResults.push({ source: 'firebase', newObjects: r.newObjects, label: 'events' });
          break;
        }
        default:
          console.log(`    ${icon.skip} ${c.dim}unknown source${c.reset}`);
      }
      console.log(`    ${c.dim}${elapsed(sourceStart)}${c.reset}`);
    } catch (err) {
      logError('sync', `Failed to sync ${source}`, { error: String(err) });
      console.log(`    ${icon.fail} ${c.red}sync failed${c.reset} ${c.dim}${String(err).slice(0, 60)}${c.reset}`);
    }

    // Show progress across sources
    if (sources.length > 1) {
      console.log(`  ${progressBar(i + 1, sources.length)}`);
    }
  }

  // Entity extraction
  console.log('');
  console.log(`  ${icon.link} ${c.dim}extracting links...${c.reset}`);
  const { processed, linksCreated } = linkAllUnprocessed(db.getSqlite());
  if (processed > 0) {
    resultLine(true, `${linksCreated} links from ${processed} objects`);
  }

  db.close();

  // Git commit
  if (gitManager) {
    try {
      const sha = await gitManager.commitSync({ timestamp: new Date().toISOString(), sources: syncResults });
      if (sha) console.log(`  ${icon.git} ${c.dim}committed ${sha.slice(0, 7)}${c.reset}`);
    } catch { /* git commit non-critical */ }
  }

  // Summary
  console.log('');
  console.log(`  ${c.bold}${c.green}Done${c.reset} ${c.dim}in ${elapsed(t0)}${c.reset}`);
  console.log(`  ${c.bold}${totalNew}${c.reset} new objects synced from ${c.bold}${syncResults.length}${c.reset} sources`);
  console.log('');
}

export function syncCommand(program: Command): void {
  program
    .command('sync')
    .description('Sync data from connected sources')
    .option('--source <source>', 'Sync specific source only')
    .action(async (opts) => {
      if (!existsSync(dbPath())) {
        console.error('Error: JoWork not initialized. Run `jowork init` first.');
        process.exit(1);
      }

      const sources = opts.source ? [opts.source] : listCredentials();

      if (sources.length === 0) {
        console.log('No data sources connected. Run `jowork connect <source>` first.');
        return;
      }

      await runSync(sources);
    });
}
