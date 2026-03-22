/**
 * Format functions for each data type — produce markdown/JSON content for file-repo files.
 */

/** Format chat messages grouped by day into a single markdown file. */
export function formatMessages(
  chatName: string,
  chatId: string,
  date: string,
  messages: Array<{ time: string; sender: string; content: string }>,
): string {
  const frontmatter = `---\nsource: feishu\ntype: messages\nchat: ${chatName}\nchat_id: ${chatId}\ndate: ${date}\n---\n\n`;
  const body = messages
    .map((m) => `## ${m.time} — ${m.sender}\n${m.content}`)
    .join('\n\n');
  return frontmatter + body + '\n';
}

/** Format a GitHub/GitLab/Linear issue or PR as markdown with YAML frontmatter. */
export function formatIssue(opts: {
  source: string;
  repo: string;
  number: number;
  title: string;
  state: string;
  author: string;
  labels: string[];
  created: string;
  uri: string;
  body: string;
}): string {
  return [
    '---',
    `source: ${opts.source}`,
    `type: issue`,
    `repo: ${opts.repo}`,
    `number: ${opts.number}`,
    `state: ${opts.state}`,
    `author: ${opts.author}`,
    `labels: [${opts.labels.join(', ')}]`,
    `created: ${opts.created}`,
    `uri: ${opts.uri}`,
    '---',
    '',
    `# ${opts.repo}#${opts.number}: ${opts.title}`,
    '',
    opts.body || '(no description)',
    '',
  ].join('\n');
}

/** Format a merge request / PR as markdown with YAML frontmatter. */
export function formatPullRequest(opts: {
  source: string;
  repo: string;
  number: number;
  title: string;
  state: string;
  author: string;
  labels: string[];
  created: string;
  uri: string;
  body: string;
  sourceBranch?: string;
  targetBranch?: string;
}): string {
  const branchLine =
    opts.sourceBranch && opts.targetBranch
      ? `branch: ${opts.sourceBranch} -> ${opts.targetBranch}\n`
      : '';
  return [
    '---',
    `source: ${opts.source}`,
    `type: pull_request`,
    `repo: ${opts.repo}`,
    `number: ${opts.number}`,
    `state: ${opts.state}`,
    `author: ${opts.author}`,
    `labels: [${opts.labels.join(', ')}]`,
    `created: ${opts.created}`,
    `uri: ${opts.uri}`,
    branchLine ? `${branchLine.trim()}` : null,
    '---',
    '',
    `# ${opts.repo}#${opts.number}: ${opts.title}`,
    '',
    opts.body || '(no description)',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/** Format a calendar event as markdown. */
export function formatCalendarEvent(opts: {
  source: string;
  title: string;
  startTime: string;
  endTime: string;
  attendees: string[];
  description: string;
  uri: string;
}): string {
  return [
    '---',
    `source: ${opts.source}`,
    `type: calendar_event`,
    `title: ${opts.title}`,
    `start: ${opts.startTime}`,
    `end: ${opts.endTime}`,
    `attendees: [${opts.attendees.join(', ')}]`,
    `uri: ${opts.uri}`,
    '---',
    '',
    `# ${opts.title}`,
    '',
    `**Time:** ${opts.startTime} — ${opts.endTime}`,
    `**Attendees:** ${opts.attendees.join(', ') || 'none'}`,
    '',
    opts.description || '(no description)',
    '',
  ].join('\n');
}

/** Format an approval as markdown with a table of fields. */
export function formatApproval(opts: {
  source: string;
  name: string;
  status: string;
  submitter: string;
  fields: Array<{ name: string; value: string }>;
  uri: string;
}): string {
  const fieldRows = opts.fields
    .map((f) => `| ${f.name} | ${f.value} |`)
    .join('\n');
  const table =
    opts.fields.length > 0
      ? `| Field | Value |\n|-------|-------|\n${fieldRows}\n`
      : '';
  return [
    '---',
    `source: ${opts.source}`,
    `type: approval`,
    `name: ${opts.name}`,
    `status: ${opts.status}`,
    `submitter: ${opts.submitter}`,
    `uri: ${opts.uri}`,
    '---',
    '',
    `# ${opts.name}`,
    '',
    `**Status:** ${opts.status}`,
    `**Submitter:** ${opts.submitter}`,
    '',
    table,
    '',
  ].join('\n');
}

/** Format a document as markdown. */
export function formatDocument(opts: {
  source: string;
  title: string;
  uri: string;
  body: string;
}): string {
  return [
    '---',
    `source: ${opts.source}`,
    `type: document`,
    `title: ${opts.title}`,
    `uri: ${opts.uri}`,
    '---',
    '',
    `# ${opts.title}`,
    '',
    opts.body || '(no content)',
    '',
  ].join('\n');
}

/** Format analytics/metrics data as JSON. */
export function formatAnalytics(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2) + '\n';
}
