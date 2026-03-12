import { readdir, readFile, stat } from 'fs/promises';
import { join, basename, extname } from 'path';
import { homedir } from 'os';
import type { Skill, SkillVariable } from './types';

/**
 * Loads skills from multiple sources:
 * 1. Claude Code commands (~/.claude/commands/)
 * 2. Claude Code skills (~/.claude/skills/)
 * 3. JoWork built-in templates
 */
export class SkillLoader {
  async loadAll(): Promise<Skill[]> {
    const results = await Promise.allSettled([
      this.loadClaudeCodeCommands(),
      this.loadClaudeCodeSkills(),
      this.loadBuiltinSkills(),
    ]);

    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }

  private async loadClaudeCodeCommands(): Promise<Skill[]> {
    const dir = join(homedir(), '.claude', 'commands');
    return this.scanMarkdownDir(dir, 'claude-code');
  }

  private async loadClaudeCodeSkills(): Promise<Skill[]> {
    const dir = join(homedir(), '.claude', 'skills');
    return this.scanMarkdownDir(dir, 'claude-code');
  }

  private async scanMarkdownDir(dir: string, source: Skill['source']): Promise<Skill[]> {
    const skills: Skill[] = [];

    try {
      const entries = await readdir(dir, { recursive: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.toString());
        const s = await stat(fullPath);
        if (!s.isFile() || extname(fullPath) !== '.md') continue;

        try {
          const content = await readFile(fullPath, 'utf-8');
          const skill = this.parseMarkdownSkill(fullPath, content, source);
          if (skill) skills.push(skill);
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // directory doesn't exist
    }

    return skills;
  }

  private parseMarkdownSkill(filePath: string, content: string, source: Skill['source']): Skill | null {
    const name = basename(filePath, '.md');

    // Parse frontmatter if present
    let description = '';
    let promptBody = content;
    const variables: SkillVariable[] = [];

    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (fmMatch) {
      const frontmatter = fmMatch[1];
      promptBody = fmMatch[2].trim();

      // Simple YAML-like parsing
      for (const line of frontmatter.split('\n')) {
        const [key, ...vals] = line.split(':');
        const value = vals.join(':').trim();
        if (key.trim() === 'description') description = value;
      }
    }

    // Detect variables: $VARIABLE_NAME or {{variable_name}}
    const varMatches = promptBody.matchAll(/\$([A-Z_]+)|\{\{(\w+)\}\}/g);
    for (const match of varMatches) {
      const varName = match[1] || match[2];
      if (!variables.find((v) => v.name === varName)) {
        variables.push({ name: varName, label: varName.replace(/_/g, ' '), type: 'text' });
      }
    }

    return {
      id: `${source}:${name}`,
      name: name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      description: description || `${source} skill: ${name}`,
      source,
      trigger: `/${name}`,
      type: 'simple',
      promptTemplate: promptBody,
      variables: variables.length > 0 ? variables : undefined,
      filePath,
    };
  }

  private async loadBuiltinSkills(): Promise<Skill[]> {
    return [
      {
        id: 'jowork:weekly-report',
        name: 'Weekly Report',
        description: 'Generate a weekly progress report from recent conversations and commits',
        source: 'jowork',
        trigger: '/weekly-report',
        type: 'simple',
        promptTemplate: 'Generate a weekly progress report based on the following context:\n- Review my recent conversations this week\n- Summarize key accomplishments, blockers, and next steps\n- Format as markdown with sections: Accomplishments, In Progress, Blockers, Next Week',
      },
      {
        id: 'jowork:review-pr',
        name: 'Review PR',
        description: 'Review a pull request with detailed feedback',
        source: 'jowork',
        trigger: '/review-pr',
        type: 'simple',
        promptTemplate: 'Review the pull request at {{pr_url}}. Provide:\n1. Summary of changes\n2. Code quality assessment\n3. Potential issues or bugs\n4. Suggestions for improvement\n5. Overall recommendation (approve/request changes)',
        variables: [{ name: 'pr_url', label: 'PR URL', type: 'text', required: true }],
      },
      {
        id: 'jowork:daily-standup',
        name: 'Daily Standup',
        description: 'Prepare daily standup notes from recent activity',
        source: 'jowork',
        trigger: '/standup',
        type: 'simple',
        promptTemplate: 'Based on my recent activity, prepare my daily standup update:\n- What I did yesterday\n- What I plan to do today\n- Any blockers\nKeep it concise (3-5 bullet points total).',
      },
    ];
  }
}
