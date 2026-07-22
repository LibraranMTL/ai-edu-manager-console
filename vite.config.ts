import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string };
const versionManifest = JSON.parse(readFileSync(resolve(process.cwd(), 'release/windows/edu-manager-version.json'), 'utf8')) as { windowsVersionCode?: number };

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('/qrcode/')) return 'feature-qrcode';
          return undefined;
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_VERSION_CODE__: JSON.stringify(Number(versionManifest.windowsVersionCode || 0)),
  },
});
