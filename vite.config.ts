import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string };
const versionManifest = JSON.parse(readFileSync(resolve(process.cwd(), 'release/windows/edu-manager-version.json'), 'utf8')) as { windowsVersionCode?: number };
const candidateCode = Number(process.env.EDU_WINDOWS_CANDIDATE_VERSION_CODE || 0);
if (candidateCode && (!process.env.EDU_WINDOWS_CANDIDATE_TAG || !Number.isSafeInteger(candidateCode) || candidateCode <= Number(versionManifest.windowsVersionCode || 0))) {
  throw new Error('Windows 候选版本码必须高于当前正式版，并指定候选标识。');
}

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
    __APP_VERSION_CODE__: JSON.stringify(candidateCode || Number(versionManifest.windowsVersionCode || 0)),
  },
});
