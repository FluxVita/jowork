import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({
      include: ['electron-updater'],
      exclude: ['@jowork/core', '@jowork/ui'],
    })],
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
        input: './src/renderer/index.html',
      },
    },
  },
});
