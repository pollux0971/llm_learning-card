import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  // 讓 dev server 能以靜態路徑讀 contracts/fixtures/(Wave 0 的圖片與素材)
  server: { fs: { allow: ['../..'] } },
});
