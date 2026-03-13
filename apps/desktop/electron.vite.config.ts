import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

const nativeExternals = ['better-sqlite3', 'node-pty'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({
      include: ['electron-updater'],
      exclude: ['@jowork/core', '@jowork/ui'],
    })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'mcp-server': resolve(__dirname, 'src/mcp-server-entry.ts'),
        },
        external: nativeExternals,
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({
      exclude: ['@jowork/core', '@jowork/ui'],
    })],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
});
