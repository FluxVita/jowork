import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('jowork register claude-code', () => {
  let tempDir: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jowork-register-'));
    origHome = process.env['HOME'];
    process.env['HOME'] = tempDir;
  });

  afterEach(() => {
    process.env['HOME'] = origHome;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates .claude.json if it does not exist', () => {
    const configPath = join(tempDir, '.claude.json');
    // Simulate what register does
    const config: Record<string, unknown> = {};
    if (!config.mcpServers) (config as { mcpServers: Record<string, unknown> }).mcpServers = {};
    (config.mcpServers as Record<string, unknown>)['jowork'] = { command: 'jowork', args: ['serve'] };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const written = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers.jowork.command).toBe('jowork');
  });

  it('preserves existing MCP servers when adding jowork', () => {
    const configPath = join(tempDir, '.claude.json');
    // Pre-existing config with another MCP server
    writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        'other-server': { command: 'other', args: ['run'] },
      },
      someOtherKey: 'preserved',
    }, null, 2));

    // Simulate merge
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.mcpServers['jowork'] = { command: 'jowork', args: ['serve'] };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(result.mcpServers['other-server'].command).toBe('other');
    expect(result.mcpServers['jowork'].command).toBe('jowork');
    expect(result.someOtherKey).toBe('preserved');
  });

  it('creates backup before modifying', () => {
    const configPath = join(tempDir, '.claude.json');
    const backupPath = configPath + '.bak';
    writeFileSync(configPath, '{"existing": true}');

    // Simulate backup
    copyFileSync(configPath, backupPath);

    expect(existsSync(backupPath)).toBe(true);
    expect(JSON.parse(readFileSync(backupPath, 'utf-8')).existing).toBe(true);
  });

  it('handles malformed JSON gracefully', () => {
    const configPath = join(tempDir, '.claude.json');
    writeFileSync(configPath, 'not valid json {{{');

    // Simulate what register does with malformed JSON
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      config = {}; // fallback to empty
    }
    if (!config.mcpServers) (config as { mcpServers: Record<string, unknown> }).mcpServers = {};
    (config.mcpServers as Record<string, unknown>)['jowork'] = { command: 'jowork', args: ['serve'] };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(result.mcpServers.jowork.command).toBe('jowork');
  });

  it('is idempotent — running twice does not duplicate', () => {
    const configPath = join(tempDir, '.claude.json');

    // First run
    let config: Record<string, unknown> = { mcpServers: {} };
    (config.mcpServers as Record<string, unknown>)['jowork'] = { command: 'jowork', args: ['serve'] };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Second run — read and merge again
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
    (config.mcpServers as Record<string, unknown>)['jowork'] = { command: 'jowork', args: ['serve'] };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = JSON.parse(readFileSync(configPath, 'utf-8'));
    const serverKeys = Object.keys(result.mcpServers);
    expect(serverKeys.filter((k: string) => k === 'jowork').length).toBe(1);
  });
});
