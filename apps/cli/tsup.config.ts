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
  external: ['better-sqlite3'],
  noExternal: ['@jowork/core'],
  shims: true,
});
