import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir: string;

vi.mock('../utils/paths.js', () => {
  return {
    configPath: () => join(tempDir, 'config.json'),
    joworkDir: () => tempDir,
  };
});

const { readConfig, writeConfig } = await import('../utils/config.js');

describe('Config', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jowork-config-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns default config when no file exists', () => {
    const config = readConfig();
    expect(config.version).toBe('0.1.0');
    expect(config.initialized).toBe(false);
  });

  it('writes and reads config', () => {
    writeConfig({
      version: '0.1.0',
      initialized: true,
      connectors: { feishu: { type: 'feishu', status: 'connected' } },
    });
    const config = readConfig();
    expect(config.initialized).toBe(true);
    expect(config.connectors.feishu.status).toBe('connected');
  });

  it('returns default config on malformed JSON', () => {
    const { writeFileSync } = require('node:fs');
    writeFileSync(join(tempDir, 'config.json'), '{broken json!!!');
    const config = readConfig();
    expect(config.version).toBe('0.1.0');
    expect(config.initialized).toBe(false);
  });
});
