import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string };
const versionManifest = JSON.parse(readFileSync(resolve(process.cwd(), 'release/windows/edu-manager-version.json'), 'utf8')) as { windowsVersionCode?: number };

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_VERSION_CODE__: JSON.stringify(Number(versionManifest.windowsVersionCode || 0)),
  },
});
