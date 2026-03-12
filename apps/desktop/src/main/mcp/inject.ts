import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Inject JoWork MCP Server into Claude Code's config.
 * Writes to ~/.claude.json mcpServers field.
 */
export function injectMcpConfig(serverEntryPath: string, dbPath: string): void {
  const claudeConfigPath = join(homedir(), '.claude.json');

  let config: Record<string, unknown> = {};
  if (existsSync(claudeConfigPath)) {
    try {
      config = JSON.parse(readFileSync(claudeConfigPath, 'utf-8'));
    } catch {
      // corrupted, start with empty
    }
  }

  const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;

  mcpServers['jowork'] = {
    command: 'node',
    args: [serverEntryPath],
    env: { JOWORK_DB_PATH: dbPath },
  };

  config.mcpServers = mcpServers;
  writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Remove JoWork MCP Server from Claude Code's config.
 */
export function removeMcpConfig(): void {
  const claudeConfigPath = join(homedir(), '.claude.json');

  if (!existsSync(claudeConfigPath)) return;

  try {
    const config = JSON.parse(readFileSync(claudeConfigPath, 'utf-8'));
    const mcpServers = config.mcpServers as Record<string, unknown> | undefined;
    if (mcpServers) {
      delete mcpServers['jowork'];
      config.mcpServers = mcpServers;
      writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    }
  } catch {
    // ignore
  }
}
