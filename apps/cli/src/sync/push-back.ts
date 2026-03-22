/**
 * Push-back — detects local file edits (via git diff) and pushes changes
 * back to source APIs (GitHub, GitLab, Linear).
 *
 * Design: parse file path → determine source + type + id → read file content
 * → extract frontmatter + body → PATCH the API.
 */

import { GitManager } from './git-manager.js';
import { loadCredential } from '../connectors/credential-store.js';
import { logInfo, logError } from '../utils/logger.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PushResult {
  source: string;
  file: string;
  success: boolean;
  message: string;
}

interface ParsedFile {
  source: 'github' | 'gitlab' | 'linear';
  type: string;
  id: string;
  /** Slugified repo name (e.g. "FluxVita-jowork") — needs un-slugification for API calls */
  repoSlug?: string;
}

/**
 * Parse a relative file path from the data repo to determine its source, type, and id.
 * Must match the paths produced by FileWriter.getFilePath().
 */
function parseFilePath(filePath: string): ParsedFile | null {
  // github/<slug>/issues/<number>.md  or  github/<slug>/pulls/<number>.md
  const githubMatch = filePath.match(
    /^github\/([^/]+)\/(issues|pulls)\/(\d+)\.md$/,
  );
  if (githubMatch) {
    return {
      source: 'github',
      type: githubMatch[2] === 'pulls' ? 'pull_request' : 'issue',
      id: githubMatch[3],
      repoSlug: githubMatch[1],
    };
  }

  // gitlab/<slug>/issues/<number>.md  or  gitlab/<slug>/merge-requests/<number>.md
  const gitlabMatch = filePath.match(
    /^gitlab\/([^/]+)\/(issues|merge-requests)\/(\d+)\.md$/,
  );
  if (gitlabMatch) {
    return {
      source: 'gitlab',
      type: gitlabMatch[2] === 'merge-requests' ? 'merge_request' : 'issue',
      id: gitlabMatch[3],
      repoSlug: gitlabMatch[1],
    };
  }

  // linear/issues/<IDENTIFIER>.md  (e.g. LIN-234)
  const linearMatch = filePath.match(/^linear\/issues\/([A-Z]+-\d+)\.md$/);
  if (linearMatch) {
    return { source: 'linear', type: 'issue', id: linearMatch[1] };
  }

  return null; // Not a pushable file (feishu messages, posthog, etc.)
}

/** Parse YAML frontmatter from a markdown file */
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, unknown> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let val = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    // Parse arrays like [bug, P1]
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1);
      fm[key] = val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      fm[key] = val;
    }
  }
  return fm;
}

/** Get body content (everything after frontmatter) */
function getBody(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*)$/);
  return match ? match[1].trim() : content.trim();
}

/**
 * Extract the title from the first heading line.
 * Format produced by formatIssue: `# repo#42: Title text`
 */
function extractTitle(body: string): string | undefined {
  const match = body.match(/^# .+#\d+:\s*(.+)$/m);
  return match ? match[1].trim() : undefined;
}

/** Extract description (body text after the first heading) */
function extractDescription(body: string): string {
  return body.replace(/^# .+\n\n?/, '').trim();
}

/** Detect local changes and push them back to source APIs */
export async function pushChanges(repoDir: string): Promise<PushResult[]> {
  const gm = new GitManager(repoDir);
  const status = await gm.getStatus();
  const results: PushResult[] = [];

  // Only modified files are pushable — new files (created) are from sync, not user edits.
  // Deleted files shouldn't trigger API calls either.
  const modifiedFiles = status.modified;

  for (const file of modifiedFiles) {
    const parsed = parseFilePath(file);
    if (!parsed) continue;

    const content = readFileSync(join(repoDir, file), 'utf-8');
    const fm = parseFrontmatter(content);
    const body = getBody(content);

    try {
      switch (parsed.source) {
        case 'github': {
          const result = await pushGitHub(parsed, fm, body, file);
          results.push(result);
          break;
        }

        case 'gitlab': {
          const result = await pushGitLab(parsed, fm, body, file);
          results.push(result);
          break;
        }

        case 'linear': {
          const result = await pushLinear(parsed, fm, body, file);
          results.push(result);
          break;
        }
      }
    } catch (err) {
      results.push({
        source: parsed.source,
        file,
        success: false,
        message: String(err),
      });
      logError('push', `Push failed: ${file}`, { error: String(err) });
    }
  }

  return results;
}

async function pushGitHub(
  parsed: ParsedFile,
  fm: Record<string, unknown>,
  body: string,
  file: string,
): Promise<PushResult> {
  const cred = loadCredential('github');
  if (!cred) {
    return {
      source: 'github',
      file,
      success: false,
      message: 'No GitHub credentials',
    };
  }

  // Resolve repo: frontmatter `repo` field has the real owner/name
  const repo = (fm.repo as string) ?? undefined;
  if (!repo) {
    return {
      source: 'github',
      file,
      success: false,
      message: 'Cannot determine repo from frontmatter',
    };
  }

  const headers = {
    Authorization: `Bearer ${cred.data.token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'jowork/0.1.0',
    'Content-Type': 'application/json',
  };

  const title = extractTitle(body);
  const description = extractDescription(body);

  const updateBody: Record<string, unknown> = {};
  if (title) updateBody.title = title;
  if (description) updateBody.body = description;
  if (fm.state) updateBody.state = fm.state;
  if (fm.labels) updateBody.labels = fm.labels;

  const endpoint =
    parsed.type === 'pull_request'
      ? `https://api.github.com/repos/${repo}/pulls/${parsed.id}`
      : `https://api.github.com/repos/${repo}/issues/${parsed.id}`;

  const res = await fetch(endpoint, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(updateBody),
  });

  if (res.ok) {
    logInfo('push', `Pushed to GitHub: ${repo}#${parsed.id}`);
    return {
      source: 'github',
      file,
      success: true,
      message: `Updated ${repo}#${parsed.id}`,
    };
  } else {
    const errBody = await res.text().catch(() => '');
    return {
      source: 'github',
      file,
      success: false,
      message: `API ${res.status}: ${errBody.slice(0, 200)}`,
    };
  }
}

async function pushGitLab(
  parsed: ParsedFile,
  fm: Record<string, unknown>,
  body: string,
  file: string,
): Promise<PushResult> {
  const cred = loadCredential('gitlab');
  if (!cred) {
    return {
      source: 'gitlab',
      file,
      success: false,
      message: 'No GitLab credentials',
    };
  }

  const repo = (fm.repo as string) ?? undefined;
  if (!repo) {
    return {
      source: 'gitlab',
      file,
      success: false,
      message: 'Cannot determine project from frontmatter',
    };
  }

  const baseUrl = cred.data.url ?? 'https://gitlab.com';
  const headers = {
    'PRIVATE-TOKEN': cred.data.token,
    'Content-Type': 'application/json',
  };

  const title = extractTitle(body);
  const description = extractDescription(body);
  const encodedProject = encodeURIComponent(repo);

  const updateBody: Record<string, unknown> = {};
  if (title) updateBody.title = title;
  if (description) updateBody.description = description;
  if (fm.state) {
    // GitLab uses state_event: "close" | "reopen"
    updateBody.state_event = fm.state === 'closed' ? 'close' : 'reopen';
  }
  if (fm.labels) {
    updateBody.labels = Array.isArray(fm.labels)
      ? (fm.labels as string[]).join(',')
      : fm.labels;
  }

  const endpoint =
    parsed.type === 'merge_request'
      ? `${baseUrl}/api/v4/projects/${encodedProject}/merge_requests/${parsed.id}`
      : `${baseUrl}/api/v4/projects/${encodedProject}/issues/${parsed.id}`;

  const res = await fetch(endpoint, {
    method: 'PUT',
    headers,
    body: JSON.stringify(updateBody),
  });

  if (res.ok) {
    logInfo('push', `Pushed to GitLab: ${repo}#${parsed.id}`);
    return {
      source: 'gitlab',
      file,
      success: true,
      message: `Updated ${repo}#${parsed.id}`,
    };
  } else {
    const errBody = await res.text().catch(() => '');
    return {
      source: 'gitlab',
      file,
      success: false,
      message: `API ${res.status}: ${errBody.slice(0, 200)}`,
    };
  }
}

async function pushLinear(
  parsed: ParsedFile,
  fm: Record<string, unknown>,
  _body: string,
  file: string,
): Promise<PushResult> {
  const cred = loadCredential('linear');
  if (!cred) {
    return {
      source: 'linear',
      file,
      success: false,
      message: 'No Linear credentials',
    };
  }

  // Linear requires the internal UUID, which should be in frontmatter `uri`
  const uri = fm.uri as string | undefined;
  if (!uri) {
    return {
      source: 'linear',
      file,
      success: false,
      message: 'No Linear issue URI in frontmatter',
    };
  }

  // Extract UUID from URI like "linear://issue/<uuid>"
  const uuidMatch = uri.match(
    /linear:\/\/issue\/([0-9a-f-]{36})/i,
  );
  const issueId = uuidMatch?.[1];
  if (!issueId) {
    return {
      source: 'linear',
      file,
      success: false,
      message: `Cannot extract Linear issue UUID from uri: ${uri}`,
    };
  }

  // Build input fields from frontmatter changes
  const inputFields: string[] = [];
  if (fm.title && typeof fm.title === 'string') {
    inputFields.push(`title: ${JSON.stringify(fm.title)}`);
  }
  if (fm.state && typeof fm.state === 'string') {
    // Note: Linear state update requires stateId, not state name.
    // We can't reliably map state names without querying workflow states first.
    // For now we log a warning and skip state updates.
    logInfo(
      'push',
      `Linear state change requested (${fm.state}) — skipping (requires stateId lookup)`,
    );
  }

  if (inputFields.length === 0) {
    return {
      source: 'linear',
      file,
      success: false,
      message: 'No pushable field changes detected',
    };
  }

  const mutation = `mutation { issueUpdate(id: "${issueId}", input: { ${inputFields.join(', ')} }) { success issue { identifier } } }`;

  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: cred.data.apiKey,
    },
    body: JSON.stringify({ query: mutation }),
  });

  if (res.ok) {
    const data = (await res.json()) as {
      data?: { issueUpdate?: { success: boolean } };
    };
    if (data.data?.issueUpdate?.success) {
      logInfo('push', `Pushed to Linear: ${parsed.id}`);
      return {
        source: 'linear',
        file,
        success: true,
        message: `Updated ${parsed.id}`,
      };
    }
    return {
      source: 'linear',
      file,
      success: false,
      message: 'Linear mutation returned success=false',
    };
  } else {
    return {
      source: 'linear',
      file,
      success: false,
      message: `API ${res.status}`,
    };
  }
}
