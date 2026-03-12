import { readdir, readFile, writeFile, mkdir, unlink, stat } from 'fs/promises';
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
    const hardcoded: Skill[] = [
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

    // Also load from templates directory
    const templateSkills = await this.loadTemplateSkills();
    return [...hardcoded, ...templateSkills];
  }

  private async loadTemplateSkills(): Promise<Skill[]> {
    const dir = join(__dirname, 'templates');
    const skills: Skill[] = [];
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        try {
          const content = await readFile(join(dir, entry), 'utf-8');
          const data = JSON.parse(content) as Skill;
          skills.push({ ...data, source: 'jowork' });
        } catch {
          // skip invalid template files
        }
      }
    } catch {
      // templates directory doesn't exist
    }
    return skills;
  }

  /** Save a user-created custom skill as .md in ~/.jowork/skills/ */
  async saveCustomSkill(skill: Omit<Skill, 'id' | 'source'>): Promise<Skill> {
    const dir = join(homedir(), '.jowork', 'skills');
    await mkdir(dir, { recursive: true });

    const slug = skill.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const filePath = join(dir, `${slug}.md`);

    // Build markdown with frontmatter
    const lines = ['---'];
    lines.push(`description: ${skill.description}`);
    lines.push(`trigger: ${skill.trigger}`);
    lines.push(`type: ${skill.type}`);
    if (skill.variables?.length) {
      lines.push('variables:');
      for (const v of skill.variables) {
        lines.push(`  - name: ${v.name}`);
        lines.push(`    label: ${v.label}`);
        lines.push(`    type: ${v.type}`);
        if (v.required) lines.push(`    required: true`);
        if (v.default) lines.push(`    default: ${v.default}`);
        if (v.options?.length) lines.push(`    options: ${v.options.join(', ')}`);
      }
    }
    lines.push('---');
    lines.push('');
    lines.push(skill.promptTemplate ?? '');

    await writeFile(filePath, lines.join('\n'), 'utf-8');

    return {
      ...skill,
      id: `community:${slug}`,
      source: 'community',
      filePath,
    };
  }

  /** Delete a custom skill file */
  async deleteCustomSkill(skillId: string): Promise<void> {
    const skills = await this.loadAll();
    const skill = skills.find((s) => s.id === skillId);
    if (!skill?.filePath) throw new Error('Cannot delete: skill has no file path');
    await unlink(skill.filePath);
  }
}
