import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist-terminal',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'terminal.html'),
    },
  },
});
