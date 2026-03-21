import type { Command } from 'commander';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
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
    .argument('<engine>', 'Engine to register with: claude-code, codex, openclaw')
    .action(async (engine: string) => {
      switch (engine) {
        case 'claude-code':
          registerClaudeCode();
          break;
        case 'codex':
          registerCodex();
          break;
        case 'openclaw':
          registerOpenClaw();
          break;
        default:
          console.error(`Unknown engine: ${engine}. Supported: claude-code, codex, openclaw`);
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
    env: { JOWORK_ENGINE: 'claude-code' },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`✓ Registered JoWork MCP server in ${configPath}`);
  console.log('');
  console.log('Claude Code will now have access to JoWork tools:');
  console.log('  search_data, read_memory, write_memory, search_memory, ...');
}

function registerOpenClaw(): void {
  const openclawDir = join(HOME, '.openclaw');
  const configPath = join(openclawDir, 'config.json');

  mkdirSync(openclawDir, { recursive: true });

  // Backup existing config
  if (existsSync(configPath)) {
    copyFileSync(configPath, configPath + '.bak');
    console.log(`Backed up existing config to ${configPath}.bak`);
  }

  // Read or create config
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      console.error(`Warning: ${configPath} contains invalid JSON. Creating fresh config.`);
      config = {};
    }
  }

  // Merge JoWork MCP server entry
  if (!config['mcpServers']) config['mcpServers'] = {};
  (config['mcpServers'] as Record<string, unknown>)['jowork'] = {
    command: 'jowork',
    args: ['serve'],
    env: { JOWORK_ENGINE: 'openclaw' },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`Registered JoWork MCP server in ${configPath}`);
  console.log('');
  console.log('OpenClaw will now have access to JoWork tools:');
  console.log('  search_data, read_memory, write_memory, search_memory, ...');
}

function registerCodex(): void {
  const codexDir = join(HOME, '.codex');
  const configPath = join(codexDir, 'config.toml');

  mkdirSync(codexDir, { recursive: true });

  // Backup existing config
  if (existsSync(configPath)) {
    copyFileSync(configPath, configPath + '.bak');
    console.log(`✓ Backed up existing config to ${configPath}.bak`);
  }

  // Read or create config
  let content = '';
  if (existsSync(configPath)) {
    content = readFileSync(configPath, 'utf-8');
  }

  // Check if jowork MCP entry already exists
  if (content.includes('[mcp_servers.jowork]')) {
    console.log('✓ JoWork already registered with Codex');
    return;
  }

  // Append MCP server config (TOML format)
  const mcpEntry = `
[mcp_servers.jowork]
command = "jowork"
args = ["serve"]

[mcp_servers.jowork.env]
JOWORK_ENGINE = "codex"
`;

  writeFileSync(configPath, content + mcpEntry);
  console.log(`✓ Registered JoWork MCP server in ${configPath}`);
}
