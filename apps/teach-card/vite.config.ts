import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { standalonePlugin } from './dev/standalone.js';

export default defineConfig({
  plugins: [svelte(), standalonePlugin()],
  resolve: {
    alias: {
      // 跟根目錄 vitest.config.ts 對齊:review-client 要解析 @core/session/protocol.js
      '@core': fileURLToPath(new URL('../../packages/core/src', import.meta.url)),
      '@contracts': fileURLToPath(new URL('../../packages/contracts/src', import.meta.url)),
    },
  },
  // 讓 dev server 能以靜態路徑讀 contracts/fixtures/(Wave 0 的圖片與素材)
  server: { fs: { allow: ['../..'] } },
});
