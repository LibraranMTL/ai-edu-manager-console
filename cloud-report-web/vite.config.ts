import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cloudWebDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: resolve(cloudWebDir),
  base: './',
  server: { host: '127.0.0.1', proxy: { '/v1': 'http://127.0.0.1:8755' } },
  build: { outDir: resolve(cloudWebDir, '../cloud-report-service/web-dist'), emptyOutDir: true },
});
