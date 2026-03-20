import { defineConfig } from 'tsup';

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
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: ['better-sqlite3'],
  shims: true,
});
