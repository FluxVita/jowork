import type { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { DbManager } from '../db/manager.js';
import { dbPath, joworkDir } from '../utils/paths.js';

const HOME = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';

// ── Embedded SKILL.md files ─────────────────────────────────────────
// These are written to ~/.claude/skills/jowork/ during setup.
// Keeping them inline means `npx jowork setup` works without cloning the repo.

const SKILL_FILES: Record<string, string> = {
  'SKILL.md': [
    '---',
    'name: jowork',
    'version: 0.1.0',
    'description: |',
    '  AI Agent companion — connect data sources, manage sessions, drag files into',
    '  context, track goals. Works with Claude Code, Codex, and OpenClaw.',
    'allowed-tools:',
    '  - Bash',
    '  - Read',
    '  - Write',
    '  - Edit',
    '  - AskUserQuestion',
    '---',
    '',
    '# JoWork — Agent Infrastructure Skill',
    '',
    'JoWork gives your AI agent eyes (data connectors), memory (cross-session',
    'persistence), purpose (goal tracking), and a companion dashboard.',
    '',
    '## Auto-Setup',
    '',
    'On first use, check if JoWork is initialized:',
    '```bash',
    'command -v jowork >/dev/null 2>&1 && echo "CLI_INSTALLED" || echo "CLI_MISSING"',
    '[ -d ~/.jowork ] && echo "INITIALIZED" || echo "NOT_INITIALIZED"',
    '```',
    'If CLI_MISSING: tell user to run `npx jowork@latest setup`.',
    'If NOT_INITIALIZED: run `jowork init`.',
    '',
    '## Proactive Suggestions',
    '',
    'When you notice the user is at these stages, suggest the appropriate action:',
    '- User asks about team discussions or what happened → use `search_data` MCP tool',
    '- User mentions connecting GitHub/Slack/data → suggest `/jowork-connect`',
    '- User wants dashboard or session management → suggest `/jowork-dashboard`',
    '- User sets goals or wants metrics → suggest `jowork goal add`',
    '- User mentions a folder to index → suggest `/jowork-context`',
    '- User asks for a briefing → use `get_briefing` MCP tool',
    '',
    '## Status Check',
    '',
    'When invoked as `/jowork`:',
    '```bash',
    'jowork status 2>/dev/null || echo "Not initialized. Run: npx jowork@latest setup"',
    '```',
  ].join('\n'),

  'jowork-connect/SKILL.md': [
    '---',
    'name: jowork-connect',
    'version: 0.1.0',
    'description: |',
    '  Connect a data source (GitHub, GitLab, Linear, PostHog, Feishu) to JoWork.',
    'allowed-tools:',
    '  - Bash',
    '  - AskUserQuestion',
    '---',
    '',
    '# /jowork-connect — Connect Data Source',
    '',
    'Connect a data source without leaving your agent session.',
    '',
    '## Sources',
    '- **GitHub**: `jowork connect github --token "$GITHUB_PERSONAL_ACCESS_TOKEN"`',
    '- **GitLab**: `jowork connect gitlab --token "<token>"`',
    '- **Linear**: `jowork connect linear --api-key "<key>"`',
    '- **PostHog**: `jowork connect posthog --api-key "<key>" --project-id "<id>"`',
    '- **Feishu**: `jowork connect feishu --app-id "<id>" --app-secret "<secret>"`',
    '',
    'After connecting, run `jowork sync --source <source>` to pull data.',
    'Never log or display tokens. Use AskUserQuestion for credential input.',
  ].join('\n'),

  'jowork-sync/SKILL.md': [
    '---',
    'name: jowork-sync',
    'version: 0.1.0',
    'description: Sync data from all connected sources into JoWork.',
    'allowed-tools:',
    '  - Bash',
    '---',
    '',
    '# /jowork-sync',
    '',
    '```bash',
    'jowork sync 2>&1',
    '```',
    'Report which sources synced and how many new objects.',
  ].join('\n'),

  'jowork-dashboard/SKILL.md': [
    '---',
    'name: jowork-dashboard',
    'version: 0.1.0',
    'description: Open the JoWork companion dashboard in your browser.',
    'allowed-tools:',
    '  - Bash',
    '---',
    '',
    '# /jowork-dashboard',
    '',
    '```bash',
    'PORT=$(cat ~/.jowork/dashboard.port 2>/dev/null || echo 18801)',
    'if curl -s --max-time 1 "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1; then',
    '  open "http://127.0.0.1:$PORT" 2>/dev/null || echo "Open http://127.0.0.1:$PORT"',
    'else',
    '  jowork dashboard &',
    'fi',
    '```',
  ].join('\n'),

  'jowork-context/SKILL.md': [
    '---',
    'name: jowork-context',
    'version: 0.1.0',
    'description: Index a local directory so your agent can search its files.',
    'allowed-tools:',
    '  - Bash',
    '  - AskUserQuestion',
    '---',
    '',
    '# /jowork-context',
    '',
    'Ask which directory to index, then:',
    '```bash',
    'PORT=$(cat ~/.jowork/dashboard.port 2>/dev/null || echo 18801)',
    'CSRF=$(curl -s "http://127.0.0.1:$PORT/" | grep csrf-token | sed \'s/.*content="\\([^"]*\\)".*/\\1/\')',
    'curl -s -X POST "http://127.0.0.1:$PORT/api/context" \\',
    '  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \\',
    '  -d "{\\"type\\":\\"directory\\",\\"value\\":\\"$DIR\\",\\"label\\":\\"$(basename $DIR)\\"}"',
    '```',
    'If dashboard not running, start it first with `jowork dashboard &`.',
  ].join('\n'),
};

export function setupSkillCommand(program: Command): void {
  program
    .command('setup')
    .description('One-command setup: install skills + init DB + register with AI agents')
    .action(async () => {
      console.log('');
      console.log('  JoWork Setup');
      console.log('  ============');
      console.log('');

      // Step 1: Install skill files
      const skillDir = join(HOME, '.claude', 'skills', 'jowork');
      console.log('  Installing skills to ~/.claude/skills/jowork/ ...');

      for (const [relativePath, content] of Object.entries(SKILL_FILES)) {
        const fullPath = join(skillDir, relativePath);
        mkdirSync(join(fullPath, '..'), { recursive: true });
        writeFileSync(fullPath, content);
      }
      writeFileSync(join(skillDir, 'VERSION'), '0.1.0\n');
      console.log('  ✓ 5 skills installed');

      // Step 2: Init DB
      const jDir = joworkDir();
      if (existsSync(join(jDir, 'config.json'))) {
        console.log('  ✓ Database already initialized');
      } else {
        mkdirSync(jDir, { recursive: true });
        mkdirSync(join(jDir, 'data'), { recursive: true });
        mkdirSync(join(jDir, 'logs'), { recursive: true });
        mkdirSync(join(jDir, 'credentials'), { recursive: true });

        const db = new DbManager(dbPath());
        db.ensureTables();
        db.close();

        writeFileSync(
          join(jDir, 'config.json'),
          JSON.stringify({ version: '0.1.0', initialized: true, connectors: {} }, null, 2),
        );
        console.log('  ✓ Database initialized');
      }

      // Step 3: Register MCP with Claude Code
      const claudeJson = join(HOME, '.claude.json');
      let mcpRegistered = false;
      if (existsSync(claudeJson)) {
        try {
          const content = JSON.parse(readFileSync(claudeJson, 'utf-8'));
          if (content.mcpServers?.jowork) mcpRegistered = true;
        } catch { /* parse error */ }
      }

      if (mcpRegistered) {
        console.log('  ✓ MCP server registered with Claude Code');
      } else {
        try {
          execSync('jowork register claude-code', { stdio: 'pipe' });
          console.log('  ✓ MCP server registered with Claude Code');
        } catch {
          // jowork might not be in PATH yet (npx run). Try node directly.
          try {
            const cliPath = join(__dirname, '..', 'cli.js');
            execSync(`node "${cliPath}" register claude-code`, { stdio: 'pipe' });
            console.log('  ✓ MCP server registered with Claude Code');
          } catch {
            console.log('  ⚠ Could not auto-register. Run: jowork register claude-code');
          }
        }
      }

      // Step 4: Register with Codex/OpenClaw if available
      try {
        execSync('which codex', { stdio: 'pipe' });
        try {
          execSync('jowork register codex', { stdio: 'pipe' });
          console.log('  ✓ Registered with Codex');
        } catch { /* already registered */ }
      } catch { /* not installed */ }

      // Step 5: Check connected sources and guide next action
      const { listCredentials } = await import('../connectors/credential-store.js');
      const connectedSources = listCredentials();

      console.log('');
      console.log('  ============');
      console.log('  JoWork is ready!');
      console.log('');

      if (!mcpRegistered) {
        console.log('  ⚠  Restart Claude Code to activate MCP tools (search_data, read_memory, etc.)');
        console.log('');
      }

      if (connectedSources.length === 0) {
        console.log('  Next: Connect your first data source. Run one of:');
        console.log('');
        console.log('    jowork connect github          # Uses GITHUB_PERSONAL_ACCESS_TOKEN env var');
        console.log('    jowork connect gitlab --token <token>');
        console.log('    jowork connect linear --api-key <key>');
        console.log('    jowork connect posthog --api-key <key> --project-id <id>');
        console.log('    jowork connect feishu --app-id <id> --app-secret <secret>');
        console.log('');
        console.log('  Or in Claude Code, just say: "connect my GitHub"');
      } else {
        console.log(`  ${connectedSources.length} data source(s) connected: ${connectedSources.join(', ')}`);
        console.log('');
        console.log('  Try in Claude Code:');
        console.log('    /jowork            Status overview');
        console.log('    /jowork-dashboard  Open companion panel');
        console.log('    "search my PRs"   Agent uses search_data automatically');
      }
      console.log('');

      // Auto-connect GitHub if token is available and not already connected
      if (!connectedSources.includes('github') && process.env['GITHUB_PERSONAL_ACCESS_TOKEN']) {
        console.log('  Detected GITHUB_PERSONAL_ACCESS_TOKEN in environment.');
        console.log('  Connecting GitHub automatically...');
        try {
          execSync('jowork connect github --token "$GITHUB_PERSONAL_ACCESS_TOKEN"', {
            stdio: 'pipe',
            env: process.env,
          });
          console.log('  ✓ GitHub connected! Running initial sync...');
          try {
            const output = execSync('jowork sync --source github', {
              encoding: 'utf-8',
              timeout: 30000,
              env: process.env,
            });
            console.log(output.trim().split('\n').map(l => '  ' + l).join('\n'));
          } catch { /* sync timeout is ok */ }
        } catch (err) {
          console.log(`  ⚠ Could not auto-connect GitHub: ${err}`);
        }
        console.log('');
      }
    });
}
