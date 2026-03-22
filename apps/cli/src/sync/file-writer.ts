/**
 * FileWriter — writes synced data to the local file repository.
 *
 * Each data source gets its own directory structure under ~/.jowork/data/repo/.
 * SQLite remains the index/search layer; files are the primary storage layer.
 */

import { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { slugify } from '../utils/slugify.js';
import { fileRepoDir } from '../utils/paths.js';
import { sanitizeContent } from './sanitizer.js';
import { formatMessages } from './formatters.js';

export interface ObjectMeta {
  id: string;
  title?: string;
  uri?: string;
  repo?: string;
  number?: number;
  identifier?: string;
  project?: string;
  date?: string;
  [key: string]: unknown;
}

export class FileWriter {
  private repoDir: string;

  constructor(repoDir?: string) {
    this.repoDir = repoDir ?? fileRepoDir();
  }

  /** Write an object to a file. Returns the relative path from repoDir. */
  writeObject(source: string, sourceType: string, meta: ObjectMeta, content: string): string {
    const filePath = this.getFilePath(source, sourceType, meta);
    const absPath = join(this.repoDir, filePath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, sanitizeContent(content));
    return filePath;
  }

  /** Append messages to a day file (for message-type sources). */
  appendMessages(
    source: string,
    chatName: string,
    chatId: string,
    date: string,
    messages: Array<{ time: string; sender: string; content: string }>,
  ): string {
    const dir = join(source, 'messages', slugify(chatName));
    const filePath = join(dir, `${date}.md`);
    const absPath = join(this.repoDir, filePath);
    mkdirSync(dirname(absPath), { recursive: true });

    // Check existing file and merge — avoid duplicates by matching headers
    let existingHeaders: string[] = [];
    if (existsSync(absPath)) {
      const existing = readFileSync(absPath, 'utf-8');
      existingHeaders = [...existing.matchAll(/^## .+/gm)].map((m) => m[0]);
    }

    // Filter out already-written messages
    const newMessages = messages.filter((m) => {
      const header = `## ${m.time} — ${m.sender}`;
      return !existingHeaders.includes(header);
    });

    if (newMessages.length === 0) return filePath;

    if (!existsSync(absPath)) {
      // Create new file with frontmatter
      writeFileSync(absPath, formatMessages(chatName, chatId, date, newMessages));
    } else {
      // Append new messages to existing file
      const appendText = newMessages
        .map((m) => `\n## ${m.time} — ${m.sender}\n${sanitizeContent(m.content)}`)
        .join('\n');
      appendFileSync(absPath, appendText + '\n');
    }

    return filePath;
  }

  /** Calculate file path for an object based on source + type. */
  getFilePath(source: string, sourceType: string, meta: ObjectMeta): string {
    switch (source) {
      case 'github':
      case 'gitlab': {
        const repo = slugify(meta.repo ?? 'unknown');
        const typeDir =
          sourceType === 'pull_request'
            ? 'pulls'
            : sourceType === 'merge_request'
              ? 'merge-requests'
              : 'issues';
        return join(source, repo, typeDir, `${meta.number ?? meta.id}.md`);
      }

      case 'linear':
        return join('linear', 'issues', `${meta.identifier ?? meta.id}.md`);

      case 'feishu': {
        if (sourceType === 'calendar_event')
          return join('feishu', 'meetings', `${meta.date}-${slugify(meta.title ?? 'event')}.md`);
        if (sourceType === 'approval')
          return join('feishu', 'approvals', `${slugify(meta.title ?? 'approval')}-${meta.id}.md`);
        if (sourceType === 'document')
          return join('feishu', 'docs', `${slugify(meta.title ?? 'doc')}.md`);
        return join('feishu', 'other', `${meta.id}.md`);
      }

      case 'posthog':
        return join(
          'posthog',
          sourceType === 'insight' ? 'insights' : 'events',
          `${slugify(meta.title ?? meta.id)}.json`,
        );

      case 'firebase':
        return join(
          'firebase',
          'analytics',
          `${slugify(meta.title ?? meta.id)}.json`,
        );

      case 'notion':
        return join('notion', 'pages', `${slugify(meta.title ?? meta.id)}.md`);

      case 'jira':
        return join('jira', slugify(meta.project ?? 'unknown'), `${meta.identifier ?? meta.id}.md`);

      case 'sentry':
        return join('sentry', 'issues', `${meta.id}.json`);

      default:
        return join(source, `${meta.id}.md`);
    }
  }

  get rootDir(): string {
    return this.repoDir;
  }
}
