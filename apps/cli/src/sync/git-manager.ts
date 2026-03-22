import simpleGit, { type SimpleGit } from 'simple-git';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logInfo } from '../utils/logger.js';

export interface SyncSummary {
  timestamp: string;
  sources: Array<{ source: string; newObjects: number; label?: string }>;
}

export class GitManager {
  private git: SimpleGit;
  private repoDir: string;

  constructor(repoDir: string) {
    this.repoDir = repoDir;
    this.git = simpleGit(repoDir);
  }

  /** Initialize git repo if not already initialized */
  async init(): Promise<void> {
    const gitDir = join(this.repoDir, '.git');
    if (existsSync(gitDir)) return;

    await this.git.init();

    // Create .gitignore
    const gitignore = [
      '# JoWork — auto-generated',
      '*.db', '*.db-wal', '*.db-shm',
      '.DS_Store', 'Thumbs.db',
      '*.key', '*.pem', '*.env',
      'credentials/',
      '',
    ].join('\n');
    writeFileSync(join(this.repoDir, '.gitignore'), gitignore);

    // Initial commit
    await this.git.add('-A');
    await this.git.commit('init: jowork data repo');
    logInfo('git', 'Initialized data repo');
  }

  /** Commit all changes after a sync cycle */
  async commitSync(summary: SyncSummary): Promise<string | null> {
    // Stage all changes
    await this.git.add('-A');

    // Check if there are staged changes
    const status = await this.git.status();
    if (
      status.staged.length === 0 &&
      status.created.length === 0 &&
      status.modified.length === 0 &&
      status.deleted.length === 0
    ) {
      return null; // Nothing to commit
    }

    // Build commit message
    const lines: string[] = [`sync: ${summary.timestamp}`, ''];
    for (const s of summary.sources) {
      if (s.newObjects > 0) {
        lines.push(`${s.source}: +${s.newObjects} ${s.label ?? 'objects'}`);
      }
    }
    if (lines.length === 2) lines.push('(no new data)');

    const result = await this.git.commit(lines.join('\n'));
    const sha = result.commit;
    logInfo('git', `Committed sync: ${sha}`, {
      files: status.staged.length + status.created.length,
    });
    return sha;
  }

  /** Get recent sync log entries */
  async getLog(
    limit: number = 20,
  ): Promise<Array<{ hash: string; date: string; message: string }>> {
    const log = await this.git.log({ maxCount: limit });
    return log.all.map((entry) => ({
      hash: entry.hash.slice(0, 7),
      date: entry.date,
      message: entry.message.split('\n')[0],
    }));
  }

  /** Get current status (changed files) */
  async getStatus(): Promise<{
    modified: string[];
    created: string[];
    deleted: string[];
  }> {
    const status = await this.git.status();
    return {
      modified: status.modified,
      created: status.created,
      deleted: status.deleted,
    };
  }
}
