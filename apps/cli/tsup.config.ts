import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync } from 'node:fs';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    transport: 'src/mcp/transport.ts',
  },
  format: ['esm'],
  target: 'node20',
  splitting: true,
  clean: true,
  dts: false,
  external: ['better-sqlite3'],
  noExternal: ['@jowork/core'],
  shims: true,
  onSuccess: async () => {
    // Add shebang to cli.js only (not transport or chunks)
    const cliPath = 'dist/cli.js';
    const content = readFileSync(cliPath, 'utf-8');
    if (!content.startsWith('#!')) {
      writeFileSync(cliPath, '#!/usr/bin/env node\n' + content);
    }
  },
});
