import type { Command } from 'commander';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HOME = process.env['HOME'] ?? '';

interface ClaudeConfig {
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  [key: string]: unknown;
}

export function registerCommand(program: Command): void {
  program
    .command('register')
    .description('Register JoWork MCP server with an AI agent engine')
    .argument('<engine>', 'Engine to register with: claude-code, codex')
    .action(async (engine: string) => {
      switch (engine) {
        case 'claude-code':
          registerClaudeCode();
          break;
        case 'codex':
          console.log('Codex registration not yet implemented.');
          break;
        default:
          console.error(`Unknown engine: ${engine}. Supported: claude-code, codex`);
          process.exit(1);
      }
    });
}

function registerClaudeCode(): void {
  const configPath = join(HOME, '.claude.json');

  // Backup existing config
  if (existsSync(configPath)) {
    const backupPath = configPath + '.bak';
    copyFileSync(configPath, backupPath);
    console.log(`✓ Backed up existing config to ${backupPath}`);
  }

  // Read existing config or create new
  let config: ClaudeConfig = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      console.error(`Warning: ${configPath} contains invalid JSON. Creating fresh config.`);
      console.error(`  Original backed up to ${configPath}.bak`);
      config = {};
    }
  }

  // Merge JoWork MCP server entry (don't overwrite other entries)
  if (!config.mcpServers) config.mcpServers = {};

  config.mcpServers['jowork'] = {
    command: 'jowork',
    args: ['serve'],
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`✓ Registered JoWork MCP server in ${configPath}`);
  console.log('');
  console.log('Claude Code will now have access to JoWork tools:');
  console.log('  search_data, read_memory, write_memory, search_memory, ...');
}
