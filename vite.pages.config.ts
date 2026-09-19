import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(ROOT, 'dist-pages');
const RUNTIME_PUBLIC_FILES = [
  '.nojekyll',
  'robots.txt',
  'config.json',
  'favicon.svg',
  'avatar/team-six.png',
  'room/bilik-geng-zone.png',
] as const;

function copyRuntimePublicFiles(): Plugin {
  return {
    name: 'copy-runtime-public-files',
    closeBundle() {
      for (const relativePath of RUNTIME_PUBLIC_FILES) {
        const target = resolve(OUT_DIR, relativePath);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(resolve(ROOT, 'public', relativePath), target);
      }
    },
  };
}

export default defineConfig({
  base: '/homebase/',
  publicDir: false,
  plugins: [react(), copyRuntimePublicFiles()],
  css: { postcss: { plugins: [tailwindcss()] } },
  build: { outDir: 'dist-pages', emptyOutDir: true },
});
