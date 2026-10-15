import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

const galleryDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(galleryDir, '../../../../..');

export default defineConfig({
  plugins: [svelte()],
  server: {
    fs: { allow: [repoRoot] },
  },
});
