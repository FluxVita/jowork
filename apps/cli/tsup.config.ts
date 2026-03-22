import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';

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
    // Add shebang + executable permission to cli.js
    const cliPath = 'dist/cli.js';
    const content = readFileSync(cliPath, 'utf-8');
    if (!content.startsWith('#!')) {
      writeFileSync(cliPath, '#!/usr/bin/env node\n' + content);
    }
    chmodSync(cliPath, 0o755);
  },
});
