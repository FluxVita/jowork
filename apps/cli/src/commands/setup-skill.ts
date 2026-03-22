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

// Single SKILL.md — no sub-skills. All actions described as inline instructions.
// Agent uses MCP tools (search_data, sync_now, etc.) + bash commands.
const SKILL_CONTENT = `---
name: jowork
version: 0.2.0
description: |
  AI Agent companion — connect data sources, manage sessions, drag files into
  context, track goals. Works with Claude Code, Codex, and OpenClaw.
  Use /jowork for status, or just ask naturally ("connect my GitHub", "sync data",
  "open dashboard", "search PRs").
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# JoWork — Agent Infrastructure

JoWork gives your AI agent data awareness (connectors), memory (cross-session),
goal tracking, and a companion dashboard. All data stays local.

**IMPORTANT:** Always use the global \`jowork\` command (not \`node apps/cli/dist/...\`).
JoWork is installed globally via npm. Run \`jowork <subcommand>\` directly.

## How it works

JoWork runs as an MCP server. Your agent already has these tools available:
- **search_data** — search across all synced data
- **read_memory / write_memory** — cross-session memory
- **search_memory** — time-weighted memory search
- **get_goals / get_metrics** — goal progress
- **get_hot_context** — recent 24-72h activity summary
- **get_briefing** — daily briefing
- **sync_now** — trigger data sync
- **push_to_channel** — send messages to connected channels

Use these MCP tools directly. No slash commands needed for data queries.

## When the user asks to connect a data source

Run the appropriate bash command. Ask for credentials via AskUserQuestion
if not in environment. Never display tokens in output.

\`\`\`
GitHub:   jowork connect github --token "$GITHUB_PERSONAL_ACCESS_TOKEN"
GitLab:   jowork connect gitlab --token "<token>"
Linear:   jowork connect linear --api-key "<key>"
PostHog:  jowork connect posthog --api-key "<key>" --project-id "<id>"
Feishu:   jowork connect feishu --app-id "<id>" --app-secret "<secret>"
\`\`\`

After connecting, call the \`sync_now\` MCP tool or run \`jowork sync\`.

## When the user asks to open the dashboard

\`\`\`bash
PORT=$(cat ~/.jowork/dashboard.port 2>/dev/null || echo 18801)
if curl -s --max-time 1 "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1; then
  open "http://127.0.0.1:$PORT" 2>/dev/null || echo "Open http://127.0.0.1:$PORT"
else
  jowork dashboard &
  sleep 2
  open "http://127.0.0.1:$(cat ~/.jowork/dashboard.port 2>/dev/null || echo 18801)"
fi
\`\`\`

## When the user asks to index a folder

\`\`\`bash
jowork context add "<directory_path>"
\`\`\`

Or if dashboard is running, use its API for progress feedback.

## Proactive behavior

When you notice these patterns, act without being asked:
- User asks about team discussions → call \`search_data\` or \`get_hot_context\`
- User mentions connecting a service → guide through connection (see above)
- User asks "what's new" or wants a briefing → call \`get_briefing\`
- User mentions a folder to index → offer to index it
- User wants to track a metric → guide through \`jowork goal add\`

## Status check (when invoked as /jowork)

\`\`\`bash
jowork status 2>/dev/null || echo "Not initialized. Run: npx jowork@latest setup"
\`\`\`

Show results and suggest next action based on state.
`;

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
      console.log('  Installing skill to ~/.claude/skills/jowork/ ...');

      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), SKILL_CONTENT);
      writeFileSync(join(skillDir, 'VERSION'), '0.2.0\n');
      console.log('  ✓ Skill installed (/jowork)');

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
