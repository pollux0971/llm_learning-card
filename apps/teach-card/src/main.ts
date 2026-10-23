import { mount } from 'svelte';
import { isTauri } from '@tauri-apps/api/core';
import { createLearningFs } from '../../desktop/src/webview/learning-fs.js';
import { createReviewClient } from '../../desktop/src/webview/review-client.js';
import App from './App.svelte';
import type { TeachSessionDeps } from './teach-session.js';

function browserFs(): TeachSessionDeps['fs'] {
  return {
    async read(path: string): Promise<string> {
      const res = await fetch(`/__card?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error('讀取失敗');
      return res.text();
    },
  };
}

function storage(): TeachSessionDeps['storage'] {
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => {
      localStorage.setItem(key, value);
    },
  };
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createDeps(): TeachSessionDeps {
  if (isTauri()) {
    return { client: createReviewClient(), fs: createLearningFs(), storage: storage(), pause };
  }
  return {
    client: createReviewClient({
      handler: (line) => fetch('/__review', { method: 'POST', body: line }).then((r) => r.text()),
    }),
    fs: browserFs(),
    storage: storage(),
    pause,
  };
}

const app = mount(App, { target: document.getElementById('app')!, props: { deps: createDeps() } });

export default app;
